import type { Service } from '@ez4/common';
import { DatabaseTester } from '@ez4/local-database/test';
import { BillingRecurrence, type ListCharge, SplitMode, SplitPartKind, UserStatus } from '@receivy/common';
import { createBilling } from '../../src/billings/services/billing';
import { listChargesHandler } from '../../src/charges/endpoints/list';
import { type ChargeService, createService as createChargeService } from '../../src/charges/services/charge';
import { type ContactService, createService as createContactService } from '../../src/contacts/services/contact';
import { createService as createPaymentMethodService, type PaymentMethodService } from '../../src/payment-methods/services/payment-method';
import type { Db, DbClient } from '../../src/database';
import type { NoticeContext } from '../../src/notifications/services/send';

export const db = DatabaseTester.getClient<Db>('Db');

/** The factories the handlers use, built on the test database, so tests go through the same services. */
export const paymentMethods = createPaymentMethodService({ db } as Service.Context<PaymentMethodService>);
export const contacts = createContactService({ db } as Service.Context<ContactService>);
export const charges = createChargeService({ db } as Service.Context<ChargeService>);

export async function createUser(client: DbClient, input: { id: string; email: string; name: string; status?: UserStatus }) {
  const now = new Date().toISOString();

  await client.users.insertOne({
    data: {
      id: input.id,
      email: input.email,
      verified_email: input.email,
      name: input.name,
      status: input.status ?? UserStatus.Active,
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
  // Pending accounts created on behalf of these owners' contacts leave with them, once nothing references them.
  const owned = await client.contacts.findMany({ select: { user_id: true }, where: { owner_id: { isIn: userIds } } });
  const pending = await client.users.findMany({
    select: { id: true },
    where: {
      id: { isIn: [...new Set(owned.records.map((row) => row.user_id))].filter((id) => !userIds.includes(id)) },
      status: UserStatus.Pending
    }
  });
  const pendingIds = pending.records.map((row) => row.id);
  const billings = await client.billings.findMany({ select: { id: true }, where: { owner_id: { isIn: userIds } } });
  const billingIds = billings.records.map((row) => row.id);
  const charges = await client.charges.findMany({
    select: { id: true },
    where: { OR: [{ owner_id: { isIn: userIds } }, { creditor_id: { isIn: userIds } }, { debtor_id: { isIn: userIds } }] }
  });
  const chargeIds = charges.records.map((row) => row.id);

  if (chargeIds.length) {
    await client.events.deleteMany({ where: { eventable_id: { isIn: chargeIds } } });
    await client.proofs.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.links.deleteMany({ where: { linkable_id: { isIn: chargeIds } } });
    await client.charges.deleteMany({ where: { id: { isIn: chargeIds } } });
  }
  if (billingIds.length) {
    await client.links.deleteMany({ where: { linkable_id: { isIn: billingIds } } });
    await client.billing_guests.deleteMany({ where: { billing_id: { isIn: billingIds } } });
    await client.allocations.deleteMany({ where: { billing_id: { isIn: billingIds } } });
    await client.events.deleteMany({ where: { eventable_id: { isIn: billingIds } } });
    await client.billings.deleteMany({ where: { id: { isIn: billingIds } } });
  }

  await client.billing_guests.deleteMany({ where: { OR: [{ owner_id: { isIn: userIds } }, { user_id: { isIn: userIds } }] } });
  await client.payment_methods.deleteMany({ where: { owner_id: { isIn: userIds } } });
  await client.contacts.deleteMany({ where: { OR: [{ owner_id: { isIn: userIds } }, { user_id: { isIn: userIds } }] } });
  await client.device_tokens.deleteMany({ where: { user_id: { isIn: userIds } } });
  await client.events.deleteMany({ where: { OR: [{ actor_user_id: { isIn: userIds } }, { eventable_id: { isIn: userIds } }] } });
  await client.users.deleteMany({ where: { id: { isIn: userIds } } });

  if (pendingIds.length) {
    await cleanupUsers(client, pendingIds);
  }
}

/** One-off charge for one person; the most common fixture in proof, notification and account specs. */
export async function createOnceCharge(
  client: DbClient,
  ownerId: string,
  key: string,
  input: { userId: string; amountCents: number; dueDate: string; paymentMethodId?: string },
  notice?: NoticeContext
) {
  const billing = await createBilling(
    client,
    ownerId,
    key,
    {
      recurrence: BillingRecurrence.Once,
      totalCents: input.amountCents,
      startDate: input.dueDate,
      timezone: 'America/Sao_Paulo',
      paymentMethodId: input.paymentMethodId,
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: input.userId, amountCents: input.amountCents }] }
    },
    new Date(),
    undefined,
    notice
  );

  return { billing, chargeId: billing.charges[0]!.id };
}

/** The month as `GET /charges` answers it for `userId`: the handler shapes the rows, so tests read what the clients read. */
export async function monthCharges(client: DbClient, userId: string, month: string): Promise<ListCharge> {
  const context = { db: client } as Parameters<typeof listChargesHandler>[1];
  const response = await listChargesHandler({ identity: { userId, familyId: 'test' }, query: { month } }, context);

  return response.body;
}
