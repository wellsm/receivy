# Bloco 9.1 — Contact Pix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Pix key of a conta a pagar is registered on the contact (create or edit, one endpoint, one transaction) and the billing form only picks which of the contact's keys pays.

**Architecture:** `POST/PATCH /contacts` accept an optional `pix`; `ContactRepository.save` files it under the contact with `PaymentMethodRepository.upsertContactKey` and elects it default, inside its own transaction. `pix` leaves the billing contract entirely; a conta a pagar sends `paymentMethodId` (validated against the contact's scope, already in place). The clients: the contact form gains an optional Pix block and, on edit, the contact's key list (default/archive); the billing form drops the inline key and, once a contact is seated, loads `GET /payment-methods?contactId=` into the key selector it already has for receivables.

**Tech Stack:** EZ4 (`@ez4/gateway` declare-class bodies, `@ez4/database`), PostgreSQL, vitest + node:test integration, Next web (RTL), Expo mobile (RNTL/jest).

**Spec:** `docs/superpowers/specs/2026-09-17-bloco-9-1-contact-pix.md`

## Global Constraints

- Never commit, push, migrate or deploy unless the owner said so for this run (he did: local commits on `main`, never push). Stage files explicitly; never stage `packages/api/src/users/services/session.ts`.
- No `biome --write`; match each package's formatting (common/API single quotes ~140 cols; web/mobile double quotes). Code/comments English; user-facing copy pt-BR in the screens' register.
- Repositories: exports inside `export namespace XRepository`, private helpers outside; relation writes through the alias; `const enum`s compared by member.
- No schema change in this block (no deploy dance). OAS regenerated when a body changes; `packages/web/src/lib/openapi-contract.test.ts` green.
- Baselines you are not responsible for: API unit 6 email + 1 `session.test.ts`; integration "searches billings by description and filters them by category"; mobile `feed-screen.test.tsx:122`; ~199 biome format errors.
- Verification per package: common `vitest run` + `tsc`; API `tsc` (src + tests) + `vitest run src/… --pool=forks` + `pnpm test:integration` (docker up); web `vitest run` + `tsc` + `eslint src`; mobile `pnpm check-types && pnpm test && pnpm lint`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/common/src/domain/contacts.ts` | `ContactInput.paymentMethod?` |
| `packages/api/src/contacts/utils/body.ts` (create) | `ContactPaymentMethodBody` declare class shared by create/update bodies |
| `packages/api/src/contacts/endpoints/create.ts`, `update.ts` | bodies gain `paymentMethod?` |
| `packages/api/src/contacts/repositories/contact.ts` | `save` files + elects the key |
| `packages/api/src/payment-methods/repositories/payment-method.ts` | `electDefault(db, ownerId, id)` usable inside a caller's transaction |
| `packages/common/src/domain/billing.ts`, `billing-calendar.ts`, `billing-draft.ts`, `billing-footer.ts` | `pix` gone from input/patch/normalizer/draft |
| `packages/api/src/billings/utils/body.ts`, `repositories/billing.ts`, `services/request.ts` | `pix` gone; `paymentMethodId` is the only pointer |
| `packages/web/src/components/forms/contact-form-screen.tsx`, mobile twin | optional Pix block; key list on edit |
| `packages/web/src/components/forms/billing-form-screen.tsx`, mobile twin | key selector fed by the seated contact |
| `packages/mobile/src/financial/client.ts` | `paymentMethods(contactId?)` already exists; contacts client sends `pix` |
| `docs/api-oas.yml` | regenerated |

---

### Task 1: Contacts accept a Pix key (API)

**Files:**
- Modify: `packages/common/src/domain/contacts.ts` (`ContactInput`)
- Create: `packages/api/src/contacts/utils/body.ts`
- Modify: `packages/api/src/contacts/endpoints/create.ts`, `packages/api/src/contacts/endpoints/update.ts`
- Modify: `packages/api/src/contacts/repositories/contact.ts` (`save`)
- Modify: `packages/api/src/payment-methods/repositories/payment-method.ts` (`electDefault`)
- Test: `packages/api/test/billings/contact-keys.spec.ts` (extend)

**Interfaces:**
- Produces: `ContactInput.paymentMethod?: ContactPaymentMethodInput` = `Omit<PaymentMethodInput, 'contactId'>` (`{ pixKeyType, pixKey, label? }`, the shape `POST /payment-methods` already takes — so a second kind later (`type: 'link'`) extends one type, not two); `PaymentMethodRepository.electDefault(db, ownerId, id): Promise<void>` — clears the other defaults of the row's scope and sets this one, no transaction/lock of its own (`makeDefault` becomes `lockOwner` + `electDefault` inside `db.transaction`).

- [ ] **Step 1: Failing integration cases** (append to `contact-keys.spec.ts`, which already has `OWNER` and `PaymentMethodRepository` imported; add `PixKeyType`, `ContactRepository` if missing):

```ts
  it('files the key typed on the contact form under the contact and makes it the default', async () => {
    const contact = await ContactRepository.save(db, OWNER, { name: 'Mercado', paymentMethod: { pixKeyType: PixKeyType.Email, pixKey: 'mercado@example.com', label: 'Mercado' } });
    const keys = await PaymentMethodRepository.list(db, OWNER, false, contact.id);

    equal(keys.length, 1);
    equal(keys[0]!.pixKey, 'mercado@example.com');
    equal(keys[0]!.isDefault, true);
  });

  it('a key typed on edit becomes the new default and leaves the older key in place', async () => {
    const contact = await ContactRepository.save(db, OWNER, { name: 'Farmácia', paymentMethod: { pixKeyType: PixKeyType.Email, pixKey: 'farmacia@example.com' } });
    await ContactRepository.save(db, OWNER, { name: 'Farmácia', paymentMethod: { pixKeyType: PixKeyType.Phone, pixKey: '+5511988887777' } }, contact.id);
    const keys = await PaymentMethodRepository.list(db, OWNER, false, contact.id);

    equal(keys.length, 2);
    equal(keys.find((key) => key.isDefault)?.pixKey, '+5511988887777');
  });

  it('editing without a key touches no key', async () => {
    const contact = await ContactRepository.save(db, OWNER, { name: 'Papelaria', paymentMethod: { pixKeyType: PixKeyType.Email, pixKey: 'papelaria@example.com' } });
    await ContactRepository.save(db, OWNER, { name: 'Papelaria', nickname: 'Papel' }, contact.id);

    equal((await PaymentMethodRepository.list(db, OWNER, false, contact.id)).length, 1);
  });
```

- [ ] **Step 2: Run to see them fail** — `cd packages/api && pnpm test:integration 2>&1 | grep -E "✖|contact keys"`; expected: `paymentMethod` unknown on `ContactInput` (tsc for tests) / no key filed.

- [ ] **Step 3: Contract** — `packages/common/src/domain/contacts.ts`:

```ts
/** What the contact form types for how the owner pays this person; the same shape `POST /payment-methods` takes. */
export type ContactPaymentMethodInput = Omit<PaymentMethodInput, 'contactId'>;

export type ContactInput = {
  name: string;
  nickname?: string;
  email?: string;
  /** Block 9.1: filed under this contact and made its default; the billing form only picks among them. */
  paymentMethod?: ContactPaymentMethodInput;
};
```
(`PaymentMethodInput` lives in `contracts.ts`; no cycle.)

- [ ] **Step 4: Bodies** — create `packages/api/src/contacts/utils/body.ts`:

```ts
import type { String } from '@ez4/schema';
import type { PixKeyType } from '@receivy/common';

/** How the owner pays this contact, as the form types it; `type` is implicit ('pix') until a second kind exists. */
export declare class ContactPaymentMethodBody {
  pixKeyType: PixKeyType;
  pixKey: String.Max<254>;
  label?: String.Max<120>;
}
```
and in `create.ts`/`update.ts` add `paymentMethod?: ContactPaymentMethodBody;` to the body declarations. `parseContactInput` (`contacts/utils/parse.ts`) passes `paymentMethod` through untouched; the repository normalizes with `normalizePixKey` (already what `PaymentMethodRepository.save`/`upsertContactKey` do).

- [ ] **Step 5: `electDefault`** — in `payment-method.ts`, extract the body of `makeDefault` (after the lock and the target lookup) into:

```ts
  /** Makes `id` the default of its own scope; runs inside the caller's transaction. */
  export async function electDefault(db: DbClient, ownerId: string, id: string): Promise<void> {
    const target = await db.payment_methods.findOne({ select: SELECT, where: { id, owner_id: ownerId } });
    if (!target || target.archived_at) throw new HttpNotFoundError();
    await db.payment_methods.updateMany({ select: { id: true }, where: { ...scopeWhere(ownerId, target.contact_id), is_default: true }, data: { is_default: false } });
    await db.payment_methods.updateOne({ select: { id: true }, where: { id, owner_id: ownerId }, data: { is_default: true, updated_at: new Date().toISOString() } });
  }
```
`makeDefault` keeps its transaction + `lockOwner`, then calls `electDefault(tx, …)` and returns the DTO.

- [ ] **Step 6: `save` files the key** — in `ContactRepository.save`, right before the final `findOne`/`details` return, inside the same `tx`:

```ts
      if (input.paymentMethod) {
        const keyId = await PaymentMethodRepository.upsertContactKey(tx, ownerId, contactId, { keyType: input.paymentMethod.pixKeyType, key: input.paymentMethod.pixKey, label: input.paymentMethod.label ?? 'Pix' });
        await PaymentMethodRepository.electDefault(tx, ownerId, keyId);
      }
```
`contact.ts` imports `PaymentMethodRepository` (no cycle: `payment-method.ts` imports nothing from contacts).

- [ ] **Step 7: Verify** — tsc (src + tests) silent; integration: the three new cases green, baseline only. Unit `vitest run src/contacts src/payment-methods --pool=forks` green.

- [ ] **Step 8: Commit** — `feat(api): a contact carries its Pix key`.

---

### Task 2: `pix` leaves the billing contract

**Files:**
- Modify: `packages/common/src/domain/billing.ts` (`BillingInput.pix`, `BillingPatch.pix`, `BillingPixInput` stays exported for contacts), `billing-calendar.ts` (normalizer), `billing-draft.ts` (`PixDraft`, `pixInline`, `buildBillingInput`), `billing-footer.ts` if it reads `pix`
- Modify: `packages/api/src/billings/utils/body.ts` (`PixBody` from `CreateBody`/`PatchBody`), `repositories/billing.ts` (`contactKey`, `pixPatched`, the `patch.pix` predicates at ~723/756/883/919/1489-1507, `create` at ~1293), `services/request.ts` (fingerprint)
- Test: `packages/common/src/domain/billing-calendar.test.ts`, `billing-draft.test.ts`; `packages/api/test/billings/payable.spec.ts`, `contact-keys.spec.ts`, `month-materialized.spec.ts`, `registros.spec.ts`; `packages/api/src/billings/services/request.test.ts`

**Interfaces:**
- Produces: `BillingInput = { …, contactId?, paymentMethodId? }` — on a payable `paymentMethodId` must be one of the contact's keys (existing `assertContactKey`), absent means the contact's default; `BillingPatch` likewise (`paymentMethodId`/`clearPaymentMethod` already exist). `BillingDraft` loses `pixInline`; `draft.pix` (a method id) serves both directions.

- [ ] **Step 1: Failing tests** — normalizer: `normalizeBillingInput({ ...base, contactId: 'c1', paymentMethodId: 'pm1' })` keeps `paymentMethodId`; the case that asserted `'Chave Pix só com um contato que recebe.'` is deleted (no `pix` to refuse). Draft: `buildBillingInput` payable sends `{ contactId, paymentMethodId: draft.pix || undefined }` and never `pix`. Integration fixtures: every `pix: {…}` on a billing input becomes a key created in `before()` with `PaymentMethodRepository.save(db, OWNER, { pixKeyType, pixKey, label, contactId })` and `paymentMethodId: <its id>`; `registros.spec.ts` `refuse('pix', …)` cases become `refuse('paymentMethodId', { paymentMethodId: '<any>' })` with the message `'Registro não tem avisos nem Pix.'`; `payable.spec.ts:~230/241` (patching a typed key) becomes patching `paymentMethodId` to a second key of the contact. Run: common + API suites → RED on the removed fields (tsc) and the changed messages.

- [ ] **Step 2: Remove** — delete `pix` from `BillingInput`/`BillingPatch`, `PixBody` usage from `CreateBody`/`PatchBody` (keep the class if `ContactPixBody` was not made to replace it — otherwise delete it too), the `normalizeBillingPix` call in the normalizer (keep the function exported for contacts), `contactKey` and every `patch.pix`/`input.pix` branch in `billing.ts` (`create` resolves `paymentMethodId = input.paymentMethodId` and validates with `assertContactKey` when a contact is present; `patch` likewise), `pix` from the fingerprint in `request.ts`. Draft: delete `PixDraft`, `pixInline`, `pixDraftFromBilling` users are Task 3/4's. Grep proof: `grep -rn "pix:" packages/common/src/domain/billing*.ts packages/api/src/billings` shows only DTO output (`BillingDetail.pix`).

- [ ] **Step 3: Verify** — common green + tsc; API tsc (src + tests) silent, unit green, integration baseline only; `pnpm openapi:generate`; web `openapi-contract.test.ts` green (the web/mobile forms still compile? — they reference `pixInline`: they will NOT until Tasks 3/4, so run web/mobile tsc only after those; say so in the report).

- [ ] **Step 4: Commit** — `refactor: the billing contract only points at a payment method` (common + API + OAS).

---

### Task 3: Web — contact form Pix block, key list, billing key selector

**Files:**
- Modify: `packages/web/src/components/forms/contact-form-screen.tsx` (+ test)
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx` (+ test)
- Modify: `packages/web/src/lib/contacts-proxy.ts` only if the body needs no change (it forwards the JSON as is — verify)
- Test: `contact-form-screen.test.tsx`, `billing-form-screen.test.tsx`, `a11y.test.tsx` (contact form case if present)

**Interfaces:**
- Consumes: `ContactInput.paymentMethod?` (Task 1); `GET /api/financial/payment-methods?contactId=` (proxy strips the query before matching — allowed); `POST /api/financial/payment-methods/{id}/default|archive`.

- [ ] **Step 1: Failing tests** — contact form: typing a key and saving posts `paymentMethod: { pixKeyType, pixKey, label? }` (create) and on edit (`contactId` given) the form lists the contact's keys from `GET …payment-methods?contactId=<id>` with "Padrão"/"Definir padrão"/"Arquivar", and archive calls `POST …/{id}/archive`. Billing form: seating a contact triggers `GET …payment-methods?contactId=<id>`; the selector shows the default preselected (`draft.pix === default.id`) and submitting sends `paymentMethodId`; with no keys the form shows `'Este contato ainda não tem chave Pix. Cadastre no contato.'` with a link to the contact edit route carrying `returnTo`; the inline key field no longer exists (assert `queryByLabelText(/Chave Pix/)` is null in the payable branch).

- [ ] **Step 2: Contact form** — optional block "Chave Pix (opcional)" using `PixKeyFields` (`type`, masked `value`, `onPickType`, `onChange`) + label input; state `pixType`, `pixKey`, `pixLabel`; on submit include `paymentMethod` only when `pixKey` is non-empty (unformat with `pixKeyField(type).unformat`). On edit: load keys, render the list; actions call the payment-methods endpoints and reload. Copy in the screen's register ("Chave Pix", "Padrão", "Definir padrão", "Arquivar").

- [ ] **Step 3: Billing form** — remove `pixDraftFromBilling`, `pickPixType`, `typePixKey`, the `PixKeyFields` block and the label input of the payable branch; `useEffect` on `draft.payee`: when set, fetch keys for it into the same `methods` state the receivable selector uses (scoped by direction), preselect `draft.pix = methods.find(isDefault)?.id ?? methods[0]?.id ?? ""`; reuse the existing listbox (`billing-pix-options`) for payables; empty state hint + link (`/contacts/${id}?returnTo=` — use the route the contacts screen already uses for edit; grep `contact-form-screen` usages under `app/(protected)/contacts`). Seeding from a `BillingDetail`: `pix: billing.paymentMethodId ?? ""` (already the case).

- [ ] **Step 4: Verify** — `vitest run` green (350+), `tsc`, `eslint src`, `openapi-contract.test.ts`.

- [ ] **Step 5: Commit** — `feat(web): the contact carries its Pix key; the billing form picks one`.

---

### Task 4: Mobile — same three changes

**Files:**
- Modify: `packages/mobile/src/components/forms/contact-form-screen.tsx` (+ test), `packages/mobile/src/components/forms/billing-form-screen.tsx` (+ test), `packages/mobile/src/financial/client.ts` (contacts client: `save` already sends `ContactInput` as JSON — verify `paymentMethod` passes; `paymentMethods(contactId?)` exists)

**Interfaces:** as Task 3, with RNTL (`await fireEvent…`, `accessibilityLabel`s).

- [ ] **Step 1: Failing tests** mirroring Task 3's three behaviours (contact form posts `paymentMethod`; edit lists/archives keys; billing form loads the seated contact's keys, preselects the default, sends `paymentMethodId`, shows the empty-state hint; no inline key field).
- [ ] **Step 2: Implement** with the mobile `PixKeyFields` (`onChangeKey`, `onClear`, `disabled`) and the existing sheet-style key selector; navigation to the contact edit route with `returnTo` (Expo Router; regenerate typed routes if a new route appears — none expected).
- [ ] **Step 3: Verify** — `pnpm check-types && pnpm test && pnpm lint` (pre-existing `feed-screen.test.tsx:122` may remain).
- [ ] **Step 4: Commit** — `feat(mobile): the contact carries its Pix key; the billing form picks one`.

