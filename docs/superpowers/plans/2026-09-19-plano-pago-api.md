# Plano pago (Stripe) — API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plano Básico mensal via Stripe (Payment Element, sem Checkout/Portal): tabela `subscriptions`, plano derivado, limites de indefinidas a receber e de links de pagamento, endpoints de assinar/gerir, webhook que relê a assinatura, downgrade que pausa excedentes, spec de integração e docs.

**Architecture:** `plans/` é um domínio novo (endpoints, repositório, serviços, rotas, provider). O plano efetivo é `planOf(subscription, now)` em `@receivy/common`, nunca gravado no usuário. As checagens de limite são funções de módulo (`plans/services/limits.ts`) chamadas dentro das transações existentes de `createBilling`, `patchBilling` e `save` de meios de pagamento, depois do `AccountRepository.lock`. O vendor `vendors/stripe/` embrulha o SDK `stripe` em uniões de resultado; `fake` responde em processo. O webhook e o modo fake convergem em `syncSubscription`, que relê a assinatura no Stripe, grava o estado, e dispara downgrade/avisos nas transições.

**Tech Stack:** EZ4 0.53 (gateway/database/factory), `stripe` SDK v19 (API `2025-03-31.basil`: client secret em `latest_invoice.confirmation_secret`, `current_period_end` em `items.data[0]`, `subscriptions.cancel`), vitest (unit), `@ez4/project test` (integração), Neon/Postgres.

**Spec:** `docs/superpowers/specs/2026-09-19-plano-pago-stripe-design.md`

## Global Constraints

- Grátis: `{ indefinite: 5, checkoutLinks: false }`; Básico: `{ indefinite: 30, checkoutLinks: true }`.
- Contam só billings do dono com `recurrence = indefinite`, `state = active`, `kind = live`, `contact_id` nulo (a receber).
- `planOf`: `basic` se `status ∈ { active, past_due }` e (`currentPeriodEnd` nulo ou `> now`); senão `free`.
- Erros: 402 `PLAN_LIMIT_REACHED` (context `{ limit, used, plan }`, mensagem "Você já tem N cobranças indefinidas ativas no plano X."), 402 `PLAN_REQUIRED` ("Links de pagamento fazem parte do plano Básico."), 409 `PLAN_ALREADY_ACTIVE`, 503 `PLAN_BILLING_DISABLED`, 503 `PLAN_UNAVAILABLE`.
- Downgrade só na transição `basic → free` observada por `syncSubscription`; nunca no lançamento. Pausa: indefinidas a receber ativas acima de 5 (mais recentes primeiro) e toda billing ativa cujo método é InfinitePay/PagBank. Evento `billing.paused { reason: 'plan' }`. Nada reativa sozinho.
- Webhook: corpo cru (`body: string`), `stripe-signature`, `constructEvent` do SDK; assinatura inválida → 400 sem gravar; nunca confia no payload (relê `getSubscription`); `event.id === last_event_id` → replay; erro de banco/Stripe → 500.
- Envs: `PLAN_BILLING = live | fake | disabled` (default `disabled`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC` (defaults `disabled`), sempre com `VariableOrValue` + entrada em `ez4.project.js`.
- Segredos: `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` nunca em logs, eventos ou respostas.
- Estilo: braces em todo bloco; linha em branco quando muda o tipo de statement; early return; `const enum` (API) / `const enum` também em common (arquivo `domain/plan.ts` novo, segue o estilo dominante de `billing.ts`); `export namespace XRepository` com selects inline; nunca `biome --write`; diffs mínimos.
- Deploy/migração: nada manual (EZ4 cria `subscriptions`); `docs/deploy-guide.md` não é tocado.
- Desvio da spec, decidido aqui: as checagens são funções de módulo (`limits.ts`), não um `PlanService` injetado em `BillingService`/`PaymentMethodService` (só precisam de `tx`). Spec §4 linha "editar billing para indefinite" não existe na API (`BillingPatch` não tem `recurrence`): sem task. `disabled` é 503 no serviço (`GET /plan` continua respondendo o plano grátis e o uso). Eventos de plano usam `EventableType.Account` com `eventable_id = ownerId`.

---

### Task 1: Contratos e `planOf` em `@receivy/common`

**Files:**
- Create: `packages/common/src/domain/plan.ts`, `packages/common/src/domain/plan.test.ts`
- Modify: `packages/common/src/index.ts` (exportar `./domain/plan`)

**Interfaces:**
- Produces: `PlanTier`, `SubscriptionProvider`, `SubscriptionStatus`, `PlanLimits`, `PLAN_LIMITS`, `SubscriptionSnapshot`, `planOf(snapshot, now)`, `PlanSummary`, `PlanInvoice`, `SubscribeResult`, `SetupResult`.

- [ ] **Step 1: Teste**

```ts
// packages/common/src/domain/plan.test.ts
import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, PlanTier, planOf, SubscriptionStatus } from './plan';

const NOW = new Date('2026-09-19T12:00:00Z');

