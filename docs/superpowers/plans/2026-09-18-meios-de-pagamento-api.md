# Meios de pagamento (API + common) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payment_methods` genérica (`provider / kind / value / label`), InfinitePay como primeiro provider com link de checkout por charge, webhook confirmado por `payment_check`, retorno do pagador e baixa automática.

**Architecture:** O common ganha `PaymentProvider`, `PaymentSnapshot` e a união `PaymentMethodInput`. Na API, o vendor `vendors/infinitepay` devolve resultados (nunca lança), o seletor `paymentLinkProvider(variables)` escolhe `infinitepay | fake | disabled` no mesmo padrão de `notificationTransport`, `ensurePaymentLink` cria o link após o commit (dentro de `announceCharges`, antes do aviso e na página pública) e `settleByProvider` é o único finalizador, usado pelo webhook e pelo retorno do pagador. Colunas novas são nullable; as antigas ficam `@deprecated` sem leitor nem escritor até o D3.

**Tech Stack:** EZ4 0.53 (gateway, database, factory), Postgres, vitest (unit em `src/**/*.test.ts`), `node:test` + DatabaseTester (integração em `test/**`), `@receivy/common` resolvido da fonte.

**Spec:** `docs/superpowers/specs/2026-09-18-meios-de-pagamento-infinitepay-design.md`

## Global Constraints

- Estilo (CLAUDE.md): todo `if/else/for/while` com chaves; linha em branco quando muda o tipo de statement; `return` cedo. Nunca rodar `biome --write`/formatter; `biome check` só para ler.
- Repositories só banco, `export namespace XRepository`, select inline; leitores puros em `utils/`; orquestração em `services/`; handlers desestruturam `{ db, variables, ... }`.
- Eventos gravados pelo service via `EventRepository.record` com o id da linha.
- `const enum` na API, `enum` no common (como já está em `contracts.ts`).
- Nunca comitar, nunca rodar migration, nunca deploy: cada task termina em verificação (`check-types` + testes), e o dono comita.
- Não adicionar dependência.
- Web e mobile **vão quebrar no `check-types`** a partir da Task 1 até o plano de UI (`2026-09-18-meios-de-pagamento-ui.md`) ser executado. Verificação deste plano = `@receivy/common` e `@receivy/api` apenas.
- Desvios da spec, decididos aqui por consistência com o código existente (comportamento igual):
  - O vendor devolve uniões de resultado (`status: 'created' | 'checkout_disabled' | 'unavailable'`) em vez de lançar, como `vendors/expo` e `vendors/resend`.
  - Não há `Factory.Service` para o link: `paymentLinkProvider(variables)` é uma função pura escolhida pelas variáveis, como `notificationTransport`, porque `NoticeContext` é montado a partir de variáveis em seis lugares.
  - `settleByProvider` é função de módulo em `charges/services/settle.ts`, não método de `ChargeService` (que só tem `db`).
  - `PixSnapshot { keyType, key, label }` **fica** como o tipo da chave digitada (contato, conta a pagar, `BillingDetail.pix`); `PaymentSnapshot` é o novo tipo da charge e da página pública.
  - `InfinitePayCheckoutDisabledError` leva o `redirectUrl` em `context.fields.redirectUrl` (o envelope de erro só tem `code` e `fields`).
  - Erro 503 novo: `ServiceUnavailableError` base em `common/errors.ts` + `httpErrors[503]` em `api.ts`.
- Variáveis novas: `PAYMENT_LINK_TRANSPORT` (`infinitepay | fake | disabled`, padrão em código `disabled`; `fake` em `local.env.example` e `test.env.example`) e `PUBLIC_API_ORIGIN` (padrão `http://127.0.0.1:3735/local-receivy-api`).
- Sequência de deploy (spec §6): a Task 2 sozinha é o **D1** (colunas novas, nada removido). O backfill roda depois do D1 e **imediatamente antes** do D2 (é idempotente). Tasks 3+ são o **D2**. O **D3** (dropar `type`, `pix_key_type`, `pix_key`) fica fora deste plano.

---

## Mapa de arquivos

**common (`packages/common/src`)**
- Modify `domain/contracts.ts` — `PaymentProvider`, `PaymentLinkState`, `PaymentMethod`, `PaymentMethodInput` (união), `PaymentSnapshot`, `PaymentLink`, `ChargeDetail.payment/paymentLink/receiptUrl`, `PublicChargeView.payment/paymentLink/receiptUrl`.
- Create `domain/handle.ts`, `domain/handle.test.ts` — `normalizeHandle`.
- Modify `domain/charge-text.ts` — `charge.pix` → `charge.payment`.
- Modify `index.ts` — exporta `./domain/handle`.

**api (`packages/api`)**
- Modify `src/payment-methods/schemas/payment-method.ts`, `src/charges/schemas/charge.ts`, `src/database.ts` — colunas e índices.
- Create `scripts/sql/2026-09-18-payment-methods-generic.sql` — backfill.
- Create `src/vendors/infinitepay/types.ts`, `client.ts`, `client.test.ts`, `fake.ts`.
- Modify `src/common/errors.ts` (503), `src/api.ts` (rotas + erros).
- Modify `src/payment-methods/{errors,provider}.ts`, `utils/{input,dto}.ts`, `repositories/payment-method.ts`, `services/payment-method.ts`; Create `utils/input.test.ts`.
- Modify `src/charges/utils/columns.ts`, `repositories/charge.ts`, `services/materialize.ts` (+ `.test.ts`), `src/billings/services/billing.ts`, `src/billings/services/detail.ts`, `src/public/services/public-link.ts`, `src/public/errors.ts`.
- Create `src/charges/services/payment-link.ts`, `payment-link.test.ts`, `settle.ts`, `settle.test.ts`, `endpoints/payment-link.ts`; Modify `src/charges/{routes,provider}.ts`.
- Modify `src/public/services/capability.ts` (purpose `ProviderWebhook`).
- Modify `src/notifications/services/{planner,context,send,render}.ts`, `schedulers/charge-notify.ts`, `services/notification.ts`, `src/billings/crons/materialize.ts`, `src/invites/services/invite.ts`.
- Create `src/webhooks/routes.ts`, `provider.ts`, `endpoints/infinitepay.ts`.
- Create `src/public/endpoints/provider-return.ts`; Modify `src/public/{routes,provider}.ts`.
- Modify `ez4.project.js`, `local.env.example`, `dev.env.example`, `test.env.example`, `scripts/seed-local.mjs`, `scripts/financial-http-smoke.mjs`.
- Modify `test/fixtures/{financial,scheduling}.ts` e specs que usam `pixKeyType`/`.pix`; Create `test/financial/infinitepay.spec.ts`.
- Docs: `docs/environments.md`, `docs/api-errors.md`, `docs/notifications.md`, `docs/deploy-guide.md`; `docs/api-oas.yml` via `pnpm --filter @receivy/api openapi:generate`.

---

### Task 1: Contratos no common e `normalizeHandle`

**Files:**
- Modify: `packages/common/src/domain/contracts.ts:139-207`
- Create: `packages/common/src/domain/handle.ts`, `packages/common/src/domain/handle.test.ts`
- Modify: `packages/common/src/domain/charge-text.ts:211,229`
- Modify: `packages/common/src/index.ts`

**Interfaces:**
- Produces: `PaymentProvider`, `PaymentLinkState`, `PaymentMethod`, `PixMethodInput`, `InfinitePayMethodInput`, `PaymentMethodInput`, `PaymentSnapshot`, `PaymentLink`, `normalizeHandle(value: string): string`. `ChargeDetail.payment: PaymentSnapshot | null`, `ChargeDetail.paymentLink: PaymentLink | null`, `ChargeDetail.receiptUrl: string | null`; os mesmos três em `PublicChargeView`. `ChargeDetail.pix` e `PublicChargeView.pix` deixam de existir. `PixSnapshot` continua.

- [ ] **Step 1: Teste do handle**

`packages/common/src/domain/handle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeHandle } from './handle';

describe('normalizeHandle', () => {
  it('strips the dollar sign, spaces and case', () => {
    expect(normalizeHandle(' $Minha.Loja_1 ')).toBe('minha.loja_1');
    expect(normalizeHandle('$$loja')).toBe('loja');
  });

  it('refuses what an InfiniteTag cannot be', () => {
    for (const value of ['', '$', 'a', 'com espaço', '-começa', 'x'.repeat(41), 'ação']) {
      expect(() => normalizeHandle(value)).toThrow('Handle inválido.');
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/common exec vitest run src/domain/handle.test.ts --pool=forks`
Expected: FAIL, `Cannot find module './handle'`.

- [ ] **Step 3: Implementar `handle.ts`**

```ts
/** An InfiniteTag as InfinitePay accepts it: no `$`, lowercase, letters/digits/`._-`, 2 to 40 characters. Confirmed against a real handle on first use; loosen here if InfinitePay accepts more. */
const HANDLE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

export function normalizeHandle(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/^\$+/, '').toLowerCase();

  if (!HANDLE.test(normalized)) {
    throw new RangeError('Handle inválido.');
  }

  return normalized;
}
```

Em `packages/common/src/index.ts`, depois de `export * from './domain/feed-month';` adicionar `export * from './domain/handle';` (ordem alfabética: entre `feed-month` e `money`).

- [ ] **Step 4: Contratos**

Em `contracts.ts`, substituir o bloco de `PaymentMethod`/`PaymentMethodInput` (linhas 147-166) por:

```ts
export enum PaymentProvider {
  Pix = 'pix',
  InfinitePay = 'infinitepay'
}

/** Where the checkout link of an InfinitePay charge stands; null on a charge paid through a Pix key. */
export enum PaymentLinkState {
  Pending = 'pending',
  Ready = 'ready',
  Failed = 'failed'
}

export type PaymentMethod = {
  id: string;
  provider: PaymentProvider;
  /** The Pix key type; null on any other provider. */
  kind: PixKeyType | null;
  /** The canonical Pix key, or the InfiniteTag without `$`. */
  value: string;
  label: string;
  isDefault: boolean;
  /** Block 9: the contact this key pays; null is one of the owner's own methods. Only Pix is ever filed under a contact. */
  contactId: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type PixMethodInput = {
  provider: PaymentProvider.Pix;
  kind: PixKeyType;
  value: string;
  label?: string;
  /** Block 9: file the key under this contact of the owner; absent means the owner's own key. */
  contactId?: string;
};

export type InfinitePayMethodInput = {
  provider: PaymentProvider.InfinitePay;
  /** The InfiniteTag, with or without `$`. */
  value: string;
  label?: string;
};

export type PaymentMethodInput = PixMethodInput | InfinitePayMethodInput;
```

Depois de `PixSnapshot` (linha 178-182, que fica) adicionar:

```ts
/** How a charge is paid, frozen when it was published: the same four names the `payment_methods` row carries. */
export type PaymentSnapshot = {
  provider: PaymentProvider;
  kind: PixKeyType | null;
  value: string;
  label: string;
};

/** The checkout link of an InfinitePay charge; `url` is null until the provider answered. */
export type PaymentLink = {
  url: string | null;
  state: PaymentLinkState;
};
```

Em `ChargeDetail`, trocar `pix: PixSnapshot | null;` por:

```ts
  payment: PaymentSnapshot | null;
  /** Only an InfinitePay charge has one; null otherwise. */
  paymentLink: PaymentLink | null;
  /** The provider's receipt once it confirmed the payment. */
  receiptUrl: string | null;
```

Em `PublicChargeView`, trocar `pix: PixSnapshot | null;` pelos mesmos três campos.

- [ ] **Step 5: `charge-text.ts`**

Nas linhas 211 e 229 (`canRemind`, `canShare`): `!!charge.pix` → `!!charge.payment`.

- [ ] **Step 6: Verificar o common**

Run: `pnpm --filter @receivy/common check-types && pnpm --filter @receivy/common test`
Expected: types OK; testes verdes (o `charge-text` já tem testes que passam `pix:` em fixtures de `ChargeDetail`? Se falharem por tipo, trocar `pix: null` por `payment: null, paymentLink: null, receiptUrl: null` nas fixtures de `charge-text.test.ts` / `charge.test.ts` / `feed.test.ts` / `contacts.test.ts` — só a forma do objeto, sem mudar o que o teste afirma).

---

### Task 2: Schema D1 + backfill SQL

**Files:**
- Modify: `packages/api/src/payment-methods/schemas/payment-method.ts`
- Modify: `packages/api/src/charges/schemas/charge.ts`
- Modify: `packages/api/src/database.ts:43-52,82-101`
- Create: `packages/api/scripts/sql/2026-09-18-payment-methods-generic.sql`

**Interfaces:**
- Produces: `PaymentMethodSchema.provider?/kind?/value?`; `ChargeSchema.payment_link_url?/payment_link_state?/provider_transaction_id?/provider_receipt_url?`. Nada é removido; o snapshot **ainda** é `{ method, type, value, label }` (muda na Task 5). Este estado é o D1 deployável.

- [ ] **Step 1: `payment-method.ts`**

```ts
import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { PaymentProvider, PixKeyType } from '@receivy/common';

export interface PaymentMethodSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  /** Block 9: a key the owner keeps about a contact ("how I pay this person"); null is the owner's own method. */
  contact_id?: String.UUID;
  /** @deprecated D3 drops it: `provider` says the same. Nullable while the backfill runs. */
  type?: 'pix';
  /** @deprecated D3 drops it: read `kind`. */
  pix_key_type?: PixKeyType;
  /** @deprecated D3 drops it: read `value`. */
  pix_key?: String.Max<254>;
  /** Nullable until the backfill fills it; every reader treats a missing provider as an unbackfilled row. */
  provider?: PaymentProvider;
  /** The Pix key type; absent on any other provider. */
  kind?: PixKeyType;
  /** The canonical Pix key, or the InfiniteTag without `$`. */
  value?: String.Max<254>;
  label: String.Max<120>;
  is_default: boolean;
  archived_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
```

