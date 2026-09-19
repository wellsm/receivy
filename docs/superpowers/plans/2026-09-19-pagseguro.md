# PagBank (PagSeguro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PagBank como segundo provider de link de pagamento: token do vendedor cifrado numa tabela `integrations`, checkout por charge, webhook assinado + re-leitura do pedido, inativação ao cancelar, UI com chip "PagBank".

**Architecture:** Os vendors passam a implementar uma interface comum `CheckoutClient` (InfinitePay via adaptador sobre o cliente existente, PagBank novo, fake para os dois) e `ensurePaymentLink`/`settleByProvider` escolhem o cliente pelo `snapshot.provider`. A credencial vive em `integrations.credentials.ciphertext` (AES-256-GCM, chave por stage) e só é decifrada em memória na hora da chamada. Tudo no banco é aditivo (tabela nova, colunas nullable, campo jsonb opcional).

**Tech Stack:** EZ4 0.53, Postgres, vitest (unit `src/**/*.test.ts`), `node:test` + DatabaseTester (`test/**`), Next 16, Expo Router, `node:crypto` (AES-256-GCM, SHA-256).

**Spec:** `docs/superpowers/specs/2026-09-19-pagseguro-design.md`

## Global Constraints

- Estilo (CLAUDE.md): braces em todo bloco; linha em branco quando muda o tipo de statement; `return` cedo; repositories `export namespace XRepository` com select inline; services orquestram; handlers desestruturam `{ db, variables }`; nunca `biome --write`/prettier. Web: eslint `curly` + `padding-line-between-statements`, ~200 colunas; mobile idem + Uniwind; `await fireEvent`.
- `const enum` na API, `enum` no common. Comparar provider/estado com membros de enum, nunca literal.
- Nunca comitar/migrar/deployar dentro das tasks (o controlador comita ao fim de cada bloco: API, web, mobile). Nunca `git stash/checkout/restore`; o dono edita ao vivo — reler antes de editar.
- Sem dependência nova.
- Segredo: o token do PagBank nunca aparece em log, evento, DTO ou resposta; só existe em claro na memória do handler que fala com o PagBank. `PAYMENT_CREDENTIAL_KEY_B64` = 32 bytes base64; local/test usam a chave fixa `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=` dos `.env.example`.
- Valores exatos: hosts `https://api.pagseguro.com` / `https://sandbox.api.pagseguro.com`; sondagem `GET /checkouts/CHEC_00000000-0000-0000-0000-000000000000` (401 inválido, 404 válido); `POST /checkouts` com `payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }]`, `customer_modifiable: true`, `soft_descriptor: 'Receivy'`, `expiration_date` = expiração do link público; `POST /checkouts/{id}/inactivate`; `GET /orders/{id}`; header `x-authenticity-token` = SHA-256 hex de `${token}-${corpoCru}`.
- `PAYMENT_METHOD_LINK = live | sandbox | fake | disabled` (`sandbox` só muda o host do PagBank).
- Erros novos: `PAGSEGURO_TOKEN_INVALID` 422, `PAYMENT_CREDENTIAL_KEY_MISSING` 503.
- Strings de UI: chip "PagBank"; campo "Token do PagBank"; hint "Gere o token no app PagBank em Vendas → Integrações → Gerar Token. Ele fica cifrado no Receivy."; erro "Token inválido ou sem permissão."; página pública "Pix ou cartão, pelo PagBank. A confirmação chega sozinha depois do pagamento." e "Pagamento em confirmação: se você pagou, isto atualiza em instantes."; rodapé do e-mail "O pagamento acontece pelo link do PagBank de quem cobra."

---

## Mapa de arquivos

**common** — Modify `src/domain/contracts.ts` (`PaymentProvider.PagSeguro`, `PagSeguroMethodInput`), `src/domain/payment-method-text.ts` (+ test).

**api**
- Create `src/common/services/secret-box.ts` (+ test) — AES-256-GCM `seal`/`open`.
- Create `src/integrations/schemas/integration.ts`, `src/integrations/repositories/integration.ts`, `src/integrations/utils/credential.ts` (+ test).
- Modify `src/database.ts` (tabela `integrations`, relação em `payment_methods`), `src/payment-methods/schemas/payment-method.ts` (`integration_id?`), `src/charges/schemas/charge.ts` (`provider_link_id?`, `payment_snapshot.integrationId?`), `src/charges/utils/columns.ts`, `src/charges/repositories/charge.ts` (`setPaymentLink` com `linkId`), `src/payment-methods/repositories/payment-method.ts` (`integration_id` no insert/update/pointer/defaultOf), `src/charges/services/materialize.ts` + `src/billings/services/billing.ts` (snapshot com `integrationId`), `src/public/services/public-link.ts` (`setPayment` idem).
- Create `src/vendors/checkout/types.ts` (interface comum), `src/vendors/checkout/fake.ts` (substitui `vendors/infinitepay/fake.ts`), `src/vendors/checkout/infinitepay.ts` (adaptador), `src/vendors/checkout/pagseguro.ts` (adaptador), `src/vendors/pagseguro/{types,client,client.test}.ts`.
- Modify `src/charges/services/payment-link.ts` (`checkoutClients`, `ensurePaymentLink` por provider, `inactivatePaymentLink`), `src/charges/services/settle.ts` (input por provider), `src/notifications/services/{planner,context,send}.ts`, `src/payment-methods/services/payment-method.ts`, `src/payment-methods/utils/input.ts`, `src/payment-methods/errors.ts`, `src/api.ts`, `src/charges/endpoints/cancel.ts`, `src/webhooks/endpoints/infinitepay.ts`, `src/public/endpoints/provider-return.ts`, `src/charges/endpoints/payment-link.ts`.
- Create `src/webhooks/endpoints/pagseguro.ts`, `src/webhooks/endpoints/fake-pay.ts`; Modify `src/webhooks/{routes,provider}.ts`.
- Variables: `PAYMENT_CREDENTIAL_KEY_B64` em `ez4.project.js`, `*.env.example`, blocos `variables` de: `payment-methods/services/payment-method.ts`, `charges/provider.ts`, `public/provider.ts`, `webhooks/provider.ts`, `public/services/public-link.ts`, `billings/crons/materialize.ts`, `billings/services/billing.ts`, `invites/services/invite.ts`, `notifications/services/notification.ts`, `notifications/schedulers/charge-notify.ts`.
- Tests: `test/fixtures/{financial,scheduling}.ts`, `test/financial/pagseguro.spec.ts` (new), updates onde `createFakePaymentLinkProvider` é importado.
- Docs: `docs/environments.md`, `docs/api-errors.md`, `docs/notifications.md`, `docs/manual-qa-script.md`, `docs/api-oas.yml` (gerado).

**web** — Modify `components/forms/payment-method-form-screen.tsx` (+ test), `components/ui/provider-icon.tsx`, `components/screens/payment-methods-screen.tsx` (+ test), `components/screens/billing-detail-screen.tsx`, `app/pay/[token]/page.tsx`, `lib/openapi-contract.test.ts`; Rename `app/dev/infinitepay/[orderNsu]/page.tsx` → `app/dev/checkout/[provider]/[orderNsu]/page.tsx`; Create `app/dev/checkout/[provider]/[orderNsu]/pay/route.ts`.

**mobile** — Modify `components/forms/payment-method-form-screen.tsx` (+ test), `components/screens/payment-methods-screen.tsx` (+ test), `components/forms/billing-form-screen.tsx`, `components/screens/billing-detail-screen.tsx`; Create `assets/images/auth/bank.svg`.

---

### Task 1: Contratos no common

**Files:**
- Modify: `packages/common/src/domain/contracts.ts` (enum `PaymentProvider`, união `PaymentMethodInput`)
- Modify: `packages/common/src/domain/payment-method-text.ts`, `payment-method-text.test.ts`

**Interfaces:**
- Produces:
  ```ts
  PaymentProvider.PagSeguro = 'pagseguro'
  export type PagSeguroMethodInput = { provider: PaymentProvider.PagSeguro; /** Required on create; absent on edit keeps the stored one. */ token?: string; label?: string };
  export type PaymentMethodInput = PixMethodInput | InfinitePayMethodInput | PagSeguroMethodInput;
  paymentMethodText({ provider: PagSeguro, value }) → { title: 'PagBank', value }
  paymentMethodCopyValue({ provider: PagSeguro }) → ''
  ```

- [ ] **Step 1: Testes**

Em `payment-method-text.test.ts` adicionar:

```ts
it('names a PagBank account by its label and copies nothing', () => {
  expect(paymentMethodText({ provider: PaymentProvider.PagSeguro, kind: null, value: 'Conta da loja' })).toEqual({ title: 'PagBank', value: 'Conta da loja' });
  expect(paymentMethodCopyValue({ provider: PaymentProvider.PagSeguro, value: 'Conta da loja' })).toBe('');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @receivy/common exec vitest run src/domain/payment-method-text.test.ts --pool=forks` → FAIL (`PagSeguro` não existe).

- [ ] **Step 3: Implementar**

`contracts.ts`: `PaymentProvider` ganha `PagSeguro = 'pagseguro'`; após `InfinitePayMethodInput`:

```ts
export type PagSeguroMethodInput = {
  provider: PaymentProvider.PagSeguro;
  /** The seller's PagBank API token. Required on create; absent on edit keeps the stored one. Never returned. */
  token?: string;
  label?: string;
};

export type PaymentMethodInput = PixMethodInput | InfinitePayMethodInput | PagSeguroMethodInput;
```

`payment-method-text.ts`:

```ts
export function paymentMethodText(method: { provider: PaymentProvider; kind: PixKeyType | null; value: string }): PaymentMethodText {
  if (method.provider === PaymentProvider.PagSeguro) {
    return { title: 'PagBank', value: method.value };
  }

  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return { title: 'InfinitePay', value: `$${method.value}` };
  }

  return { title: PIX_KIND_LABELS[method.kind], value: pixKeyField(method.kind).format(method.value) };
}

/** What the clipboard gets: the InfiniteTag with its `$`, the Pix key as-is, nothing for a PagBank account (there is no public value). */
export function paymentMethodCopyValue(method: { provider: PaymentProvider; value: string }): string {
  if (method.provider === PaymentProvider.PagSeguro) {
    return '';
  }

  if (method.provider === PaymentProvider.InfinitePay) {
    return `$${method.value}`;
  }

  return method.value;
}
```

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/common check-types && pnpm --filter @receivy/common test` → OK. (Web/mobile podem reclamar de `switch` não exaustivo? Não há `switch` sobre provider; `check-types` deles continua verde — confirmar com `pnpm --filter @receivy/web check-types`.)

---

### Task 2: Cofre, tabela `integrations`, colunas e variável

**Files:**
- Create: `packages/api/src/common/services/secret-box.ts`, `secret-box.test.ts`
- Create: `packages/api/src/integrations/schemas/integration.ts`, `packages/api/src/integrations/repositories/integration.ts`, `packages/api/src/integrations/utils/credential.ts`, `credential.test.ts`
- Modify: `packages/api/src/database.ts`, `packages/api/src/payment-methods/schemas/payment-method.ts`, `packages/api/src/charges/schemas/charge.ts`, `packages/api/src/charges/utils/columns.ts`, `packages/api/src/charges/repositories/charge.ts`, `packages/api/src/payment-methods/repositories/payment-method.ts`, `packages/api/src/payment-methods/utils/dto.ts`
- Modify: `packages/api/ez4.project.js`, `local.env.example`, `dev.env.example`, `test.env.example`

**Interfaces:**
- Produces:
  ```ts
  // secret-box.ts
  seal(plain: string, keyB64: string): string          // 'v1.<iv>.<tag>.<ct>' base64url
  open(sealed: string, keyB64: string): string         // throws Error('Sealed value is not readable') on wrong key/tamper/format
  assertCredentialKeyConfigured(keyB64: string): string  // throws Error('Payment credential key is not configured') on '' | 'disabled' | not 32 bytes
  // integrations
  const enum IntegrationCredentialKind { Token = 'token', Connect = 'connect' }
  interface IntegrationCredentialsSchema { kind: IntegrationCredentialKind; ciphertext: String.Max<2048>; accountId?: String.Max<120>; expiresAt?: String.DateTime; scope?: String.Max<200> }
  interface IntegrationSchema { id; owner_id; provider: PaymentProvider; credentials: IntegrationCredentialsSchema; label: String.Max<120>; revoked_at?; created_at; updated_at }
  IntegrationRepository.get(db, id): Promise<Row | null>
  IntegrationRepository.byOwner(db, ownerId, provider): Promise<Row | null>          // revoked included
  IntegrationRepository.upsert(db, { ownerId, provider, credentials, label, now }): Promise<Row>   // restores a revoked one
  IntegrationRepository.revoke(db, id, now): Promise<void>
  type IntegrationRepository.Row = { id; owner_id; provider; credentials: IntegrationCredentialsSchema; label; revoked_at?; created_at; updated_at }
  // credential.ts
  credentialOf(db, keyB64: string, integrationId: string): Promise<{ status: 'ok'; secret: string } | { status: 'missing' | 'revoked' | 'unreadable' }>   // secret = decrypted token
  // schema additions
  PaymentMethodSchema.integration_id?: String.UUID  (relation 'integration_id@integration': 'integrations:id')
  ChargeSchema.provider_link_id?: String.Max<120>; PaymentSnapshotSchema.integrationId?: String.UUID
  PaymentSnapshotColumns.integrationId?: string; MethodSnapshot.integrationId?: string
  ChargeRepository.setPaymentLink(db, id, { url?, linkId?, state }, now)
  ChargeRepository.Row.provider_link_id?: string
  PaymentMethodRepository.insert/update(..., integrationId?: string | null)
  PaymentMethodRepository.pointer/defaultOf → MethodSnapshot with integrationId (from integration_id)
  ```

- [ ] **Step 1: Teste do cofre**

```ts
import { describe, expect, it } from 'vitest';
import { assertCredentialKeyConfigured, open, seal } from './secret-box';

const key = Buffer.alloc(32, 7).toString('base64');
const other = Buffer.alloc(32, 9).toString('base64');

