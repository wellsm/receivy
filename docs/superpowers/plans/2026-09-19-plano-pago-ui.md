# Plano pago (Stripe) — UI Implementation Plan (web + mobile)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/settings/plan` no web com assinatura via Payment Element (sem Checkout/Portal), paywall único para os 402, travas nos chips InfinitePay/PagBank e contador de uso; no mobile, card do plano somente leitura e a mesma trava com o texto "Gerencie seu plano no site".

**Architecture:** O web fala com a API pelo BFF existente (`/api/financial/*`, allowlist em `lib/financial-proxy.ts`); as 7 rotas `/plan*` entram na allowlist, o webhook do Stripe vai para as exclusões. `@stripe/stripe-js` + `@stripe/react-stripe-js` carregam o Payment Element dentro de `PlanScreen`; a confirmação usa `redirect: 'if_required'` e a página faz polling de `GET /plan` até `basic`. Um `PlanPaywall` (components/app) recebe o payload de erro 402 e mostra motivo + botão para `/settings/plan`. No mobile só leitura: `financialClient.plan()`, card no Perfil, chips desabilitados e texto inline nos 402.

**Tech Stack:** Next 16 app router, Tailwind (tokens do `globals.css`), vitest + Testing Library; `@stripe/stripe-js`, `@stripe/react-stripe-js` (aprovadas); Expo Router + Uniwind, jest + RNTL; `@receivy/common`.

**Spec:** `docs/superpowers/specs/2026-09-19-plano-pago-stripe-design.md` (§7 web, §8 mobile, §9 avisos). API já entregue: `GET /plan` → `PlanSummary`; `POST /plan/subscribe` → `{ clientSecret }`; `POST /plan/cancel` 204; `POST /plan/resume` 204; `POST /plan/payment-method` → `{ clientSecret }` (SetupIntent); `POST /plan/payment-method/confirm { paymentMethodId }` 204; `GET /plan/invoices` → `{ invoices }`; erros 402 `PLAN_LIMIT_REACHED` (`context.fields { limit, used, plan }`), 402 `PLAN_REQUIRED`, 409 `PLAN_ALREADY_ACTIVE`, 503 `PLAN_BILLING_DISABLED | PLAN_UNAVAILABLE`.

## Global Constraints

- Copy (verbatim): paywall título "Plano Básico"; corpo = `message` da API; benefícios "Até 30 cobranças indefinidas ativas" e "Links de pagamento (InfinitePay e PagBank)"; botões "Ver plano" (→ `/settings/plan`) e "Agora não". Página: título "Plano"; badges "Grátis"/"Básico"; uso "X de N cobranças indefinidas"; botões "Assinar o Básico", "Cancelar ao fim do período", "Retomar", "Trocar cartão"; faturas "Faturas"; confirmação "Confirmando pagamento…"; sucesso "Plano Básico ativo". Mobile: "Limite do plano grátis. Gerencie seu plano no site." (sem botão nem link); card "Plano Grátis" / "Plano Básico".
- Nomes dos planos: `planName(tier)` em `@receivy/common` (`Grátis`, `Básico`) — nunca literais na UI.
- Comparações de enum pelos membros (`PlanTier.Basic`, `PaymentProvider.PagSeguro`), nunca literais.
- Web: `browserFetch` para o BFF, `responseMessage` como fallback, erro inline `role="alert"`; eslint `curly` + `padding-line-between-statements`; Tailwind só em componentes (nunca `globals.css`); tokens existentes (`bg-primary-soft text-primary-strong` para o badge Básico, `bg-surface-muted` para Grátis). Nada de CSP a mudar (`/settings/*` não tem CSP).
- Web env: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (Stripe.js só carrega quando presente; sem chave a página mostra "Assinaturas indisponíveis neste ambiente." e esconde Assinar/Trocar cartão) e `NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS` (preço só para exibição; a cobrança real é o preço do Stripe). Ruling: o preço não vem da API.
- Payment Element: `Elements` com `{ clientSecret, locale: 'pt-BR', appearance: { theme: 'stripe', variables: { colorPrimary: '#4b3fd6' } } }`; `confirmPayment`/`confirmSetup` com `redirect: 'if_required'`; nunca `return_url`; após assinar, polling de `GET /plan` a cada 2 s por até 30 s até `plan === PlanTier.Basic`.
- Mobile: somente leitura; nenhum `Linking.openURL`, botão ou link para compra (Apple 3.1.1); erros inline em `<Text accessibilityRole="alert">` (mesmo padrão dos formulários), nunca `Alert.alert` informativo; injeção de dependência por props nos testes (`client`), `await render`, `await fireEvent`.
- Contrato OpenAPI (`lib/openapi-contract.test.ts`): 7 rotas `/plan*` cobertas pela allowlist; `POST webhooks/stripe` em `WEB_EXCLUSIONS` e `NATIVE_DEFERRED`; as 5 rotas de escrita `plan/*` em `NATIVE_DEFERRED`; `extractPathTemplates` reconhece o prefixo `plan`.
- Dependências novas apenas `@stripe/stripe-js` e `@stripe/react-stripe-js` no web (aprovadas). Nada no mobile.
- Verificação por task: web `pnpm --filter @receivy/web check-types && lint && test && build`; mobile `pnpm --filter @receivy/mobile check-types && lint && test`; common `lint && test`.
- Nunca `git stash/checkout/restore`; re-ler antes de editar; diffs mínimos; nada de `biome --write`.

---

### Task 1: Common — `planName`, `planErrorOf`, 402 com cópia da API

**Files:**
- Modify: `packages/common/src/domain/plan.ts`, `packages/common/src/domain/plan.test.ts`, `packages/common/src/domain/api-error.ts`, `packages/common/src/domain/api-error.test.ts` (criar se não existir)

**Interfaces:**
- Produces: `PLAN_NAMES: Record<PlanTier, string>`, `planName(tier): string`, `PlanErrorCode { LimitReached = 'PLAN_LIMIT_REACHED', Required = 'PLAN_REQUIRED' }`, `PlanErrorPayload = { code: PlanErrorCode; message: string; fields: { limit?: number; used?: number; plan?: PlanTier } }`, `planErrorOf(body: unknown): PlanErrorPayload | null`; `apiErrorMessage(402, body, fallback)` devolve `message` da API.

- [ ] **Step 1: Testes**

