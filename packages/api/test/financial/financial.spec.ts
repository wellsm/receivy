import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { BillingFrequency, BillingType, ChargeState, Direction, PixKeyType, SplitMode, SplitPartKind } from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { ApiError } from '../../src/common/errors';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { PublicLinkRepository } from '../../src/public/repositories/public-link';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const TIMELINE_OVERFLOW_OWNER = '44444444-4444-4444-8444-444444444444';
const LEDGER_OVERFLOW_OWNER = '55555555-5555-4555-8555-555555555555';
const LEDGER_NEGATIVE_VIEWER = '66666666-6666-4666-8666-666666666666';
const LEDGER_NEGATIVE_COUNTERPART = '77777777-7777-4777-8777-777777777777';
const SECRET = 'native-ez4-test-public-link-secret';
const OVERFLOW_MESSAGE = 'O total financeiro deve estar entre -9007199254740991 e 9007199254740991 centavos.';

describe('financial repositories on PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');
    equal(database?.['name'], 'receivy_tests', 'financial integration tests must use the dedicated test database');
    await createUser(db, { id: OWNER, email: 'owner@example.com', name: 'Ana Silva' });
    await createUser(db, { id: STRANGER, email: 'stranger@example.com', name: 'Terceira Pessoa' });
  });

  after(async () =>
    cleanupUsers(db, [OWNER, STRANGER, TIMELINE_OVERFLOW_OWNER, LEDGER_OVERFLOW_OWNER, LEDGER_NEGATIVE_VIEWER, LEDGER_NEGATIVE_COUNTERPART])
  );

  it('keeps payment methods owner-scoped and returns post-update default state', async () => {
    const first = await PaymentMethodRepository.save(db, OWNER, {
      pixKeyType: PixKeyType.Cpf,
      pixKey: '529.982.247-25',
      label: 'Principal'
    });
    equal(first.isDefault, true);
    const edited = await PaymentMethodRepository.save(
      db,
      OWNER,
      { pixKeyType: PixKeyType.Random, pixKey: '123e4567-e89b-12d3-a456-426614174000', label: 'Editada' },
      first.id
    );
    equal(edited.pixKey, '123e4567-e89b-12d3-a456-426614174000');
    const second = await PaymentMethodRepository.save(db, OWNER, {
      pixKeyType: PixKeyType.Phone,
      pixKey: '+55 (11) 99876-5432',
      label: 'Telefone'
    });
    const madeDefault = await PaymentMethodRepository.makeDefault(db, OWNER, second.id);
    equal(madeDefault.isDefault, true);
    deepEqual(
      (await PaymentMethodRepository.list(db, OWNER)).filter((method) => method.isDefault).map((method) => method.id),
      [second.id]
    );
    deepEqual(await PaymentMethodRepository.list(db, STRANGER), []);
    await PaymentMethodRepository.archive(db, OWNER, second.id);
    deepEqual(
      (await PaymentMethodRepository.list(db, OWNER)).filter((method) => method.isDefault).map((method) => method.id),
      [first.id]
    );
  });

  it('binds idempotency to payload, reads the recipient live and keeps the Pix snapshot', async () => {
    const person = await ContactRepository.save(db, OWNER, { name: 'Bruno Original', email: 'bruno@example.com' });
    const debtor = person.userId;
    const pix = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '111.444.777-35', label: 'Despesa' });
    const input = {
      type: BillingType.Once as const,
      totalCents: 9_000,
      startDate: '2026-10-31',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed as const, parts: [{ kind: SplitPartKind.User as const, userId: person.userId, amountCents: 6_001 }] },
      paymentMethodId: pix.id
    };
    const created = await BillingRepository.create(db, OWNER, 'billing-idempotency', input);
    const replay = await BillingRepository.create(db, OWNER, 'billing-idempotency', input);
    equal(replay.id, created.id);
    equal((await BillingRepository.get(db, OWNER, created.id)).id, created.id);
    await rejects(() => BillingRepository.get(db, STRANGER, created.id), HttpNotFoundError);
    deepEqual(
      created.charges.map((charge) => charge.amount.amountCents),
      [6_001]
    );
    await rejects(() => BillingRepository.create(db, OWNER, 'billing-idempotency', { ...input, totalCents: 9_001 }), ApiError);

    // A pending contact cannot be moved onto an e-mail another account holds, so charge access never transfers.
    await rejects(
      () => ContactRepository.save(db, OWNER, { name: 'Contato Editado', email: 'stranger@example.com' }, person.id),
      ApiError,
      'changing a contact link must not transfer historical charge access'
    );
    await ContactRepository.save(db, OWNER, { name: 'Contato Editado', email: 'bruno@example.com' }, person.id);
    await PaymentMethodRepository.save(
      db,
      OWNER,
      { pixKeyType: PixKeyType.Random, pixKey: '9f1c5dd7-95d6-4a8a-a859-2d941eb3d28a', label: 'Nova' },
      pix.id
    );
    const snapshot = await ChargeRepository.get(db, OWNER, created.charges[0]!.id);
    deepEqual(snapshot.recipient, { userId: debtor, name: 'Contato Editado', email: 'bruno@example.com', avatar: null });
    equal(snapshot.pix?.key, '11144477735');
    await rejects(() => ChargeRepository.get(db, STRANGER, snapshot.id), HttpForbiddenError);
    await rejects(() => TimelineRepository.contactLedger(db, STRANGER, person.id), HttpNotFoundError);

    // The pending account created for the contact is the debtor: it sees the charge before any login.
    equal((await ChargeRepository.get(db, debtor, snapshot.id)).direction, 'payable');
    await rejects(() => ChargeRepository.cancel(db, debtor, snapshot.id), HttpForbiddenError);
    await rejects(() => ChargeRepository.pay(db, debtor, snapshot.id), HttpForbiddenError);
    await rejects(() => ChargeRepository.reopen(db, debtor, snapshot.id), HttpForbiddenError);
    await rejects(() => ChargeRepository.reopen(db, OWNER, snapshot.id), ApiError, 'only a paid charge can be reopened');
    await rejects(() => ChargeRepository.get(db, STRANGER, snapshot.id), HttpForbiddenError);
    await rejects(() => BillingRepository.create(db, debtor, 'foreign-person', input), HttpNotFoundError);

    const ownPerson = await ContactRepository.save(db, debtor, { name: 'Contato do devedor', email: 'debtor-contact@example.com' });
    await rejects(
      () =>
        BillingRepository.create(db, debtor, 'foreign-pix', {
          ...input,
          split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: ownPerson.userId, amountCents: 6_001 }] }
        }),
      HttpNotFoundError
    );
    await ContactRepository.archive(db, OWNER, person.id);
    await rejects(() => BillingRepository.create(db, OWNER, 'archived-person', input), HttpNotFoundError);
    await PaymentMethodRepository.archive(db, OWNER, pix.id);
    const active = await ContactRepository.save(db, OWNER, { name: 'Contato ativo', email: 'active-contact@example.com' });
    await rejects(
      () =>
        BillingRepository.create(db, OWNER, 'archived-pix', {
          ...input,
          split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: active.userId, amountCents: 6_001 }] }
        }),
      HttpNotFoundError
    );
  });

  it('serializes integral payment and preserves terminal charge state with audit', async () => {
    const person = await ContactRepository.save(db, OWNER, { name: 'Concorrente', email: 'concurrency@example.com' });
    const billing = await BillingRepository.create(db, OWNER, 'payment-concurrency', {
      type: BillingType.Once,
      totalCents: 1_000,
      startDate: '2026-11-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 1_000 }] }
    });
    const chargeId = billing.charges[0]!.id;
    const outcomes = await Promise.allSettled([ChargeRepository.pay(db, OWNER, chargeId), ChargeRepository.pay(db, OWNER, chargeId)]);
    equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    equal(outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason instanceof ApiError).length, 1);
    const paid = await db.charges.findOne({ select: { state: true, paid_at: true }, where: { id: chargeId } });
    equal(paid?.state, 'paid');
    ok(paid?.paid_at);
    equal(await db.events.count({ where: { eventable_id: chargeId, type: 'charge.paid' } }), 1, 'the winner settles once');
    equal((await ChargeRepository.get(db, OWNER, chargeId)).state, 'paid');
    await rejects(() => ChargeRepository.cancel(db, OWNER, chargeId), ApiError);

    const cancellable = await BillingRepository.create(db, OWNER, 'charge-cancellation', {
      type: BillingType.Once,
      totalCents: 750,
      startDate: '2026-11-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 750 }] }
    });
    const cancelled = await ChargeRepository.cancel(db, OWNER, cancellable.charges[0]!.id);
    equal(cancelled.state, 'cancelled');
    equal((await ChargeRepository.cancel(db, OWNER, cancelled.id)).state, 'cancelled');
    await rejects(() => ChargeRepository.pay(db, OWNER, cancelled.id), ApiError);
    const events = await db.events.findMany({ select: { type: true }, where: { eventable_id: chargeId } });
    ok(events.records.some((event) => event.type === 'charge.created'));
    ok(events.records.some((event) => event.type === 'charge.paid'));
    equal(await db.events.count({ where: { eventable_id: chargeId, type: 'charge.created' } }), 1);
  });

  it('returns one persisted result for simultaneous identical billing idempotency keys', async () => {
    const person = await ContactRepository.save(db, OWNER, { name: 'Idempotent race', email: 'idempotent-race@example.com' });
    const input = {
      type: BillingType.Until as const,
      frequency: BillingFrequency.Monthly as const,
      totalCents: 101,
      startDate: '2026-11-01',
      endDate: '2026-12-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed as const, parts: [{ kind: SplitPartKind.User as const, userId: person.userId, amountCents: 101 }] }
    };
    const [first, second] = await Promise.all([
      BillingRepository.create(db, OWNER, 'same-key-race', input),
      BillingRepository.create(db, OWNER, 'same-key-race', input)
    ]);
    deepEqual(first, second);
    equal(await db.billings.count({ where: { id: first.id } }), 1);
    equal(await db.allocations.count({ where: { billing_id: first.id } }), 2);
    equal(await db.charges.count({ where: { billing_id: first.id } }), 2);
    for (const charge of first.charges) {
      equal(await db.events.count({ where: { eventable_id: charge.id, type: 'charge.created' } }), 1);
    }
  });

  it('expires, rotates and revokes versioned public capabilities without leaking private fields', async () => {
    const person = await ContactRepository.save(db, OWNER, { name: 'Público', email: 'public@example.com' });
    const billing = await BillingRepository.create(db, OWNER, 'public-capability', {
      type: BillingType.Once,
      totalCents: 2_500,
      startDate: '2026-12-10',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 2_500 }] }
    });
    const chargeId = billing.charges[0]!.id;
    const first = await PublicLinkRepository.createOrRotate(db, OWNER, chargeId, SECRET, false, 1_000);
    deepEqual(
      Object.keys(await PublicLinkRepository.getCharge(db, first.token, SECRET, 1_001)).sort(),
      ['amount', 'creditorFirstName', 'description', 'dueDate', 'pix', 'state', 'uploadsEnabled'].sort()
    );
    const expiresAt = Math.floor(new Date(first.expiresAt).getTime() / 1000);
    await rejects(() => PublicLinkRepository.getCharge(db, first.token, SECRET, expiresAt), HttpNotFoundError);
    const rotated = await PublicLinkRepository.createOrRotate(db, OWNER, chargeId, SECRET, true, 2_000);
    notEqual(rotated.token, first.token);
    await rejects(() => PublicLinkRepository.getCharge(db, first.token, SECRET, 2_001), HttpNotFoundError);
    await PublicLinkRepository.revoke(db, OWNER, chargeId);
    await rejects(() => PublicLinkRepository.getCharge(db, rotated.token, SECRET, 2_001), HttpNotFoundError);
  });

  it('returns account-relative filtered timeline totals and a contact ledger', async () => {
    const person = await ContactRepository.save(db, OWNER, { name: 'Ledger', email: 'ledger@example.com' });
    const billing = await BillingRepository.create(db, OWNER, 'timeline-ledger', {
      type: BillingType.Until,
      frequency: BillingFrequency.Monthly,
      totalCents: 6_001,
      startDate: '2026-09-30',
      endDate: '2026-10-30',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 6_001 }] }
    });
    await ChargeRepository.pay(db, OWNER, billing.charges[0]!.id);
    const ownerTimeline = await TimelineRepository.get(db, OWNER, {
      direction: [Direction.Receivable],
      status: [ChargeState.Pending],
      type: [BillingType.Until],
      from: '2026-09-01',
      to: '2026-12-31'
    });
    ok(ownerTimeline.items.some((item) => item.kind === 'charge' && item.charge.id === billing.charges[1]!.id));
    equal(ownerTimeline.summary.receivable.amountCents >= 3_000, true);
    const ledger = await TimelineRepository.contactLedger(db, OWNER, person.id);
    // Each occurrence snapshots the full split amount; only the second (still pending) counts here.
    equal(ledger.balance.amountCents, 6_001);
    equal(ledger.charges.length, 2);
    const emptyPage = await TimelineRepository.contactLedger(db, OWNER, person.id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    equal(emptyPage.charges.length, 0);
    equal(emptyPage.balance.amountCents, 6_001, 'ledger totals must not change with its cursor');
  });

  it('rejects timeline summaries whose exact aggregate exceeds safe integer cents', async () => {
    await createUser(db, { id: TIMELINE_OVERFLOW_OWNER, email: 'timeline-overflow@example.com', name: 'Timeline Overflow' });
    const person = await ContactRepository.save(db, TIMELINE_OVERFLOW_OWNER, {
      name: 'Timeline debtor',
      email: 'timeline-debtor@example.com'
    });
    const first = await BillingRepository.create(db, TIMELINE_OVERFLOW_OWNER, 'timeline-overflow-max', {
      type: BillingType.Once,
      totalCents: Number.MAX_SAFE_INTEGER,
      startDate: '2027-01-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: Number.MAX_SAFE_INTEGER }] }
    });
    await BillingRepository.create(db, TIMELINE_OVERFLOW_OWNER, 'timeline-overflow-two', {
      type: BillingType.Once,
      totalCents: 2,
      startDate: '2027-01-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 2 }] }
    });

    equal((await ChargeRepository.get(db, TIMELINE_OVERFLOW_OWNER, first.charges[0]!.id)).amount.amountCents, 9_007_199_254_740_991);
    await rejects(
      () => TimelineRepository.get(db, TIMELINE_OVERFLOW_OWNER, {}),
      (error) => {
        ok(error instanceof ApiError);
        equal(error.message, OVERFLOW_MESSAGE);
        return true;
      }
    );
  });

  it('rejects a positive ledger balance outside safe integer cents', async () => {
    await createUser(db, { id: LEDGER_OVERFLOW_OWNER, email: 'ledger-overflow@example.com', name: 'Ledger Overflow' });
    const person = await ContactRepository.save(db, LEDGER_OVERFLOW_OWNER, { name: 'Ledger debtor', email: 'ledger-debtor@example.com' });
    await BillingRepository.create(db, LEDGER_OVERFLOW_OWNER, 'ledger-overflow-max', {
      type: BillingType.Once,
      totalCents: Number.MAX_SAFE_INTEGER,
      startDate: '2027-02-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: Number.MAX_SAFE_INTEGER }] }
    });
    await BillingRepository.create(db, LEDGER_OVERFLOW_OWNER, 'ledger-overflow-two', {
      type: BillingType.Once,
      totalCents: 2,
      startDate: '2027-02-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 2 }] }
    });

    await rejects(
      () => TimelineRepository.contactLedger(db, LEDGER_OVERFLOW_OWNER, person.id),
      (error) => {
        ok(error instanceof ApiError);
        equal(error.message, OVERFLOW_MESSAGE);
        return true;
      }
    );
  });

  it('rejects a negative ledger balance outside safe integer cents', async () => {
    await createUser(db, { id: LEDGER_NEGATIVE_VIEWER, email: 'negative-viewer@example.com', name: 'Negative Viewer' });
    await createUser(db, { id: LEDGER_NEGATIVE_COUNTERPART, email: 'negative-counterpart@example.com', name: 'Negative Counterpart' });
    const counterpart = await ContactRepository.save(db, LEDGER_NEGATIVE_VIEWER, {
      name: 'Counterpart',
      email: 'negative-counterpart@example.com'
    });
    const viewer = await ContactRepository.save(db, LEDGER_NEGATIVE_COUNTERPART, { name: 'Viewer', email: 'negative-viewer@example.com' });
    await BillingRepository.create(db, LEDGER_NEGATIVE_COUNTERPART, 'ledger-negative-max', {
      type: BillingType.Once,
      totalCents: Number.MAX_SAFE_INTEGER,
      startDate: '2027-03-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: viewer.userId, amountCents: Number.MAX_SAFE_INTEGER }] }
    });
    await BillingRepository.create(db, LEDGER_NEGATIVE_COUNTERPART, 'ledger-negative-two', {
      type: BillingType.Once,
      totalCents: 2,
      startDate: '2027-03-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: viewer.userId, amountCents: 2 }] }
    });

    await rejects(
      () => TimelineRepository.contactLedger(db, LEDGER_NEGATIVE_VIEWER, counterpart.id),
      (error) => {
        ok(error instanceof ApiError);
        equal(error.message, OVERFLOW_MESSAGE);
        return true;
      }
    );
  });
});