- [ ] **Step 2: `charge.ts` (só colunas novas)**

Antes de `state: ChargeState;` em `ChargeSchema`:

```ts
  /** InfinitePay checkout link of this charge; null on a charge paid through a Pix key. */
  payment_link_url?: String.Max<500>;
  payment_link_state?: PaymentLinkState;
  /** `transaction_nsu` of the payment the provider confirmed: the idempotency key of the settlement. */
  provider_transaction_id?: String.Max<120>;
  provider_receipt_url?: String.Max<500>;
```

Import: `import type { ChargeState, PaymentLinkState, PixKeyType, ProofMime } from '@receivy/common';`.

- [ ] **Step 3: `database.ts`**

Em `payment_methods` manter o unique antigo e adicionar nada ainda (o unique novo entra na Task 4, depois do backfill). Em `charges.indexes` adicionar `provider_transaction_id: Index.Unique;` (nullable: vários NULL convivem).

- [ ] **Step 4: Backfill**

`packages/api/scripts/sql/2026-09-18-payment-methods-generic.sql`:

```sql
-- Meios de pagamento genéricos: pix_key_type/pix_key -> provider/kind/value, e o snapshot da charge
-- { method, type, value, label } -> { provider, kind, value, label }.
--
-- Run once, by hand, after D1 is deployed and immediately before D2 (D2 writes only the new columns and
-- the new snapshot shape). Every statement is guarded, so re-running is safe; run it again right before
-- D2 if charges were created in between.

BEGIN;

UPDATE payment_methods
   SET provider = 'pix', kind = pix_key_type, value = pix_key
 WHERE provider IS NULL AND pix_key IS NOT NULL;

UPDATE charges
   SET payment_snapshot = jsonb_build_object(
         'provider', 'pix',
         'kind', payment_snapshot->'type',
         'value', payment_snapshot->'value',
         'label', payment_snapshot->'label')
 WHERE payment_snapshot ? 'method';

-- Sanity: both must be zero before D2.
SELECT count(*) AS methods_without_provider FROM payment_methods WHERE provider IS NULL;
SELECT count(*) AS charges_with_old_snapshot FROM charges WHERE payment_snapshot ? 'method';

COMMIT;
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter @receivy/api check-types`
Expected: OK (nada lê as colunas novas ainda).

---

### Task 3: Vendor InfinitePay (cliente real + fake)

**Files:**
- Create: `packages/api/src/vendors/infinitepay/types.ts`, `client.ts`, `client.test.ts`, `fake.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PaymentLinkProvider {
    createLink(input: PaymentLinkInput): Promise<PaymentLinkResult>;
    checkPayment(input: PaymentCheckInput): Promise<PaymentCheckResult>;
  }
  type PaymentLinkInput = { handle: string; orderNsu: string; items: { quantity: number; price: number; description: string }[]; webhookUrl?: string; redirectUrl?: string };
  type PaymentCheckInput = { handle: string; orderNsu: string; transactionNsu: string; slug: string };
  type PaymentLinkResult = { status: 'created'; url: string } | { status: 'checkout_disabled'; redirectUrl: string } | { status: 'unavailable' };
  type PaymentCheckResult = { status: 'checked'; paid: boolean; amountCents: number; paidAmountCents: number; captureMethod: string } | { status: 'unavailable' };
  createInfinitePayClient(request?: typeof fetch): PaymentLinkProvider
  createFakePaymentLinkProvider(webOrigin: string): PaymentLinkProvider
  ```

- [ ] **Step 1: `types.ts`**

```ts
export type PaymentLinkItem = { quantity: number; price: number; description: string };

export type PaymentLinkInput = {
  handle: string;
  orderNsu: string;
  items: PaymentLinkItem[];
  webhookUrl?: string;
  redirectUrl?: string;
};

export type PaymentCheckInput = { handle: string; orderNsu: string; transactionNsu: string; slug: string };

export type PaymentLinkResult = { status: 'created'; url: string } | { status: 'checkout_disabled'; redirectUrl: string } | { status: 'unavailable' };

export type PaymentCheckResult =
  | { status: 'checked'; paid: boolean; amountCents: number; paidAmountCents: number; captureMethod: string }
  | { status: 'unavailable' };

/** What the API needs from a checkout provider; InfinitePay is the only one, the fake stands in for it locally. */
export interface PaymentLinkProvider {
  createLink(input: PaymentLinkInput): Promise<PaymentLinkResult>;
  checkPayment(input: PaymentCheckInput): Promise<PaymentCheckResult>;
}

/** The body InfinitePay posts to `webhook_url`; snake_case as it arrives (route preference `Preserve`). */
export type InfinitePayWebhookBody = {
  invoice_slug?: string;
  amount?: number;
  paid_amount?: number;
  installments?: number;
  capture_method?: string;
  transaction_nsu?: string;
  order_nsu?: string;
  receipt_url?: string;
};
```

- [ ] **Step 2: Teste do cliente**

`client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createInfinitePayClient } from './client';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const link = { handle: 'loja', orderNsu: 'charge-1', items: [{ quantity: 1, price: 1000, description: 'Aluguel' }], webhookUrl: 'https://api/wh', redirectUrl: 'https://web/pay' };

describe('InfinitePay client', () => {
  it('creates a link and reads its url', async () => {
    const request = respond(200, { url: 'https://checkout.infinitepay.io/loja/abc' });
    const result = await createInfinitePayClient(request as unknown as typeof fetch).createLink(link);

    expect(result).toEqual({ status: 'created', url: 'https://checkout.infinitepay.io/loja/abc' });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.checkout.infinitepay.io/links');
    expect(JSON.parse(init.body as string)).toEqual({
      handle: 'loja',
      order_nsu: 'charge-1',
      items: [{ quantity: 1, price: 1000, description: 'Aluguel' }],
      webhook_url: 'https://api/wh',
      redirect_url: 'https://web/pay'
    });
  });

  it('turns an unknown or disabled handle into checkout_disabled with the redirect', async () => {
    const request = respond(404, { success: false, error: 'external_checkout_not_enabled', redirect_url: 'https://app.infinitepay.io/x' });

    expect(await createInfinitePayClient(request as unknown as typeof fetch).createLink(link)).toEqual({ status: 'checkout_disabled', redirectUrl: 'https://app.infinitepay.io/x' });
  });

  it('answers unavailable on any other failure, without leaking the body', async () => {
    expect(await createInfinitePayClient(respond(500, { secret: 'x' }) as unknown as typeof fetch).createLink(link)).toEqual({ status: 'unavailable' });
    expect(await createInfinitePayClient(respond(200, { nope: true }) as unknown as typeof fetch).createLink(link)).toEqual({ status: 'unavailable' });
    expect(await createInfinitePayClient(vi.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch).createLink(link)).toEqual({ status: 'unavailable' });
  });

  it('checks a payment', async () => {
    const request = respond(200, { success: true, paid: true, amount: 1000, paid_amount: 1010, installments: 1, capture_method: 'pix' });
    const result = await createInfinitePayClient(request as unknown as typeof fetch).checkPayment({ handle: 'loja', orderNsu: 'charge-1', transactionNsu: 'tx', slug: 'slug' });

    expect(result).toEqual({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1010, captureMethod: 'pix' });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.checkout.infinitepay.io/payment_check');
    expect(JSON.parse(init.body as string)).toEqual({ handle: 'loja', order_nsu: 'charge-1', transaction_nsu: 'tx', slug: 'slug' });
  });

  it('reads an unpaid check and an unavailable one', async () => {
    const unpaid = respond(200, { success: true, paid: false, amount: 1000, paid_amount: 0, installments: 0, capture_method: '' });

    expect(await createInfinitePayClient(unpaid as unknown as typeof fetch).checkPayment({ handle: 'loja', orderNsu: 'c', transactionNsu: 't', slug: 's' })).toMatchObject({ status: 'checked', paid: false });
    expect(await createInfinitePayClient(respond(502, {}) as unknown as typeof fetch).checkPayment({ handle: 'loja', orderNsu: 'c', transactionNsu: 't', slug: 's' })).toEqual({ status: 'unavailable' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api exec vitest run src/vendors/infinitepay/client.test.ts --pool=forks`
Expected: FAIL, módulo `./client` não existe.

- [ ] **Step 4: `client.ts`**

```ts
import type { PaymentCheckInput, PaymentCheckResult, PaymentLinkInput, PaymentLinkProvider, PaymentLinkResult } from './types';

const LINKS_URL = 'https://api.checkout.infinitepay.io/links';
const CHECK_URL = 'https://api.checkout.infinitepay.io/payment_check';

const REQUEST_TIMEOUT_MS = 8_000;

const CHECKOUT_DISABLED = 'external_checkout_not_enabled';

/** InfinitePay bodies and errors never escape this boundary or enter logs. No API key: the handle is the identity. */
export function createInfinitePayClient(request: typeof fetch = globalThis.fetch): PaymentLinkProvider {
  async function post(url: string, body: unknown): Promise<Response> {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  }

  return {
    async createLink(input: PaymentLinkInput): Promise<PaymentLinkResult> {
      try {
        const response = await post(LINKS_URL, {
          handle: input.handle,
          order_nsu: input.orderNsu,
          items: input.items,
          ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
          ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {})
        });
        const body = (await response.json().catch(() => ({}))) as { url?: unknown; error?: unknown; redirect_url?: unknown };

        if (response.status === 404 && body.error === CHECKOUT_DISABLED) {
          return { status: 'checkout_disabled', redirectUrl: typeof body.redirect_url === 'string' ? body.redirect_url : '' };
        }

        if (!response.ok || typeof body.url !== 'string') {
          return { status: 'unavailable' };
        }

        return { status: 'created', url: body.url };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async checkPayment(input: PaymentCheckInput): Promise<PaymentCheckResult> {
      try {
        const response = await post(CHECK_URL, {
          handle: input.handle,
          order_nsu: input.orderNsu,
          transaction_nsu: input.transactionNsu,
          slug: input.slug
        });

        if (!response.ok) {
          return { status: 'unavailable' };
        }

        const body = (await response.json().catch(() => ({}))) as { success?: unknown; paid?: unknown; amount?: unknown; paid_amount?: unknown; capture_method?: unknown };

        if (body.success !== true || typeof body.paid !== 'boolean') {
          return { status: 'unavailable' };
        }

        return {
          status: 'checked',
          paid: body.paid,
          amountCents: typeof body.amount === 'number' ? body.amount : 0,
          paidAmountCents: typeof body.paid_amount === 'number' ? body.paid_amount : 0,
          captureMethod: typeof body.capture_method === 'string' ? body.capture_method : ''
        };
      } catch {
        return { status: 'unavailable' };
      }
    }
  };
}
```

- [ ] **Step 5: `fake.ts`**

```ts
import type { PaymentLinkProvider } from './types';

/** Links this process created, by order_nsu: the fake `payment_check` confirms exactly what was linked. */
const links = new Map<string, { amountCents: number }>();

/**
 * Stands in for InfinitePay on local and test: every handle works, the link points at the web's `/dev/infinitepay`
 * page (which carries the redirect back so a person can "pay" by hand), and a check pays exactly the amount that
 * was linked. A transaction nsu starting with `unpaid` is refused; an order never linked in this process is
 * unknown (`paid: false`).
 */
export function createFakePaymentLinkProvider(webOrigin: string): PaymentLinkProvider {
  return {
    async createLink(input) {
      links.set(input.orderNsu, { amountCents: input.items.reduce((total, item) => total + item.quantity * item.price, 0) });

      const redirect = input.redirectUrl ? `?redirect=${encodeURIComponent(input.redirectUrl)}` : '';

      return { status: 'created', url: `${webOrigin.replace(/\/+$/, '')}/dev/infinitepay/${input.orderNsu}${redirect}` };
    },

    async checkPayment(input) {
      const linked = links.get(input.orderNsu);
      const paid = !!linked && !input.transactionNsu.startsWith('unpaid');

      return { status: 'checked', paid, amountCents: linked?.amountCents ?? 0, paidAmountCents: linked?.amountCents ?? 0, captureMethod: 'pix' };
    }
  };
}
```

- [ ] **Step 6: Rodar os testes do cliente**

Run: `pnpm --filter @receivy/api exec vitest run src/vendors/infinitepay --pool=forks`
Expected: PASS (5 testes).

- [ ] **Step 7: Verificar**

Run: `pnpm --filter @receivy/api check-types`
Expected: OK.

---

### Task 4: `payment_methods` genérica (repository, utils, service com sondagem)

**Files:**
- Modify: `packages/api/src/payment-methods/errors.ts`, `utils/input.ts`, `utils/dto.ts`, `repositories/payment-method.ts`, `services/payment-method.ts`, `provider.ts`
- Create: `packages/api/src/payment-methods/utils/input.test.ts`
- Modify: `packages/api/src/common/errors.ts`, `packages/api/src/api.ts`, `packages/api/src/database.ts` (unique novo)
- Modify: `packages/api/src/contacts/services/contact.ts:174-176` (só se o tipo reclamar; ver Step 6)