---

### Task 5: Leftovers and notes

**Files:** whatever the greps below surface; `docs/api-oas.yml`; `~/Projects/ai-rules/notes/receivy.md` (append one line: "Bloco 9.1: chave Pix mora no contato — `POST/PATCH /contacts` com `pix` arquiva e elege default; conta a pagar só manda `paymentMethodId`").

- [ ] **Step 1:** `grep -rn "pixInline\|PixDraft\|pixDraftFromBilling\|BillingPixInput" packages/web/src packages/mobile/src packages/common/src packages/api/src` — nothing may remain: `BillingPixInput` and `normalizeBillingPix` go with the billing `pix`; the contacts path uses `ContactPaymentMethodInput`/`ContactPaymentMethodBody`.
- [ ] **Step 2:** OAS regenerated one last time; `openapi-contract.test.ts` green; all four packages' verification once more.
- [ ] **Step 3: Commit** — `chore: bloco 9.1 leftovers`.

---

## Self-review

- Spec coverage: one endpoint + one transaction (T1), key typed = default (T1 step 6), key optional on create/edit (T1 tests), billing form only picks (T3/T4), `pix` out of the billing contract + OAS (T2), key list with default/archive on contact edit (T3/T4), DTO does not embed keys (T3 fetches on demand). ✓
- Placeholders: the empty-state route is named by lookup ("the route the contacts screen already uses for edit") — the implementer greps it; acceptable.
- Type consistency: `electDefault(db, ownerId, id)` (T1) is what `save` calls; `ContactInput.paymentMethod: ContactPaymentMethodInput` is what `save` hands to `upsertContactKey`; `draft.pix` (method id) is what both directions send as `paymentMethodId` (T2 → T3/T4).
- Open checks for the executor: (1) `upsertContactKey`'s `normalized()` covers the key canonical form; (2) the contacts proxy forwards unknown JSON fields unchanged (it does `request.text()` → yes, verify); (3) EZ4 reflection accepts a `declare class` imported across domains — if `ContactPaymentMethodBody` fails to reflect, declare it inside each endpoint file instead.
