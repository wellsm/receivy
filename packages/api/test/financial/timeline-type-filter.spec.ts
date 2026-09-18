import { deepEqual, equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  BillingFrequency,
  type BillingSplit,
  BillingRecurrence,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { createBilling } from '../../src/billings/services/billing';
import { cleanupUsers, contacts, createUser, db, monthCharges } from '../fixtures/financial';

/**
 * `charges.billing_type` is gone: the month list carries the type through the billing relation, and
 * the feed filters on it locally. A dropped join would leave every item typeless instead of failing,
 * so each filtered read is asserted against the unfiltered one.
 */
const OWNER = 'b7777777-7777-4777-8777-777777777777';
const MONTH = '2026-01';
const TZ = 'America/Sao_Paulo';

const date = (value: string) => new Date(`${value}T12:00:00Z`);

describe('month list recurrence', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.name, 'receivy_tests');

    await createUser(db, {
      id: OWNER,
      email: 'timeline-type-owner@example.com',
      name: 'Dona'
    });

    const debtorId = (
      await contacts.save(OWNER, {
        name: 'Bruno',
        email: 'timeline-type-debtor@example.com'
      })
    ).userId;

    const split: BillingSplit = {
      mode: SplitMode.Fixed,
      parts: [
        { kind: SplitPartKind.User, userId: debtorId, amountCents: 5_000 }
      ]
    };

    await createBilling(
      db,
      OWNER,
      'timeline-type-once',
      {
        recurrence: BillingRecurrence.Once,
        totalCents: 5_000,
        description: 'Única',
        startDate: '2026-01-15',
        timezone: TZ,
        split
      },
      date('2026-01-01')
    );

    await createBilling(
      db,
      OWNER,
      'timeline-type-monthly',
      {
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        totalCents: 5_000,
        description: 'Mensal',
        startDate: '2026-01-20',
        timezone: TZ,
        split
      },
      date('2026-01-01')
    );
  });

  after(async () => cleanupUsers(db, [OWNER]));

  /** Descriptions of the month's items, deduplicated so an extra occurrence cannot change the assertion. */
  async function descriptions(recurrence?: BillingRecurrence): Promise<string[]> {
    const items = (await monthCharges(db, OWNER, MONTH)).filter((item) => !recurrence || item.billing.recurrence === recurrence);

    return [...new Set(items.map((item) => item.description))].sort();
  }

  it('lists every type when nothing narrows the month', async () => {
    deepEqual(await descriptions(), ['Mensal', 'Única']);
  });

  it('keeps only the once billing', async () => {
    deepEqual(await descriptions(BillingRecurrence.Once), ['Única']);
  });

  it('keeps only the indefinite billing', async () => {
    deepEqual(await descriptions(BillingRecurrence.Indefinite), ['Mensal']);
  });

  it('serves the type on the item even though the charge no longer stores it', async () => {
    const items = await monthCharges(db, OWNER, MONTH);

    equal(items.find((item) => item.description === 'Mensal')?.billing.recurrence, BillingRecurrence.Indefinite);
  });
});
