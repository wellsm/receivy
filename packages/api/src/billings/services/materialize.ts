import { HttpNotFoundError } from '@ez4/gateway';
import { BillingKind, BillingRecurrence, type BillingSplit, BillingState, ChargeState, calendarDate, planBillingCharges } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { markRegistered } from '../../charges/services/charge';
import { type PayableMaterialization, persistChargePlan, prepareChargeMaterialization } from '../../charges/services/materialize';
import { EventRepository } from '../../common/repositories/events';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { AccountRepository } from '../../users/repositories/account';
import { BillingRepository } from '../repositories/billing';
import { billingKind, billingRegistered } from '../utils/columns';
import { type BillingRow, counterpartIdOf, dueOccurrences, payableOf, userIds } from '../utils/split';
import { loadBilling } from './detail';
import { auditBilling, splitFor } from './split';

export type OccurrenceResult = {
  materialized: boolean;
  remaining: boolean;
  skipped?: string;
  noticeChargeIds: string[];
};

export type MaterializeDueResult = { materialized: boolean; skipped?: string };

/** Fresh result per call: `noticeChargeIds` is handed to callers that may append to it. */
const idleOccurrence = (): OccurrenceResult => ({ materialized: false, remaining: false, noticeChargeIds: [] });

/** The person on the other side of a charge planned for the whole total: the receiving contact, or the payer of the split. */
export async function chargeCounterpart(db: DbClient, ownerId: string, payable: PayableMaterialization | undefined, split: BillingSplit): Promise<string | undefined> {
  if (!payable) {
    return counterpartIdOf(split);
  }

  if (!payable.contactId) {
    return undefined;
  }

  // Read as it is stored: an archived contact must not block an unrelated edit.
  return (await ContactRepository.row(db, ownerId, payable.contactId))?.userId;
}

/** Settles one pending charge of a registro unless somebody reopened it; false when there was nothing to do. */
async function settleDueCharge(db: DbClient, billing: { ownerId: string; timezone: string }, chargeId: string, now: string): Promise<boolean> {
  // Whoever reopened it decided the money did not come in: only "Marcar como pago" settles it again.
  const reopened = await EventRepository.list(db, chargeId, 'charge.reopened', 1);

  if (reopened.length) {
    return false;
  }

  return db.transaction(async (tx) => {
    await AccountRepository.lock(tx, billing.ownerId);

    const row = await ChargeRepository.get(tx, chargeId, true);

    if (!row || row.state !== ChargeState.Pending) {
      return false;
    }

    await markRegistered(tx, row, billing.timezone, now);

    return true;
  });
}

/** Materializes a single occurrence; the caller announces the charges once the transaction commits. */
export async function materializeNextOccurrence(db: DbClient, billingId: string, now = new Date()): Promise<OccurrenceResult> {
  const ownerId = await BillingRepository.ownerOf(db, billingId);

  if (!ownerId) {
    return idleOccurrence();
  }

  try {
    return await db.transaction(async (tx) => {
      await AccountRepository.lock(tx, ownerId);

      const row = await loadBilling(tx, ownerId, billingId, true);
      const [dueDate, ...rest] = dueOccurrences(row, now, 2);

      if (!dueDate) {
        return idleOccurrence();
      }

      const instant = now.toISOString();
      const noticeChargeIds: string[] = [];
      const exists = (await ChargeRepository.byBilling(tx, row.id, { dueDate })).length > 0;

      if (!exists) {
        noticeChargeIds.push(...(await materializeOccurrence(tx, row, dueDate, instant)));

        await auditBilling(tx, row.owner_id, row.id, 'billing.materialized', instant, { dueDate });
      }

      await BillingRepository.update(tx, row.id, { lastOccurrenceDate: dueDate }, instant);

      return { materialized: !exists, remaining: rest.length > 0, noticeChargeIds };
    });
  } catch (error) {
    // An archived recipient/Pix is not transient: retrying it would only burn the queue attempts.
    if (!(error instanceof HttpNotFoundError)) {
      throw error;
    }

    const reason = error.message || 'unavailable';

    await db.transaction(async (tx) => {
      await auditBilling(tx, ownerId, billingId, 'billing.materialization_skipped', now.toISOString(), { reason });
    });

    return { ...idleOccurrence(), skipped: reason };
  }
}

