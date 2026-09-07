import {
  HttpBadRequestError,
  HttpConflictError,
  HttpForbiddenError,
  HttpNotFoundError,
  HttpError,
} from "@ez4/gateway";
import { Order } from "@ez4/database";
import type {
  DeviceRegistration,
  NotificationDevice,
  NotificationDelivery,
  NotificationPreferences,
} from "@receivy/common";
import type { DbClient } from "../database";
import { findChargeForActor } from "../charges/repository";

export async function getPreferences(
  db: DbClient,
  userId: string,
): Promise<NotificationPreferences> {
  const row = await db.notification_preferences.findOne({
    select: { email_enabled: true, push_enabled: true, reminder_offsets: true },
    where: { user_id: userId },
  });
  return row
    ? {
        emailEnabled: row.email_enabled,
        pushEnabled: row.push_enabled,
        reminderOffsets: JSON.parse(row.reminder_offsets) as number[],
      }
    : { emailEnabled: true, pushEnabled: true, reminderOffsets: [-3, 0, 2] };
}
export async function savePreferences(
  db: DbClient,
  userId: string,
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  if (
    typeof input.emailEnabled !== "boolean" ||
    typeof input.pushEnabled !== "boolean" ||
    !Array.isArray(input.reminderOffsets) ||
    input.reminderOffsets.length > 10 ||
    input.reminderOffsets.some(
      (n) => !Number.isInteger(n) || n < -90 || n > 90,
    ) ||
    new Set(input.reminderOffsets).size !== input.reminderOffsets.length
  )
    throw new HttpBadRequestError("Preferências inválidas.");
  return db.transaction(async (tx) => {
    if (
      !(await tx.users.findOne({
        select: { id: true },
        where: { id: userId },
        lock: true,
      }))
    )
      throw new HttpNotFoundError();
    const data = {
      email_enabled: input.emailEnabled,
      push_enabled: input.pushEnabled,
      reminder_offsets: JSON.stringify(
        [...input.reminderOffsets].sort((a, b) => a - b),
      ),
      updated_at: new Date().toISOString(),
    };
    if (
      await tx.notification_preferences.findOne({
        select: { user_id: true },
        where: { user_id: userId },
      })
    ) {
      await tx.notification_preferences.updateOne({
        where: { user_id: userId },
        data,
      });
    } else
      await tx.notification_preferences.insertOne({
        data: { id: crypto.randomUUID(), user: { id: userId }, ...data },
      });
    await audit(tx, userId, userId, "notifications.preferences_updated");
    return getPreferences(tx, userId);
  });
}
async function audit(db: DbClient, userId: string, id: string, type: string) {
  await db.activity_events.insertOne({
    data: {
      id: crypto.randomUUID(),
      actor_user: { id: userId },
      subject_user: { id: userId },
      type,
      aggregate_type: "notification",
      aggregate_id: id,
      payload: "{}",
      created_at: new Date().toISOString(),
    },
  });
}
export async function listDevices(
  db: DbClient,
  userId: string,
): Promise<NotificationDevice[]> {
  const rows = await db.device_tokens.findMany({
    select: { id: true, platform: true, active: true, created_at: true },
    where: { user_id: userId },
  });
  return rows.records.map((row) => ({
    id: row.id,
    platform: row.platform,
    active: row.active,
    createdAt: row.created_at,
  }));
}
export async function registerDevice(
  db: DbClient,
  userId: string,
  input: DeviceRegistration,
): Promise<NotificationDevice> {
  if (
    !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(
      input.token,
    ) ||
    input.token.length > 300 ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(input.installationId) ||
    !["ios", "android"].includes(input.platform)
  )
    throw new HttpBadRequestError("Dispositivo inválido.");
  return db.transaction(async (tx) => {
    if (
      !(await tx.users.findOne({
        select: { id: true },
        where: { id: userId },
        lock: true,
      }))
    )
      throw new HttpNotFoundError();
    const token = await tx.device_tokens.findOne({
      select: { id: true, user_id: true },
      where: { token: input.token },
    });
    if (token && token.user_id !== userId)
      throw new HttpConflictError(
        "O dispositivo deve ser removido da conta anterior.",
      );
    const existing = await tx.device_tokens.findOne({
      select: { id: true, created_at: true, token: true },
      where: { user_id: userId, installation_id: input.installationId },
    });
    if (token && token.id !== existing?.id)
      throw new HttpConflictError("Dispositivo já registrado.");
    const now = new Date().toISOString();
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      // Never retarget a queued push to a different token after registration rotation.
      if (existing.token !== input.token)
        await tx.notification_deliveries.updateMany({
          where: { device_id: id, state: "pending" },
          data: {
            state: "suppressed",
            reason: "device_changed",
            updated_at: now,
          },
        });
      await tx.device_tokens.updateOne({
        where: { id },
        data: {
          token: input.token,
          platform: input.platform,
          active: true,
          updated_at: now,
        },
      });
    } else
      await tx.device_tokens.insertOne({
        data: {
          id,
          user: { id: userId },
          token: input.token,
          installation_id: input.installationId,
          platform: input.platform,
          active: true,
          created_at: now,
          updated_at: now,
        },
      });
    await audit(tx, userId, id, "notifications.device_registered");
    return {
      id,
      platform: input.platform,
      active: true,
      createdAt: existing?.created_at ?? now,
    };
  });
}
export async function removeDevice(
  db: DbClient,
  userId: string,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.users.findOne({
      select: { id: true },
      where: { id: userId },
      lock: true,
    });
    const row = await tx.device_tokens.findOne({
      select: { user_id: true },
      where: { id },
    });
    if (!row) throw new HttpNotFoundError();
    if (row.user_id !== userId) throw new HttpForbiddenError();
    const now = new Date().toISOString();
    // User lock serializes owner changes; lock deliveries before the device, as the worker does.
    // Accepted/in-flight notices retain their observation and uncertainty history.
    await tx.notification_deliveries.updateMany({
      where: { device_id: id, state: "pending" },
      data: { state: "suppressed", reason: "device_removed", updated_at: now },
    });
    await tx.device_tokens.updateOne({
      where: { id },
      data: { active: false, token: `removed:${id}`, updated_at: now },
    });
    await audit(tx, userId, id, "notifications.device_removed");
  });
}
export async function manualReminder(
  db: DbClient,
  userId: string,
  chargeId: string,
  clock = Date.now,
): Promise<{ queued: boolean }> {
  return db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(
      tx,
      userId,
      chargeId,
      true,
    );
    if (direction !== "receivable") throw new HttpForbiddenError();
    if (row.state !== "pending")
      throw new HttpConflictError("Cobrança encerrada.");
    const now = new Date(clock()).toISOString();
    if (
      await tx.outbox_events.count({
        where: {
          aggregate_id: chargeId,
          type: "charge.manual_reminder",
          created_at: { gt: new Date(clock() - 24 * 3600_000).toISOString() },
        },
      })
    ) {
      throw new HttpError(
        429,
        "Aguarde 24 horas antes de enviar outro lembrete.",
      );
    }
    await tx.outbox_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        type: "charge.manual_reminder",
        aggregate_type: "charge",
        aggregate_id: chargeId,
        payload: JSON.stringify({ chargeId }),
        state: "pending",
        attempts: 0,
        available_at: now,
        created_at: now,
        updated_at: now,
      },
    });
    await audit(
      tx,
      userId,
      chargeId,
      "notifications.manual_reminder_requested",
    );
    return { queued: true };
  });
}
export async function listDeliveries(
  db: DbClient,
  userId: string,
  chargeId: string,
): Promise<NotificationDelivery[]> {
  await findChargeForActor(db, userId, chargeId);
  const rows = await db.notification_deliveries.findMany({
    select: {
      id: true,
      channel: true,
      template: true,
      state: true,
      attempts: true,
      reason: true,
      updated_at: true,
    },
    where: { charge_id: chargeId },
    order: { created_at: Order.Desc },
    take: 100,
  });
  return rows.records.map((row) => ({
    id: row.id,
    channel: row.channel,
    template: row.template,
    state: row.state,
    attempts: row.attempts,
    reason: row.reason ?? null,
    updatedAt: row.updated_at,
  }));
}
