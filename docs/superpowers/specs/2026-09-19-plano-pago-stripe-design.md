# Plano pago (Básico) com Stripe — design

Data: 2026-09-19. Estado: aprovado em conversa, aguardando revisão do dono antes do plano de execução.

## 1. Objetivo

Cobrar um plano **Básico** mensal para quem passa dos limites do plano **Grátis**. O limite ancora no que custa
para o Receivy manter: contas a receber **indefinidas** ativas (materialização mês a mês). Links de pagamento
(InfinitePay, PagBank) ficam exclusivos do Básico. WhatsApp e um plano Intermediário ficam para depois; compra
dentro do app (IAP) fica para uma fase futura. Assinatura só no web, via Stripe com UI própria (Payment Element),
sem Stripe Checkout nem Customer Portal.

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| Onde compra | Só no web. O app mostra plano e uso; nenhum botão ou link de compra (Apple 3.1.1). IAP/RevenueCat numa fase futura. |
| O que conta | `billings` do dono, a receber, `recurrence = indefinite`, `state = active`. Once, until (parceladas), contas a pagar, registros, pausadas e encerradas não contam. |
| Tetos | Grátis: 5 indefinidas, sem link de pagamento. Básico: 30 indefinidas, links liberados. |
| No limite | A 6ª (ou 31ª) indefinida é bloqueada com 402. Cadastrar método InfinitePay/PagBank no Grátis é bloqueado com 402. |
| Ao perder o plano | Excedentes acima de 5 pausam (mais recentes primeiro) e toda billing ativa cujo método é InfinitePay/PagBank pausa. Nada reativa sozinho. |
| Lançamento | Ninguém é pausado no dia 1: quem já está acima do teto só não cria novas. O pause automático só roda na transição basic → free. |
| Ciclo | Mensal, sem trial, cartão (assinatura no Stripe não recorre por Pix/boleto). Um preço só. |
| Abordagem | Stripe direto: Subscription `default_incomplete` + Payment Element no web; webhook como fonte da verdade; gestão com endpoints próprios. |
| Dependências aprovadas | `stripe` (api); `@stripe/stripe-js`, `@stripe/react-stripe-js` (web). |

Fora de escopo: proração, cupons, anual, trial, IAP, WhatsApp, plano Intermediário, reativação automática após
reassinar, migração de assinantes entre provedores.

## 3. Modelo

### 3.1 `subscriptions` (uma por dono)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid | |
| `owner_id` | uuid, único | dono da assinatura |
| `provider` | `stripe` | `const enum SubscriptionProvider`; RevenueCat entra aqui na fase IAP |
| `stripe_customer_id` | varchar(64) | criado no primeiro assinar; nunca apagado |
| `stripe_subscription_id` | varchar(64), nulo | nulo depois de `canceled` até uma nova assinatura |
| `plan` | `basic` | `const enum PlanTier { Free, Basic }` — `free` nunca é gravado |
| `status` | `incomplete \| active \| past_due \| canceled` | `const enum SubscriptionStatus`, espelha o Stripe |
| `current_period_end` | timestamptz, nulo | |
| `cancel_at_period_end` | boolean | |
| `last_event_id` | varchar(64), nulo | idempotência do webhook |
| `last_event_at` | timestamptz, nulo | ordem dos eventos |
| `created_at`, `updated_at` | | |

Plano efetivo é derivado, nunca gravado no usuário:

```
planOf(subscription | null, now) =
  basic  se status ∈ { active, past_due } e (current_period_end ausente ou > now)
  free   caso contrário
```

### 3.2 Limites (`@receivy/common`, `domain/plan.ts`)

```ts
export const enum PlanTier { Free = 'free', Basic = 'basic' }

export const PLAN_LIMITS: Record<PlanTier, { indefinite: number; checkoutLinks: boolean }> = {
  [PlanTier.Free]: { indefinite: 5, checkoutLinks: false },
  [PlanTier.Basic]: { indefinite: 30, checkoutLinks: true }
};
```

Intermediário entra acrescentando uma linha e um preço.

### 3.3 Contagem

`BillingRepository.countActiveIndefinite(db, ownerId)`: a receber (`payer = person`, sem `kind = registro`),
`recurrence = indefinite`, `state = active`. Lida dentro da mesma transação que cria/reativa, depois de um
`SELECT … FOR UPDATE` na linha do dono em `users`, para duas criações simultâneas não furarem o teto.

## 4. Enforcement (API)

Erros novos em `plans/errors.ts`, mapeados em `api.ts`:

- `PlanLimitReachedError` → 402 `PLAN_LIMIT_REACHED`, `context: { limit, used, plan }`, mensagem
  "Você já tem N cobranças indefinidas ativas no plano X."
