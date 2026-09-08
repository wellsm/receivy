import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { BillingPlan, BillingType, PaymentMethod } from '@receivy/common';
import { lockAccountReferences } from '../account/locking';
import type { DbClient } from '../database';
import { CHARGE_SELECT, type ChargeRow } from './repository';

export type ChargeRecipientMaterialization = { personId: string; name: string; email?: string; linkedUserId?: string };

export type ChargeMaterializationContext = {
  recipients: Map<string, ChargeRecipientMaterialization>;
  pix: { keyType: PaymentMethod['pixKeyType']; key: string; label: string } | null;
};

export type ChargeBillingRef = { id: string; type: BillingType };

/** All billing mutations share this lock order: owner → billing → people → Pix. */
export async function lockOwner(db: DbClient, ownerId: string): Promise<void> {
  await lockAccountReferences(db, 'write');

  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });

  if (!owner) {
    throw new HttpUnauthorizedError();
  }
}

async function recipientSnapshots(
  db: DbClient,
  ownerId: string,
  personIds: string[]
): Promise<Map<string, ChargeRecipientMaterialization>> {
  const result = new Map<string, ChargeRecipientMaterialization>();

  for (const personId of new Set(personIds)) {
    const row = await db.people.findOne({
      select: { id: true, owner_id: true, linked_user_id: true, name: true, active_email: true, archived_at: true },
      where: { id: personId, owner_id: ownerId },
      lock: true
    });

    if (!row || row.archived_at) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    result.set(personId, { personId: row.id, name: row.name, email: row.active_email, linkedUserId: row.linked_user_id });
  }

  return result;
}

async function pixSnapshot(db: DbClient, ownerId: string, paymentMethodId?: string): Promise<ChargeMaterializationContext['pix']> {
  if (paymentMethodId) {
    const row = await db.payment_methods.findOne({
      select: { pix_key_type: true, pix_key: true, label: true, archived_at: true },
      where: { id: paymentMethodId, owner_id: ownerId },
      lock: true
    });

    if (!row || row.archived_at) {
      throw new HttpNotFoundError('Chave Pix indisponível.');
    }

    return { keyType: row.pix_key_type, key: row.pix_key, label: row.label };
  }

  const { records } = await db.payment_methods.findMany({
    select: { pix_key_type: true, pix_key: true, label: true },
    where: { owner_id: ownerId, is_default: true, archived_at: { isNull: true } },
    take: 1
  });

  const row = records[0];

  return row ? { keyType: row.pix_key_type, key: row.pix_key, label: row.label } : null;
}

/** Validates owner-scoped people/payment method and captures values before materialization. */
export async function prepareChargeMaterialization(
  db: DbClient,
  ownerId: string,
  personIds: string[],
  paymentMethodId?: string
): Promise<ChargeMaterializationContext> {
  return { recipients: await recipientSnapshots(db, ownerId, personIds), pix: await pixSnapshot(db, ownerId, paymentMethodId) };
}

async function recordCreation(db: DbClient, ownerId: string, row: ChargeRow, recipient: ChargeRecipientMaterialization, now: string) {
  const payload = JSON.stringify({ chargeId: row.id, billingId: row.billing_id });
  const subjects = new Set([ownerId, ...(recipient.linkedUserId ? [recipient.linkedUserId] : [])]);

  for (const subjectId of subjects) {
    await db.activity_events.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        actor_user: { id: ownerId },
        subject_user: { id: subjectId },
        type: 'charge.created',
        aggregate_type: 'charge',
        aggregate_id: row.id,
        payload,
        created_at: now
      }
    });
  }

  await db.outbox_events.insertOne({
    select: { id: true },
    data: {
      id: crypto.randomUUID(),
      type: 'charge.created',
      aggregate_type: 'charge',
      aggregate_id: row.id,
      ...(recipient.linkedUserId ? { recipient_user: { id: recipient.linkedUserId } } : {}),
      ...(recipient.email ? { recipient_email: recipient.email } : {}),
      payload,
      state: 'pending',
      attempts: 0,
      available_at: now,
      created_at: now,
      updated_at: now
    }
  });
}

/** Shared persistence seam for every billing type. Caller owns the transaction. */
export async function persistChargePlan(
  db: DbClient,
  ownerId: string,
  plan: BillingPlan,
  billing: ChargeBillingRef,
  context: ChargeMaterializationContext,
  now: string
): Promise<ChargeRow[]> {
  const rows: ChargeRow[] = [];

  for (const item of plan.charges) {
    const recipient = context.recipients.get(item.personId);

    if (!recipient) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    const row = await db.charges.insertOne({
      select: CHARGE_SELECT,
      data: {
        id: crypto.randomUUID(),
        creditor: { id: ownerId },
        debtor_person: { id: recipient.personId },
        ...(recipient.linkedUserId ? { recipient_user: { id: recipient.linkedUserId } } : {}),
        recipient_name_snapshot: recipient.name,
        ...(recipient.email ? { recipient_email_snapshot: recipient.email } : {}),
        billing: { id: billing.id },
        billing_type: billing.type,
        description: item.description,
        amount_cents: item.amountCents,
        currency: item.currency,
        due_date: item.dueDate,
        ...(item.installment !== null && item.installmentCount !== null
          ? { installment: item.installment, installment_count: item.installmentCount }
          : {}),
        ...(context.pix
          ? { pix_key_type_snapshot: context.pix.keyType, pix_key_snapshot: context.pix.key, pix_label_snapshot: context.pix.label }
          : {}),
        state: 'pending',
        created_at: now,
        updated_at: now
      }
    });

    rows.push(row);

    await recordCreation(db, ownerId, row, recipient, now);
  }

  return rows;
}