```ts
// packages/common/src/domain/plan.test.ts — acrescentar
import { PlanErrorCode, PlanTier, planErrorOf, planName } from './plan';

describe('plan copy and errors', () => {
  it('names the tiers', () => {
    expect(planName(PlanTier.Free)).toBe('Grátis');
    expect(planName(PlanTier.Basic)).toBe('Básico');
  });

  it('parses a limit error with its numeric fields', () => {
    const body = { type: 'error', message: 'Você já tem 5 cobranças indefinidas ativas no plano Grátis.', context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '5', used: '5', plan: 'free' } } };

    expect(planErrorOf(body)).toEqual({ code: PlanErrorCode.LimitReached, message: 'Você já tem 5 cobranças indefinidas ativas no plano Grátis.', fields: { limit: 5, used: 5, plan: PlanTier.Free } });
  });

  it('parses a plan-required error and ignores everything else', () => {
    expect(planErrorOf({ message: 'Links de pagamento fazem parte do plano Básico.', context: { code: 'PLAN_REQUIRED' } })).toEqual({ code: PlanErrorCode.Required, message: 'Links de pagamento fazem parte do plano Básico.', fields: {} });
    expect(planErrorOf({ message: 'x', context: { code: 'CHARGE_CLOSED' } })).toBeNull();
    expect(planErrorOf(null)).toBeNull();
  });
});
```

```ts
// packages/common/src/domain/api-error.test.ts — acrescentar (ou criar com este describe)
import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  it('keeps the API copy on a 402', () => {
    expect(apiErrorMessage(402, { message: 'Links de pagamento fazem parte do plano Básico.' }, 'fallback')).toBe('Links de pagamento fazem parte do plano Básico.');
    expect(apiErrorMessage(402, null, 'fallback')).toBe('fallback');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @receivy/common exec vitest run src/domain/plan.test.ts src/domain/api-error.test.ts`.

- [ ] **Step 3: Implementar**

Em `plan.ts` (fim do arquivo):

```ts
export const PLAN_NAMES: Record<PlanTier, string> = {
  [PlanTier.Free]: 'Grátis',
  [PlanTier.Basic]: 'Básico'
};

export function planName(tier: PlanTier): string {
  return PLAN_NAMES[tier];
}

export const enum PlanErrorCode {
  LimitReached = 'PLAN_LIMIT_REACHED',
  Required = 'PLAN_REQUIRED'
}

export type PlanErrorPayload = { code: PlanErrorCode; message: string; fields: { limit?: number; used?: number; plan?: PlanTier } };

type ErrorBody = { message?: unknown; context?: { code?: unknown; fields?: Record<string, unknown> } };

function numberField(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : undefined;

  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

/** The two 402s the clients act on; anything else is somebody else's error. */
export function planErrorOf(body: unknown): PlanErrorPayload | null {
  const error = body as ErrorBody | null;
  const code = error?.context?.code;

  if (code !== PlanErrorCode.LimitReached && code !== PlanErrorCode.Required) {
    return null;
  }

  const fields = error?.context?.fields ?? {};
  const plan = fields.plan === PlanTier.Free || fields.plan === PlanTier.Basic ? fields.plan : undefined;

  return {
    code,
    message: typeof error?.message === 'string' ? error.message : '',
    fields: {
      ...(numberField(fields.limit) !== undefined ? { limit: numberField(fields.limit) } : {}),
      ...(numberField(fields.used) !== undefined ? { used: numberField(fields.used) } : {}),
      ...(plan ? { plan } : {})
    }
  };
}
```

Em `api-error.ts`: `WITH_COPY = new Set([402, 409, 422, 429])` e `byStatus` ganha `402: 'Esse recurso faz parte do plano Básico.'`.

- [ ] **Step 4: Verificar** — testes verdes; `pnpm --filter @receivy/common lint` (tsc limpo); `pnpm --filter @receivy/api check-types` (o API compartilha o common).

---

### Task 2: Web — BFF, contrato OpenAPI, Stripe.js e env

**Files:**
- Modify: `packages/web/package.json` (`pnpm --filter @receivy/web add @stripe/stripe-js @stripe/react-stripe-js`), `packages/web/src/lib/financial-proxy.ts`, `packages/web/src/lib/openapi-contract.test.ts`, `packages/web/.env.example`
- Create: `packages/web/src/lib/stripe.ts`, `packages/web/src/lib/stripe.test.ts`

**Interfaces:**
- Produces: `stripePromise(): Promise<Stripe | null> | null` (null quando `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` está vazia; singleton), `stripeConfigured(): boolean`, `PLAN_BASIC_PRICE_CENTS: number` (0 quando ausente).

- [ ] **Step 1: Testes**

```ts
// packages/web/src/lib/stripe.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({ id: "stripe" })) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("stripe loader", () => {
  it("is off without a publishable key", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");

    const { stripeConfigured, stripePromise } = await import("./stripe");

    expect(stripeConfigured()).toBe(false);
    expect(stripePromise()).toBeNull();
  });

  it("loads Stripe.js once with the key", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_x");

    const { loadStripe } = await import("@stripe/stripe-js");
    const { stripePromise } = await import("./stripe");

    expect(stripePromise()).toBe(stripePromise());
    expect(loadStripe).toHaveBeenCalledWith("pk_test_x", { locale: "pt-BR" });
  });

  it("reads the display price as an integer of cents", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS", "1990");

    const { PLAN_BASIC_PRICE_CENTS } = await import("./stripe");

    expect(PLAN_BASIC_PRICE_CENTS).toBe(1990);
  });
});
```

Contrato (`openapi-contract.test.ts`): sem teste novo — o arquivo já falha se as rotas não estiverem cobertas; a task passa quando `pnpm --filter @receivy/web test` fica verde com as entradas abaixo.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**

```ts
// packages/web/src/lib/stripe.ts
import { loadStripe, type Stripe } from "@stripe/stripe-js";

const KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

/** Display only: the charge is whatever the Stripe price says. Zero hides the amount. */
export const PLAN_BASIC_PRICE_CENTS = Number.parseInt(process.env.NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS ?? "0", 10) || 0;

let promise: Promise<Stripe | null> | null = null;

export function stripeConfigured(): boolean {
  return KEY.length > 0;
}

/** One Stripe.js load per page; null when this environment has no key (local without Stripe, tests). */
export function stripePromise(): Promise<Stripe | null> | null {
  if (!stripeConfigured()) {
    return null;
  }

  if (!promise) {
    promise = loadStripe(KEY, { locale: "pt-BR" });
  }

  return promise;
}
```

