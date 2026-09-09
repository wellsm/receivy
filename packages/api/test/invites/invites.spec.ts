import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpConflictError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { BillingInput } from '@receivy/common';
import { createBilling, getBilling } from '../../src/billings/repository';
import { acceptInvite, activeInvite, createInvite, getPublicInvite, revokeInvite } from '../../src/invites/repository';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { savePerson } from '../../src/people/repository';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const OTHER_OWNER = 'c2222222-2222-4222-8222-222222222222';
const GUEST = 'c3333333-3333-4333-8333-333333333333';
const STRANGER = 'c4444444-4444-4444-8444-444444444444';
const LINKED_OWNER = 'c5555555-5555-4555-8555-555555555555';
const GUEST_EMAIL = 'invite-guest@example.com';
const SECRET = 'invite-spec-capability-secret';
const ORIGIN = 'http://localhost:3000';
const DAY = 24 * 60 * 60 * 1000;

let personId: string;
let otherPersonId: string;
let pixId: string;

const tokenOf = (url: string) => url.slice(`${ORIGIN}/join/`.length);

function once(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: 'once',
    description: 'Churrasco',
    totalCents: 8_000,
    startDate: '2026-11-20',
    timezone: 'America/Sao_Paulo',
    paymentMethodId: pixId,
    category: 'food',
    split: { mode: 'equal', parts: [{ kind: 'person', personId }] },
    ...overrides
  };
}

async function personFor(ownerId: string, email: string) {
  return db.people.findOne({ select: { id: true, linked_user_id: true }, where: { owner_id: ownerId, active_email: email } });
}

