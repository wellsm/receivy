import type { Db, DbClient } from "../../src/database";
import { DatabaseTester } from "@ez4/local-database/test";

export const db = DatabaseTester.getClient<Db>("Db");

export async function createUser(client: DbClient, input: { id: string; email: string; name: string }) {
  const now = new Date().toISOString();
  await client.users.insertOne({ data: { id: input.id, email: input.email, verified_email: input.email,
    name: input.name, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL",
    created_at: now, updated_at: now } });
}

export async function cleanupUsers(client: DbClient, userIds: string[]) {
  const people = await client.people.findMany({ select: { id: true }, where: { owner_id: { isIn: userIds } } });
  const personIds = people.records.map(row => row.id);
  const expenses = await client.expenses.findMany({ select: { id: true }, where: { owner_id: { isIn: userIds } } });
  const expenseIds = expenses.records.map(row => row.id);
  const charges = await client.charges.findMany({ select: { id: true }, where: { OR: [
    { creditor_id: { isIn: userIds } }, { recipient_user_id: { isIn: userIds } },
  ] } });
  const chargeIds = charges.records.map(row => row.id);
  if (chargeIds.length) {
    await client.public_links.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.payments.deleteMany({ where: { charge_id: { isIn: chargeIds } } });
    await client.activity_events.deleteMany({ where: { aggregate_id: { isIn: chargeIds } } });
    await client.outbox_events.deleteMany({ where: { aggregate_id: { isIn: chargeIds } } });
    await client.charges.deleteMany({ where: { id: { isIn: chargeIds } } });
  }
  if (expenseIds.length) {
    await client.expense_allocations.deleteMany({ where: { expense_id: { isIn: expenseIds } } });
    await client.expenses.deleteMany({ where: { id: { isIn: expenseIds } } });
  }
  await client.payment_methods.deleteMany({ where: { owner_id: { isIn: userIds } } });
  if (personIds.length) {
    await client.person_contacts.deleteMany({ where: { person_id: { isIn: personIds } } });
    await client.people.deleteMany({ where: { id: { isIn: personIds } } });
  }
  await client.users.deleteMany({ where: { id: { isIn: userIds } } });
}
