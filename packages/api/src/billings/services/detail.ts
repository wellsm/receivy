import { HttpNotFoundError } from '@ez4/gateway';
import {
  addCalendarDays,
  type BillingContact,
  type BillingDetail,
  type BillingGuest,
  BillingKind,
  type BillingPreview,
  BillingRecurrence,
  BillingState,
  type BillingSummary,
  type BillingsPage,
  billingDates,
  calendarDate,
  Direction,
  PaymentProvider,
  resolveBillingSplit,
  SplitPartKind,
  UserStatus
} from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { paymentSnapshot } from '../../charges/services/materialize';
import { ContactRepository } from '../../contacts/repositories/contact';
import { personName, personOf } from '../../contacts/utils/person';
import type { DbClient } from '../../database';
import { activeInvite, type InviteLinkContext } from '../../invites/services/links';
import { AccountRepository } from '../../users/repositories/account';
import { avatarRef } from '../../users/utils/avatar';
import { AllocationRepository } from '../repositories/allocation';
import { BillingRepository } from '../repositories/billing';
import { BillingGuestRepository } from '../repositories/guest';
import { BillingGuestState } from '../schemas/billing-guest';
import { billingDirection, billingKind, billingRecurrence, billingRegistered } from '../utils/columns';
import { decodeListCursor, encodeListCursor } from '../utils/cursor';
import { effectiveReminders, parseReminders } from '../utils/reminders';
import { type BillingRow, calendarRule, installmentCountFor } from '../utils/split';
import { billingSummary, EMPTY_AGGREGATE, summaryAggregates } from '../utils/summary';
import { splitFor } from './split';

const PAGE_SIZE = 50;
const PREVIEW_DAYS = 90;

/** The billing with the owner's timezone attached, the shape every calendar helper reads. */
export async function loadBilling(db: DbClient, ownerId: string, id: string, lock = false): Promise<BillingRow> {
  const row = await BillingRepository.get(db, ownerId, id, lock);

  if (!row) {
    throw new HttpNotFoundError();
  }

  return { ...row, timezone: await AccountRepository.timezone(db, ownerId) };
}

/** An agenda entry as the owner wrote it down: their nickname first, then the person's own name and photo. */
async function knownAs(db: DbClient, contact: { id: string; userId: string; nickname: string | null }): Promise<BillingContact> {
  const person = personOf(await AccountRepository.person(db, contact.userId));
  const name = contact.nickname || person?.name || 'Conta excluída';

  return { id: contact.id, userId: contact.userId, name, avatar: person?.avatar ?? null };
}

/** Who receives a conta a pagar, as the owner knows them; an archived contact still names it. */
async function contactOf(db: DbClient, row: Pick<BillingRepository.Row, 'owner_id' | 'contact_id'>): Promise<BillingContact | null> {
  if (!row.contact_id) {
    return null;
  }

  const contact = await ContactRepository.row(db, row.owner_id, row.contact_id);

  return contact ? knownAs(db, contact) : null;
}

/**
 * The other side as the owner knows them. A conta a pagar already names it: the receiving contact stands for it.
 * A registro a receber keeps its single payer in the split, so their agenda entry is read from there. A conta a
 * receber may have many payers: nobody stands for the other side there.
 */
async function counterpartOf(db: DbClient, row: Pick<BillingRepository.Row, 'id' | 'owner_id' | 'kind'>, contact: BillingContact | null): Promise<BillingContact | null> {
  if (contact || billingKind(row) !== BillingKind.Record) {
    return contact;
  }

  const payerId = (await AllocationRepository.byBilling(db, row.id)).find((allocation) => allocation.user_id !== row.owner_id)?.user_id;

  if (!payerId) {
    return null;
  }

  const entry = await ContactRepository.byUser(db, row.owner_id, payerId);

  if (!entry) {
    return null;
  }

  const stored = await ContactRepository.row(db, row.owner_id, entry.id);

  return stored ? knownAs(db, stored) : null;
}

/**
 * The key a conta a pagar pays through: the one it points at, or the default of its contact. Reading a
 * billing never fails over a key: one archived or deleted after the fact simply shows nothing.
 */
async function billingPix(db: DbClient, row: BillingRepository.Row): Promise<BillingDetail['pix']> {
  if (!row.contact_id) {
    return null;
  }

  try {
    const method = await paymentSnapshot(db, row.owner_id, row.payment_method_id, row.contact_id);

    // A contact key is always Pix; anything else here is a broken pointer, shown as nothing.
    return method?.provider === PaymentProvider.Pix && method.kind ? { keyType: method.kind, key: method.value, label: method.label } : null;
  } catch (error) {
    if (error instanceof HttpNotFoundError) {
      return null;
    }

    throw error;
  }
}