**Interfaces:**
- Consumes: Task 1 (`PaymentProvider`, `PaymentMethodInput`, `normalizeHandle`), Task 3 (`createInfinitePayClient`, `createFakePaymentLinkProvider`).
- Produces:
  ```ts
  // utils/input.ts
  declare class PaymentMethodBody implements Http.JsonBody { provider: PaymentProvider; kind?: PixKeyType; value: String.Max<254>; label?: String.Max<120>; contactId?: String.UUID }
  paymentMethodInput(body): PaymentMethodInput
  normalizePaymentMethod(input: PaymentMethodInput): { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string }
  // repositories
  PaymentMethodRepository.pointer(db, ownerId, id, ownScopeOnly, lock?): Promise<{ provider; kind: PixKeyType | null; value; label; archivedAt: string | null } | null>
  PaymentMethodRepository.defaultOf(db, ownerId, contactId?): Promise<{ provider; kind; value; label } | null>
  PaymentMethodRepository.byValue(db, ownerId, provider, value): Promise<PaymentMethod | null>   // substitui byKey
  PaymentMethodRepository.insert(db, { ownerId, contactId?, provider, kind: PixKeyType | null, value, label, isDefault, now })
  PaymentMethodRepository.update(db, ownerId, id, { provider, kind, value, label, now })
  // services
  PaymentMethodService.services = { db, variables }; variables = { PAYMENT_LINK_TRANSPORT, PUBLIC_WEB_ORIGIN }
  upsertContactKey(tx, ownerId, contactId, pix: PixSnapshot): Promise<string>   // assinatura igual
  // errors
  PaymentMethodTakenError (409 PAYMENT_METHOD_TAKEN), InfinitePayCheckoutDisabledError (422 INFINITEPAY_CHECKOUT_DISABLED, fields.redirectUrl), PaymentLinkUnavailableError (503 PAYMENT_LINK_UNAVAILABLE), ServiceUnavailableError base
  // charges/services/payment-link.ts (parcial, o resto na Task 6)
  paymentLinkProvider(env: { PAYMENT_LINK_TRANSPORT?: string; PUBLIC_WEB_ORIGIN?: string }, request?: typeof fetch): PaymentLinkProvider
  ```

- [ ] **Step 1: Erros**

`common/errors.ts`, depois de `RateLimitedError`:

```ts
export abstract class ServiceUnavailableError extends ApiError {
  readonly status = 503;
}
```

`payment-methods/errors.ts` inteiro:

```ts
import { ConflictError, ServiceUnavailableError, UnprocessableEntityError } from '../common/errors';

export class PaymentMethodTakenError extends ConflictError {
  constructor(message = 'Esse meio de pagamento já está cadastrado.') {
    super(message, 'PAYMENT_METHOD_TAKEN');
  }
}

/** InfinitePay refused the handle: it does not exist, or its external checkout is off. `fields.redirectUrl` opens the switch. */
export class InfinitePayCheckoutDisabledError extends UnprocessableEntityError {
  constructor(redirectUrl: string, message = 'Ative o checkout externo no app da InfinitePay e tente de novo.') {
    super(message, 'INFINITEPAY_CHECKOUT_DISABLED', { redirectUrl });
  }
}

export class PaymentLinkUnavailableError extends ServiceUnavailableError {
  constructor(message = 'Não deu para falar com a InfinitePay agora. Tente de novo em instantes.') {
    super(message, 'PAYMENT_LINK_UNAVAILABLE');
  }
}
```

Em `api.ts`: trocar o import `PixKeyTakenError` por `InfinitePayCheckoutDisabledError, PaymentLinkUnavailableError, PaymentMethodTakenError`; na lista 409 trocar `PixKeyTakenError` por `PaymentMethodTakenError`; na 422 adicionar `InfinitePayCheckoutDisabledError`; adicionar `503: [PaymentLinkUnavailableError];` depois do 429.

- [ ] **Step 2: Seletor do provider (`charges/services/payment-link.ts`, primeira metade)**

Criar `packages/api/src/charges/services/payment-link.ts` com só isto por enquanto (a Task 6 completa o arquivo):

```ts
import { createFakePaymentLinkProvider } from '../../vendors/infinitepay/fake';
import { createInfinitePayClient } from '../../vendors/infinitepay/client';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';

export const enum PaymentLinkTransport {
  InfinitePay = 'infinitepay',
  Fake = 'fake',
  Disabled = 'disabled'
}

/** Nothing configured: every link fails as unavailable and every check is unavailable. */
const disabledProvider: PaymentLinkProvider = {
  createLink: async () => ({ status: 'unavailable' }),
  checkPayment: async () => ({ status: 'unavailable' })
};

/** The transport name selects the provider, like `notificationTransport` does for push. */
export function paymentLinkProvider(env: { PAYMENT_LINK_TRANSPORT?: string; PUBLIC_WEB_ORIGIN?: string }, request: typeof fetch = globalThis.fetch): PaymentLinkProvider {
  if (env.PAYMENT_LINK_TRANSPORT === PaymentLinkTransport.InfinitePay) {
    return createInfinitePayClient(request);
  }

  if (env.PAYMENT_LINK_TRANSPORT === PaymentLinkTransport.Fake) {
    return createFakePaymentLinkProvider(env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000');
  }

  return disabledProvider;
}
```

- [ ] **Step 3: Teste de `normalizePaymentMethod`**

`utils/input.test.ts`:

```ts
import { PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { normalizePaymentMethod } from './input';

describe('normalizePaymentMethod', () => {
  it('normalizes a Pix key by its kind and defaults the label', () => {
    expect(normalizePaymentMethod({ provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: ' Ana@Example.com ' })).toEqual({
      provider: PaymentProvider.Pix,
      kind: PixKeyType.Email,
      value: 'ana@example.com',
      label: 'Pix'
    });
  });

  it('normalizes an InfiniteTag and defaults its label', () => {
    expect(normalizePaymentMethod({ provider: PaymentProvider.InfinitePay, value: '$Minha.Loja' })).toEqual({
      provider: PaymentProvider.InfinitePay,
      kind: null,
      value: 'minha.loja',
      label: 'InfinitePay'
    });
  });

  it('refuses a Pix input without a kind and an oversized label', () => {
    expect(() => normalizePaymentMethod({ provider: PaymentProvider.Pix, value: 'x' } as never)).toThrow('Chave Pix inválida.');
    expect(() => normalizePaymentMethod({ provider: PaymentProvider.InfinitePay, value: 'loja', label: 'x'.repeat(121) })).toThrow('Rótulo inválido.');
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api exec vitest run src/payment-methods/utils/input.test.ts --pool=forks`
Expected: FAIL (forma antiga).

- [ ] **Step 5: `utils/input.ts` e `utils/dto.ts`**

`input.ts`:

```ts
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { normalizeHandle, normalizePixKey, type PaymentMethodInput, PaymentProvider, type PixKeyType } from '@receivy/common';

export declare class PaymentMethodBody implements Http.JsonBody {
  provider: PaymentProvider;
  /** Required when `provider` is `pix`; ignored otherwise. */
  kind?: PixKeyType;
  value: String.Max<254>;
  label?: String.Max<120>;
  contactId?: String.UUID;
}

export function paymentMethodInput(body: PaymentMethodBody): PaymentMethodInput {
  if (body.provider === PaymentProvider.InfinitePay) {
    return { provider: PaymentProvider.InfinitePay, value: body.value, label: body.label };
  }

  // A missing kind is caught by `normalizePixKey`, which refuses an unknown type.
  return { provider: PaymentProvider.Pix, kind: body.kind as PixKeyType, value: body.value, label: body.label, contactId: body.contactId };
}

export async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HttpBadRequestError(error.message);
    }

    throw error;
  }
}

export type NormalizedPaymentMethod = { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string };

/** The method as it is stored: the value canonical for its provider, a label of up to 120 characters (the provider's name when blank). */
export function normalizePaymentMethod(input: PaymentMethodInput): NormalizedPaymentMethod {
  const infinitePay = input.provider === PaymentProvider.InfinitePay;
  const value = infinitePay ? normalizeHandle(input.value) : normalizePixKey(input.kind, input.value);
  const label = input.label?.normalize('NFC').trim() || (infinitePay ? 'InfinitePay' : 'Pix');

  if (label.length > 120) {
    throw new RangeError('Rótulo inválido.');
  }

  return { provider: input.provider, kind: infinitePay ? null : input.kind, value, label };
}
```

`dto.ts`:

```ts
import type { PaymentMethod, PaymentProvider, PixKeyType } from '@receivy/common';

export type PaymentMethodRow = {
  id: string;
  contact_id?: string | null;
  provider?: PaymentProvider;
  kind?: PixKeyType | null;
  value?: string;
  label: string;
  is_default: boolean;
  archived_at?: string | null;
  created_at: string;
};

/** A row the backfill has not reached yet has no provider: it must never reach a client half-read. */
export function paymentMethodOf(row: PaymentMethodRow): PaymentMethod {
  if (!row.provider || row.value === undefined) {
    throw new Error(`Payment method ${row.id} was not backfilled`);
  }

  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind ?? null,
    value: row.value,
    label: row.label,
    isDefault: row.is_default,
    contactId: row.contact_id ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 6: Repository**

Reescrever `repositories/payment-method.ts` trocando cada `pix_key_type: true, pix_key: true` por `provider: true, kind: true, value: true` em todos os `select`, e:

```ts
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import type { PaymentMethod, PaymentProvider, PixKeyType } from '@receivy/common';
import type { DbClient } from '../../database';
import { paymentMethodOf } from '../utils/dto';

const sqlNull = null as unknown as undefined;

/** The four columns a charge freezes from a method. */
export type MethodSnapshot = { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string };

function snapshotOf(row: { provider?: PaymentProvider; kind?: PixKeyType | null; value?: string; label: string }): MethodSnapshot | null {
  if (!row.provider || row.value === undefined) {
    return null;
  }

  return { provider: row.provider, kind: row.kind ?? null, value: row.value, label: row.label };
}

/** The default is one per scope: the owner's own methods, or the keys of one contact. */
function scopeWhere(ownerId: string, contactId?: string | null) {
  return { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true } } as const;
}

export namespace PaymentMethodRepository {
  /**
   * The method a billing points at, as the charge freezes it. `ownScopeOnly` keeps a conta a receber on the owner's own
   * methods; a conta a pagar takes any key of the owner, since the pointer was checked when it was filed.
   */
  export async function pointer(db: DbClient, ownerId: string, id: string, ownScopeOnly: boolean, lock = false): Promise<(MethodSnapshot & { archivedAt: string | null }) | null> {
    const row = await db.payment_methods.findOne({
      select: { provider: true, kind: true, value: true, label: true, archived_at: true },
      where: { id, owner_id: ownerId, ...(ownScopeOnly ? { contact_id: { isNull: true } } : {}) },
      ...(lock ? { lock: true } : {})
    });
    const snapshot = row ? snapshotOf(row) : null;

    return snapshot ? { ...snapshot, archivedAt: row?.archived_at ?? null } : null;
  }

  /** The live default of one scope: the owner's own methods, or the keys filed under a contact. */
  export async function defaultOf(db: DbClient, ownerId: string, contactId?: string): Promise<MethodSnapshot | null> {
    const { records } = await db.payment_methods.findMany({
      select: { provider: true, kind: true, value: true, label: true },
      where: { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true }, is_default: true, archived_at: { isNull: true } },
      take: 1
    });
    const row = records[0];

    return row ? snapshotOf(row) : null;
  }

  // get, list, hasLive, clearDefault, markDefault, archive, removeOf, restore: iguais, só o select muda.

  /** The owner's method with this provider and value, whatever its scope or state; the same value never belongs to two scopes. */
  export async function byValue(db: DbClient, ownerId: string, provider: PaymentProvider, value: string): Promise<PaymentMethod | null> {
    const row = await db.payment_methods.findOne({
      select: { id: true, contact_id: true, provider: true, kind: true, value: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { owner_id: ownerId, provider, value }
    });

    return row ? paymentMethodOf(row) : null;
  }

  export async function insert(
    db: DbClient,
    input: { ownerId: string; contactId?: string; provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string; isDefault: boolean; now: string }
  ): Promise<PaymentMethod> {
    const row = await db.payment_methods.insertOne({
      select: { id: true, contact_id: true, provider: true, kind: true, value: true, label: true, is_default: true, archived_at: true, created_at: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        ...(input.contactId ? { contact: { id: input.contactId } } : {}),
        provider: input.provider,
        ...(input.kind ? { kind: input.kind } : {}),
        value: input.value,
        label: input.label,
        is_default: input.isDefault,
        created_at: input.now,
        updated_at: input.now
      }
    });

    return paymentMethodOf(row);
  }

  export async function update(
    db: DbClient,
    ownerId: string,
    id: string,
    input: { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string; now: string }
  ): Promise<PaymentMethod> {
    // `updateOne` hands back the row as it was; the edited one is read again.
    await db.payment_methods.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: { provider: input.provider, kind: input.kind ?? sqlNull, value: input.value, label: input.label, updated_at: input.now }
    });

    const row = await get(db, ownerId, id);

    if (!row) {
      throw new HttpNotFoundError();
    }

    return row;
  }
}
```

Remover `byKey`. Em `database.ts`, `payment_methods.indexes`: trocar `'owner_id:pix_key_type:pix_key': Index.Unique;` por `'owner_id:provider:value': Index.Unique;`.

- [ ] **Step 7: Service**

`services/payment-method.ts`:

```ts
import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { type PaymentMethod, type PaymentMethodInput, PaymentProvider, type PixSnapshot } from '@receivy/common';
import { paymentLinkProvider } from '../../charges/services/payment-link';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { Db, DbClient } from '../../database';
import { AccountRepository } from '../../users/repositories/account';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { InfinitePayCheckoutDisabledError, PaymentLinkUnavailableError, PaymentMethodTakenError } from '../errors';
import { PaymentMethodRepository } from '../repositories/payment-method';
import { type NormalizedPaymentMethod, normalizePaymentMethod } from '../utils/input';

