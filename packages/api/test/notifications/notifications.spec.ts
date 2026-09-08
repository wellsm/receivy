import { equal, ok, rejects } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { HttpConflictError, HttpForbiddenError } from "@ez4/gateway";
import { cleanupUsers, createUser, db } from "../fixtures/financial";
import { savePerson } from "../../src/people/repository";
import { savePaymentMethod } from "../../src/payment-methods/repository";
import { createExpense } from "../../src/expenses/repository";
import { cancelCharge } from "../../src/charges/repository";
import {
  createOrRotatePublicLink,
  revokePublicLink,
} from "../../src/public/repository";
import { notificationJobHandler } from "../../src/notifications/scheduler";
import { runNotifications } from "../../src/notifications/worker";
import {
  getPreferences,
  savePreferences,
  registerDevice,
  removeDevice,
  manualReminder,
  listDeliveries,
} from "../../src/notifications/repository";
import type { NotificationTransport } from "../../src/notifications/transport";
import { notificationTransport } from "../../src/notifications/transport";

const OWNER = "b1111111-1111-4111-8111-111111111111";
const DEBTOR = "b2222222-2222-4222-8222-222222222222";
const OTHER = "b3333333-3333-4333-8333-333333333333";
const start = Date.parse("2027-01-01T12:00:00Z");
const config = {
  publicOrigin: "https://receivy.example",
  secret: "notification-test-secret-with-enough-entropy",
};
let clock = start;
let count = 0;
let personId: string;
const emails: { to: string; key: string; text: string }[] = [];
const extraUsers: string[] = [];
async function recipient() {
  const id = crypto.randomUUID();
  extraUsers.push(id);
  await createUser(db, {
    id,
    email: `${id}@example.com`,
    name: "Device fixture",
  });
  return id;
}
const transport: NotificationTransport = {
  email: async (input) => {
    emails.push(input);
    return { status: "accepted", id: "email-test" };
  },
  push: async () => ({ status: "accepted", id: "ticket-test" }),
  receipt: async () => ({ status: "delivered" }),
};
async function charge() {
  personId = (
    await savePerson(db, OWNER, {
      name: `Recipient ${++count}`,
      email: `notify-${count}@example.com`,
    })
  ).id;
  const expense = await createExpense(db, OWNER, `notify-${count}`, {
    totalCents: 1234,
    installmentCount: 1,
    firstDueDate: "2027-01-04",
    split: {
      mode: "fixed",
      parts: [{ kind: "person", personId, amountCents: 1234 }],
    },
  });
  return expense.charges[0]!.id;
}
const run = (sender = transport) =>
  runNotifications(db, sender, config, () => clock);
