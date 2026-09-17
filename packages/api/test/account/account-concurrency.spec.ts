import { deepEqual, equal, ok } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import type { DbClient } from '../../src/database';
import { eraseAccount } from '../../src/users/services/deletion';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Instrument scheduling only: every query and transaction is the real DatabaseTester client. */
function observeTransactions(client: DbClient, decorate: (tx: DbClient) => Promise<DbClient>): DbClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return (run: (tx: DbClient) => Promise<unknown>) => target.transaction(async (tx) => run(await decorate(tx)));
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

async function pid(tx: DbClient) {
  const [row] = await tx.rawQuery('SELECT pg_backend_pid() AS pid');
  ok(typeof row?.pid === 'number');
  return row.pid;
}

async function waitBlocked(observer: DbClient, blocked: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await observer.rawQuery('SELECT :blocker::int = ANY(pg_blocking_pids(:blocked::int)) AS blocked', { blocked, blocker });
    if (row?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock wait was not observed');
}

const users: string[] = [];
describe('account erasure versus cross-account materialization', () => {
  before(async () => {
    const [row] = await db.rawQuery('SELECT current_database() AS name');
    equal(row?.name, 'receivy_tests');
  });
  after(async () => cleanupUsers(db, users));

  for (const first of ['materialization', 'erasure'] as const) {
    it(`${first} first: no FK/person deadlock and no charge missed by erasure`, async () => {
      const creditor = crypto.randomUUID();
      const recipient = crypto.randomUUID();
      users.push(creditor, recipient);
      await createUser(db, { id: creditor, email: `${creditor}@example.com`, name: 'Creditor fixture' });
      await createUser(db, { id: recipient, email: `${recipient}@example.com`, name: 'Recipient fixture' });
      const contact = await ContactRepository.save(db, creditor, { name: 'Recipient fixture', email: `${recipient}@example.com` });
      equal(contact.userId, recipient);
      const entered = deferred<{ backend: number; tx: DbClient }>();
      const release = deferred<void>();
      const other = deferred<number>();
      let paused = false;
      const firstClient = observeTransactions(db, async (tx) => {
        const backend = await pid(tx);
        return new Proxy(tx, {
          get(target, property, receiver) {
            if (property === (first === 'materialization' ? 'contacts' : 'users')) {
              const table = first === 'materialization' ? target.contacts : target.users;
              return new Proxy(table, {
                get(relation, operation, relationReceiver) {
                  if (operation === 'findOne')
                    return async (...args: unknown[]) => {
                      const row = await Reflect.apply(Reflect.get(relation, operation, relationReceiver), relation, args);
                      const query = args[0] as { lock?: boolean; where?: { id?: string; user_id?: string } };
                      const locked = first === 'materialization' ? query.where?.user_id : query.where?.id;
                      if (!paused && query.lock && locked === recipient) {
                        paused = true;
                        entered.resolve({ backend, tx });
                        await release.promise;
                      }
                      return row;
                    };
                  return Reflect.get(relation, operation, relationReceiver);
                }
              });
            }
            return Reflect.get(target, property, receiver);
          }
        });
      });
      const secondClient = observeTransactions(db, async (tx) => {
        other.resolve(await pid(tx));
        return tx;
      });
      const materialize = (client: DbClient) =>
        createOnceCharge(client, creditor, `concurrent-${recipient}`, { userId: recipient, amountCents: 1234, dueDate: '2026-10-01' });
      const firstRun = first === 'materialization' ? materialize(firstClient) : eraseAccount(firstClient, recipient, 'EXCLUIR');
      const firstStarted = await entered.promise;
      const secondRun = first === 'materialization' ? eraseAccount(secondClient, recipient, 'EXCLUIR') : materialize(secondClient);
      const completed = Promise.allSettled([firstRun, secondRun]);
      try {
        await waitBlocked(firstStarted.tx, await other.promise, firstStarted.backend);
      } finally {
        release.resolve();
      }
      const outcomes = await completed;
      if (first === 'materialization') {
        deepEqual(
          outcomes.map((result) => result.status),
          ['fulfilled', 'fulfilled'],
          outcomes
            .filter((result) => result.status === 'rejected')
            .map((result) => String(result.reason))
            .join('; ')
        );
      } else {
        equal(outcomes[0].status, 'fulfilled');
        equal(outcomes[1].status, 'rejected', 'archived recipient prevents a new post-erasure charge');
      }
      const charges = await db.charges.findMany({
        select: { amount_cents: true, state: true, debtor_id: true },
        where: { owner_id: creditor }
      });
      equal(charges.records.length, first === 'materialization' ? 1 : 0);
      for (const charge of charges.records) {
        equal(charge.amount_cents, 1234);
        equal(charge.state, 'pending');
        equal(charge.debtor_id, recipient, 'the erased account keeps its id on the charge');
      }
    });
  }
});