async function chargesOf(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_person_id: true, amount_cents: true, due_date: true, installment: true, installment_count: true },
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
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        country: 'BR',
        currency: 'BRL',
        created_at: now,
        updated_at: now
      }
    });

    personId = (await savePerson(db, OWNER, { name: 'Caio', email: 'invite-debtor@example.com' })).id;
    otherPersonId = (await savePerson(db, OTHER_OWNER, { name: 'Caio', email: 'invite-other-debtor@example.com' })).id;
    pixId = (await savePaymentMethod(db, OWNER, { pixKeyType: 'cpf', pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER_OWNER, LINKED_OWNER, GUEST, STRANGER]));

  it('issues a join link, exposes it on the detail and revokes the previous invite', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const billing = await createBilling(db, OWNER, 'invite-issue', once(), now);
    const first = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    ok(first.url.startsWith(`${ORIGIN}/join/`));
    equal(first.expiresAt, new Date(now.getTime() + 30 * DAY).toISOString());

    const detail = await getBilling(db, OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(detail.invite, first);

    const second = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    ok(second.url !== first.url);
    equal((await getPublicInvite(db, tokenOf(first.url), SECRET, now)).expired, true);
    equal((await getPublicInvite(db, tokenOf(second.url), SECRET, now)).expired, false);
    deepEqual(await activeInvite(db, billing.id, SECRET, ORIGIN, now), second);

    await revokeInvite(db, OWNER, billing.id, now);

    equal(await activeInvite(db, billing.id, SECRET, ORIGIN, now), null);
    equal((await getPublicInvite(db, tokenOf(second.url), SECRET, now)).expired, true);
    await rejects(() => createInvite(db, OTHER_OWNER, billing.id, SECRET, ORIGIN, now), HttpNotFoundError);
  });

  it('answers the public view with the billing headline and hides forged tokens', async () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const billing = await createBilling(db, OWNER, 'invite-public', once({ description: 'Churrasco de sábado' }), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const view = await getPublicInvite(db, tokenOf(invite.url), SECRET, now);

    deepEqual(view, {
      creditorFirstName: 'Lucas',
      description: 'Churrasco de sábado',
      amount: { amountCents: 8_000, currency: 'BRL' },
      type: 'once',
      participantCount: 1,
      category: 'food',
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
    const billing = await createBilling(db, OWNER, 'invite-accept', once(), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const before = await chargesOf(billing.id);

    equal(before.length, 1);
    equal(before[0]!.amount_cents, 8_000);

    const result = await acceptInvite(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(result.billingId, billing.id);
    equal(result.joinedSplit, true);
    ok(result.chargeId);

    const guestPerson = await personFor(OWNER, GUEST_EMAIL);

    ok(guestPerson);
    equal(guestPerson.linked_user_id, GUEST);

    const detail = await getBilling(db, OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(
      detail.allocations.map((allocation) => [allocation.personId, allocation.amount.amountCents, allocation.order]),
      [
        [personId, 4_000, 0],
        [guestPerson.id, 4_000, 1]
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
    equal(after.find((charge) => charge.debtor_person_id === guestPerson.id)?.id, result.chargeId);

    // Only the newly inserted charge announces itself; the repriced one keeps its original event.
    equal(await db.outbox_events.count({ where: { aggregate_id: result.chargeId!, type: 'charge.created' } }), 1);
    equal(await db.outbox_events.count({ where: { aggregate_id: before[0]!.id, type: 'charge.created' } }), 1);
    equal(await db.activity_events.count({ where: { aggregate_id: result.chargeId!, subject_user_id: GUEST } }), 1);
    ok(await db.activity_events.count({ where: { aggregate_id: billing.id, type: 'billings.invite_accepted' } }));

    const publicId = tokenOf(invite.url).split('.')[0]!;
    const row = await db.billing_invites.findOne({ select: { accepted_count: true }, where: { public_id: publicId } });

    equal(row?.accepted_count, 1);

    const repeated = await acceptInvite(db, GUEST, tokenOf(invite.url), SECRET, now);

    deepEqual(repeated, { billingId: billing.id, chargeId: result.chargeId, joinedSplit: false });
    equal((await chargesOf(billing.id)).length, 2);
    equal(detail.allocations.length, 2);
    equal(await db.allocations.count({ where: { billing_id: billing.id } }), 2);
  });

  it('reprices every installment and numbers the guest charges like the originals', async () => {
    const now = new Date('2026-10-03T18:00:00Z');
    const billing = await createBilling(
      db,
      OWNER,
      'invite-until',
      once({ type: 'until', frequency: 'monthly', totalCents: 9_000, startDate: '2026-11-20', endDate: '2027-01-20' }),
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

    const result = await acceptInvite(db, GUEST, tokenOf(invite.url), SECRET, now);
    const guestPerson = (await personFor(OWNER, GUEST_EMAIL))!;

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

    const guestCharges = after.filter((charge) => charge.debtor_person_id === guestPerson.id);
    const ownerContactCharges = after.filter((charge) => charge.debtor_person_id === personId);

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
      equal(await db.outbox_events.count({ where: { aggregate_id: charge.id, type: 'charge.created' } }), 1);
    }

    for (const charge of before) {
      equal(await db.outbox_events.count({ where: { aggregate_id: charge.id, type: 'charge.created' } }), 1);
    }

    equal(result.chargeId, guestCharges[0]!.id);
  });

  it('refuses to reshape a split that already moved', async () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const paid = await createBilling(db, OWNER, 'invite-paid', once(), now);
    const paidInvite = await createInvite(db, OWNER, paid.id, SECRET, ORIGIN, now);

    await db.charges.updateOne({ where: { id: paid.charges[0]!.id }, data: { state: 'paid', paid_at: now.toISOString() } });
    await rejects(
      () => acceptInvite(db, GUEST, tokenOf(paidInvite.url), SECRET, now),
      (error: Error) => error instanceof HttpConflictError && error.message === 'Divisão já em andamento.'
    );
    equal(await db.allocations.count({ where: { billing_id: paid.id } }), 1);
    equal((await chargesOf(paid.id)).length, 1);

    const proofed = await createBilling(db, OWNER, 'invite-proofed', once(), now);
    const proofedInvite = await createInvite(db, OWNER, proofed.id, SECRET, ORIGIN, now);

    await db.payment_proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: proofed.charges[0]!.id },
        object_key: `invite-spec/${proofed.charges[0]!.id}.pdf`,
        original_name: 'comprovante.pdf',
        mime: 'application/pdf',
        size: 1_024,
        sha256: 'a'.repeat(64),
        state: 'pending',
        created_at: now.toISOString()
      }
    });
    await rejects(
      () => acceptInvite(db, GUEST, tokenOf(proofedInvite.url), SECRET, now),
      (error: Error) => error instanceof HttpConflictError && error.message === 'Divisão já em andamento.'
    );
    equal(await db.allocations.count({ where: { billing_id: proofed.id } }), 1);
  });

  it('keeps indefinite billings on allocations only and fixed splits on contact only', async () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const endless = await createBilling(
      db,
      OWNER,
      'invite-indefinite',
      once({ type: 'indefinite', frequency: 'monthly', startDate: '2026-10-05', paymentMethodId: pixId }),
      now
    );
    const endlessInvite = await createInvite(db, OWNER, endless.id, SECRET, ORIGIN, now);
    const joined = await acceptInvite(db, GUEST, tokenOf(endlessInvite.url), SECRET, now);

    deepEqual(joined, { billingId: endless.id, chargeId: null, joinedSplit: true });
    equal(await db.allocations.count({ where: { billing_id: endless.id } }), 2);
    equal((await chargesOf(endless.id)).length, 0);

    const fixed = await createBilling(
      db,
      OWNER,
      'invite-fixed',
      once({ split: { mode: 'fixed', parts: [{ kind: 'person', personId, amountCents: 5_000 }] } }),
      now
    );
    const fixedInvite = await createInvite(db, OWNER, fixed.id, SECRET, ORIGIN, now);
    const contactOnly = await acceptInvite(db, GUEST, tokenOf(fixedInvite.url), SECRET, now);

    deepEqual(contactOnly, { billingId: fixed.id, chargeId: null, joinedSplit: false });
    equal(await db.allocations.count({ where: { billing_id: fixed.id, kind: 'person' } }), 1);
    equal((await chargesOf(fixed.id)).length, 1);
  });

  it('rejects the owner, an unconfirmed address and an expired link', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const billing = await createBilling(db, OWNER, 'invite-guards', once(), now);
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);

    await rejects(
      () => acceptInvite(db, OWNER, tokenOf(invite.url), SECRET, now),
      (error: Error) => error instanceof HttpConflictError && error.message === 'Você é o dono desta cobrança.'
    );
    await rejects(
      () => acceptInvite(db, STRANGER, tokenOf(invite.url), SECRET, now),
      (error: Error) => error instanceof HttpForbiddenError && error.message === 'Confirme seu e-mail antes de participar.'
    );

    const stale = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, new Date(now.getTime() - 31 * DAY));

    equal((await getPublicInvite(db, tokenOf(stale.url), SECRET, now)).expired, true);
    await rejects(() => acceptInvite(db, GUEST, tokenOf(stale.url), SECRET, now), HttpNotFoundError);
  });

  it('links an existing unlinked contact instead of duplicating it', async () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const stamp = now.toISOString();

    await db.people.insertOne({
      data: {
        id: crypto.randomUUID(),
        owner: { id: OTHER_OWNER },
        name: 'Bruna',
        active_email: GUEST_EMAIL,
        created_at: stamp,
        updated_at: stamp
      }
    });

    const billing = await createBilling(
      db,
      OTHER_OWNER,
      'invite-existing-contact',
      {
        type: 'once',
        description: 'Mercado',
        totalCents: 6_000,
        startDate: '2026-11-20',
        timezone: 'America/Sao_Paulo',
        split: { mode: 'shares', parts: [{ kind: 'person', personId: otherPersonId, shares: 2 }] }
      },
      now
    );
    const invite = await createInvite(db, OTHER_OWNER, billing.id, SECRET, ORIGIN, now);
    const result = await acceptInvite(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(result.joinedSplit, true);
    equal(await db.people.count({ where: { owner_id: OTHER_OWNER, active_email: GUEST_EMAIL } }), 1);

    const linked = await personFor(OTHER_OWNER, GUEST_EMAIL);

    equal(linked?.linked_user_id, GUEST);

    const detail = await getBilling(db, OTHER_OWNER, billing.id, now, { secret: SECRET, webOrigin: ORIGIN });

    deepEqual(
      detail.allocations.map((allocation) => [allocation.personId, allocation.shares, allocation.amount.amountCents]),
      [
        [otherPersonId, 2, 4_000],
        [linked!.id, 1, 2_000]
      ]
    );
  });

  it('refuses the acceptance when the matching contact already belongs to another account', async () => {
    const now = new Date('2026-10-08T12:00:00Z');
    const stamp = now.toISOString();
    const debtorId = (await savePerson(db, LINKED_OWNER, { name: 'Caio', email: 'invite-linked-debtor@example.com' })).id;

    await db.people.insertOne({
      data: {
        id: crypto.randomUUID(),
        owner: { id: LINKED_OWNER },
        linked_user: { id: STRANGER },
        name: 'Bruna',
        active_email: GUEST_EMAIL,
        created_at: stamp,
        updated_at: stamp
      }
    });

    const billing = await createBilling(
      db,
      LINKED_OWNER,
      'invite-linked-contact',
      {
        type: 'once',
        description: 'Feira',
        totalCents: 6_000,
        startDate: '2026-11-20',
        timezone: 'America/Sao_Paulo',
        split: { mode: 'equal', parts: [{ kind: 'person', personId: debtorId }] }
      },
      now
    );
    const invite = await createInvite(db, LINKED_OWNER, billing.id, SECRET, ORIGIN, now);

    await rejects(() => acceptInvite(db, GUEST, tokenOf(invite.url), SECRET, now), HttpConflictError);

    const contact = await personFor(LINKED_OWNER, GUEST_EMAIL);

    equal(contact?.linked_user_id, STRANGER);
    equal(await db.people.count({ where: { owner_id: LINKED_OWNER, active_email: GUEST_EMAIL } }), 1);
  });
});