`financial-proxy.ts` `ALLOWED_ROUTES` (depois das entradas de `payment-methods`):

```ts
  ["GET", /^plan$/], ["POST", /^plan\/(?:subscribe|cancel|resume|payment-method|payment-method\/confirm)$/], ["GET", /^plan\/invoices$/],
```

`openapi-contract.test.ts`: `WEB_EXCLUSIONS` += `"POST webhooks/stripe": "Stripe posts here server-to-server; the browser never calls it"`; `NATIVE_DEFERRED` += `"webhooks/stripe": "Stripe posts here server-to-server; no client ever calls it"`, `"plan/subscribe": "the plan is bought on the web only"`, `"plan/cancel": "managed on the web only"`, `"plan/resume": "managed on the web only"`, `"plan/payment-method": "managed on the web only"`, `"plan/payment-method/confirm": "managed on the web only"`; em `extractPathTemplates`, a regex de prefixos ganha `plan`: `/^(billings|payment-methods|charges|contacts|account|auth|devices|public|plan)\b/`. (`GET plan` e `GET plan/invoices` ficam cobertos pelo cliente mobile na Task 5 — até lá o teste Expo acusa; execute as Tasks 2→5 em sequência e aceite a janela, ou adicione as duas chamadas ao `financial/client.ts` já nesta task se preferir zero janela: `plan() { return request<PlanSummary>("plan"); }`, `planInvoices() { return request<{ invoices: PlanInvoice[] }>("plan/invoices"); }` — a Task 5 então só as consome.)

`.env.example` (web):

```
# Stripe.js for the paid plan page (public key, safe in the browser). Empty = plan page shows "unavailable".
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
# Display price of the Básico plan in cents (the real charge is the Stripe price). Empty = amount hidden.
NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS=
```

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test && pnpm --filter @receivy/web build`.

---

### Task 3: Web — `PlanPaywall`, travas no formulário de meios e no de contas, contador na lista

**Files:**
- Create: `packages/web/src/components/app/plan-paywall.tsx`, `plan-paywall.test.tsx`, `packages/web/src/lib/plan-summary.ts`
- Modify: `packages/web/src/components/forms/payment-method-form-screen.tsx` (+ `.test.tsx`), `packages/web/src/components/forms/billing-form-screen.tsx` (+ `.test.tsx`), `packages/web/src/components/screens/billings-screen.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `planErrorOf`, `PlanErrorCode`, `planName`, `PLAN_LIMITS`, `PlanTier`, `PlanSummary` (common).
- Produces: `PlanPaywall({ error, onClose }: { error: PlanErrorPayload; onClose: () => void })`; `loadPlanSummary(): Promise<PlanSummary | null>` (GET `/api/financial/plan` via `browserFetch`, `null` em erro).

- [ ] **Step 1: Testes**

```tsx
// packages/web/src/components/app/plan-paywall.test.tsx
import { PlanErrorCode, PlanTier } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PlanPaywall } from "@/components/app/plan-paywall";

afterEach(cleanup);

it("shows the API reason, the two benefits and a link to the plan page", () => {
  render(<PlanPaywall error={{ code: PlanErrorCode.LimitReached, message: "Você já tem 5 cobranças indefinidas ativas no plano Grátis.", fields: { limit: 5, used: 5, plan: PlanTier.Free } }} onClose={() => undefined} />);

  expect(screen.getByRole("dialog", { name: "Plano Básico" })).toBeInTheDocument();
  expect(screen.getByText("Você já tem 5 cobranças indefinidas ativas no plano Grátis.")).toBeInTheDocument();
  expect(screen.getByText("Até 30 cobranças indefinidas ativas")).toBeInTheDocument();
  expect(screen.getByText("Links de pagamento (InfinitePay e PagBank)")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver plano" })).toHaveAttribute("href", "/settings/plan");
});

it("closes on Agora não and on Escape", async () => {
  const onClose = vi.fn();

  render(<PlanPaywall error={{ code: PlanErrorCode.Required, message: "Links de pagamento fazem parte do plano Básico.", fields: {} }} onClose={onClose} />);

  await userEvent.click(screen.getByRole("button", { name: "Agora não" }));
  await userEvent.keyboard("{Escape}");

  expect(onClose).toHaveBeenCalledTimes(2);
});
```

Formulário de meios (`payment-method-form-screen.test.tsx`, casos novos; estenda o helper `api()` com `if (path === "/api/financial/plan") { return Response.json(plan); }` onde `plan` é um `PlanSummary` passado por opção, default Grátis `{ plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 0, limit: 5 } }, checkoutLinks: false, card: null }`):

```tsx
it("locks InfinitePay and PagBank on the free plan and opens the paywall on click", async () => {
  api();
  render(<PaymentMethodFormScreen />);

  const infinite = await screen.findByRole("radio", { name: /InfinitePay/ });

  expect(infinite).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(infinite);
  expect(await screen.findByRole("dialog", { name: "Plano Básico" })).toBeInTheDocument();
  expect(screen.getByText("Links de pagamento fazem parte do plano Básico.")).toBeInTheDocument();
});

it("keeps the chips enabled on the paid plan", async () => {
  api({ plan: { plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 30 } }, checkoutLinks: true, card: null } });
  render(<PaymentMethodFormScreen />);

  expect(await screen.findByRole("radio", { name: /PagBank/ })).not.toHaveAttribute("aria-disabled", "true");
});

it("opens the paywall when the API answers 402 anyway", async () => {
  api({ plan: basicPlan, save: Response.json({ message: "Links de pagamento fazem parte do plano Básico.", context: { code: "PLAN_REQUIRED" } }, { status: 402 }) });
  render(<PaymentMethodFormScreen />);
  // seleciona InfinitePay, preenche o handle e envia — reutilize os passos do teste existente de InfinitePay
  expect(await screen.findByRole("dialog", { name: "Plano Básico" })).toBeInTheDocument();
});
```

Formulário de contas (`billing-form-screen.test.tsx`, um caso novo seguindo o helper de fetch do arquivo): `POST /api/financial/billings` responde 402 `{ message: "Você já tem 5 cobranças indefinidas ativas no plano Grátis.", context: { code: "PLAN_LIMIT_REACHED", fields: { limit: "5", used: "5", plan: "free" } } }` → `await screen.findByRole("dialog", { name: "Plano Básico" })` com a mensagem; e o formulário NÃO limpa o rascunho (o usuário volta e salva como until, ou assina).

