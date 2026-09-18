// Local-only QA seed. Fills one account with people, Pix keys, contas and cobranças spread over past,
// current and future months, so every feed, list, detail and proof state can be exercised by hand.
// Every row the seed owns has a stable id: rerunning resets those rows and keeps anything created in the app.
// Refuses anything but a loopback database, and never runs with APP_STAGE=prd. Usage (from packages/api):
//   pnpm seed:local voce@example.com
//   pnpm seed:local voce@example.com --dry-run   (runs every insert, then rolls back)

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '@ez4/pgclient/driver';

const TIMEZONE = 'America/Sao_Paulo';
const PROOF_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.ez4', 'proof-files');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const dryRun = args.includes('--dry-run');
const ownerEmail = args
  .find((arg) => !arg.startsWith('--'))
  ?.trim()
  .toLowerCase();

if (!ownerEmail) {
  throw new Error('usage: seed-local.mjs <owner e-mail> [--dry-run]');
}

// local.env may carry APP_STAGE=dev while pointing at the Docker database: the loopback check below is the real guard.
if (process.env.APP_STAGE === 'prd') {
  throw new Error('Refusing: APP_STAGE is prd.');
}

if (!process.env.EZ4_RAW_PG_DB_URL) {
  throw new Error('EZ4_RAW_PG_DB_URL is not set.');
}

const url = new URL(process.env.EZ4_RAW_PG_DB_URL);

if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Refusing: database is not loopback.');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Name-based UUID (version 5 layout): the same seed entity gets the same id on every run. */
function seedId(name) {
  const hex = sha256(`receivy-seed:${name}`);
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Calendar helpers. Dates are civil `YYYY-MM-DD` strings in the owner's timezone, like the API stores them.

const pad = (value) => String(value).padStart(2, '0');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
  new Date()
);

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);

  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