describe("durable notification delivery", () => {
  before(async () => {
    const [row] = await db.rawQuery("SELECT current_database() AS name");
    equal(row?.["name"], "receivy_tests");
    await createUser(db, {
      id: OWNER,
      email: "notify-owner@example.com",
      name: "Owner",
    });
    await savePaymentMethod(db, OWNER, { pixKeyType: "email", pixKey: "notify-owner@example.com" });
    await createUser(db, {
      id: DEBTOR,
      email: "notify-debtor@example.com",
      name: "Debtor",
    });
    await createUser(db, {
      id: OTHER,
      email: "notify-other@example.com",
      name: "Other",
    });
  });
  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER, ...extraUsers]));
  it("consumes legacy minimal events once and never redirects old debt to edited contacts", async () => {
    const id = await charge();
    const original = `notify-${count}@example.com`;
    await db.outbox_events.updateMany({
      where: { aggregate_id: id, type: "charge.created" },
      data: { payload: JSON.stringify({ chargeId: id, source: "expense" }) },
    });
    await savePerson(
      db,
      OWNER,
      { name: "Edited", email: "redirect@example.com" },
      personId,
    );
    await Promise.all([run(), run()]);
    equal(
      emails.filter((e) => e.to === original).length,
      2,
      "one initial and one due -3 reminder",
    );
    equal(emails.filter((e) => e.to === "redirect@example.com").length, 0);
    const rows = await listDeliveries(db, OWNER, id);
    equal(rows.length, 2);
    ok(rows.every((row) => row.state === "accepted"));
    await rejects(() => listDeliveries(db, OTHER, id), HttpForbiddenError);
    const pending = await db.outbox_events.count({
      where: { aggregate_id: id, type: "charge.reminder", state: "pending" },
    });
    equal(pending, 2);
  });
  it("keeps disabled delivery observable without undoing the charge", async () => {
    const id = await charge();
    await run({ ...transport, email: async () => ({ status: "disabled" }) });
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "disabled",
      ),
    );
    equal(
      (await db.charges.findOne({ select: { state: true }, where: { id } }))
        ?.state,
      "pending",
    );
  });
  it("retries email with identical body/key and bounded backoff, suppressing revoked capabilities", async () => {
    const id = await charge();
    const attempted: { to: string; key: string; text: string }[] = [];
    await run({
      ...transport,
      email: async (input) => {
        attempted.push(input);
        return { status: "uncertain" };
      },
    });
    const beforeRetry = attempted.length;
    await run();
    equal(attempted.length, beforeRetry);
    clock += 61_000;
    await run({
      ...transport,
      email: async (input) => {
        attempted.push(input);
        return { status: "accepted", id: "retry" };
      },
    });
    equal(attempted[0]?.key, attempted[beforeRetry]?.key);
    equal(attempted[0]?.text, attempted[beforeRetry]?.text);
    const revoked = await charge();
    await run({ ...transport, email: async () => ({ status: "transient" }) });
    await revokePublicLink(db, OWNER, revoked);
    clock += 61_000;
    await run();
    ok(
      (await listDeliveries(db, OWNER, revoked)).every(
        (row) => row.state === "suppressed",
      ),
    );
    await cancelCharge(db, OWNER, id);
    clock = Date.parse("2027-01-04T12:00:00Z");
    await run();
    ok(
      (await listDeliveries(db, OWNER, id)).some(
        (row) => row.state === "suppressed",
      ),
    );
  });
  it("enforces ownership, preferences, registration removal and concurrent manual quota", async () => {
    const prefs = await getPreferences(db, DEBTOR);
    equal(prefs.emailEnabled, true);
    await savePreferences(db, DEBTOR, {
      emailEnabled: false,
      pushEnabled: true,
      reminderOffsets: [0],
    });
    equal(
      (await db.users.findOne({ select: { id: true }, where: { id: DEBTOR } }))
        ?.id,
      DEBTOR,
    );
    await savePreferences(db, DEBTOR, {
      emailEnabled: false,
      pushEnabled: true,
      reminderOffsets: [0],
    });
    equal(
      (await db.users.findOne({ select: { id: true }, where: { id: DEBTOR } }))
        ?.id,
      DEBTOR,
    );
    equal((await getPreferences(db, DEBTOR)).emailEnabled, false);
    const device = await registerDevice(db, DEBTOR, {
      token: "ExponentPushToken[notification-test]",
      platform: "ios",
      installationId: "fixture-device",
    });
    await rejects(() => removeDevice(db, OTHER, device.id), HttpForbiddenError);
    await removeDevice(db, DEBTOR, device.id);
    const id = await charge();
    await rejects(
      () => manualReminder(db, OTHER, id, () => clock),
      HttpForbiddenError,
    );
    const results = await Promise.allSettled([
      manualReminder(db, OWNER, id, () => clock),
      manualReminder(db, OWNER, id, () => clock),
    ]);
    equal(results.filter((result) => result.status === "fulfilled").length, 1);
  });
  it("persists Expo tickets, polls receipts, disables revoked tokens and falls back only on definite failure", async () => {
    clock = start;
    await savePreferences(db, DEBTOR, {
      emailEnabled: true,
      pushEnabled: true,
      reminderOffsets: [],
    });
    await registerDevice(db, DEBTOR, {
      token: "ExpoPushToken[notification-receipts]",
      platform: "android",
      installationId: "receipt-device",
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: {
        recipient_user: { id: DEBTOR },
        recipient_email_snapshot: "notify-debtor@example.com",
      },
    });
    let pushes = 0;
    let receipts = 0;
    const sender: NotificationTransport = {
      ...transport,
      push: async () => {
        pushes++;
        return { status: "accepted", id: `ticket-${pushes}` };
      },
      receipt: async () => {
        receipts++;
        return { status: "pending" };
      },
    };
    await run(sender);
    equal(pushes, 2);
    equal(receipts, 0);
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "accepted",
      ),
    );
    clock += 15 * 60_000;
    await run(sender);
    equal(pushes, 2);
    equal(receipts, 2);
    clock += 15 * 60_000;
    await run({
      ...sender,
      receipt: async () => ({ status: "device_unregistered" }),
    });
    await run();
    equal(pushes, 2);
    const rows = await listDeliveries(db, OWNER, id);
    equal(
      rows.filter((row) => row.channel === "email" && row.state === "accepted")
        .length,
      2,
    );
    equal(
      await db.device_tokens.count({
        where: { user_id: DEBTOR, active: true },
      }),
      0,
    );
  });
  it("does not resend uncertain pushes, recover a stale sending lease, or fallback beside an uncertain sibling", async () => {
    clock = start;
    await registerDevice(db, DEBTOR, {
      token: "ExpoPushToken[notification-uncertain]",
      platform: "ios",
      installationId: "uncertain-device",
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: {
        recipient_user: { id: DEBTOR },
        recipient_email_snapshot: "notify-debtor@example.com",
      },
    });
    let pushes = 0;
    await run({
      ...transport,
      push: async () => {
        pushes++;
        throw new Error("accepted but response lost");
      },
    });
    const rows = await listDeliveries(db, OWNER, id);
    ok(rows.every((row) => row.state === "uncertain"));
    const first = rows[0]!;
    await db.notification_deliveries.updateOne({
      where: { id: first.id },
      data: {
        state: "sending",
        lease_until: new Date(clock - 1).toISOString(),
      },
    });
    clock += 60_001;
    await run({
      ...transport,
      push: async () => {
        pushes++;
        return { status: "accepted", id: "must-not-send" };
      },
    });
    equal(pushes, 2);
    equal(
      (await listDeliveries(db, OWNER, id)).filter(
        (row) => row.channel === "email",
      ).length,
      0,
    );
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "uncertain",
      ),
    );
  });
  it("retains unsupported events without blocking eligible events and exposes the unsupported backlog", async () => {
    const id = await charge();
    const eventId = crypto.randomUUID();
    await db.outbox_events.insertOne({
      data: {
        id: eventId,
        type: "proof.accepted",
        aggregate_type: "charge",
        aggregate_id: id,
        payload: "{}",
        state: "pending",
        attempts: 0,
        available_at: "2020-01-01T00:00:00Z",
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
      },
    });
    const summary = await run();
    equal(summary.unsupportedPending, 1);
    equal(
      (
        await db.outbox_events.findOne({
          select: { state: true },
          where: { id: eventId },
        })
      )?.state,
      "pending",
    );
    ok((await listDeliveries(db, OWNER, id)).length > 0);
  });
  it("suppresses rotated pending bodies and refuses an email retry beyond the safe provider window", async () => {
    clock = start;
    const id = await charge();
    await run({ ...transport, email: async () => ({ status: "uncertain" }) });
    await createOrRotatePublicLink(
      db,
      OWNER,
      id,
      config.secret,
      true,
      Math.floor(clock / 1000),
    );
    clock += 61_000;
    await run();
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "suppressed",
      ),
    );
    const expired = await charge();
    await run({ ...transport, email: async () => ({ status: "uncertain" }) });
    clock += 23 * 3600_000;
    let attempts = 0;
    await run({
      ...transport,
      email: async () => {
        attempts++;
        return { status: "accepted", id: "unexpected" };
      },
    });
    equal(attempts, 0);
    ok(
      (await listDeliveries(db, OWNER, expired)).every(
        (row) => row.state === "uncertain",
      ),
    );
  });
  it("does not fallback when another device has an accepted ticket for the same notice", async () => {
    clock = start;
    await registerDevice(db, DEBTOR, {
      token: "ExpoPushToken[notification-sibling]",
      platform: "android",
      installationId: "sibling-device",
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: {
        recipient_user: { id: DEBTOR },
        recipient_email_snapshot: "notify-debtor@example.com",
      },
    });
    await run({
      ...transport,
      push: async (input) =>
        input.token.includes("sibling")
          ? { status: "device_unregistered" }
          : { status: "accepted", id: "accepted-sibling" },
    });
    const rows = await listDeliveries(db, OWNER, id);
    equal(rows.filter((row) => row.channel === "email").length, 0);
    ok(rows.some((row) => row.state === "accepted"));
    ok(rows.some((row) => row.state === "failed"));
  });
  it("runs the actual configured scheduler handler with explicit disabled delivery", async () => {
    const id = await charge();
    await db.outbox_events.updateMany({
      where: { aggregate_id: id, type: "charge.created" },
      data: { available_at: "2020-01-01T00:00:00Z" },
    });
    const context: Parameters<typeof notificationJobHandler>[1] = {
      db,
      variables: {
        APP_STAGE: "test",
        NOTIFICATION_EMAIL_TRANSPORT: "disabled",
        NOTIFICATION_PUSH_TRANSPORT: "disabled",
        EXPO_ACCESS_TOKEN: "disabled",
        RESEND_API_KEY: "disabled",
        RESEND_FROM_EMAIL: "disabled",
        PUBLIC_WEB_ORIGIN: config.publicOrigin,
        PUBLIC_LINK_HMAC_SECRET: config.secret,
      },
    };
    await notificationJobHandler(
      { requestId: "native-notification-job", event: null },
      context,
    );
    ok(
      (await listDeliveries(db, OWNER, id)).some(
        (row) => row.state === "disabled",
      ),
    );
  });
  it("routes new notices to configured email when push is disabled without replaying historical disabled push", async (test) => {
    clock = start;
    test.mock.method(Date, "now", () => clock);
    await registerDevice(db, DEBTOR, {
      token: "ExpoPushToken[configured-disabled-push]",
      platform: "ios",
      installationId: "configured-disabled-push",
    });
    const historicalId = await charge();
    const historicalEmail = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id: historicalId },
      data: { recipient_user: { id: DEBTOR } },
    });
    await run({
      email: async () => ({ status: "disabled" }),
      push: async () => ({ status: "disabled" }),
      receipt: async () => ({ status: "disabled" }),
    });
    ok(
      (await listDeliveries(db, OWNER, historicalId)).every(
        (row) => row.channel === "push" && row.state === "disabled",
      ),
    );

    const id = await charge();
    const email = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: DEBTOR } },
    });
    const submittedTo: string[] = [];
    test.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL | Request, init?: RequestInit) => {
        equal(
          String(url),
          "https://api.resend.com/emails",
          "disabled Expo must not be called",
        );
        const body = JSON.parse(String(init?.body)) as { to: string[] };
        submittedTo.push(...body.to);
        return Response.json({ id: "configured-email-fixture" });
      },
    );
    const context: Parameters<typeof notificationJobHandler>[1] = {
      db,
      variables: {
        APP_STAGE: "test",
        NOTIFICATION_EMAIL_TRANSPORT: "resend",
        NOTIFICATION_PUSH_TRANSPORT: "disabled",
        EXPO_ACCESS_TOKEN: "disabled",
        RESEND_API_KEY: "fictitious-native-key",
        RESEND_FROM_EMAIL: "fixture@example.invalid",
        PUBLIC_WEB_ORIGIN: config.publicOrigin,
        PUBLIC_LINK_HMAC_SECRET: config.secret,
      },
    };
    await notificationJobHandler(
      { requestId: "native-email-with-disabled-push", event: null },
      context,
    );
    equal(
      submittedTo.filter((to) => to === email).length,
      2,
      "initial and -3 reminder use enabled email",
    );
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.channel === "email" && row.state === "accepted",
      ),
    );
    equal(submittedTo.filter((to) => to === historicalEmail).length, 0);
    ok(
      (await listDeliveries(db, OWNER, historicalId)).every(
        (row) => row.channel === "push" && row.state === "disabled",
      ),
    );

    const disabledId = await charge();
    const disabledEmail = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id: disabledId },
      data: { recipient_user: { id: DEBTOR } },
    });
    await notificationJobHandler(
      { requestId: "native-both-providers-disabled", event: null },
      {
        ...context,
        variables: {
          ...context.variables,
          NOTIFICATION_EMAIL_TRANSPORT: "disabled",
        },
      },
    );
    equal(submittedTo.filter((to) => to === disabledEmail).length, 0);
    ok(
      (await listDeliveries(db, OWNER, disabledId)).every(
        (row) => row.state === "disabled",
      ),
    );
  });
  it("snapshots expense reminder defaults at charge creation, not at delayed worker execution", async () => {
    clock = start;
    await savePreferences(db, OWNER, {
      emailEnabled: true,
      pushEnabled: true,
      reminderOffsets: [0],
    });
    const id = await charge();
    await savePreferences(db, OWNER, {
      emailEnabled: true,
      pushEnabled: true,
      reminderOffsets: [-3, 0, 2],
    });
    await run();
    equal(
      (await listDeliveries(db, OWNER, id)).length,
      1,
      "only initial notice before the frozen due-day reminder",
    );
    equal(
      await db.outbox_events.count({
        where: { aggregate_id: id, type: "charge.reminder" },
      }),
      1,
    );
  });
  it("backs off exponentially then dead-letters definitive failures without touching the debt", async () => {
    clock = start;
    const id = await charge();
    let sent = 0;
    const sender: NotificationTransport = {
      ...transport,
      email: async () => {
        sent++;
        return { status: "transient" };
      },
    };
    await run(sender);
    equal(sent, 2);
    for (const delay of [60_000, 120_000, 240_000, 480_000]) {
      clock += delay - 1;
      const previous: number = sent;
      await run(sender);
      equal(sent, previous);
      clock += 1;
      await run(sender);
    }
    equal(sent, 10);
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "failed" && row.attempts === 5,
      ),
    );
    clock += 1000_000;
    await run(sender);
    equal(sent, 10);
    equal(
      (await db.charges.findOne({ select: { state: true }, where: { id } }))
        ?.state,
      "pending",
    );
    const raw = (
      await db.notification_deliveries.findMany({
        select: { render_inputs: true },
        where: { charge_id: id },
      })
    ).records;
    ok(
      raw.every((row) => !row.render_inputs.includes("/pay/")),
      "no complete capability or rendered body may be stored",
    );
  });
  it("keeps an accepted ticket uncertain after receipt HTTP 401 without submitting fallback email", async () => {
    clock = start;
    const userId = await recipient();
    await registerDevice(db, userId, {
      token: "ExpoPushToken[receipt-auth]",
      installationId: "receipt-auth",
      platform: "ios",
    });
    const id = await charge();
    const email = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } },
    });
    const submissions: string[] = [];
    const sender = notificationTransport(
      {
        NOTIFICATION_PUSH_TRANSPORT: "expo",
        NOTIFICATION_EMAIL_TRANSPORT: "resend",
        RESEND_API_KEY: "fake-key",
      },
      async (url, init) => {
        if (String(url).endsWith("/getReceipts"))
          return new Response(null, { status: 401 });
        if (String(url).endsWith("/send"))
          return Response.json({ data: { status: "ok", id: "auth-ticket" } });
        submissions.push(
          ...(JSON.parse(String(init?.body)) as { to: string[] }).to,
        );
        return Response.json({ id: "fake-email" });
      },
    );
    const execute = () =>
      runNotifications(
        db,
        sender,
        { ...config, from: "fixture@example.com" },
        () => clock,
      );
    await execute();
    const accepted = await listDeliveries(db, OWNER, id);
    equal(accepted.length, 2);
    ok(
      accepted.every(
        (row) => row.state === "accepted" && row.channel === "push",
      ),
    );
    clock += 15 * 60_000;
    await execute();
    await execute();
    equal(submissions.filter((to) => to === email).length, 0);
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "uncertain" && row.channel === "push",
      ),
    );
  });
  it("releases an explicitly removed token to a new account without transferring history or queued notices", async () => {
    clock = start;
    const accountA = await recipient();
    const accountB = await recipient();
    const input = {
      token: "ExpoPushToken[account-transfer]",
      installationId: "same-installation",
      platform: "ios" as const,
    };
    const oldDevice = await registerDevice(db, accountA, input);
    await rejects(() => registerDevice(db, accountB, input), HttpConflictError);
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: accountA } },
    });
    await run({ ...transport, push: async () => ({ status: "transient" }) });
    await removeDevice(db, accountA, oldDevice.id);
    const newDevice = await registerDevice(db, accountB, input);
    ok(newDevice.id !== oldDevice.id);
    await removeDevice(db, accountA, oldDevice.id);
    const current = await db.device_tokens.findOne({
      select: { user_id: true, token: true, active: true },
      where: { id: newDevice.id },
    });
    equal(current?.user_id, accountB);
    equal(current?.token, input.token);
    equal(current?.active, true);
    const old = await db.device_tokens.findOne({
      select: { user_id: true, active: true },
      where: { id: oldDevice.id },
    });
    equal(old?.user_id, accountA);
    equal(old?.active, false);
    const rows = await listDeliveries(db, OWNER, id);
    equal(rows.length, 2);
    ok(rows.every((row) => row.state === "suppressed"));
    equal(
      await db.notification_deliveries.count({
        where: { charge_id: id, device_id: oldDevice.id },
      }),
      2,
    );
    await rejects(() => registerDevice(db, accountA, input), HttpConflictError);
    await rejects(
      () => removeDevice(db, accountB, oldDevice.id),
      HttpForbiddenError,
    );
  });
  it("does not deactivate a rotated token when the old accepted ticket reports DeviceNotRegistered", async () => {
    clock = start;
    const userId = await recipient();
    const input = {
      token: "ExpoPushToken[old-registration]",
      installationId: "receipt-rotation",
      platform: "ios" as const,
    };
    const device = await registerDevice(db, userId, input);
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } },
    });
    await run();
    equal(
      (await listDeliveries(db, OWNER, id)).filter(
        (row) => row.state === "accepted",
      ).length,
      2,
    );
    const rotated = await registerDevice(db, userId, {
      ...input,
      token: "ExpoPushToken[new-registration]",
    });
    equal(rotated.id, device.id);
    clock += 15 * 60_000;
    await run({
      ...transport,
      receipt: async () => ({ status: "device_unregistered" }),
    });
    const current = await db.device_tokens.findOne({
      select: { active: true, token: true },
      where: { id: device.id },
    });
    equal(current?.token, "ExpoPushToken[new-registration]");
    equal(current?.active, true);
    ok(
      (await listDeliveries(db, OWNER, id))
        .filter((row) => row.channel === "push")
        .every((row) => row.state === "failed"),
    );
  });
  it("does not retarget a retry when registration rotates while its old submission is in flight", async () => {
    clock = start;
    const userId = await recipient();
    const input = {
      token: "ExpoPushToken[inflight-old]",
      installationId: "inflight-rotation",
      platform: "ios" as const,
    };
    await registerDevice(db, userId, input);
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } },
    });
    const attempted: string[] = [];
    const sender: NotificationTransport = {
      ...transport,
      push: async ({ token }) => {
        attempted.push(token);
        await registerDevice(db, userId, {
          ...input,
          token: "ExpoPushToken[inflight-new]",
        });
        return { status: "transient" };
      },
    };
    await run(sender);
    clock += 60_000;
    await run(sender);
    equal(
      attempted.filter((token) => token === "ExpoPushToken[inflight-new]")
        .length,
      0,
    );
    ok(
      (await listDeliveries(db, OWNER, id)).every(
        (row) => row.state === "suppressed",
      ),
    );
  });
});