export type PaymentMethodClient = {
  /** Creates a method, or edits one in place; the same value twice on one owner is refused whatever its scope. */
  save(ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod>;
  makeDefault(ownerId: string, id: string): Promise<PaymentMethod>;
  /** Archiving the default hands the title to the oldest live method of the scope. Already archived is a no-op. */
  archive(ownerId: string, id: string): Promise<void>;
};

export declare class PaymentMethodService extends Factory.Service<PaymentMethodClient> {
  handler: typeof createService;

  variables: {
    PAYMENT_LINK_TRANSPORT: Environment.VariableOrValue<'PAYMENT_LINK_TRANSPORT', 'disabled'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
  };

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

// electDefault: igual ao atual.

/** The key typed on a conta a pagar, filed under its receiving contact. Same key twice answers the same id. */
export async function upsertContactKey(tx: DbClient, ownerId: string, contactId: string, pix: PixSnapshot): Promise<string> {
  const method = normalizePaymentMethod({ provider: PaymentProvider.Pix, kind: pix.keyType, value: pix.key, label: pix.label });

  await ContactRepository.user(tx, ownerId, contactId);

  // Unscoped, like `save`'s duplicate check: the same key can only ever belong to one scope of the owner.
  const existing = await PaymentMethodRepository.byValue(tx, ownerId, PaymentProvider.Pix, method.value);
  const now = new Date().toISOString();

  if (existing) {
    if (existing.contactId !== contactId) {
      throw new PaymentMethodTakenError();
    }

    if (existing.archivedAt) {
      const others = await PaymentMethodRepository.hasLive(tx, ownerId, contactId, existing.id);

      await PaymentMethodRepository.restore(tx, existing.id, !others, now);
    }

    return existing.id;
  }

  const others = await PaymentMethodRepository.hasLive(tx, ownerId, contactId);
  const inserted = await PaymentMethodRepository.insert(tx, { ownerId, contactId, ...method, isDefault: !others, now });

  return inserted.id;
}

/**
 * InfinitePay has no "does this handle exist" call: creating a one-real link is the probe. There is no way to
 * delete it afterwards; nobody pays it. A disabled checkout carries the switch's url back to the client.
 */
async function probeHandle(links: PaymentLinkProvider, handle: string): Promise<void> {
  const result = await links.createLink({
    handle,
    orderNsu: `probe:${crypto.randomUUID()}`,
    items: [{ quantity: 1, price: 100, description: 'Validação Receivy' }]
  });

  if (result.status === 'checkout_disabled') {
    throw new InfinitePayCheckoutDisabledError(result.redirectUrl);
  }

  if (result.status === 'unavailable') {
    throw new PaymentLinkUnavailableError();
  }
}

async function save(db: DbClient, links: PaymentLinkProvider, ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod> {
  const method: NormalizedPaymentMethod = normalizePaymentMethod(input);
  const contactId = input.provider === PaymentProvider.Pix ? input.contactId : undefined;

  if (input.provider === PaymentProvider.InfinitePay) {
    await probeHandle(links, method.value);
  }

  return db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    if (contactId) {
      await ContactRepository.user(tx, ownerId, contactId);
    }

    const existing = id ? await PaymentMethodRepository.get(tx, ownerId, id, true) : null;

    if (id && (!existing || existing.archivedAt)) {
      throw new HttpNotFoundError();
    }

    // A contact key is always Pix: nobody pays a person through their InfiniteTag.
    if (existing?.contactId && method.provider !== PaymentProvider.Pix) {
      throw new HttpBadRequestError('Um contato só recebe por Pix.');
    }

    const duplicate = await PaymentMethodRepository.byValue(tx, ownerId, method.provider, method.value);

    if (duplicate && duplicate.id !== id) {
      throw new PaymentMethodTakenError();
    }

    const now = new Date().toISOString();

    if (existing) {
      return PaymentMethodRepository.update(tx, ownerId, existing.id, { ...method, now });
    }

    const anyLive = await PaymentMethodRepository.hasLive(tx, ownerId, contactId);

    return PaymentMethodRepository.insert(tx, { ownerId, contactId, ...method, isDefault: !anyLive, now });
  });
}

// archive: igual ao atual.

export function createService({ db, variables }: Service.Context<PaymentMethodService>): PaymentMethodClient {
  const links = paymentLinkProvider(variables);

  return {
    save: (ownerId, input, id) => save(db, links, ownerId, input, id),
    makeDefault: (ownerId, id) =>
      db.transaction(async (tx) => {
        await AccountRepository.lock(tx, ownerId);

        return electDefault(tx, ownerId, id);
      }),
    archive: (ownerId, id) => archive(db, ownerId, id)
  };
}
```

`contacts/services/contact.ts:174-176` chama `upsertContactKey` com `PixSnapshot`; a assinatura não mudou, nada a fazer. Se `contacts/utils/body.ts` importar `PixKeyTakenError`, trocar por `PaymentMethodTakenError` (grep `PixKeyTakenError` em `src/`; cada ocorrência vira `PaymentMethodTakenError`).

`provider.ts` do domínio não muda (o service declara as variáveis; o EZ4 injeta).

- [ ] **Step 8: Rodar o teste de input e o typecheck**

Run: `pnpm --filter @receivy/api exec vitest run src/payment-methods --pool=forks && pnpm --filter @receivy/api check-types`
Expected: input.test PASS. O typecheck **ainda falha** em `charges/services/materialize.ts`, `charges/utils/columns.ts`, `public/services/public-link.ts`, `billings/services/billing.ts` (leem `keyType/key` do `pointer/defaultOf`): é o que a Task 5 fecha. Confirmar que os erros são só nesses arquivos.

---

### Task 5: Snapshot da charge, colunas do link e leitores

**Files:**
- Modify: `packages/api/src/charges/schemas/charge.ts` (snapshot), `utils/columns.ts`, `repositories/charge.ts`, `services/materialize.ts`, `services/materialize.test.ts`
- Modify: `packages/api/src/billings/services/billing.ts:195-212`, `packages/api/src/billings/services/detail.ts:103-115`
- Modify: `packages/api/src/public/services/public-link.ts:63-72,101-122,155-171`, `packages/api/src/public/errors.ts`

**Interfaces:**
- Consumes: Task 4 (`MethodSnapshot`, `pointer`, `defaultOf`).
- Produces:
  ```ts
  // schemas/charge.ts
  interface PaymentSnapshotSchema { provider: PaymentProvider; kind?: PixKeyType; value: String.Max<254>; label: String.Max<120> }
  // utils/columns.ts
  type PaymentSnapshotColumns = { provider: PaymentProvider; kind?: PixKeyType | null; value: string; label: string }
  paymentOf(row): PaymentSnapshotColumns | null
  paymentLinkOf(row): PaymentLink | null           // { url, state } só quando provider === InfinitePay
  snapshotDto(payment: PaymentSnapshotColumns | null): PaymentSnapshot | null
  // repositories/charge.ts
  ChargeRepository.Row += payment_link_url?, payment_link_state?, provider_transaction_id?, provider_receipt_url?
  ChargeRepository.setPaymentLink(db, id, input: { url?: string; state: PaymentLinkState }, now): Promise<void>
  ChargeRepository.markPaidByProvider(db, id, input: { paidAt: string; transactionId: string; receiptUrl?: string }, now): Promise<void>
  // services/materialize.ts
  ChargeMaterializationContext.payment: MethodSnapshot | null   // era `pix`
  paymentSnapshot(db, ownerId, paymentMethodId?, contactId?): Promise<MethodSnapshot | null>   // era pixSnapshot
  ```

- [ ] **Step 1: Snapshot no schema**

`charges/schemas/charge.ts`: remover `PaymentMethodKind`; `PaymentSnapshotSchema` vira:

```ts
/** The four names the `payment_methods` row carries; `kind` only on Pix. */
export interface PaymentSnapshotSchema {
  provider: PaymentProvider;
  kind?: PixKeyType;
  value: String.Max<254>;
  label: String.Max<120>;
}
```

Import: `import type { ChargeState, PaymentLinkState, PaymentProvider, PixKeyType, ProofMime } from '@receivy/common';`.

- [ ] **Step 2: `utils/columns.ts`**

Trocar `PaymentSnapshotColumns` e `paymentOf` por:

```ts
import { Direction, type PaymentLink, PaymentLinkState, PaymentProvider, type PaymentSnapshot, type PixKeyType } from '@receivy/common';

export type PaymentSnapshotColumns = {
  provider: PaymentProvider;
  kind?: PixKeyType | null;
  value: string;
  label: string;
};

/** How this charge is paid, frozen at the moment it was published. */
export function paymentOf(row: { payment_snapshot?: PaymentSnapshotColumns }): PaymentSnapshotColumns | null {
  return row.payment_snapshot ?? null;
}

/** The snapshot as clients read it. */
export function snapshotDto(payment: PaymentSnapshotColumns | null): PaymentSnapshot | null {
  return payment ? { provider: payment.provider, kind: payment.kind ?? null, value: payment.value, label: payment.label } : null;
}

/** The checkout link of an InfinitePay charge; a Pix charge has none. A link never asked for reads as pending. */
export function paymentLinkOf(row: { payment_snapshot?: PaymentSnapshotColumns; payment_link_url?: string; payment_link_state?: PaymentLinkState }): PaymentLink | null {
  if (row.payment_snapshot?.provider !== PaymentProvider.InfinitePay) {
    return null;
  }

  return { url: row.payment_link_url ?? null, state: row.payment_link_state ?? PaymentLinkState.Pending };
}
```

Remover o `import type { PaymentMethodKind }`.

- [ ] **Step 3: Repository da charge**

Em `repositories/charge.ts`:
- `Row`: adicionar `payment_link_url?: string; payment_link_state?: PaymentLinkState; provider_transaction_id?: string; provider_receipt_url?: string;` (import `PaymentLinkState` de `@receivy/common`).
- Em **todos** os `select` que listam `payment_snapshot: true` (`get`, `forNotice`, `insert`, `dtos`, e qualquer outro em `byBilling`/`between`/`list`/`edit` que devolva `Row`): adicionar `payment_link_url: true, payment_link_state: true, provider_transaction_id: true, provider_receipt_url: true`.
- Em `detailOf`, trocar `pix: payment ? {...} : null,` por:

```ts
    payment: snapshotDto(payment),
    paymentLink: paymentLinkOf(row),
    receiptUrl: row.provider_receipt_url ?? null,
```

  e importar `paymentLinkOf, snapshotDto` de `../utils/columns`.
- Novas funções, depois de `setPayment`:

```ts
  /** Where the checkout link stands; `url` only comes with `ready`. */
  export async function setPaymentLink(db: DbClient, id: string, input: { url?: string; state: PaymentLinkState }, now: string): Promise<void> {
    await db.charges.updateOne({
      where: { id },
      data: { payment_link_state: input.state, ...(input.url ? { payment_link_url: input.url } : {}), updated_at: now }
    });
  }

  /** Settled by the provider: the transaction id is what makes a replayed webhook a no-op. */
  export async function markPaidByProvider(db: DbClient, id: string, input: { paidAt: string; transactionId: string; receiptUrl?: string }, now: string): Promise<void> {
    await db.charges.updateOne({
      where: { id },
      data: {
        state: ChargeState.Paid,
        paid_at: input.paidAt,
        provider_transaction_id: input.transactionId,
        ...(input.receiptUrl ? { provider_receipt_url: input.receiptUrl } : {}),
        updated_at: now
      }
    });
  }
```

- [ ] **Step 4: Materialização**

`services/materialize.ts`:
- `ChargeMaterializationContext.pix` → `payment: MethodSnapshot | null` (import `type MethodSnapshot` de `../../payment-methods/repositories/payment-method`; remover `PixKeyType` e `PaymentMethodKind` dos imports).
- Renomear `pixSnapshot` → `paymentSnapshot`, retorno `Promise<MethodSnapshot | null>`; o corpo troca `{ keyType: key.keyType, key: key.key, label: key.label }` por `{ provider: key.provider, kind: key.kind, value: key.value, label: key.label }` e a mensagem `'Chave Pix indisponível.'` por `'Meio de pagamento indisponível.'`.
- `prepareChargeMaterialization`: `pix` → `payment` nos dois `return`.
- `persistChargePlan`: `payment: context.pix && !settlement.settled ? { method: ..., type: ..., value: ..., label: ... } : null` vira:

```ts
      payment:
        context.payment && !settlement.settled
          ? { provider: context.payment.provider, ...(context.payment.kind ? { kind: context.payment.kind } : {}), value: context.payment.value, label: context.payment.label }
          : null,
```

`materialize.test.ts`: `pixSnapshot` → `paymentSnapshot` (import e `describe`); os mocks devolvem `{ provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: row.pix_key, label: 'Pix' }` em vez de `{ pix_key_type, pix_key, label }` — o `findOne`/`findMany` fake devolve linhas com **nomes de coluna**, então: `{ provider: 'pix', kind: PixKeyType.Email, value: match(where)[0]!.pix_key, label: 'Pix' }`; os `expect(...)?.key` viram `?.value`.

- [ ] **Step 5: Billing edit, billing detail, public link**

`billings/services/billing.ts:208-210`:

```ts
      ...(pixTouched
        ? { payment: context!.payment ? { provider: context!.payment.provider, ...(context!.payment.kind ? { kind: context!.payment.kind } : {}), value: context!.payment.value, label: context!.payment.label } : null }
        : {}),
```

e remover o import de `PaymentMethodKind`. Grep `context.pix`/`context!.pix` no arquivo: cada um vira `payment`.

`billings/services/detail.ts:103-115` (`billingPix` devolve `BillingDetail['pix']`, que segue `PixSnapshot`):

```ts
  try {
    const method = await paymentSnapshot(db, row.owner_id, row.payment_method_id, row.contact_id);

    // A contact key is always Pix; anything else here is a broken pointer, shown as nothing.
    return method?.provider === PaymentProvider.Pix && method.kind ? { keyType: method.kind, key: method.value, label: method.label } : null;
  } catch (error) {
```

(import `paymentSnapshot` no lugar de `pixSnapshot`, `PaymentProvider` de `@receivy/common`).

`public/services/public-link.ts`:
- linha 7: remover `PaymentMethodKind` do import; importar `PaymentProvider` de `@receivy/common` e `paymentLinkOf, snapshotDto` de `../../charges/utils/columns`.
- `ownKey` (63-72): renomear para `ownMethod`; o corpo é o mesmo (`pointer` já devolve a forma nova).
- linhas 108-112: 

```ts
      const method = await ownMethod(tx, creditorId, paymentMethodId, true);
      const stamp = new Date(nowSeconds * 1000).toISOString();

      await ChargeRepository.setPayment(tx, row.id, { provider: method.provider, ...(method.kind ? { kind: method.kind } : {}), value: method.value, label: method.label }, stamp);
      await EventRepository.record(tx, { type: 'charge.pix_published', eventableType: EventableType.Charge, eventableId: row.id, actorId: creditorId, at: stamp });
```

- linhas 116-121: `if (key.key !== payment.value || key.keyType !== payment.type)` → `if (method.value !== payment.value || method.provider !== payment.provider)`.
- `publicChargeView` (155-171): `pix: ...` vira

```ts
    payment: snapshotDto(payment),
    paymentLink: paymentLinkOf(charge),
    receiptUrl: charge.provider_receipt_url ?? null,
```

`public/errors.ts`: mensagens ficam; nomes ficam (`PIX_REQUIRED` é contrato com o cliente).

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api exec vitest run src/charges src/payment-methods --pool=forks`
Expected: typecheck OK em toda a API; `materialize.test` PASS.

---

### Task 6: `ensurePaymentLink` e token de webhook

**Files:**
- Modify: `packages/api/src/public/services/capability.ts:4-7`
- Modify: `packages/api/src/charges/services/payment-link.ts` (completar)
- Create: `packages/api/src/charges/services/payment-link.test.ts`

**Interfaces:**
- Consumes: Task 3 (`PaymentLinkProvider`), Task 5 (`setPaymentLink`, `paymentOf`), `ensurePublicLink` + `linkToken` de `public/services/links.ts`, `pushToUser` de `notifications/services/direct.ts`.
- Produces:
  ```ts
  PublicTokenPurpose.ProviderWebhook = 'provider_webhook'
  type PaymentLinkConfig = { apiOrigin: string; webOrigin: string; secret: string }
  type PaymentLinkVariables = { PUBLIC_API_ORIGIN?: string; PUBLIC_WEB_ORIGIN: string; PUBLIC_LINK_HMAC_SECRET: string; PAYMENT_LINK_TRANSPORT?: string }
  paymentLinkConfigFrom(variables: PaymentLinkVariables): PaymentLinkConfig
  WEBHOOK_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 60 * 60
  webhookToken(chargeId: string, secret: string, nowSeconds: number): string
  ensurePaymentLink(db, links, config, chargeId, now?: number, transport?: NotificationTransport): Promise<PaymentLinkState | null>
  ```
  Regras: snapshot não InfinitePay → `null`; já `ready` ou estado ≠ pending → estado atual; cria link com `orderNsu = charge.id`, item único `{ quantity: 1, price: amount_cents, description }`, `webhookUrl = ${apiOrigin}/webhooks/infinitepay/${webhookToken}`, `redirectUrl = ${webOrigin}/pay/${publicToken}`; `created` → `setPaymentLink(ready, url)` + evento `charge.payment_link.created { url }`; `checkout_disabled` → `failed` + evento `charge.payment_link.failed { reason: 'checkout_disabled', redirectUrl }` + push ao dono (se `transport`); `unavailable` → `failed` + evento `{ reason: 'unavailable' }`, sem push.

- [ ] **Step 1: Purpose**

`capability.ts`:

```ts
export const enum PublicTokenPurpose {
  Charge = 'charge',
  Invite = 'invite',
  /** The path segment InfinitePay posts to: names the charge, never trusted for the money (payment_check does). */
  ProviderWebhook = 'provider_webhook'
}
```

- [ ] **Step 2: Teste**

`payment-link.test.ts`:

```ts
import { ChargeState, PaymentLinkState, PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { ensurePaymentLink, type PaymentLinkConfig, webhookToken } from './payment-link';

const config: PaymentLinkConfig = { apiOrigin: 'https://api.example/receivy', webOrigin: 'https://web.example', secret: 'test-payment-link-secret-with-entropy' };

function dbWith(charge: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const db = {
    charges: {
      findOne: vi.fn(async () => charge),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);

        return charge;
      })
    },
    links: {
      findMany: vi.fn(async () => ({ records: [{ id: 'l', public_id: 'pub', linkable_type: 'charge', linkable_id: charge['id'], expires_at: '2036-01-01T00:00:00.000Z' }] })),
      insertOne: vi.fn()
    },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => events.push(data)) }
  } as unknown as DbClient;

  return { db, updates, events };
}

const infinitePay = { id: 'c1', amount_cents: 1250, description: 'Aluguel', state: ChargeState.Pending, owner_id: 'owner', payment_snapshot: { provider: PaymentProvider.InfinitePay, value: 'loja', label: 'InfinitePay' } };

function provider(result: Awaited<ReturnType<PaymentLinkProvider['createLink']>>) {
  return { createLink: vi.fn(async () => result), checkPayment: vi.fn() } as unknown as PaymentLinkProvider & { createLink: ReturnType<typeof vi.fn> };
}

describe('ensurePaymentLink', () => {
  it('does nothing for a Pix charge', async () => {
    const { db } = dbWith({ ...infinitePay, payment_snapshot: { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'a@b.c', label: 'Pix' } });
    const links = provider({ status: 'created', url: 'x' });

    expect(await ensurePaymentLink(db, links, config, 'c1')).toBeNull();
    expect(links.createLink).not.toHaveBeenCalled();
  });

  it('creates the link once with the charge as order and the webhook/redirect urls', async () => {
    const { db, updates, events } = dbWith(infinitePay);
    const links = provider({ status: 'created', url: 'https://checkout/abc' });

    expect(await ensurePaymentLink(db, links, config, 'c1', Date.UTC(2026, 8, 18))).toBe(PaymentLinkState.Ready);

    const input = links.createLink.mock.calls[0]![0] as { handle: string; orderNsu: string; items: unknown[]; webhookUrl: string; redirectUrl: string };

    expect(input.handle).toBe('loja');
    expect(input.orderNsu).toBe('c1');
    expect(input.items).toEqual([{ quantity: 1, price: 1250, description: 'Aluguel' }]);
    expect(input.webhookUrl).toMatch(/^https:\/\/api\.example\/receivy\/webhooks\/infinitepay\/c1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(input.redirectUrl).toMatch(/^https:\/\/web\.example\/pay\/pub\.\d+\.[A-Za-z0-9_-]+$/);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Ready, payment_link_url: 'https://checkout/abc' });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.created', eventable_id: 'c1' });
  });

  it('is idempotent once the link is ready', async () => {
    const { db } = dbWith({ ...infinitePay, payment_link_state: PaymentLinkState.Ready, payment_link_url: 'https://checkout/abc' });
    const links = provider({ status: 'created', url: 'y' });

    expect(await ensurePaymentLink(db, links, config, 'c1')).toBe(PaymentLinkState.Ready);
    expect(links.createLink).not.toHaveBeenCalled();
  });

  it('records a failure and pushes the owner when the checkout is off', async () => {
    const { db, updates, events } = dbWith(infinitePay);
    const push = vi.fn(async () => ({ status: 'accepted' as const, id: 't' }));
    const transport = { push, email: vi.fn(), receipt: vi.fn() };
    const dbWithDevices = Object.assign(db, { device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd', token: 'ExpoPushToken[x]' }] })) } });

    expect(await ensurePaymentLink(dbWithDevices, provider({ status: 'checkout_disabled', redirectUrl: 'https://app/x' }), config, 'c1', undefined, transport as never)).toBe(PaymentLinkState.Failed);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Failed });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.failed', payload: { reason: 'checkout_disabled', redirectUrl: 'https://app/x' } });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('records unavailable without pushing anyone', async () => {
    const { db, events } = dbWith(infinitePay);

    expect(await ensurePaymentLink(db, provider({ status: 'unavailable' }), config, 'c1')).toBe(PaymentLinkState.Failed);
    expect(events[0]).toMatchObject({ payload: { reason: 'unavailable' } });
  });
});

describe('webhookToken', () => {
  it('names the charge and lives ten years', () => {
    const token = webhookToken('c1', config.secret, 1_000);

    expect(token.startsWith('c1.315361000.')).toBe(true);
  });
});
```

Nota: o `DeviceRepository.active` lê `db.device_tokens.findMany` com `select`/`where`; o mock acima devolve `records` com `id` e `token`. Se `DeviceRepository.active` filtrar outro campo (ver `notifications/repositories/device.ts`), incluir esse campo no registro do mock.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api exec vitest run src/charges/services/payment-link.test.ts --pool=forks`
Expected: FAIL (`ensurePaymentLink` não exportado).

- [ ] **Step 4: Completar `payment-link.ts`**

Acrescentar ao arquivo da Task 4:

```ts
import { ChargeState, type PaymentLinkState as LinkState, PaymentLinkState, PaymentProvider } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../public/services/capability';
import { ensurePublicLink, linkToken } from '../../public/services/links';
import { ChargeRepository } from '../repositories/charge';
import { ownerOf, paymentOf } from '../utils/columns';

export type PaymentLinkConfig = { apiOrigin: string; webOrigin: string; secret: string };

export type PaymentLinkVariables = { PUBLIC_API_ORIGIN?: string; PUBLIC_WEB_ORIGIN: string; PUBLIC_LINK_HMAC_SECRET: string; PAYMENT_LINK_TRANSPORT?: string };

export const WEBHOOK_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export function paymentLinkConfigFrom(variables: PaymentLinkVariables): PaymentLinkConfig {
  return {
    apiOrigin: (variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, ''),
    webOrigin: variables.PUBLIC_WEB_ORIGIN.replace(/\/+$/, ''),
    secret: variables.PUBLIC_LINK_HMAC_SECRET
  };
}

/** The webhook path segment: unguessable, bound to the charge, never a proof of payment on its own. */
export function webhookToken(chargeId: string, secret: string, nowSeconds: number): string {
  return issuePublicChargeToken({ publicId: chargeId, expiresAtSeconds: nowSeconds + WEBHOOK_TOKEN_TTL_SECONDS, secret, purpose: PublicTokenPurpose.ProviderWebhook });
}

function record(db: DbClient, chargeId: string, type: string, payload: Record<string, unknown>, at: string) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, payload, at });
}