export async function previewsFor(db: DbClient, row: BillingRow, now: Date): Promise<BillingPreview[]> {
  if (billingRecurrence(row) !== BillingRecurrence.Indefinite || row.state !== BillingState.Active) {
    return [];
  }

  const today = calendarDate(now, row.timezone);
  const cursor = row.last_occurrence_date ?? addCalendarDays(today, -1);
  const existing = (await ChargeRepository.byBilling(db, row.id, { dueAfter: addCalendarDays(today, -1) })).map((charge) => charge.due_date);
  const direction = billingDirection(row);
  // A conta a pagar and a registro are owed in full; a conta a receber only projects what contacts owe.
  const projected =
    direction === Direction.Payable || billingRegistered(row)
      ? row.total_cents
      : resolveBillingSplit(row.total_cents, (await splitFor(db, row)).split)
          .filter((allocation) => allocation.kind === SplitPartKind.User)
          .reduce((sum, allocation) => sum + allocation.amountCents, 0);

  return billingDates(calendarRule(row), today, addCalendarDays(today, PREVIEW_DAYS))
    .filter((date) => !existing.includes(date) && date > cursor)
    .map((occurrenceDate) => ({ billingId: row.id, type: direction, description: row.description, amount: { amountCents: projected, currency: 'BRL' as const }, occurrenceDate }));
}

/** Guests still waiting on the owner of `billingId`, with the live name and e-mail of each account. */
export async function waitingGuests(db: DbClient, billingId: string): Promise<BillingGuest[]> {
  const rows = await BillingGuestRepository.byState(db, billingId, BillingGuestState.Pending);

  return rows.flatMap((row) => {
    if (row.user.status === UserStatus.Removed) {
      return [];
    }

    return [
      {
        id: row.id,
        userId: row.user_id,
        name: personName(row.user),
        email: row.user.email ?? '',
        createdAt: row.created_at,
        avatar: avatarRef(row.user.id, row.user.avatar_updated_at)
      }
    ];
  });
}

export async function billingDetail(db: DbClient, row: BillingRow, now: Date, link?: InviteLinkContext): Promise<BillingDetail> {
  const reminders = effectiveReminders(row);
  const { split, allocations } = await splitFor(db, row);
  const charges = await ChargeRepository.byBilling(db, row.id);
  const previews = await previewsFor(db, row, now);
  const earliest = charges.find((charge) => charge.state === 'pending');
  const contact = await contactOf(db, row);

  // The detail response has its own field list: the card counters stay out of it.
  return {
    id: row.id,
    type: billingDirection(row),
    contact,
    counterpart: await counterpartOf(db, row, contact),
    kind: billingKind(row),
    pix: await billingPix(db, row),
    recurrence: billingRecurrence(row),
    frequency: row.frequency,
    description: row.description,
    total: { amountCents: row.total_cents, currency: 'BRL' },
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule,
    state: row.state,
    installmentCount: installmentCountFor(row),
    nextDueDate: earliest?.due_date ?? previews[0]?.occurrenceDate ?? null,
    createdAt: row.created_at,
    category: row.category,
    invite: link ? await activeInvite(db, row.id, link.secret, link.webOrigin, now) : null,
    guests: await waitingGuests(db, row.id),
    linkableContacts: await ContactRepository.linkable(db, row.owner_id),
    updatedAt: row.updated_at,
    timezone: row.timezone,
    paymentMethodId: row.payment_method_id,
    reminders: parseReminders(row) ?? reminders,
    split,
    allocations,
    charges: await ChargeRepository.dtos(db, charges, row.owner_id),
    previews
  };
}

export async function getBilling(db: DbClient, ownerId: string, id: string, now = new Date(), link?: InviteLinkContext): Promise<BillingDetail> {
  return billingDetail(db, await loadBilling(db, ownerId, id), now, link);
}

export async function listBillings(db: DbClient, ownerId: string, filters: { type?: Direction; cursor?: string; search?: string } = {}, now = new Date()): Promise<BillingsPage> {
  const rows = await BillingRepository.list(db, ownerId, { ...filters, cursor: decodeListCursor(filters.cursor) }, PAGE_SIZE + 1);
  // Every row of the page belongs to the same owner, so their timezone is read once.
  const timezone = await AccountRepository.timezone(db, ownerId);
  const page: BillingRow[] = rows.slice(0, PAGE_SIZE).map((row) => ({ ...row, timezone }));
  const last = rows.length > PAGE_SIZE ? page.at(-1) : undefined;
  const ids = page.map((row) => row.id);
  const aggregates = summaryAggregates(page, await ChargeRepository.summaryOf(db, ids), await AllocationRepository.byBillings(db, ids), now);
  const billings: BillingSummary[] = [];

  for (const row of page) {
    const { earliestPendingDue, ...counters } = aggregates.get(row.id) ?? EMPTY_AGGREGATE;
    const nextDueDate =
      earliestPendingDue ?? (billingRecurrence(row) === BillingRecurrence.Indefinite ? ((await previewsFor(db, row, now))[0]?.occurrenceDate ?? null) : null);
    const contact = await contactOf(db, row);

    billings.push(billingSummary(row, nextDueDate, counters, contact, await counterpartOf(db, row, contact)));
  }

  return { billings, nextCursor: last ? encodeListCursor({ createdAt: last.created_at, id: last.id }) : null };
}
