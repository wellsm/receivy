import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpNotFoundError } from '@ez4/gateway';
import {
  addCalendarDays,
  type BillingDetail,
  BillingCategory,
  BillingDueRule,
  type BillingGuestAction,
  type BillingInput,
  BillingKind,
  type BillingPatch,
  BillingRecurrence,
  BillingState,
  type BillingsPage,
  billingDates,
  billingDueDates,
  calendarDate,
  ChargePayer,
  ChargeState,
  Direction,
  EditScope,
  endOfMonth,
  normalizeBillingInput,
  PendingChargesAction,
  planBillingCharges
} from '@receivy/common';
import { SilenceUnavailableError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { type PayableMaterialization, persistChargePlan, prepareChargeMaterialization } from '../../charges/services/materialize';
import { counterpartId as chargeCounterpartId } from '../../charges/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { EmailService } from '../../common/services/email/service';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { Db, DbClient } from '../../database';
import type { InviteLinkContext } from '../../invites/services/links';
import type { ChargeNotifyScheduler } from '../../notifications/schedulers/charge-notify';
import { noticeContext } from '../../notifications/services/context';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { PaymentMethodRepository } from '../../payment-methods/repositories/payment-method';
import { ProofRepository } from '../../proofs/repositories/proof';
import { StoredProofState } from '../../charges/schemas/charge';
import { AccountRepository } from '../../users/repositories/account';
import { IdempotencyMismatchError } from '../errors';
import { AllocationRepository } from '../repositories/allocation';
import { BillingRepository } from '../repositories/billing';
import { billingDirection, billingKind, billingRegistered } from '../utils/columns';
import { inviteLink } from '../utils/context';
import { type MonthCharge, monthChanges } from '../utils/month-scope';
import { assertPatchAllowed, participantNotifyEvent, rescheduledCursor, touchesCharges } from '../utils/patch';
import { billingRequestFingerprint } from '../utils/request';
import { type BillingRow, billingInputFrom, calendarRule, counterpartIdOf, payableOf, userIds } from '../utils/split';
import { billingDetail, getBilling, listBillings, loadBilling } from './detail';
import { resolveGuest } from './guests';
import { chargeCounterpart, materializeDue } from './materialize';
import { auditBilling, saveAllocations, setPendingChargesNotify, splitFor } from './split';

export type BillingClient = {
  create(ownerId: string, key: string, input: BillingInput): Promise<BillingDetail>;
  get(ownerId: string, id: string): Promise<BillingDetail>;
  list(ownerId: string, filters: { type?: Direction; cursor?: string; search?: string }): Promise<BillingsPage>;
  patch(ownerId: string, id: string, patch: BillingPatch): Promise<BillingDetail>;
  setParticipantNotify(ownerId: string, id: string, userId: string, notify: boolean): Promise<BillingDetail>;
  resolveGuest(ownerId: string, id: string, guestId: string, action: BillingGuestAction): Promise<BillingDetail>;
};

export declare class BillingService extends Factory.Service<BillingClient> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PAYMENT_METHOD_LINK: Environment.VariableOrValue<'PAYMENT_METHOD_LINK', 'disabled'>;
    PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };

  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    chargeNotifyScheduler: Environment.Service<ChargeNotifyScheduler>;
    variables: Environment.ServiceVariables;
  };
}

const enum ChargeCancelReason {
  BillingPaused = 'billing_paused',
  BillingEnded = 'billing_ended',
  BillingEdited = 'billing_edited'
}

/** A conta a pagar may only point at a key filed under the contact who receives it. */
async function assertContactKey(db: DbClient, ownerId: string, contactId: string, paymentMethodId: string): Promise<void> {
  const keys = await PaymentMethodRepository.list(db, ownerId, contactId);

  if (!keys.some((key) => key.id === paymentMethodId)) {
    throw new HttpNotFoundError('Chave Pix indisponível.');
  }
}