Lista (`billings-screen.test.tsx`, dois casos): com `/api/financial/plan` devolvendo `usage { used: 4, limit: 5 }` → `screen.getByRole("link", { name: "4 de 5 cobranças indefinidas" })` com `href="/settings/plan"`; com `used: 2` → nenhum link com esse nome.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**

```ts
// packages/web/src/lib/plan-summary.ts
import type { PlanSummary } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";

/** The plan as the API sees it, or null when it cannot be read: callers fall back to "no restriction shown". */
export async function loadPlanSummary(): Promise<PlanSummary | null> {
  try {
    const response = await browserFetch("/api/financial/plan");

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as PlanSummary;
  } catch {
    return null;
  }
}
```

```tsx
// packages/web/src/components/app/plan-paywall.tsx
"use client";

import { PLAN_LIMITS, type PlanErrorPayload, PlanTier } from "@receivy/common";
import { Crown } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

type PlanPaywallProps = { error: PlanErrorPayload; onClose: () => void };

const BENEFITS = [`Até ${PLAN_LIMITS[PlanTier.Basic].indefinite} cobranças indefinidas ativas`, "Links de pagamento (InfinitePay e PagBank)"];

/** One dialog for every 402 the plan raises: the API says why, this says what the Básico unlocks. */
export function PlanPaywall({ error, onClose }: PlanPaywallProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="plan-paywall-title" className="w-full max-w-md rounded-[20px] border border-outline bg-surface p-6">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
          <Crown size={22} aria-hidden="true" className="text-primary-strong" />
        </div>
        <h2 id="plan-paywall-title" className="m-0 font-display text-xl font-bold text-ink">Plano Básico</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{error.message}</p>
        <ul className="mt-4 flex list-none flex-col gap-2 p-0">
          {BENEFITS.map(benefit => (
            <li key={benefit} className="rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink">{benefit}</li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/settings/plan" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 font-bold text-on-primary">Ver plano</Link>
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl font-semibold text-muted">Agora não</button>
        </div>
      </div>
    </div>
  );
}
```

Formulário de meios (`payment-method-form-screen.tsx`): estado `const [plan, setPlan] = useState<PlanSummary | null>(null); const [paywall, setPaywall] = useState<PlanErrorPayload | null>(null);` carregado com `loadPlanSummary()` no mesmo `useEffect` do `/api/auth/me`; `const locked = plan ? !plan.checkoutLinks : false;` (sem resposta, não trava — a API trava). Nos chips InfinitePay/PagBank: `aria-disabled={locked}`, ícone `Lock` (lucide) ao lado do rótulo quando `locked`, e `onClick` que, quando `locked`, chama `setPaywall({ code: PlanErrorCode.Required, message: "Links de pagamento fazem parte do plano Básico.", fields: {} })` em vez de trocar o provider. No `submit`, antes do `throw`: `const planError = planErrorOf(payload); if (planError) { setPaywall(planError); return; }`. Render `{paywall ? <PlanPaywall error={paywall} onClose={() => setPaywall(null)} /> : null}`.

Formulário de contas (`billing-form-screen.tsx`): no `catch`/ramo `!response.ok` do save, `const payload = await response.clone().json().catch(() => null); const planError = planErrorOf(payload); if (planError) { setPaywall(planError); return; }` — sem limpar o rascunho; render do `PlanPaywall` igual acima.

Lista (`billings-screen.tsx`): `useEffect` com `loadPlanSummary().then(setPlan)`; no cabeçalho (ao lado do botão "+"), quando `plan && plan.usage.indefinite.used >= Math.ceil(plan.usage.indefinite.limit * 0.8)`:

```tsx
<Link href="/settings/plan" className="rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
  {`${plan.usage.indefinite.used} de ${plan.usage.indefinite.limit} cobranças indefinidas`}
</Link>
```

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/web check-types && lint && test && build`.

---

### Task 4: Web — `/settings/plan`: `PlanScreen`, `PlanCheckout`, faturas, linha no perfil

**Files:**
- Create: `packages/web/src/app/(protected)/settings/plan/page.tsx`, `packages/web/src/components/screens/plan-screen.tsx`, `plan-screen.test.tsx`, `packages/web/src/components/app/plan-checkout.tsx`, `plan-checkout.test.tsx`
- Modify: `packages/web/src/components/screens/profile-screen.tsx` (linha "Plano")

**Interfaces:**
- Consumes: `stripePromise`, `stripeConfigured`, `PLAN_BASIC_PRICE_CENTS` (T2); `loadPlanSummary` (T3); `planName`, `PlanTier`, `SubscriptionStatus`, `PlanSummary`, `PlanInvoice`, `formatMoney`, `momentText` (common).
- Produces: `PlanCheckout({ mode, clientSecret, onDone, onCancel })` com `mode: 'subscribe' | 'setup'`; `PlanScreen()`.

- [ ] **Step 1: Testes**

```tsx
// packages/web/src/components/app/plan-checkout.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PlanCheckout } from "@/components/app/plan-checkout";

const confirmPayment = vi.fn();
const confirmSetup = vi.fn();

vi.mock("@/lib/stripe", () => ({ stripePromise: () => Promise.resolve({}), stripeConfigured: () => true, PLAN_BASIC_PRICE_CENTS: 1990 }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment, confirmSetup }),
  useElements: () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("confirms a subscription without leaving the page and reports success", async () => {
  confirmPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
  const onDone = vi.fn();

  render(<PlanCheckout mode="subscribe" clientSecret="pi_secret" onDone={onDone} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirmar assinatura" }));

  expect(confirmPayment).toHaveBeenCalledWith({ elements: {}, redirect: "if_required" });
  expect(onDone).toHaveBeenCalledWith(undefined);
});

it("hands the saved payment method back after a setup", async () => {
  confirmSetup.mockResolvedValue({ setupIntent: { status: "succeeded", payment_method: "pm_1" } });
  const onDone = vi.fn();

  render(<PlanCheckout mode="setup" clientSecret="seti_secret" onDone={onDone} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Salvar cartão" }));

  expect(confirmSetup).toHaveBeenCalledWith({ elements: {}, redirect: "if_required" });
  expect(onDone).toHaveBeenCalledWith("pm_1");
});

it("shows Stripe's message on a declined card and keeps the form", async () => {
  confirmPayment.mockResolvedValue({ error: { message: "Seu cartão foi recusado." } });

  render(<PlanCheckout mode="subscribe" clientSecret="pi_secret" onDone={() => undefined} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirmar assinatura" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Seu cartão foi recusado.");
  expect(screen.getByTestId("payment-element")).toBeInTheDocument();
});
```

```tsx
// packages/web/src/components/screens/plan-screen.test.tsx
import { PlanTier, SubscriptionStatus, type PlanSummary } from "@receivy/common";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { PlanScreen } from "@/components/screens/plan-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripePromise: () => Promise.resolve({}), stripeConfigured: () => true, PLAN_BASIC_PRICE_CENTS: 1990 }));
vi.mock("@/components/app/plan-checkout", () => ({
  PlanCheckout: ({ mode, onDone }: { mode: string; onDone: (id?: string) => void }) => (
    <button type="button" onClick={() => onDone(mode === "setup" ? "pm_9" : undefined)}>{`checkout:${mode}`}</button>
  ),
}));

const FREE: PlanSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null };
const BASIC: PlanSummary = { plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 12, limit: 30 } }, checkoutLinks: true, card: { brand: "visa", last4: "4242" } };

