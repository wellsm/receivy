import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  BillingCategory,
  BillingFrequency,
  type BillingInput,
  BillingKind,
  type BillingPatch,
  BillingRecurrence,
  ChargeState,
  calendarDate,
  Direction,
  EditScope,
  PaymentProvider,
  PixKeyType,
  SharingState,
  SplitMode,
  SplitPartKind,
  chargeTotals,
  counterpartName
} from '@receivy/common';
import { ReceivableHasNoPayeeError, SettledLockedError } from '../../src/billings/errors';
import { LinkableType } from '../../src/public/schemas/link';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { getBilling, listBillings } from '../../src/billings/services/detail';
import { materializeDueBillings, settleRegistered } from '../../src/billings/services/materialize';
import { EventRepository } from '../../src/common/repositories/events';
import { acceptInvite } from '../../src/invites/services/invite';
import { createInvite } from '../../src/invites/services/links';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../src/public/services/capability';
import { charges, cleanupUsers, contacts, createUser, db, monthCharges, paymentMethods } from '../fixtures/financial';

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
/** The contact who pays the owner on a registro a receber, and the one who receives a registro a pagar. */
let empresaId: string;
let imobiliariaId: string;
/** A key of the contact a registro a pagar names: a registro pays through nothing, not even that one. */
let imobiliariaKeyId: string;
let otherEmpresaId: string;
let otherImobiliariaId: string;

/** A registro a receber: what Empresa X paid the owner, due in February. */
function registro(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    recurrence: BillingRecurrence.Once,
    description: key,
    category: BillingCategory.Income,
    totalCents: 500_000,
    startDate: '2026-02-20',
    timezone: TZ,
    kind: BillingKind.Record,
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: empresaId }] },
    ...overrides
  };
}