/** One occurrence of an assinatura: the charges of `dueDate`, planned from the stored split. */
async function materializeOccurrence(tx: DbClient, row: BillingRow, dueDate: string, instant: string): Promise<string[]> {
  const { split } = await splitFor(tx, row);
  const payable = payableOf(row);
  const counterpartId = await chargeCounterpart(tx, row.owner_id, payable, split);
  const counterparts = payable ? (counterpartId ? [counterpartId] : []) : userIds(split);
  const context = await prepareChargeMaterialization(tx, row.owner_id, counterparts, row.payment_method_id, payable);
  const plan = planBillingCharges({
    description: row.description,
    totalCents: row.total_cents,
    split,
    dueDates: [dueDate],
    numbered: false,
    payer: context.payer,
    payeeUserId: counterpartId ?? null,
    settled: billingRegistered(row)
  });
  const persisted = await persistChargePlan(
    tx,
    row.owner_id,
    plan,
    { id: row.id, type: BillingRecurrence.Indefinite, kind: billingKind(row), timezone: row.timezone },
    context,
    instant
  );

  return persisted.noticeChargeIds;
}

/** Materializes every occurrence already due and announces the charges; `skipped` names an owner-side blocker. */
export async function materializeDue(db: DbClient, billingId: string, notice?: NoticeContext, now = new Date()): Promise<MaterializeDueResult> {
  let materialized = false;
  let result = await materializeNextOccurrence(db, billingId, now);

  while (result.materialized) {
    materialized = true;

    if (notice) {
      await announceCharges(db, notice, result.noticeChargeIds, now.getTime());
    }

    if (!result.remaining) {
      break;
    }

    result = await materializeNextOccurrence(db, billingId, now);
  }

  return { materialized, ...(result.skipped ? { skipped: result.skipped } : {}) };
}

/** The daily sweep: every active assinatura gets its due occurrences; the count is what was created. */
export async function materializeDueBillings(db: DbClient, notice?: NoticeContext, now = new Date()): Promise<number> {
  const ids = await BillingRepository.activeIndefiniteIds(db, BillingRecurrence.Indefinite, BillingState.Active);

  let materialized = 0;

  for (const id of ids) {
    try {
      if ((await materializeDue(db, id, notice, now)).materialized) {
        materialized++;
      }
    } catch (error) {
      // One broken billing must not stop the others; it is retried tomorrow.
      console.error('Billing materialization failed', { billingId: id, error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  return materialized;
}

/**
 * The daily settlement of registros: every pending charge of a settled billing due by today, in its timezone, is
 * paid on its due date. Runs after `materializeDueBillings`; idempotent. Returns how many charges it settled.
 */
export async function settleRegistered(db: DbClient, now = new Date()): Promise<number> {
  const registros = await BillingRepository.ofKind(db, BillingKind.Record);
  const instant = now.toISOString();
  // The sweep spans every account, so timezones are read once per owner instead of once per billing.
  const timezones = new Map<string, string>();

  let settled = 0;

  for (const billing of registros) {
    let timezone = timezones.get(billing.ownerId);

    if (!timezone) {
      timezone = await AccountRepository.timezone(db, billing.ownerId);
      timezones.set(billing.ownerId, timezone);
    }

    const due = await ChargeRepository.byBilling(db, billing.id, { state: ChargeState.Pending, dueThrough: calendarDate(now, timezone) });

    for (const charge of due) {
      try {
        if (await settleDueCharge(db, { ownerId: billing.ownerId, timezone }, charge.id, instant)) {
          settled++;
        }
      } catch (error) {
        // One broken charge must not stop the others; tomorrow's run tries again.
        console.error('Registro settlement failed', { chargeId: charge.id, error: error instanceof Error ? error.message : 'unknown' });
      }
    }
  }

  return settled;
}