function recordCharge(db: DbClient, chargeId: string, actorId: string, type: string, now: string, payload?: Record<string, unknown>) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, actorId, payload, at: now });
}

async function cancelPendingCharges(db: DbClient, ownerId: string, billingId: string, now: string, reason: ChargeCancelReason, after?: string): Promise<void> {
  const pending = await ChargeRepository.byBilling(db, billingId, { state: ChargeState.Pending, dueAfter: after, lock: true });

  for (const row of pending) {
    // Mass cancel: no provider inactivation here, only the individual cancel does that
    // (limitation recorded in docs/notifications.md).
    await ChargeRepository.markCancelled(db, row.id, now);
    await recordCharge(db, row.id, ownerId, 'charge.cancelled', now, { reason });
  }
}

/**
 * Pausar never cancels unless the caller says `Cancel`: pausing keeps every pending charge no matter
 * what an old app sends (absent or `Keep`), so a −N reminder that already materialized next month's
 * charge is never left stranded past the resume cursor. Encerrar keeps its old default: absent cancels
 * everything, `Keep` only drops what falls after this month, `Cancel` drops every pending charge.
 */
async function settlePendingCharges(db: DbClient, ownerId: string, billingId: string, patch: BillingPatch, today: string, now: string): Promise<void> {
  const ended = patch.state === BillingState.Ended;
  const reason = ended ? ChargeCancelReason.BillingEnded : ChargeCancelReason.BillingPaused;

  if (!ended) {
    if (patch.pendingCharges === PendingChargesAction.Cancel) {
      await cancelPendingCharges(db, ownerId, billingId, now, reason);
    }

    return;
  }

  const action = patch.pendingCharges ?? PendingChargesAction.Cancel;

  if (action === PendingChargesAction.Cancel) {
    await cancelPendingCharges(db, ownerId, billingId, now, reason);

    return;
  }

  await cancelPendingCharges(db, ownerId, billingId, now, reason, endOfMonth(today));
}

/**
 * Whether the billing already has a charge for this counterpart on this date, cancelled or not. Read through the
 * axis helpers rather than a column: the counterpart sits on either side of the money.
 */
async function chargeTaken(db: DbClient, billingId: string, counterpartId: string | null, dueDate: string): Promise<boolean> {
  const records = await ChargeRepository.byBilling(db, billingId, { dueDate });

  return records.some((charge) => (chargeCounterpartId(charge) ?? null) === counterpartId);
}