/** A registro a pagar: what the owner already paid the contact who receives it. */
function registroPago(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return registro(key, { split: undefined, contactId: imobiliariaId, ...overrides });
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_id: true, due_date: true, state: true, paid_at: true, payment_snapshot: true },
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

    anaId = (await contacts.save(OWNER, { name: 'Ana', email: 'registros-ana@example.com' })).userId;
    pixId = (await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '52998224725', label: 'Principal' })).id;
    empresaId = (await contacts.save(OWNER, { name: 'Empresa X' })).userId;
    imobiliariaId = (await contacts.save(OWNER, { name: 'Imobiliária' })).id;
    imobiliariaKeyId = (
      await paymentMethods.save(OWNER, {
        provider: PaymentProvider.Pix,
        kind: PixKeyType.Email,
        value: 'loja@example.com',
        label: 'Imobiliária',
        contactId: imobiliariaId
      })
    ).id;
    // A registro only ever names contacts of whoever owns it: the other owner keeps their own agenda.
    otherEmpresaId = (await contacts.save(OTHER, { name: 'Empresa X' })).userId;
    otherImobiliariaId = (await contacts.save(OTHER, { name: 'Imobiliária' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER]));

  it('refuses a registro without a counterpart, with a wallet key, a contact key or reminders, and a recorrente in the past', async () => {
    const now = date('2026-03-05');
    const refuse = (key: string, input: BillingInput, message: string) =>
      rejects(() => createBilling(db, OWNER, key, input, now), { name: 'RangeError', message });
    const crowded = 'Registro não tem avisos nem Pix.';

    await refuse('registro-no-name', registro('Sem nome', { split: undefined }), 'Selecione ao menos um contato.');
    await refuse('registro-wallet', registro('Com chave', { paymentMethodId: pixId }), crowded);
    await refuse('registro-contact-key', registroPago('Com chave do contato', { paymentMethodId: imobiliariaKeyId }), crowded);
    await refuse('registro-reminders', registro('Com lembrete', { reminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }] }), crowded);
    await refuse(
      'registro-monthly-past',
      registro('Salário atrasado', { recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-03-01' }),
      'Registro recorrente começa hoje ou depois.'
    );
    await refuse(
      'registro-until-past',
      registro('Parcelas antigas', {
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-02-01',
        endDate: '2026-06-01'
      }),
      'Registro recorrente começa hoje ou depois.'
    );
    await refuse(
      'receivable-owner-only',
      {
        recurrence: BillingRecurrence.Once,
        totalCents: 1_000,
        startDate: '2026-03-10',
        timezone: TZ,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] }
      },
      'Selecione ao menos um contato.'
    );

    equal(await db.billings.count({ where: { owner_id: OWNER } }), 0, 'nothing was written');
  });

  it('pays a registro due by today at creation, on its due date, naming who was on the other side', async () => {
    const once = await createBilling(db, OWNER, 'registro-past', registro('Venda do sofá'), date('2026-03-05'));

    equal(once.kind, BillingKind.Record);
    equal(once.contact, null, 'a registro a receber names its payer in the split, not a receiving contact');
    deepEqual(
      once.allocations.map((allocation) => allocation.kind),
      ['user']
    );

    const [row] = await chargeRows(once.id);

    ok(row);
    equal(row.state, ChargeState.Paid);
    equal(row.debtor_id, empresaId, 'whoever paid the owner sits on the debtor side');
    equal(row.payment_snapshot?.value ?? null, null, 'the default wallet key never reaches a registro');
    equal(Date.parse(String(row.paid_at)), dayStart('2026-02-20'));
    deepEqual(await paidVia(row.id), ['registered']);

    const detail = await charges.get(OWNER, row.id);

    equal(detail.direction, Direction.Receivable);
    equal(detail.counterpartName, 'Empresa X');
    equal(detail.recipient.name, 'Empresa X');
    equal(detail.kind, BillingKind.Record);
    equal(detail.sharingState, SharingState.Closed);
    equal(detail.payment, null);

    const rent = await createBilling(
      db,
      OWNER,
      'registro-past-payable',
      registroPago('Aluguel de fevereiro', { startDate: '2026-02-10', category: BillingCategory.Housing }),
      date('2026-03-05')
    );
    const own = await charges.get(OWNER, rent.charges[0]!.id);

    equal(own.state, ChargeState.Paid);
    equal(own.direction, Direction.Payable);
    equal(own.counterpartName, 'Imobiliária');

    const bonus = await createBilling(
      db,
      OWNER,
      'registro-future',
      registro('Bônus', { startDate: '2026-03-20' }),
      date('2026-03-05')
    );

    equal(bonus.charges[0]!.state, ChargeState.Pending, 'a registro due later waits for its day');
    deepEqual(await paidVia(bonus.charges[0]!.id), []);
  });

  it('keeps who is on the other side of a registro and refuses to turn a conta into a registro or back', async () => {
    const once = await createBilling(db, OWNER, 'registro-rename', registro('Freela'), date('2026-03-05'));

    equal(once.charges[0]!.counterpartName, 'Empresa X');
    equal(
      (await patchBilling(db, OWNER, once.id, { kind: BillingKind.Record }, date('2026-03-06'))).kind,
      BillingKind.Record,
      'the stored value is accepted'
    );

    await rejects(() => patchBilling(db, OWNER, once.id, { kind: BillingKind.Live }, date('2026-03-06')), SettledLockedError);
    await rejects(
      () => patchBilling(db, OWNER, once.id, { reminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }] }, date('2026-03-06')),
      SettledLockedError
    );
    await rejects(
      () => patchBilling(db, OWNER, once.id, { contactId: imobiliariaId }, date('2026-03-06')),
      SettledLockedError,
      'a registro never changes who was on the other side'
    );

    const dinner = await createBilling(
      db,
      OWNER,
      'registro-common',
      {
        recurrence: BillingRecurrence.Once,
        description: 'Jantar',
        totalCents: 2_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-05')
    );

    equal(dinner.kind, BillingKind.Live);
    equal(dinner.contact, null);

    await rejects(
      () => patchBilling(db, OWNER, dinner.id, { contactId: imobiliariaId }, date('2026-03-06')),
      ReceivableHasNoPayeeError,
      'a conta a receber never becomes the owner own bill'
    );
    await rejects(() => patchBilling(db, OWNER, dinner.id, { kind: BillingKind.Record }, date('2026-03-06')), SettledLockedError);
  });

  it('lists a registro by its counterpart and counts it in the month it is due', async () => {
    const now = new Date();
    const today = calendarDate(now, TZ);
    const salary = await createBilling(
      db,
      OTHER,
      'registro-timeline-salary',
      registro('Salário', {
        startDate: today,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: otherEmpresaId }] }
      }),
      now
    );

    await createBilling(
      db,
      OTHER,
      'registro-timeline-rent',
      registroPago('Aluguel', { contactId: otherImobiliariaId, startDate: today, totalCents: 120_000 }),
      now
    );

    const listed = (await listBillings(db, OTHER)).billings.find((billing) => billing.id === salary.id);

    equal(listed?.kind, BillingKind.Record);
    equal(listed?.contact, null);
    equal(listed?.participantCount, 1, 'a registro a receber names who paid the owner');

    const page = await monthCharges(db, OTHER, today.slice(0, 7));
    const totals = chargeTotals(page);

    equal(totals.receivable.paid.amountCents, 500_000);
    equal(totals.payable.paid.amountCents, 120_000);
    equal(totals.receivable.pending.amountCents, 0, 'nothing is left open');

    const item = page.find((entry) => entry.billingId === salary.id);

    equal(item?.type, Direction.Receivable);
    equal(counterpartName(item!), 'Empresa X');
    equal(item?.billing.kind, BillingKind.Record);
  });

  it('names the other side of a billing as the owner knows them, on the summary and on the detail', async () => {
    const now = date('2026-03-05');
    const salary = await createBilling(db, OWNER, 'registro-counterpart-salary', registro('Salário contraparte'), now);
    const rent = await createBilling(db, OWNER, 'registro-counterpart-rent', registroPago('Aluguel contraparte'), now);
    const split = await createBilling(
      db,
      OWNER,
      'registro-counterpart-split',
      registro('Rateio contraparte', { kind: undefined, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } }),
      now
    );

    // A registro a receber keeps its payer in the split, so only `counterpart` can name them.
    equal(salary.contact, null);
    equal(salary.counterpart?.name, 'Empresa X');
    equal(salary.counterpart?.userId, empresaId);
    // A conta a pagar names the very contact it pays.
    equal(rent.counterpart?.name, 'Imobiliária');
    equal(rent.counterpart?.id, rent.contact?.id);
    // A live conta a receber may have many payers: nobody stands for the other side.
    equal(split.counterpart, null);

    equal((await getBilling(db, OWNER, salary.id, now)).counterpart?.name, 'Empresa X');

    const billings = (await listBillings(db, OWNER)).billings;

    equal(billings.find((billing) => billing.id === salary.id)?.counterpart?.name, 'Empresa X');
    equal(billings.find((billing) => billing.id === rent.id)?.counterpart?.name, 'Imobiliária');
    equal(billings.find((billing) => billing.id === split.id)?.counterpart, null);
  });

  it('settles each due charge of a registro once a day, never one somebody reopened', async () => {
    const commission = await createBilling(
      db,
      OWNER,
      'registro-cron-once',
      registro('Comissão', { startDate: '2026-04-20' }),
      date('2026-03-05')
    );
    const [pending] = await chargeRows(commission.id);

    ok(pending);
    equal(pending.state, ChargeState.Pending);

    await settleRegistered(db, cronAt('2026-04-19'));

    equal((await chargeRows(commission.id))[0]?.state, ChargeState.Pending, 'not due yet');

    ok((await settleRegistered(db, cronAt('2026-04-20'))) >= 1);

    const [paid] = await chargeRows(commission.id);

    equal(paid?.state, ChargeState.Paid);
    equal(Date.parse(String(paid?.paid_at)), dayStart('2026-04-20'));
    deepEqual(await paidVia(pending.id), ['registered']);

    await settleRegistered(db, cronAt('2026-04-20'));

    deepEqual(await paidVia(pending.id), ['registered'], 'a second run changes nothing');

    await charges.reopen(OWNER, pending.id);
    await settleRegistered(db, cronAt('2026-04-21'));

    equal((await chargeRows(commission.id))[0]?.state, ChargeState.Pending, 'whoever reopened decided the money did not come in');
    deepEqual(await paidVia(pending.id), ['registered']);
  });

  it('pays the occurrence the sweep creates in the same pass and projects the whole total', async () => {
    const salary = await createBilling(
      db,
      OWNER,
      'registro-cron-salary',
      registro('Salário', { recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-05-10' }),
      date('2026-05-05')
    );

    deepEqual(
      (await chargeRows(salary.id)).map((row) => [row.due_date, row.state]),
      [['2026-05-10', ChargeState.Pending]]
    );
    equal(salary.previews[0]?.amount.amountCents, 500_000, 'a registro projects the whole total');

    ok((await materializeDueBillings(db, undefined, cronAt('2026-06-10'))) >= 1);
    // June is born paid inside the sweep; May waits for the settlement step of the same run.
    deepEqual(
      (await chargeRows(salary.id)).map((row) => [row.due_date, row.state]),
      [
        ['2026-05-10', ChargeState.Pending],
        ['2026-06-10', ChargeState.Paid]
      ]
    );

    await settleRegistered(db, cronAt('2026-06-10'));

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
    const salary = await createBilling(
      db,
      OWNER,
      'registro-locked',
      registro('Salário travado', { recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-07-10' }),
      date('2026-07-05')
    );

    equal((await chargeRows(salary.id)).length, 1, 'July is materialized and still pending');

    const refuse = async (field: string, patch: BillingPatch) => {
      await rejects(
        () => patchBilling(db, OWNER, salary.id, { ...patch, applyTo: EditScope.CurrentMonth }, date('2026-07-06')),
        SettledLockedError,
        field
      );

      for (const row of await chargeRows(salary.id)) {
        equal(row.payment_snapshot?.value ?? null, null, `${field} never writes Pix onto a registro`);
      }
    };

    await refuse('split', { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } });
    await refuse('contactId', { contactId: imobiliariaId });
    await refuse('paymentMethodId', { paymentMethodId: pixId });
    await refuse('reminders', { reminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }] });
    await refuse('clearPaymentMethod', { clearPaymentMethod: true });
  });

  it('refuses to create or accept an invite on a registro', async () => {
    const freela = await createBilling(
      db,
      OWNER,
      'registro-invite',
      registro('Freela com convite', { startDate: '2026-03-20' }),
      date('2026-03-05')
    );

    await rejects(() => createInvite(db, OWNER, freela.id, SECRET, ORIGIN), SettledLockedError);

    equal(
      await db.links.count({ where: { linkable_type: LinkableType.BillingInvite, linkable_id: freela.id } }),
      0,
      'no invite was stored'
    );

    // An invite that already exists must not let anyone into a registro either.
    const publicId = crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 24 * 60 * 60 * 1000).toISOString();

    await db.links.insertOne({
      data: {
        id: crypto.randomUUID(),
        linkable_type: LinkableType.BillingInvite,
        linkable_id: freela.id,
        public_id: publicId,
        expires_at: expiresAt,
        accepted_count: 0,
        created_at: new Date().toISOString()
      }
    });

    const token = issuePublicChargeToken({
      publicId,
      expiresAtSeconds: Date.parse(expiresAt) / 1000,
      secret: SECRET,
      purpose: PublicTokenPurpose.Invite
    });

    await rejects(() => acceptInvite(db, OTHER, token, SECRET), SettledLockedError);

    const detail = await getBilling(db, OWNER, freela.id);

    deepEqual(
      detail.allocations.map((allocation) => allocation.kind),
      ['user'],
      'nobody joined: the registro still names only who paid the owner'
    );
  });

  it('replays the creation of a recorrente registro after the day has turned', async () => {
    const input = registro('Salário repetido', {
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      startDate: '2026-08-10'
    });
    const first = await createBilling(db, OWNER, 'registro-replay', input, cronAt('2026-08-10'));
    const replay = await createBilling(db, OWNER, 'registro-replay', input, cronAt('2026-08-11'));

    equal(replay.id, first.id);

    await rejects(() => createBilling(db, OWNER, 'registro-replay-late', input, cronAt('2026-08-11')), {
      name: 'RangeError',
      message: 'Registro recorrente começa hoje ou depois.'
    });
  });
});
