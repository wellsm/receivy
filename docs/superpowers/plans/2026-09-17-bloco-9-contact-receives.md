# Bloco 9 — Receiving Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `billings.contact_id` names who receives (NULL = the owner), Pix keys move from the billing to `payment_methods.contact_id`, and every `counterpart_*`/`pix_*`/`type` column of `billings` goes away — with the deploy dance EZ4 demands.

**Architecture:** Two nullable columns arrive first (D1), their relation lines one deploy later (D2), the owner runs the backfill SQL, then the code flips to the new columns (D3) and the old declarations leave the schema (D4, EZ4 drops them). Direction becomes a pure function of `contact_id`. The API keeps accepting an inline `pix` on a conta a pagar but stores it as that contact's payment method, so clients change little.

**Tech Stack:** EZ4 (`@ez4/database` schema-as-code, `@ez4/pgmigration` 0.53), PostgreSQL, vitest (unit, `packages/api/src`), node:test integration (`packages/api/test`, needs docker), React/Next web, Expo mobile.

**Spec:** `docs/superpowers/specs/2026-09-17-bloco-9-contact-receives.md`

## Global Constraints

- Never commit, push, migrate or deploy: the owner does. Each "Commit" step below means "stop and hand the diff to the owner".
- Never run `biome --write`: `biome.json` says 80 columns, the code is ~140. Match the neighbours by hand.
- Run `tsc` and the relevant tests before calling a task done. Baseline reds that are not yours: 6 email unit tests, `session.test.ts` while the TTL hack sits in the working tree, 1 integration ("searches billings by description and filters them by category"), ~199 biome format errors.
- Integration tests: `cd packages/api && pnpm test:integration` (docker up). Unit: `./node_modules/.bin/vitest run <file> --pool=forks` from `packages/api`.
- A relation line and a column of the same table never change in the same deploy (`@ez4/pgmigration` 0.53 tmp-FK bug, block 8 D2).
- A column that leaves `Database.Schema` is dropped by the next deploy. Keep old columns declared `@deprecated` until the backfill ran and no code reads them.
- Repositories: every export lives in `export namespace XRepository`; private helpers outside. Handlers destructure `{ db }` from the context. String unions are `const enum`s compared by member.
- Copy that reaches users is pt-BR; code, comments and commit messages are English.

---

## File map

| File | Responsibility in this block |
|---|---|
| `packages/api/src/billings/schemas/billing.ts` | `contact_id?` arrives; `type`, `pix_*`, `counterpart_label` leave (D4) |
| `packages/api/src/payment-methods/schemas/payment-method.ts` | `contact_id?` arrives |
| `packages/api/src/database.ts` | the two `contact_id@contact` relation lines (D2) |
| `packages/api/src/billings/utils/columns.ts` | `billingDirection` reads `contact_id` (D3) |
| `packages/api/src/payment-methods/repositories/payment-method.ts` | contact-scoped list/save/default/archive |
| `packages/api/src/payment-methods/endpoints/list.ts`, `create.ts` | `contactId` in query / body |
| `packages/api/src/charges/services/materialize.ts` | `pixSnapshot` resolves the receiving contact's default key |
| `packages/api/src/billings/repositories/billing.ts` | writes `contact_id`, upserts the contact key, stops reading old columns |
| `packages/api/src/billings/utils/body.ts` | `contactId` in `CreateBody` / `PatchBody` |
| `packages/api/src/charges/repositories/charge.ts` | `list` selects `billing.contact` and `creditor` |
| `packages/common/src/domain/billing.ts`, `billing-calendar.ts`, `billing-draft.ts` | contract + normalizer + client draft |
| `packages/common/src/domain/contracts.ts` | `PaymentMethod.contactId`, `PaymentMethodInput.contactId` |
| `packages/common/src/domain/charge.ts` | `ListChargeItem.billing.contact`, `creditor` |
| `packages/web/src/components/forms/billing-form-screen.tsx`, `packages/mobile/src/components/forms/billing-form-screen.tsx` | `payee` seat holds a contact id; registro picks a contact |
| `packages/web/src/components/screens/billing-detail-screen.tsx`, mobile twin | render `contact` instead of `payee`/`counterpartLabel` |
| `docs/api-oas.yml` | regenerated at the end of the contract task |

---

### Task 1: D1 — the two nullable columns

**Files:**
- Modify: `packages/api/src/billings/schemas/billing.ts` (interface `BillingSchema`)
- Modify: `packages/api/src/payment-methods/schemas/payment-method.ts` (interface `PaymentMethodSchema`)

**Interfaces:**
- Produces: `BillingSchema.contact_id?: String.UUID`, `PaymentMethodSchema.contact_id?: String.UUID`. No relation yet: later tasks that need `billing.contact` in a `select` wait for Task 2.

- [ ] **Step 1: Add the column to billings**

In `packages/api/src/billings/schemas/billing.ts`, after `payment_method_id?: String.UUID;`:

```ts
  /** Who receives (contacts.id); null when the owner receives. Block 9: replaces `type`, `pix_*` and `counterpart_label`. */
  contact_id?: String.UUID;
```

- [ ] **Step 2: Add the column to payment_methods**

In `packages/api/src/payment-methods/schemas/payment-method.ts`, after `owner_id: String.UUID;`:

```ts
  /** Block 9: a key the owner keeps about a contact ("how I pay this person"); null is the owner's own key. */
  contact_id?: String.UUID;
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 4: Prove the local schema syncs**

Run: `cd packages/api && pnpm test:integration 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 1` (the category baseline), nothing new. `--reset` recreates the database with both columns.

- [ ] **Step 5: Hand off — D1**

Tell the owner: "D1 pronto: duas colunas nullable, nenhuma relação. Commit + deploy. Nada muda em runtime."

---

### Task 2: D2 — the relation lines, alone

**Files:**
- Modify: `packages/api/src/database.ts` (tables `billings` and `payment_methods`)

**Interfaces:**
- Produces: `billing.contact` and `payment_method.contact` are selectable relations (`contacts` row). Alias `contact` is new on both tables, so no existing FK is renamed.

- [ ] **Step 1: Add the relations**

In `packages/api/src/database.ts`:

```ts
      name: 'billings';
      schema: BillingSchema;
      relations: {
        'owner_id@owner': 'users:id';
        'payment_method_id@payment_method': 'payment_methods:id';
        'contact_id@contact': 'contacts:id';
      };
```

```ts
      name: 'payment_methods';
      schema: PaymentMethodSchema;
      relations: { 'owner_id@owner': 'users:id'; 'contact_id@contact': 'contacts:id' };
```

- [ ] **Step 2: Typecheck and integration**

Run: `cd packages/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && pnpm test:integration 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: tsc silent; `fail 1` baseline.

- [ ] **Step 3: Hand off — D2**

Tell the owner: "D2 pronto: só as duas linhas de relação, nenhuma coluna mudou nessas tabelas. Deploy separado do D1 por causa do `_tmp_fk`."