/** EditScope.CurrentMonth: this month's charges that are not due yet follow the edit; returns the created charge ids to announce. */
async function rewriteMonthCharges(db: DbClient, row: BillingRow, patch: BillingPatch, today: string, now: string): Promise<string[]> {
  const monthEnd = endOfMonth(today);
  const records = await ChargeRepository.byBilling(db, row.id, { state: ChargeState.Pending, dueAfter: today, dueThrough: monthEnd, lock: true });
  const proofs = await ProofRepository.byCharges(db, records.map((charge) => charge.id));
  const editable = records.filter((charge) => {
    const state = proofs.get(charge.id)?.state;

    return !state || state === StoredProofState.Rejected;
  });

  if (!editable.length) {
    return [];
  }

  const rescheduled = patch.startDate !== undefined || patch.dueRule !== undefined;
  const pixTouched = patch.paymentMethodId !== undefined || Boolean(patch.clearPaymentMethod);
  // Monthly and yearly rules have one occurrence per month: only a reschedule looks for a new day inside
  // the month; otherwise the stale start_date/due_rule from an earlier NextMonth edit must not leak in.
  const dueDate = rescheduled ? (billingDates(calendarRule(row), addCalendarDays(today, 1), monthEnd, 1)[0] ?? editable[0]!.due_date) : editable[0]!.due_date;
  const { split } = await splitFor(db, row);
  const payable = payableOf(row);
  const plan = planBillingCharges({
    description: row.description,
    totalCents: row.total_cents,
    split,
    dueDates: [dueDate],
    numbered: false,
    payer: payable ? payable.payer : ChargePayer.Person,
    payeeUserId: (await chargeCounterpart(db, row.owner_id, payable, split)) ?? null,
    settled: billingRegistered(row)
  });
  const existing: MonthCharge[] = editable.map((charge) => ({ id: charge.id, debtorUserId: chargeCounterpartId(charge) ?? null, dueDate: charge.due_date }));
  const changes = monthChanges(existing, plan.charges);
  // Only the people entering this month need revalidation; an archived contact or key elsewhere on the
  // billing must not fail an update to someone already on it. A conta a pagar without a payee still
  // needs a context to create its owner-only charge, even though nobody "enters" by user id.
  const entering = changes.create.map((planned) => planned.userId).filter((userId): userId is string => userId != null);
  const context = pixTouched || changes.create.length ? await prepareChargeMaterialization(db, row.owner_id, entering, row.payment_method_id, payable) : undefined;

  for (const { charge, planned } of changes.update) {
    const moving = rescheduled && planned.dueDate !== charge.dueDate;

    if (moving && (await chargeTaken(db, row.id, charge.debtorUserId, planned.dueDate))) {
      continue;
    }

    await ChargeRepository.edit(db, charge.id, {
      description: planned.description,
      amountCents: planned.amountCents,
      ...(moving ? { dueDate: planned.dueDate } : {}),
      ...(pixTouched
        ? {
            payment: context!.payment
              ? {
                  provider: context!.payment.provider,
                  ...(context!.payment.kind ? { kind: context!.payment.kind } : {}),
                  value: context!.payment.value,
                  label: context!.payment.label,
                  ...(context!.payment.integrationId ? { integrationId: context!.payment.integrationId } : {})
                }
              : null
          }
        : {}),
      now
    });
    await recordCharge(db, charge.id, row.owner_id, 'charge.edited', now);
  }

  for (const charge of changes.cancel) {
    // Mass cancel: no provider inactivation here, only the individual cancel does that
    // (limitation recorded in docs/notifications.md).
    await ChargeRepository.markCancelled(db, charge.id, now);
    await recordCharge(db, charge.id, row.owner_id, 'charge.cancelled', now, { reason: ChargeCancelReason.BillingEdited });
  }

  const creatable: typeof plan.charges = [];

  for (const planned of changes.create) {
    // A cancelled charge of the same person on the same date holds the unique index: the person joins next month.
    if (!(await chargeTaken(db, row.id, planned.userId, planned.dueDate))) {
      creatable.push(planned);
    }
  }

  if (!creatable.length) {
    return [];
  }

  const persisted = await persistChargePlan(
    db,
    row.owner_id,
    { ...plan, charges: creatable },
    { id: row.id, type: BillingRecurrence.Indefinite, kind: billingKind(row), timezone: row.timezone },
    context!,
    now
  );

  return persisted.noticeChargeIds;
}

/** A new due day never adds a second charge to a month that already has one: that month is skipped. */
async function rescheduledMonthCursor(db: DbClient, row: BillingRow, startDate: string, today: string): Promise<string> {
  const cursor = rescheduledCursor(row, startDate, today);
  const monthEnd = endOfMonth(startDate);
  const taken = await ChargeRepository.byBilling(db, row.id, { dueAfter: addCalendarDays(`${startDate.slice(0, 7)}-01`, -1), dueThrough: monthEnd });

  if (!taken.length) {
    return cursor;
  }

  return cursor > monthEnd ? cursor : monthEnd;
}

