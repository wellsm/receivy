import { deepEqual, equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  BillingFrequency,
  type BillingSplit,
  BillingType,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

/**
 * `charges.billing_type` is gone: the feed filters by type through the billing relation, which EZ4
 * compiles into a correlated EXISTS. A dropped clause would return every type instead of failing,
 * so each filtered call is asserted against the unfiltered one.
 */
const OWNER = 'b7777777-7777-4777-8777-777777777777';
const MONTH = '2026-01';
const TZ = 'America/Sao_Paulo';

const date = (value: string) => new Date(`${value}T12:00:00Z`);

describe('timeline type filter', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.name, 'receivy_tests');

    await createUser(db, {
      id: OWNER,
      email: 'timeline-type-owner@example.com',
      name: 'Dona'
    });

    const debtorId = (
      await ContactRepository.save(db, OWNER, {
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

    await BillingRepository.create(
      db,
      OWNER,
      'timeline-type-once',
      {
        type: BillingType.Once,
        totalCents: 5_000,
        description: 'Única',
        startDate: '2026-01-15',
        timezone: TZ,
        split
      },
      date('2026-01-01')
    );

    await BillingRepository.create(
      db,
      OWNER,
      'timeline-type-monthly',
      {
        type: BillingType.Indefinite,
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
  async function descriptions(type?: BillingType[]): Promise<string[]> {
    const page = await TimelineRepository.get(db, OWNER, {
      month: MONTH,
      ...(type ? { type } : {})
    });

    return [
      ...new Set(page.items.map((item) => item.charge.description))
    ].sort();
  }

  it('lists every type when no type filter is given', async () => {
    deepEqual(await descriptions(), ['Mensal', 'Única']);
  });

  it('keeps only the once billing', async () => {
    deepEqual(await descriptions([BillingType.Once]), ['Única']);
  });

  it('keeps only the indefinite billing', async () => {
    deepEqual(await descriptions([BillingType.Indefinite]), ['Mensal']);
  });

  it('serves the type on the item even though the charge no longer stores it', async () => {
    const page = await TimelineRepository.get(db, OWNER, {
      month: MONTH,
      type: [BillingType.Indefinite]
    });

    equal(page.items[0]?.charge.billingType, BillingType.Indefinite);
  });
});