- `PlanRequiredError` → 402 `PLAN_REQUIRED`, mensagem "Links de pagamento fazem parte do plano Básico."

Pontos que checam (serviço, dentro da transação):

| Ação | Regra |
|---|---|
| Criar billing a receber indefinida | `used + 1 > limit` → `PlanLimitReachedError` |
| Reativar (paused → active) uma indefinida a receber | idem |
| Editar billing para `indefinite` (se a edição permitir) | idem |
| Criar método InfinitePay/PagBank | `!limits.checkoutLinks` → `PlanRequiredError` |
| Editar método Pix para InfinitePay/PagBank | idem |

Contas a pagar, until, parceladas, registros e Pix nunca bloqueiam. `ensurePaymentLink` não checa plano: um
método só existe se o plano permitiu criá-lo; o downgrade (abaixo) pausa as billings que dependem dele.

## 5. Downgrade

`PlanService.applyDowngrade(ownerId, now)` roda uma vez por transição `basic → free` (chamado pelo webhook; nunca
no lançamento). Em uma transação:

1. Lista indefinidas a receber ativas do dono ordenadas por `created_at desc`; pausa as que excedem 5.
2. Lista billings ativas do dono cujo `payment_method_id` aponta para um método InfinitePay/PagBank; pausa todas.
3. Cada pause grava `billing.paused { reason: 'plan' }` (mesma trilha do pause manual).
4. Depois do commit: um e-mail + push ao dono "Seu plano Básico acabou" com a lista do que pausou.

Métodos InfinitePay/PagBank não são arquivados nem revogados: ao reassinar, o dono reativa as billings uma a uma
(a reativação passa pelo limite de novo). Charges já materializadas com link seguem pagáveis.

## 6. Integração Stripe

### 6.1 Vendor `vendors/stripe/`

`createStripeClient(secretKey)` sobre o SDK `stripe`, expondo: `createCustomer`, `createSubscription`,
`getSubscription`, `updateSubscription` (cancel/resume at period end), `createSetupIntent`,
`setDefaultPaymentMethod`, `getDefaultPaymentMethod` (brand/last4), `listInvoices`, `constructEvent(rawBody,
signature, secret)`. Erros do SDK viram uniões de resultado (`{ status: 'ok' | 'unavailable' | 'rejected' }`),
como nos outros vendors. Um `fakeStripe` para `PLAN_BILLING=fake`: assinar vira `active` na hora, cancelar vira
`canceled`, sem rede.

### 6.2 Variáveis

| var | onde |
|---|---|
| `PLAN_BILLING = live \| fake \| disabled` | api (`disabled` = endpoints respondem 503 `PLAN_BILLING_DISABLED`; limites do Grátis valem mesmo assim) |
| `STRIPE_SECRET_KEY` | api |
| `STRIPE_WEBHOOK_SECRET` | api |
| `STRIPE_PRICE_BASIC` | api (id do preço mensal) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web |

### 6.3 Assinar

`POST /plan/subscribe` (sessão):

1. Garante `stripe_customer_id` (cria Customer com e-mail, nome e `metadata.ownerId`; grava a linha
   `subscriptions` com `status = incomplete` se não existir).
2. Se já há assinatura `active`/`past_due` → 409 `PLAN_ALREADY_ACTIVE`.
3. `createSubscription({ customer, price: STRIPE_PRICE_BASIC, payment_behavior: 'default_incomplete',
   payment_settings: { save_default_payment_method: 'on_subscription' }, expand: ['latest_invoice.payment_intent'] })`.
4. Grava `stripe_subscription_id`, `status = incomplete`; devolve `{ clientSecret }` do PaymentIntent.

Web: Payment Element com o `clientSecret`; `stripe.confirmPayment({ redirect: 'if_required' })`. Cartão sem 3DS
não sai da página; com 3DS o Stripe abre o desafio em modal. Ao resolver, o web faz `GET /plan` a cada 2 s por
até 30 s até `active` (o webhook é quem grava). Se não chegar, mostra "Confirmando pagamento…" e deixa a página
aberta; o e-mail de boas-vindas fecha o ciclo.

### 6.4 Webhook `POST /webhooks/stripe`

Corpo cru (`body: string`), cabeçalho `stripe-signature`, sem autorizador. Sequência:

1. `constructEvent` falha → 400, nada gravado.
2. Tipos tratados: `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
   Outros → 200 sem gravar.
3. Nunca confia no payload: relê `getSubscription(id)` e grava `status`, `current_period_end`,
   `cancel_at_period_end`, `last_event_id`, `last_event_at`.
4. Idempotência: `event.id === last_event_id` → 200 `replayed`; `event.created < last_event_at` → releitura
   ainda vale (o estado relido é o atual), só não regride timestamps.
5. Transição observada `basic → free` (status relido `canceled`, ou `past_due` com `current_period_end < now`)
   → `applyDowngrade` + notificação. Transição `→ active` a partir de `incomplete` → evento `plan.subscribed` +
   e-mail de boas-vindas. `invoice.payment_failed` → evento `plan.payment_failed` + e-mail "Atualize o cartão".
6. Erro de banco ou Stripe indisponível na releitura → 500 (Stripe reenvia).

### 6.5 Gestão (UI própria, sem Customer Portal)

| Rota | Faz |
|---|---|
| `GET /plan` | `{ plan, status, currentPeriodEnd, cancelAtPeriodEnd, usage: { indefinite: { used, limit } }, checkoutLinks, card: { brand, last4 } \| null }` |
| `POST /plan/subscribe` | acima |
| `POST /plan/cancel` | `cancel_at_period_end = true` |
| `POST /plan/resume` | `cancel_at_period_end = false` (só antes do fim do período) |
| `POST /plan/payment-method` | `createSetupIntent` → `{ clientSecret }`; o web confirma com o Payment Element; `POST /plan/payment-method/confirm { paymentMethodId }` → `setDefaultPaymentMethod` |
| `GET /plan/invoices` | últimas 12: `{ id, amountCents, status, paidAt, pdfUrl }` (`hosted_invoice_url` só como link de PDF) |

Falha de pagamento: Smart Retries do Stripe; `past_due` mantém o Básico até `current_period_end`; depois o
próprio Stripe cancela → downgrade.

## 7. Web

- `/settings/plan`: plano, barra "12 de 30 cobranças indefinidas", cartão, próximo vencimento, ações
  (Assinar / Cancelar ao fim do período / Retomar / Trocar cartão), faturas. Payment Element inline na página.
- `PlanPaywall` (`components/app`): aberto por qualquer 402 `PLAN_LIMIT_REACHED | PLAN_REQUIRED`, mostra o motivo
  vindo da API e o botão para `/settings/plan`.
- Cabeçalho da lista de contas: contador de uso quando ≥ 80% do teto.
- Formulário de meio de pagamento: chips InfinitePay/PagBank com cadeado no Grátis (o clique abre o paywall).

## 8. Mobile (somente leitura)

- Card do plano em Perfil: plano, uso, vencimento.
- 402 vira alerta "Limite do plano grátis. Gerencie seu plano no site." — sem botão nem link.
- Chips InfinitePay/PagBank desabilitados no Grátis com o mesmo texto.

## 9. Notificações e eventos

E-mail + push ao dono: assinatura ativa; pagamento falhou; plano encerrado (com a lista do que pausou).
Eventos: `plan.subscribed`, `plan.payment_failed`, `plan.canceled`, `billing.paused { reason: 'plan' }`.

## 10. Estrutura de pastas (API)

```
src/plans/
  endpoints/   get.ts subscribe.ts cancel.ts resume.ts payment-method.ts invoices.ts
  repositories/ subscription.ts
  services/    plan.ts (planOf, assert limits, applyDowngrade)
  schemas/     subscription.ts
  errors.ts routes.ts provider.ts
src/webhooks/endpoints/stripe.ts
src/vendors/stripe/ client.ts types.ts fake.ts
```

`BillingService` e `PaymentMethodService` recebem `PlanService` (Factory) para as checagens.

## 11. Testes

- common: `planOf`, `PLAN_LIMITS`.
- API unit: limite na criação/reativação/edição (com lock), `PLAN_REQUIRED` no método, `applyDowngrade`
  (ordem, billings com link, evento), webhook (assinatura inválida, repetido, fora de ordem, releitura,
  transições), fake Stripe.
- Integração `test/financial/plan.spec.ts` (`PLAN_BILLING=fake`): assinar → limite sobe para 30 → 31ª bloqueia →
  cancelar → downgrade pausa excedentes e billings com link → reativar uma passa pelo limite.
- Web: paywall a partir do 402; página do plano com `@stripe/react-stripe-js` mockado.
- Mobile: card e alerta.
- Docs: `environments.md`, `api-errors.md`, `notifications.md`, `manual-qa-script.md` §24 (cartão `4242 4242
  4242 4242`, `stripe listen --forward-to localhost:<porta>/webhooks/stripe`).

## 12. Deploy (dono)

Produto e preço no dashboard do Stripe; endpoint de webhook por stage com os 5 tipos de evento; as envs da
seção 6.2; `stripe listen` no local. Nenhuma migração manual: o EZ4 cria `subscriptions`.

## 13. Fase futura (fora deste desenho)

IAP com RevenueCat no app (provider `revenuecat` na mesma tabela), plano Intermediário com WhatsApp, anual.