export async function createBilling(
  db: DbClient,
  ownerId: string,
  key: string,
  raw: BillingInput,
  now = new Date(),
  link?: InviteLinkContext,
  notice?: NoticeContext
): Promise<BillingDetail> {
  if (!key.trim() || key.length > 200) {
    throw new RangeError('Idempotency-Key inválida.');
  }

  // No clock yet: a replay after midnight must still find the billing it created.
  const input = normalizeBillingInput(raw);
  const hash = billingRequestFingerprint(input);
  const noticeChargeIds: string[] = [];
  const detail = await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const existing = await BillingRepository.byIdempotencyKey(tx, ownerId, key);

    if (existing) {
      if (existing.request_hash !== hash) {
        throw new IdempotencyMismatchError();
      }

      return billingDetail(tx, { ...existing, timezone: await AccountRepository.timezone(tx, ownerId) }, now, link);
    }

    const today = calendarDate(now, input.timezone);

    // Only a new creation obeys the clock: a recorrente registro starts today or later.
    normalizeBillingInput(raw, now);

    if (input.recurrence === BillingRecurrence.Indefinite && input.startDate < today) {
      throw new RangeError('O início não pode estar no passado.');
    }

    // A conta a pagar names its receiving contact outside the split; the key it points at is filed under that contact.
    const contact = input.contactId ? await ContactRepository.user(tx, ownerId, input.contactId) : undefined;
    const payable: PayableMaterialization | undefined = contact ? { payer: ChargePayer.Owner, contactId: contact.contactId } : undefined;
    const { paymentMethodId } = input;

    if (contact && paymentMethodId) {
      await assertContactKey(tx, ownerId, contact.contactId, paymentMethodId);
    }

    const counterpartId = contact ? contact.userId : counterpartIdOf(input.split);
    const counterparts = payable ? (counterpartId ? [counterpartId] : []) : userIds(input.split);
    const context = await prepareChargeMaterialization(tx, ownerId, counterparts, paymentMethodId, payable);
    const id = crypto.randomUUID();
    const instant = now.toISOString();
    const row = await BillingRepository.insert(tx, {
      id,
      ownerId,
      recurrence: input.recurrence,
      kind: input.kind ?? BillingKind.Live,
      frequency: input.frequency,
      description: input.description,
      category: input.category ?? BillingCategory.Other,
      totalCents: input.totalCents,
      startDate: input.startDate,
      endDate: input.endDate,
      dueRule: input.dueRule ?? BillingDueRule.Fixed,
      paymentMethodId,
      contactId: contact?.contactId,
      reminders: input.reminders ? JSON.stringify(input.reminders) : undefined,
      splitMode: input.split.mode,
      lastOccurrenceDate: input.recurrence === BillingRecurrence.Indefinite ? addCalendarDays(today, -1) : undefined,
      idempotencyKey: key,
      requestHash: hash,
      now: instant
    });

    await saveAllocations(tx, { id, owner_id: ownerId }, input.totalCents, input.split, instant);

    if (input.recurrence !== BillingRecurrence.Indefinite) {
      const plan = planBillingCharges({
        description: input.description,
        totalCents: input.totalCents,
        split: input.split,
        dueDates: billingDueDates(input),
        numbered: true,
        payer: context.payer,
        payeeUserId: counterpartId ?? null,
        settled: input.kind === BillingKind.Record
      });
      const persisted = await persistChargePlan(
        tx,
        ownerId,
        plan,
        { id, type: input.recurrence, kind: input.kind ?? BillingKind.Live, timezone: input.timezone },
        context,
        instant
      );

      noticeChargeIds.push(...persisted.noticeChargeIds);
    }

    await auditBilling(tx, ownerId, id, 'billing.created', instant, { type: input.recurrence });

    return billingDetail(tx, { ...row, timezone: await AccountRepository.timezone(tx, ownerId) }, now, link);
  });

  // The rows are committed before anyone hears about them.
  if (notice) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  // An assinatura gets the charges of its first month right away instead of waiting for the daily sweep.
  const materialized =
    input.recurrence === BillingRecurrence.Indefinite && detail.state === BillingState.Active && !detail.charges.length
      ? (await materializeDue(db, detail.id, notice, now)).materialized
      : false;

  return materialized ? getBilling(db, ownerId, detail.id, now, link) : detail;
}