describe('secret-box', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = seal('tok_123', key);
    const b = seal('tok_123', key);

    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe('tok_123');
  });

  it('refuses another key, a tampered value and garbage', () => {
    const sealed = seal('tok_123', key);

    expect(() => open(sealed, other)).toThrow('Sealed value is not readable');
    expect(() => open(`${sealed.slice(0, -2)}xx`, key)).toThrow('Sealed value is not readable');
    expect(() => open('nope', key)).toThrow('Sealed value is not readable');
  });

  it('requires a configured 32-byte key', () => {
    expect(() => assertCredentialKeyConfigured('')).toThrow('Payment credential key is not configured');
    expect(() => assertCredentialKeyConfigured('disabled')).toThrow('Payment credential key is not configured');
    expect(() => assertCredentialKeyConfigured(Buffer.alloc(16).toString('base64'))).toThrow('Payment credential key is not configured');
    expect(assertCredentialKeyConfigured(key)).toBe(key);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @receivy/api exec vitest run src/common/services/secret-box.test.ts --pool=forks` → FAIL.

- [ ] **Step 3: `secret-box.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function assertCredentialKeyConfigured(keyB64: string): string {
  if (!keyB64 || keyB64 === 'disabled' || Buffer.from(keyB64, 'base64').length !== KEY_BYTES) {
    throw new Error('Payment credential key is not configured');
  }

  return keyB64;
}

function unreadable(): never {
  throw new Error('Sealed value is not readable');
}

/** AES-256-GCM with a fresh IV per call: the same secret sealed twice never looks the same at rest. */
export function seal(plain: string, keyB64: string): string {
  const key = Buffer.from(assertCredentialKeyConfigured(keyB64), 'base64');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function open(sealed: string, keyB64: string): string {
  const [version, rawIv, rawTag, rawCiphertext, extra] = sealed.split('.');

  if (version !== VERSION || !rawIv || !rawTag || !rawCiphertext || extra !== undefined) {
    unreadable();
  }

  try {
    const key = Buffer.from(assertCredentialKeyConfigured(keyB64), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(rawIv, 'base64url'));

    decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));

    return Buffer.concat([decipher.update(Buffer.from(rawCiphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    unreadable();
  }
}
```

- [ ] **Step 4: Schema e tabela**

`integrations/schemas/integration.ts`:

```ts
import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { PaymentProvider } from '@receivy/common';

export const enum IntegrationCredentialKind {
  Token = 'token',
  Connect = 'connect'
}

/** What is not secret stays readable; the secret part lives sealed in `ciphertext`. */
export interface IntegrationCredentialsSchema {
  kind: IntegrationCredentialKind;
  /** AES-256-GCM `v1.<iv>.<tag>.<ct>` (base64url) of the secret: the API token, or the Connect access/refresh pair. */
  ciphertext: String.Max<2048>;
  /** Connect only, readable without decrypting. */
  accountId?: String.Max<120>;
  expiresAt?: String.DateTime;
  scope?: String.Max<200>;
}

/** One connected provider account per owner: the credential a payment method of that provider borrows. */
export interface IntegrationSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  provider: PaymentProvider;
  credentials: IntegrationCredentialsSchema;
  label: String.Max<120>;
  revoked_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
```

`database.ts`: nova tabela antes de `payment_methods`:

```ts
    Database.UseTable<{
      name: 'integrations';
      schema: IntegrationSchema;
      relations: { 'owner_id@owner': 'users:id' };
      indexes: {
        id: Index.Primary;
        'owner_id:provider': Index.Unique;
        owner_id: Index.Secondary;
      };
    }>,
```

`payment_methods.relations` ganha `'integration_id@integration': 'integrations:id'`. `PaymentMethodSchema` ganha `/** The provider account this method charges through; only providers that need a credential (PagBank) set it. */ integration_id?: String.UUID;`. `ChargeSchema` ganha `/** The provider's own id of the checkout (PagBank `CHEC_…`), what "inactivate" needs. */ provider_link_id?: String.Max<120>;` e `PaymentSnapshotSchema` ganha `integrationId?: String.UUID;` (jsonb, aditivo).

- [ ] **Step 5: Repository de integrações**

```ts
import type { PaymentProvider } from '@receivy/common';
import type { DbClient } from '../../database';
import type { IntegrationCredentialsSchema } from '../schemas/integration';

const sqlNull = null as unknown as undefined;

export namespace IntegrationRepository {
  export type Row = {
    id: string;
    owner_id: string;
    provider: PaymentProvider;
    credentials: IntegrationCredentialsSchema;
    label: string;
    revoked_at?: string;
    created_at: string;
    updated_at: string;
  };

  export async function get(db: DbClient, id: string): Promise<Row | null> {
    const row = await db.integrations.findOne({
      select: { id: true, owner_id: true, provider: true, credentials: true, label: true, revoked_at: true, created_at: true, updated_at: true },
      where: { id }
    });

    return row ?? null;
  }

  /** The owner's account at one provider, revoked or not: there is at most one. */
  export async function byOwner(db: DbClient, ownerId: string, provider: PaymentProvider): Promise<Row | null> {
    const row = await db.integrations.findOne({
      select: { id: true, owner_id: true, provider: true, credentials: true, label: true, revoked_at: true, created_at: true, updated_at: true },
      where: { owner_id: ownerId, provider }
    });

    return row ?? null;
  }

  /** Connects (or reconnects) the owner's account at a provider with fresh credentials; a revoked row comes back to life. */
  export async function upsert(
    db: DbClient,
    input: { ownerId: string; provider: PaymentProvider; credentials: IntegrationCredentialsSchema; label: string; now: string }
  ): Promise<Row> {
    const existing = await byOwner(db, input.ownerId, input.provider);

    if (existing) {
      await db.integrations.updateOne({
        select: { id: true },
        where: { id: existing.id },
        data: { credentials: input.credentials, label: input.label, revoked_at: sqlNull, updated_at: input.now }
      });

      return (await get(db, existing.id))!;
    }

    return db.integrations.insertOne({
      select: { id: true, owner_id: true, provider: true, credentials: true, label: true, revoked_at: true, created_at: true, updated_at: true },
      data: { id: crypto.randomUUID(), owner: { id: input.ownerId }, provider: input.provider, credentials: input.credentials, label: input.label, created_at: input.now, updated_at: input.now }
    });
  }

  export async function revoke(db: DbClient, id: string, now: string): Promise<void> {
    await db.integrations.updateOne({ select: { id: true }, where: { id }, data: { revoked_at: now, updated_at: now } });
  }
}
```

- [ ] **Step 6: `credential.ts` + teste**

```ts
import type { DbClient } from '../../database';
import { open } from '../../common/services/secret-box';
import { IntegrationRepository } from '../repositories/integration';

export type CredentialLookup = { status: 'ok'; secret: string } | { status: 'missing' | 'revoked' | 'unreadable' };

/** The decrypted secret of an integration, for the one call that needs it. Never store or log the result. */
export async function credentialOf(db: DbClient, keyB64: string, integrationId: string): Promise<CredentialLookup> {
  const integration = await IntegrationRepository.get(db, integrationId);

  if (!integration) {
    return { status: 'missing' };
  }

  if (integration.revoked_at) {
    return { status: 'revoked' };
  }

  try {
    return { status: 'ok', secret: open(integration.credentials.ciphertext, keyB64) };
  } catch {
    return { status: 'unreadable' };
  }
}
```

Teste (`credential.test.ts`, mock de `db.integrations.findOne`): ok → segredo; ausente → `missing`; `revoked_at` → `revoked`; chave errada → `unreadable`.

- [ ] **Step 7: Colunas nos leitores/escritores**

- `charges/utils/columns.ts`: `PaymentSnapshotColumns.integrationId?: string;` (`snapshotDto` NÃO expõe).
- `charges/repositories/charge.ts`: `Row.provider_link_id?: string`; adicionar `provider_link_id: true` em todo `select` que já lista `payment_link_url`; `setPaymentLink(db, id, input: { url?: string; linkId?: string; state: PaymentLinkState }, now)` grava `...(input.linkId ? { provider_link_id: input.linkId } : {})`; `paymentSnapshotWrite` repassa `integrationId` quando presente.
- `payment-methods/repositories/payment-method.ts`: `MethodSnapshot.integrationId?: string`; `snapshotOf` lê `integration_id`; `pointer`/`defaultOf` selecionam `integration_id: true`; `insert`/`update` aceitam `integrationId?: string | null` (`...(input.integrationId ? { integration: { id: input.integrationId } } : {})` no insert; no update `integration_id: input.integrationId ?? sqlNull` só quando o campo vier definido).
- `charges/services/materialize.ts` `persistChargePlan` e `billings/services/billing.ts` (edição) e `public/services/public-link.ts` (`setPayment`): incluir `...(context.payment.integrationId ? { integrationId: context.payment.integrationId } : {})` no snapshot gravado.
- `payment-methods/utils/dto.ts`: sem mudança (o DTO não expõe a integração).

- [ ] **Step 8: Variável**

`ez4.project.js` `variables`: `PAYMENT_CREDENTIAL_KEY_B64: process.env.PAYMENT_CREDENTIAL_KEY_B64 ?? 'disabled',`. `local.env.example` e `test.env.example`: `PAYMENT_CREDENTIAL_KEY_B64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=` com comentário "32 bytes base64; local/test only — generate one per stage with `openssl rand -base64 32`; changing it later makes every stored provider credential unreadable". `dev.env.example`: `PAYMENT_CREDENTIAL_KEY_B64=<32-byte-random-base64>` e `PAYMENT_METHOD_LINK=sandbox` com comentário dos quatro valores.

- [ ] **Step 9: Verificar** — `pnpm --filter @receivy/api exec vitest run src/common/services src/integrations --pool=forks` verde; `pnpm --filter @receivy/api check-types` verde; `pnpm --filter @receivy/api test` só as 6 falhas baseline de e-mail.

---

### Task 3: Vendor PagBank

**Files:**
- Create: `packages/api/src/vendors/pagseguro/types.ts`, `client.ts`, `client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const enum PagSeguroHost { Live = 'https://api.pagseguro.com', Sandbox = 'https://sandbox.api.pagseguro.com' }
  type PagSeguroCheckoutInput = { referenceId: string; amountCents: number; description: string; expiresAt: string; redirectUrl: string; webhookUrl: string };
  type PagSeguroVerifyResult = { status: 'valid' | 'invalid' | 'unavailable' };
  type PagSeguroCheckoutResult = { status: 'created'; id: string; url: string } | { status: 'unauthorized' } | { status: 'unavailable' };
  type PagSeguroOrderCharge = { id: string; status: string; amountCents: number; paidCents: number; method: string };
  type PagSeguroOrderResult = { status: 'found'; charges: PagSeguroOrderCharge[] } | { status: 'unauthorized' } | { status: 'unavailable' };
  type PagSeguroInactivateResult = { status: 'done' | 'unauthorized' | 'unavailable' };
  interface PagSeguroClient { verifyToken(token): Promise<PagSeguroVerifyResult>; createCheckout(token, input): Promise<PagSeguroCheckoutResult>; getOrder(token, orderId): Promise<PagSeguroOrderResult>; inactivate(token, checkoutId): Promise<PagSeguroInactivateResult> }
  createPagSeguroClient(host: string, request?: typeof fetch): PagSeguroClient
  ```

- [ ] **Step 1: `types.ts`** — os tipos acima, mais o tipo bruto da notificação usado pelo webhook (Task 7):

```ts
/** The order PagBank posts to `notification_urls` (subset the API reads). */
export type PagSeguroOrderNotification = {
  id?: string;
  reference_id?: string;
  charges?: { id?: string; status?: string; amount?: { value?: number; summary?: { paid?: number } }; payment_method?: { type?: string } }[];
};
```

- [ ] **Step 2: Teste do cliente** (`client.test.ts`, `respond(status, body)` como no teste do InfinitePay):

```ts
const client = (status: number, body: unknown) => createPagSeguroClient(PagSeguroHost.Sandbox, respond(status, body) as unknown as typeof fetch);

it('verifies a token by probing a checkout that cannot exist', async () => {
  expect(await client(401, { error_messages: [{ error: 'invalid_authorization_header' }] }).verifyToken('t')).toEqual({ status: 'invalid' });
  expect(await client(404, {}).verifyToken('t')).toEqual({ status: 'valid' });
  expect(await client(200, { id: 'CHEC_x' }).verifyToken('t')).toEqual({ status: 'valid' });
  expect(await client(503, {}).verifyToken('t')).toEqual({ status: 'unavailable' });
});

it('creates a checkout and reads the PAY link', async () => {
  const request = respond(201, { id: 'CHEC_1', status: 'ACTIVE', links: [{ rel: 'SELF', href: 'https://api/CHEC_1', method: 'GET' }, { rel: 'PAY', href: 'https://pagamento.pagbank.com.br/pagamento?code=abc', method: 'GET' }] });
  const result = await createPagSeguroClient(PagSeguroHost.Live, request as unknown as typeof fetch).createCheckout('tok', { referenceId: 'c1', amountCents: 1250, description: 'Aluguel', expiresAt: '2026-12-18T00:00:00.000Z', redirectUrl: 'https://web/pay/x?returned=1', webhookUrl: 'https://api/webhooks/pagseguro/tok' });

  expect(result).toEqual({ status: 'created', id: 'CHEC_1', url: 'https://pagamento.pagbank.com.br/pagamento?code=abc' });

  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];

  expect(url).toBe('https://api.pagseguro.com/checkouts');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  expect(JSON.parse(init.body as string)).toEqual({
    reference_id: 'c1',
    expiration_date: '2026-12-18T00:00:00.000Z',
    customer_modifiable: true,
    items: [{ reference_id: 'c1', name: 'Aluguel', quantity: 1, unit_amount: 1250 }],
    payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }],
    soft_descriptor: 'Receivy',
    redirect_url: 'https://web/pay/x?returned=1',
    notification_urls: ['https://api/webhooks/pagseguro/tok']
  });
});

it('maps 401 to unauthorized and everything else to unavailable, never leaking the body', async () => {
  const input = { referenceId: 'c1', amountCents: 1, description: 'x', expiresAt: 'e', redirectUrl: 'r', webhookUrl: 'w' };

  expect(await client(401, { secret: 1 }).createCheckout('t', input)).toEqual({ status: 'unauthorized' });
  expect(await client(400, {}).createCheckout('t', input)).toEqual({ status: 'unavailable' });
  expect(await client(201, { id: 'CHEC_1', links: [] }).createCheckout('t', input)).toEqual({ status: 'unavailable' });
});

it('reads an order and its charges', async () => {
  const result = await client(200, { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'PAID', amount: { value: 1250, summary: { paid: 1250 } }, payment_method: { type: 'PIX' } }] }).getOrder('t', 'ORDE_1');

  expect(result).toEqual({ status: 'found', charges: [{ id: 'CHAR_1', status: 'PAID', amountCents: 1250, paidCents: 1250, method: 'PIX' }] });
});

it('inactivates a checkout', async () => {
  const request = respond(200, { id: 'CHEC_1', status: 'INACTIVE' });

  expect(await createPagSeguroClient(PagSeguroHost.Live, request as unknown as typeof fetch).inactivate('t', 'CHEC_1')).toEqual({ status: 'done' });
  expect((request.mock.calls[0] as unknown as [string])[0]).toBe('https://api.pagseguro.com/checkouts/CHEC_1/inactivate');
});
```

- [ ] **Step 3: Rodar e ver falhar.**

- [ ] **Step 4: `client.ts`**

```ts
import type { PagSeguroCheckoutInput, PagSeguroCheckoutResult, PagSeguroClient, PagSeguroInactivateResult, PagSeguroOrderResult, PagSeguroVerifyResult } from './types';

const REQUEST_TIMEOUT_MS = 8_000;
const DESCRIPTION_MAX = 100;
const PROBE_CHECKOUT = 'CHEC_00000000-0000-0000-0000-000000000000';

