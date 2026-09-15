import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  BillingCategory,
  BillingFrequency,
  type BillingInput,
  type BillingPatch,
  BillingType,
  ChargeState,
  calendarDate,
  Direction,
  EditScope,
  PixKeyType,
  SharingState,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { SettledLockedError } from '../../src/billings/errors';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { InviteRepository } from '../../src/invites/repositories/invite';
import { createInvite } from '../../src/invites/services/links';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../src/public/services/capability';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'f7777777-7777-4777-8777-777777777777';
const OTHER = 'f8888888-8888-4888-8888-888888888888';
const TZ = 'America/Sao_Paulo';
const SECRET = 'registros-spec-capability-secret';
const ORIGIN = 'http://localhost:3000';
const date = (value: string) => new Date(`${value}T12:00:00Z`);

/** Start of the civil day in São Paulo (UTC−3): where a registro's charge is paid. */
const dayStart = (day: string) => Date.parse(`${day}T03:00:00.000Z`);

/** 05:00 UTC is when the daily cron runs: 02:00 in São Paulo, so the day has already turned there. */
const cronAt = (day: string) => new Date(`${day}T05:00:00Z`);

let anaId: string;
let pixId: string;

/** A registro a receber: the owner alone, the counterpart typed by hand, due in February. */
function registro(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Once,
    description: key,
    category: BillingCategory.Income,
    totalCents: 500_000,
    startDate: '2026-02-20',
    timezone: TZ,
    settled: true,
    counterpartLabel: 'Empresa X',
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_user_id: true, due_date: true, state: true, paid_at: true, pix_key_snapshot: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

async function paidVia(chargeId: string) {
  return (await EventRepository.list(db, chargeId, 'charge.paid')).map((event) => event.payload['via']);
}

describe('registros on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'registros-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'registros-other@example.com', name: 'Outra' });

    anaId = (await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'registros-ana@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER]));

  it('refuses a registro without a name, with participants, a payee, Pix or reminders, and a recorrente in the past', async () => {
    const now = date('2026-03-05');
    const refuse = (key: string, input: BillingInput, message: string) =>
      rejects(() => BillingRepository.create(db, OWNER, key, input, now), { name: 'RangeError', message });
    const crowded = 'Registro não tem participantes nem avisos.';

    await refuse('registro-no-name', registro('Sem nome', { counterpartLabel: '  ' }), 'Informe de quem é o valor.');
    await refuse(
      'registro-no-name-payable',
      registro('Sem nome', { direction: Direction.Payable, counterpartLabel: undefined }),
      'Informe para quem é o valor.'
    );
    await refuse(
      'registro-participant',
      registro('Com Ana', { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } }),
      crowded
    );
    await refuse('registro-payee', registro('Para Ana', { direction: Direction.Payable, payeeUserId: anaId }), crowded);
    await refuse('registro-wallet', registro('Com chave', { paymentMethodId: pixId }), crowded);
    await refuse(
      'registro-pix',
      registro('Com Pix', { direction: Direction.Payable, pix: { keyType: PixKeyType.Email, key: 'loja@example.com' } }),
      crowded
    );
    await refuse('registro-reminders', registro('Com lembrete', { reminders: [{ offsetDays: 0, enabled: true }] }), crowded);
    await refuse(
      'registro-monthly-past',
      registro('Salário atrasado', { type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-03-01' }),
      'Registro recorrente começa hoje ou depois.'
    );
    await refuse(
      'registro-until-past',
      registro('Parcelas antigas', {
        type: BillingType.Until,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-02-01',
        endDate: '2026-06-01'
      }),
      'Registro recorrente começa hoje ou depois.'
    );
    await refuse(
      'receivable-owner-only',
      {
        type: BillingType.Once,
        totalCents: 1_000,
        startDate: '2026-03-10',
        timezone: TZ,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] }
      },
      'Selecione ao menos um contato.'
    );

    equal(await db.billings.count({ where: { owner_id: OWNER } }), 0, 'nothing was written');
  });

  it('pays a registro due by today at creation, on its due date, with nobody on the other side', async () => {
    const once = await BillingRepository.create(
      db,
      OWNER,
      'registro-past',
      registro('Venda do sofá', { counterpartLabel: '  Empresa X  ' }),
      date('2026-03-05')
    );

    equal(once.settled, true);
    equal(once.counterpartLabel, 'Empresa X');
    deepEqual(
      once.allocations.map((allocation) => allocation.kind),
      ['owner']
    );

    const [row] = await chargeRows(once.id);

    ok(row);
    equal(row.state, ChargeState.Paid);
    equal(row.debtor_user_id ?? null, null);
    equal(row.pix_key_snapshot ?? null, null, 'the default wallet key never reaches a registro');
    equal(Date.parse(String(row.paid_at)), dayStart('2026-02-20'));
    deepEqual(await paidVia(row.id), ['registered']);

    const detail = await ChargeRepository.get(db, OWNER, row.id);

    equal(detail.direction, Direction.Receivable);
    equal(detail.counterpartName, 'Empresa X');
    equal(detail.recipient.name, 'Empresa X');
    equal(detail.settled, true);
    equal(detail.counterpartLabel, 'Empresa X');
    equal(detail.sharingState, SharingState.Closed);
    equal(detail.pix, null);

    const rent = await BillingRepository.create(
      db,
      OWNER,
      'registro-past-payable',
      registro('Aluguel de fevereiro', {
        direction: Direction.Payable,
        counterpartLabel: 'Imobiliária',
        startDate: '2026-02-10',
        category: BillingCategory.Housing
      }),
      date('2026-03-05')
    );
    const own = await ChargeRepository.get(db, OWNER, rent.charges[0]!.id);

    equal(own.state, ChargeState.Paid);
    equal(own.direction, Direction.Payable);
    equal(own.counterpartName, 'Imobiliária');

    const bonus = await BillingRepository.create(
      db,
      OWNER,
      'registro-future',
      registro('Bônus', { startDate: '2026-03-20' }),
      date('2026-03-05')
    );

    equal(bonus.charges[0]!.state, ChargeState.Pending, 'a registro due later waits for its day');
    deepEqual(await paidVia(bonus.charges[0]!.id), []);
  });

  it('renames a registro and refuses to turn a conta into a registro or back', async () => {
    const once = await BillingRepository.create(db, OWNER, 'registro-rename', registro('Freela'), date('2026-03-05'));
    const renamed = await BillingRepository.patch(db, OWNER, once.id, { counterpartLabel: '  Empresa Y ' }, date('2026-03-06'));

    equal(renamed.counterpartLabel, 'Empresa Y');
    equal(renamed.charges[0]!.counterpartName, 'Empresa Y');
    equal(
      (await BillingRepository.patch(db, OWNER, once.id, { settled: true }, date('2026-03-06'))).settled,
      true,
      'the stored value is accepted'
    );

    await rejects(() => BillingRepository.patch(db, OWNER, once.id, { settled: false }, date('2026-03-06')), SettledLockedError);
    await rejects(
      () => BillingRepository.patch(db, OWNER, once.id, { reminders: [{ offsetDays: 0, enabled: true }] }, date('2026-03-06')),
      SettledLockedError
    );
    await rejects(() => BillingRepository.patch(db, OWNER, once.id, { counterpartLabel: ' ' }, date('2026-03-06')), {
      name: 'RangeError',
      message: 'Informe de quem é o valor.'
    });

    const dinner = await BillingRepository.create(
      db,
      OWNER,
      'registro-common',
      {
        type: BillingType.Once,
        description: 'Jantar',
        totalCents: 2_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-05')
    );

    equal(dinner.settled, false);
    equal(dinner.counterpartLabel, null);
    await rejects(
      () => BillingRepository.patch(db, OWNER, dinner.id, { counterpartLabel: 'Empresa X' }, date('2026-03-06')),
      SettledLockedError
    );
    await rejects(() => BillingRepository.patch(db, OWNER, dinner.id, { settled: true }, date('2026-03-06')), SettledLockedError);
  });

  it('lists a registro by its counterpart and counts it in the month it is due', async () => {
    const now = new Date();
    const today = calendarDate(now, TZ);
    const salary = await BillingRepository.create(db, OTHER, 'registro-timeline-salary', registro('Salário', { startDate: today }), now);

    await BillingRepository.create(
      db,
      OTHER,
      'registro-timeline-rent',
      registro('Aluguel', { direction: Direction.Payable, counterpartLabel: 'Imobiliária', startDate: today, totalCents: 120_000 }),
      now
    );

    const listed = (await BillingRepository.list(db, OTHER)).billings.find((billing) => billing.id === salary.id);

    equal(listed?.settled, true);
    equal(listed?.counterpartLabel, 'Empresa X');
    equal(listed?.participantCount, 0);

    const page = await TimelineRepository.get(db, OTHER, {});

    equal(page.summary.receivedTotal.amountCents, 500_000);
    equal(page.summary.paidTotal.amountCents, 120_000);
    equal(page.summary.receivable.amountCents, 0, 'nothing is left open');

    const item = page.items.find((entry) => entry.charge.billingId === salary.id);

    equal(item?.direction, Direction.Receivable);
    equal(item?.charge.counterpartName, 'Empresa X');
    equal(item?.charge.settled, true);
    equal(item?.charge.counterpartLabel, 'Empresa X');
  });

  it('settles each due charge of a registro once a day, never one somebody reopened', async () => {
    const commission = await BillingRepository.create(
      db,
      OWNER,
      'registro-cron-once',
      registro('Comissão', { startDate: '2026-04-20' }),
      date('2026-03-05')
    );
    const [pending] = await chargeRows(commission.id);

    ok(pending);
    equal(pending.state, ChargeState.Pending);

    await BillingRepository.settleRegistered(db, cronAt('2026-04-19'));
    equal((await chargeRows(commission.id))[0]?.state, ChargeState.Pending, 'not due yet');

    ok((await BillingRepository.settleRegistered(db, cronAt('2026-04-20'))) >= 1);

    const [paid] = await chargeRows(commission.id);

    equal(paid?.state, ChargeState.Paid);
    equal(Date.parse(String(paid?.paid_at)), dayStart('2026-04-20'));
    deepEqual(await paidVia(pending.id), ['registered']);

    await BillingRepository.settleRegistered(db, cronAt('2026-04-20'));
    deepEqual(await paidVia(pending.id), ['registered'], 'a second run changes nothing');

    await ChargeRepository.reopen(db, OWNER, pending.id);
    await BillingRepository.settleRegistered(db, cronAt('2026-04-21'));

    equal((await chargeRows(commission.id))[0]?.state, ChargeState.Pending, 'whoever reopened decided the money did not come in');
    deepEqual(await paidVia(pending.id), ['registered']);
  });

  it('pays the occurrence the sweep creates in the same pass and projects the whole total', async () => {
    const salary = await BillingRepository.create(
      db,
      OWNER,
      'registro-cron-salary',
      registro('Salário', { type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-05-10' }),
      date('2026-05-05')
    );

    deepEqual(
      (await chargeRows(salary.id)).map((row) => [row.due_date, row.state]),
      [['2026-05-10', ChargeState.Pending]]
    );
    equal(salary.previews[0]?.amount.amountCents, 500_000, 'a registro projects the whole total');

    ok((await BillingRepository.materializeDueBillings(db, undefined, cronAt('2026-06-10'))) >= 1);
    // June is born paid inside the sweep; May waits for the settlement step of the same run.
    deepEqual(
      (await chargeRows(salary.id)).map((row) => [row.due_date, row.state]),
      [
        ['2026-05-10', ChargeState.Pending],
        ['2026-06-10', ChargeState.Paid]
      ]
    );

    await BillingRepository.settleRegistered(db, cronAt('2026-06-10'));

    const rows = await chargeRows(salary.id);

    deepEqual(
      rows.map((row) => [row.due_date, row.state]),
      [
        ['2026-05-10', ChargeState.Paid],
        ['2026-06-10', ChargeState.Paid]
      ]
    );
    equal(Date.parse(String(rows[0]?.paid_at)), dayStart('2026-05-10'));
    equal(Date.parse(String(rows[1]?.paid_at)), dayStart('2026-06-10'));
  });

  it('refuses every field a registro never carries and keeps Pix off its charges', async () => {
    const salary = await BillingRepository.create(
      db,
      OWNER,
      'registro-locked',
      registro('Salário travado', { type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-07-10' }),
      date('2026-07-05')
    );

    equal((await chargeRows(salary.id)).length, 1, 'July is materialized and still pending');

    const refuse = async (field: string, patch: BillingPatch) => {
      await rejects(
        () => BillingRepository.patch(db, OWNER, salary.id, { ...patch, applyTo: EditScope.CurrentMonth }, date('2026-07-06')),
        SettledLockedError,
        field
      );

      for (const row of await chargeRows(salary.id)) {
        equal(row.pix_key_snapshot ?? null, null, `${field} never writes Pix onto a registro`);
      }
    };

    await refuse('split', { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } });
    await refuse('pix', { pix: { keyType: PixKeyType.Email, key: 'loja@example.com' } });
    await refuse('payeeUserId', { payeeUserId: anaId });
    await refuse('paymentMethodId', { paymentMethodId: pixId });
    await refuse('reminders', { reminders: [{ offsetDays: 0, enabled: true }] });
    await refuse('clearPaymentMethod', { clearPaymentMethod: true });
    await refuse('clearPix', { clearPix: true });
    await refuse('clearPayee', { clearPayee: true });
  });

  it('refuses to create or accept an invite on a registro', async () => {
    const freela = await BillingRepository.create(
      db,
      OWNER,
      'registro-invite',
      registro('Freela com convite', { startDate: '2026-03-20' }),
      date('2026-03-05')
    );

    await rejects(() => createInvite(db, OWNER, freela.id, SECRET, ORIGIN), SettledLockedError);
    equal(await db.billing_invites.count({ where: { billing_id: freela.id } }), 0, 'no invite was stored');

    // An invite that already exists must not let anyone into a registro either.
    const publicId = crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 24 * 60 * 60 * 1000).toISOString();

    await db.billing_invites.insertOne({
      data: {
        id: crypto.randomUUID(),
        billing: { id: freela.id },
        owner: { id: OWNER },
        public_id: publicId,
        expires_at: expiresAt,
        accepted_count: 0,
        created_at: new Date().toISOString()
      }
    });

    const token = issuePublicChargeToken({
      publicId,
      version: 1,
      expiresAtSeconds: Date.parse(expiresAt) / 1000,
      secret: SECRET,
      purpose: PublicTokenPurpose.Invite
    });

    await rejects(() => InviteRepository.accept(db, OTHER, token, SECRET), SettledLockedError);

    const detail = await BillingRepository.get(db, OWNER, freela.id);

    deepEqual(
      detail.allocations.map((allocation) => allocation.kind),
      ['owner']
    );
  });

  it('replays the creation of a recorrente registro after the day has turned', async () => {
    const input = registro('Salário repetido', {
      type: BillingType.Indefinite,
      frequency: BillingFrequency.Monthly,
      startDate: '2026-08-10'
    });
    const first = await BillingRepository.create(db, OWNER, 'registro-replay', input, cronAt('2026-08-10'));
    const replay = await BillingRepository.create(db, OWNER, 'registro-replay', input, cronAt('2026-08-11'));

    equal(replay.id, first.id);
    await rejects(() => BillingRepository.create(db, OWNER, 'registro-replay-late', input, cronAt('2026-08-11')), {
      name: 'RangeError',
      message: 'Registro recorrente começa hoje ou depois.'
    });
  });
});