/**
 * Makes sure an InfinitePay charge has its checkout link. Safe to call from anywhere, any number of times:
 * a Pix charge, a settled charge or a link already ready are no-ops. A failure is written down as `failed`
 * so the next caller (the notice, the public page, the owner's button) tries again. Never throws.
 */
export async function ensurePaymentLink(
  db: DbClient,
  links: PaymentLinkProvider,
  config: PaymentLinkConfig,
  chargeId: string,
  now = Date.now(),
  transport?: NotificationTransport
): Promise<LinkState | null> {
  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;

  if (!charge || payment?.provider !== PaymentProvider.InfinitePay) {
    return null;
  }

  const current = charge.payment_link_state ?? PaymentLinkState.Pending;

  if (current === PaymentLinkState.Ready || charge.state !== ChargeState.Pending) {
    return current;
  }

  const nowSeconds = Math.floor(now / 1000);
  const stamp = new Date(now).toISOString();
  const publicLink = await ensurePublicLink(db, charge.id, nowSeconds);
  const result = await links.createLink({
    handle: payment.value,
    orderNsu: charge.id,
    items: [{ quantity: 1, price: charge.amount_cents, description: charge.description }],
    webhookUrl: `${config.apiOrigin}/webhooks/infinitepay/${webhookToken(charge.id, config.secret, nowSeconds)}`,
    redirectUrl: `${config.webOrigin}/pay/${linkToken(publicLink, config.secret)}`
  });

  if (result.status === 'created') {
    await ChargeRepository.setPaymentLink(db, charge.id, { url: result.url, state: PaymentLinkState.Ready }, stamp);
    await record(db, charge.id, 'charge.payment_link.created', { url: result.url }, stamp);

    return PaymentLinkState.Ready;
  }

  await ChargeRepository.setPaymentLink(db, charge.id, { state: PaymentLinkState.Failed }, stamp);

  if (result.status === 'checkout_disabled') {
    await record(db, charge.id, 'charge.payment_link.failed', { reason: 'checkout_disabled', redirectUrl: result.redirectUrl }, stamp);

    if (transport) {
      await pushToUser(db, transport, ownerOf(charge), {
        title: 'Link de pagamento não criado',
        body: 'Ative o checkout externo no app da InfinitePay para a cobrança ganhar um link.',
        url: `${config.webOrigin}/charges/${charge.id}`
      });
    }

    return PaymentLinkState.Failed;
  }

  await record(db, charge.id, 'charge.payment_link.failed', { reason: 'unavailable' }, stamp);

  return PaymentLinkState.Failed;
}
```

(Se o TypeScript reclamar do alias `LinkState`, usar `PaymentLinkState` direto no tipo de retorno; o alias só evita conflito entre o valor e o tipo.)

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @receivy/api exec vitest run src/charges/services/payment-link.test.ts src/public --pool=forks && pnpm --filter @receivy/api check-types`
Expected: PASS; typecheck OK.