/** PagBank bodies and errors never escape this boundary or enter logs; the token only travels in the header. */
export function createPagSeguroClient(host: string, request: typeof fetch = globalThis.fetch): PagSeguroClient {
  const base = host.replace(/\/+$/, '');

  async function call(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    return request(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  }

  return {
    async verifyToken(token): Promise<PagSeguroVerifyResult> {
      try {
        const response = await call(token, 'GET', `/checkouts/${PROBE_CHECKOUT}`);

        if (response.status === 401) {
          return { status: 'invalid' };
        }

        if (response.status === 404 || response.ok) {
          return { status: 'valid' };
        }

        return { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async createCheckout(token, input): Promise<PagSeguroCheckoutResult> {
      try {
        const response = await call(token, 'POST', '/checkouts', {
          reference_id: input.referenceId,
          expiration_date: input.expiresAt,
          customer_modifiable: true,
          items: [{ reference_id: input.referenceId, name: input.description.slice(0, DESCRIPTION_MAX), quantity: 1, unit_amount: input.amountCents }],
          payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }],
          soft_descriptor: 'Receivy',
          redirect_url: input.redirectUrl,
          notification_urls: [input.webhookUrl]
        });

        if (response.status === 401) {
          return { status: 'unauthorized' };
        }

        if (!response.ok) {
          return { status: 'unavailable' };
        }

        const body = (await response.json().catch(() => ({}))) as { id?: unknown; links?: { rel?: unknown; href?: unknown }[] };
        const pay = Array.isArray(body.links) ? body.links.find((link) => link.rel === 'PAY') : undefined;

        if (typeof body.id !== 'string' || typeof pay?.href !== 'string') {
          return { status: 'unavailable' };
        }

        return { status: 'created', id: body.id, url: pay.href };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async getOrder(token, orderId): Promise<PagSeguroOrderResult> {
      try {
        const response = await call(token, 'GET', `/orders/${encodeURIComponent(orderId)}`);

        if (response.status === 401) {
          return { status: 'unauthorized' };
        }

        if (!response.ok) {
          return { status: 'unavailable' };
        }

        const body = (await response.json().catch(() => ({}))) as { charges?: { id?: unknown; status?: unknown; amount?: { value?: unknown; summary?: { paid?: unknown } }; payment_method?: { type?: unknown } }[] };
        const charges = (Array.isArray(body.charges) ? body.charges : []).map((charge) => ({
          id: typeof charge.id === 'string' ? charge.id : '',
          status: typeof charge.status === 'string' ? charge.status : '',
          amountCents: typeof charge.amount?.value === 'number' ? charge.amount.value : 0,
          paidCents: typeof charge.amount?.summary?.paid === 'number' ? charge.amount.summary.paid : 0,
          method: typeof charge.payment_method?.type === 'string' ? charge.payment_method.type : ''
        }));

        return { status: 'found', charges };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async inactivate(token, checkoutId): Promise<PagSeguroInactivateResult> {
      try {
        const response = await call(token, 'POST', `/checkouts/${encodeURIComponent(checkoutId)}/inactivate`);

        if (response.status === 401) {
          return { status: 'unauthorized' };
        }

        return response.ok ? { status: 'done' } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    }
  };
}
```

- [ ] **Step 5: Verificar** — `pnpm --filter @receivy/api exec vitest run src/vendors/pagseguro --pool=forks` verde; `check-types` verde.

---

### Task 4: Interface comum `CheckoutClient` e migração dos chamadores

**Files:**
- Create: `packages/api/src/vendors/checkout/types.ts`, `infinitepay.ts`, `pagseguro.ts`, `fake.ts`, `fake.test.ts`
- Delete: `packages/api/src/vendors/infinitepay/fake.ts`
- Modify: `packages/api/src/charges/services/payment-link.ts` (+ test), `settle.ts` (+ test), `packages/api/src/notifications/services/{planner,context,send}.ts`, `packages/api/src/payment-methods/services/payment-method.ts`, `packages/api/src/public/services/public-link.ts`, `packages/api/src/public/endpoints/provider-return.ts`, `packages/api/src/webhooks/endpoints/infinitepay.ts`, `packages/api/src/charges/endpoints/payment-link.ts`, `packages/api/test/fixtures/{financial,scheduling}.ts`, `packages/api/test/financial/infinitepay.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // vendors/checkout/types.ts
  export type CheckoutProvider = PaymentProvider.InfinitePay | PaymentProvider.PagSeguro;
  export type CheckoutLinkInput = { orderNsu: string; amountCents: number; description: string; webhookUrl?: string; redirectUrl?: string; expiresAt: string; /** InfinitePay: the handle. */ identity?: string; /** PagBank: the decrypted token. */ credential?: string };
  export type CheckoutLinkResult = { status: 'created'; url: string; linkId?: string } | { status: 'checkout_disabled'; redirectUrl: string } | { status: 'unauthorized' } | { status: 'unavailable' };
  export type CheckoutCheckInput =
    | { provider: PaymentProvider.InfinitePay; identity: string; orderNsu: string; transactionNsu: string; slug: string }
    | { provider: PaymentProvider.PagSeguro; credential: string; orderId: string; transactionNsu: string };
  export type CheckoutCheckResult = { status: 'checked'; paid: boolean; amountCents: number; paidAmountCents: number; captureMethod: string } | { status: 'unauthorized' } | { status: 'unavailable' };
  export type CheckoutInactivateResult = { status: 'done' | 'unsupported' | 'unauthorized' | 'unavailable' };
  export type CredentialVerifyResult = { status: 'valid' | 'invalid' | 'unsupported' | 'unavailable' };
  export interface CheckoutClient {
    createLink(input: CheckoutLinkInput): Promise<CheckoutLinkResult>;
    checkPayment(input: CheckoutCheckInput): Promise<CheckoutCheckResult>;
    inactivate(input: { credential?: string; linkId: string }): Promise<CheckoutInactivateResult>;
    verifyCredential(credential: string): Promise<CredentialVerifyResult>;
  }
  export type CheckoutClients = Record<CheckoutProvider, CheckoutClient>;
  // adapters
  infinitePayCheckout(client: PaymentLinkProvider): CheckoutClient      // vendors/checkout/infinitepay.ts
  pagSeguroCheckout(client: PagSeguroClient): CheckoutClient            // vendors/checkout/pagseguro.ts
  fakeCheckout(webOrigin: string, provider: CheckoutProvider): CheckoutClient; fakeLinkCount(): number   // vendors/checkout/fake.ts
  // charges/services/payment-link.ts
  const enum PaymentLinkMode { Live='live', Sandbox='sandbox', Fake='fake', Disabled='disabled' }
  checkoutClients(env: { PAYMENT_METHOD_LINK?; PUBLIC_WEB_ORIGIN? }, request?): CheckoutClients     // replaces paymentLinkProvider
  PaymentLinkConfig += credentialKeyB64: string;  PaymentLinkVariables += PAYMENT_CREDENTIAL_KEY_B64?: string
  ensurePaymentLink(db, clients: CheckoutClients, config, chargeId, now?, transport?)   // this task: InfinitePay branch only, structure ready for PagBank
  // charges/services/settle.ts
  type SettleInput = { chargeId: string; transactionNsu: string; receiptUrl?: string } & ({ provider: PaymentProvider.InfinitePay; slug: string } | { provider: PaymentProvider.PagSeguro; orderId: string })
  settleByProvider(db, clients: CheckoutClients, notices, input, now?)     // rejects when input.provider !== snapshot.provider → 'ignored'
  // notifications
  NoticeContext.links: CheckoutClients; NotificationConfig.credentialKeyB64: string; NotificationVariables += PAYMENT_CREDENTIAL_KEY_B64?
  ```

- [ ] **Step 1: Tipos e adaptadores**

`vendors/checkout/types.ts`: os tipos acima.

`vendors/checkout/infinitepay.ts`:

```ts
import { PaymentProvider } from '@receivy/common';
import type { PaymentLinkProvider } from '../infinitepay/types';
import type { CheckoutClient } from './types';

/** InfinitePay through the common checkout interface: the handle is the identity, there is no credential, no inactivation. */
export function infinitePayCheckout(client: PaymentLinkProvider): CheckoutClient {
  return {
    async createLink(input) {
      if (!input.identity) {
        return { status: 'unavailable' };
      }

      return client.createLink({
        handle: input.identity,
        orderNsu: input.orderNsu,
        items: [{ quantity: 1, price: input.amountCents, description: input.description }],
        webhookUrl: input.webhookUrl,
        redirectUrl: input.redirectUrl
      });
    },

    async checkPayment(input) {
      if (input.provider !== PaymentProvider.InfinitePay) {
        return { status: 'unavailable' };
      }

      return client.checkPayment({ handle: input.identity, orderNsu: input.orderNsu, transactionNsu: input.transactionNsu, slug: input.slug });
    },

    async inactivate() {
      return { status: 'unsupported' };
    },

    async verifyCredential() {
      return { status: 'unsupported' };
    }
  };
}
```

`vendors/checkout/pagseguro.ts`:

```ts
import { PaymentProvider } from '@receivy/common';
import type { PagSeguroClient } from '../pagseguro/types';
import type { CheckoutClient } from './types';

const PAID = 'PAID';

/** PagBank through the common checkout interface: the credential is the seller's token, decrypted by the caller for this call only. */
export function pagSeguroCheckout(client: PagSeguroClient): CheckoutClient {
  return {
    async createLink(input) {
      if (!input.credential || !input.webhookUrl || !input.redirectUrl) {
        return { status: 'unavailable' };
      }

      const result = await client.createCheckout(input.credential, {
        referenceId: input.orderNsu,
        amountCents: input.amountCents,
        description: input.description,
        expiresAt: input.expiresAt,
        redirectUrl: input.redirectUrl,
        webhookUrl: input.webhookUrl
      });

      if (result.status !== 'created') {
        return result;
      }

      return { status: 'created', url: result.url, linkId: result.id };
    },

    async checkPayment(input) {
      if (input.provider !== PaymentProvider.PagSeguro) {
        return { status: 'unavailable' };
      }

      const order = await client.getOrder(input.credential, input.orderId);

      if (order.status !== 'found') {
        return order;
      }

      const charge = order.charges.find((item) => item.id === input.transactionNsu);

      if (!charge) {
        return { status: 'checked', paid: false, amountCents: 0, paidAmountCents: 0, captureMethod: '' };
      }

      return { status: 'checked', paid: charge.status === PAID, amountCents: charge.amountCents, paidAmountCents: charge.paidCents, captureMethod: charge.method.toLowerCase() };
    },

    async inactivate(input) {
      if (!input.credential) {
        return { status: 'unauthorized' };
      }

      return client.inactivate(input.credential, input.linkId);
    },

    verifyCredential: (credential) => client.verifyToken(credential)
  };
}
```

`vendors/checkout/fake.ts` (substitui `vendors/infinitepay/fake.ts`; mantém o `Map` por processo, `fakeLinkCount`, `unpaid` prefixo):

```ts
import type { PaymentProvider } from '@receivy/common';
import type { CheckoutClient, CheckoutProvider } from './types';

const links = new Map<string, { amountCents: number }>();

/** Test-only: how many links this process has created so far, to assert a probe did (or did not) run. */
export function fakeLinkCount(): number {
  return links.size;
}

/**
 * Stands in for any provider on local and test: every handle and every token works, the link points at the web's
 * `/dev/checkout/<provider>/<order>` page (carrying the redirect back), a check pays exactly what was linked, and a
 * transaction nsu starting with `unpaid` is refused. Inactivation always succeeds.
 */
export function fakeCheckout(webOrigin: string, provider: CheckoutProvider): CheckoutClient {
  const origin = webOrigin.replace(/\/+$/, '');

  return {
    async createLink(input) {
      links.set(input.orderNsu, { amountCents: input.amountCents });

      const redirect = input.redirectUrl ? `?redirect=${encodeURIComponent(input.redirectUrl)}` : '';

      return { status: 'created', url: `${origin}/dev/checkout/${provider}/${input.orderNsu}${redirect}`, linkId: `fake-${input.orderNsu}` };
    },

    async checkPayment(input) {
      const orderNsu = input.provider === (provider as PaymentProvider) ? ('orderNsu' in input ? input.orderNsu : input.orderId) : '';
      const linked = links.get(orderNsu);
      const paid = !!linked && !input.transactionNsu.startsWith('unpaid');

      return { status: 'checked', paid, amountCents: linked?.amountCents ?? 0, paidAmountCents: linked?.amountCents ?? 0, captureMethod: 'pix' };
    },

    async inactivate() {
      return { status: 'done' };
    },

    async verifyCredential() {
      return { status: 'valid' };
    }
  };
}
```

Nota: para PagBank o fake usa `orderId` = id da charge (a rota fake de pagamento da Task 7 chama com `orderId: chargeId`).

`fake.test.ts`: cria link para `pagseguro` → URL `/dev/checkout/pagseguro/<id>?redirect=…` e `linkId`; `checkPayment` com `{ provider: PagSeguro, orderId: id, transactionNsu: 'tx' }` paga o valor; `unpaid-…` → `paid: false`; `verifyCredential` `valid`; `inactivate` `done`.

- [ ] **Step 2: `payment-link.ts`**

Substituir `PaymentLinkMode`, `disabledProvider`, `paymentLinkProvider` por:

```ts
export const enum PaymentLinkMode {
  Live = 'live',
  Sandbox = 'sandbox',
  Fake = 'fake',
  Disabled = 'disabled'
}

const disabledClient: CheckoutClient = {
  createLink: async () => ({ status: 'unavailable' }),
  checkPayment: async () => ({ status: 'unavailable' }),
  inactivate: async () => ({ status: 'unavailable' }),
  verifyCredential: async () => ({ status: 'unavailable' })
};

/**
 * `PAYMENT_METHOD_LINK` picks the clients: `live` talks to the providers, `sandbox` too but PagBank on its sandbox host
 * (InfinitePay has none), `fake` answers in-process, anything else is off.
 */
export function checkoutClients(env: { PAYMENT_METHOD_LINK?: string; PUBLIC_WEB_ORIGIN?: string }, request: typeof fetch = globalThis.fetch): CheckoutClients {
  const mode = env.PAYMENT_METHOD_LINK;

  if (mode === PaymentLinkMode.Live || mode === PaymentLinkMode.Sandbox) {
    return {
      [PaymentProvider.InfinitePay]: infinitePayCheckout(createInfinitePayClient(request)),
      [PaymentProvider.PagSeguro]: pagSeguroCheckout(createPagSeguroClient(mode === PaymentLinkMode.Sandbox ? PagSeguroHost.Sandbox : PagSeguroHost.Live, request))
    };
  }

  if (mode === PaymentLinkMode.Fake) {
    const origin = env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000';

    return { [PaymentProvider.InfinitePay]: fakeCheckout(origin, PaymentProvider.InfinitePay), [PaymentProvider.PagSeguro]: fakeCheckout(origin, PaymentProvider.PagSeguro) };
  }

  return { [PaymentProvider.InfinitePay]: disabledClient, [PaymentProvider.PagSeguro]: disabledClient };
}

export type PaymentLinkConfig = { apiOrigin: string; webOrigin: string; secret: string; credentialKeyB64: string };
export type PaymentLinkVariables = { PUBLIC_API_ORIGIN?: string; PUBLIC_WEB_ORIGIN: string; PUBLIC_LINK_HMAC_SECRET: string; PAYMENT_METHOD_LINK?: string; PAYMENT_CREDENTIAL_KEY_B64?: string };

export function paymentLinkConfigFrom(variables: PaymentLinkVariables): PaymentLinkConfig {
  return {
    apiOrigin: (variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, ''),
    webOrigin: variables.PUBLIC_WEB_ORIGIN.replace(/\/+$/, ''),
    secret: variables.PUBLIC_LINK_HMAC_SECRET,
    credentialKeyB64: variables.PAYMENT_CREDENTIAL_KEY_B64 ?? 'disabled'
  };
}

/** Providers with a checkout link; a Pix snapshot has none. */
export function checkoutProviderOf(provider: PaymentProvider): CheckoutProvider | null {
  if (provider === PaymentProvider.InfinitePay || provider === PaymentProvider.PagSeguro) {
    return provider;
  }

  return null;
}
```

`ensurePaymentLink(db, clients: CheckoutClients, config, chargeId, now, transport)`: `const provider = payment ? checkoutProviderOf(payment.provider) : null; if (!charge || !provider) return null;` … `clients[provider].createLink({ orderNsu: charge.id, amountCents: charge.amount_cents, description: charge.description, webhookUrl: \`${config.apiOrigin}/webhooks/${provider}/${webhookToken(...)}\`, redirectUrl: \`${config.webOrigin}/pay/${linkToken(publicLink, config.secret)}\`, expiresAt: publicLink.expires_at, identity: payment.value })` — nesta task só InfinitePay funciona de fato (PagBank sem `credential` → `unavailable`, que a Task 6 resolve). `created` grava `{ url: result.url, linkId: result.linkId, state: Ready }`. Novo ramo `unauthorized` → `failed` + evento `{ reason: 'unauthorized' }` (push fica para a Task 6). Exportar `checkoutProviderOf`; os chamadores importam `CheckoutClients` de `vendors/checkout/types`.

- [ ] **Step 3: `settle.ts`**

`SettleInput` vira a união acima. No início: `const provider = payment ? checkoutProviderOf(payment.provider) : null; if (!charge || !provider || provider !== input.provider) return 'ignored';`. O `checkPayment`:

```ts
  const check = await clients[provider].checkPayment(
    input.provider === PaymentProvider.InfinitePay
      ? { provider: input.provider, identity: payment.value, orderNsu: charge.id, transactionNsu: input.transactionNsu, slug: input.slug }
      : { provider: input.provider, credential: input.credential, orderId: input.orderId, transactionNsu: input.transactionNsu }
  );
```

Para isso a união PagBank de `SettleInput` carrega `credential: string` (o webhook decifra antes; Task 7). `check.status === 'unauthorized'` → evento `charge.provider.rejected { reason: 'unauthorized' }`, retorna `'rejected'`. Textos dos pushes: trocar "InfinitePay" por `providerName(provider)` (`'InfinitePay' | 'PagBank'`, helper local). `charge.paid` payload `provider: provider`.

- [ ] **Step 4: Chamadores**

- `notifications/services/planner.ts`: `NotificationConfig.credentialKeyB64: string`; `NotificationVariables.PAYMENT_CREDENTIAL_KEY_B64?: string`; `notificationConfigFrom` preenche (`?? 'disabled'`).
- `notifications/services/context.ts`: `links: checkoutClients(variables)`; `NoticeContext.links: CheckoutClients` em `send.ts`; `linkConfig(config)` inclui `credentialKeyB64`. A gate `LinkPending` passa a valer para qualquer `checkoutProviderOf(...)` (não só InfinitePay).
- `payment-methods/services/payment-method.ts`: `const clients = checkoutClients(variables)`; `probeHandle(clients[PaymentProvider.InfinitePay], handle)` com `createLink({ identity: handle, orderNsu: \`probe:${crypto.randomUUID()}\`, amountCents: 100, description: 'Validação Receivy', expiresAt: new Date(Date.now() + 86_400_000).toISOString() })`.
- `public/services/public-link.ts`, `charges/endpoints/payment-link.ts`, `webhooks/endpoints/infinitepay.ts` (`settleByProvider(..., { provider: PaymentProvider.InfinitePay, chargeId, transactionNsu, slug, receiptUrl })`), `public/endpoints/provider-return.ts` (idem): `checkoutClients(variables)` no lugar de `paymentLinkProvider`.
- Blocos `variables` dos 10 produtores (lista no mapa): `PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;`.
- Fixtures: `scheduling.ts` `fakeNotice` → `links: { [PaymentProvider.InfinitePay]: fakeCheckout(origin, PaymentProvider.InfinitePay), [PaymentProvider.PagSeguro]: fakeCheckout(origin, PaymentProvider.PagSeguro) }` e `TEST_CONFIG.credentialKeyB64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='`; `financial.ts` `paymentMethods` variables ganham `PAYMENT_CREDENTIAL_KEY_B64` idem; `infinitepay.spec.ts` importa `fakeCheckout`/`fakeLinkCount` de `vendors/checkout/fake` e monta `clients`.
- Testes unit `payment-link.test.ts` / `settle.test.ts`: `provider(...)` helper vira `clients` com o mesmo mock nos dois providers; `settle` inputs ganham `provider: PaymentProvider.InfinitePay`.

- [ ] **Step 5: Verificar** — `grep -rn "paymentLinkProvider\|vendors/infinitepay/fake" packages/api/src packages/api/test` → zero; `pnpm --filter @receivy/api check-types`; `pnpm --filter @receivy/api test` (só baseline); `pnpm --filter @receivy/api check-types:test`; `pnpm --filter @receivy/api test:integration` (só `account-concurrency` baseline).

---

### Task 5: Salvar método PagBank (verificar, cifrar, integração)

**Files:**
- Modify: `packages/api/src/payment-methods/errors.ts`, `utils/input.ts` (+ test), `services/payment-method.ts`, `packages/api/src/api.ts`
- Create: `packages/api/src/payment-methods/services/pagseguro.test.ts`

**Interfaces:**
- Produces:
  ```ts
  PagSeguroTokenInvalidError (422 'PAGSEGURO_TOKEN_INVALID', 'Token inválido ou sem permissão.')
  PaymentCredentialKeyMissingError (503 'PAYMENT_CREDENTIAL_KEY_MISSING', 'O cofre de credenciais não está configurado.')
  PaymentMethodBody += token?: String.Max<512>; value becomes optional
  normalizePaymentMethod(pagseguro) → { provider: PagSeguro, kind: null, value: label, label }
  PaymentMethodService.variables += PAYMENT_CREDENTIAL_KEY_B64
  save(pagseguro): verifies, seals, upserts the integration, inserts/updates the method with integration_id; edit without token keeps it
  archive(pagseguro method) → IntegrationRepository.revoke
  ```

- [ ] **Step 1: Erros + body**

`errors.ts`:

```ts
export class PagSeguroTokenInvalidError extends UnprocessableEntityError {
  constructor(message = 'Token inválido ou sem permissão.') {
    super(message, 'PAGSEGURO_TOKEN_INVALID');
  }
}

export class PaymentCredentialKeyMissingError extends ServiceUnavailableError {
  constructor(message = 'O cofre de credenciais não está configurado.') {
    super(message, 'PAYMENT_CREDENTIAL_KEY_MISSING');
  }
}
```

`api.ts`: 422 ganha `PagSeguroTokenInvalidError`; 503 ganha `PaymentCredentialKeyMissingError`. Mensagem de `PaymentLinkUnavailableError` vira "Não deu para falar com o provedor de pagamento agora. Tente de novo em instantes."

`utils/input.ts`: `PaymentMethodBody.value?: String.Max<254>; token?: String.Max<512>;`; `paymentMethodInput`: `PagSeguro` → `{ provider: PaymentProvider.PagSeguro, token: body.token, label: body.label }`; Pix/InfinitePay exigem `value` (`if (!body.value) throw new HttpBadRequestError('Informe o valor do meio.')`). `normalizePaymentMethod`: PagBank → `label = input.label?.normalize('NFC').trim() || 'PagBank'`, `{ provider, kind: null, value: label, label }`. Teste em `input.test.ts`: PagBank sem label → value/label "PagBank"; com label → ambos iguais ao label.

- [ ] **Step 2: Teste do service** (`services/pagseguro.test.ts`, mocks de `db` como nos outros testes de service; `clients[PagSeguro].verifyCredential` como `vi.fn`):

```ts
it('refuses to create a PagBank method without a token', …)            // 400 'Informe o token do PagBank.'
it('refuses an invalid token with 422 and never writes', …)            // verifyCredential → invalid
it('answers 503 when the credential key is not configured', …)         // variables key 'disabled' → PaymentCredentialKeyMissingError, verifyCredential NOT called
it('seals the token, upserts the integration and links the method', …) // integrations.insertOne data.credentials.ciphertext starts with 'v1.' and !== token; payment_methods.insertOne data.integration.id === integration id; provider 'pagseguro', value === label
it('keeps the stored credential when editing without a token', …)      // verifyCredential NOT called; integrations untouched; label updated
it('revokes the integration when the method is archived', …)           // integrations.updateOne with revoked_at
```

- [ ] **Step 3: Rodar e ver falhar.**

- [ ] **Step 4: Service**

Em `save`, ramo `input.provider === PaymentProvider.PagSeguro` (antes da transação):

```ts
  let credentials: IntegrationCredentialsSchema | undefined;

  if (input.provider === PaymentProvider.PagSeguro) {
    const existing = id ? await PaymentMethodRepository.get(db, ownerId, id) : null;

    if (id && (!existing || existing.archivedAt)) {
      throw new HttpNotFoundError();
    }

    if (!existing && !input.token) {
      throw new HttpBadRequestError('Informe o token do PagBank.');
    }

    if (input.token) {
      let keyB64: string;

      try {
        keyB64 = assertCredentialKeyConfigured(variables.PAYMENT_CREDENTIAL_KEY_B64);
      } catch {
        throw new PaymentCredentialKeyMissingError();
      }

      await enforceQuota(db, `pagseguro-verify:${ownerId}`, 10);

      const verified = await clients[PaymentProvider.PagSeguro].verifyCredential(input.token);

      if (verified.status === 'invalid') {
        throw new PagSeguroTokenInvalidError();
      }

      if (verified.status !== 'valid') {
        throw new PaymentLinkUnavailableError();
      }

      credentials = { kind: IntegrationCredentialKind.Token, ciphertext: seal(input.token, keyB64) };
    }
  }
```

Dentro da transação, para PagBank: `contactId` → 400 "Um contato só recebe por Pix."; se `credentials` → `const integration = await IntegrationRepository.upsert(tx, { ownerId, provider: PaymentProvider.PagSeguro, credentials, label: method.label, now })` e `integrationId = integration.id`; senão `integrationId = existing.integrationId` (o repository `get` passa a devolver `integrationId` no `PaymentMethod`? Não expor no DTO: adicionar `PaymentMethodRepository.integrationOf(db, id): Promise<string | null>` com select `{ integration_id }`). `insert/update` recebem `integrationId`. `save` precisa de `variables` → assinatura `save(db, clients, variables, ownerId, input, id)`.

`archive`: depois de `PaymentMethodRepository.archive`, se `target.provider === PaymentProvider.PagSeguro`: `const integrationId = await PaymentMethodRepository.integrationOf(tx, id); if (integrationId) { await IntegrationRepository.revoke(tx, integrationId, now); }`.

`PaymentMethodService.variables` += `PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;`.

- [ ] **Step 5: Verificar** — unit verde; `check-types`; integração `test/financial/infinitepay.spec.ts` continua verde (regressão).

---

### Task 6: `ensurePaymentLink` para PagBank

**Files:**
- Modify: `packages/api/src/charges/services/payment-link.ts` (+ test)

**Interfaces:**
- Consumes: `credentialOf`, `checkoutProviderOf`, `CheckoutClients`.
- Produces: PagBank branch: `snapshot.integrationId` → `credentialOf(db, config.credentialKeyB64, integrationId)`; `missing|revoked|unreadable` → `failed` + evento `charge.payment_link.failed { reason: 'no_credential' }` (sem chamada externa); `ok` → `createLink({ ..., credential: secret })`; `unauthorized` → `failed` + evento `{ reason: 'unauthorized' }` + push ao dono na transição ("Token do PagBank inválido" / "Reconecte sua conta PagBank em Meios de pagamento para a cobrança ganhar um link."). `inactivatePaymentLink(db, clients, config, chargeId, now?)`: charge PagBank com `provider_link_id` → credencial → `clients.pagseguro.inactivate({ credential, linkId })` → `done` grava evento `charge.payment_link.inactivated`, senão `charge.payment_link.inactivate_failed { reason }`; nunca lança (erro de banco propaga).

- [ ] **Step 1: Testes** (mesmo mock `dbWith` do arquivo; snapshot `{ provider: 'pagseguro', value: 'Loja', label: 'Loja', integrationId: 'int-1' }`; `db.integrations.findOne` devolve a integração com `credentials.ciphertext = seal('tok', KEY)`):

```ts
it('decrypts the PagBank token for the call and stores the checkout id', …)   // createLink called with credential 'tok', expiresAt = public link expiry; update has provider_link_id 'CHEC_1'
it('fails without an external call when the integration is revoked', …)        // reason 'no_credential', createLink not called
it('marks unauthorized and pushes the owner once', …)                          // reason 'unauthorized', push 1x, second run no push
it('inactivates a cancelled PagBank checkout', …)                              // inactivatePaymentLink → clients.pagseguro.inactivate called with linkId, event inactivated
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** — no `ensurePaymentLink`, antes do `try`:

```ts
  let credential: string | undefined;

  if (provider === PaymentProvider.PagSeguro) {
    const lookup = payment.integrationId ? await credentialOf(db, config.credentialKeyB64, payment.integrationId) : { status: 'missing' as const };

    if (lookup.status !== 'ok') {
      await ChargeRepository.setPaymentLink(db, charge.id, { state: PaymentLinkState.Failed }, stamp);
      await record(db, charge.id, 'charge.payment_link.failed', { reason: 'no_credential', detail: lookup.status }, stamp);

      return PaymentLinkState.Failed;
    }

    credential = lookup.secret;
  }
```

e `createLink({ ..., identity: payment.value, credential })`. Ramo `unauthorized`:

```ts
  if (result.status === 'unauthorized') {
    await record(db, charge.id, 'charge.payment_link.failed', { reason: 'unauthorized' }, stamp);

    if (transport && current !== PaymentLinkState.Failed) {
      await pushToUser(db, transport, ownerOf(charge), { title: 'Token do PagBank inválido', body: 'Reconecte sua conta PagBank em Meios de pagamento para a cobrança ganhar um link.', url: `${config.webOrigin}/settings/payment-methods` });
    }

    return PaymentLinkState.Failed;
  }
```

`inactivatePaymentLink`:

```ts
/** Best-effort after a cancel: a PagBank checkout that is still open is switched off so nobody pays a dead charge. */
export async function inactivatePaymentLink(db: DbClient, clients: CheckoutClients, config: PaymentLinkConfig, chargeId: string, now = Date.now()): Promise<void> {
  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;
  const provider = payment ? checkoutProviderOf(payment.provider) : null;

  if (!charge || !provider || !charge.provider_link_id || charge.payment_link_state !== PaymentLinkState.Ready) {
    return;
  }

  const stamp = new Date(now).toISOString();
  const lookup = payment?.integrationId ? await credentialOf(db, config.credentialKeyB64, payment.integrationId) : { status: 'missing' as const };
  const result = lookup.status === 'ok' ? await clients[provider].inactivate({ credential: lookup.secret, linkId: charge.provider_link_id }) : { status: 'unauthorized' as const };

  if (result.status === 'done') {
    await record(db, charge.id, 'charge.payment_link.inactivated', { linkId: charge.provider_link_id }, stamp);

    return;
  }

  if (result.status !== 'unsupported') {
    await record(db, charge.id, 'charge.payment_link.inactivate_failed', { linkId: charge.provider_link_id, reason: result.status }, stamp);
  }
}
```

- [ ] **Step 4: Verificar** — `vitest run src/charges/services/payment-link.test.ts` verde; `check-types`.

---

### Task 7: Webhook PagBank, `settle` PagBank e rota fake de pagamento

**Files:**
- Create: `packages/api/src/webhooks/endpoints/pagseguro.ts`, `pagseguro.test.ts`, `packages/api/src/webhooks/endpoints/fake-pay.ts`
- Modify: `packages/api/src/webhooks/routes.ts`, `packages/api/src/webhooks/provider.ts` (variables += `PAYMENT_CREDENTIAL_KEY_B64`), `packages/api/src/charges/services/settle.ts` (+ test), `packages/api/src/api.ts`

**Interfaces:**
- Produces:
  ```ts
  pagSeguroWebhookHandler   // POST /webhooks/pagseguro/{token}, no authorizer, body: string (raw), headers { 'x-authenticity-token'?: String.Max<128> }
  fakePayHandler            // POST /dev/checkout/{provider}/{orderNsu}/pay — 404 unless PAYMENT_METHOD_LINK === 'fake'; only provider 'pagseguro'
  signatureOf(credential: string, rawBody: string): string   // sha256 hex of `${credential}-${rawBody}` (exported from webhooks/utils/signature.ts)
  ```

- [ ] **Step 1: Teste do handler** (`pagseguro.test.ts`: mock de `db` como no `settle.test.ts` + `integrations.findOne`; `variables` com a chave de teste; assinatura calculada no teste com `createHash`):

```ts
it('answers 200 and touches nothing on a bad capability token', …)
it('answers 200 and records a rejection on a wrong signature', …)              // event charge.provider.rejected { reason: 'signature' }, no getOrder call
it('settles a PAID charge after re-reading the order', …)                       // clients.pagseguro.checkPayment called with { credential: 'tok', orderId: 'ORDE_1', transactionNsu: 'CHAR_1' }; outcome settled
it('ignores a notification whose reference is another charge', …)              // reference_id mismatch → 200, no writes
it('answers 400 when the order cannot be read', …)                              // checkPayment unavailable → HttpBadRequestError
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: `webhooks/utils/signature.ts`**

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

/** PagBank signs a notification as SHA-256 of `<seller token>-<raw body>`; a single reformatted space breaks it, so the body is taken as received. */
export function signatureOf(credential: string, rawBody: string): string {
  return createHash('sha256').update(`${credential}-${rawBody}`).digest('hex');
}

export function signatureMatches(expected: string, received: string | undefined): boolean {
  if (!received || received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}
```

- [ ] **Step 4: Handler**

```ts
declare class PagSeguroWebhookRequest implements Http.Request {
  parameters: { token: String.Max<300> };
  headers: { 'x-authenticity-token'?: String.Max<128> };
  body: string;
}

export async function pagSeguroWebhookHandler({ parameters, headers, body }: PagSeguroWebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  let chargeId: string;

  try {
    chargeId = verifyPublicChargeToken(parameters.token, { secret: variables.PUBLIC_LINK_HMAC_SECRET, purpose: PublicTokenPurpose.ProviderWebhook }).publicId;
  } catch {
    return RECEIVED;
  }

  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;

  if (!charge || payment?.provider !== PaymentProvider.PagSeguro) {
    return RECEIVED;
  }

  const config = paymentLinkConfigFrom(variables);
  const lookup = payment.integrationId ? await credentialOf(db, config.credentialKeyB64, payment.integrationId) : { status: 'missing' as const };
  const stamp = new Date().toISOString();

  if (lookup.status !== 'ok') {
    await EventRepository.record(db, { type: 'charge.provider.ignored', eventableType: EventableType.Charge, eventableId: chargeId, payload: { reason: 'no_credential' }, at: stamp });

    return RECEIVED;
  }

  if (!signatureMatches(signatureOf(lookup.secret, body), headers['x-authenticity-token'])) {
    await EventRepository.record(db, { type: 'charge.provider.rejected', eventableType: EventableType.Charge, eventableId: chargeId, payload: { reason: 'signature' }, at: stamp });

    return RECEIVED;
  }

  let notification: PagSeguroOrderNotification;

  try {
    notification = JSON.parse(body) as PagSeguroOrderNotification;
  } catch {
    return RECEIVED;
  }

  if (notification.reference_id !== chargeId || typeof notification.id !== 'string') {
    return RECEIVED;
  }

  const paid = notification.charges?.find((item) => item.status === 'PAID' && typeof item.id === 'string');

  if (!paid) {
    await EventRepository.record(db, { type: 'charge.provider.rejected', eventableType: EventableType.Charge, eventableId: chargeId, payload: { reason: 'not_paid', statuses: notification.charges?.map((item) => item.status) }, at: stamp });

    return RECEIVED;
  }

  const outcome = await settleByProvider(
    db,
    checkoutClients(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { provider: PaymentProvider.PagSeguro, chargeId, transactionNsu: paid.id!, orderId: notification.id, credential: lookup.secret }
  );

  console.info('PagBank webhook', { chargeId, outcome });

  if (outcome === 'unavailable') {
    throw new HttpBadRequestError('Order check unavailable');
  }

  return RECEIVED;
}
```

Rota: `Http.UseRoute<{ name: 'pagSeguroWebhook'; path: 'POST /webhooks/pagseguro/{token}'; handler: typeof pagSeguroWebhookHandler }>` (sem `preferences`: body cru). Se o EZ4 recusar `body: string` junto de `headers`, testar só `body: string`; se recusar de vez, escalar (BLOCKED) — a assinatura exige o corpo cru.

- [ ] **Step 5: `settle.ts`** — a união PagBank de `SettleInput` traz `credential: string` (nunca gravado/logado); textos de push por provider (`providerName`). Testes: `settleByProvider` PagBank feliz (`checkPayment` chamado com credential/orderId/transactionNsu; `charge.paid` payload sem `credential`), `unauthorized` → `rejected`.

- [ ] **Step 6: Rota fake** — `webhooks/endpoints/fake-pay.ts`:

```ts
declare class FakePayRequest implements Http.Request {
  parameters: { provider: String.Max<40>; orderNsu: String.UUID };
}

/** Local only: what the PagBank webhook would do, triggered by the web's fake checkout page. 404 anywhere `PAYMENT_METHOD_LINK` is not `fake`. */
export async function fakePayHandler({ parameters }: FakePayRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  if (variables.PAYMENT_METHOD_LINK !== PaymentLinkMode.Fake || parameters.provider !== PaymentProvider.PagSeguro) {
    throw new HttpNotFoundError();
  }

  const outcome = await settleByProvider(
    db,
    checkoutClients(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { provider: PaymentProvider.PagSeguro, chargeId: parameters.orderNsu, transactionNsu: `fake-${Date.now()}`, orderId: parameters.orderNsu, credential: 'fake' }
  );

  console.info('Fake PagBank payment', { chargeId: parameters.orderNsu, outcome });

  return RECEIVED;
}
```

Rota `{ name: 'fakeCheckoutPay'; path: 'POST /dev/checkout/{provider}/{orderNsu}/pay'; handler: typeof fakePayHandler }`. `WebhookProvider.variables` += `PAYMENT_CREDENTIAL_KEY_B64`.

- [ ] **Step 7: Verificar** — unit verde; `check-types`; `openapi:generate && openapi:check` (duas rotas novas).

---

### Task 8: Cancelar inativa; rodapé do e-mail; cancelamento por edição

**Files:**
- Modify: `packages/api/src/charges/endpoints/cancel.ts`, `packages/api/src/notifications/services/render.ts` (+ test), `packages/api/src/billings/services/billing.ts` (documentar limitação)

- [ ] **Step 1:** `cancel.ts`: depois de `charges.cancel`, `await inactivatePaymentLink(db, checkoutClients(variables), paymentLinkConfigFrom(variables), parameters.id);` (o `ChargeProvider` já tem `db`/`variables`; `PUBLIC_LINK_HMAC_SECRET` já declarado). Teste de handler não existe para `cancel`; cobrir na integração (Task 9).
- [ ] **Step 2:** `render.ts`: rodapé por provider — `PagSeguro` → "O pagamento acontece pelo link do PagBank de quem cobra."; teste em `render.test.ts`.
- [ ] **Step 3:** `billing.ts` (cancelamento em massa por edição de mês): só um comentário de duas linhas acima do `markCancelled` dizendo que a inativação no provider acontece apenas no cancelamento individual (limitação registrada em `docs/notifications.md`); nenhum evento novo.
- [ ] **Step 4: Verificar** — `check-types`; `vitest run src/notifications`.

---

### Task 9: Spec de integração PagBank, OAS, docs da API

**Files:**
- Create: `packages/api/test/financial/pagseguro.spec.ts`
- Modify: `docs/environments.md`, `docs/api-errors.md`, `docs/notifications.md`, `docs/api-oas.yml` (gerado)

- [ ] **Step 1: Spec** (padrão de `infinitepay.spec.ts`; `PAYMENT_METHOD_LINK=fake` via fixtures):

```ts
it('stores a sealed token, never the token, and links the method to the integration', …)   // db.integrations row: credentials.ciphertext startsWith 'v1.' and not containing the token; payment_methods.integration_id set; GET dto has no token
it('freezes the integration on the charge and creates the checkout with the stored credential', …)  // charge.payment_snapshot.integrationId, paymentLink ready, provider_link_id 'fake-<id>'
it('settles through the fake pay route path (settleByProvider with orderId) once and replays after', …)
it('inactivates the checkout when the owner cancels', …)                               // cancel endpoint path via charges.cancel + inactivatePaymentLink → event charge.payment_link.inactivated
it('keeps the credential when the method is edited without a token and revokes it on archive', …)
it('refuses a contact-scoped PagBank method and a create without token', …)            // 400s
```

- [ ] **Step 2: Docs** — `environments.md`: `PAYMENT_METHOD_LINK` com `sandbox`; `PAYMENT_CREDENTIAL_KEY_B64` (como gerar; trocar invalida credenciais). `api-errors.md`: `PAGSEGURO_TOKEN_INVALID` 422, `PAYMENT_CREDENTIAL_KEY_MISSING` 503; quota `pagseguro-verify`. `notifications.md`: push "Token do PagBank inválido", eventos `charge.payment_link.inactivated|inactivate_failed`, `charge.provider.rejected { reason: signature | not_paid | unauthorized }`, `charge.provider.ignored { reason: no_credential }`; limitação do cancelamento em massa. `openapi:generate && openapi:check`.
- [ ] **Step 3: Verificar** — `pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration` (só `account-concurrency` baseline); `pnpm --filter @receivy/api lint` (tsc limpo; biome baseline).

---

### Task 10: Web

**Files:**
- Modify: `packages/web/src/components/forms/payment-method-form-screen.tsx` (+ test), `components/ui/provider-icon.tsx`, `components/screens/payment-methods-screen.tsx` (+ test), `components/screens/billing-detail-screen.tsx`, `app/pay/[token]/page.tsx`, `lib/openapi-contract.test.ts`
- Rename: `app/dev/infinitepay/[orderNsu]/page.tsx` → `app/dev/checkout/[provider]/[orderNsu]/page.tsx`; Create `app/dev/checkout/[provider]/[orderNsu]/pay/route.ts`

- [ ] **Step 1: Testes** (form): chip "PagBank" → campo `type="password"` "Token do PagBank" + "Rótulo"; salvar envia `{ provider: 'pagseguro', token: 'tok', label: 'Loja' }`; 422 `PAGSEGURO_TOKEN_INVALID` → alerta "Token inválido ou sem permissão."; edição (prop `method` existente PagBank) mostra placeholder "•••••• (mantido)" e envia sem `token` quando vazio. (lista): linha PagBank sem botão "Copiar valor".
- [ ] **Step 2: Form** — terceiro chip; estado `token`; branch PagBank:

```tsx
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="pagseguro-token" className="text-xs font-semibold text-muted">Token do PagBank</label>
            <input id="pagseguro-token" type="password" value={token} required={!editing} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder={editing ? "•••••• (mantido)" : ""} onChange={event => { setError({ message: "" }); setToken(event.target.value); }} className="min-h-12 rounded-xl border border-outline/50 bg-surface px-3 text-sm text-ink" />
            <p className="m-0 text-xs leading-5 text-muted">Gere o token no app PagBank em Vendas → Integrações → Gerar Token. Ele fica cifrado no Receivy.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pagseguro-label" className="text-xs font-semibold text-muted">Rótulo</label>
            <input id="pagseguro-label" value={label} maxLength={120} placeholder="PagBank" onChange={event => setLabel(event.target.value)} className="min-h-12 rounded-xl border border-outline/50 bg-surface px-3 text-sm text-ink" />
          </div>
        </div>
```

  Corpo: `{ provider: PaymentProvider.PagSeguro, ...(token ? { token } : {}), ...(label ? { label } : {}) }`. 422 com `apiErrorCode === "PAGSEGURO_TOKEN_INVALID"` → alerta com a mensagem da API (sem link). O formulário hoje só cria; se não houver modo edição, `editing = false` e o placeholder não aparece (deixar o suporte pronto para quando a lista ganhar "editar").
- [ ] **Step 3: Ícone e lista** — `provider-icon.tsx`: `PagSeguro` → lucide `Landmark`. `payment-methods-screen.tsx`: `paymentMethodCopyValue(method)` vazio → não renderiza o `CopyButton`. `billing-detail-screen.tsx`: idem (sem botão copiar quando vazio).
- [ ] **Step 4: Página pública** — hint por provider (`payment.provider === PaymentProvider.PagSeguro ? "Pix ou cartão, pelo PagBank. A confirmação chega sozinha depois do pagamento." : "Pix ou cartão em até 12x, pela InfinitePay. …"`); `searchParams.returned === "1"` e `charge.state === Pending` e link PagBank → aviso `role="status"` "Pagamento em confirmação: se você pagou, isto atualiza em instantes." + `<meta httpEquiv="refresh" content="10" />` (Next: use `export const metadata` dinâmico? Não — renderizar `<meta>` dentro do JSX da página funciona no app router para `http-equiv`; se não, um pequeno client component com `setTimeout(() => router.refresh(), 10_000)`); "Ver comprovante" só quando `receiptUrl`.
- [ ] **Step 5: Fake** — página renomeada para `[provider]`: InfinitePay igual (volta com ids); PagBank: botão "Simular pagamento" → `href="/dev/checkout/pagseguro/<orderNsu>/pay?redirect=…"` (route handler GET: `notFound()` em produção; `authApiFetch('dev/checkout/pagseguro/<orderNsu>/pay', { method: 'POST' })`; `redirect(\`${redirect}${redirect.includes('?') ? '&' : '?'}returned=1\`)`). `openapi-contract.test.ts`: `DEDICATED_BFF` += `"POST dev/checkout/{p}/{p}/pay"` (server route) e `WEB_EXCLUSIONS["POST webhooks/pagseguro/{p}"]`, `NATIVE_DEFERRED` += `webhooks/pagseguro/{p}` e `dev/checkout/{p}/{p}/pay`.
- [ ] **Step 6: Verificar** — `pnpm --filter @receivy/web check-types && lint && test && build`.

---

### Task 11: Mobile

**Files:**
- Modify: `packages/mobile/src/components/forms/payment-method-form-screen.tsx` (+ test), `components/screens/payment-methods-screen.tsx` (+ test), `components/forms/billing-form-screen.tsx`, `components/screens/billing-detail-screen.tsx`
- Create: `packages/mobile/assets/images/auth/bank.svg`

- [ ] **Step 1: `bank.svg`** (24x24, stroke currentColor): `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2 3 7h18L12 2Z"/></svg>`
- [ ] **Step 2: Testes** (form): chip "PagBank" → `TextInput` `accessibilityLabel="Token do PagBank"` com `secureTextEntry`; salvar chama `savePaymentMethod({ provider: 'pagseguro', token: 'tok', label: 'Loja' })`; vazio → "Informe o token do PagBank."; `FinancialRequestError(…, 422)` → alerta com a mensagem. (lista): linha PagBank sem "Copiar valor".
- [ ] **Step 3: Form** — chip + estado `token`/`label`; branch PagBank com `TextInput secureTextEntry autoCapitalize="none" autoCorrect={false}` classes `h-full flex-1 py-0 text-[16px] text-ink`, botão colar (`Clipboard.getStringAsync`), hint; guard vazio; corpo `{ provider: PaymentProvider.PagSeguro, token, ...(label ? { label } : {}) }`; 422 mostra só a mensagem (o botão "Abrir configurações da InfinitePay" continua exclusivo do InfinitePay).
- [ ] **Step 4: Lista/ícones** — `iconOf` em `payment-methods-screen.tsx` e `billing-form-screen.tsx`: `PagSeguro` → `bankMark`; `CopyButton` escondido quando `paymentMethodCopyValue` vazio (lista e `billing-detail-screen.tsx`).
- [ ] **Step 5: Verificar** — `pnpm --filter @receivy/mobile check-types && lint && test`.

---

### Task 12: QA e verificação final

**Files:**
- Modify: `docs/manual-qa-script.md`

- [ ] **Step 1:** Seção "PagBank": (a) local `fake`: cadastrar PagBank com qualquer token, conta a receber, link "Pagar" → página fake → "Simular pagamento" → volta `?returned=1` → "Pagamento confirmado"; cancelar outra cobrança → evento `payment_link.inactivated`; (b) dev `sandbox` com token de sandbox: 401 → "Token inválido"; token válido → cobrança R$ 1,00 → pagar no checkout sandbox → webhook (`charge.paid { provider: 'pagseguro' }`); (c) arquivar o método → integração revogada → nova cobrança fica `failed { reason: 'no_credential' }`.
- [ ] **Step 2:** `pnpm --filter @receivy/common lint && test`; `pnpm --filter @receivy/api lint && test && test:integration`; `pnpm --filter @receivy/web check-types && lint && test && build`; `pnpm --filter @receivy/mobile check-types && lint && test`; `grep -rn "paymentLinkProvider\|createFakePaymentLinkProvider\|dev/infinitepay" packages docs --include=*.ts --include=*.tsx --include=*.md` → só planos históricos.

---

## Auto-revisão (feita ao escrever)

- **Spec**: §1 (T1, T2, T5), §2 modo/vendor/interface/ensure/webhook/cancel/save/fake (T3, T4, T6, T7, T8, T5, T7), §3 (T6 push, T7/T8 eventos, T8 rodapé), §4 (T10, T11), §5 (testes em cada task + T9), §6/§7 (T2 variável, T9 docs, T12 QA).
- **Nomes**: `checkoutClients`, `CheckoutClients`, `CheckoutClient`, `checkoutProviderOf`, `credentialOf`, `seal/open/assertCredentialKeyConfigured`, `IntegrationRepository.{get,byOwner,upsert,revoke}`, `PaymentMethodRepository.integrationOf`, `inactivatePaymentLink`, `signatureOf/signatureMatches`, `fakeCheckout/fakeLinkCount`, `SettleInput` união com `credential` no ramo PagBank — usados com a mesma forma em T4–T9.
- **Fora**: Connect, boleto, `customer`, rotação de chave, retry de `getOrder` fora do ar (scheduler), inativação em cancelamento por edição de mês.
