import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import {
  BillingCategory,
  BillingFrequency,
  type BillingInput,
  BillingType,
  ChargeState,
  PixKeyType,
  ProofMime,
  SplitMode,
  SplitPartKind,
  UserStatus
} from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { resolveGuest } from '../../src/billings/services/guests';
import { StoredProofState } from '../../src/charges/schemas/charge';
import { ApiError, TooManyRequestsError } from '../../src/common/errors';
import { createEmailClient } from '../../src/common/services/email/compose';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { acceptInviteHandler } from '../../src/invites/endpoints/accept';
import { InviteRepository } from '../../src/invites/repositories/invite';
import { activeInvite, createInvite, getPublicInvite, revokeInvite } from '../../src/invites/services/links';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';
import { fakeScheduler } from '../fixtures/scheduling';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const OTHER_OWNER = 'c2222222-2222-4222-8222-222222222222';
const GUEST = 'c3333333-3333-4333-8333-333333333333';
const STRANGER = 'c4444444-4444-4444-8444-444444444444';
const LINKED_OWNER = 'c5555555-5555-4555-8555-555555555555';
const OUTSIDER = 'c6666666-6666-4666-8666-666666666666';
const PARKED = 'c7777777-7777-4777-8777-777777777777';
const GUEST_EMAIL = 'invite-guest@example.com';
const PARKED_EMAIL = 'invite-parked@example.com';
const SECRET = 'invite-spec-capability-secret';
const ORIGIN = 'http://localhost:3000';
const DAY = 24 * 60 * 60 * 1000;

let debtorId: string;
let otherDebtorId: string;
let pixId: string;

const tokenOf = (url: string) => url.slice(`${ORIGIN}/join/`.length);

function once(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Once,
    description: 'Churrasco',
    totalCents: 8_000,
    startDate: '2026-11-20',
    timezone: 'America/Sao_Paulo',
    paymentMethodId: pixId,
    category: BillingCategory.Food,
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: debtorId }] },
    ...overrides
  };
}

async function contactFor(ownerId: string, userId: string) {
  return db.contacts.findOne({ select: { id: true, user_id: true, archived_at: true }, where: { owner_id: ownerId, user_id: userId } });
}

async function chargesOf(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_user_id: true, amount_cents: true, due_date: true, installment: true, installment_count: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc, amount_cents: Order.Asc }
  });

  return records;
}