/**
 * The owner of a conta a receber switches one participant's automatic notices: the allocation and every pending
 * charge of theirs in the billing follow, paid and cancelled ones stay. Sending the value already stored writes nothing.
 */
export async function setParticipantNotify(
  db: DbClient,
  ownerId: string,
  id: string,
  userId: string,
  notify: boolean,
  now = new Date(),
  link?: InviteLinkContext
): Promise<BillingDetail> {
  return db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const row = await loadBilling(tx, ownerId, id, true);

    if (billingDirection(row) === Direction.Payable) {
      throw new SilenceUnavailableError();
    }

    const current = (await AllocationRepository.notifyOf(tx, id, ownerId)).get(userId);

    if (current === undefined) {
      throw new HttpNotFoundError();
    }

    if (current === notify) {
      return billingDetail(tx, row, now, link);
    }

    const instant = now.toISOString();

    await AllocationRepository.setNotify(tx, id, userId, notify);
    await setPendingChargesNotify(tx, id, userId, notify, instant);
    await auditBilling(tx, ownerId, id, participantNotifyEvent(notify), instant, { userId });

    return billingDetail(tx, row, now, link);
  });
}

export async function patchBilling(
  db: DbClient,
  ownerId: string,
  id: string,
  patch: BillingPatch,
  now = new Date(),
  link?: InviteLinkContext,
  notice?: NoticeContext
): Promise<BillingDetail> {
  const noticeChargeIds: string[] = [];

  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const row = await loadBilling(tx, ownerId, id, true);

    assertPatchAllowed(row, patch);

    const instant = now.toISOString();
    const today = calendarDate(now, row.timezone);
    const totalCents = patch.totalCents ?? row.total_cents;
    const split = patch.split ?? (await splitFor(tx, row)).split;
    const description = patch.description === undefined ? row.description : patch.description.normalize('NFC').trim() || 'Conta';
    const reminders =
      patch.reminders === undefined
        ? undefined
        : normalizeBillingInput({
            ...billingInputFrom(row, split),
            ...(patch.contactId !== undefined ? { contactId: patch.contactId } : {}),
            reminders: patch.reminders
          }).reminders;
    // Whoever receives may change, and a new contact is validated like at creation.
    const named = patch.contactId !== undefined ? await ContactRepository.user(tx, ownerId, patch.contactId) : undefined;
    const contactId = named?.contactId ?? row.contact_id;
    const contactPatched = named !== undefined && named.contactId !== row.contact_id;
    const payable: PayableMaterialization | undefined = contactId ? { payer: ChargePayer.Owner, contactId } : undefined;
    // A key belongs to the contact it was filed under: moving to another one drops the key the billing pointed at.
    const kept = contactPatched ? undefined : row.payment_method_id;
    const paymentMethodId = patch.clearPaymentMethod ? undefined : (patch.paymentMethodId ?? kept);

    if (contactId && paymentMethodId) {
      await assertContactKey(tx, ownerId, contactId, paymentMethodId);
    }

    // Only newly introduced recipients/Pix need revalidation; materializeNextOccurrence re-checks the stored
    // split at occurrence time, so an already-persisted split must not block unrelated edits (e.g. ending
    // a billing whose recipient was archived later).
    if (patch.split !== undefined || patch.paymentMethodId !== undefined || patch.clearPaymentMethod || contactPatched) {
      const counterpartId = await chargeCounterpart(tx, ownerId, payable, split);
      const counterparts = payable ? (counterpartId ? [counterpartId] : []) : userIds(split);

      await prepareChargeMaterialization(tx, ownerId, counterparts, paymentMethodId, payable);
    }

    // A conta a pagar keeps the owner alone in its split, for the whole total: a new total rewrites it
    // (a fixed part above the total would be refused otherwise).
    const stored = payable ? normalizeBillingInput({ ...billingInputFrom(row, split), totalCents, contactId }).split : split;

    if (patch.split !== undefined || patch.totalCents !== undefined || (payable && contactPatched)) {
      const changes = await saveAllocations(tx, row, totalCents, stored, instant);

      // Same rule as PUT /billings/{id}/participants/{userId}/notify for whoever stayed and changed.
      for (const change of changes) {
        await setPendingChargesNotify(tx, id, change.userId, change.notify, instant);
        await auditBilling(tx, ownerId, id, participantNotifyEvent(change.notify), instant, { userId: change.userId });
      }
    }

    const resumed = patch.state === BillingState.Active && row.state === BillingState.Paused;
    const boundary = addCalendarDays(today, -1);
    const startDate = patch.startDate ?? row.start_date;
    const dueRule = patch.dueRule ?? row.due_rule;
    const rescheduled = startDate !== row.start_date || dueRule !== row.due_rule;

    if (rescheduled) {
      // Same checks as creation: a real date, a month end only on monthly rules, and on its last day.
      normalizeBillingInput({ ...billingInputFrom(row, split), totalCents, startDate, dueRule });
    }

    const cursor = rescheduled ? await rescheduledMonthCursor(tx, row, startDate, today) : undefined;

    await BillingRepository.update(
      tx,
      id,
      {
        description,
        category: patch.category ?? row.category,
        totalCents,
        paymentMethodId: paymentMethodId ?? null,
        contactId: contactId ?? null,
        ...(patch.reminders !== undefined ? { reminders: JSON.stringify(reminders) } : {}),
        ...(patch.split !== undefined || (payable && contactPatched) ? { splitMode: stored.mode } : {}),
        ...(patch.state ? { state: patch.state } : {}),
        ...(resumed ? { lastOccurrenceDate: (row.last_occurrence_date ?? boundary) > boundary ? row.last_occurrence_date : boundary } : {}),
        // A new due day wins over the resume cursor: both only ever move the cursor forward.
        ...(rescheduled ? { startDate, dueRule, lastOccurrenceDate: cursor } : {})
      },
      instant
    );

    if (patch.state === BillingState.Paused || patch.state === BillingState.Ended) {
      await settlePendingCharges(tx, ownerId, id, patch, today, instant);
    }

    // A paused/ended billing never materializes new occurrences; applyTo must not create one either.
    if (patch.applyTo === EditScope.CurrentMonth && touchesCharges(patch) && (patch.state ?? row.state) === BillingState.Active) {
      noticeChargeIds.push(...(await rewriteMonthCharges(tx, await loadBilling(tx, ownerId, id), patch, today, instant)));
    }

    await auditBilling(tx, ownerId, id, patch.state ? `billing.${patch.state}` : 'billing.edited', instant);
  });

  if (notice && noticeChargeIds.length) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  // A due day moved into the past, or a resumed billing, may owe an occurrence right away.
  if (notice && (patch.startDate !== undefined || patch.dueRule !== undefined || patch.state === BillingState.Active)) {
    await materializeDue(db, id, notice, now);
  }

  return getBilling(db, ownerId, id, now, link);
}

export function createService({ db, email, chargeNotifyScheduler, variables }: Service.Context<BillingService>): BillingClient {
  const link = inviteLink({ variables });
  const notice = noticeContext({ chargeNotifyScheduler, email, variables });

  return {
    create: (ownerId, key, input) => createBilling(db, ownerId, key, input, new Date(), link, notice),
    get: (ownerId, id) => getBilling(db, ownerId, id, new Date(), link),
    list: (ownerId, filters) => listBillings(db, ownerId, filters),
    patch: (ownerId, id, patch) => patchBilling(db, ownerId, id, patch, new Date(), link, notice),
    setParticipantNotify: (ownerId, id, userId, notify) => setParticipantNotify(db, ownerId, id, userId, notify, new Date(), link),
    resolveGuest: (ownerId, id, guestId, action) => resolveGuest(db, ownerId, id, guestId, action, new Date(), link, notice)
  };
}