---

### Task 3: Contact-scoped payment methods (repository + contract)

**Files:**
- Modify: `packages/common/src/domain/contracts.ts` (`PaymentMethod`, `PaymentMethodInput`)
- Modify: `packages/api/src/payment-methods/repositories/payment-method.ts`
- Modify: `packages/api/src/payment-methods/endpoints/list.ts`, `packages/api/src/payment-methods/endpoints/create.ts`
- Test: `packages/api/test/billings/contact-keys.spec.ts` (create)

**Interfaces:**
- Produces:
  - `PaymentMethod.contactId: string | null`
  - `PaymentMethodInput.contactId?: string`
  - `PaymentMethodRepository.list(db, ownerId, archived = false, contactId?: string)` — `contactId` undefined lists the owner's own keys (`contact_id IS NULL`), a value lists that contact's keys.
  - `PaymentMethodRepository.save(db, ownerId, input, id?)` — `input.contactId` scopes the default and must name an unarchived contact of the owner, else `HttpNotFoundError`.
  - `PaymentMethodRepository.upsertContactKey(db, ownerId, contactId, pix: PixSnapshotInput): Promise<string>` — returns the payment method id; reuses a row with the same `(pix_key_type, pix_key)` under that contact, else inserts it as the contact's default. Used by Task 6.
  - `PaymentMethodRepository.makeDefault` / `archive` scope `is_default` per `(owner_id, contact_id)`.

- [ ] **Step 1: Write the failing integration test**

Create `packages/api/test/billings/contact-keys.spec.ts`:

```ts
import { equal, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpNotFoundError } from '@ez4/gateway';
import { PixKeyType } from '@receivy/common';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = '91000000-0000-4000-8000-000000000001';
let padaria: string;

describe('contact keys', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'contact-keys-owner@example.com', name: 'Dona' });
    padaria = (await ContactRepository.save(db, OWNER, { name: 'Padaria' })).id;
  });

  after(async () => {
    await cleanupUsers(db, [OWNER]);
  });

  it('keeps a contact key apart from the owner keys and defaults each scope on its own', async () => {
    const mine = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'dona@example.com' });
    const theirs = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'padaria@example.com', contactId: padaria });

    equal(mine.contactId, null);
    equal(mine.isDefault, true);
    equal(theirs.contactId, padaria);
    equal(theirs.isDefault, true);
    equal((await PaymentMethodRepository.list(db, OWNER)).map((method) => method.id).includes(theirs.id), false);
    equal((await PaymentMethodRepository.list(db, OWNER, false, padaria)).map((method) => method.id).join(), theirs.id);
  });

  it('makes a second contact key the default without touching the owner default', async () => {
    const mine = (await PaymentMethodRepository.list(db, OWNER))[0]!;
    const second = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Phone, pixKey: '+5511999990000', contactId: padaria });

    await PaymentMethodRepository.makeDefault(db, OWNER, second.id);

    const keys = await PaymentMethodRepository.list(db, OWNER, false, padaria);
    equal(keys.filter((method) => method.isDefault).map((method) => method.id).join(), second.id);
    equal((await PaymentMethodRepository.list(db, OWNER)).find((method) => method.id === mine.id)?.isDefault, true);
  });

  it('upserts the contact key a billing types and answers the same id twice', async () => {
    const first = await PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Cpf, key: '52998224725', label: 'Padaria' });
    const again = await PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Cpf, key: '529.982.247-25', label: 'Padaria' });

    equal(first, again);
  });

  it('refuses a key for a contact the owner does not have', async () => {
    await rejects(
      () => PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'x@example.com', contactId: crypto.randomUUID() }),
      HttpNotFoundError
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/api && pnpm test:integration 2>&1 | grep -E "contact keys|✖" | head`
Expected: the four cases fail — `contactId` is not a known field / `upsertContactKey` is not a function.

- [ ] **Step 3: Contract**

In `packages/common/src/domain/contracts.ts`:

```ts
export type PaymentMethod = {
  id: string;
  type: 'pix';
  pixKeyType: PixKeyType;
  pixKey: string;
  label: string;
  isDefault: boolean;
  /** Block 9: the contact this key pays; null is one of the owner's own keys. */
  contactId: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type PaymentMethodInput = {
  pixKeyType: PixKeyType;
  pixKey: string;
  label?: string;
  /** Block 9: file the key under this contact of the owner; absent means the owner's own key. */
  contactId?: string;
};
```

- [ ] **Step 4: Repository**

In `packages/api/src/payment-methods/repositories/payment-method.ts`:

```ts
const SELECT = { id: true, contact_id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true } as const;

type Row = {
  id: string;
  contact_id?: string;
  pix_key_type: PaymentMethod['pixKeyType'];
  pix_key: string;
  label: string;
  is_default: boolean;
  archived_at?: string;
  created_at: string;
};

function dto(row: Row): PaymentMethod {
  return {
    id: row.id,
    type: 'pix',
    pixKeyType: row.pix_key_type,
    pixKey: row.pix_key,
    label: row.label,
    isDefault: row.is_default,
    contactId: row.contact_id ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at
  };
}

/** The default is one per scope: the owner's own keys, or the keys of one contact. */
function scopeWhere(ownerId: string, contactId?: string) {
  return { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true } } as const;
}

/** The contact must be the owner's and alive; a key filed under someone else's agenda entry is a 404. */
async function assertContact(db: DbClient, ownerId: string, contactId: string): Promise<void> {
  const contact = await db.contacts.findOne({ select: { id: true }, where: { id: contactId, owner_id: ownerId, archived_at: { isNull: true } } });
  if (!contact) throw new HttpNotFoundError();
}
```

`list` gains the fourth parameter and uses the scope:

```ts
  export async function list(db: DbClient, ownerId: string, archived = false, contactId?: string): Promise<PaymentMethod[]> {
    const { records } = await db.payment_methods.findMany({
      select: SELECT,
      where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: !archived } },
      order: { created_at: Order.Asc }
    });
    return records.map(dto);
  }
```

`save`: right after `await lockOwner(tx, ownerId);` add `if (input.contactId) await assertContact(tx, ownerId, input.contactId);`. Where the insert decides `is_default` (today: "no other key of the owner → default"), scope the lookup with `scopeWhere(ownerId, input.contactId)` and write `...(input.contactId ? { contact: { id: input.contactId } } : {})` into the insert data. An existing row keeps its `contact_id` (editing never moves a key between scopes).

`makeDefault`: the `updateMany` that clears the previous default reads the target's scope:

```ts
      await tx.payment_methods.updateMany({
        select: { id: true },
        where: { ...scopeWhere(ownerId, target.contact_id), is_default: true },
        data: { is_default: false }
      });
```

`archive`: the replacement search uses `{ ...scopeWhere(ownerId, target.contact_id), archived_at: { isNull: true } }`.

New export:

```ts
  /** The key typed on a conta a pagar, filed under its receiving contact. Same key twice answers the same id. */
  export async function upsertContactKey(db: DbClient, ownerId: string, contactId: string, pix: PixSnapshot): Promise<string> {
    const value = normalized({ pixKeyType: pix.keyType, pixKey: pix.key, label: pix.label });
    await assertContact(db, ownerId, contactId);
    const existing = await db.payment_methods.findOne({
      select: { id: true, archived_at: true },
      where: { owner_id: ownerId, contact_id: contactId, pix_key_type: pix.keyType, pix_key: value.key }
    });
    const now = new Date().toISOString();

    if (existing) {
      if (existing.archived_at) {
        await db.payment_methods.updateOne({ select: { id: true }, where: { id: existing.id }, data: { archived_at: sqlNull, updated_at: now } });
      }
      return existing.id;
    }

    const others = await db.payment_methods.findMany({ select: { id: true }, where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: true } }, take: 1 });
    const inserted = await db.payment_methods.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: ownerId },
        contact: { id: contactId },
        type: 'pix',
        pix_key_type: pix.keyType,
        pix_key: value.key,
        label: value.label,
        is_default: others.records.length === 0,
        created_at: now,
        updated_at: now
      }
    });
    return inserted.id;
  }
```

`sqlNull` is `null as unknown as undefined` (same trick `billing.ts` uses; declare it at the top of this file). Import `PixSnapshot` from `@receivy/common`. `upsertContactKey` runs inside the caller's transaction (Task 6 passes `tx`).

- [ ] **Step 5: Endpoints**

`packages/api/src/payment-methods/endpoints/list.ts`: declare `query: { contactId?: String.UUID; archived?: boolean }` on the request class (keep whatever `archived` handling exists) and call `PaymentMethodRepository.list(db, request.identity.userId, archived, request.query.contactId)`.

`packages/api/src/payment-methods/endpoints/create.ts` (and `edit.ts` if it declares its own body class): add `contactId?: String.UUID;` to the body declaration so the gateway lets it through.

- [ ] **Step 6: Run the tests**

Run: `cd packages/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && pnpm test:integration 2>&1 | grep -E "^ℹ (pass|fail)|contact keys"`
Expected: tsc silent; contact keys 4/4; `fail 1` baseline.

- [ ] **Step 7: Commit**

`feat(api): payment methods filed under a contact` — hand off.

---

### Task 4: The receiving contact's key materializes the charge

**Files:**
- Modify: `packages/api/src/charges/services/materialize.ts` (`pixSnapshot`, `PayableMaterialization`, `prepareChargeMaterialization`)
- Test: `packages/api/src/charges/services/materialize.test.ts` (create if missing; unit with a stubbed `db`)

**Interfaces:**
- Consumes: `payment_methods.contact_id` (Task 1).
- Produces: `pixSnapshot(db, ownerId, paymentMethodId?, contactId?)` — explicit id wins; else the default of the scope (`contactId` given → that contact's default, else the owner's). `PayableMaterialization` becomes `{ payer: ChargePayer.Owner; contactId?: string }` (no inline `pix`).

- [ ] **Step 1: Write the failing unit test**

Create `packages/api/src/charges/services/materialize.test.ts`:

```ts
import { PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { pixSnapshot } from './materialize';

function dbWith(rows: { id: string; contact_id?: string; is_default: boolean; pix_key: string }[]): DbClient {
  const match = (where: Record<string, unknown>) =>
    rows.filter((row) => {
      if (where.id && where.id !== row.id) return false;
      const scope = where.contact_id as string | { isNull: true } | undefined;
      if (scope && typeof scope === 'object') return row.contact_id === undefined;
      if (typeof scope === 'string') return row.contact_id === scope;
      return true;
    });
  return {
    payment_methods: {
      findOne: vi.fn(async ({ where }) => match(where)[0] && { pix_key_type: PixKeyType.Email, pix_key: match(where)[0]!.pix_key, label: 'Pix' }),
      findMany: vi.fn(async ({ where }) => ({ records: match(where).filter((row) => row.is_default).map((row) => ({ pix_key_type: PixKeyType.Email, pix_key: row.pix_key, label: 'Pix' })) }))
    }
  } as unknown as DbClient;
}

describe('pixSnapshot', () => {
  const owner = 'owner';
  const padaria = 'contact-padaria';
  const db = dbWith([
    { id: 'mine', is_default: true, pix_key: 'dona@example.com' },
    { id: 'theirs', contact_id: padaria, is_default: true, pix_key: 'padaria@example.com' }
  ]);

  it('falls back to the owner default when nobody receives on their behalf', async () => {
    expect((await pixSnapshot(db, owner))?.key).toBe('dona@example.com');
  });

  it('falls back to the receiving contact default on a conta a pagar', async () => {
    expect((await pixSnapshot(db, owner, undefined, padaria))?.key).toBe('padaria@example.com');
  });

  it('keeps an explicit method id above every default', async () => {
    expect((await pixSnapshot(db, owner, 'theirs'))?.key).toBe('padaria@example.com');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/api && ./node_modules/.bin/vitest run src/charges/services/materialize.test.ts --pool=forks`
Expected: FAIL — `pixSnapshot` is not exported / the contact case answers the owner key.

- [ ] **Step 3: Implement**

In `packages/api/src/charges/services/materialize.ts`:

```ts
/** How a conta a pagar materializes: the owner pays, the receiving contact's default key is the Pix. */
export type PayableMaterialization = {
  payer: ChargePayer.Owner;
  /** The receiving contact; absent when the bill is the owner's alone (no Pix on the charge). */
  contactId?: string;
};

/** An explicit method wins; otherwise the default of the scope: the contact's keys, or the owner's own. */
export async function pixSnapshot(db: DbClient, ownerId: string, paymentMethodId?: string, contactId?: string): Promise<ChargeMaterializationContext['pix']> {
  if (paymentMethodId) {
    const row = await db.payment_methods.findOne({
      select: { pix_key_type: true, pix_key: true, label: true, archived_at: true },
      where: { id: paymentMethodId, owner_id: ownerId }
    });
    if (!row || row.archived_at) return null;
    return { keyType: row.pix_key_type, key: row.pix_key, label: row.label };
  }

  const { records } = await db.payment_methods.findMany({
    select: { pix_key_type: true, pix_key: true, label: true },
    where: { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true }, is_default: true, archived_at: { isNull: true } }
  });
  const row = records[0];
  return row ? { keyType: row.pix_key_type, key: row.pix_key, label: row.label } : null;
}
```

Keep whatever archived-handling the current `pixSnapshot` has for the explicit-id branch (it reads `archived_at` today — mirror it). In `prepareChargeMaterialization`, the payable branch becomes:

```ts
  if (payable) {
    // A conta a pagar without a contact is the owner's alone: no key, no notice.
    const pix = payable.contactId ? await pixSnapshot(db, ownerId, paymentMethodId, payable.contactId) : null;
    return { recipients, pix, payer: ChargePayer.Owner };
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/api && ./node_modules/.bin/vitest run src/charges/services/materialize.test.ts --pool=forks && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: 3 passed; tsc reports only `billing.ts` call sites (`payableOf` still passes `pix`) — Task 6 fixes them. If tsc is otherwise clean, fine.

- [ ] **Step 5: Commit**

`feat(api): materialize a conta a pagar from the contact key` — hand off together with Task 6 if tsc is red in between.

---

### Task 5: Contract — `contactId` in, `payeeUserId`/`counterpartLabel`/`type` out

**Files:**
- Modify: `packages/common/src/domain/billing.ts` (`BillingInput`, `BillingPatch`, `BillingSummary`, `BillingDetail`, new `BillingContact`)
- Modify: `packages/common/src/domain/billing-calendar.ts` (`normalizeBillingInput`, `splitOf`, `registroLabel`)
- Modify: `packages/common/src/domain/billing-draft.ts` (`BillingDraft.payee` → contact id, `counterpartLabel` gone, `buildBillingInput`)
- Modify: `packages/api/src/billings/utils/body.ts` (`CreateBody`, `PatchBody`)
- Modify: `packages/api/src/billings/services/request.ts` (fingerprint reads `contactId`)
- Test: `packages/common/src/domain/billing-calendar.test.ts` (extend), `packages/common/src/domain/billing-draft.test.ts` (extend), `packages/api/src/billings/services/request.test.ts` (adjust)

**Interfaces:**
- Produces:
  ```ts
  export type BillingContact = { id: string; userId: string; name: string; avatar: UserAvatar | null };
  // BillingInput: contactId?: string (replaces payeeUserId, counterpartLabel, type)
  // BillingPatch: contactId?: string; clearContact?: boolean (replace payeeUserId/clearPayee; counterpartLabel gone)
  // NormalizedBillingInput = BillingInput & { description: string; split: BillingSplit; type: Direction } — type still derived here for readers
  // BillingSummary: type (derived), contact: BillingContact | null (replaces payeeName, counterpartLabel)
  // BillingDetail: type (derived), contact: BillingContact | null (replaces payee, counterpartLabel); pix stays
  ```
- Direction rule in the normalizer: `input.contactId ? Direction.Payable : Direction.Receivable`.
- Split rule: payable → `[Owner]`; receivable → `receivableSplit(input)` (unchanged); registro → same rules as the live counterpart (a receivable registro names its payer as one `User` part, a payable registro has `contactId`).

- [ ] **Step 1: Failing normalizer tests**

Append to `packages/common/src/domain/billing-calendar.test.ts` (reuse the file's existing `base` input helper; if there is none, build one with `recurrence: BillingRecurrence.Once, totalCents: 1000, startDate: '2026-09-20', timezone: 'America/Sao_Paulo'`):

```ts
describe('block 9 direction', () => {
  it('derives payable from the receiving contact and settles the split on the owner', () => {
    const normalized = normalizeBillingInput({ ...base, contactId: 'contact-1' });

    expect(normalized.type).toBe(Direction.Payable);
    expect(normalized.contactId).toBe('contact-1');
    expect(normalized.split.parts).toEqual([{ kind: SplitPartKind.Owner }]);
  });

  it('is receivable without a contact and keeps the payers the split names', () => {
    const normalized = normalizeBillingInput({ ...base, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u1' }] } });

    expect(normalized.type).toBe(Direction.Receivable);
    expect(normalized.contactId).toBeUndefined();
  });

  it('lets a receivable registro name its payer and a payable registro its contact', () => {
    const paid = normalizeBillingInput({ ...base, kind: BillingKind.Record, contactId: 'contact-1' });
    const received = normalizeBillingInput({ ...base, kind: BillingKind.Record, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u1' }] } });

    expect(paid.type).toBe(Direction.Payable);
    expect(received.split.parts).toEqual([{ kind: SplitPartKind.User, userId: 'u1' }]);
  });

  it('refuses a Pix key without a contact to file it under', () => {
    expect(() => normalizeBillingInput({ ...base, pix: { keyType: PixKeyType.Email, key: 'x@example.com' } })).toThrow('Chave Pix só com um contato que recebe.');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/common && ./node_modules/.bin/vitest run src/domain/billing-calendar.test.ts`
Expected: FAIL — `contactId` unknown, `type` still read from input.

- [ ] **Step 3: Contract types**

In `packages/common/src/domain/billing.ts`, `BillingInput`: delete `type?`, `payeeUserId?`, `counterpartLabel?`; add after `paymentMethodId?`:

```ts
  /** Block 9: who receives (a contact of the owner). Absent means the owner receives. */
  contactId?: string;
  /** Conta a pagar only: the key of the receiving contact, filed under it as a payment method. */
  pix?: BillingPixInput;
```

`BillingPatch`: delete `payeeUserId?`, `clearPayee?`, `counterpartLabel?`; add `contactId?: string; clearContact?: boolean;`.

Add the DTO piece and use it:

```ts
/** Who receives a conta a pagar, as the owner knows them. */
export type BillingContact = { id: string; userId: string; name: string; avatar: UserAvatar | null };
```

`BillingSummary`: replace `payeeName: string | null;` and `counterpartLabel?` with `contact: BillingContact | null;`. `BillingDetail`: replace `payee: BillingPayee | null;` and `counterpartLabel?` with `contact: BillingContact | null;`. Keep `type: Direction` on both (derived server-side). Delete `BillingPayee` if nothing else imports it (grep first).

- [ ] **Step 4: Normalizer**

In `packages/common/src/domain/billing-calendar.ts`:

```ts
function splitOf(input: BillingInput, direction: Direction): BillingSplit {
  if (direction === Direction.Payable) {
    return { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] };
  }

  return receivableSplit(input);
}
```

Inside `normalizeBillingInput`, replace the direction/settled/label/split block with:

```ts
  const contactId = input.contactId?.trim() || undefined;
  const direction = contactId ? Direction.Payable : Direction.Receivable;
  const settled = input.kind === BillingKind.Record;

  if (input.pix && !contactId) {
    throw new RangeError('Chave Pix só com um contato que recebe.');
  }

  if (settled && (input.paymentMethodId || input.pix || input.reminders)) {
    throw new RangeError('Registro não tem avisos nem Pix.');
  }

  if (settled && now && input.recurrence !== BillingRecurrence.Once && input.startDate < calendarDate(now, input.timezone)) {
    throw new RangeError('Registro recorrente começa hoje ou depois.');
  }

  const split = splitOf(input, direction);
```

and in the returned object replace `payeeUserId: …`, `counterpartLabel` with `contactId,` and keep `pix: direction === Direction.Payable && input.pix ? normalizeBillingPix(input.pix) : undefined`. Delete `registroLabel`, `normalizeCounterpartLabel` and their tests.

- [ ] **Step 5: Draft**

In `packages/common/src/domain/billing-draft.ts`: `payee: string` keeps its name but the doc comment becomes `/** Conta a pagar: the receiving contact (contacts.id), or empty when the bill is the owner's alone. */`; delete `counterpartLabel?`. In `buildBillingInput`, the payable branch sends `contactId: draft.payee || undefined` instead of `type`/`payeeUserId`; the receivable branch drops `type: Direction.Receivable`; the registro branch drops `counterpartLabel` and routes through the same two branches (`draft.direction === Direction.Payable` → contact, else payers from `draft.selected`). Update `billing-draft.test.ts` expectations accordingly (`payeeUserId` → `contactId`, no `type`, no `counterpartLabel`).

- [ ] **Step 6: API body + fingerprint**

`packages/api/src/billings/utils/body.ts`: in `CreateBody` delete `type?`, `payeeUserId?`, `counterpartLabel?`; add `contactId?: String.UUID;`. In `PatchBody` delete `payeeUserId?`, `clearPayee?`, `counterpartLabel?`; add `contactId?: String.UUID; clearContact?: boolean;`.

`packages/api/src/billings/services/request.ts`: the fingerprint line `payeeUserId: input.payeeUserId ?? null` becomes `contactId: input.contactId ?? null`; update `request.test.ts` ("tells a conta a pagar apart by direction, payee and typed key" → by contact and typed key).

- [ ] **Step 7: Run common and API unit tests**

Run: `cd packages/common && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc -p tsconfig.json --noEmit; cd ../api && ./node_modules/.bin/vitest run src/billings --pool=forks`
Expected: common green; API unit green except baseline. `tsc` on the API will be red in `billing.ts` until Task 6 — expected.

- [ ] **Step 8: Commit**

`refactor(common): billing contract names the receiving contact` — hand off with Task 6.

---

### Task 6: Billing repository writes `contact_id` and the contact key

**Files:**
- Modify: `packages/api/src/billings/repositories/billing.ts` (`payeeOf`, `payableOf`, `summary`, detail mapping, create insert, update, `billingInputFrom`, `SELECT`, `Row`)
- Modify: `packages/api/src/billings/utils/columns.ts` (`billingDirection`)
- Test: `packages/api/test/billings/payable.spec.ts`, `packages/api/test/billings/registros.spec.ts` (adjust fixtures), `packages/api/test/billings/contact-keys.spec.ts` (extend)

**Interfaces:**
- Consumes: `PaymentMethodRepository.upsertContactKey` (Task 3), `PayableMaterialization.contactId` (Task 4), `BillingInput.contactId` (Task 5).
- Produces: rows carry `contact_id`; `billingDirection(row)` = `row.contact_id ? Payable : Receivable`; `BillingRepository.contactOf(db, row): Promise<BillingContact | null>`; old columns still **written** during D3 for rollback safety? **No** — from this task on the old columns are not written (the backfill of Task 8 fills them from the new ones is not needed; rollback before D4 keeps old rows readable because old code reads `type`, which the backfill also keeps consistent). Do not write `type`, `pix_*`, `counterpart_label` anymore.

- [ ] **Step 1: Failing integration cases**

Extend `packages/api/test/billings/contact-keys.spec.ts` with a billing case (imports: `BillingRepository`, `ChargeRepository`, `BillingRecurrence`, `Direction`):

```ts
  it('creates a conta a pagar from a contact, files its key and pays the contact user', async () => {
    const billing = await BillingRepository.create(db, OWNER, {
      recurrence: BillingRecurrence.Once,
      description: 'Pão',
      totalCents: 1500,
      startDate: '2026-10-05',
      timezone: 'America/Sao_Paulo',
      contactId: padaria,
      pix: { keyType: PixKeyType.Email, key: 'padaria@example.com', label: 'Padaria' }
    }, { idempotencyKey: 'contact-keys-1' });
    const detail = await BillingRepository.get(db, OWNER, billing.id);

    equal(detail.type, Direction.Payable);
    equal(detail.contact?.id, padaria);
    equal(detail.pix?.key, 'padaria@example.com');
    const keys = await PaymentMethodRepository.list(db, OWNER, false, padaria);
    equal(keys.some((method) => method.id === detail.paymentMethodId), true);
    const charge = detail.charges[0]!;
    equal(charge.direction, Direction.Payable);
  });
```

Adjust the signature of `BillingRepository.create` to whatever the file exposes (grep `export async function create`); the point is `contactId` + `pix` in, `contact`/`paymentMethodId`/payable charge out.

In `payable.spec.ts`, the `payable()` fixture builds its input with `type: Direction.Payable, payeeUserId: PAYEE, pix: {…}`: change to `contactId: payeeContactId, pix: {…}` (the spec already creates `payeeContactId` in `before`). In `registros.spec.ts`, inputs with `counterpartLabel: 'Padaria'` become `contactId: <a contact created in before()>` for payable registros, and `split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: <contact user> }] }` for receivable ones. Assertions on `counterpartLabel` become assertions on `contact.name`.

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/api && pnpm test:integration 2>&1 | grep -E "✖" | head -20`
Expected: payable/registros/contact-keys cases fail on `contactId` unknown / `type` required.

- [ ] **Step 3: Direction helper**

`packages/api/src/billings/utils/columns.ts`:

```ts
/** Which way the money goes: a receiving contact makes it the owner's own bill; without one the owner collects. */
export function billingDirection(row: { contact_id?: string }): Direction {
  return row.contact_id ? Direction.Payable : Direction.Receivable;
}
```

- [ ] **Step 4: Repository reads**

In `billing.ts`:

- `SELECT`: add `contact_id: true`; keep `type`, `pix_key_type`, `pix_key`, `pix_label`, `counterpart_label` in the select **only until Task 9** (D3 removes them from `SELECT` and `Row`; here they may stay selected but nothing reads them).
- `Row`: add `contact_id?: string;`.
- Replace `payeeIdOf`/`payeeOf` with:

```ts
/** Who receives a conta a pagar, as the owner knows them; an archived contact still names it. */
async function contactOf(db: DbClient, row: Pick<BillingRepository.Row, 'contact_id'>): Promise<BillingContact | null> {
  if (!row.contact_id) {
    return null;
  }

  const contact = await db.contacts.findOne({ select: { id: true, user_id: true, nickname: true }, where: { id: row.contact_id } });

  if (!contact) {
    return null;
  }

  const person = await ContactRepository.counterpartOf(db, contact.user_id);

  return { id: contact.id, userId: contact.user_id, name: contact.nickname || person?.name || 'Conta excluída', avatar: person?.avatar ?? null };
}
```

- `payableOf(row)` returns `{ payer: ChargePayer.Owner, contactId: row.contact_id }` when `billingDirection(row) === Direction.Payable`, else `undefined`. Delete `billingPix`.
- `summary(...)`: `contact: await contactOf(db, row)` replaces `payeeName`/`counterpartLabel` (make `summary` async or resolve the contact beside `payee` where the list already awaits `payeeOf` — same call site, lines ~342-346 and ~364-366).
- Detail mapping: `contact: await contactOf(db, row)` replaces `payee`, drop `counterpartLabel`; `pix` becomes `await pixSnapshot(db, row.owner_id, row.payment_method_id, row.contact_id)` for payables (import `pixSnapshot` from `../../charges/services/materialize` — `billing.ts` already imports from there).
- The participants raw SQL: `WHERE b.type <> 'payable'` becomes `WHERE b.contact_id IS NULL`.
- `billingInputFrom(row, split)` (used by rescheduling): emit `contactId: row.contact_id` instead of `type`/`payeeUserId`/`counterpartLabel`; keep `pix` out (the key is already filed).

- [ ] **Step 5: Repository writes**

Create insert (around line 1218): before the insert, when `input.contactId && input.pix`, run `const paymentMethodId = await PaymentMethodRepository.upsertContactKey(tx, ownerId, input.contactId, input.pix)`; otherwise `input.paymentMethodId`. Then:

```ts
          ...(paymentMethodId ? { payment_method: { id: paymentMethodId } } : {}),
          ...(input.contactId ? { contact: { id: input.contactId } } : {}),
```

and delete the `type`, `pix_key_type`, `pix_key`, `pix_label`, `counterpart_label` lines. `prepareChargeMaterialization(tx, ownerId, userIds(input.split), paymentMethodId, payable)` receives the resolved id. Import `PaymentMethodRepository` (check for an import cycle: `payment-method.ts` must not import `billing.ts` — it does not today).

Update (around line 1455): resolve `contactId` from `patch.clearContact ? undefined : (patch.contactId ?? row.contact_id)`; when the patch carries `pix` and a contact, upsert the key the same way and point `payment_method` at it; `clearPix` on a payable clears `payment_method`. Write `contact: { id: contactId ?? sqlNull }`, delete the `pix_*` and `counterpart_label` lines. The `payeePatched` flag becomes `contactPatched = patch.contactId !== undefined || patch.clearContact === true`; wherever `patch.payeeUserId`/`clearPayee` appear in `patchTouchesCharges`-style predicates (lines ~635, ~800, ~831-841), swap in `contactId`/`clearContact`. The rule "only a conta a pagar may set pix/contact" (line ~831) becomes: `pix`/`clearPix` require a contact (current or patched), `contactId` on a billing that already has charges to other people (receivable with participants) answers the existing 409 the code uses for a direction change (`SettledLockedError` or the closest existing error — grep what line 831 throws today and keep it).

- [ ] **Step 6: Run integration + typecheck**

Run: `cd packages/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && pnpm test:integration 2>&1 | grep -E "^ℹ (pass|fail)|✖"`
Expected: tsc silent; only the category baseline failing.

- [ ] **Step 7: Commit**

`feat(api): the receiving contact owns the billing side` — hand off. This is D3-ready once Task 7 lands.

---

### Task 7: `GET /charges` names the counterpart by join

**Files:**
- Modify: `packages/api/src/charges/repositories/charge.ts` (`list` select + mapping)
- Modify: `packages/common/src/domain/charge.ts` (`ListChargeItem`)
- Test: `packages/common/src/domain/charge.test.ts` (fixture), `packages/api/test/billings/contact-keys.spec.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export type ListChargeItem = {
    id: string; description: string; installment?: number; installment_count?: number;
    state: string; due_date: string; amount_cents: number;
    has_payment: boolean;
    proof: { state: string; kind: string } | null;
    billing: { recurrence: string; kind: string; contact: { id: string; nickname?: string; user: { name?: string } } | null };
    creditor?: { name?: string; email?: string };
    debtor?: { name?: string; email?: string; phone?: string };
  };
  ```
  `billing.direction` and `billing.type` leave the item: `chargeDirection` needs only `debtor`.

- [ ] **Step 1: Failing test on the common fixture**

In `packages/common/src/domain/charge.test.ts`, change the `charge()` fixture to the new shape (`billing: { recurrence: 'once', kind: 'live', contact: null }`, `has_payment: false`, `proof: null`) and add:

```ts
  it('names the counterpart from the contact when the viewer pays, from the debtor when they receive', () => {
    const paying = charge({ debtor: { email: VIEWER }, billing: { recurrence: 'once', kind: 'live', contact: { id: 'c1', nickname: 'Padaria da esquina', user: { name: 'Padaria' } } } });
    const receiving = charge({ debtor: { name: 'Bruno', email: 'bruno@example.com' } });

    expect(counterpartName(paying, VIEWER)).toBe('Padaria da esquina');
    expect(counterpartName(receiving, VIEWER)).toBe('Bruno');
    expect(counterpartName(charge({ debtor: undefined }), VIEWER)).toBe('Você');
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `cd packages/common && ./node_modules/.bin/vitest run src/domain/charge.test.ts`
Expected: FAIL — `counterpartName` is not a function; fixture type errors surface in tsc.

- [ ] **Step 3: Common**

In `packages/common/src/domain/charge.ts` replace `ListChargeItem` with the shape above and add:

```ts
/** Who is on the other side, as the viewer knows them: the contact's nickname first, then the person's name. */
export function counterpartName(charge: ListChargeItem, viewerEmail: string): string {
  if (chargeDirection(charge, viewerEmail) === Direction.Payable) {
    const contact = charge.billing.contact;

    return contact?.nickname || contact?.user.name || charge.creditor?.name || 'Você';
  }

  return charge.debtor?.name || 'Você';
}
```

`chargeDirection` keeps its body. Anything still reading `charge.billing.direction` or `charge.billing.type` in `charge.ts`/`feed-filters.ts` moves to `charge.billing.recurrence` (the type filter compares `recurrence`, which is what `BillingType`/`BillingRecurrence` names).

- [ ] **Step 4: API select**

In `ChargeRepository.list`, the select becomes:

```ts
      select: {
        id: true,
        description: true,
        installment: true,
        installment_count: true,
        state: true,
        due_date: true,
        amount_cents: true,
        payment_snapshot: true,
        billing: {
          recurrence: true,
          kind: true,
          contact: { id: true, nickname: true, user: { name: true } }
        },
        creditor: { name: true, email: true },
        debtor: { name: true, email: true, phone: true },
        proofs: { state: true, kind: true }
      },
```

and the mapping:

```ts
    return records.map(({ payment_snapshot, proofs, ...record }) => ({
      ...record,
      has_payment: !!payment_snapshot,
      proof: proofs?.[0] ? { state: proofs[0].state, kind: proofs[0].kind ?? 'file' } : null,
      billing: { ...record.billing, contact: record.billing.contact ?? null }
    }));
```

(`proofs` shape: check what the join answers — one row per proof, newest first, or a single object — and pick accordingly; the feed reads only the latest.)

- [ ] **Step 5: Web fixtures**

`packages/web/src/components/screens/feed-screen.test.tsx` and `feed-filters.test.ts` fixtures: `billing: { type: "once", direction: … }` → `billing: { recurrence: "once", kind: "live", contact: null }`, plus `has_payment: false, proof: null`. `feed-day-group.tsx`/`feed-charge-card.tsx`: the name beside the description becomes `counterpartName(charge, viewerEmail)` (thread `viewerEmail` down as the day group already does).

- [ ] **Step 6: Run everything**

Run: `cd packages/common && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc -p tsconfig.json --noEmit; cd ../web && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc -p tsconfig.json --noEmit; cd ../api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all green except the known web baseline (none expected now) and API baseline.

- [ ] **Step 7: Commit**

`feat(api): feed bench names the counterpart by join` — hand off.

---

### Task 8: Backfill SQL (owner runs, after D2)

**Files:**
- Create: `packages/api/scripts/sql/2026-09-17-bloco-9-backfill.sql`

**Interfaces:**
- Consumes: D2 deployed (`contact_id` columns + FKs exist), old columns still populated.
- Produces: every payable billing has `contact_id`; every typed key is a `payment_methods` row filed under that contact and pointed by `payment_method_id`; registro labels became contacts; payable splits hold the owner only; receivable registros hold their payer as an allocation and their charges name that payer as `debtor_id`.

- [ ] **Step 1: Write the script**

```sql
BEGIN;

-- 1. Conta a pagar: the payee sits in the split as the one non-owner part. Point contact_id at the owner's agenda entry for that user.
UPDATE billings b
SET contact_id = c.id
FROM allocations a
JOIN contacts c ON c.owner_id = b.owner_id AND c.user_id = a.user_id
WHERE a.billing_id = b.id
  AND b.type = 'payable'
  AND a.user_id <> b.owner_id
  AND b.contact_id IS NULL;

-- 2. Registro labels become contacts without e-mail (a pending user + agenda entry), one per (owner, label).
WITH labels AS (
  SELECT DISTINCT owner_id, btrim(counterpart_label) AS label
  FROM billings
  WHERE kind = 'record' AND counterpart_label IS NOT NULL AND btrim(counterpart_label) <> ''
),
made_users AS (
  INSERT INTO users (id, name, status, locale, timezone, country, currency, created_at, updated_at)
  SELECT gen_random_uuid(), l.label, 'pending', 'pt-BR', u.timezone, 'BR', 'BRL', now(), now()
  FROM labels l JOIN users u ON u.id = l.owner_id
  RETURNING id, name
),
made_contacts AS (
  INSERT INTO contacts (id, owner_id, user_id, created_at, updated_at)
  SELECT gen_random_uuid(), l.owner_id, mu.id, now(), now()
  FROM labels l JOIN made_users mu ON mu.name = l.label
  RETURNING id, owner_id, user_id
)
-- 2a. Payable registro: the label is who received.
UPDATE billings b
SET contact_id = mc.id
FROM made_contacts mc
WHERE b.kind = 'record' AND b.type = 'payable' AND b.owner_id = mc.owner_id
  AND btrim(b.counterpart_label) = (SELECT name FROM users WHERE id = mc.user_id)
  AND b.contact_id IS NULL;

-- 2b. Receivable registro: the label is who paid — an allocation, and the charges' debtor.
INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at)
SELECT gen_random_uuid(), b.id, c.user_id, 0, false, now()
FROM billings b
JOIN contacts c ON c.owner_id = b.owner_id
JOIN users u ON u.id = c.user_id AND u.status = 'pending' AND u.name = btrim(b.counterpart_label)
WHERE b.kind = 'record' AND b.type = 'receivable' AND b.counterpart_label IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id = c.user_id);

UPDATE charges ch
SET debtor_id = a.user_id
FROM billings b
JOIN allocations a ON a.billing_id = b.id AND a.user_id <> b.owner_id
WHERE ch.billing_id = b.id AND b.kind = 'record' AND b.type = 'receivable' AND ch.debtor_id IS NULL;

-- 3. The key typed on a conta a pagar becomes the contact's payment method and the billing points at it.
WITH keyed AS (
  SELECT b.id AS billing_id, b.owner_id, b.contact_id, b.pix_key_type, b.pix_key, COALESCE(b.pix_label, 'Pix') AS label
  FROM billings b
  WHERE b.pix_key IS NOT NULL AND b.contact_id IS NOT NULL
),
inserted AS (
  INSERT INTO payment_methods (id, owner_id, contact_id, type, pix_key_type, pix_key, label, is_default, created_at, updated_at)
  SELECT DISTINCT ON (k.owner_id, k.pix_key_type, k.pix_key) gen_random_uuid(), k.owner_id, k.contact_id, 'pix', k.pix_key_type, k.pix_key, k.label, true, now(), now()
  FROM keyed k
  WHERE NOT EXISTS (
    SELECT 1 FROM payment_methods p WHERE p.owner_id = k.owner_id AND p.pix_key_type = k.pix_key_type AND p.pix_key = k.pix_key
  )
  RETURNING id, owner_id, pix_key_type, pix_key
)
UPDATE billings b
SET payment_method_id = p.id
FROM payment_methods p
WHERE p.owner_id = b.owner_id AND p.pix_key_type = b.pix_key_type AND p.pix_key = b.pix_key
  AND b.pix_key IS NOT NULL AND b.payment_method_id IS NULL;

-- 4. Only one default per contact scope (the DISTINCT ON above may leave a second key for the same contact).
UPDATE payment_methods p
SET is_default = false
WHERE p.contact_id IS NOT NULL
  AND p.id <> (
    SELECT id FROM payment_methods q
    WHERE q.owner_id = p.owner_id AND q.contact_id = p.contact_id AND q.archived_at IS NULL
    ORDER BY q.created_at ASC LIMIT 1
  );

-- 5. Payable split holds the owner alone from now on: the payee part leaves.
DELETE FROM allocations a
USING billings b
WHERE a.billing_id = b.id AND b.type = 'payable' AND a.user_id <> b.owner_id;

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at)
SELECT gen_random_uuid(), b.id, b.owner_id, 0, true, now()
FROM billings b
WHERE b.type = 'payable'
  AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id = b.owner_id);

-- 6. Sanity: every payable has a contact, every keyed billing has a method.
SELECT
  (SELECT count(*) FROM billings WHERE type = 'payable' AND contact_id IS NULL) AS payable_without_contact,
  (SELECT count(*) FROM billings WHERE pix_key IS NOT NULL AND payment_method_id IS NULL) AS keyed_without_method,
  (SELECT count(*) FROM billings WHERE kind = 'record' AND counterpart_label IS NOT NULL AND contact_id IS NULL AND type = 'payable') AS registro_payable_without_contact;

COMMIT;
```

- [ ] **Step 2: Dry-run locally**

Run the seed (`pnpm --filter @receivy/api seed:local <email>`) on a database at D2, then `psql` the script inside a transaction ending in `ROLLBACK` and read the three counters of step 6. Expected: all zero. A payable without a contact means its payee user has no agenda entry — list them for the owner (`SELECT b.id, b.owner_id FROM billings b WHERE type = 'payable' AND contact_id IS NULL`) instead of guessing.

- [ ] **Step 3: Hand off — backfill**

Tell the owner: "Backfill pronto em `packages/api/scripts/sql/2026-09-17-bloco-9-backfill.sql`. Roda depois do D2, antes do D3. Os três contadores no fim têm que dar zero."

---

### Task 9: D3 — stop reading the old columns

**Files:**
- Modify: `packages/api/src/billings/repositories/billing.ts` (`SELECT`, `Row`)
- Modify: `packages/api/src/billings/schemas/billing.ts` (mark old columns `@deprecated`)

**Interfaces:**
- Consumes: Task 8 ran.
- Produces: no code path reads `type`, `pix_key_type`, `pix_key`, `pix_label`, `counterpart_label`.

- [ ] **Step 1: Prove nothing reads them**

Run: `cd packages/api && grep -rn "pix_key\b\|pix_key_type\|pix_label\|counterpart_label\|\.type\b" src/billings src/charges src/timeline src/public src/invites | grep -v "schemas/\|billing.type\b.*recurrence\|record.billing.type" | head`
Expected: only the `SELECT`/`Row` lines of `billing.ts` and the schema.

- [ ] **Step 2: Remove from SELECT and Row, deprecate in the schema**

Delete the five keys from `BillingRepository.SELECT` and the five fields from `Row`. In `BillingSchema` keep the five declarations, each preceded by `/** @deprecated Block 9: read nothing, dropped in D4. */`.

- [ ] **Step 3: Typecheck + tests**

Run: `cd packages/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && pnpm test:integration 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: silent; `fail 1` baseline.

- [ ] **Step 4: Hand off — D3**

"D3: código só lê `contact_id`/`payment_method_id`. Colunas velhas ainda declaradas. Deploy."

---

### Task 10: Clients — the contact seat and the detail screens

**Files:**
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx` (lines ~195, ~250-270, ~429, ~604, ~859-884)
- Modify: `packages/mobile/src/components/forms/billing-form-screen.tsx` (lines ~242, ~400, ~500-502, ~579, ~683, ~1083-1090)
- Modify: `packages/web/src/components/screens/billing-detail-screen.tsx`, `packages/mobile/src/components/screens/billing-detail-screen.tsx`, `packages/mobile/src/components/screens/charge-detail-screen.tsx`
- Modify: `packages/mobile/src/financial/client.ts` (payment methods with `contactId`), `packages/web/src/lib/financial-proxy.ts` (`GET payment-methods(?:\?.*)?` already allowed — confirm)
- Test: `packages/web/src/components/forms/billing-form-screen.test.tsx`, mobile twin, `packages/web/src/lib/openapi-contract.test.ts`

**Interfaces:**
- Consumes: `BillingDraft.payee` is a **contact id** (Task 5); `BillingDetail.contact`, `BillingSummary.contact` (Task 5).

- [ ] **Step 1: Failing form test (web)**

In `billing-form-screen.test.tsx`, where the payable case asserts the request body carries `payeeUserId`, assert `contactId` with the contact's `id` instead; where a registro case types "Para quem", pick the contact through the same seat and assert `contactId`. Run: `cd packages/web && ./node_modules/.bin/vitest run src/components/forms/billing-form-screen.test.tsx` — expected FAIL on the body shape.

- [ ] **Step 2: Web form**

- `payee: billing.payee?.userId ?? ""` → `payee: billing.contact?.id ?? ""`.
- The picker stores `contact.id` (today it stores `userId`): in the sheet's `onPick`, `update({ payee: contact.id })`; `contactFor(draft.payee)` looks contacts up by `id`.
- The registro branch that renders the "De quem / Para quem" text input renders the contact seat instead (payable registro) or the participant picker (receivable registro); delete `counterpartLabel` handling.
- The patch builder line ~429: `...(input.contactId ? { contactId: input.contactId } : { clearContact: true })`.
- The comment at ~266 becomes: `// A registro pays or is paid like any other conta; only reminders and proofs leave the form.`

- [ ] **Step 3: Mobile form**

Same four changes at the mirrored lines (~242, ~500-502, ~579, ~683 and the registro branch near ~400).

- [ ] **Step 4: Detail screens**

Web + mobile `billing-detail-screen`: `billing.payee` / `billing.payeeName` → `billing.contact` (name + avatar), `counterpartLabel` block removed. Mobile `charge-detail-screen`: the one `payee`/`counterpartLabel` read → `contact`.

- [ ] **Step 5: Contract test + OAS**

Run: `cd packages/api && pnpm openapi:generate && cd ../web && ./node_modules/.bin/vitest run src/lib/openapi-contract.test.ts`
Expected: green. (`docs/api-oas.yml` was already stale from `listChargesHandler`; this regeneration absorbs it.)

- [ ] **Step 6: Full verification**

Run: `cd packages/web && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/eslint src; cd ../mobile && pnpm test 2>&1 | tail -3 && ./node_modules/.bin/tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

`feat(web,mobile): billing form names the receiving contact` — hand off. Ships with D3 (no database change).

---

### Task 11: D4 — the old columns leave

**Files:**
- Modify: `packages/api/src/billings/schemas/billing.ts`

- [ ] **Step 1: Delete the five `@deprecated` declarations**

`type`, `pix_key_type`, `pix_key`, `pix_label`, `counterpart_label` leave `BillingSchema`. Also delete the `Direction`/`PixKeyType` imports if they became unused.

- [ ] **Step 2: Typecheck + integration**

Run: `cd packages/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && pnpm test:integration 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: silent; `fail 1` baseline.

- [ ] **Step 3: Hand off — D4**

"D4: cinco colunas saem do schema; o EZ4 dropa no deploy. Depois disso, rollback para antes do D3 quebra (código velho seleciona colunas dropadas)."

---

## Self-review

- Spec coverage: model (T1-T2, T6), payment key scope (T3-T4), contract (T5), feed bench (T7), backfill (T8), deploy sequence (T1, T2, T9, T11), clients (T10). Out-of-scope items untouched.
- Placeholders: none — every step has code or an exact command. Line numbers are current as of 2026-09-17 and are hints; functions are named so `grep` finds them if the file moved.
- Type consistency: `BillingContact` (T5) is what `contactOf` (T6) returns and what the screens render (T10); `PayableMaterialization.contactId` (T4) is what `payableOf` (T6) builds; `PaymentMethodRepository.upsertContactKey(db, ownerId, contactId, pix: PixSnapshot)` (T3) is what T6 calls with `input.pix` after `normalizeBillingPix` produced a `PixSnapshot`-shaped value (`{ keyType, key, label }` — `label` is filled by the normalizer; if it stays optional there, default it to `'Pix'` at the call).
- Open verification points the executor must check in code, not assume: (1) whether a payable split today carries an owner part besides the payee (T8 step 5 handles both); (2) the exact error thrown at `billing.ts:~831` for a direction change (T6 keeps it); (3) the shape `proofs` comes back with in the charges join (T7 step 4).