describe('billing invites on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'invite-owner@example.com', name: 'Lucas Andrade' });
    await createUser(db, { id: OTHER_OWNER, email: 'invite-other-owner@example.com', name: 'Marta' });
    await createUser(db, { id: LINKED_OWNER, email: 'invite-linked-owner@example.com', name: 'Rita' });
    await createUser(db, { id: GUEST, email: GUEST_EMAIL, name: 'Bruna Lima' });

    // Unverified on purpose: joining a split requires a confirmed address.
    const now = new Date().toISOString();

    await db.users.insertOne({
      data: {
        id: STRANGER,
        email: 'invite-stranger@example.com',
        name: 'Sem Confirmar',
        status: UserStatus.Active,
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        country: 'BR',
        currency: 'BRL',
        created_at: now,
        updated_at: now
      }
    });

    debtorId = (await ContactRepository.save(db, OWNER, { name: 'Caio', email: 'invite-debtor@example.com' })).userId;
    otherDebtorId = (await ContactRepository.save(db, OTHER_OWNER, { name: 'Caio', email: 'invite-other-debtor@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER_OWNER, LINKED_OWNER, GUEST, STRANGER, OUTSIDER, PARKED]));

  it('issues a join link, exposes it on the detail and revokes the previous invite', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const billing = await BillingRepository.create(db, OWNER, 'invite-issue', once(), now);
    const first = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    ok(first.url.startsWith(`${ORIGIN}/join/`));
    equal(first.expiresAt, new Date(now.getTime() + 30 * DAY).toISOString());

    const detail = await BillingRepository.get(db, OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(detail.invite, first);

    const second = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    ok(second.url !== first.url);
    // A revoked link answers with the flag alone: no description, amount or participant count leaks.
    deepEqual(await getPublicInvite(db, tokenOf(first.url), SECRET, now), { expired: true });
    equal((await getPublicInvite(db, tokenOf(second.url), SECRET, now)).expired, false);
    deepEqual(await activeInvite(db, billing.id, SECRET, ORIGIN, now), second);

    await revokeInvite(db, OWNER, billing.id, now);

    equal(await activeInvite(db, billing.id, SECRET, ORIGIN, now), null);
    deepEqual(await getPublicInvite(db, tokenOf(second.url), SECRET, now), { expired: true });
    await rejects(() => createInvite(db, OTHER_OWNER, billing.id, SECRET, ORIGIN, now), HttpNotFoundError);
  });

  it('answers the public view with the billing headline and hides forged tokens', async () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const billing = await BillingRepository.create(db, OWNER, 'invite-public', once({ description: 'Churrasco de sábado' }), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const view = await getPublicInvite(db, tokenOf(invite.url), SECRET, now);

    deepEqual(view, {
      creditorFirstName: 'Lucas',
      description: 'Churrasco de sábado',
      amount: { amountCents: 8_000, currency: 'BRL' },
      type: BillingType.Once,
      participantCount: 1,
      category: BillingCategory.Food,
      expired: false
    });

    const token = tokenOf(invite.url);
    const [publicId, expires, signature] = token.split('.');

    await rejects(() => getPublicInvite(db, `${publicId}.${expires}.${signature}x`, SECRET, now), HttpNotFoundError);
    await rejects(() => getPublicInvite(db, `${publicId}.${Number(expires) + 1}.${signature}`, SECRET, now), HttpNotFoundError);
    await rejects(() => getPublicInvite(db, 'not-a-known-public-id.123.abc', SECRET, now), HttpNotFoundError);
  });

  it('adds the guest as contact and participant, recalculating the pending charges', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const billing = await BillingRepository.create(db, OWNER, 'invite-accept', once(), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const before = await chargesOf(billing.id);

    equal(before.length, 1);
    equal(before[0]!.amount_cents, 8_000);

    const result = await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(result.billingId, billing.id);
    equal(result.joinedSplit, true);
    ok(result.chargeId);

    const guestContact = await contactFor(OWNER, GUEST);

    ok(guestContact, 'the guest joins the owner agenda through their own account');
    ok(!guestContact.archived_at);

    const detail = await BillingRepository.get(db, OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(
      detail.allocations.map((allocation) => [allocation.userId, allocation.amount.amountCents, allocation.order]),
      [
        [debtorId, 4_000, 0],
        [GUEST, 4_000, 1]
      ]
    );

    const after = await chargesOf(billing.id);

    equal(after.length, 2);
    deepEqual(
      after.map((charge) => [charge.amount_cents, charge.due_date, charge.installment, charge.installment_count]),
      [
        [4_000, '2026-11-20', 1, 1],
        [4_000, '2026-11-20', 1, 1]
      ]
    );
    equal(after.find((charge) => charge.debtor_user_id === GUEST)?.id, result.chargeId);

    // Only the newly inserted charge announces itself; the repriced one keeps its original event.
    equal(await db.events.count({ where: { eventable_id: result.chargeId!, type: 'charge.created', actor_user_id: OWNER } }), 1);
    equal(await db.events.count({ where: { eventable_id: before[0]!.id, type: 'charge.created', actor_user_id: OWNER } }), 1);
    ok(await db.events.count({ where: { eventable_id: billing.id, type: 'billings.invite_accepted' } }));

    const publicId = tokenOf(invite.url).split('.')[0]!;
    const row = await db.billing_invites.findOne({ select: { accepted_count: true }, where: { public_id: publicId } });

    equal(row?.accepted_count, 1);

    const repeated = await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    deepEqual(repeated, { billingId: billing.id, chargeId: result.chargeId, joinedSplit: false, awaitingOwner: false });
    equal((await chargesOf(billing.id)).length, 2);
    equal(detail.allocations.length, 2);
    equal(await db.allocations.count({ where: { billing_id: billing.id } }), 2);
  });

  it('reprices every installment and numbers the guest charges like the originals', async () => {
    const now = new Date('2026-10-03T18:00:00Z');
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'invite-until',
      once({
        type: BillingType.Until,
        frequency: BillingFrequency.Monthly,
        totalCents: 9_000,
        startDate: '2026-11-20',
        endDate: '2027-01-20'
      }),
      now
    );
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const before = await chargesOf(billing.id);

    equal(billing.installmentCount, 3);
    deepEqual(
      before.map((charge) => [charge.due_date, charge.amount_cents, charge.installment, charge.installment_count]),
      [
        ['2026-11-20', 9_000, 1, 3],
        ['2026-12-20', 9_000, 2, 3],
        ['2027-01-20', 9_000, 3, 3]
      ]
    );

    const result = await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(result.joinedSplit, true);

    const after = await chargesOf(billing.id);

    equal(after.length, 6);

    // Each occurrence still adds up to the billing total, on both sides of the split.
    for (const dueDate of ['2026-11-20', '2026-12-20', '2027-01-20']) {
      const occurrence = after.filter((charge) => charge.due_date === dueDate);

      equal(occurrence.length, 2);
      equal(
        occurrence.reduce((sum, charge) => sum + charge.amount_cents, 0),
        9_000
      );
    }

    const guestCharges = after.filter((charge) => charge.debtor_user_id === GUEST);
    const ownerContactCharges = after.filter((charge) => charge.debtor_user_id === debtorId);

    deepEqual(
      guestCharges.map((charge) => [charge.due_date, charge.amount_cents, charge.installment, charge.installment_count]),
      [
        ['2026-11-20', 4_500, 1, 3],
        ['2026-12-20', 4_500, 2, 3],
        ['2027-01-20', 4_500, 3, 3]
      ]
    );
    deepEqual(
      ownerContactCharges.map((charge) => [charge.due_date, charge.amount_cents, charge.installment, charge.installment_count]),
      [
        ['2026-11-20', 4_500, 1, 3],
        ['2026-12-20', 4_500, 2, 3],
        ['2027-01-20', 4_500, 3, 3]
      ]
    );

    // One announcement per inserted charge; the repriced originals keep the single event they had.
    for (const charge of guestCharges) {
      equal(await db.events.count({ where: { eventable_id: charge.id, type: 'charge.created', actor_user_id: OWNER } }), 1);
    }

    for (const charge of before) {
      equal(await db.events.count({ where: { eventable_id: charge.id, type: 'charge.created', actor_user_id: OWNER } }), 1);
    }

    equal(result.chargeId, guestCharges[0]!.id);
  });

  it('refuses to reshape a split that already moved', async () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const paid = await BillingRepository.create(db, OWNER, 'invite-paid', once(), now);
    const paidInvite = await createInvite(db, OWNER, paid.id, SECRET, ORIGIN, now);

    await db.charges.updateOne({ where: { id: paid.charges[0]!.id }, data: { state: ChargeState.Paid, paid_at: now.toISOString() } });
    await rejects(
      () => InviteRepository.accept(db, GUEST, tokenOf(paidInvite.url), SECRET, now),
      (error: Error) => error instanceof ApiError && error.message === 'Divisão já em andamento.'
    );
    equal(await db.allocations.count({ where: { billing_id: paid.id } }), 1);
    equal((await chargesOf(paid.id)).length, 1);

    const proofed = await BillingRepository.create(db, OWNER, 'invite-proofed', once(), now);
    const proofedInvite = await createInvite(db, OWNER, proofed.id, SECRET, ORIGIN, now);

    await db.charges.updateOne({
      where: { id: proofed.charges[0]!.id },
      data: {
        proof_state: StoredProofState.Pending,
        proof_file: { key: `invite-spec/${proofed.charges[0]!.id}.pdf`, name: 'comprovante.pdf', mime: ProofMime.Pdf, size: 1_024 },
        proof_sent_at: now.toISOString(),
        updated_at: now.toISOString()
      }
    });
    await rejects(
      () => InviteRepository.accept(db, GUEST, tokenOf(proofedInvite.url), SECRET, now),
      (error: Error) => error instanceof ApiError && error.message === 'Divisão já em andamento.'
    );
    equal(await db.allocations.count({ where: { billing_id: proofed.id } }), 1);
  });

  it('keeps indefinite billings on allocations only and fixed splits on contact only', async () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const endless = await BillingRepository.create(
      db,
      OWNER,
      'invite-indefinite',
      once({ type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-10-06', paymentMethodId: pixId }),
      now
    );

    ok(endless.charges.length > 0, 'the month of creation exists right away');

    const endlessInvite = await createInvite(db, OWNER, endless.id, SECRET, ORIGIN, now);
    const joined = await InviteRepository.accept(db, GUEST, tokenOf(endlessInvite.url), SECRET, now);

    deepEqual(joined, { billingId: endless.id, chargeId: null, joinedSplit: true, awaitingOwner: false });
    equal(await db.allocations.count({ where: { billing_id: endless.id } }), 2);
    equal((await chargesOf(endless.id)).length, endless.charges.length, 'the guest joins the split from next month');

    const fixed = await BillingRepository.create(
      db,
      OWNER,
      'invite-fixed',
      once({ split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: debtorId, amountCents: 5_000 }] } }),
      now
    );
    const fixedInvite = await createInvite(db, OWNER, fixed.id, SECRET, ORIGIN, now);
    const contactOnly = await InviteRepository.accept(db, GUEST, tokenOf(fixedInvite.url), SECRET, now);

    deepEqual(contactOnly, { billingId: fixed.id, chargeId: null, joinedSplit: false, awaitingOwner: false });
    equal(await db.allocations.count({ where: { billing_id: fixed.id, user_id: { not: OWNER } } }), 1);
    equal((await chargesOf(fixed.id)).length, 1);
  });

  it('rejects the owner, an unconfirmed address and an expired link', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const billing = await BillingRepository.create(db, OWNER, 'invite-guards', once(), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    await rejects(
      () => InviteRepository.accept(db, OWNER, tokenOf(invite.url), SECRET, now),
      (error: Error) => error instanceof ApiError && error.message === 'Você é o dono desta cobrança.'
    );
    await rejects(
      () => InviteRepository.accept(db, STRANGER, tokenOf(invite.url), SECRET, now),
      (error: Error) => error instanceof HttpForbiddenError && error.message === 'Confirme seu e-mail antes de participar.'
    );

    const stale = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, new Date(now.getTime() - 31 * DAY));

    deepEqual(await getPublicInvite(db, tokenOf(stale.url), SECRET, now), { expired: true });
    await rejects(() => InviteRepository.accept(db, GUEST, tokenOf(stale.url), SECRET, now), HttpNotFoundError);
  });

  it('reuses the existing contact for the guest instead of duplicating it', async () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const existing = await ContactRepository.save(db, OTHER_OWNER, { name: 'Bruna Lima', email: GUEST_EMAIL, nickname: 'Bruna' });

    equal(existing.userId, GUEST);

    const billing = await BillingRepository.create(
      db,
      OTHER_OWNER,
      'invite-existing-contact',
      {
        type: BillingType.Once,
        description: 'Mercado',
        totalCents: 6_000,
        startDate: '2026-11-20',
        timezone: 'America/Sao_Paulo',
        split: { mode: SplitMode.Shares, parts: [{ kind: SplitPartKind.User, userId: otherDebtorId, shares: 2 }] }
      },
      now
    );
    const invite = await createInvite(db, OTHER_OWNER, billing.id, SECRET, ORIGIN, now);
    const result = await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(result.joinedSplit, true);
    equal(await db.contacts.count({ where: { owner_id: OTHER_OWNER, user_id: GUEST } }), 1);
    equal((await contactFor(OTHER_OWNER, GUEST))?.id, existing.id);

    const detail = await BillingRepository.get(db, OTHER_OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(
      detail.allocations.map((allocation) => [allocation.userId, allocation.shares, allocation.amount.amountCents]),
      [
        [otherDebtorId, 2, 4_000],
        [GUEST, 1, 2_000]
      ]
    );
  });

  it('revives an archived contact for the guest instead of creating a second one', async () => {
    const now = new Date('2026-10-08T12:00:00Z');
    const linkedDebtorId = (await ContactRepository.save(db, LINKED_OWNER, { name: 'Caio', email: 'invite-linked-debtor@example.com' }))
      .userId;
    const archived = await ContactRepository.save(db, LINKED_OWNER, { name: 'Bruna Lima', email: GUEST_EMAIL });

    await ContactRepository.archive(db, LINKED_OWNER, archived.id);

    const billing = await BillingRepository.create(
      db,
      LINKED_OWNER,
      'invite-linked-contact',
      {
        type: BillingType.Once,
        description: 'Feira',
        totalCents: 6_000,
        startDate: '2026-11-20',
        timezone: 'America/Sao_Paulo',
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: linkedDebtorId }] }
      },
      now
    );
    const invite = await createInvite(db, LINKED_OWNER, billing.id, SECRET, ORIGIN, now);

    const result = await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(result.joinedSplit, true);

    const contact = await contactFor(LINKED_OWNER, GUEST);

    equal(contact?.id, archived.id);
    ok(!contact?.archived_at);
    equal(await db.contacts.count({ where: { owner_id: LINKED_OWNER, user_id: GUEST } }), 1);
  });
  it('parks the guest when the split names a contact without e-mail, and linking moves that contact to the guest', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const placeholder = await ContactRepository.save(db, OWNER, { name: 'Zé', nickname: 'Zezinho' });

    equal(placeholder.email, '');
    equal(placeholder.status, 'pending');

    const billing = await BillingRepository.create(
      db,
      OWNER,
      'invite-park',
      once({ split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: placeholder.userId }] } }),
      now
    );
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    await createUser(db, { id: PARKED, email: PARKED_EMAIL, name: 'Paula Reis' });

    const result = await InviteRepository.accept(db, PARKED, tokenOf(invite.url), SECRET, now);

    deepEqual(
      { ...result, waiting: undefined },
      { billingId: billing.id, chargeId: null, joinedSplit: false, awaitingOwner: true, waiting: undefined }
    );
    deepEqual(result.waiting, { ownerId: OWNER, description: 'Churrasco', guestName: 'Paula Reis' });
    equal(await contactFor(OWNER, PARKED), undefined, 'the guest is not in the agenda until the owner decides');
    equal((await chargesOf(billing.id)).length, 1);

    // Accepting again keeps the single waiting row instead of counting twice.
    const again = await InviteRepository.accept(db, PARKED, tokenOf(invite.url), SECRET, now);

    equal(again.awaitingOwner, true);
    equal(await db.billing_guests.count({ where: { billing_id: billing.id } }), 1);

    const detail = await BillingRepository.get(db, OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(
      detail.guests.map((guest) => [guest.userId, guest.name, guest.email]),
      [[PARKED, 'Paula Reis', PARKED_EMAIL]]
    );
    deepEqual(detail.linkableContacts, [{ contactId: placeholder.id, displayName: 'Zezinho', avatar: null }]);

    const linked = await resolveGuest(db, OWNER, billing.id, detail.guests[0]!.id, { action: 'link', contactId: placeholder.id }, now);

    deepEqual(linked.guests, []);
    deepEqual(linked.linkableContacts, []);
    deepEqual(
      linked.allocations.map((allocation) => [allocation.userId, allocation.amount.amountCents]),
      [[PARKED, 8_000]]
    );

    const contact = await contactFor(OWNER, PARKED);

    equal(contact?.id, placeholder.id, 'the agenda entry survives, now pointing at the guest account');
    equal((await db.contacts.findOne({ select: { nickname: true }, where: { id: placeholder.id } }))?.nickname, 'Zezinho');
    equal(await db.users.count({ where: { id: placeholder.userId } }), 0, 'the placeholder account is gone');
    deepEqual(
      (await chargesOf(billing.id)).map((charge) => [charge.debtor_user_id, charge.amount_cents]),
      [[PARKED, 8_000]]
    );
    ok(await db.events.count({ where: { eventable_id: billing.id, type: 'billings.guest_linked' } }));

    await rejects(
      resolveGuest(db, OWNER, billing.id, detail.guests[0]!.id, { action: 'dismiss' }, now),
      ApiError,
      'a resolved guest cannot be answered twice'
    );
  });

  it('adds a waiting guest as a new participant, or dismisses them without touching the agenda', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const placeholder = await ContactRepository.save(db, OWNER, { name: 'Sem E-mail' });
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'invite-add',
      once({ split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: placeholder.userId }] } }),
      now
    );
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    equal((await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now)).awaitingOwner, true);

    const waiting = (await BillingRepository.get(db, OWNER, billing.id, now)).guests[0]!;
    const added = await resolveGuest(db, OWNER, billing.id, waiting.id, { action: 'add' }, now);

    deepEqual(added.guests, []);
    deepEqual(
      added.allocations.map((allocation) => [allocation.userId, allocation.amount.amountCents]),
      [
        [placeholder.userId, 4_000],
        [GUEST, 4_000]
      ]
    );
    ok(await contactFor(OWNER, GUEST));
    equal((await chargesOf(billing.id)).length, 2);

    // Someone else joining the same billing can still be dismissed without leaving a trace in the agenda.
    await createUser(db, { id: OUTSIDER, email: 'invite-outsider@example.com', name: 'Otto' });

    equal((await InviteRepository.accept(db, OUTSIDER, tokenOf(invite.url), SECRET, now)).awaitingOwner, true);

    const second = (await BillingRepository.get(db, OWNER, billing.id, now)).guests[0]!;
    const dismissed = await resolveGuest(db, OWNER, billing.id, second.id, { action: 'dismiss' }, now);

    deepEqual(dismissed.guests, []);
    equal(await contactFor(OWNER, OUTSIDER), undefined);
    equal((await chargesOf(billing.id)).length, 2);
    await rejects(resolveGuest(db, OTHER_OWNER, billing.id, second.id, { action: 'add' }, now), HttpNotFoundError);
  });

  it('refuses to link a guest to a contact that has an e-mail', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const placeholder = await ContactRepository.save(db, OWNER, { name: 'Vago' });
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'invite-refuse',
      once({ split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: placeholder.userId }] } }),
      now
    );
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    const waiting = (await BillingRepository.get(db, OWNER, billing.id, now)).guests[0]!;
    const withEmail = await db.contacts.findOne({ select: { id: true }, where: { owner_id: OWNER, user_id: debtorId } });

    await rejects(resolveGuest(db, OWNER, billing.id, waiting.id, { action: 'link', contactId: withEmail!.id }, now), ApiError);
    equal((await BillingRepository.get(db, OWNER, billing.id, now)).guests.length, 1, 'a refused answer leaves the guest waiting');
  });

  it('rate-limits repeated acceptances of the same invite link', async () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const billing = await BillingRepository.create(db, OWNER, 'invite-throttle', once(), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    // The handler announces the guest's charge through the notice context, so the schedulers must exist.
    const context = {
      db,
      email: createEmailClient({ APP_STAGE: 'test', RESEND_API_KEY: 'disabled' }),
      chargeNotifyScheduler: fakeScheduler(),
      variables: {
        PUBLIC_LINK_HMAC_SECRET: SECRET,
        PUBLIC_WEB_ORIGIN: ORIGIN,
        EMAIL_TRANSPORT: 'disabled',
        NOTIFICATION_PUSH_TRANSPORT: 'disabled',
        RESEND_FROM_EMAIL: 'disabled'
      }
    } as unknown as Parameters<typeof acceptInviteHandler>[1];
    const request = {
      identity: { familyId: 'f1111111-1111-4111-8111-111111111111', userId: GUEST },
      parameters: { token: tokenOf(invite.url) }
    };

    // Accepting has its own bucket, wider than the preview read: 120 per window, so the 121st is refused.
    for (let attempt = 0; attempt < 120; attempt++) {
      await acceptInviteHandler(request, context);
    }

    await rejects(() => acceptInviteHandler(request, context), TooManyRequestsError);
    await db.proof_throttles.deleteMany({});
  });
});