function api(summaries: PlanSummary[]) {
  const sent: { path: string; init?: RequestInit }[] = [];
  let reads = 0;

  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    sent.push({ path, init });

    if (path === "/api/financial/plan" && !init?.method) {
      const summary = summaries[Math.min(reads, summaries.length - 1)]!;

      reads += 1;

      return Response.json(summary);
    }

    if (path === "/api/financial/plan/invoices") {
      return Response.json({ invoices: [{ id: "in_1", amountCents: 1990, status: "paid", paidAt: "2026-09-19T12:00:00.000Z", pdfUrl: "https://stripe.example/in_1.pdf" }] });
    }

    if (path === "/api/financial/plan/subscribe" || path === "/api/financial/plan/payment-method") {
      return Response.json({ clientSecret: "secret" });
    }

    return new Response(null, { status: 204 });
  });

  return sent;
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("describes the free plan with its usage and a subscribe button", async () => {
  api([FREE]);
  render(<PlanScreen />);

  expect(await screen.findByText("Grátis")).toBeInTheDocument();
  expect(screen.getByText("3 de 5 cobranças indefinidas")).toBeInTheDocument();
  expect(screen.getByText("R$ 19,90/mês")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assinar o Básico" })).toBeInTheDocument();
});

it("subscribes inline and polls until the plan turns basic", async () => {
  const sent = api([FREE, FREE, BASIC]);
  render(<PlanScreen />);

  await userEvent.click(await screen.findByRole("button", { name: "Assinar o Básico" }));
  await userEvent.click(await screen.findByRole("button", { name: "checkout:subscribe" }));

  expect(await screen.findByText("Confirmando pagamento…")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(4_100); });

  expect(await screen.findByText("Plano Básico ativo")).toBeInTheDocument();
  expect(sent.some(({ path, init }) => path === "/api/financial/plan/subscribe" && init?.method === "POST")).toBe(true);
});

it("shows the paid plan with card, renewal, invoices, cancel and card change", async () => {
  const sent = api([BASIC]);
  render(<PlanScreen />);

  expect(await screen.findByText("Básico")).toBeInTheDocument();
  expect(screen.getByText("visa •••• 4242")).toBeInTheDocument();
  expect(screen.getByText(/Renova em/)).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "PDF" })).toHaveAttribute("href", "https://stripe.example/in_1.pdf");

  await userEvent.click(screen.getByRole("button", { name: "Cancelar ao fim do período" }));
  expect(sent.some(({ path, init }) => path === "/api/financial/plan/cancel" && init?.method === "POST")).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Trocar cartão" }));
  await userEvent.click(await screen.findByRole("button", { name: "checkout:setup" }));
  expect(sent.some(({ path, init }) => path === "/api/financial/plan/payment-method/confirm" && init?.body === JSON.stringify({ paymentMethodId: "pm_9" }))).toBe(true);
});