---

### Task 7: Criação do link após o commit, aviso espera o link, variáveis

**Files:**
- Modify: `packages/api/src/notifications/services/planner.ts:3-34`, `context.ts`, `send.ts:33-56,152-158`, `render.ts:12-67`
- Modify: `packages/api/src/notifications/schedulers/charge-notify.ts:42-51`, `packages/api/src/notifications/services/notification.ts` (bloco `variables`), `packages/api/src/billings/crons/materialize.ts` (bloco `variables`), `packages/api/src/billings/services/billing.ts` (bloco `variables`), `packages/api/src/invites/services/invite.ts` (bloco `variables`), `packages/api/src/public/services/public-link.ts:41-49`
- Modify: `packages/api/ez4.project.js`, `local.env.example`, `dev.env.example`, `test.env.example`
- Modify: `packages/api/test/fixtures/scheduling.ts:77-89`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  ```ts
  NotificationConfig.apiOrigin: string
  NotificationVariables += PUBLIC_API_ORIGIN?: string; PAYMENT_LINK_TRANSPORT?: string
  NoticeContext.links: PaymentLinkProvider
  SkipReason.LinkPending = 'link_pending'
  RenderInputs.provider?: PaymentProvider   // muda a nota de rodapé
  ```

- [ ] **Step 1: Config e contexto**

`planner.ts`:

```ts
export interface NotificationConfig {
  publicOrigin: string;
  /** Public origin of this API: the base of the webhook url InfinitePay posts to. */
  apiOrigin: string;
  secret: string;
  from?: string;
  pushAvailable?: boolean;
}

export interface NotificationVariables {
  PUBLIC_WEB_ORIGIN: string;
  PUBLIC_API_ORIGIN?: string;
  PUBLIC_LINK_HMAC_SECRET: string;
  RESEND_FROM_EMAIL?: string;
  NOTIFICATION_PUSH_TRANSPORT?: string;
  PAYMENT_LINK_TRANSPORT?: string;
}

export function notificationConfigFrom(variables: NotificationVariables): NotificationConfig {
  return {
    publicOrigin: variables.PUBLIC_WEB_ORIGIN,
    apiOrigin: (variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, ''),
    secret: variables.PUBLIC_LINK_HMAC_SECRET,
    from: variables.RESEND_FROM_EMAIL,
    pushAvailable: variables.NOTIFICATION_PUSH_TRANSPORT === 'expo'
  };
}
```

`context.ts`:

```ts
import { paymentLinkProvider } from '../../charges/services/payment-link';
// ...
export function noticeContext({ variables, email, chargeNotifyScheduler }: ProducerContext): NoticeContext {
  return {
    config: notificationConfigFrom(variables),
    transport: notificationTransport(variables, globalThis.fetch, email),
    notify: chargeNotifyScheduler,
    links: paymentLinkProvider(variables)
  };
}
```

`send.ts`:
- `NoticeContext` ganha `links: PaymentLinkProvider;` (import type de `../../vendors/infinitepay/types`).
- `SkipReason` ganha `LinkPending = 'link_pending'`.
- Import `ensurePaymentLink` e `paymentLinkConfigFrom`? Não: o config já tem `apiOrigin/publicOrigin/secret`. Adicionar em `send.ts` um helper:

```ts
/** What `ensurePaymentLink` needs, read off the notice config. */
function linkConfig(config: NotificationConfig) {
  return { apiOrigin: config.apiOrigin, webOrigin: config.publicOrigin, secret: config.secret };
}
```

- Em `sendChargeNotice`, depois do bloco `PixRequired` (linha 155) e antes de `const link = ownBill ? null : ...`:

```ts
  // An InfinitePay charge is announced with its checkout link ready; a link still failing is tried once more here.
  if (!ownBill && paymentOf(charge)?.provider === PaymentProvider.InfinitePay) {
    const state = await ensurePaymentLink(db, context.links, linkConfig(context.config), chargeId, now, context.transport);

    if (state !== PaymentLinkState.Ready) {
      return skipped(db, chargeId, payload, SkipReason.LinkPending);
    }
  }
```

  (imports: `PaymentLinkState, PaymentProvider` de `@receivy/common`; `ensurePaymentLink` de `../../charges/services/payment-link`; `NotificationConfig` de `./planner`).
- Em `announceCharges`, no início do `for`, antes do `forNotice`:

```ts
    // Created a moment ago, outside the transaction: the checkout link is asked for now, whether or not the notice is due yet.
    await ensurePaymentLink(db, context.links, linkConfig(context.config), chargeId, now, context.transport);
```

- Passar `provider` ao render: em `renderNotice(...)` adicionar `provider: paymentOf(charge)?.provider` ao objeto de inputs.

`render.ts`: `RenderInputs` ganha `provider?: PaymentProvider;` (import type de `@receivy/common`), e a `footnote` vira:

```ts
    footnote:
      input.provider === PaymentProvider.InfinitePay
        ? 'O pagamento acontece pelo link da InfinitePay de quem cobra.'
        : 'O pagamento acontece direto entre vocês, pela chave Pix de quem cobra.',
```

(`PaymentProvider` importado como valor.) `render.test.ts` existente continua passando (sem `provider` = texto antigo).

- [ ] **Step 2: Variáveis nos seis produtores**

Em cada bloco `variables:` de `notifications/schedulers/charge-notify.ts`, `notifications/services/notification.ts`, `billings/crons/materialize.ts`, `billings/services/billing.ts`, `invites/services/invite.ts`, `public/services/public-link.ts`, adicionar:

```ts
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    PAYMENT_LINK_TRANSPORT: Environment.VariableOrValue<'PAYMENT_LINK_TRANSPORT', 'disabled'>;
```

`ez4.project.js`, em `variables`, depois de `PUBLIC_WEB_ORIGIN`:

```js
    PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api',
    PAYMENT_LINK_TRANSPORT: process.env.PAYMENT_LINK_TRANSPORT ?? 'disabled'
```

`local.env.example` e `test.env.example`: adicionar

```
# InfinitePay checkout links: `infinitepay` talks to the real API (no key; the handle is the identity),
# `fake` answers every handle locally, `disabled` fails every link. The API origin is the base of the webhook url.
PAYMENT_LINK_TRANSPORT=fake
PUBLIC_API_ORIGIN=http://127.0.0.1:3735/local-receivy-api
```

`dev.env.example`: `PAYMENT_LINK_TRANSPORT=infinitepay` e `PUBLIC_API_ORIGIN=https://<id>.execute-api.sa-east-1.amazonaws.com/dev-receivy-api` (comentário: a URL que `pnpm output:dev` imprime).

- [ ] **Step 3: Fixture de testes**

`test/fixtures/scheduling.ts`: `TEST_CONFIG` ganha `apiOrigin: 'https://api.receivy.example'`; `fakeNotice` monta `links: createFakePaymentLinkProvider('https://receivy.example')` (import de `../../src/vendors/infinitepay/fake`) no `context`.

`test/fixtures/financial.ts`: `paymentMethods = createPaymentMethodService({ db, variables: { PAYMENT_LINK_TRANSPORT: 'fake', PUBLIC_WEB_ORIGIN: 'https://receivy.example' } } as unknown as Service.Context<PaymentMethodService>)`.

- [ ] **Step 4: Verificar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test`
Expected: OK; unit verdes (baseline: 6 falhas conhecidas em `email/service.test.ts` continuam, ver memória `receivy-verification-baselines`).

---

### Task 8: Página pública tenta o link; `POST /charges/{id}/payment-link`

**Files:**
- Modify: `packages/api/src/public/services/public-link.ts:221-234`
- Create: `packages/api/src/charges/endpoints/payment-link.ts`
- Modify: `packages/api/src/charges/routes.ts`, `packages/api/src/charges/provider.ts`

**Interfaces:**
- Consumes: Task 6, Task 7.
- Produces: `ensurePaymentLinkHandler` (`POST /charges/{id}/payment-link`, sessão, dono ou credor; 200 `ChargeDetail`).

- [ ] **Step 1: `view` tenta uma vez**

Em `public-link.ts` `createService`:

```ts
export function createService({ db, email, chargeNotifyScheduler, variables }: Service.Context<PublicLinkService>): PublicLinkClient {
  const secret = variables.PUBLIC_LINK_HMAC_SECRET;
  const links = paymentLinkProvider(variables);
  const linkConfig = paymentLinkConfigFrom(variables);

  return {
    // publish, rotate: iguais
    view: async (token) => {
      const charge = await resolvePublicCharge(db, token, secret);

      // Last resort for a link that failed at creation and at notice time: the payer is here now.
      if (paymentLinkOf(charge)?.state !== PaymentLinkState.Ready && (await ensurePaymentLink(db, links, linkConfig, charge.id)) === PaymentLinkState.Ready) {
        return { charge, view: await publicChargeView(db, (await ChargeRepository.get(db, charge.id))!) };
      }

      return { charge, view: await publicChargeView(db, charge) };
    }
  };
}
```

Imports: `ensurePaymentLink, paymentLinkConfigFrom, paymentLinkProvider` de `../../charges/services/payment-link`; `PaymentLinkState` de `@receivy/common`. `paymentLinkOf` devolve `null` para Pix, e `null !== Ready` chamaria `ensure`, que devolve `null` imediatamente para Pix: uma leitura a mais, sem chamada externa. Aceitável.

- [ ] **Step 2: Endpoint**

`charges/endpoints/payment-link.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { notificationTransport } from '../../notifications/services/transport';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ChargeProvider } from '../provider';
import { ensurePaymentLink, paymentLinkConfigFrom, paymentLinkProvider } from '../services/payment-link';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ItemResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

/** "Gerar link de novo": asks InfinitePay again for a charge whose link failed. A ready link answers as is. */
export async function ensurePaymentLinkHandler(
  { identity, parameters }: IdRequest,
  { db, avatarFiles, charges, variables }: Service.Context<ChargeProvider>
): Promise<ItemResponse> {
  const { userId } = identity;

  // Reading as the actor is the access check: owner, creditor and debtor may read, anyone else is refused.
  await charges.get(userId, parameters.id);
  await ensurePaymentLink(db, paymentLinkProvider(variables), paymentLinkConfigFrom(variables), parameters.id, Date.now(), notificationTransport(variables));

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, await charges.get(userId, parameters.id)) };
}
```

`charges/provider.ts` `variables` ganha:

```ts
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    PAYMENT_LINK_TRANSPORT: Environment.VariableOrValue<'PAYMENT_LINK_TRANSPORT', 'disabled'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
```

`charges/routes.ts`: adicionar

```ts
  Http.UseRoute<{
    name: 'ensurePaymentLink';
    path: 'POST /charges/{id}/payment-link';
    authorizer: typeof sessionAuthorizer;
    handler: typeof ensurePaymentLinkHandler;
  }>
```

- [ ] **Step 3: Verificar**

Run: `pnpm --filter @receivy/api check-types`
Expected: OK.

---

### Task 9: `settleByProvider` + webhook

**Files:**
- Create: `packages/api/src/charges/services/settle.ts`, `settle.test.ts`
- Create: `packages/api/src/webhooks/routes.ts`, `provider.ts`, `endpoints/infinitepay.ts`
- Modify: `packages/api/src/api.ts` (rotas)

**Interfaces:**
- Consumes: Task 5 (`markPaidByProvider`), Task 6 (`PublicTokenPurpose.ProviderWebhook`), `ProofRepository.current/answer`, `pushToUser`, `AccountRepository.person`.
- Produces:
  ```ts
  type SettleOutcome = 'settled' | 'replayed' | 'ignored' | 'rejected' | 'mismatch' | 'unavailable'
  type SettleInput = { chargeId: string; transactionNsu: string; slug: string; receiptUrl?: string }
  settleByProvider(db, links: PaymentLinkProvider, notices: { transport: NotificationTransport; origin: string }, input: SettleInput, now?: Date): Promise<SettleOutcome>
  infinitePayWebhookHandler   // POST /webhooks/infinitepay/{token}, sem authorizer, preferences.namingStyle Preserve
  ```

- [ ] **Step 1: Teste do finalizador**

`settle.test.ts` (mock de `db` no estilo de `payment-link.test.ts`; `db.transaction(fn)` chama `fn(db)`):

```ts
import { ChargeState, PaymentProvider } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { settleByProvider } from './settle';

const base = { id: 'c1', amount_cents: 1000, description: 'Aluguel', state: ChargeState.Pending, owner_id: 'owner', creditor_id: 'owner', debtor_id: 'payer', payment_snapshot: { provider: PaymentProvider.InfinitePay, value: 'loja', label: 'InfinitePay' } };

function dbWith(charge: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const db = {
    transaction: async (fn: (tx: DbClient) => Promise<unknown>) => fn(db),
    charges: {
      findOne: vi.fn(async () => charge),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);

        return charge;
      })
    },
    proofs: { findMany: vi.fn(async () => ({ records: [] })) },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => events.push(data)), findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'payer', name: 'Ana Silva' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) }
  } as unknown as DbClient;

  return { db, updates, events };
}

function links(check: Awaited<ReturnType<PaymentLinkProvider['checkPayment']>>) {
  return { createLink: vi.fn(), checkPayment: vi.fn(async () => check) } as unknown as PaymentLinkProvider & { checkPayment: ReturnType<typeof vi.fn> };
}

