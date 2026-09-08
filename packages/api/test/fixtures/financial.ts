import { DatabaseTester } from '@ez4/local-database/test';
import { createBilling } from '../../src/billings/repository';
import type { Db, DbClient } from '../../src/database';

export const db = DatabaseTester.getClient<Db>('Db');

export async function createUser(client: DbClient, input: { id: string; email: string; name: string }) {
  const now = new Date().toISOString();
  await client.users.insertOne({
    data: {
      id: input.id,
      email: input.email,
      verified_email: input.email,
      name: input.name,
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      country: 'BR',
      currency: 'BRL',
      created_at: now,
      updated_at: now
    }
  });
}

export async function cleanupUsers(client: DbClient, userIds: string[]) {
  const people = await client.people.findMany({ select: { id: true }, where: { owner_id: { isIn: userIds } } });
  const personIds = people.records.map((row) => row.id);
  const billings = await client.billings.findMany({ select: { id: true }, where: { owner_id: { isIn: userIds } } });
  const billingIds = billings.records.map((row) => row.id);
  const charges = await client.charges.findMany({
    select: { id: true },
    where: { OR: [{ creditor_id: { isIn: userIds } }, { recipient_user_id: { isIn: userIds } }] }
  });
  const chargeIds = charges.records.map((row) => row.id);
  if (chargeIds.length) {
    await client.notification_deliveries.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.public_links.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.payments.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.payment_proofs.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.upload_intents.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.activity_events.deleteMany({ where: { aggregate_id: { isIn: chargeIds } } });
    await client.outbox_events.deleteMany({ where: { aggregate_id: { isIn: chargeIds } } });
    await client.charges.deleteMany({ where: { id: { isIn: chargeIds } } });
  }
  if (billingIds.length) {
    await client.allocations.deleteMany({ where: { billing_id: { isIn: billingIds } } });
    await client.activity_events.deleteMany({ where: { aggregate_id: { isIn: billingIds } } });
    await client.billings.deleteMany({ where: { id: { isIn: billingIds } } });
  }
  await client.payment_methods.deleteMany({ where: { owner_id: { isIn: userIds } } });
  if (personIds.length) {
    await client.person_contacts.deleteMany({ where: { person_id: { isIn: personIds } } });
    await client.people.deleteMany({ where: { id: { isIn: personIds } } });
  }
  await client.device_tokens.deleteMany({ where: { user_id: { isIn: userIds } } });
  await client.activity_events.deleteMany({ where: { subject_user_id: { isIn: userIds } } });
  await client.users.deleteMany({ where: { id: { isIn: userIds } } });
}

/** One-off charge for one person; the most common fixture in proof, notification and account specs. */
export async function createOnceCharge(
  client: DbClient,
  ownerId: string,
  key: string,
  input: { personId: string; amountCents: number; dueDate: string; paymentMethodId?: string }
) {
  const billing = await createBilling(client, ownerId, key, {
    type: 'once',
    totalCents: input.amountCents,
    startDate: input.dueDate,
    timezone: 'America/Sao_Paulo',
    paymentMethodId: input.paymentMethodId,
    split: { mode: 'fixed', parts: [{ kind: 'person', personId: input.personId, amountCents: input.amountCents }] }
  });

  return { billing, chargeId: billing.charges[0]!.id };
}