it("offers Retomar when the cancel is scheduled", async () => {
  api([{ ...BASIC, cancelAtPeriodEnd: true }]);
  render(<PlanScreen />);

  expect(await screen.findByText(/Cancela em/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retomar" })).toBeInTheDocument();
});
```

Mais um caso em `plan-screen.test.tsx` com `vi.mock("@/lib/stripe", () => ({ stripeConfigured: () => false, stripePromise: () => null, PLAN_BASIC_PRICE_CENTS: 0 }))` num arquivo separado ou via `vi.doMock` + `resetModules`: sem chave → texto "Assinaturas indisponíveis neste ambiente." e nenhum botão "Assinar o Básico".

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**

```tsx
// packages/web/src/components/app/plan-checkout.tsx
"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type FormEvent, useState } from "react";
import { stripePromise } from "@/lib/stripe";

type Mode = "subscribe" | "setup";

type PlanCheckoutProps = { mode: Mode; clientSecret: string; onDone: (paymentMethodId?: string) => void; onCancel: () => void };

const GENERIC_ERROR = "Não deu para confirmar agora. Tente de novo.";

const APPEARANCE = { theme: "stripe" as const, variables: { colorPrimary: "#4b3fd6", borderRadius: "12px" } };

function CheckoutForm({ mode, onDone, onCancel }: Omit<PlanCheckoutProps, "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setBusy(true);
    setError("");

    // `if_required`: a card without 3DS never leaves the page; 3DS opens Stripe's own modal and comes back here.
    const result = mode === "subscribe" ? await stripe.confirmPayment({ elements, redirect: "if_required" }) : await stripe.confirmSetup({ elements, redirect: "if_required" });

    if (result.error) {
      setError(result.error.message ?? GENERIC_ERROR);
      setBusy(false);

      return;
    }

    if ("setupIntent" in result && result.setupIntent) {
      const method = result.setupIntent.payment_method;

      onDone(typeof method === "string" ? method : method?.id);

      return;
    }

    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-12 flex-1 rounded-xl border border-outline font-semibold text-ink">Voltar</button>
        <button type="submit" disabled={busy || !stripe} className="min-h-12 flex-1 rounded-xl bg-primary font-bold text-on-primary disabled:opacity-60">
          {mode === "subscribe" ? "Confirmar assinatura" : "Salvar cartão"}
        </button>
      </div>
    </form>
  );
}

/** Stripe's Payment Element inside our page: the card never touches our servers, and nobody is redirected. */
export function PlanCheckout({ mode, clientSecret, onDone, onCancel }: PlanCheckoutProps) {
  const stripe = stripePromise();

  if (!stripe) {
    return null;
  }

  return (
    <Elements stripe={stripe} options={{ clientSecret, locale: "pt-BR", appearance: APPEARANCE }}>
      <CheckoutForm mode={mode} onDone={onDone} onCancel={onCancel} />
    </Elements>
  );
}
```

```tsx
// packages/web/src/components/screens/plan-screen.tsx
"use client";

import { formatMoney, momentText, type PlanInvoice, type PlanSummary, PlanTier, planName } from "@receivy/common";
import { CreditCard, Crown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { PLAN_BASIC_PRICE_CENTS, stripeConfigured } from "@/lib/stripe";
import { PlanCheckout } from "@/components/app/plan-checkout";
import { Toast } from "@/components/app/toast";

const LOAD_ERROR = "Não foi possível carregar seu plano.";
const ACTION_ERROR = "Não foi possível atualizar seu plano.";
const UNAVAILABLE = "Assinaturas indisponíveis neste ambiente.";
const POLL_MS = 2_000;
const POLL_LIMIT = 15;

type Checkout = { mode: "subscribe" | "setup"; clientSecret: string } | null;

async function request<T>(path: string, init?: RequestInit, fallback = ACTION_ERROR): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;

  return (
    <div>
      <p className="m-0 text-sm text-ink">{`${used} de ${limit} cobranças indefinidas`}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
        <div className={`h-full rounded-full ${ratio >= 0.8 ? "bg-warning" : "bg-primary"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function PlanScreen() {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [invoices, setInvoices] = useState<PlanInvoice[]>([]);
  const [checkout, setCheckout] = useState<Checkout>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const [plan, page] = await Promise.all([request<PlanSummary>("/api/financial/plan", undefined, LOAD_ERROR), request<{ invoices: PlanInvoice[] }>("/api/financial/plan/invoices", undefined, LOAD_ERROR)]);

      setSummary(plan);
      setInvoices(page.invoices);
      setError("");

      return plan;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : LOAD_ERROR);

      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The webhook is the writer: after the Payment Element confirms, the page waits for the row to turn basic.
  useEffect(() => {
    if (!confirming) {
      return;
    }

    const timer = window.setInterval(async () => {
      polls.current += 1;

      const plan = await load();

      if (plan?.plan === PlanTier.Basic || polls.current >= POLL_LIMIT) {
        window.clearInterval(timer);
        setConfirming(false);
        polls.current = 0;

        if (plan?.plan === PlanTier.Basic) {
          setToast("Plano Básico ativo");
        }
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [confirming, load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");

    try {
      await fn();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function subscribe() {
    return act(async () => {
      const { clientSecret } = await request<{ clientSecret: string }>("/api/financial/plan/subscribe", { method: "POST" });

      setCheckout({ mode: "subscribe", clientSecret });
    });
  }

  function changeCard() {
    return act(async () => {
      const { clientSecret } = await request<{ clientSecret: string }>("/api/financial/plan/payment-method", { method: "POST" });

      setCheckout({ mode: "setup", clientSecret });
    });
  }

  function onCheckoutDone(paymentMethodId?: string) {
    const mode = checkout?.mode;

    setCheckout(null);

    if (mode === "subscribe") {
      setConfirming(true);

      return;
    }

    if (paymentMethodId) {
      void act(async () => {
        await request<void>("/api/financial/plan/payment-method/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentMethodId }) });
        setToast("Cartão atualizado");
      });
    }
  }

  if (!summary) {
    return <p className="p-4 text-sm text-muted">{error || "Carregando…"}</p>;
  }

  const paid = summary.plan === PlanTier.Basic;
  const stripeOn = stripeConfigured();
  const when = summary.currentPeriodEnd ? momentText(summary.currentPeriodEnd) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="rounded-[20px] border border-outline bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="m-0 font-display text-lg font-bold text-ink">Plano</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${paid ? "bg-primary-soft text-primary-strong" : "bg-surface-muted text-muted"}`}>{planName(summary.plan)}</span>
        </div>
        <div className="mt-4">
          <UsageBar used={summary.usage.indefinite.used} limit={summary.usage.indefinite.limit} />
        </div>
        {paid && when ? <p className="mt-3 text-sm text-muted">{summary.cancelAtPeriodEnd ? `Cancela em ${when}` : `Renova em ${when}`}</p> : null}
        {paid && summary.card ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-ink">
            <CreditCard size={16} aria-hidden="true" />
            {`${summary.card.brand} •••• ${summary.card.last4}`}
          </p>
        ) : null}
        {!paid && PLAN_BASIC_PRICE_CENTS > 0 ? <p className="mt-3 text-sm text-muted">{`${formatMoney({ amountCents: PLAN_BASIC_PRICE_CENTS, currency: "BRL" })}/mês`}</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        {confirming ? <p role="status" className="mt-3 text-sm text-muted">Confirmando pagamento…</p> : null}
        {checkout ? (
          <div className="mt-4">
            <PlanCheckout mode={checkout.mode} clientSecret={checkout.clientSecret} onDone={onCheckoutDone} onCancel={() => setCheckout(null)} />
          </div>
        ) : null}
        {!checkout && !confirming ? (
          <div className="mt-4 flex flex-col gap-2">
            {!stripeOn ? <p className="m-0 text-sm text-muted">{UNAVAILABLE}</p> : null}
            {!paid && stripeOn ? (
              <button type="button" onClick={() => void subscribe()} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-on-primary disabled:opacity-60">
                <Crown size={18} aria-hidden="true" />
                Assinar o Básico
              </button>
            ) : null}
            {paid && stripeOn ? (
              <>
                <button type="button" onClick={() => void act(() => request<void>(summary.cancelAtPeriodEnd ? "/api/financial/plan/resume" : "/api/financial/plan/cancel", { method: "POST" }))} disabled={busy} className="min-h-12 rounded-xl border border-outline font-semibold text-ink">
                  {summary.cancelAtPeriodEnd ? "Retomar" : "Cancelar ao fim do período"}
                </button>
                <button type="button" onClick={() => void changeCard()} disabled={busy} className="min-h-12 rounded-xl border border-outline font-semibold text-ink">Trocar cartão</button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>
      {invoices.length ? (
        <section className="rounded-[20px] border border-outline bg-surface p-5">
          <h3 className="m-0 text-base font-bold text-ink">Faturas</h3>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {invoices.map(invoice => (
              <li key={invoice.id} className="flex items-center justify-between text-sm">
                <span className="text-muted">{invoice.paidAt ? momentText(invoice.paidAt) : invoice.status}</span>
                <span className="font-semibold text-ink">{formatMoney({ amountCents: invoice.amountCents, currency: "BRL" })}</span>
                {invoice.pdfUrl ? <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary">PDF</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {toast ? <Toast message={toast} onDismiss={() => setToast("")} /> : null}
    </div>
  );
}
```

`app/(protected)/settings/plan/page.tsx`:

```tsx
import { AppShell } from "@/components/app/app-shell";
import { PlanScreen } from "@/components/screens/plan-screen";

export default function PlanPage() {
  return (
    <AppShell activePath="/settings" title="Plano" back="/settings">
      <PlanScreen />
    </AppShell>
  );
}
```

`profile-screen.tsx`: nova `<Row icon={Crown} tone="primary" label="Gerenciar plano" title="Plano" subtitle="Grátis ou Básico, limites e cobrança" href="/settings/plan" />` logo após a linha "Meios de pagamento" (importar `Crown` de lucide-react; um teste do perfil, se existir, ganha `expect(screen.getByRole("link", { name: "Gerenciar plano" })).toHaveAttribute("href", "/settings/plan")`).

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/web check-types && lint && test && build`.

---

### Task 5: Mobile — cliente `plan()` e card do plano no Perfil

**Files:**
- Modify: `packages/mobile/src/financial/client.ts`, `packages/mobile/src/components/screens/profile-screen.tsx`, `profile-screen.test.tsx` (existente; criar se não houver)

**Interfaces:**
- Produces: `financialClient.plan(): Promise<PlanSummary>`, `financialClient.planInvoices(): Promise<{ invoices: PlanInvoice[] }>`; `ProfileScreenProps.plans?: Pick<FinancialClient, "plan">`.

- [ ] **Step 1: Testes**

```tsx
// packages/mobile/src/components/screens/profile-screen.test.tsx — casos novos (reutilize o helper `client`/render do arquivo)
import { PlanTier, SubscriptionStatus } from "@receivy/common";

it("shows the free plan card with its usage and no purchase action", async () => {
  const plans = { plan: jest.fn().mockResolvedValue({ plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null }) };

  await render(<ProfileScreen client={client()} plans={plans} />);

  expect(await screen.findByText("Plano Grátis")).toBeTruthy();
  expect(screen.getByText("3 de 5 cobranças indefinidas")).toBeTruthy();
  expect(screen.getByText("Gerencie seu plano no site.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Assinar/ })).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
});

it("shows the paid plan with its renewal date", async () => {
  const plans = { plan: jest.fn().mockResolvedValue({ plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 12, limit: 30 } }, checkoutLinks: true, card: { brand: "visa", last4: "4242" } }) };

  await render(<ProfileScreen client={client()} plans={plans} />);

  expect(await screen.findByText("Plano Básico")).toBeTruthy();
  expect(screen.getByText(/Renova em/)).toBeTruthy();
});

it("stays quiet when the plan cannot be read", async () => {
  const plans = { plan: jest.fn().mockRejectedValue(new Error("offline")) };

  await render(<ProfileScreen client={client()} plans={plans} />);

  expect(await screen.findByText("Meios de pagamento")).toBeTruthy();
  expect(screen.queryByText(/Plano /)).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**

`financial/client.ts` (junto dos outros métodos; importar `PlanInvoice`, `PlanSummary` de `@receivy/common`):

```ts
    plan() {
      return request<PlanSummary>("plan");
    },
    planInvoices() {
      return request<{ invoices: PlanInvoice[] }>("plan/invoices");
    },
```

`profile-screen.tsx`: prop `plans?: Pick<FinancialClient, "plan">` com default `financialClient` (import de `@/financial/client`); estado `const [plan, setPlan] = useState<PlanSummary | null>(null);` carregado em `useEffect(() => { plans.plan().then(setPlan).catch(() => setPlan(null)); }, [plans]);`. Card acima de "GERENCIAMENTO", só quando `plan`:

```tsx
{plan ? (
  <Section title="PLANO">
    <View className="rounded-[20px] border border-outline bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-ink">{`Plano ${planName(plan.plan)}`}</Text>
        <Image source={ICONS.star} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
      </View>
      <Text className="mt-2 text-sm text-ink">{`${plan.usage.indefinite.used} de ${plan.usage.indefinite.limit} cobranças indefinidas`}</Text>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
        <View className={plan.usage.indefinite.used / plan.usage.indefinite.limit >= 0.8 ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${Math.min(100, (plan.usage.indefinite.used / Math.max(1, plan.usage.indefinite.limit)) * 100)}%` }} />
      </View>
      {plan.plan === PlanTier.Basic && plan.currentPeriodEnd ? (
        <Text className="mt-2 text-sm text-muted">{plan.cancelAtPeriodEnd ? `Cancela em ${momentText(plan.currentPeriodEnd)}` : `Renova em ${momentText(plan.currentPeriodEnd)}`}</Text>
      ) : null}
      <Text className="mt-2 text-xs text-muted">Gerencie seu plano no site.</Text>
    </View>
  </Section>
) : null}
```

(`ICONS` local ganha `star: require("../../../assets/images/auth/star.svg")` — o asset já existe; nada de `Linking`, botão ou link.)

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/mobile check-types && lint && test`; `pnpm --filter @receivy/web test` (o teste de contrato Expo agora vê `plan` e `plan/invoices`).

---

### Task 6: Mobile — travas nos chips e texto dos 402

**Files:**
- Modify: `packages/mobile/src/components/forms/payment-method-form-screen.tsx` (+ `.test.tsx`), `packages/mobile/src/components/forms/billing-form-screen.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `financialClient.plan()` (T5), `FinancialRequestError.status`.
- Produces: `PLAN_SITE_NOTE = "Limite do plano grátis. Gerencie seu plano no site."` exportado de `packages/mobile/src/financial/plan-copy.ts` (novo, 3 linhas) e usado nos dois formulários.

- [ ] **Step 1: Testes**

```tsx
// payment-method-form-screen.test.tsx — casos novos (o helper `client()` ganha `plan: jest.fn().mockResolvedValue(summary)`)
it("disables InfinitePay and PagBank on the free plan and explains why", async () => {
  await render(<PaymentMethodFormScreen client={client([], freeSummary)} />);

  const chip = await screen.findByRole("radio", { name: /InfinitePay/ });

  expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(chip);
  expect(screen.getByRole("alert")).toHaveTextContent("Limite do plano grátis. Gerencie seu plano no site.");
  expect(screen.queryByRole("button", { name: /Abrir configurações/ })).toBeNull();
});

it("keeps the chips enabled on the paid plan", async () => {
  await render(<PaymentMethodFormScreen client={client([], basicSummary)} />);

  expect((await screen.findByRole("radio", { name: /PagBank/ })).props.accessibilityState?.disabled).toBeFalsy();
});

it("shows the site note when the API answers 402 on save", async () => {
  const api = client([], basicSummary);

  api.savePaymentMethod.mockRejectedValue(new FinancialRequestError("Links de pagamento fazem parte do plano Básico.", 402));
  await render(<PaymentMethodFormScreen client={api} />);
  // selecionar InfinitePay, digitar o handle e salvar como no teste existente
  expect(await screen.findByRole("alert")).toHaveTextContent("Links de pagamento fazem parte do plano Básico. Gerencie seu plano no site.");
});
```

```tsx
// billing-form-screen.test.tsx — caso novo
it("explains the plan limit and keeps the draft when the API answers 402", async () => {
  const api = client();

  api.createBilling.mockRejectedValue(new FinancialRequestError("Você já tem 5 cobranças indefinidas ativas no plano Grátis.", 402));
  await render(<BillingFormScreen client={api} onSaved={jest.fn()} />);
  // preencher e salvar como no teste de erro existente
  expect(await screen.findByRole("alert")).toHaveTextContent("Você já tem 5 cobranças indefinidas ativas no plano Grátis. Gerencie seu plano no site.");
  expect(screen.queryByRole("button", { name: /Tentar de novo/ })).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar**

```ts
// packages/mobile/src/financial/plan-copy.ts
export const PLAN_SITE_NOTE = "Limite do plano grátis. Gerencie seu plano no site.";
export const PLAN_SITE_SUFFIX = " Gerencie seu plano no site.";
```

`payment-method-form-screen.tsx`: `client` prop ganha `"plan"` no `Pick`; `const [plan, setPlan] = useState<PlanSummary | null>(null);` carregado no `useEffect` inicial (`client.plan().then(setPlan).catch(() => setPlan(null))`); `const locked = plan ? !plan.checkoutLinks : false;`. Nos chips InfinitePay/PagBank: `accessibilityState={{ selected, disabled: locked }}`, `onPress={() => { if (locked) { setError(PLAN_SITE_NOTE); setErrorStatus(402); return; } setProvider(...) }}` e classe `opacity-60` quando `locked`. No `catch` do save: `setError(reason instanceof FinancialRequestError && reason.status === 402 ? `${reason.message}${PLAN_SITE_SUFFIX}` : reason instanceof Error ? reason.message : SAVE_ERROR)`. O botão "Abrir configurações da InfinitePay" continua condicionado a `errorStatus === 422`.

`billing-form-screen.tsx` `save` catch: mesma composição `status === 402 ? `${message}${PLAN_SITE_SUFFIX}`` e `setAttempt(null)` (já acontece para `< 500`).

- [ ] **Step 4: Verificar** — `pnpm --filter @receivy/mobile check-types && lint && test`.

---

### Task 7: QA e verificação final

**Files:**
- Modify: `docs/manual-qa-script.md` (§24 ganha a parte de UI), `docs/environments.md` (as duas envs `NEXT_PUBLIC_*` do web, uma linha cada)

- [ ] **Step 1:** §24: (a) web local com `PLAN_BILLING=fake` e sem chave Stripe: `/settings/plan` mostra Grátis, uso e "Assinaturas indisponíveis neste ambiente."; 6ª indefinida em `/billings/new` abre o paywall "Plano Básico" com a mensagem da API; chip InfinitePay com cadeado abre o paywall; (b) web dev com `PLAN_BILLING=live`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` e `stripe listen`: Assinar o Básico → Payment Element → cartão `4242 4242 4242 4242` → "Confirmando pagamento…" → "Plano Básico ativo" em até 30 s; cartão `4000 0000 0000 0002` → alerta do Stripe e o formulário fica; Trocar cartão; Cancelar ao fim do período → "Cancela em …" e Retomar; faturas com PDF; (c) mobile: card "Plano Grátis" com uso e "Gerencie seu plano no site."; chips desabilitados; 6ª indefinida mostra a mensagem com o sufixo, sem botão.
- [ ] **Step 2:** `pnpm --filter @receivy/common lint && test`; `pnpm --filter @receivy/web check-types && lint && test && build`; `pnpm --filter @receivy/mobile check-types && lint && test`; `pnpm --filter @receivy/api check-types` (common compartilhado); `grep -rn "'Grátis'\|\"Grátis\"\|'Básico'\|\"Básico\"" packages/web/src packages/mobile/src` → só via `planName` (nenhum literal em componentes além do sufixo/nota do mobile).

---

## Auto-revisão (feita ao escrever)

- **Spec §7**: página (T4), paywall (T3), contador ≥ 80 % (T3), chips com cadeado (T3), Payment Element inline (T4). **§8**: card no Perfil (T5), 402 → texto sem link (T6), chips desabilitados (T6). **§6.3** (polling 2 s/30 s, `if_required`): T4. **§11** testes: cada task. Preço de exibição: ruling `NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS` (T2), a API não expõe preço.
- **Nomes**: `planName`, `planErrorOf`, `PlanErrorCode`, `PlanErrorPayload` (T1) usados em T3/T4; `stripePromise`, `stripeConfigured`, `PLAN_BASIC_PRICE_CENTS` (T2) em T4; `loadPlanSummary` (T3) em T3/T4; `PlanCheckout({ mode, clientSecret, onDone, onCancel })` (T4); `financialClient.plan/planInvoices` (T5) em T5/T6; `PLAN_SITE_NOTE`/`PLAN_SITE_SUFFIX` (T6).
- **Janela**: o teste de contrato Expo cobra `plan`/`plan/invoices` entre T2 e T5 — T2 documenta a opção de já adicionar os dois métodos ao cliente mobile.
- **Fora**: IAP, WhatsApp, anual, trial, preço vindo da API.