const notices = { transport: { push: vi.fn(async () => ({ status: 'disabled' as const })), email: vi.fn(), receipt: vi.fn() }, origin: 'https://web' };
const input = { chargeId: 'c1', transactionNsu: 'tx-1', slug: 'inv-1', receiptUrl: 'https://receipt/1' };
const paid = { status: 'checked' as const, paid: true, amountCents: 1000, paidAmountCents: 1010, captureMethod: 'pix' };

describe('settleByProvider', () => {
  it('settles a pending charge after a positive payment_check', async () => {
    const { db, updates, events } = dbWith(base);
    const provider = links(paid);

    expect(await settleByProvider(db, provider, notices as never, input)).toBe('settled');
    expect(provider.checkPayment).toHaveBeenCalledWith({ handle: 'loja', orderNsu: 'c1', transactionNsu: 'tx-1', slug: 'inv-1' });
    expect(updates.at(-1)).toMatchObject({ state: ChargeState.Paid, provider_transaction_id: 'tx-1', provider_receipt_url: 'https://receipt/1' });
    expect(events.at(-1)).toMatchObject({ type: 'charge.paid', payload: { via: 'provider', provider: 'infinitepay', transactionNsu: 'tx-1', paidAmountCents: 1010, captureMethod: 'pix' } });
  });

  it('replays a transaction already recorded without calling the provider', async () => {
    const { db } = dbWith({ ...base, state: ChargeState.Paid, provider_transaction_id: 'tx-1' });
    const provider = links(paid);

    expect(await settleByProvider(db, provider, notices as never, input)).toBe('replayed');
    expect(provider.checkPayment).not.toHaveBeenCalled();
  });

  it('ignores a Pix charge', async () => {
    const { db } = dbWith({ ...base, payment_snapshot: { provider: PaymentProvider.Pix, kind: 'email', value: 'a@b.c', label: 'Pix' } });

    expect(await settleByProvider(db, links(paid), notices as never, input)).toBe('ignored');
  });

  it('answers unavailable when payment_check cannot be reached', async () => {
    const { db, updates } = dbWith(base);

    expect(await settleByProvider(db, links({ status: 'unavailable' }), notices as never, input)).toBe('unavailable');
    expect(updates).toHaveLength(0);
  });

  it('records a rejected check without settling', async () => {
    const { db, updates, events } = dbWith(base);

    expect(await settleByProvider(db, links({ ...paid, paid: false }), notices as never, input)).toBe('rejected');
    expect(updates).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.rejected' });
  });

  it('records a smaller amount as a mismatch', async () => {
    const { db, updates, events } = dbWith(base);

    expect(await settleByProvider(db, links({ ...paid, amountCents: 900 }), notices as never, input)).toBe('mismatch');
    expect(updates).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.mismatch', payload: { amountCents: 900, transactionNsu: 'tx-1' } });
  });

  it('leaves a cancelled charge alone and writes it down', async () => {
    const { db, updates, events } = dbWith({ ...base, state: ChargeState.Cancelled });

    expect(await settleByProvider(db, links(paid), notices as never, input)).toBe('ignored');
    expect(updates).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.ignored', payload: { state: ChargeState.Cancelled, transactionNsu: 'tx-1' } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api exec vitest run src/charges/services/settle.test.ts --pool=forks`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: `settle.ts`**

```ts
import { ChargeState, formatMoney, PaymentProvider, ProofKind } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { ProofRepository } from '../../proofs/repositories/proof';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { ChargeRepository } from '../repositories/charge';
import { StoredProofState } from '../schemas/charge';
import { creditorOf, debtorOf, ownerOf, paymentOf } from '../utils/columns';

export type SettleOutcome = 'settled' | 'replayed' | 'ignored' | 'rejected' | 'mismatch' | 'unavailable';

export type SettleInput = { chargeId: string; transactionNsu: string; slug: string; receiptUrl?: string };

export type SettleNotices = { transport: NotificationTransport; origin: string };

function record(db: DbClient, chargeId: string, type: string, payload: Record<string, unknown>, at: string) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, payload, at });
}

async function tell(db: DbClient, notices: SettleNotices, userId: string | undefined, title: string, body: string, chargeId: string): Promise<void> {
  if (!userId) {
    return;
  }

  await pushToUser(db, notices.transport, userId, { title, body, url: `${notices.origin.replace(/\/+$/, '')}/charges/${chargeId}` });
}

/**
 * The one finalizer behind the webhook and the payer's return. Nothing in the request is trusted: the provider is
 * asked (`payment_check`) before the charge moves. Idempotent by transaction nsu. A charge that is no longer
 * pending is never moved: the owner hears about the money and decides.
 */
export async function settleByProvider(db: DbClient, links: PaymentLinkProvider, notices: SettleNotices, input: SettleInput, now = new Date()): Promise<SettleOutcome> {
  const charge = await ChargeRepository.get(db, input.chargeId);
  const payment = charge ? paymentOf(charge) : null;

  if (!charge || payment?.provider !== PaymentProvider.InfinitePay) {
    return 'ignored';
  }

  if (charge.provider_transaction_id === input.transactionNsu) {
    return 'replayed';
  }

  const check = await links.checkPayment({ handle: payment.value, orderNsu: charge.id, transactionNsu: input.transactionNsu, slug: input.slug });
  const stamp = now.toISOString();
  const what = `${charge.description} · ${formatMoney({ amountCents: charge.amount_cents, currency: 'BRL' })}`;

  if (check.status === 'unavailable') {
    return 'unavailable';
  }

  if (!check.paid) {
    await record(db, charge.id, 'charge.provider.rejected', { transactionNsu: input.transactionNsu, slug: input.slug }, stamp);

    return 'rejected';
  }

  if (check.amountCents < charge.amount_cents) {
    await record(db, charge.id, 'charge.provider.mismatch', { amountCents: check.amountCents, paidAmountCents: check.paidAmountCents, transactionNsu: input.transactionNsu }, stamp);
    await tell(db, notices, ownerOf(charge), 'Valor divergente na InfinitePay', `A InfinitePay confirmou ${formatMoney({ amountCents: check.amountCents, currency: 'BRL' })} para ${what}. Confira antes de marcar como pago.`, charge.id);

    return 'mismatch';
  }

  return db.transaction(async (tx) => {
    const locked = await ChargeRepository.get(tx, charge.id, true);

    if (!locked) {
      return 'ignored';
    }

    if (locked.provider_transaction_id === input.transactionNsu) {
      return 'replayed';
    }

    if (locked.state !== ChargeState.Pending) {
      await record(tx, locked.id, 'charge.provider.ignored', { state: locked.state, transactionNsu: input.transactionNsu, receiptUrl: input.receiptUrl }, stamp);
      await tell(tx, notices, ownerOf(locked), 'Pagamento recebido pela InfinitePay', `${what} já estava ${locked.state === ChargeState.Paid ? 'paga' : 'cancelada'} e recebeu um pagamento pelo link.`, locked.id);

      return 'ignored';
    }

    // Whatever waited in review is answered by the provider, like a manual settlement would.
    const proof = await ProofRepository.current(tx, locked.id, true);

    if (proof?.state === StoredProofState.Pending) {
      const declaration = proof.kind === ProofKind.Declaration;

      await ProofRepository.answer(tx, proof.id, { state: StoredProofState.Accepted, dropFile: declaration }, stamp);
      await record(tx, locked.id, 'proof.accepted', { name: declaration ? undefined : proof.file?.name }, stamp);
    }

    await ChargeRepository.markPaidByProvider(tx, locked.id, { paidAt: stamp, transactionId: input.transactionNsu, receiptUrl: input.receiptUrl }, stamp);
    await record(
      tx,
      locked.id,
      'charge.paid',
      { via: 'provider', provider: PaymentProvider.InfinitePay, transactionNsu: input.transactionNsu, paidAmountCents: check.paidAmountCents, captureMethod: check.captureMethod, receiptUrl: input.receiptUrl },
      stamp
    );

    await tell(tx, notices, creditorOf(locked), 'Pagamento recebido pela InfinitePay', `${what} foi paga pelo link.`, locked.id);
    await tell(tx, notices, debtorOf(locked), 'Pagamento confirmado', `${what} foi confirmada pela InfinitePay.`, locked.id);

    return 'settled';
  });
}
```

Se `ProofRepository.current`/`answer` tiverem assinaturas diferentes das usadas em `charge.ts:84-89`, copiar de lá.

- [ ] **Step 4: Rodar**

Run: `pnpm --filter @receivy/api exec vitest run src/charges/services/settle.test.ts --pool=forks`
Expected: PASS (7 testes).

- [ ] **Step 5: Domínio `webhooks`**

`webhooks/provider.ts`:

```ts
import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';

export declare class WebhookProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PAYMENT_LINK_TRANSPORT: Environment.VariableOrValue<'PAYMENT_LINK_TRANSPORT', 'disabled'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };
}
```

`webhooks/endpoints/infinitepay.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { paymentLinkProvider } from '../../charges/services/payment-link';
import { settleByProvider } from '../../charges/services/settle';
import { notificationTransport } from '../../notifications/services/transport';
import { PublicTokenPurpose, verifyPublicChargeToken } from '../../public/services/capability';
import type { WebhookProvider } from '../provider';

/** Every field optional: a body InfinitePay changed tomorrow must still get a 200, never a retry storm. */
declare class InfinitePayWebhookBody implements Http.JsonBody {
  invoice_slug?: String.Max<200>;
  transaction_nsu?: String.Max<200>;
  order_nsu?: String.Max<200>;
  receipt_url?: String.Max<500>;
  amount?: number;
  paid_amount?: number;
  installments?: number;
  capture_method?: String.Max<40>;
}

declare class WebhookRequest implements Http.Request {
  parameters: { token: String.Max<300> };
  body: InfinitePayWebhookBody;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

/**
 * InfinitePay's "paid" ping. The token only names the charge; the money is confirmed by `payment_check`
 * inside `settleByProvider`. 200 closes the delivery (processed, replayed, forged or ignored alike);
 * 400 is reserved for "our side could not ask the provider", which InfinitePay retries.
 */
export async function infinitePayWebhookHandler({ parameters, body }: WebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  let chargeId: string;

  try {
    chargeId = verifyPublicChargeToken(parameters.token, { secret: variables.PUBLIC_LINK_HMAC_SECRET, purpose: PublicTokenPurpose.ProviderWebhook }).publicId;
  } catch {
    return RECEIVED;
  }

  if (!body.transaction_nsu || !body.invoice_slug || body.order_nsu !== chargeId) {
    return RECEIVED;
  }

  const outcome = await settleByProvider(
    db,
    paymentLinkProvider(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { chargeId, transactionNsu: body.transaction_nsu, slug: body.invoice_slug, receiptUrl: body.receipt_url }
  );

  console.info('InfinitePay webhook', { chargeId, outcome });

  if (outcome === 'unavailable') {
    throw new HttpBadRequestError('Payment check unavailable');
  }

  return RECEIVED;
}
```

`webhooks/routes.ts`:

```ts
import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { infinitePayWebhookHandler } from './endpoints/infinitepay';

export type WebhookRoutes = [
  Http.UseRoute<{
    name: 'infinitePayWebhook';
    path: 'POST /webhooks/infinitepay/{token}';
    handler: typeof infinitePayWebhookHandler;
    // InfinitePay posts snake_case; the API default (camelCase) must not rename the fields.
    preferences: { namingStyle: NamingStyle.Preserve };
  }>
];
```

Se o EZ4 recusar `preferences` dentro de `Http.UseRoute` no typecheck, olhar `node_modules/@ez4/gateway/dist/services/target.d.ts` (`preferences?: WebPreferences` existe no target) e mover para o formato que o tipo aceitar; a alternativa é declarar o body com os dois nomes (`transactionNsu?` e `transaction_nsu?`) e ler qualquer um.

`api.ts`: importar `WebhookRoutes` e adicionar `...WebhookRoutes` ao fim de `routes`.

- [ ] **Step 6: Verificar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test`
Expected: OK.

---

### Task 10: Retorno do pagador (`POST /public/charges/{token}/provider-return`)

**Files:**
- Create: `packages/api/src/public/endpoints/provider-return.ts`
- Modify: `packages/api/src/public/routes.ts`, `packages/api/src/public/provider.ts`

**Interfaces:**
- Consumes: Task 9 (`settleByProvider`), `publicLinks.view`, `throttlePublicRead`.
- Produces: `providerReturnHandler` — body `{ orderNsu, transactionNsu, slug }` (camelCase, padrão da API; o BFF do web traduz os query params), 200 `PublicChargeView`, 400 se `orderNsu` não for a charge do token, 503 se o provider estiver indisponível.

- [ ] **Step 1: Provider**

`public/provider.ts`:

```ts
export declare class PublicProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    publicLinks: Environment.Service<PublicLinkService>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PAYMENT_LINK_TRANSPORT: Environment.VariableOrValue<'PAYMENT_LINK_TRANSPORT', 'disabled'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };
}
```

- [ ] **Step 2: Endpoint**

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicChargeView } from '@receivy/common';
import { paymentLinkProvider } from '../../charges/services/payment-link';
import { settleByProvider } from '../../charges/services/settle';
import { throttlePublicRead } from '../../common/utils/throttle';
import { notificationTransport } from '../../notifications/services/transport';
import { PaymentLinkUnavailableError } from '../../payment-methods/errors';
import type { PublicProvider } from '../provider';

declare class ProviderReturnBody implements Http.JsonBody {
  orderNsu: String.Max<200>;
  transactionNsu: String.Max<200>;
  slug: String.Max<200>;
  receiptUrl?: String.Max<500>;
}

declare class ProviderReturnRequest implements Http.Request {
  parameters: { token: String.Max<200> };
  body: ProviderReturnBody;
}

declare class PublicResponse implements Http.Response {
  status: 200;
  body: PublicChargeView;
}

/** The payer came back from InfinitePay with the ids of what they paid: the same finalizer the webhook uses closes the charge. */
export async function providerReturnHandler({ parameters, body }: ProviderReturnRequest, { db, publicLinks, variables }: Service.Context<PublicProvider>): Promise<PublicResponse> {
  const { charge } = await publicLinks.view(parameters.token);

  await throttlePublicRead(db, charge.id);

  if (body.orderNsu !== charge.id) {
    throw new HttpBadRequestError('Pedido não corresponde à cobrança.');
  }

  const outcome = await settleByProvider(
    db,
    paymentLinkProvider(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { chargeId: charge.id, transactionNsu: body.transactionNsu, slug: body.slug, receiptUrl: body.receiptUrl }
  );

  if (outcome === 'unavailable') {
    throw new PaymentLinkUnavailableError();
  }

  return { status: 200, body: (await publicLinks.view(parameters.token)).view };
}
```

`public/routes.ts`: adicionar `Http.UseRoute<{ name: 'providerReturn'; path: 'POST /public/charges/{token}/provider-return'; handler: typeof providerReturnHandler }>`.

- [ ] **Step 3: Verificar**

Run: `pnpm --filter @receivy/api check-types`
Expected: OK.

---

### Task 11: Specs de integração (forma nova + InfinitePay ponta a ponta)

**Files:**
- Modify: specs listados em `grep -rln "pixKeyType\|\.pix\b\|pixKey\|PaymentMethodKind" packages/api/test` (account, billings/{billings,contact-keys,month-materialized,payable,registros,notify}, financial/{financial,first-publication}, invites, scheduling/crons, notifications, proofs)
- Create: `packages/api/test/financial/infinitepay.spec.ts`

**Interfaces:**
- Consumes: tudo acima.

- [ ] **Step 1: Substituições mecânicas nos specs**

Em cada spec (não em `src`):
- `paymentMethods.save(X, { pixKeyType: T, pixKey: V, label?: L, contactId?: C })` → `paymentMethods.save(X, { provider: PaymentProvider.Pix, kind: T, value: V, label?: L, contactId?: C })`; importar `PaymentProvider` de `@receivy/common`.
- Leituras `.pixKey` → `.value`, `.pixKeyType` → `.kind` em `PaymentMethod`.
- `ChargeDetail`/`PublicChargeView`: `.pix` → `.payment`; `.pix?.key` / `.pix.key` → `.payment?.value` / `.payment.value`; `.pix?.keyType` → `.payment?.kind`.
- `PaymentMethodRepository.byKey(db, owner, type, key)` → `byValue(db, owner, PaymentProvider.Pix, key)`.
- Inserts diretos em `payment_methods` (`client.payment_methods.insertOne({ data: { type: 'pix', pix_key_type, pix_key, ... } })`) → `{ provider: 'pix', kind, value, ... }`.
- Asserts sobre `payment_snapshot` `{ method: 'pix', type, value, label }` → `{ provider: 'pix', kind, value, label }`.
- `PixKeyTakenError` → `PaymentMethodTakenError`; código `'PIX_KEY_TAKEN'` → `'PAYMENT_METHOD_TAKEN'`.
- `sharingState 'pix_required'` e `reason: 'pix_required'` **não mudam**.

Run: `pnpm --filter @receivy/api check-types:test`
Expected: OK antes de subir o banco.

- [ ] **Step 2: Spec InfinitePay**

`test/financial/infinitepay.spec.ts`:

```ts
import { equal, ok } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ChargeState, PaymentLinkState, PaymentProvider } from '@receivy/common';
import { settleByProvider } from '../../src/charges/services/settle';
import { EventRepository } from '../../src/common/repositories/events';
import { publicChargeByToken, publishChargeLink } from '../../src/public/services/public-link';
import { createFakePaymentLinkProvider } from '../../src/vendors/infinitepay/fake';
import { charges, cleanupUsers, contacts, createOnceCharge, createUser, db, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = '99999999-9999-4999-8999-999999999991';
const PAYER = '99999999-9999-4999-8999-999999999992';
const SECRET = 'native-ez4-test-public-link-secret';

describe('InfinitePay charges', () => {
  let chargeId: string;

  before(async () => {
    await createUser(db, { id: OWNER, email: 'ip-owner@example.com', name: 'Dona Loja' });
    await createUser(db, { id: PAYER, email: 'ip-payer@example.com', name: 'Ana Paga' });

    const person = await contacts.create(OWNER, { name: 'Ana', email: 'ip-payer@example.com' });
    const method = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: '$Minha.Loja' });
    const { context } = fakeNotice();

    equal(method.value, 'minha.loja');
    equal(method.kind, null);

    chargeId = (await createOnceCharge(db, OWNER, 'ip-1', { userId: person.userId, amountCents: 4_200, dueDate: '2026-01-01', paymentMethodId: method.id }, context)).chargeId;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYER]));

  it('freezes the provider on the charge and creates the checkout link after the commit', async () => {
    const detail = await charges.get(OWNER, chargeId);

    equal(detail.payment?.provider, PaymentProvider.InfinitePay);
    equal(detail.payment?.value, 'minha.loja');
    equal(detail.paymentLink?.state, PaymentLinkState.Ready);
    ok(detail.paymentLink?.url?.includes(`/dev/infinitepay/${chargeId}`));
    equal((await EventRepository.list(db, chargeId, 'charge.payment_link.created')).length, 1);
  });

  it('shows the link on the public page', async () => {
    const link = await publishChargeLink(db, OWNER, chargeId, SECRET);
    const view = await publicChargeByToken(db, link.token, SECRET);

    equal(view.payment?.provider, PaymentProvider.InfinitePay);
    equal(view.paymentLink?.state, PaymentLinkState.Ready);
  });

  it('settles through payment_check once and replays after', async () => {
    const links = createFakePaymentLinkProvider('https://receivy.example');
    const notices = { transport: fakeNotice().sent.transport, origin: 'https://receivy.example' };
    const input = { chargeId, transactionNsu: 'tx-1', slug: 'inv-1', receiptUrl: 'https://receipt/1' };

    equal(await settleByProvider(db, links, notices, input), 'settled');
    equal(await settleByProvider(db, links, notices, input), 'replayed');

    const detail = await charges.get(OWNER, chargeId);

    equal(detail.state, ChargeState.Paid);
    equal(detail.receiptUrl, 'https://receipt/1');
    equal((await EventRepository.list(db, chargeId, 'charge.paid'))[0]?.payload['via'], 'provider');
  });

  it('refuses a contact-scoped InfinitePay method', async () => {
    const person = await contacts.create(OWNER, { name: 'Bia', email: 'ip-bia@example.com' });

    await rejects(paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: 'email', value: 'bia@example.com', contactId: person.id } as never));
  });
});
```

Ajustar o último teste ao que a API realmente recusa: a união `InfinitePayMethodInput` não tem `contactId`, então o caso "InfinitePay sob contato" é impossível pelo tipo; trocar o teste por "edita um método de contato para InfinitePay → 400" usando `paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'x' }, contactMethodId)` e `rejects(..., HttpBadRequestError)` (import `rejects` de `node:assert/strict` e `HttpBadRequestError` de `@ez4/gateway`; `contactMethodId` vem de `paymentMethods.save(OWNER, { provider: Pix, kind: Email, value: 'bia@example.com', contactId: person.id })`). Nota: o fake de link é por processo — `createOnceCharge` criou o link pelo `context.links` da fixture, e `settleByProvider` aqui usa outra instância do fake; ambas leem o mesmo `Map` de módulo, então o `payment_check` conhece o `order_nsu`.

- [ ] **Step 3: Rodar a integração**

Run: `pnpm --filter @receivy/api test:integration`
Expected: verde, exceto a 1 falha conhecida de baseline (`category`, ver memória). Se `contacts.create` tiver outra assinatura, copiar de `financial.spec.ts`.

---

### Task 12: Seed, smoke HTTP, OAS e docs

**Files:**
- Modify: `packages/api/scripts/seed-local.mjs:546-562`, `packages/api/scripts/financial-http-smoke.mjs:120-135`
- Modify: `docs/environments.md`, `docs/api-errors.md`, `docs/notifications.md`, `docs/deploy-guide.md`
- Generate: `docs/api-oas.yml`

- [ ] **Step 1: Seed**

Em `seed-local.mjs`, a linha `type: 'pix', pix_key_type: pix.type, pix_key: pix.key,` vira `provider: 'pix', kind: pix.type, value: pix.key,`. Onde o seed monta `payment_snapshot` para charges (grep `snapshot` no arquivo), a forma `{ method: 'pix', type, value, label }` vira `{ provider: 'pix', kind, value, label }`.

- [ ] **Step 2: Smoke**

Os dois `POST payment-methods` do smoke (`{ pixKeyType: 'cpf' }` → 400 e `{ pixKeyType: 'cpf', pixKey: '123' }` → 400) viram `{ provider: 'pix', kind: 'cpf' }` e `{ provider: 'pix', kind: 'cpf', value: '123' }`. Adicionar depois deles:

```js
  const infinitePay = await request('payment-methods', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'infinitepay', value: '$Smoke.Loja' })
  });

  assert.equal(infinitePay.status, 201);
  assert.equal(infinitePay.body.provider, 'infinitepay');
  assert.equal(infinitePay.body.value, 'smoke.loja');
  assert.equal((await request('webhooks/infinitepay/not-a-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
```

(o smoke sobe a API com `PAYMENT_LINK_TRANSPORT=fake`: conferir onde o script monta o env do `ez4 serve` e adicionar a variável).

- [ ] **Step 3: OAS**

Run: `pnpm --filter @receivy/api openapi:generate && pnpm --filter @receivy/api openapi:check`
Expected: `docs/api-oas.yml` atualizado com as três rotas novas e o `PaymentMethodBody` novo.

- [ ] **Step 4: Docs**

- `docs/environments.md`, lista da API: `PAYMENT_LINK_TRANSPORT` (`infinitepay` em dev/prd, `fake` local/test, `disabled` falha todo link) e `PUBLIC_API_ORIGIN` (origem pública da API; base do `webhook_url`; local = `http://127.0.0.1:3735/local-receivy-api`, que a InfinitePay não alcança — localmente o retorno do pagador e o `fake` fecham a cobrança). Tabela de ambientes: linha "Links de pagamento": local `fake`, dev/prd `InfinitePay`.
- `docs/api-errors.md`: seção "Meios de pagamento": `PAYMENT_METHOD_TAKEN` 409 (substitui `PIX_KEY_TAKEN`), `INFINITEPAY_CHECKOUT_DISABLED` 422 (`fields.redirectUrl` abre a configuração), `PAYMENT_LINK_UNAVAILABLE` 503 (sondagem do handle ou `provider-return` sem resposta da InfinitePay). Tabela de status ganha a linha `503 | ServiceUnavailableError subclasses | message`. Quotas: `POST /public/charges/{token}/provider-return` usa o bucket `public-read`.
- `docs/notifications.md`: `notice.skipped` ganha `reason: link_pending`; pushes diretos novos (`Link de pagamento não criado`, `Pagamento recebido pela InfinitePay`, `Pagamento confirmado`, `Valor divergente na InfinitePay`); eventos `charge.payment_link.created|failed`, `charge.provider.rejected|mismatch|ignored`, `charge.paid { via: 'provider' }`.
- `docs/deploy-guide.md`: seção "Meios de pagamento genéricos" com D1 (schema da Task 2) → `scripts/sql/2026-09-18-payment-methods-generic.sql` (rodar no `BEGIN/COMMIT`, conferir os dois contadores em zero) → D2 (resto) com `PAYMENT_LINK_TRANSPORT=infinitepay` e `PUBLIC_API_ORIGIN` definidos antes → D3 (follow-up: dropar `type`, `pix_key_type`, `pix_key`).

- [ ] **Step 5: Verificação final**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/api lint && pnpm --filter @receivy/api test`
Expected: `tsc` OK nos dois; `biome check` só com a contagem de baseline (~214, ver memória `receivy-verification-baselines`) mais zero novos erros nos arquivos tocados (`biome check <arquivo>` em cada arquivo novo deve estar limpo, exceto `lineWidth`, que já diverge no repo inteiro).

---

## Auto-revisão (feita ao escrever)

- **Cobertura da spec**: §1 dados (Tasks 1, 2, 4, 5), backfill (2), contratos (1); §2 vendor (3), `ensure` nos quatro pontos (7 announce/send, 8 view/endpoint), webhook (9), retorno (10), sondagem no save (4), `contact_id` + InfinitePay = 400 (4); §3 `link_pending`, pushes, rodapé (7, 9); §4 é o plano de UI; §5 testes (3, 4, 6, 9, 11, 12); §6 deploy (2, 12); §7 docs (12).
- **Nomes**: `paymentSnapshot` (materialize), `MethodSnapshot` (repository), `PaymentSnapshotColumns` (columns), `PaymentSnapshot` (common) — três formas do mesmo dado, cada uma na camada certa; `snapshotDto` converte colunas → contrato. `byValue` substitui `byKey` em service e specs. `ensurePaymentLink`, `settleByProvider`, `paymentLinkProvider`, `paymentLinkConfigFrom`, `webhookToken` usados com a mesma assinatura em 6, 7, 8, 9, 10, 11.
- **Fora**: D3, UI, `paymentLabel` (vai para o plano de UI, onde os rótulos existem).