/** `months` after the month of `base`, on `day` clamped to that month's last day. */
function monthDay(months, day, base = today) {
  const total = Number(base.slice(0, 4)) * 12 + Number(base.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

const endOfMonth = (date) => monthDay(0, 31, date);
const earlier = (left, right) => (left < right ? left : right);
const later = (left, right) => (left > right ? left : right);
const past = (date) => date < today;

/** A civil date and hour in São Paulo as an instant, never later than now. */
function instant(date, hour = 12) {
  return new Date(Math.min(Date.parse(`${date}T${pad(hour)}:00:00-03:00`), Date.now())).toISOString();
}

function occurrences(startDate, step, until, limit, day) {
  const dates = [];

  for (let index = 0; index < limit; index++) {
    const date = monthDay(index * step, day, startDate);

    if (date > until) {
      break;
    }

    dates.push(date);
  }

  return dates;
}

/** Same arithmetic as `distribute` in @receivy/common: floor by weight, leftover cents to the largest remainders. */
function distribute(total, weights) {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  const values = weights.map((weight) => Math.floor((total * weight) / denominator));
  const ranked = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % denominator }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  let residual = total - values.reduce((sum, value) => sum + value, 0);

  for (const { index } of ranked) {
    if (!residual) {
      break;
    }

    values[index]++;
    residual--;
  }

  return values;
}

/** Same result as `resolveBillingSplit`: fixed parts leave the rest to the owner, every other mode splits by weight. */
function allocate(totalCents, split) {
  if (split.mode === 'fixed') {
    const used = split.parts.reduce((sum, part) => sum + part.amountCents, 0);

    return [...split.parts, { owner: true, amountCents: totalCents - used }];
  }

  const weights = split.parts.map((part) => (split.mode === 'equal' ? 1 : split.mode === 'shares' ? part.shares : part.basisPoints));
  const amounts = distribute(totalCents, weights);

  return split.parts.map((part, index) => ({ ...part, amountCents: amounts[index] }));
}

const money = (cents) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

/** A one-page PDF receipt; the proof viewer only needs real bytes behind the stored key. */
function proofPdf(lines) {
  const text = lines.map((line, index) => `BT /F1 ${index ? 12 : 18} Tf 56 ${770 - index * 26} Td (${line}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  const offsets = [];

  let body = '%PDF-1.4\n';

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xref = Buffer.byteLength(body, 'latin1');
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');

  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(body, 'latin1');
}

// The scenario. `me` is the owner passed on the command line; every other person is a seed account.

const PEOPLE = {
  marina: { name: 'Marina Alves', email: 'marina.alves@seed.receivy.test', phone: '+5511987650001', status: 'active' },
  caio: { name: 'Caio Ribeiro', email: 'caio.ribeiro@seed.receivy.test', status: 'pending' },
  rafa: { name: 'Rafael Duarte', email: 'rafa.duarte@seed.receivy.test', phone: '+5521987650003', status: 'active', nickname: 'Rafa' },
  ana: { name: 'Ana Paula Souza', email: 'ana.paula@seed.receivy.test', status: 'active' },
  joao: { name: 'João Pedro Lima', phone: '+5531987650005', status: 'pending' },
  bia: { name: 'Beatriz Nogueira', email: 'bia.nogueira@seed.receivy.test', status: 'pending' },
  // No e-mail and no phone: nothing can reach her, so the feed never offers "Lembrar".
  paula: { name: 'Paula Mendes', status: 'pending' },
  lucas: { name: 'Lucas Martins', email: 'lucas.martins@seed.receivy.test', status: 'pending', archived: true }
};

/** Keys of `me`, and of the seed people who bill `me` back. */
const PIX_KEYS = {
  me: {
    email: { type: 'email', key: 'recebimentos@seed.receivy.test', label: 'E-mail de recebimentos', preferred: true },
    phone: { type: 'phone', key: '+5511987654321', label: 'Celular' },
    cpf: { type: 'cpf', key: '52998224725', label: 'CPF' },
    random: { type: 'random', key: seedId(`pix-key:${ownerEmail}`), label: 'Chave aleatória' },
    old: { type: 'cnpj', key: '11222333000181', label: 'CNPJ da antiga empresa', archived: true }
  },
  rafa: { email: { type: 'email', key: 'rafa.duarte@seed.receivy.test', label: 'E-mail', preferred: true } },
  marina: { phone: { type: 'phone', key: '+5511987650001', label: 'Celular', preferred: true } }
};

const BILLINGS = [
  {
    key: 'aluguel',
    description: 'Aluguel do apartamento',
    category: 'housing',
    type: 'until',
    frequency: 'monthly',
    startDate: monthDay(-3, 10),
    count: 12,
    totalCents: 186000,
    pix: 'email',
    split: {
      mode: 'shares',
      parts: [
        { owner: true, shares: 1 },
        { person: 'marina', shares: 2 },
        { person: 'caio', shares: 1, silenced: true }
      ]
    },
    outcome: ({ dueDate, person, index }) => {
      if (person === 'marina' && index === 1) {
        return 'proof_accepted';
      }

      if (person === 'marina' && index === 3) {
        return 'proof_pending';
      }

      if (person === 'caio' && index === 2) {
        return 'pending';
      }

      return past(dueDate) ? 'paid' : 'pending';
    }
  },
  {
    key: 'streaming',
    description: 'Streaming da família',
    category: 'subscription',
    direction: 'payable',
    type: 'indefinite',
    frequency: 'monthly',
    startDate: monthDay(-5, 15),
    totalCents: 5590,
    payee: 'ana',
    typedPix: { type: 'phone', key: '+5511955554444', label: 'Ana Paula' },
    outcome: ({ dueDate }) => (past(dueDate) ? 'paid' : 'pending')
  },
  {
    key: 'mercado',
    description: 'Mercado da semana',
    category: 'groceries',
    type: 'once',
    startDate: today,
    totalCents: 42000,
    pix: 'phone',
    split: { mode: 'equal', parts: [{ owner: true }, { person: 'rafa' }, { person: 'marina' }] },
    outcome: ({ person }) => (person === 'rafa' ? 'proof_pending' : 'declared')
  },
  {
    key: 'emprestimo',
    description: 'Empréstimo para o Caio',
    category: 'loan',
    type: 'once',
    startDate: addDays(today, -12),
    totalCents: 40000,
    pix: 'email',
    // Only this charge is silenced: Caio's allocation still notifies.
    silenceCharge: true,
    split: { mode: 'fixed', parts: [{ person: 'caio', amountCents: 40000 }] },
    outcome: () => 'pending'
  },
  {
    key: 'academia',
    description: 'Academia (plano família)',
    category: 'health',
    type: 'indefinite',
    frequency: 'monthly',
    startDate: monthDay(-6, 5),
    totalCents: 18000,
    pix: 'cpf',
    split: {
      mode: 'percentage',
      parts: [
        { person: 'joao', basisPoints: 6000 },
        { person: 'bia', basisPoints: 4000 }
      ]
    },
    outcome: ({ dueDate, person, index }) => {
      if (person === 'bia' && index === 1) {
        return 'cancelled';
      }

      if (index === 5) {
        return person === 'bia' ? 'proof_rejected' : 'pending';
      }

      return past(dueDate) ? 'paid' : 'pending';
    }
  },
  {
    key: 'internet',
    description: 'Internet de casa',
    category: 'housing',
    type: 'indefinite',
    frequency: 'monthly',
    dueRule: 'end_of_month',
    startDate: endOfMonth(monthDay(-2, 1)),
    totalCents: 12000,
    pix: 'email',
    split: { mode: 'equal', parts: [{ owner: true }, { person: 'marina' }] },
    outcome: ({ dueDate }) => (past(dueDate) ? 'paid' : 'pending')
  },
  {
    key: 'condominio',
    description: 'Condomínio',
    category: 'housing',
    direction: 'payable',
    type: 'until',
    frequency: 'monthly',
    startDate: monthDay(-2, 8),
    count: 6,
    totalCents: 72000,
    // No payee and no Pix: the feed settles it in place with "Marcar pago".
    outcome: ({ dueDate }) => (past(dueDate) ? 'paid' : 'pending')
  },
  {
    key: 'viagem',
    description: 'Viagem para Florianópolis',
    category: 'travel',
    type: 'until',
    frequency: 'monthly',
    startDate: monthDay(1, 20),
    count: 3,
    totalCents: 120000,
    pix: 'random',
    split: { mode: 'equal', parts: [{ owner: true }, { person: 'marina' }, { person: 'rafa' }, { person: 'ana' }] },
    outcome: () => 'pending'
  },
  {
    key: 'seguro',
    description: 'Seguro do carro',
    category: 'transport',
    direction: 'payable',
    type: 'indefinite',
    frequency: 'yearly',
    startDate: monthDay(-12, 25),
    totalCents: 238000,
    typedPix: { type: 'cnpj', key: '11444777000161', label: 'Seguradora' },
    outcome: ({ dueDate }) => (past(dueDate) ? 'paid' : 'pending')
  },
  {
    key: 'churrasco',
    description: 'Churrasco de aniversário',
    category: 'food',
    type: 'once',
    state: 'ended',
    startDate: addDays(today, -20),
    totalCents: 50000,
    pix: 'phone',
    split: { mode: 'equal', parts: [{ owner: true }, { person: 'rafa' }, { person: 'ana' }, { person: 'bia' }, { person: 'joao' }] },
    outcome: ({ person }) => (person === 'ana' ? 'proof_accepted' : 'paid')
  },
  {
    key: 'van',
    description: 'Van da escola',
    category: 'transport',
    type: 'indefinite',
    frequency: 'monthly',
    state: 'paused',
    startDate: monthDay(-4, 3),
    until: monthDay(-1, 3),
    totalCents: 38000,
    pix: 'email',
    split: { mode: 'fixed', parts: [{ person: 'paula', amountCents: 38000 }] },
    outcome: ({ index }) => (index === 3 ? 'pending' : 'paid')
  },
  {
    key: 'curso',
    description: 'Curso de inglês',
    category: 'education',
    type: 'until',
    frequency: 'monthly',
    state: 'ended',
    startDate: monthDay(-5, 12),
    count: 6,
    totalCents: 25000,
    pix: 'email',
    split: { mode: 'fixed', parts: [{ person: 'lucas', amountCents: 25000 }] },
    outcome: ({ index }) => (index < 3 ? 'paid' : 'cancelled')
  },
  {
    key: 'luz',
    description: 'Conta de luz',
    category: 'other',
    direction: 'payable',
    type: 'once',
    startDate: addDays(today, 1),
    totalCents: 18745,
    typedPix: { type: 'email', key: 'contas@energia.seed.receivy.test', label: 'Companhia de energia' },
    outcome: () => 'pending'
  },
  {
    key: 'salario',
    description: 'Salário',
    category: 'income',
    type: 'indefinite',
    frequency: 'monthly',
    startDate: monthDay(-3, 5),
    totalCents: 850000,
    // A registro: no participants and no Pix; every occurrence is paid on its due date.
    settled: true,
    counterpartLabel: 'Empresa X',
    outcome: ({ dueDate }) => (dueDate <= today ? 'paid' : 'pending')
  },
  {
    key: 'dentista',
    description: 'Consulta no dentista',
    category: 'health',
    direction: 'payable',
    type: 'once',
    startDate: monthDay(-1, 18),
    totalCents: 35000,
    settled: true,
    counterpartLabel: 'Clínica Sorriso',
    outcome: () => 'paid'
  },
  {
    key: 'pizza',
    owner: 'rafa',
    description: 'Pizza de sexta',
    category: 'food',
    type: 'once',
    startDate: addDays(today, 2),
    totalCents: 9600,
    pix: 'email',
    split: { mode: 'equal', parts: [{ owner: true }, { person: 'me' }] },
    outcome: () => 'pending'
  },
  {
    key: 'presente',
    owner: 'marina',
    description: 'Presente da Júlia',
    category: 'leisure',
    type: 'once',
    startDate: addDays(today, -5),
    totalCents: 7500,
    pix: 'phone',
    split: { mode: 'fixed', parts: [{ person: 'me', amountCents: 7500 }] },
    outcome: () => 'proof_rejected'
  }
];

// Row builders.

/** A registro is paid at the start of its due day; anything else some time before it, or when its proof was accepted. */
function paidAtOf(billing, charge, createdAtCharge, dueDate) {
  if (billing.settled) {
    return instant(dueDate, 0);
  }

  return charge.proof_reviewed_at ?? later(createdAtCharge, instant(earlier(addDays(dueDate, -1), today), 18));
}

function paidVia(billing, proof) {
  if (billing.settled) {
    return 'registered';
  }

  return proof ? 'proof' : 'manual';
}

function dueDatesOf(billing) {
  const day = billing.dueRule === 'end_of_month' ? 31 : Number(billing.startDate.slice(8, 10));

  if (billing.type === 'once') {
    return [billing.startDate];
  }

  if (billing.type === 'until') {
    return occurrences(billing.startDate, 1, '9999-12-31', billing.count, day);
  }

  // An active assinatura is materialized through the month end (default reminder: due date only).
  return occurrences(billing.startDate, billing.frequency === 'yearly' ? 12 : 1, billing.until ?? endOfMonth(today), 120, day);
}

function buildSeed(ownerId) {
  const userIdOf = (person) => (person === 'me' ? ownerId : seedId(`user:${person}`));
  const now = new Date().toISOString();
  const rows = { users: [], contacts: [], payment_methods: [], billings: [], allocations: [], charges: [], events: [] };
  const files = [];

  const event = (type, eventableType, eventableId, actorId, payload, at) => {
    rows.events.push({
      id: seedId(`event:${eventableId}:${type}`),
      eventable_type: eventableType,
      eventable_id: eventableId,
      type,
      actor_user_id: actorId,
      payload: JSON.stringify(payload),
      created_at: at
    });
  };

  for (const [key, person] of Object.entries(PEOPLE)) {
    rows.users.push({
      id: userIdOf(key),
      email: person.email ?? null,
      verified_email: person.status === 'active' ? person.email : null,
      name: person.name,
      phone: person.phone ?? null,
      status: person.status,
      locale: 'pt-BR',
      timezone: TIMEZONE,
      country: 'BR',
      currency: 'BRL',
      created_at: instant(monthDay(-8, 1)),
      updated_at: now,
      deleted_at: null
    });

    rows.contacts.push({
      id: seedId(`contact:${ownerEmail}:${key}`),
      owner_id: ownerId,
      user_id: userIdOf(key),
      nickname: person.nickname ?? null,
      archived_at: person.archived ? instant(monthDay(-1, 20)) : null,
      created_at: instant(monthDay(-7, 1)),
      updated_at: now
    });
  }

  // The people who bill `me` back need `me` in their own agenda.
  for (const key of ['rafa', 'marina']) {
    rows.contacts.push({
      id: seedId(`contact:${ownerEmail}:${key}->me`),
      owner_id: userIdOf(key),
      user_id: ownerId,
      nickname: null,
      archived_at: null,
      created_at: instant(monthDay(-7, 1)),
      updated_at: now
    });
  }

  const pixIds = {};

  for (const [holder, keys] of Object.entries(PIX_KEYS)) {
    for (const [name, pix] of Object.entries(keys)) {
      const id = seedId(`pix:${holder === 'me' ? ownerEmail : holder}:${name}`);

      pixIds[`${holder}:${name}`] = { id, ...pix };
      rows.payment_methods.push({
        id,
        owner_id: userIdOf(holder),
        type: 'pix',
        pix_key_type: pix.type,
        pix_key: pix.key,
        label: pix.label,
        is_default: !!pix.preferred,
        archived_at: pix.archived ? instant(monthDay(-3, 1)) : null,
        created_at: instant(monthDay(-7, 2)),
        updated_at: now
      });
    }
  }

  for (const billing of BILLINGS) {
    const holder = billing.owner ?? 'me';
    const creditorId = userIdOf(holder);
    const payable = billing.direction === 'payable';
    const dates = dueDatesOf(billing);
    const billingId = seedId(`billing:${ownerEmail}:${billing.key}`);
    const createdAt = instant(earlier(addDays(dates[0], -15), today), 10);
    const wallet = billing.pix ? pixIds[`${holder}:${billing.pix}`] : undefined;
    const snapshot = payable ? billing.typedPix : wallet;
    const split = billing.split ?? { mode: 'equal', parts: [{ owner: true }] };
    const allocations = allocate(billing.totalCents, split);

    rows.billings.push({
      id: billingId,
      owner_id: creditorId,
      type: billing.type,
      frequency: billing.type === 'once' ? null : billing.frequency,
      description: billing.description,
      category: billing.category,
      total_cents: billing.totalCents,
      currency: 'BRL',
      start_date: billing.startDate,
      end_date: billing.type === 'until' ? dates.at(-1) : null,
      due_rule: billing.dueRule ?? 'fixed',
      timezone: TIMEZONE,
      payment_method_id: payable ? null : (wallet?.id ?? null),
      direction: payable ? 'payable' : 'receivable',
      payee_user_id: billing.payee ? userIdOf(billing.payee) : null,
      pix_key_type: payable ? (billing.typedPix?.type ?? null) : null,
      pix_key: payable ? (billing.typedPix?.key ?? null) : null,
      pix_label: payable ? (billing.typedPix?.label ?? null) : null,
      counterpart_label: billing.counterpartLabel ?? null,
      settled: billing.settled ? true : null,
      reminders: null,
      state: billing.state ?? 'active',
      processed_through: billing.type === 'indefinite' ? dates.at(-1) : null,
      idempotency_key: `seed:${billing.key}`,
      request_hash: sha256(`seed:${billing.key}`),
      created_at: createdAt,
      updated_at: createdAt
    });

    event('billing.created', 'billing', billingId, creditorId, { type: billing.type }, createdAt);

    if (billing.state === 'ended' || billing.state === 'paused') {
      event(`billing.${billing.state}`, 'billing', billingId, creditorId, {}, instant(earlier(addDays(dates.at(-1), 1), today), 20));
    }

    for (const [order, part] of allocations.entries()) {
      rows.allocations.push({
        id: seedId(`allocation:${billingId}:${order}`),
        billing_id: billingId,
        user_id: part.person ? userIdOf(part.person) : null,
        kind: part.person ? 'user' : 'owner',
        split_mode: split.mode,
        basis_points: split.mode === 'percentage' ? part.basisPoints : null,
        shares: split.mode === 'shares' ? part.shares : null,
        amount_cents: part.amountCents,
        allocation_order: order,
        silenced: part.silenced ? true : null,
        created_at: createdAt
      });
    }

    // A conta a pagar and a registro are one charge per date for the whole total; a conta a receber, one per person with a share.
    const debtors =
      payable || billing.settled
        ? [{ person: billing.payee ?? null, amountCents: billing.totalCents }]
        : allocations.filter((part) => part.person && part.amountCents > 0);

    for (const [index, dueDate] of dates.entries()) {
      for (const debtor of debtors) {
        const chargeId = seedId(`charge:${billingId}:${debtor.person ?? 'owner'}:${dueDate}`);
        const debtorId = debtor.person ? userIdOf(debtor.person) : null;
        const outcome = billing.outcome({ dueDate, person: debtor.person, index });
        const declared = outcome === 'declared';
        const proof = declared ? 'pending' : outcome.startsWith('proof_') ? outcome.slice('proof_'.length) : null;
        const state = outcome === 'paid' || proof === 'accepted' ? 'paid' : outcome === 'cancelled' ? 'cancelled' : 'pending';
        const createdAtCharge =
          billing.type === 'indefinite' ? later(createdAt, instant(earlier(`${dueDate.slice(0, 7)}-01`, today), 6)) : createdAt;
        const charge = {
          id: chargeId,
          creditor_id: creditorId,
          debtor_user_id: debtorId,
          payer: payable ? 'owner' : 'person',
          billing_id: billingId,
          billing_type: billing.type,
          description: billing.description,
          amount_cents: debtor.amountCents,
          currency: 'BRL',
          due_date: dueDate,
          installment: billing.type === 'indefinite' ? null : index + 1,
          installment_count: billing.type === 'indefinite' ? null : dates.length,
          pix_key_type_snapshot: snapshot?.type ?? null,
          pix_key_snapshot: snapshot?.key ?? null,
          pix_label_snapshot: snapshot?.label ?? null,
          state,
          cancelled_at: state === 'cancelled' ? later(createdAtCharge, instant(earlier(dueDate, today), 19)) : null,
          paid_at: null,
          proof_state: proof,
          proof_kind: null,
          proof_file: null,
          proof_sender_user_id: null,
          proof_actor_hash: null,
          proof_sent_at: null,
          proof_reviewed_at: null,
          proof_reason: proof === 'rejected' ? 'O valor do comprovante não confere. Envie de novo, por favor.' : null,
          silenced: debtor.silenced || billing.silenceCharge ? true : null,
          created_at: createdAtCharge,
          updated_at: now
        };

        event(
          'charge.created',
          'charge',
          chargeId,
          creditorId,
          { billingId, ...(debtorId ? { debtorUserId: debtorId } : {}) },
          createdAtCharge
        );

        if (billing.silenceCharge) {
          event('charge.silenced', 'charge', chargeId, creditorId, {}, createdAtCharge);
        }

        if (proof && !declared) {
          // Whoever pays sends the file: the debtor, or the owner of a conta a pagar. Accounts nobody signed into used the public link.
          const senderKey = payable ? holder : debtor.person;
          const senderId = senderKey === 'me' || PEOPLE[senderKey]?.status === 'active' ? userIdOf(senderKey) : null;
          const fileId = seedId(`proof:${chargeId}`);
          const bytes = proofPdf([
            'Comprovante de pagamento Pix',
            billing.description,
            `Valor: ${money(debtor.amountCents)}`,
            `Vencimento: ${dueDate.split('-').reverse().join('/')}`,
            'Documento gerado pelo seed local do Receivy'
          ]);
          const sentAt = later(createdAtCharge, instant(earlier(dueDate, today), 9));

          files.push({ key: `proofs/${chargeId}/${fileId}`, bytes });
          Object.assign(charge, {
            proof_kind: 'file',
            proof_file: JSON.stringify({
              key: `proofs/${chargeId}/${fileId}`,
              name: `comprovante-${billing.key}.pdf`,
              mime: 'application/pdf',
              size: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex')
            }),
            proof_sender_user_id: senderId,
            // The real actorHash needs a user id or a public link token; the seed never mints link tokens, so an
            // account-less sender (only possible on an already-resolved row, never on a `pending` one) gets no hash.
            proof_actor_hash: senderId ? sha256(`user:${senderId}`) : null,
            proof_sent_at: sentAt,
            proof_reviewed_at: proof === 'pending' ? null : later(sentAt, instant(earlier(addDays(dueDate, 1), today), 11))
          });
          event(
            'proof.uploaded',
            'charge',
            chargeId,
            senderId,
            { name: `comprovante-${billing.key}.pdf`, mime: 'application/pdf' },
            sentAt
          );
        }

        if (declared) {
          // Whoever pays declares: the debtor, or the owner of a conta a pagar. Accounts nobody signed into used the public link.
          const senderKey = payable ? holder : debtor.person;
          const senderId = senderKey === 'me' || PEOPLE[senderKey]?.status === 'active' ? userIdOf(senderKey) : null;
          const sentAt = later(createdAtCharge, instant(earlier(dueDate, today), 9));

          Object.assign(charge, {
            proof_kind: 'declaration',
            proof_sender_user_id: senderId,
            // Same reasoning as the file-proof block above: no fake public token, so a `pending` declaration always
            // needs an accounted sender (every `outcome: () => 'declared'` in BILLINGS resolves to one today).
            proof_actor_hash: senderId ? sha256(`user:${senderId}`) : null,
            proof_sent_at: sentAt
          });
          event('proof.declared', 'charge', chargeId, senderId, {}, sentAt);
        }

        if (state === 'paid') {
          charge.paid_at = paidAtOf(billing, charge, createdAtCharge, dueDate);
          event('charge.paid', 'charge', chargeId, creditorId, { via: paidVia(billing, proof) }, charge.paid_at);
        }

        if (state === 'cancelled') {
          event('charge.cancelled', 'charge', chargeId, creditorId, { reason: 'billing_ended' }, charge.cancelled_at);
        }

        rows.charges.push(charge);
      }
    }
  }

  return { rows, files };
}

// Persistence.

async function insert(client, table, row, upsert = false) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = columns
    .filter((column) => column !== 'id' && column !== 'created_at')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');
  const conflict = upsert ? ` ON CONFLICT (id) DO UPDATE SET ${updates}` : '';

  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})${conflict}`,
    columns.map((column) => row[column])
  );
}

async function ownerIdFor(client) {
  const existing = await client.query('SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [ownerEmail]);

  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const id = seedId(`owner:${ownerEmail}`);
  const now = new Date().toISOString();
  const name = ownerEmail.split('@')[0].replace(/^./, (letter) => letter.toUpperCase());

  await insert(client, 'users', {
    id,
    email: ownerEmail,
    verified_email: ownerEmail,
    name,
    status: 'active',
    locale: 'pt-BR',
    timezone: TIMEZONE,
    country: 'BR',
    currency: 'BRL',
    created_at: now,
    updated_at: now
  });

  return id;
}

/** Drops the charges, allocations, events and billings a previous run left; people and keys are upserted instead. */
async function resetBillings(client, billingIds) {
  await client.query(
    'DELETE FROM events WHERE eventable_id = ANY($1::uuid[]) OR eventable_id IN (SELECT id FROM charges WHERE billing_id = ANY($1::uuid[]))',
    [billingIds]
  );

  for (const table of ['charges', 'billing_invites', 'billing_guests', 'allocations']) {
    await client.query(`DELETE FROM ${table} WHERE billing_id = ANY($1::uuid[])`, [billingIds]);
  }

  await client.query('DELETE FROM billings WHERE id = ANY($1::uuid[])', [billingIds]);
}

/** A key the person already marked as default elsewhere stays the default; the seed never adds a second one. */
async function keepExistingDefaults(client, paymentMethods) {
  for (const row of paymentMethods.filter((method) => method.is_default)) {
    const other = await client.query(
      'SELECT 1 FROM payment_methods WHERE owner_id = $1 AND is_default AND archived_at IS NULL AND id <> $2 LIMIT 1',
      [row.owner_id, row.id]
    );

    row.is_default = !other.rows.length;
  }
}

if (Object.values(PEOPLE).some((person) => person.email === ownerEmail)) {
  throw new Error('Use your own e-mail: that address belongs to a seed person.');
}

const pool = createPool({
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1)
});
const client = await pool.connect();

let seed;

try {
  await client.query('BEGIN');

  const ownerId = await ownerIdFor(client);

  seed = buildSeed(ownerId);

  await resetBillings(
    client,
    seed.rows.billings.map((row) => row.id)
  );
  await keepExistingDefaults(client, seed.rows.payment_methods);

  for (const table of ['users', 'contacts', 'payment_methods']) {
    for (const row of seed.rows[table]) {
      await insert(client, table, row, true);
    }
  }

  for (const table of ['billings', 'allocations', 'charges', 'events']) {
    for (const row of seed.rows[table]) {
      await insert(client, table, row);
    }
  }

  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
} catch (error) {
  await client.query('ROLLBACK');

  throw error;
} finally {
  client.release();

  await pool.end();
}

if (!dryRun) {
  for (const file of seed.files) {
    const path = join(PROOF_ROOT, file.key);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
  }
}

const charges = seed.rows.charges;
const count = (state) => charges.filter((charge) => charge.state === state).length;

console.log(
  JSON.stringify(
    {
      dryRun,
      owner: ownerEmail,
      today,
      people: Object.keys(PEOPLE).length,
      pixKeys: seed.rows.payment_methods.length,
      billings: seed.rows.billings.length,
      charges: {
        total: charges.length,
        pending: count('pending'),
        overdue: charges.filter((charge) => charge.state === 'pending' && charge.due_date < today).length,
        paid: count('paid'),
        cancelled: count('cancelled'),
        withProof: seed.files.length
      },
      signIn: `Sign in as ${ownerEmail}; the code lands in Mailpit (http://127.0.0.1:8025).`,
      debtorSide: 'rafa.duarte@seed.receivy.test and marina.alves@seed.receivy.test are active seed accounts that bill you back.'
    },
    null,
    2
  )
);