describe('planOf', () => {
  it('is free without a subscription', () => {
    expect(planOf(null, NOW)).toBe(PlanTier.Free);
  });

  it('is basic while active or past due inside the paid period', () => {
    expect(planOf({ status: SubscriptionStatus.Active, currentPeriodEnd: '2026-10-19T12:00:00Z' }, NOW)).toBe(PlanTier.Basic);
    expect(planOf({ status: SubscriptionStatus.PastDue, currentPeriodEnd: '2026-10-19T12:00:00Z' }, NOW)).toBe(PlanTier.Basic);
    expect(planOf({ status: SubscriptionStatus.Active, currentPeriodEnd: null }, NOW)).toBe(PlanTier.Basic);
  });

  it('falls back to free once the paid period is over or the subscription is not live', () => {
    expect(planOf({ status: SubscriptionStatus.PastDue, currentPeriodEnd: '2026-09-19T11:59:59Z' }, NOW)).toBe(PlanTier.Free);
    expect(planOf({ status: SubscriptionStatus.Canceled, currentPeriodEnd: '2026-10-19T12:00:00Z' }, NOW)).toBe(PlanTier.Free);
    expect(planOf({ status: SubscriptionStatus.Incomplete, currentPeriodEnd: null }, NOW)).toBe(PlanTier.Free);
  });

  it('keeps the limits the spec fixed', () => {
    expect(PLAN_LIMITS[PlanTier.Free]).toEqual({ indefinite: 5, checkoutLinks: false });
    expect(PLAN_LIMITS[PlanTier.Basic]).toEqual({ indefinite: 30, checkoutLinks: true });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @receivy/common exec vitest run src/domain/plan.test.ts` → falha por módulo ausente.

- [ ] **Step 3: Implementar**

```ts
// packages/common/src/domain/plan.ts
export const enum PlanTier {
  Free = 'free',
  Basic = 'basic'
}

export const enum SubscriptionProvider {
  Stripe = 'stripe'
}

/** Mirrors the provider's own states, collapsed to what the plan needs. */
export const enum SubscriptionStatus {
  Incomplete = 'incomplete',
  Active = 'active',
  PastDue = 'past_due',
  Canceled = 'canceled'
}

export type PlanLimits = { indefinite: number; checkoutLinks: boolean };

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  [PlanTier.Free]: { indefinite: 5, checkoutLinks: false },
  [PlanTier.Basic]: { indefinite: 30, checkoutLinks: true }
};

export type SubscriptionSnapshot = { status: SubscriptionStatus; currentPeriodEnd: string | null };

/** The plan in force: paid while the subscription is live and the paid period has not ended. Never stored. */
export function planOf(subscription: SubscriptionSnapshot | null, now: Date): PlanTier {
  if (!subscription) {
    return PlanTier.Free;
  }

  const live = subscription.status === SubscriptionStatus.Active || subscription.status === SubscriptionStatus.PastDue;

  if (!live) {
    return PlanTier.Free;
  }

  if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() <= now.getTime()) {
    return PlanTier.Free;
  }

  return PlanTier.Basic;
}

export type PlanUsage = { indefinite: { used: number; limit: number } };

export type PlanCard = { brand: string; last4: string };

export type PlanSummary = {
  plan: PlanTier;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: PlanUsage;
  checkoutLinks: boolean;
  card: PlanCard | null;
};

export type PlanInvoice = { id: string; amountCents: number; status: string; paidAt: string | null; pdfUrl: string | null };

export type SubscribeResult = { clientSecret: string };

export type SetupResult = { clientSecret: string };
```

Em `packages/common/src/index.ts` acrescentar `export * from './domain/plan';` na posição alfabética entre os outros `./domain/*`.

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/common exec vitest run src/domain/plan.test.ts` verde; `pnpm --filter @receivy/common lint` (tsc limpo; biome só baseline).

---

### Task 2: Erro 402, tabela `subscriptions` e repositório

**Files:**
- Modify: `packages/api/src/common/errors.ts` (classe base 402), `packages/api/src/api.ts` (`402:` e `503:` em `httpErrors`; `409` ganha `PlanAlreadyActiveError`), `packages/api/src/database.ts` (tabela)
- Create: `packages/api/src/plans/errors.ts`, `packages/api/src/plans/schemas/subscription.ts`, `packages/api/src/plans/repositories/subscription.ts`, `packages/api/src/plans/repositories/subscription.test.ts`

**Interfaces:**
- Produces: `PaymentRequiredError` (base 402); `PlanLimitReachedError(limit, used, plan)`, `PlanRequiredError`, `PlanAlreadyActiveError`, `PlanBillingDisabledError`, `PlanUnavailableError`; `SubscriptionSchema`; `SubscriptionRepository.{Row, get, bySubscriptionId, insert, setSubscription, applyState, snapshotOf}`.

- [ ] **Step 1: Teste do repositório (mock de `db`, padrão de `charges/services/settle.test.ts`)**

```ts
// packages/api/src/plans/repositories/subscription.test.ts
import { PlanTier, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionRepository } from './subscription';

function dbWith(row: Partial<SubscriptionRepository.Row> | null) {
  return {
    subscriptions: {
      findOne: vi.fn(async () => row),
      insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, owner_id: (data.owner as { id: string }).id })),
      updateOne: vi.fn(async () => ({ id: 'sub-row' }))
    }
  } as never;
}

describe('SubscriptionRepository', () => {
  it('inserts an incomplete basic row bound to the owner and customer', async () => {
    const db = dbWith(null);
    const row = await SubscriptionRepository.insert(db, { ownerId: 'o1', customerId: 'cus_1', now: '2026-09-19T00:00:00.000Z' });

    expect(row).toMatchObject({ owner_id: 'o1', provider: SubscriptionProvider.Stripe, stripe_customer_id: 'cus_1', plan: PlanTier.Basic, status: SubscriptionStatus.Incomplete, cancel_at_period_end: false });
  });

  it('applies the provider state and the event watermark in one update', async () => {
    const db = dbWith(null);

    await SubscriptionRepository.applyState(db, 'row-1', { status: SubscriptionStatus.Active, currentPeriodEnd: '2026-10-19T00:00:00.000Z', cancelAtPeriodEnd: false, eventId: 'evt_1', eventAt: '2026-09-19T00:00:01.000Z', now: '2026-09-19T00:00:02.000Z' });

    expect((db as never as { subscriptions: { updateOne: ReturnType<typeof vi.fn> } }).subscriptions.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z', last_event_id: 'evt_1' }) })
    );
  });

  it('maps a row to the snapshot planOf reads', () => {
    expect(SubscriptionRepository.snapshotOf({ status: SubscriptionStatus.PastDue, current_period_end: '2026-10-01T00:00:00.000Z' } as SubscriptionRepository.Row)).toEqual({ status: SubscriptionStatus.PastDue, currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
    expect(SubscriptionRepository.snapshotOf(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Base 402 e erros**

Em `packages/api/src/common/errors.ts`, depois de `ForbiddenError`:

```ts
export abstract class PaymentRequiredError extends ApiError {
  readonly status = 402;
}
```

```ts
// packages/api/src/plans/errors.ts
import type { PlanTier } from '@receivy/common';
import { ConflictError, PaymentRequiredError, ServiceUnavailableError } from '../common/errors';

const PLAN_NAMES: Record<PlanTier, string> = { free: 'Grátis', basic: 'Básico' } as Record<PlanTier, string>;

export class PlanLimitReachedError extends PaymentRequiredError {
  constructor(limit: number, used: number, plan: PlanTier) {
    super(`Você já tem ${used} cobranças indefinidas ativas no plano ${PLAN_NAMES[plan]}.`, 'PLAN_LIMIT_REACHED', { limit: String(limit), used: String(used), plan });
  }
}

export class PlanRequiredError extends PaymentRequiredError {
  constructor(message = 'Links de pagamento fazem parte do plano Básico.') {
    super(message, 'PLAN_REQUIRED');
  }
}

export class PlanAlreadyActiveError extends ConflictError {
  constructor(message = 'Você já tem um plano ativo.') {
    super(message, 'PLAN_ALREADY_ACTIVE');
  }
}

export class PlanBillingDisabledError extends ServiceUnavailableError {
  constructor(message = 'Assinaturas não estão disponíveis neste ambiente.') {
    super(message, 'PLAN_BILLING_DISABLED');
  }
}

export class PlanUnavailableError extends ServiceUnavailableError {
  constructor(message = 'Não deu para falar com o Stripe agora. Tente de novo em instantes.') {
    super(message, 'PLAN_UNAVAILABLE');
  }
}
```

(`ApiError` só aceita `fields: Record<string, string>` como contexto; por isso `limit`/`used` viajam como string. O web converte.)

Em `api.ts`: `import type { PlanAlreadyActiveError, PlanBillingDisabledError, PlanLimitReachedError, PlanRequiredError, PlanUnavailableError } from './plans/errors';` e em `httpErrors`: `402: [PlanLimitReachedError, PlanRequiredError];` (chave nova, antes de `403`), `PlanAlreadyActiveError` no fim da lista `409`, `PlanBillingDisabledError, PlanUnavailableError` no fim da lista `503`.

- [ ] **Step 4: Schema, tabela e repositório**

```ts
// packages/api/src/plans/schemas/subscription.ts
import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { PlanTier, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';

/** One paid subscription per owner; the plan in force is derived from `status` + `current_period_end`, never stored. */
export interface SubscriptionSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  provider: SubscriptionProvider;
  stripe_customer_id: String.Max<64>;
  /** Null after a cancel until the owner subscribes again. */
  stripe_subscription_id?: String.Max<64>;
  plan: PlanTier;
  status: SubscriptionStatus;
  current_period_end?: String.DateTime;
  cancel_at_period_end: boolean;
  /** Webhook idempotency: the last Stripe event applied, and when Stripe created it. */
  last_event_id?: String.Max<64>;
  last_event_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
```

Em `database.ts`: `import type { SubscriptionSchema } from './plans/schemas/subscription';` e, logo depois da tabela `payment_methods`:

```ts
Database.UseTable<{
  name: 'subscriptions';
  schema: SubscriptionSchema;
  relations: { 'owner_id@owner': 'users:id' };
  indexes: {
    id: Index.Primary;
    owner_id: Index.Unique;
    stripe_subscription_id: Index.Secondary;
  };
}>,
```

```ts
// packages/api/src/plans/repositories/subscription.ts
import { PlanTier, type SubscriptionSnapshot, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';
import type { DbClient } from '../../database';

const sqlNull = null as unknown as undefined;

export namespace SubscriptionRepository {
  export type Row = {
    id: string;
    owner_id: string;
    provider: SubscriptionProvider;
    stripe_customer_id: string;
    stripe_subscription_id?: string;
    plan: PlanTier;
    status: SubscriptionStatus;
    current_period_end?: string;
    cancel_at_period_end: boolean;
    last_event_id?: string;
    last_event_at?: string;
    created_at: string;
    updated_at: string;
  };

  export async function get(db: DbClient, ownerId: string, lock = false): Promise<Row | null> {
    const row = await db.subscriptions.findOne({
      select: { id: true, owner_id: true, provider: true, stripe_customer_id: true, stripe_subscription_id: true, plan: true, status: true, current_period_end: true, cancel_at_period_end: true, last_event_id: true, last_event_at: true, created_at: true, updated_at: true },
      where: { owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  export async function bySubscriptionId(db: DbClient, stripeSubscriptionId: string, lock = false): Promise<Row | null> {
    const row = await db.subscriptions.findOne({
      select: { id: true, owner_id: true, provider: true, stripe_customer_id: true, stripe_subscription_id: true, plan: true, status: true, current_period_end: true, cancel_at_period_end: true, last_event_id: true, last_event_at: true, created_at: true, updated_at: true },
      where: { stripe_subscription_id: stripeSubscriptionId },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  /** First contact with Stripe: the customer exists, the subscription does not yet. */
  export async function insert(db: DbClient, input: { ownerId: string; customerId: string; now: string }): Promise<Row> {
    return db.subscriptions.insertOne({
      select: { id: true, owner_id: true, provider: true, stripe_customer_id: true, stripe_subscription_id: true, plan: true, status: true, current_period_end: true, cancel_at_period_end: true, last_event_id: true, last_event_at: true, created_at: true, updated_at: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        provider: SubscriptionProvider.Stripe,
        stripe_customer_id: input.customerId,
        plan: PlanTier.Basic,
        status: SubscriptionStatus.Incomplete,
        cancel_at_period_end: false,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  /** A new Stripe subscription replaces whatever the row pointed at (a canceled one, or nothing). */
  export async function setSubscription(db: DbClient, id: string, input: { stripeSubscriptionId: string | null; status: SubscriptionStatus; now: string }): Promise<void> {
    await db.subscriptions.updateOne({
      select: { id: true },
      where: { id },
      data: { stripe_subscription_id: input.stripeSubscriptionId ?? sqlNull, status: input.status, current_period_end: sqlNull, cancel_at_period_end: false, last_event_id: sqlNull, last_event_at: sqlNull, updated_at: input.now }
    });
  }

  export async function applyState(db: DbClient, id: string, input: { status: SubscriptionStatus; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; eventId: string | null; eventAt: string | null; now: string }): Promise<void> {
    await db.subscriptions.updateOne({
      select: { id: true },
      where: { id },
      data: {
        status: input.status,
        current_period_end: input.currentPeriodEnd ?? sqlNull,
        cancel_at_period_end: input.cancelAtPeriodEnd,
        ...(input.eventId ? { last_event_id: input.eventId } : {}),
        ...(input.eventAt ? { last_event_at: input.eventAt } : {}),
        updated_at: input.now
      }
    });
  }

  export function snapshotOf(row: Row | null): SubscriptionSnapshot | null {
    return row ? { status: row.status, currentPeriodEnd: row.current_period_end ?? null } : null;
  }
}
```

- [ ] **Step 5: Verificar** — `pnpm --filter @receivy/api exec vitest run src/plans --pool=forks` verde; `pnpm --filter @receivy/api check-types` e `check-types:test` sem erros.

---

### Task 3: Limites — contagem, asserções e os três ganchos

**Files:**
- Modify: `packages/api/src/billings/repositories/billing.ts` (`countActiveIndefinite`), `packages/api/src/billings/services/billing.ts` (`createBilling`, `patchBilling`), `packages/api/src/payment-methods/services/payment-method.ts` (`save`)
- Create: `packages/api/src/plans/services/limits.ts`, `packages/api/src/plans/services/limits.test.ts`

**Interfaces:**
- Consumes: `SubscriptionRepository.get/snapshotOf` (T2), `planOf`/`PLAN_LIMITS` (T1), `PlanLimitReachedError`/`PlanRequiredError` (T2).
- Produces: `BillingRepository.countActiveIndefinite(db, ownerId): Promise<number>`; `limitsOf(db, ownerId, now): Promise<{ plan: PlanTier; limits: PlanLimits; used: number }>`; `assertCanCreateIndefinite(db, ownerId, now)`; `assertCheckoutLinksAllowed(db, ownerId, now)`.

- [ ] **Step 1: Testes**

```ts
// packages/api/src/plans/services/limits.test.ts
import { PaymentProvider, PlanTier, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { PlanLimitReachedError, PlanRequiredError } from '../errors';
import { assertCanCreateIndefinite, assertCheckoutLinksAllowed, limitsOf } from './limits';

const NOW = new Date('2026-09-19T12:00:00Z');

function dbWith(subscription: Record<string, unknown> | null, used: number) {
  return { subscriptions: { findOne: vi.fn(async () => subscription) }, billings: { count: vi.fn(async () => used) } } as never;
}

describe('plan limits', () => {
  it('reads free limits without a subscription', async () => {
    expect(await limitsOf(dbWith(null, 2), 'o1', NOW)).toEqual({ plan: PlanTier.Free, limits: { indefinite: 5, checkoutLinks: false }, used: 2 });
  });

  it('lets the fifth indefinite through and refuses the sixth on free', async () => {
    await expect(assertCanCreateIndefinite(dbWith(null, 4), 'o1', NOW)).resolves.toBeUndefined();
    await expect(assertCanCreateIndefinite(dbWith(null, 5), 'o1', NOW)).rejects.toBeInstanceOf(PlanLimitReachedError);
  });

  it('raises the ceiling to 30 while the subscription is live', async () => {
    const live = { status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z' };

    await expect(assertCanCreateIndefinite(dbWith(live, 29), 'o1', NOW)).resolves.toBeUndefined();
    await expect(assertCanCreateIndefinite(dbWith(live, 30), 'o1', NOW)).rejects.toMatchObject({ context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '30', used: '30', plan: PlanTier.Basic } } });
  });

  it('gates checkout links on the plan', async () => {
    await expect(assertCheckoutLinksAllowed(dbWith(null, 0), 'o1', NOW)).rejects.toBeInstanceOf(PlanRequiredError);
    await expect(assertCheckoutLinksAllowed(dbWith({ status: SubscriptionStatus.PastDue, current_period_end: '2026-10-19T00:00:00.000Z' }, 0), 'o1', NOW)).resolves.toBeUndefined();
  });

  it('never queries the count for the link gate', async () => {
    const db = dbWith(null, 0);

    await assertCheckoutLinksAllowed(db, 'o1', NOW).catch(() => undefined);

    expect((db as never as { billings: { count: ReturnType<typeof vi.fn> } }).billings.count).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Repositório e serviço**

Em `BillingRepository` (namespace), depois de `activeIndefiniteIds`:

```ts
  /** What the plan counts: the owner's live, active, receivable assinaturas. */
  export async function countActiveIndefinite(db: DbClient, ownerId: string): Promise<number> {
    return db.billings.count({
      where: { owner_id: ownerId, recurrence: BillingRecurrence.Indefinite, state: BillingState.Active, kind: BillingKind.Live, contact_id: { isNull: true } }
    });
  }
```

(Importar `BillingKind` de `@receivy/common` se o arquivo ainda não importa.)

```ts
// packages/api/src/plans/services/limits.ts
import { PLAN_LIMITS, type PlanLimits, type PlanTier, planOf } from '@receivy/common';
import { BillingRepository } from '../../billings/repositories/billing';
import type { DbClient } from '../../database';
import { PlanLimitReachedError, PlanRequiredError } from '../errors';
import { SubscriptionRepository } from '../repositories/subscription';

export async function planOfOwner(db: DbClient, ownerId: string, now: Date): Promise<PlanTier> {
  return planOf(SubscriptionRepository.snapshotOf(await SubscriptionRepository.get(db, ownerId)), now);
}

export async function limitsOf(db: DbClient, ownerId: string, now: Date): Promise<{ plan: PlanTier; limits: PlanLimits; used: number }> {
  const plan = await planOfOwner(db, ownerId, now);
  const used = await BillingRepository.countActiveIndefinite(db, ownerId);

  return { plan, limits: PLAN_LIMITS[plan], used };
}

/** Call inside the owner's transaction, after `AccountRepository.lock`: the count and the insert share the lock. */
export async function assertCanCreateIndefinite(db: DbClient, ownerId: string, now: Date): Promise<void> {
  const { plan, limits, used } = await limitsOf(db, ownerId, now);

  if (used + 1 > limits.indefinite) {
    throw new PlanLimitReachedError(limits.indefinite, used, plan);
  }
}

export async function assertCheckoutLinksAllowed(db: DbClient, ownerId: string, now: Date): Promise<void> {
  const plan = await planOfOwner(db, ownerId, now);

  if (!PLAN_LIMITS[plan].checkoutLinks) {
    throw new PlanRequiredError();
  }
}
```

- [ ] **Step 4: Ganchos**

`billings/services/billing.ts`, `createBilling`, logo depois do bloco `if (input.recurrence === BillingRecurrence.Indefinite && input.startDate < today) { throw new RangeError(...) }`:

```ts
    if (input.recurrence === BillingRecurrence.Indefinite && !input.contactId && input.kind !== BillingKind.Record) {
      await assertCanCreateIndefinite(tx, ownerId, now);
    }
```

`patchBilling`, logo depois de `const resumed = patch.state === BillingState.Active && row.state === BillingState.Paused;`:

```ts
    if (resumed && row.recurrence === BillingRecurrence.Indefinite && !row.contact_id && row.kind !== BillingKind.Record) {
      await assertCanCreateIndefinite(tx, ownerId, now);
    }
```

Import: `import { assertCanCreateIndefinite } from '../../plans/services/limits';` (sem ciclo: `plans/services/limits` importa só `billings/repositories/billing`, nunca o serviço).

`payment-methods/services/payment-method.ts`, `save`: no topo, antes dos ramos por provider, e movendo a leitura de `existing` que hoje mora dentro do ramo PagBank para cá (o ramo passa a reutilizá-la):

```ts
  const existing = id ? await PaymentMethodRepository.get(db, ownerId, id) : null;

  if (id && (!existing || existing.archivedAt)) {
    throw new HttpNotFoundError();
  }

  if (input.provider !== PaymentProvider.Pix && existing?.provider !== input.provider) {
    await assertCheckoutLinksAllowed(db, ownerId, new Date());
  }
```

(Editar o rótulo de um método InfinitePay/PagBank já existente continua permitido no Grátis; criar um, ou virar um Pix nele, não.)

- [ ] **Step 5: Verificar** — `pnpm --filter @receivy/api exec vitest run src/plans src/billings src/payment-methods --pool=forks` verde; `check-types`; `pnpm --filter @receivy/api test:integration` (só `account-concurrency` baseline; `financial.spec.ts` e `pagseguro.spec.ts` continuam verdes — nenhum deles cria 6 indefinidas nem, em `pagseguro.spec.ts`, deixa de ter plano... **atenção:** `pagseguro.spec.ts` e `infinitepay.spec.ts` criam métodos InfinitePay/PagBank sem assinatura e agora recebem 402. Ruling: esses specs ganham, no `before`, uma linha `subscriptions` ativa para o `OWNER` via `SubscriptionRepository.insert` + `applyState({ status: Active, currentPeriodEnd: null })` — adicione o helper `grantBasicPlan(db, ownerId)` em `test/fixtures/financial.ts` e chame-o nos dois specs. O smoke `scripts/financial-http-smoke.mjs` cria métodos InfinitePay/PagBank via HTTP: insira a mesma linha por `psql` logo após o INSERT do usuário fixture (`INSERT INTO subscriptions (id,owner_id,provider,stripe_customer_id,plan,status,cancel_at_period_end,created_at,updated_at) VALUES ('71111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','stripe','cus_smoke','basic','active',false,now(),now())`).

---

### Task 4: Vendor Stripe (SDK) e fake

**Files:**
- Modify: `packages/api/package.json` (dependência `stripe` — aprovada pelo dono; `pnpm --filter @receivy/api add stripe@^19`)
- Create: `packages/api/src/vendors/stripe/types.ts`, `client.ts`, `client.test.ts`, `fake.ts`, `fake.test.ts`

**Interfaces:**
- Produces: `StripeClient` (abaixo), `createStripeClient(secretKey, sdk?)`, `fakeStripe()`, `fakeStripeSetStatus(subscriptionId, status)` (test-only), `StripeSubscriptionState`.

- [ ] **Step 1: Tipos**

```ts
// packages/api/src/vendors/stripe/types.ts
import type { PlanCard, PlanInvoice, SubscriptionStatus } from '@receivy/common';

export type StripeSubscriptionState = {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type StripeCustomerResult = { status: 'ok'; customerId: string } | { status: 'unavailable' };
export type StripeSubscribeResult = { status: 'ok'; subscriptionId: string; clientSecret: string } | { status: 'unavailable' };
export type StripeSubscriptionResult = { status: 'ok'; subscription: StripeSubscriptionState } | { status: 'not_found' } | { status: 'unavailable' };
export type StripeSetupResult = { status: 'ok'; clientSecret: string } | { status: 'unavailable' };
export type StripeDoneResult = { status: 'ok' } | { status: 'unavailable' };
export type StripeCardResult = { status: 'ok'; card: PlanCard | null } | { status: 'unavailable' };
export type StripeInvoicesResult = { status: 'ok'; invoices: PlanInvoice[] } | { status: 'unavailable' };
export type StripeEvent = { id: string; type: string; created: string; subscriptionId: string | null };
export type StripeEventResult = { status: 'ok'; event: StripeEvent } | { status: 'invalid' };

/** Every method answers a result union; the SDK's exceptions never escape this boundary. */
export interface StripeClient {
  createCustomer(input: { ownerId: string; email?: string; name?: string }): Promise<StripeCustomerResult>;
  createSubscription(input: { customerId: string; priceId: string }): Promise<StripeSubscribeResult>;
  getSubscription(subscriptionId: string): Promise<StripeSubscriptionResult>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<StripeSubscriptionResult>;
  createSetupIntent(customerId: string): Promise<StripeSetupResult>;
  setDefaultPaymentMethod(input: { customerId: string; subscriptionId: string | null; paymentMethodId: string }): Promise<StripeDoneResult>;
  defaultCard(customerId: string): Promise<StripeCardResult>;
  listInvoices(customerId: string, limit: number): Promise<StripeInvoicesResult>;
  constructEvent(rawBody: string, signature: string | undefined, secret: string): StripeEventResult;
}
```

- [ ] **Step 2: Teste do client com SDK injetado**

```ts
// packages/api/src/vendors/stripe/client.test.ts
import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { createStripeClient } from './client';

const PERIOD_END = 1_792_000_000;

function sdkWith(overrides: Record<string, unknown> = {}) {
  return {
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })), retrieve: vi.fn(async () => ({ id: 'cus_1', invoice_settings: { default_payment_method: { card: { brand: 'visa', last4: '4242' } } } })), update: vi.fn(async () => ({})) },
    subscriptions: {
      create: vi.fn(async () => ({ id: 'sub_1', latest_invoice: { confirmation_secret: { client_secret: 'pi_secret' } } })),
      retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: PERIOD_END }] } })),
      update: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, items: { data: [{ current_period_end: PERIOD_END }] } }))
    },
    setupIntents: { create: vi.fn(async () => ({ client_secret: 'seti_secret' })) },
    invoices: { list: vi.fn(async () => ({ data: [{ id: 'in_1', amount_paid: 1990, status: 'paid', status_transitions: { paid_at: PERIOD_END }, invoice_pdf: 'https://stripe.example/in_1.pdf' }] })) },
    webhooks: { constructEvent: vi.fn(() => ({ id: 'evt_1', type: 'customer.subscription.updated', created: PERIOD_END, data: { object: { object: 'subscription', id: 'sub_1' } } })) },
    ...overrides
  } as never;
}

describe('createStripeClient', () => {
  it('creates a subscription that waits for the first payment and returns its client secret', async () => {
    const sdk = sdkWith();
    const client = createStripeClient('sk_test', sdk);

    expect(await client.createSubscription({ customerId: 'cus_1', priceId: 'price_1' })).toEqual({ status: 'ok', subscriptionId: 'sub_1', clientSecret: 'pi_secret' });
    expect((sdk as never as { subscriptions: { create: ReturnType<typeof vi.fn> } }).subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', items: [{ price: 'price_1' }], payment_behavior: 'default_incomplete', expand: ['latest_invoice.confirmation_secret'] })
    );
  });

  it('reads the period end from the subscription item and maps statuses', async () => {
    const client = createStripeClient('sk_test', sdkWith());

    expect(await client.getSubscription('sub_1')).toEqual({ status: 'ok', subscription: { id: 'sub_1', customerId: 'cus_1', status: SubscriptionStatus.Active, currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(), cancelAtPeriodEnd: false } });
  });

  it('maps unpaid to past_due and incomplete_expired to canceled', async () => {
    const unpaid = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'unpaid', cancel_at_period_end: false, items: { data: [] } })) } }));
    const expired = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'incomplete_expired', cancel_at_period_end: false, items: { data: [] } })) } }));

    expect((await unpaid.getSubscription('sub_1')) as { subscription: { status: string } }).toMatchObject({ subscription: { status: SubscriptionStatus.PastDue, currentPeriodEnd: null } });
    expect((await expired.getSubscription('sub_1')) as { subscription: { status: string } }).toMatchObject({ subscription: { status: SubscriptionStatus.Canceled } });
  });

  it('answers not_found on a missing subscription and unavailable on any other failure', async () => {
    const missing = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => { throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' }); }) } }));
    const down = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => { throw new Error('ECONNRESET'); }) } }));

    expect(await missing.getSubscription('sub_x')).toEqual({ status: 'not_found' });
    expect(await down.getSubscription('sub_1')).toEqual({ status: 'unavailable' });
  });

  it('constructs a verified event and finds the subscription id on subscription and invoice objects', () => {
    const client = createStripeClient('sk_test', sdkWith());
    const invoiceSdk = sdkWith({ webhooks: { constructEvent: vi.fn(() => ({ id: 'evt_2', type: 'invoice.paid', created: PERIOD_END, data: { object: { object: 'invoice', id: 'in_1', parent: { subscription_details: { subscription: 'sub_9' } } } } })) } });

    expect(client.constructEvent('{}', 'sig', 'whsec')).toEqual({ status: 'ok', event: { id: 'evt_1', type: 'customer.subscription.updated', created: new Date(PERIOD_END * 1000).toISOString(), subscriptionId: 'sub_1' } });
    expect(createStripeClient('sk_test', invoiceSdk).constructEvent('{}', 'sig', 'whsec')).toMatchObject({ event: { subscriptionId: 'sub_9' } });
  });

  it('answers invalid when the signature does not verify or is missing', () => {
    const client = createStripeClient('sk_test', sdkWith({ webhooks: { constructEvent: vi.fn(() => { throw new Error('No signatures found'); }) } }));

    expect(client.constructEvent('{}', 'bad', 'whsec')).toEqual({ status: 'invalid' });
    expect(client.constructEvent('{}', undefined, 'whsec')).toEqual({ status: 'invalid' });
  });

  it('lists invoices as the client reads them and reads the default card', async () => {
    const client = createStripeClient('sk_test', sdkWith());

    expect(await client.listInvoices('cus_1', 12)).toEqual({ status: 'ok', invoices: [{ id: 'in_1', amountCents: 1990, status: 'paid', paidAt: new Date(PERIOD_END * 1000).toISOString(), pdfUrl: 'https://stripe.example/in_1.pdf' }] });
    expect(await client.defaultCard('cus_1')).toEqual({ status: 'ok', card: { brand: 'visa', last4: '4242' } });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar.**

- [ ] **Step 4: Client**

```ts
// packages/api/src/vendors/stripe/client.ts
import { SubscriptionStatus } from '@receivy/common';
import Stripe from 'stripe';
import type { StripeCardResult, StripeClient, StripeCustomerResult, StripeDoneResult, StripeEventResult, StripeInvoicesResult, StripeSetupResult, StripeSubscribeResult, StripeSubscriptionResult, StripeSubscriptionState } from './types';

/** Stripe's own states collapsed to the plan's: anything unpaid still counts as the paid period until it ends. */
function statusOf(status: string): SubscriptionStatus {
  if (status === 'active') {
    return SubscriptionStatus.Active;
  }

  if (status === 'past_due' || status === 'unpaid') {
    return SubscriptionStatus.PastDue;
  }

  if (status === 'canceled' || status === 'incomplete_expired') {
    return SubscriptionStatus.Canceled;
  }

  return SubscriptionStatus.Incomplete;
}

function isoOf(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

function stateOf(subscription: Stripe.Subscription): StripeSubscriptionState {
  const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  return {
    id: subscription.id,
    customerId: customer,
    status: statusOf(subscription.status),
    currentPeriodEnd: isoOf(subscription.items.data[0]?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'resource_missing';
}

/** The secret key only lives inside the SDK instance; errors never carry Stripe bodies into logs. */
export function createStripeClient(secretKey: string, sdk: Stripe = new Stripe(secretKey)): StripeClient {
  return {
    async createCustomer(input): Promise<StripeCustomerResult> {
      try {
        const customer = await sdk.customers.create({ ...(input.email ? { email: input.email } : {}), ...(input.name ? { name: input.name } : {}), metadata: { ownerId: input.ownerId } });

        return { status: 'ok', customerId: customer.id };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async createSubscription(input): Promise<StripeSubscribeResult> {
      try {
        const subscription = await sdk.subscriptions.create({
          customer: input.customerId,
          items: [{ price: input.priceId }],
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.confirmation_secret']
        });
        const invoice = subscription.latest_invoice;
        const clientSecret = invoice && typeof invoice !== 'string' ? invoice.confirmation_secret?.client_secret : undefined;

        if (!clientSecret) {
          return { status: 'unavailable' };
        }

        return { status: 'ok', subscriptionId: subscription.id, clientSecret };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async getSubscription(subscriptionId): Promise<StripeSubscriptionResult> {
      try {
        return { status: 'ok', subscription: stateOf(await sdk.subscriptions.retrieve(subscriptionId)) };
      } catch (error) {
        return isMissing(error) ? { status: 'not_found' } : { status: 'unavailable' };
      }
    },

    async setCancelAtPeriodEnd(subscriptionId, cancel): Promise<StripeSubscriptionResult> {
      try {
        return { status: 'ok', subscription: stateOf(await sdk.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel })) };
      } catch (error) {
        return isMissing(error) ? { status: 'not_found' } : { status: 'unavailable' };
      }
    },

    async createSetupIntent(customerId): Promise<StripeSetupResult> {
      try {
        const intent = await sdk.setupIntents.create({ customer: customerId, usage: 'off_session', automatic_payment_methods: { enabled: true, allow_redirects: 'never' } });

        return intent.client_secret ? { status: 'ok', clientSecret: intent.client_secret } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async setDefaultPaymentMethod(input): Promise<StripeDoneResult> {
      try {
        await sdk.customers.update(input.customerId, { invoice_settings: { default_payment_method: input.paymentMethodId } });

        if (input.subscriptionId) {
          await sdk.subscriptions.update(input.subscriptionId, { default_payment_method: input.paymentMethodId });
        }

        return { status: 'ok' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async defaultCard(customerId): Promise<StripeCardResult> {
      try {
        const customer = await sdk.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });

        if (customer.deleted) {
          return { status: 'ok', card: null };
        }

        const method = customer.invoice_settings.default_payment_method;
        const card = method && typeof method !== 'string' ? method.card : null;

        return { status: 'ok', card: card ? { brand: card.brand, last4: card.last4 } : null };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async listInvoices(customerId, limit): Promise<StripeInvoicesResult> {
      try {
        const page = await sdk.invoices.list({ customer: customerId, limit });

        return {
          status: 'ok',
          invoices: page.data.map((invoice) => ({ id: invoice.id, amountCents: invoice.amount_paid, status: invoice.status ?? 'draft', paidAt: isoOf(invoice.status_transitions.paid_at), pdfUrl: invoice.invoice_pdf ?? null }))
        };
      } catch {
        return { status: 'unavailable' };
      }
    },

    constructEvent(rawBody, signature, secret): StripeEventResult {
      if (!signature) {
        return { status: 'invalid' };
      }

      try {
        const event = sdk.webhooks.constructEvent(rawBody, signature, secret);
        const object = event.data.object as { object: string; id: string; parent?: { subscription_details?: { subscription?: string | { id: string } } } };
        const parentSubscription = object.parent?.subscription_details?.subscription;
        const subscriptionId = object.object === 'subscription' ? object.id : typeof parentSubscription === 'string' ? parentSubscription : (parentSubscription?.id ?? null);

        return { status: 'ok', event: { id: event.id, type: event.type, created: new Date(event.created * 1000).toISOString(), subscriptionId } };
      } catch {
        return { status: 'invalid' };
      }
    }
  };
}
```

Se o tipo `Stripe.Subscription` do SDK v19 não expuser `items.data[0].current_period_end` ou `latest_invoice.confirmation_secret` no typecheck, use `as unknown as { ... }` local nesses dois pontos e diga no relatório (o contrato de runtime é o da API basil).

- [ ] **Step 5: Fake e teste**

```ts
// packages/api/src/vendors/stripe/fake.ts
import { SubscriptionStatus } from '@receivy/common';
import type { StripeClient, StripeSubscriptionState } from './types';

const subscriptions = new Map<string, StripeSubscriptionState>();
let sequence = 0;

/** Test-only: pretend Stripe moved a subscription (a cancel from the dashboard, a failed retry cycle). */
export function fakeStripeSetStatus(subscriptionId: string, status: SubscriptionStatus, currentPeriodEnd: string | null = null): void {
  const current = subscriptions.get(subscriptionId);

  if (current) {
    subscriptions.set(subscriptionId, { ...current, status, currentPeriodEnd });
  }
}

/**
 * Stands in for Stripe on local and test: a subscription is active the moment it is created (the web's
 * Payment Element step is skipped), a webhook is any JSON `{ id, type, created, subscriptionId }` signed
 * with the literal `fake`, and nothing ever leaves the process. Handlers are separate bundles, so the map
 * only holds what this process created; a unknown id reads as active for 30 days.
 */
export function fakeStripe(): StripeClient {
  const periodEnd = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const stateOf = (id: string): StripeSubscriptionState => subscriptions.get(id) ?? { id, customerId: 'cus_fake', status: SubscriptionStatus.Active, currentPeriodEnd: periodEnd(), cancelAtPeriodEnd: false };

  return {
    async createCustomer(input) {
      return { status: 'ok', customerId: `cus_fake_${input.ownerId}` };
    },

    async createSubscription(input) {
      sequence += 1;

      const id = `sub_fake_${sequence}`;

      subscriptions.set(id, { id, customerId: input.customerId, status: SubscriptionStatus.Active, currentPeriodEnd: periodEnd(), cancelAtPeriodEnd: false });

      return { status: 'ok', subscriptionId: id, clientSecret: `pi_fake_${id}_secret` };
    },

    async getSubscription(id) {
      return { status: 'ok', subscription: stateOf(id) };
    },

    async setCancelAtPeriodEnd(id, cancel) {
      const next = { ...stateOf(id), cancelAtPeriodEnd: cancel };

      subscriptions.set(id, next);

      return { status: 'ok', subscription: next };
    },

    async createSetupIntent() {
      return { status: 'ok', clientSecret: 'seti_fake_secret' };
    },

    async setDefaultPaymentMethod() {
      return { status: 'ok' };
    },

    async defaultCard() {
      return { status: 'ok', card: { brand: 'visa', last4: '4242' } };
    },

    async listInvoices() {
      return { status: 'ok', invoices: [] };
    },

    constructEvent(rawBody, signature) {
      if (signature !== 'fake') {
        return { status: 'invalid' };
      }

      try {
        const parsed = JSON.parse(rawBody) as { id?: string; type?: string; created?: string; subscriptionId?: string | null };

        if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
          return { status: 'invalid' };
        }

        return { status: 'ok', event: { id: parsed.id, type: parsed.type, created: parsed.created ?? new Date().toISOString(), subscriptionId: parsed.subscriptionId ?? null } };
      } catch {
        return { status: 'invalid' };
      }
    }
  };
}
```

```ts
// packages/api/src/vendors/stripe/fake.test.ts
import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { fakeStripe, fakeStripeSetStatus } from './fake';

describe('fakeStripe', () => {
  it('activates a subscription on creation and reads it back', async () => {
    const stripe = fakeStripe();
    const created = await stripe.createSubscription({ customerId: 'cus_fake_o1', priceId: 'price_x' });

    expect(created.status).toBe('ok');

    const id = (created as { subscriptionId: string }).subscriptionId;

    expect(await stripe.getSubscription(id)).toMatchObject({ status: 'ok', subscription: { id, status: SubscriptionStatus.Active, cancelAtPeriodEnd: false } });
  });

  it('flips cancel at period end and honours a status pushed by a test', async () => {
    const stripe = fakeStripe();
    const { subscriptionId } = (await stripe.createSubscription({ customerId: 'cus_fake_o1', priceId: 'price_x' })) as { subscriptionId: string };

    expect(await stripe.setCancelAtPeriodEnd(subscriptionId, true)).toMatchObject({ subscription: { cancelAtPeriodEnd: true } });

    fakeStripeSetStatus(subscriptionId, SubscriptionStatus.Canceled);

    expect(await stripe.getSubscription(subscriptionId)).toMatchObject({ subscription: { status: SubscriptionStatus.Canceled } });
  });

  it('only accepts events signed with the literal fake', () => {
    const stripe = fakeStripe();
    const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', subscriptionId: 'sub_fake_1' });

    expect(stripe.constructEvent(body, 'fake', 'x')).toMatchObject({ status: 'ok', event: { id: 'evt_1', subscriptionId: 'sub_fake_1' } });
    expect(stripe.constructEvent(body, 'nope', 'x')).toEqual({ status: 'invalid' });
    expect(stripe.constructEvent('{', 'fake', 'x')).toEqual({ status: 'invalid' });
  });
});
```

- [ ] **Step 6: Verificar** — `pnpm --filter @receivy/api exec vitest run src/vendors/stripe --pool=forks` verde; `check-types`; `check-types:test`.

---

### Task 5: `PlanService`, endpoints, rotas e provider

**Files:**
- Create: `packages/api/src/plans/services/plan.ts`, `plan.test.ts`, `packages/api/src/plans/endpoints/{get,subscribe,cancel,resume,payment-method,payment-method-confirm,invoices}.ts`, `packages/api/src/plans/routes.ts`, `packages/api/src/plans/provider.ts`
- Modify: `packages/api/src/api.ts` (`...PlanRoutes`), `packages/api/ez4.project.js` (4 variáveis)

**Interfaces:**
- Consumes: T1–T4.
- Produces: `PlanBillingMode`, `stripeOf(variables)`, `planVariablesOf(variables)`, `PlanClient { get, subscribe, cancel, resume, setupPaymentMethod, confirmPaymentMethod, invoices }`, `PlanService` (Factory), `PlanProvider`, `PlanRoutes`, `syncSubscription(db, stripe, notices, row, now, event?)` (usado pelo webhook na T7 — definido aqui na T6, ver Interfaces da T6).

- [ ] **Step 1: Testes do serviço (fake Stripe, `db` mock)**

```ts
// packages/api/src/plans/services/plan.test.ts
import type { Service } from '@ez4/common';
import { PlanTier, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { PlanAlreadyActiveError, PlanBillingDisabledError } from '../errors';
import { createService, type PlanService } from './plan';

const NOW = new Date('2026-09-19T12:00:00Z');

function contextWith(subscription: Record<string, unknown> | null, mode = 'fake') {
  const rows = new Map<string, Record<string, unknown>>(subscription ? [['o1', subscription]] : []);
  const db = {
    subscriptions: {
      findOne: vi.fn(async ({ where }: { where: { owner_id?: string; stripe_subscription_id?: string } }) => (where.owner_id ? (rows.get(where.owner_id) ?? null) : ([...rows.values()].find((row) => row.stripe_subscription_id === where.stripe_subscription_id) ?? null))),
      insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: 'row-1', owner_id: 'o1' };

        rows.set('o1', row);

        return row;
      }),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.set('o1', { ...rows.get('o1'), ...data });

        return { id: 'row-1' };
      })
    },
    billings: { count: vi.fn(async () => 3), findMany: vi.fn(async () => ({ records: [] })), updateOne: vi.fn(async () => ({ id: 'b' })) },
    payment_methods: { findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'o1', name: 'Ana', email: 'ana@example.com' })) },
    events: { insertOne: vi.fn(async () => ({ id: 'e' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };
  const context = { db, variables: { PLAN_BILLING: mode, STRIPE_SECRET_KEY: 'disabled', STRIPE_WEBHOOK_SECRET: 'disabled', STRIPE_PRICE_BASIC: 'price_basic', EMAIL_TRANSPORT: 'disabled', RESEND_FROM_EMAIL: 'disabled', PUBLIC_WEB_ORIGIN: 'https://receivy.example', NOTIFICATION_PUSH_TRANSPORT: 'disabled', EXPO_ACCESS_TOKEN: 'disabled' } } as unknown as Service.Context<PlanService>;

  return { context, db, rows };
}

describe('PlanService', () => {
  it('describes the free plan with its usage when nobody subscribed', async () => {
    const { context } = contextWith(null);

    expect(await createService(context).get('o1', NOW)).toEqual({ plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null });
  });

  it('subscribes in fake mode: customer, subscription, and an active row right away', async () => {
    const { context, rows } = contextWith(null);
    const result = await createService(context).subscribe('o1', NOW);

    expect(result.clientSecret).toMatch(/^pi_fake_/);
    expect(rows.get('o1')).toMatchObject({ stripe_customer_id: 'cus_fake_o1', status: SubscriptionStatus.Active });
    expect(await createService(context).get('o1', NOW)).toMatchObject({ plan: PlanTier.Basic, usage: { indefinite: { used: 3, limit: 30 } }, checkoutLinks: true, card: { last4: '4242' } });
  });

  it('refuses a second subscription while one is live', async () => {
    const { context } = contextWith({ id: 'row-1', owner_id: 'o1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_fake_9', status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z', cancel_at_period_end: false });

    await expect(createService(context).subscribe('o1', NOW)).rejects.toBeInstanceOf(PlanAlreadyActiveError);
  });

  it('answers 503 for every Stripe action when billing is disabled, but still describes the plan', async () => {
    const { context } = contextWith(null, 'disabled');
    const plans = createService(context);

    await expect(plans.subscribe('o1', NOW)).rejects.toBeInstanceOf(PlanBillingDisabledError);
    await expect(plans.cancel('o1', NOW)).rejects.toBeInstanceOf(PlanBillingDisabledError);
    expect((await plans.get('o1', NOW)).plan).toBe(PlanTier.Free);
  });

  it('cancels and resumes at period end through the provider and mirrors the flag', async () => {
    const { context, rows } = contextWith(null);
    const plans = createService(context);

    await plans.subscribe('o1', NOW);
    await plans.cancel('o1', NOW);

    expect(rows.get('o1')).toMatchObject({ cancel_at_period_end: true, status: SubscriptionStatus.Active });

    await plans.resume('o1', NOW);

    expect(rows.get('o1')).toMatchObject({ cancel_at_period_end: false });
  });

  it('starts a card change with a setup intent and confirms it against the provider', async () => {
    const { context } = contextWith(null);
    const plans = createService(context);

    await plans.subscribe('o1', NOW);

    expect(await plans.setupPaymentMethod('o1')).toEqual({ clientSecret: 'seti_fake_secret' });
    await expect(plans.confirmPaymentMethod('o1', 'pm_1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Serviço**

```ts
// packages/api/src/plans/services/plan.ts
import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpNotFoundError } from '@ez4/gateway';
import { PLAN_LIMITS, type PlanInvoice, type PlanSummary, type SetupResult, type SubscribeResult, SubscriptionStatus, planOf } from '@receivy/common';
import type { Db, DbClient } from '../../database';
import { notificationTransport } from '../../notifications/services/transport';
import { AccountRepository } from '../../users/repositories/account';
import { createStripeClient } from '../../vendors/stripe/client';
import { fakeStripe } from '../../vendors/stripe/fake';
import type { StripeClient } from '../../vendors/stripe/types';
import { PlanAlreadyActiveError, PlanBillingDisabledError, PlanUnavailableError } from '../errors';
import { SubscriptionRepository } from '../repositories/subscription';
import { limitsOf } from './limits';
import { type PlanNotices, syncSubscription } from './sync';

export const enum PlanBillingMode {
  Live = 'live',
  Fake = 'fake',
  Disabled = 'disabled'
}

export type PlanVariables = {
  PLAN_BILLING?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_BASIC?: string;
  PUBLIC_WEB_ORIGIN?: string;
  RESEND_FROM_EMAIL?: string;
};

/** `PLAN_BILLING` picks the client: `live` talks to Stripe, `fake` answers in-process, anything else is off (null). */
export function stripeOf(variables: PlanVariables): StripeClient | null {
  if (variables.PLAN_BILLING === PlanBillingMode.Live) {
    return createStripeClient(variables.STRIPE_SECRET_KEY ?? '');
  }

  if (variables.PLAN_BILLING === PlanBillingMode.Fake) {
    return fakeStripe();
  }

  return null;
}

export function planNoticesOf(variables: Record<string, string | undefined>): PlanNotices {
  return { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000', from: variables.RESEND_FROM_EMAIL ?? 'disabled' };
}

export type PlanClient = {
  get(ownerId: string, now?: Date): Promise<PlanSummary>;
  subscribe(ownerId: string, now?: Date): Promise<SubscribeResult>;
  cancel(ownerId: string, now?: Date): Promise<void>;
  resume(ownerId: string, now?: Date): Promise<void>;
  setupPaymentMethod(ownerId: string): Promise<SetupResult>;
  confirmPaymentMethod(ownerId: string, paymentMethodId: string): Promise<void>;
  invoices(ownerId: string): Promise<PlanInvoice[]>;
};

export declare class PlanService extends Factory.Service<PlanClient> {
  handler: typeof createService;
  variables: {
    PLAN_BILLING: Environment.VariableOrValue<'PLAN_BILLING', 'disabled'>;
    STRIPE_SECRET_KEY: Environment.VariableOrValue<'STRIPE_SECRET_KEY', 'disabled'>;
    STRIPE_WEBHOOK_SECRET: Environment.VariableOrValue<'STRIPE_WEBHOOK_SECRET', 'disabled'>;
    STRIPE_PRICE_BASIC: Environment.VariableOrValue<'STRIPE_PRICE_BASIC', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };
  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

function requireStripe(stripe: StripeClient | null): StripeClient {
  if (!stripe) {
    throw new PlanBillingDisabledError();
  }

  return stripe;
}

async function summary(db: DbClient, stripe: StripeClient | null, ownerId: string, now: Date): Promise<PlanSummary> {
  const row = await SubscriptionRepository.get(db, ownerId);
  const { plan, limits, used } = await limitsOf(db, ownerId, now);
  const card = row && stripe ? await stripe.defaultCard(row.stripe_customer_id) : null;

  return {
    plan,
    status: row?.status ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    usage: { indefinite: { used, limit: limits.indefinite } },
    checkoutLinks: limits.checkoutLinks,
    card: card?.status === 'ok' ? card.card : null
  };
}

/** The customer row is created once and kept forever: a second subscription reuses it. */
async function ensureRow(db: DbClient, stripe: StripeClient, ownerId: string, now: Date): Promise<SubscriptionRepository.Row> {
  const existing = await SubscriptionRepository.get(db, ownerId, true);

  if (existing) {
    return existing;
  }

  const account = await AccountRepository.get(db, ownerId);
  const customer = await stripe.createCustomer({ ownerId, email: account?.verified_email ?? account?.email, name: account?.name });

  if (customer.status !== 'ok') {
    throw new PlanUnavailableError();
  }

  return SubscriptionRepository.insert(db, { ownerId, customerId: customer.customerId, now: now.toISOString() });
}

async function subscribe(db: DbClient, stripe: StripeClient, variables: PlanVariables, notices: PlanNotices, ownerId: string, now: Date): Promise<SubscribeResult> {
  const priceId = variables.STRIPE_PRICE_BASIC ?? 'disabled';

  if (priceId === 'disabled') {
    throw new PlanBillingDisabledError();
  }

  const { row, created } = await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const current = await ensureRow(tx, stripe, ownerId, now);

    if (planOf(SubscriptionRepository.snapshotOf(current), now) !== 'free') {
      throw new PlanAlreadyActiveError();
    }

    const result = await stripe.createSubscription({ customerId: current.stripe_customer_id, priceId });

    if (result.status !== 'ok') {
      throw new PlanUnavailableError();
    }

    await SubscriptionRepository.setSubscription(tx, current.id, { stripeSubscriptionId: result.subscriptionId, status: SubscriptionStatus.Incomplete, now: now.toISOString() });

    return { row: { ...current, stripe_subscription_id: result.subscriptionId, status: SubscriptionStatus.Incomplete }, created: result };
  });

  // Fake mode has no webhook: the subscription is live already, so the same sync the webhook runs applies it here.
  if (variables.PLAN_BILLING === PlanBillingMode.Fake) {
    await syncSubscription(db, stripe, notices, row, now);
  }

  return { clientSecret: created.clientSecret };
}

async function liveRow(db: DbClient, ownerId: string, now: Date): Promise<SubscriptionRepository.Row & { stripe_subscription_id: string }> {
  const row = await SubscriptionRepository.get(db, ownerId);

  if (!row?.stripe_subscription_id || planOf(SubscriptionRepository.snapshotOf(row), now) === 'free') {
    throw new HttpNotFoundError();
  }

  return row as SubscriptionRepository.Row & { stripe_subscription_id: string };
}

async function setCancel(db: DbClient, stripe: StripeClient, ownerId: string, cancel: boolean, now: Date): Promise<void> {
  const row = await liveRow(db, ownerId, now);
  const result = await stripe.setCancelAtPeriodEnd(row.stripe_subscription_id, cancel);

  if (result.status !== 'ok') {
    throw new PlanUnavailableError();
  }

  await SubscriptionRepository.applyState(db, row.id, { status: result.subscription.status, currentPeriodEnd: result.subscription.currentPeriodEnd, cancelAtPeriodEnd: result.subscription.cancelAtPeriodEnd, eventId: null, eventAt: null, now: now.toISOString() });
}

export function createService({ db, variables }: Service.Context<PlanService>): PlanClient {
  const stripe = stripeOf(variables);
  const notices = planNoticesOf(variables);

  return {
    get: (ownerId, now = new Date()) => summary(db, stripe, ownerId, now),
    subscribe: (ownerId, now = new Date()) => subscribe(db, requireStripe(stripe), variables, notices, ownerId, now),
    cancel: (ownerId, now = new Date()) => setCancel(db, requireStripe(stripe), ownerId, true, now),
    resume: (ownerId, now = new Date()) => setCancel(db, requireStripe(stripe), ownerId, false, now),
    setupPaymentMethod: async (ownerId) => {
      const row = await liveRow(db, ownerId, new Date());
      const result = await requireStripe(stripe).createSetupIntent(row.stripe_customer_id);

      if (result.status !== 'ok') {
        throw new PlanUnavailableError();
      }

      return { clientSecret: result.clientSecret };
    },
    confirmPaymentMethod: async (ownerId, paymentMethodId) => {
      const row = await liveRow(db, ownerId, new Date());
      const result = await requireStripe(stripe).setDefaultPaymentMethod({ customerId: row.stripe_customer_id, subscriptionId: row.stripe_subscription_id, paymentMethodId });

      if (result.status !== 'ok') {
        throw new PlanUnavailableError();
      }
    },
    invoices: async (ownerId) => {
      const row = await SubscriptionRepository.get(db, ownerId);

      if (!row || !stripe) {
        return [];
      }

      const result = await stripe.listInvoices(row.stripe_customer_id, 12);

      return result.status === 'ok' ? result.invoices : [];
    }
  };
}
```

`planOf(...) !== 'free'` compara com o membro: escreva `!== PlanTier.Free` (importar `PlanTier`); idem em `liveRow`. Note `syncSubscription` e `PlanNotices` vêm da Task 6 (`plans/services/sync.ts`): a Task 5 e a 6 são implementadas em sequência e o typecheck só fecha na 6 — janela aceita; ou implemente a 6 antes da 5 se preferir (elas não compartilham arquivos além deste import).

- [ ] **Step 4: Endpoints, rotas, provider**

```ts
// packages/api/src/plans/endpoints/get.ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PlanSummary } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class GetRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class GetResponse implements Http.Response {
  status: 200;
  body: PlanSummary;
}

export async function getPlanHandler({ identity }: GetRequest, { plans }: Service.Context<PlanProvider>): Promise<GetResponse> {
  return { status: 200, body: await plans.get(identity.userId) };
}
```

```ts
// packages/api/src/plans/endpoints/subscribe.ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SubscribeResult } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class SubscribeRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class SubscribeResponse implements Http.Response {
  status: 200;
  body: SubscribeResult;
}

export async function subscribePlanHandler({ identity }: SubscribeRequest, { plans }: Service.Context<PlanProvider>): Promise<SubscribeResponse> {
  return { status: 200, body: await plans.subscribe(identity.userId) };
}
```

`cancel.ts` e `resume.ts`: mesmo formato, `status: 204` sem body (`declare class DoneResponse implements Http.Response { status: 204; }`), chamando `plans.cancel`/`plans.resume`. `payment-method.ts`: `POST`, body `SetupResult` via `plans.setupPaymentMethod`. `payment-method-confirm.ts`: body de entrada `declare class ConfirmBody implements Http.JsonBody { paymentMethodId: String.Max<64>; }`, resposta 204, chama `plans.confirmPaymentMethod(identity.userId, body.paymentMethodId)`. `invoices.ts`: `GET`, body `{ invoices: PlanInvoice[] }` via `plans.invoices`.

```ts
// packages/api/src/plans/routes.ts
import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { cancelPlanHandler } from './endpoints/cancel';
import type { getPlanHandler } from './endpoints/get';
import type { planInvoicesHandler } from './endpoints/invoices';
import type { setupPlanPaymentMethodHandler } from './endpoints/payment-method';
import type { confirmPlanPaymentMethodHandler } from './endpoints/payment-method-confirm';
import type { resumePlanHandler } from './endpoints/resume';
import type { subscribePlanHandler } from './endpoints/subscribe';

export type PlanRoutes = [
  Http.UseRoute<{ name: 'getPlan'; path: 'GET /plan'; authorizer: typeof sessionAuthorizer; handler: typeof getPlanHandler }>,
  Http.UseRoute<{ name: 'subscribePlan'; path: 'POST /plan/subscribe'; authorizer: typeof sessionAuthorizer; handler: typeof subscribePlanHandler }>,
  Http.UseRoute<{ name: 'cancelPlan'; path: 'POST /plan/cancel'; authorizer: typeof sessionAuthorizer; handler: typeof cancelPlanHandler }>,
  Http.UseRoute<{ name: 'resumePlan'; path: 'POST /plan/resume'; authorizer: typeof sessionAuthorizer; handler: typeof resumePlanHandler }>,
  Http.UseRoute<{ name: 'setupPlanPaymentMethod'; path: 'POST /plan/payment-method'; authorizer: typeof sessionAuthorizer; handler: typeof setupPlanPaymentMethodHandler }>,
  Http.UseRoute<{ name: 'confirmPlanPaymentMethod'; path: 'POST /plan/payment-method/confirm'; authorizer: typeof sessionAuthorizer; handler: typeof confirmPlanPaymentMethodHandler }>,
  Http.UseRoute<{ name: 'planInvoices'; path: 'GET /plan/invoices'; authorizer: typeof sessionAuthorizer; handler: typeof planInvoicesHandler }>
];
```

```ts
// packages/api/src/plans/provider.ts
import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { PlanService } from './services/plan';

export declare class PlanProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    plans: Environment.Service<PlanService>;
  };
}
```

`api.ts`: `import type { PlanRoutes } from './plans/routes';` e `...PlanRoutes` depois de `...PaymentMethodRoutes`. `ez4.project.js` `variables`: `PLAN_BILLING: process.env.PLAN_BILLING ?? 'disabled', STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? 'disabled', STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? 'disabled', STRIPE_PRICE_BASIC: process.env.STRIPE_PRICE_BASIC ?? 'disabled'`.

- [ ] **Step 5: Verificar** — `pnpm --filter @receivy/api exec vitest run src/plans --pool=forks` verde (depois da Task 6); `check-types`; `check-types:test`; `pnpm --filter @receivy/api openapi:generate && openapi:check` (7 rotas novas).

---

### Task 6: `syncSubscription`, downgrade e avisos

**Files:**
- Create: `packages/api/src/plans/services/sync.ts`, `sync.test.ts`, `packages/api/src/plans/services/downgrade.ts`, `downgrade.test.ts`, `packages/api/src/plans/services/notices.ts`
- Modify: `packages/api/src/billings/repositories/billing.ts` (`activeIndefiniteByOwner`, `activeByPaymentMethods`)

**Interfaces:**
- Consumes: T2–T5.
- Produces: `PlanNotices = { transport: NotificationTransport; origin: string; from: string }`; `syncSubscription(db, stripe, notices, row, now, event?: { id: string; created: string; type: string }): Promise<'applied' | 'replayed' | 'unavailable' | 'ignored'>`; `applyDowngrade(db, ownerId, now): Promise<{ pausedIds: string[] }>`; `BillingRepository.activeIndefiniteByOwner(db, ownerId): Promise<Array<{ id: string; created_at: string }>>`; `BillingRepository.activeByPaymentMethods(db, ownerId, methodIds): Promise<string[]>`; `PaymentMethodRepository.checkoutMethodIds(db, ownerId): Promise<string[]>`.

- [ ] **Step 1: Testes do downgrade**

```ts
// packages/api/src/plans/services/downgrade.test.ts
import { BillingState } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { applyDowngrade } from './downgrade';

function dbWith(indefinite: Array<{ id: string; created_at: string }>, linked: string[], checkoutMethods: string[]) {
  const updated: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const db = {
    billings: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({ records: 'payment_method_id' in where ? linked.map((id) => ({ id })) : indefinite })),
      updateOne: vi.fn(async ({ where }: { where: { id: string } }) => {
        updated.push(where.id);

        return { id: where.id };
      })
    },
    payment_methods: { findMany: vi.fn(async () => ({ records: checkoutMethods.map((id) => ({ id })) })) },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: 'e' }; }) },
    users: { findOne: vi.fn(async () => ({ id: 'o1' })) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };

  return { db: db as never, updated, events };
}

describe('applyDowngrade', () => {
  it('pauses the newest indefinites above the free ceiling and every billing on a checkout method, once each', async () => {
    const { db, updated, events } = dbWith(
      [{ id: 'b7', created_at: '2026-07' }, { id: 'b6', created_at: '2026-06' }, { id: 'b5', created_at: '2026-05' }, { id: 'b4', created_at: '2026-04' }, { id: 'b3', created_at: '2026-03' }, { id: 'b2', created_at: '2026-02' }, { id: 'b1', created_at: '2026-01' }],
      ['b2', 'b9'],
      ['pm-link']
    );
    const result = await applyDowngrade(db, 'o1', new Date('2026-09-19T12:00:00Z'));

    expect(result.pausedIds).toEqual(['b7', 'b6', 'b2', 'b9']);
    expect(updated).toEqual(['b7', 'b6', 'b2', 'b9']);
    expect(events.map((event) => [event.eventable_id, event.type, event.payload])).toEqual([
      ['b7', 'billing.paused', { reason: 'plan' }], ['b6', 'billing.paused', { reason: 'plan' }], ['b2', 'billing.paused', { reason: 'plan' }], ['b9', 'billing.paused', { reason: 'plan' }]
    ]);
  });

  it('does nothing under the ceiling with no checkout methods', async () => {
    const { db, updated } = dbWith([{ id: 'b1', created_at: '2026-01' }], [], []);

    expect(await applyDowngrade(db, 'o1', new Date())).toEqual({ pausedIds: [] });
    expect(updated).toEqual([]);
  });

  it('skips the payment-method query when the owner has no checkout method', async () => {
    const { db } = dbWith([], [], []);

    await applyDowngrade(db, 'o1', new Date());

    expect((db as never as { billings: { findMany: ReturnType<typeof vi.fn> } }).billings.findMany).toHaveBeenCalledTimes(1);
  });
});

void BillingState;
```

(Remova a linha `void BillingState;` e o import se não for usada — está aqui só para o exemplo compilar caso o implementador use o enum nas asserções do `updateOne`.)

- [ ] **Step 2: Testes do sync**

```ts
// packages/api/src/plans/services/sync.test.ts
import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionRepository } from '../repositories/subscription';
import { syncSubscription } from './sync';

const NOW = new Date('2026-09-19T12:00:00Z');
const FUTURE = '2026-10-19T12:00:00.000Z';

function rowWith(overrides: Partial<SubscriptionRepository.Row>): SubscriptionRepository.Row {
  return { id: 'row-1', owner_id: 'o1', provider: 'stripe', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', plan: 'basic', status: SubscriptionStatus.Incomplete, cancel_at_period_end: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z', ...overrides } as SubscriptionRepository.Row;
}

function harness(remote: { status: SubscriptionStatus; currentPeriodEnd: string | null; cancelAtPeriodEnd?: boolean } | 'unavailable') {
  const applied: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const emails: Array<Record<string, unknown>> = [];
  const pushes: string[] = [];
  const db = {
    subscriptions: { updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { applied.push(data); return { id: 'row-1' }; }) },
    billings: { findMany: vi.fn(async () => ({ records: [] })), updateOne: vi.fn(async () => ({ id: 'b' })) },
    payment_methods: { findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'o1', name: 'Ana', email: 'ana@example.com' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd1', token: 'ExponentPushToken[x]' }] })) },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: 'e' }; }) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };
  const stripe = { getSubscription: vi.fn(async () => (remote === 'unavailable' ? { status: 'unavailable' } : { status: 'ok', subscription: { id: 'sub_1', customerId: 'cus_1', cancelAtPeriodEnd: false, ...remote } })) } as never;
  const notices = { transport: { email: vi.fn(async (input: Record<string, unknown>) => { emails.push(input); return { status: 'accepted', id: 'm' }; }), push: vi.fn(async ({ title }: { title: string }) => { pushes.push(title); return { status: 'accepted', id: 'p' }; }), receipt: vi.fn() }, origin: 'https://receivy.example', from: 'no-reply@receivy.example' } as never;

  return { db: db as never, stripe, notices, applied, events, emails, pushes };
}

describe('syncSubscription', () => {
  it('applies the state Stripe reports and welcomes the owner on incomplete → active', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({}), NOW, { id: 'evt_1', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('applied');
    expect(h.applied[0]).toMatchObject({ status: SubscriptionStatus.Active, current_period_end: FUTURE, last_event_id: 'evt_1' });
    expect(h.events.map((event) => event.type)).toEqual(['plan.subscribed']);
    expect(h.pushes).toEqual(['Plano Básico ativo']);
    expect(h.emails[0]).toMatchObject({ to: 'ana@example.com', subject: 'Seu plano Básico está ativo' });
  });

  it('replays the same event without touching anything', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, last_event_id: 'evt_1' }), NOW, { id: 'evt_1', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('replayed');
    expect(h.applied).toEqual([]);
    expect(h.stripe.getSubscription).not.toHaveBeenCalled();
  });

  it('downgrades and tells the owner when a live subscription comes back canceled', async () => {
    const h = harness({ status: SubscriptionStatus.Canceled, currentPeriodEnd: null });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE }), NOW, { id: 'evt_2', created: NOW.toISOString(), type: 'customer.subscription.deleted' })).toBe('applied');
    expect(h.events.map((event) => event.type)).toEqual(['plan.canceled']);
    expect(h.pushes).toEqual(['Seu plano Básico acabou']);
  });

  it('warns about a failed payment without downgrading while the paid period runs', async () => {
    const h = harness({ status: SubscriptionStatus.PastDue, currentPeriodEnd: FUTURE });

    await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE }), NOW, { id: 'evt_3', created: NOW.toISOString(), type: 'invoice.payment_failed' });

    expect(h.events.map((event) => event.type)).toEqual(['plan.payment_failed']);
    expect(h.pushes).toEqual(['Pagamento do plano falhou']);
    expect(h.emails[0]).toMatchObject({ subject: 'Atualize o cartão do seu plano' });
  });

  it('answers unavailable and writes nothing when Stripe cannot be read', async () => {
    const h = harness('unavailable');

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({}), NOW, { id: 'evt_4', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('unavailable');
    expect(h.applied).toEqual([]);
  });

  it('never regresses the event watermark on an older event, but still applies the re-read state', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE, last_event_id: 'evt_9', last_event_at: '2026-09-19T13:00:00.000Z' }), NOW, { id: 'evt_5', created: '2026-09-19T11:00:00.000Z', type: 'customer.subscription.updated' });

    expect(h.applied[0]).not.toHaveProperty('last_event_id');
    expect(h.applied[0]).toMatchObject({ status: SubscriptionStatus.Active });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar.**

- [ ] **Step 4: Repositórios**

`BillingRepository` (namespace), depois de `countActiveIndefinite`:

```ts
  /** The owner's live, active, receivable assinaturas, newest first: what a downgrade trims. */
  export async function activeIndefiniteByOwner(db: DbClient, ownerId: string): Promise<Array<{ id: string; created_at: string }>> {
    const { records } = await db.billings.findMany({
      select: { id: true, created_at: true },
      where: { owner_id: ownerId, recurrence: BillingRecurrence.Indefinite, state: BillingState.Active, kind: BillingKind.Live, contact_id: { isNull: true } },
      order: { created_at: Order.Desc }
    });

    return records;
  }

  /** Every active billing of the owner paid through one of the given methods. */
  export async function activeByPaymentMethods(db: DbClient, ownerId: string, methodIds: string[]): Promise<string[]> {
    if (!methodIds.length) {
      return [];
    }

    const { records } = await db.billings.findMany({
      select: { id: true },
      where: { owner_id: ownerId, state: BillingState.Active, payment_method_id: { isIn: methodIds } }
    });

    return records.map((row) => row.id);
  }
```

(`Order` já é importado de `@ez4/database` em `charges/repositories/charge.ts`; importe igual. Se o operador de lista no EZ4 não for `isIn`, use o que `contacts/repositories/contact.ts` usa para listas — grep `isIn\|in:` — e diga no relatório.)

`PaymentMethodRepository` (namespace):

```ts
  /** Ids of the owner's live InfinitePay/PagBank methods: the ones a free plan cannot bill through. */
  export async function checkoutMethodIds(db: DbClient, ownerId: string): Promise<string[]> {
    const { records } = await db.payment_methods.findMany({
      select: { id: true },
      where: { owner_id: ownerId, provider: { not: PaymentProvider.Pix }, archived_at: { isNull: true } }
    });

    return records.map((row) => row.id);
  }
```

- [ ] **Step 5: Downgrade, avisos, sync**

```ts
// packages/api/src/plans/services/downgrade.ts
import { BillingState, PLAN_LIMITS, PlanTier } from '@receivy/common';
import { BillingRepository } from '../../billings/repositories/billing';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { PaymentMethodRepository } from '../../payment-methods/repositories/payment-method';

/**
 * Runs once per basic → free transition, never at launch: the newest indefinites above the free ceiling and every
 * billing that can only be paid through a checkout link are paused. Nothing is archived; the owner reactivates.
 */
export async function applyDowngrade(db: DbClient, ownerId: string, now: Date): Promise<{ pausedIds: string[] }> {
  const stamp = now.toISOString();
  const indefinite = await BillingRepository.activeIndefiniteByOwner(db, ownerId);
  const excess = indefinite.slice(0, Math.max(0, indefinite.length - PLAN_LIMITS[PlanTier.Free].indefinite)).map((row) => row.id);
  const methodIds = await PaymentMethodRepository.checkoutMethodIds(db, ownerId);
  const linked = await BillingRepository.activeByPaymentMethods(db, ownerId, methodIds);
  const pausedIds = [...excess, ...linked.filter((id) => !excess.includes(id))];

  for (const id of pausedIds) {
    await BillingRepository.update(db, id, { state: BillingState.Paused }, stamp);
    await EventRepository.record(db, { type: 'billing.paused', eventableType: EventableType.Billing, eventableId: id, actorId: ownerId, payload: { reason: 'plan' }, at: stamp });
  }

  return { pausedIds };
}
```

(`BillingRepository.update` aceita `{ state }` — ver `patchBilling`. Charges pendentes das billings pausadas ficam como estão: o pause manual também não as toca fora do `settlePendingCharges`, que exige uma escolha do dono; aqui não há escolha.)

```ts
// packages/api/src/plans/services/notices.ts
import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { AccountRepository } from '../../users/repositories/account';

export type PlanNotices = { transport: NotificationTransport; origin: string; from: string };

export const enum PlanNoticeKind {
  Subscribed = 'subscribed',
  PaymentFailed = 'payment_failed',
  Canceled = 'canceled'
}

const COPY: Record<PlanNoticeKind, { title: string; subject: string; body: (paused: number) => string }> = {
  [PlanNoticeKind.Subscribed]: { title: 'Plano Básico ativo', subject: 'Seu plano Básico está ativo', body: () => 'Obrigado! Você já pode ter até 30 cobranças indefinidas ativas e usar links de pagamento.' },
  [PlanNoticeKind.PaymentFailed]: { title: 'Pagamento do plano falhou', subject: 'Atualize o cartão do seu plano', body: () => 'Não conseguimos cobrar seu cartão. Atualize o cartão em Plano para manter o Básico; o Stripe tenta de novo nos próximos dias.' },
  [PlanNoticeKind.Canceled]: {
    title: 'Seu plano Básico acabou',
    subject: 'Seu plano Básico acabou',
    body: (paused) => (paused ? `Voltamos ao plano Grátis e pausamos ${paused} cobrança(s) que passavam do limite ou dependiam de link de pagamento. Reative-as em Contas quando quiser.` : 'Voltamos ao plano Grátis. Suas cobranças continuam como estão.')
  }
};

/** E-mail + push to the owner after the transaction committed; failures never reach the caller. */
export async function notifyPlan(db: DbClient, notices: PlanNotices, ownerId: string, kind: PlanNoticeKind, pausedCount: number, eventId: string): Promise<void> {
  const copy = COPY[kind];
  const url = `${notices.origin.replace(/\/+$/, '')}/settings/plan`;
  const account = await AccountRepository.get(db, ownerId);
  const email = account?.verified_email ?? account?.email;

  if (email) {
    await notices.transport.email({ to: email, key: `plan:${ownerId}:${kind}:${eventId}`, subject: copy.subject, text: `${copy.body(pausedCount)}\n\n${url}`, from: notices.from });
  }

  await pushToUser(db, notices.transport, ownerId, { title: copy.title, body: copy.body(pausedCount), url });
}
```

```ts
// packages/api/src/plans/services/sync.ts
import { PlanTier, SubscriptionStatus, planOf } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { AccountRepository } from '../../users/repositories/account';
import type { StripeClient } from '../../vendors/stripe/types';
import { SubscriptionRepository } from '../repositories/subscription';
import { applyDowngrade } from './downgrade';
import { PlanNoticeKind, type PlanNotices, notifyPlan } from './notices';

export type { PlanNotices } from './notices';

export type SyncEvent = { id: string; created: string; type: string };

export type SyncOutcome = 'applied' | 'replayed' | 'unavailable' | 'ignored';

/**
 * The single writer of `subscriptions` after the first insert: re-reads the subscription at Stripe (the event
 * payload is never trusted), stores what it finds, and acts on the transition it observes. Notices go out after
 * the transaction commits.
 */
export async function syncSubscription(db: DbClient, stripe: StripeClient, notices: PlanNotices, row: SubscriptionRepository.Row, now: Date, event?: SyncEvent): Promise<SyncOutcome> {
  if (event && row.last_event_id === event.id) {
    return 'replayed';
  }

  if (!row.stripe_subscription_id) {
    return 'ignored';
  }

  const remote = await stripe.getSubscription(row.stripe_subscription_id);

  if (remote.status === 'unavailable') {
    return 'unavailable';
  }

  const state = remote.status === 'ok' ? remote.subscription : { status: SubscriptionStatus.Canceled, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  const before = planOf(SubscriptionRepository.snapshotOf(row), now);
  const after = planOf({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, now);
  const newer = !event || !row.last_event_at || event.created >= row.last_event_at;
  const stamp = now.toISOString();
  const outcome = await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, row.owner_id);
    await SubscriptionRepository.applyState(tx, row.id, { status: state.status, currentPeriodEnd: state.currentPeriodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd, eventId: newer && event ? event.id : null, eventAt: newer && event ? event.created : null, now: stamp });

    if (before === PlanTier.Free && after === PlanTier.Basic) {
      await EventRepository.record(tx, { type: 'plan.subscribed', eventableType: EventableType.Account, eventableId: row.owner_id, payload: { subscriptionId: row.stripe_subscription_id }, at: stamp });

      return { kind: PlanNoticeKind.Subscribed, paused: 0 };
    }

    if (before === PlanTier.Basic && after === PlanTier.Free) {
      const { pausedIds } = await applyDowngrade(tx, row.owner_id, now);

      await EventRepository.record(tx, { type: 'plan.canceled', eventableType: EventableType.Account, eventableId: row.owner_id, payload: { subscriptionId: row.stripe_subscription_id, pausedIds }, at: stamp });

      return { kind: PlanNoticeKind.Canceled, paused: pausedIds.length };
    }

    if (event?.type === 'invoice.payment_failed' && state.status === SubscriptionStatus.PastDue) {
      await EventRepository.record(tx, { type: 'plan.payment_failed', eventableType: EventableType.Account, eventableId: row.owner_id, payload: { subscriptionId: row.stripe_subscription_id }, at: stamp });

      return { kind: PlanNoticeKind.PaymentFailed, paused: 0 };
    }

    return null;
  });

  if (outcome) {
    await notifyPlan(db, notices, row.owner_id, outcome.kind, outcome.paused, event?.id ?? stamp);
  }

  return 'applied';
}
```

(`remote.status === 'not_found'` é tratado como cancelada: o Stripe apagou a assinatura.)

- [ ] **Step 6: Verificar** — `pnpm --filter @receivy/api exec vitest run src/plans src/billings src/payment-methods --pool=forks` verde (inclui a Task 5 agora que `sync.ts` existe); `check-types`; `check-types:test`.

---

### Task 7: Webhook `POST /webhooks/stripe`

**Files:**
- Create: `packages/api/src/webhooks/endpoints/stripe.ts`, `stripe.test.ts`
- Modify: `packages/api/src/webhooks/routes.ts`, `packages/api/src/webhooks/provider.ts` (variáveis do plano)

**Interfaces:**
- Consumes: `stripeOf`, `planNoticesOf` (T5), `syncSubscription` (T6), `SubscriptionRepository.bySubscriptionId` (T2).

- [ ] **Step 1: Testes**

```ts
// packages/api/src/webhooks/endpoints/stripe.test.ts
import type { Service } from '@ez4/common';
import { HttpBadRequestError, HttpInternalServerError } from '@ez4/gateway';
import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { WebhookProvider } from '../provider';
import { stripeWebhookHandler } from './stripe';

const ROW = { id: 'row-1', owner_id: 'o1', provider: 'stripe', stripe_customer_id: 'cus_fake_o1', stripe_subscription_id: 'sub_fake_1', plan: 'basic', status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z', cancel_at_period_end: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' };

function contextWith(row: Record<string, unknown> | null) {
  const db = {
    subscriptions: { findOne: vi.fn(async () => row), updateOne: vi.fn(async () => ({ id: 'row-1' })) },
    billings: { findMany: vi.fn(async () => ({ records: [] })), updateOne: vi.fn(async () => ({ id: 'b' })) },
    payment_methods: { findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'o1', email: 'ana@example.com' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) },
    events: { insertOne: vi.fn(async () => ({ id: 'e' })) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };

  return { db, context: { db, variables: { PLAN_BILLING: 'fake', STRIPE_SECRET_KEY: 'disabled', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_PRICE_BASIC: 'price_basic', EMAIL_TRANSPORT: 'disabled', RESEND_FROM_EMAIL: 'disabled', PUBLIC_WEB_ORIGIN: 'https://receivy.example', NOTIFICATION_PUSH_TRANSPORT: 'disabled', EXPO_ACCESS_TOKEN: 'disabled' } } as unknown as Service.Context<WebhookProvider> };
}

const body = (event: Record<string, unknown>) => JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: '2026-09-19T12:00:00.000Z', subscriptionId: 'sub_fake_1', ...event });

describe('stripeWebhookHandler', () => {
  it('answers 400 and touches nothing on a bad signature', async () => {
    const { db, context } = contextWith(ROW);

    await expect(stripeWebhookHandler({ headers: { 'stripe-signature': 'nope' }, body: body({}) }, context)).rejects.toBeInstanceOf(HttpBadRequestError);
    expect(db.subscriptions.findOne).not.toHaveBeenCalled();
  });

  it('answers 200 and ignores an event for a subscription it does not know', async () => {
    const { db, context } = contextWith(null);

    expect(await stripeWebhookHandler({ headers: { 'stripe-signature': 'fake' }, body: body({ subscriptionId: 'sub_other' }) }, context)).toEqual({ status: 200, body: { received: true } });
    expect(db.subscriptions.updateOne).not.toHaveBeenCalled();
  });

  it('answers 200 without a subscription id (customer-level events)', async () => {
    const { db, context } = contextWith(ROW);

    expect(await stripeWebhookHandler({ headers: { 'stripe-signature': 'fake' }, body: body({ subscriptionId: null, type: 'customer.updated' }) }, context)).toEqual({ status: 200, body: { received: true } });
    expect(db.subscriptions.findOne).not.toHaveBeenCalled();
  });

  it('syncs a known subscription from the provider, not from the payload', async () => {
    const { db, context } = contextWith(ROW);

    expect(await stripeWebhookHandler({ headers: { 'stripe-signature': 'fake' }, body: body({}) }, context)).toEqual({ status: 200, body: { received: true } });
    expect(db.subscriptions.updateOne).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ last_event_id: 'evt_1' }) }));
  });

  it('answers 500 so Stripe retries when the provider cannot be read', async () => {
    const { context } = contextWith({ ...ROW, stripe_subscription_id: 'sub_fake_1' });
    const unavailable = { ...context, variables: { ...(context as unknown as { variables: Record<string, string> }).variables } } as unknown as Service.Context<WebhookProvider>;

    vi.doMock('../../vendors/stripe/fake', () => ({ fakeStripe: () => ({ getSubscription: async () => ({ status: 'unavailable' }) }) }));

    const { stripeWebhookHandler: handler } = await import('./stripe');

    await expect(handler({ headers: { 'stripe-signature': 'fake' }, body: body({}) }, unavailable)).rejects.toBeInstanceOf(HttpInternalServerError);

    vi.doUnmock('../../vendors/stripe/fake');
  });
});
```

(Se `vi.doMock` + import dinâmico não isolar o módulo por causa do cache do vitest, troque o último caso por um teste do ramo `unavailable` em `sync.test.ts` — já existe — e afirme aqui apenas o mapeamento `'unavailable' → HttpInternalServerError` extraindo `outcomeToResponse` como função exportada de `stripe.ts` e testando-a diretamente. Diga qual caminho tomou.)

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Handler, rota, provider**

```ts
// packages/api/src/webhooks/endpoints/stripe.ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError, HttpInternalServerError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { SubscriptionRepository } from '../../plans/repositories/subscription';
import { planNoticesOf, stripeOf } from '../../plans/services/plan';
import { type SyncOutcome, syncSubscription } from '../../plans/services/sync';
import type { WebhookProvider } from '../provider';

declare class StripeWebhookRequest implements Http.Request {
  headers: { 'stripe-signature'?: String.Max<1024> };
  body: string;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

const HANDLED = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);

/** A sync that could not read Stripe asks for a retry; everything else is done from Stripe's point of view. */
export function outcomeToResponse(outcome: SyncOutcome): WebhookResponse {
  if (outcome === 'unavailable') {
    throw new HttpInternalServerError('Subscription check unavailable');
  }

  return RECEIVED;
}

export async function stripeWebhookHandler({ headers, body }: StripeWebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  const stripe = stripeOf(variables);

  if (!stripe) {
    return RECEIVED;
  }

  const verified = stripe.constructEvent(body, headers['stripe-signature'], variables.STRIPE_WEBHOOK_SECRET);

  if (verified.status !== 'ok') {
    throw new HttpBadRequestError('Invalid signature');
  }

  const { event } = verified;

  if (!HANDLED.has(event.type) || !event.subscriptionId) {
    return RECEIVED;
  }

  const row = await SubscriptionRepository.bySubscriptionId(db, event.subscriptionId);

  if (!row) {
    return RECEIVED;
  }

  const outcome = await syncSubscription(db, stripe, planNoticesOf(variables), row, new Date(), { id: event.id, created: event.created, type: event.type });

  console.info('Stripe webhook', { ownerId: row.owner_id, type: event.type, outcome });

  return outcomeToResponse(outcome);
}
```

`webhooks/routes.ts`: 5ª entrada `Http.UseRoute<{ name: 'stripeWebhook'; path: 'POST /webhooks/stripe'; handler: typeof stripeWebhookHandler }>`. `webhooks/provider.ts` `variables` += `PLAN_BILLING`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC` (todos `VariableOrValue<..., 'disabled'>`) e `EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>`, `RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>` se ainda não estiverem lá.

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/api exec vitest run src/webhooks --pool=forks` verde; `check-types`; `check-types:test`; `openapi:generate && openapi:check`.

---

### Task 8: Spec de integração, fixtures, envs, docs, OAS

**Files:**
- Create: `packages/api/test/financial/plan.spec.ts`
- Modify: `packages/api/test/fixtures/financial.ts` (`plans`, `grantBasicPlan`), `packages/api/test/financial/infinitepay.spec.ts` e `pagseguro.spec.ts` (`grantBasicPlan` no `before`, se a Task 3 ainda não fez), `packages/api/scripts/financial-http-smoke.mjs` (linha `subscriptions` do fixture, se a Task 3 ainda não fez), `packages/api/dev.env.example`, `local.env.example`, `test.env.example`, `docs/environments.md`, `docs/api-errors.md`, `docs/notifications.md`, `docs/manual-qa-script.md` (§24, parte da API), `docs/api-oas.yml` (gerado)

- [ ] **Step 1: Fixtures**

Em `test/fixtures/financial.ts`:

```ts
import { createService as createPlanService, type PlanService } from '../../src/plans/services/plan';
import { SubscriptionRepository } from '../../src/plans/repositories/subscription';
import { SubscriptionStatus } from '@receivy/common';

export const PLAN_VARIABLES = { PLAN_BILLING: 'fake', STRIPE_SECRET_KEY: 'disabled', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_PRICE_BASIC: 'price_basic', EMAIL_TRANSPORT: 'disabled', RESEND_FROM_EMAIL: 'disabled', PUBLIC_WEB_ORIGIN: 'https://receivy.example', NOTIFICATION_PUSH_TRANSPORT: 'disabled', EXPO_ACCESS_TOKEN: 'disabled' };

export const plans = createPlanService({ db, variables: PLAN_VARIABLES } as unknown as Service.Context<PlanService>);

/** A paid plan without Stripe: what every spec that needs checkout links or more than 5 indefinites calls in `before`. */
export async function grantBasicPlan(client: DbClient, ownerId: string): Promise<void> {
  const now = new Date().toISOString();
  const row = await SubscriptionRepository.insert(client, { ownerId, customerId: `cus_test_${ownerId}`, now });

  await SubscriptionRepository.setSubscription(client, row.id, { stripeSubscriptionId: `sub_test_${ownerId}`, status: SubscriptionStatus.Active, now });
}
```

- [ ] **Step 2: Spec**

```ts
// packages/api/test/financial/plan.spec.ts
import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BillingRecurrence, BillingState, PaymentProvider, PlanTier, SplitMode, SplitPartKind, SubscriptionStatus } from '@receivy/common';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { EventRepository } from '../../src/common/repositories/events';
import { SubscriptionRepository } from '../../src/plans/repositories/subscription';
import { planNoticesOf, stripeOf } from '../../src/plans/services/plan';
import { syncSubscription } from '../../src/plans/services/sync';
import { fakeStripeSetStatus } from '../../src/vendors/stripe/fake';
import { PLAN_VARIABLES, cleanupUsers, contacts, createUser, db, paymentMethods, plans } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = '99999999-9999-4999-8999-999999999995';
const PAYER = '99999999-9999-4999-8999-999999999996';

async function indefinite(ownerId: string, userId: string, key: string) {
  const { context } = fakeNotice();

  return createBilling(db, ownerId, key, {
    recurrence: BillingRecurrence.Indefinite,
    frequency: 'monthly' as never,
    description: `Assinatura ${key}`,
    totalCents: 1_000,
    startDate: '2999-01-10',
    timezone: 'America/Sao_Paulo',
    split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId, amountCents: 1_000 }] }
  } as never, new Date(), undefined, context);
}

describe('paid plan', () => {
  let payerId: string;
  const created: string[] = [];

  before(async () => {
    await createUser(db, { id: OWNER, email: 'plan-owner@example.com', name: 'Dona Plano' });
    await createUser(db, { id: PAYER, email: 'plan-payer@example.com', name: 'Ana Paga' });

    payerId = (await contacts.save(OWNER, { name: 'Ana', email: 'plan-payer@example.com' })).userId;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYER]));

  it('starts free, blocks the sixth indefinite and refuses a checkout method', async () => {
    for (let index = 1; index <= 5; index += 1) {
      created.push((await indefinite(OWNER, payerId, `plan-${index}`)).id);
    }

    equal((await plans.get(OWNER)).usage.indefinite.used, 5);
    await rejects(indefinite(OWNER, payerId, 'plan-6'), { context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '5', used: '5', plan: PlanTier.Free } } });
    await rejects(paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: '$loja' }), { context: { code: 'PLAN_REQUIRED' } });
  });

  it('subscribes in fake mode and raises the ceiling to 30 with links allowed', async () => {
    const result = await plans.subscribe(OWNER);

    ok(result.clientSecret.startsWith('pi_fake_'));

    const summary = await plans.get(OWNER);

    equal(summary.plan, PlanTier.Basic);
    equal(summary.usage.indefinite.limit, 30);
    equal(summary.checkoutLinks, true);
    equal((await EventRepository.list(db, OWNER, 'plan.subscribed')).length, 1);

    created.push((await indefinite(OWNER, payerId, 'plan-6')).id);

    const method = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: '$loja' });

    created.push((await createBilling(db, OWNER, 'plan-linked', { recurrence: BillingRecurrence.Once, description: 'Com link', totalCents: 500, startDate: '2999-02-01', timezone: 'America/Sao_Paulo', paymentMethodId: method.id, split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: payerId, amountCents: 500 }] } } as never, new Date(), undefined, fakeNotice().context)).id);
  });

  it('refuses a second subscription and mirrors cancel at period end', async () => {
    await rejects(plans.subscribe(OWNER), { context: { code: 'PLAN_ALREADY_ACTIVE' } });
    await plans.cancel(OWNER);
    equal((await plans.get(OWNER)).cancelAtPeriodEnd, true);
    await plans.resume(OWNER);
    equal((await plans.get(OWNER)).cancelAtPeriodEnd, false);
  });

  it('downgrades when the provider reports the subscription canceled: newest excess and linked billings pause', async () => {
    const row = (await SubscriptionRepository.get(db, OWNER))!;

    fakeStripeSetStatus(row.stripe_subscription_id!, SubscriptionStatus.Canceled);

    const outcome = await syncSubscription(db, stripeOf(PLAN_VARIABLES)!, planNoticesOf(PLAN_VARIABLES), row, new Date(), { id: 'evt_cancel', created: new Date().toISOString(), type: 'customer.subscription.deleted' });

    equal(outcome, 'applied');

    const summary = await plans.get(OWNER);
    const sixth = created[5]!;
    const linked = created[6]!;
    const paused = await db.billings.findMany({ select: { id: true, state: true }, where: { owner_id: OWNER, state: BillingState.Paused } });

    equal(summary.plan, PlanTier.Free);
    equal(summary.usage.indefinite.used, 5);
    ok(paused.records.some((billing) => billing.id === sixth));
    ok(paused.records.some((billing) => billing.id === linked));
    equal((await EventRepository.list(db, sixth, 'billing.paused')).length, 1);
    equal((await EventRepository.list(db, OWNER, 'plan.canceled')).length, 1);
  });

  it('replays the same event without a second downgrade', async () => {
    const row = (await SubscriptionRepository.get(db, OWNER))!;

    equal(await syncSubscription(db, stripeOf(PLAN_VARIABLES)!, planNoticesOf(PLAN_VARIABLES), row, new Date(), { id: 'evt_cancel', created: new Date().toISOString(), type: 'customer.subscription.deleted' }), 'replayed');
    equal((await EventRepository.list(db, OWNER, 'plan.canceled')).length, 1);
  });

  it('makes a paused excess indefinite pass the limit again on reactivation', async () => {
    const sixth = created[5]!;

    await rejects(patchBilling(db, OWNER, sixth, { state: BillingState.Active }), { context: { code: 'PLAN_LIMIT_REACHED' } });
  });
});
```

(`EventRepository.list(db, eventableId, type)` é a assinatura usada em `pagseguro.spec.ts`; `createBilling`/`patchBilling` são as funções exportadas de `billings/services/billing.ts` — confirme os nomes de `patchBilling` e a forma de `BillingInput` no arquivo antes de rodar; ajuste os campos do input ao que `normalizeBillingInput` exige e diga no relatório.)

- [ ] **Step 3: Envs e docs**

`dev.env.example` (depois de `PAYMENT_CREDENTIAL_KEY_B64`):

```
# Paid plan: `live` talks to Stripe with the keys below, `fake` activates a subscription in-process
# (no card, no webhook), `disabled` (default) answers 503 on every plan action while the free limits still apply.
PLAN_BILLING=live
STRIPE_SECRET_KEY=sk_test_...
# `stripe listen --print-secret` locally; the endpoint's signing secret on dev/prd.
STRIPE_WEBHOOK_SECRET=whsec_...
# The monthly price id of the Básico product (Stripe dashboard > Product catalog).
STRIPE_PRICE_BASIC=price_...
```

`local.env.example` e `test.env.example`: `PLAN_BILLING=fake` com o mesmo comentário curto; as três chaves Stripe ficam de fora (default `disabled`).

`docs/environments.md`: bullet novo depois do de `PAYMENT_METHOD_LINK` explicando `PLAN_BILLING=live | fake | disabled` e as três variáveis Stripe; acrescente "verifique um evento assinado pelo `stripe listen` antes de virar `live` em prd". `docs/api-errors.md`: linhas `PLAN_LIMIT_REACHED` (402, `context.fields { limit, used, plan }`), `PLAN_REQUIRED` (402), `PLAN_ALREADY_ACTIVE` (409), `PLAN_BILLING_DISABLED` (503), `PLAN_UNAVAILABLE` (503). `docs/notifications.md`: seção "Plano" com os três avisos (título/assunto) e os eventos `plan.subscribed | plan.payment_failed | plan.canceled { pausedIds }` (em `account`), `billing.paused { reason: 'plan' }`. `docs/manual-qa-script.md`: §24 "Plano pago (API)" com: (a) local `fake`: 5 indefinidas ok, 6ª → 402 com o paywall; `POST /plan/subscribe` → Básico; cadastrar InfinitePay passa; (b) dev `live` com `stripe listen --forward-to <api>/webhooks/stripe`: assinar pelo web (cartão `4242 4242 4242 4242`), evento `plan.subscribed`; cancelar no dashboard do Stripe → `plan.canceled`, billings pausadas com `reason: 'plan'`; evento repetido pelo `stripe events resend` → sem segundo downgrade. `docs/deploy-guide.md` não muda.

`pnpm --filter @receivy/api openapi:generate && pnpm --filter @receivy/api openapi:check`.

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration` (só `account-concurrency` baseline; `infinitepay.spec.ts` e `pagseguro.spec.ts` verdes com `grantBasicPlan`); `pnpm --filter @receivy/api lint` (tsc limpo; biome baseline); `pnpm --filter @receivy/common lint && test`; `pnpm --filter @receivy/web check-types` (o web ainda não usa nada novo; só confirma que o common não quebrou).

---

## Auto-revisão (feita ao escrever)

- **Spec**: §2 decisões (T1 limites, T3 contagem/ganchos, T6 downgrade, T5 mensal/fake); §3 modelo (T1 `planOf`, T2 tabela/repo, T3 contagem com lock); §4 enforcement (T3; linha "editar para indefinite" descartada — não existe na API); §5 downgrade (T6); §6 Stripe (T4 vendor/fake, T5 assinar/gestão/envs, T7 webhook); §9 eventos/avisos (T6 `notices.ts`, `EventableType.Account`); §10 pastas (T5); §11 testes (cada task + T8 spec); §12 deploy (T8 docs). §7/§8 (web/mobile) ficam para o plano de UI.
- **Nomes**: `planOf`, `PLAN_LIMITS`, `SubscriptionRepository.{get,bySubscriptionId,insert,setSubscription,applyState,snapshotOf}`, `limitsOf`, `assertCanCreateIndefinite`, `assertCheckoutLinksAllowed`, `StripeClient`, `createStripeClient`, `fakeStripe`, `fakeStripeSetStatus`, `stripeOf`, `planNoticesOf`, `PlanNotices`, `syncSubscription`, `applyDowngrade`, `notifyPlan`, `PlanNoticeKind`, `BillingRepository.{countActiveIndefinite,activeIndefiniteByOwner,activeByPaymentMethods}`, `PaymentMethodRepository.checkoutMethodIds`, `grantBasicPlan`, `PLAN_VARIABLES` — mesma forma em todas as tasks que os usam.
- **Ordem**: T5 importa `sync.ts` da T6; executar T6 logo após T5 (ou antes) fecha o typecheck; ledger deve registrar a janela.
- **Fora**: web/mobile (plano de UI seguinte), IAP, Intermediário, anual, trial, proração, reativação automática.
