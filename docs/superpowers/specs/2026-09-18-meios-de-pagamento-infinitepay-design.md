# Meios de pagamento: `payment_methods` genérica e InfinitePay como primeiro provider

Data: 2026-09-18. Depende do bloco 9 / 9.1 (chave por contato, `payment_method_id` na billing) já em produção.

## Problema

Hoje o único meio é a chave Pix própria (ou de um contato), e a baixa é sempre humana: comprovante, declaração ou "marcar pago". A tela se chama "Minhas Chaves Pix" e a tabela `payment_methods` tem colunas com nome de Pix (`pix_key_type`, `pix_key`), embora já exista `type = 'pix'` e um snapshot congelado na charge.

Queremos que o dono cadastre outros meios, começando pela InfinitePay: só um handle (InfiniteTag), a cobrança ganha um link de checkout (Pix ou cartão), e a InfinitePay avisa quando foi pago. A charge é baixada sozinha.

## Decisões

- **Sem tabela `integrations`.** A InfinitePay não tem credencial nem webhook global: o `webhook_url` vai em cada link. Uma tabela de integrações só entra com o primeiro provider que exija OAuth, segredo ou registro de webhook global (Mercado Pago, Stripe). Sem abstração antes do terceiro caso.
- **`payment_methods` fica genérica**: `provider` + `kind` + `value` + `label`. As colunas com nome de Pix saem, com backfill.
- **Link por charge**, criado na materialização em best-effort. Falha não bloqueia a charge; o aviso só sai com link pronto.
- **Webhook nunca é confiado.** Ele só dispara um `payment_check` server-to-server; o mesmo finalizador atende o retorno do pagador pela `redirect_url`.
- **Comprovante continua** na página pública, como fallback discreto abaixo do botão "Pagar". "Marcar pago" do dono não muda.
- **Handle validado ao salvar** com um link de sondagem de R$ 1,00 (não há DELETE de link na API; o link fica órfão, ninguém paga).
- **InfinitePay só em meio próprio.** `contact_id` + `infinitepay` é 400: não se paga alguém pelo handle dele.

## Fora de escopo

- Renomear `SharingState.PixRequired` / string `pix_required`: cosmético, toca três pacotes, follow-up.
- Cancelar link na InfinitePay (a API não oferece). Charge cancelada e paga pelo link vira evento + push ao dono, sem mudar estado.
- Parcelamento, taxas, repasse: o valor vai inteiro; `paid_amount` só é registrado.
- QR Code / BR Code Pix próprio, outros providers, `first-share-pix` com InfinitePay (continua só Pix, com atalho "Outros meios").

## Fatos da API InfinitePay (verificados em 2026-09-18)

- `POST https://api.checkout.infinitepay.io/links`, sem API key. Corpo: `handle` (sem `$`), `items[{ quantity, price (centavos), description }]`, `order_nsu`, `redirect_url`, `webhook_url`, `customer?`. Resposta com `url` do checkout.
- Handle inexistente ou sem checkout externo ligado: `404 { "success": false, "error": "external_checkout_not_enabled", "message": ..., "redirect_url": "https://app.infinitepay.io/external-checkout#configuracoes?enabled=true" }`.
- Webhook (POST no `webhook_url`, sem assinatura): `{ invoice_slug, amount, paid_amount, installments, capture_method, transaction_nsu, order_nsu, receipt_url, items }`. `200` encerra; `400` faz a InfinitePay reenviar.
- `POST https://api.checkout.infinitepay.io/payment_check` com `{ handle, order_nsu, transaction_nsu, slug }` → `{ success, paid, amount, paid_amount, installments, capture_method }`.
- `redirect_url` recebe `?order_nsu=&transaction_nsu=&slug=&receipt_url=` (e outros) após o pagamento.
- Não existe `DELETE /links/*` (404 `Not Found`), nem expiração documentada.

## 1. Dados e contrato

### Banco

`payment_methods`:

| coluna | tipo | nota |
|---|---|---|
| `provider` | `PaymentProvider` (`pix` \| `infinitepay`) | substitui `type` |
| `kind` | `PixKeyType` nullable | substitui `pix_key_type`; null quando `provider = infinitepay` |
| `value` | `String.Max<254>` | substitui `pix_key`; chave Pix canônica ou handle canônico |
| `label`, `is_default`, `contact_id`, `archived_at`, `created_at`, `updated_at` | | iguais |

Unique `owner_id:provider:value` substitui `owner_id:pix_key_type:pix_key`. Duas chaves Pix de tipos diferentes com o mesmo valor canônico não existem na prática (CPF vs telefone têm formatos distintos), então nada se perde.

`charges`, colunas novas (todas nullable; null quando o snapshot é Pix):

| coluna | tipo | nota |
|---|---|---|
| `payment_link_url` | `String.Max<500>` | URL do checkout |
| `payment_link_state` | `PaymentLinkState` (`pending` \| `ready` \| `failed`) | |
| `provider_transaction_id` | `String.Max<120>` | `transaction_nsu`; unique parcial, chave de idempotência |
| `provider_receipt_url` | `String.Max<500>` | `receipt_url` do webhook/retorno |

`payment_snapshot` jsonb passa a `{ provider, kind?, value, label }` (hoje `{ method, type, value, label }`). `PaymentMethodKind` em `charges/schemas/charge.ts` some; `PaymentProvider` vem do common.

Backfill SQL em `packages/api/scripts/sql/2026-09-18-payment-methods-generic.sql` (o dono roda):

```sql
UPDATE payment_methods SET provider = 'pix', kind = pix_key_type, value = pix_key WHERE provider IS NULL;
UPDATE charges
   SET payment_snapshot = jsonb_build_object('provider', 'pix', 'kind', payment_snapshot->'type', 'value', payment_snapshot->'value', 'label', payment_snapshot->'label')
 WHERE payment_snapshot ? 'method';
```

### `@receivy/common` (`domain/contracts.ts`)

```ts
export const enum PaymentProvider { Pix = 'pix', InfinitePay = 'infinitepay' }
export const enum PaymentLinkState { Pending = 'pending', Ready = 'ready', Failed = 'failed' }

export interface PaymentMethod { id; provider; kind: PixKeyType | null; value; label; isDefault; contactId: string | null; createdAt }

export type PaymentMethodInput =
  | { provider: PaymentProvider.Pix; kind: PixKeyType; value: string; label: string; contactId?: string }
  | { provider: PaymentProvider.InfinitePay; value: string; label: string };

export interface PaymentSnapshot { provider; kind: PixKeyType | null; value; label }        // substitui PixSnapshot
export interface PaymentLink { url: string | null; state: PaymentLinkState }

ChargeDetail.payment: PaymentSnapshot | null   // era `pix`
ChargeDetail.paymentLink: PaymentLink | null   // só infinitepay
ChargeDetail.receiptUrl: string | null
PublicChargeView.payment: PaymentSnapshot | null
PublicChargeView.paymentLink: PaymentLink | null
PublicChargeView.receiptUrl: string | null
```

`domain/handle.ts`: `normalizeHandle(value)` tira `$` inicial e espaços, lowercase, aceita `^[a-z0-9][a-z0-9._-]{1,39}$`, lança `RangeError('Handle inválido.')`. Regra a confirmar com um handle real na primeira execução; se a InfinitePay aceitar mais, afrouxa o regex.

`charge-text.ts`: `paymentLabel(snapshot)` ("Pix · CPF ···123" / "InfinitePay · $handle") usado na lista e no detalhe.

### API: endpoints de meios de pagamento

Rotas e nomes ficam (`/payment-methods`); só o corpo muda para `PaymentMethodInput`. `PixKeyTakenError` vira `PaymentMethodTakenError` (mesmo 409, mensagem "Esse meio já está cadastrado."). Novo `InfinitePayCheckoutDisabledError` (422, `{ code: 'infinitepay_checkout_disabled', redirectUrl }`), mapeado em `api.ts`.

## 2. API

### Vendor `vendors/infinitepay/`

`client.ts`: `createInfinitePayClient(request = fetch)` → `{ createLink(input): Promise<{ url }>, checkPayment(input): Promise<{ paid, amount, paidAmount, captureMethod }> }`. `AbortSignal.timeout(8_000)`. `404 external_checkout_not_enabled` → lança `CheckoutDisabled { redirectUrl }`; qualquer outro não-2xx ou rede → `Unavailable`. Corpo do provider nunca sai do vendor.

`types.ts`: tipos de request/response e do webhook (`InfinitePayWebhookBody`).

Transporte: derivado de `PAYMENT_METHOD_LINK` (`live` → InfinitePay real; `fake` → fake; qualquer outro valor, ou ausente → desligado). O `fake` vive em `vendors/infinitepay/fake.ts`: `createLink` devolve `${PUBLIC_WEB_ORIGIN}/dev/infinitepay/${order_nsu}`; `checkPayment` devolve `paid: true` com o valor pedido. `paymentLinkProvider(env)` (mesmo desenho do e-mail) escolhe pelo `PAYMENT_METHOD_LINK`.

Variável nova em `ez4.project.js`, `dev.env.example`, `local.env.example`, `docs/environments.md`: `PUBLIC_API_ORIGIN` (origem pública da API, base do `webhook_url`) e `PAYMENT_METHOD_LINK` (`live | fake | disabled`); `APP_STAGE` já existia e continua declarada onde já estava.

### `PaymentLinkService` (`charges/services/payment-link.ts`)

Factory.Service com `db`, `provider` (o vendor), `variables` (`PUBLIC_API_ORIGIN`, `PUBLIC_WEB_ORIGIN`, `PUBLIC_LINK_HMAC_SECRET`).

`ensure(chargeId)`:

1. Lê a charge. Snapshot não é `infinitepay`, ou `payment_link_state = ready`, ou estado ≠ `Pending` → retorna sem fazer nada.
2. Mint do token de webhook: `capability.issue` com novo `PublicTokenPurpose.ProviderWebhook`, `publicId = charge.id`, sem expiração (`expiresAtSeconds` distante; o token só serve para achar a charge, quem decide é o `payment_check`).
3. `provider.createLink({ handle: snapshot.value, order_nsu: charge.id, items: [{ quantity: 1, price: amount_cents, description }], webhook_url: ${PUBLIC_API_ORIGIN}/webhooks/infinitepay/${token}, redirect_url: ${PUBLIC_WEB_ORIGIN}/pay/${publicToken} })`. `publicToken` vem de `ensurePublicLink` (mesmo link da página pública).
4. Sucesso → `payment_link_url`, `state = ready`, evento `charge.payment_link.created`. Falha → `state = failed`, evento `charge.payment_link.failed { reason: 'checkout_disabled' | 'unavailable' }`. `CheckoutDisabled` também dispara push ao dono ("Ative o checkout externo na InfinitePay").

Onde é chamado:

- `charges/services/materialize.ts`, logo após gravar o snapshot: best-effort, falha engolida (já ficou registrada como `failed`).
- `notifications/services/send.ts`: antes de enviar um aviso de recebível, se `state ≠ ready` chama `ensure`; ainda não pronto → `skipped` com `SkipReason.LinkPending` e o scheduler rearma como faz para `pix_required`.
- `public/services/links.ts` `view(token)`: snapshot InfinitePay com `state ≠ ready` (`pending` órfão ou `failed`), tenta `ensure` uma vez antes de responder (último recurso; o request tolera os 8 s de timeout).
- `POST /charges/{id}/payment-link` (sessão, dono): só `ensure`, para o botão "Gerar link de novo".

### Baixa pelo provider: `ChargeService.settleByProvider`

Entrada `{ chargeId, transactionNsu, slug, amountCents, paidAmountCents, captureMethod, receiptUrl }`, chamado pelo webhook e pelo retorno do pagador. Transação:

1. Charge com `provider_transaction_id = transactionNsu` → já processado, retorna `replayed`.
2. Snapshot não é `infinitepay` → `ignored`.
3. `provider.checkPayment({ handle: snapshot.value, order_nsu: chargeId, transaction_nsu, slug })`. `Unavailable` → propaga (o chamador decide o status HTTP). `paid: false` → evento `charge.provider.rejected`, retorna `rejected`.
4. `amount < charge.amount_cents` → evento `charge.provider.mismatch { amount, paidAmount, transactionNsu }`, push ao dono, retorna `mismatch`.
5. Estado ≠ `Pending` → evento `charge.provider.ignored { state, transactionNsu, receiptUrl }`, push ao dono, retorna `ignored`. Não muda estado: link não pode ser cancelado na InfinitePay, o dono decide.
6. `markPaid` + `provider_transaction_id` + `provider_receipt_url` + evento `charge.paid { via: 'provider', provider: 'infinitepay', transactionNsu, paidAmount, captureMethod, receiptUrl }` + `PaymentNotice.Confirmed` ao dono (e ao pagador quando ele tem conta, como já acontece na aceitação de comprovante). Comprovante `pending` existente é aceito no mesmo ato, como faz `pay`. Retorna `settled`.

### Rotas novas

| rota | authorizer | handler |
|---|---|---|
| `POST /webhooks/infinitepay/{token}` | nenhum | `webhooks/endpoints/infinitepay.ts` |
| `POST /public/charges/{token}/provider-return` | nenhum (token público) | `public/endpoints/provider-return.ts` |
| `POST /charges/{id}/payment-link` | sessão | `charges/endpoints/payment-link.ts` |

Webhook: verifica o token (`ProviderWebhook`); inválido ou charge inexistente → `200` vazio, sem pista. Corpo fora do formato → `200` (repetir não ajuda). Chama `settleByProvider`; `Unavailable` → `400` (InfinitePay reenvia); qualquer outro resultado → `200`. Throttle por IP como nas rotas públicas.

Retorno do pagador: corpo `{ orderNsu, transactionNsu, slug }`; `orderNsu` tem de ser o id da charge do token, senão `400`. Mesmo `settleByProvider`; `Unavailable` → `503`. Resposta: `PublicChargeView` atualizado.

### Métodos de pagamento

`PaymentMethodService.save(ownerId, input)`:

- `pix`: como hoje (`normalizePixKey`).
- `infinitepay`: `contactId` presente → 400. `normalizeHandle`. Sondagem `provider.createLink({ handle, order_nsu: probe:${randomUUID()}, items: [{ quantity: 1, price: 100, description: 'Validação Receivy' }] })` sem webhook e sem redirect. `CheckoutDisabled` → `InfinitePayCheckoutDisabledError` com `redirectUrl`; `Unavailable` → 503 "Não deu para validar o handle agora". Sucesso → insere. Com transporte `fake` a sondagem sempre passa.
- `electDefault`, `archive`, `upsertContactKey` não mudam; `upsertContactKey` continua Pix por construção.

`payment-methods/utils/dto.ts` e `utils/input.ts` ficam genéricos (`provider`, `kind`, `value`).

## 3. Notificações e eventos

- `SkipReason.LinkPending = 'link_pending'` em `send.ts`; documentado em `docs/notifications.md`.
- Pushes novos (via `pushToUser`, só push): "Link de pagamento não criado: ative o checkout externo na InfinitePay" (`checkout_disabled`), "Pagamento recebido pela InfinitePay em uma cobrança já paga/cancelada" (`provider.ignored`), "Valor divergente na InfinitePay" (`provider.mismatch`).
- Eventos novos na timeline (`timeline` lê `events` por tipo): `charge.payment_link.created`, `charge.payment_link.failed`, `charge.provider.rejected`, `charge.provider.mismatch`, `charge.provider.ignored`; `charge.paid` com `via: 'provider'` ganha rótulo "Pago pela InfinitePay".
- E-mail: botão continua "Confira os detalhes" → `/pay/{token}`. Rodapé varia pelo provider do snapshot: Pix mantém o texto; InfinitePay: "O pagamento acontece pelo link da InfinitePay de quem cobra."

## 4. Interface

Web e mobile, mesmos nomes de arquivo nos dois pacotes.

### Configurações: "Meios de pagamento"

- Rotas: `settings/pix` → `settings/payment-methods`; `settings/pix/new` → `settings/payment-methods/new`. Redirect da rota antiga na web; no mobile só troca (regenerar `router.d.ts`).
- `pix-settings-screen` → `payment-methods-screen`. Linha: ícone por provider (`pix-type-icon` para Pix; ícone InfinitePay em `components/ui/provider-icon.tsx`), `label`, valor (`pixKeyField(kind).format(value)` ou `$value`), badge "Padrão", ações padrão/arquivar iguais. Vazio: "Nenhum meio de pagamento".
- `pix-key-form-screen` → `payment-method-form-screen`: chips "Pix" / "InfinitePay" no topo. Pix mantém `pix-key-fields`. InfinitePay: `Input` de handle com prefixo visual `$` e `autoCapitalize="none"`, `Input` de label. `buildPaymentMethodInput` no common monta a união.
- Erro 422 `infinitepay_checkout_disabled`: mensagem inline "Ative o checkout externo no app da InfinitePay e tente de novo" com botão "Abrir configurações" (`Linking.openURL` / `<a target=_blank>` no `redirectUrl`).
- Draft round-trip (`returnTo`, `draft-store`) inalterado; a billing aponta para qualquer provider.
- Seletor de meio no formulário da billing: mostra `paymentLabel`, todos os providers próprios.

### Detalhe da cobrança (dono)

- Tile "Copiar Chave Pix" → `payment.provider`: Pix igual; InfinitePay + `ready` → "Copiar link de pagamento" (copia `paymentLink.url`); `failed` → "Gerar link de novo" (`POST /charges/{id}/payment-link`, com spinner); `pending` → tile desabilitado "Gerando link".
- Charge paga com `receiptUrl` → linha "Comprovante InfinitePay" abrindo a URL.
- `remind-sheet` e `first-share-pix` seguem lendo `sharingState`, sem mudança.

### Link público (`/pay/[token]`)

- Pix: igual a hoje.
- InfinitePay + `ready`: "1 · PAGUE PELO LINK" com botão primário "Pagar" (`target=_blank`, `rel=noopener`) e hint "Pix ou cartão em até 12x, pela InfinitePay". Seção "2 · ENVIE O COMPROVANTE" vira `<details>` fechado: "Pagou de outro jeito? Envie o comprovante", com o mesmo `ProofPanel`.
- InfinitePay + `pending`/`failed`: aviso "Estamos gerando o link de pagamento, tente em instantes" e o comprovante aberto como hoje.
- Query `order_nsu`, `transaction_nsu`, `slug` presentes (retorno da InfinitePay): o server component chama `POST /api/public-charge/{token}/provider-return` (BFF novo em `app/api/public-charge/[token]/provider-return/route.ts`) antes de renderizar e usa a resposta. Charge `paid` → bloco "Pagamento confirmado" com `receiptUrl` quando houver; comprovante some.

## 5. Testes

- Vendor: `createLink` sucesso, `external_checkout_not_enabled` → `CheckoutDisabled` com `redirectUrl`, 5xx/timeout → `Unavailable`; `checkPayment` paid/unpaid. Fetch falso, sem rede.
- `normalizeHandle`: `$Handle ` → `handle`, rejeita vazio, espaço, `$$`, 41 chars.
- `PaymentLinkService.ensure`: cria uma vez, idempotente em `ready`, ignora Pix e charge paga, grava `failed` + evento + push em `CheckoutDisabled`.
- `settleByProvider`: `settled` com evento e push; `replayed` por `transaction_nsu`; `rejected`; `mismatch`; `ignored` em cancelada/paga; aceita comprovante pendente junto.
- Webhook: token inválido → 200 sem efeito; `Unavailable` → 400; replay → 200.
- `provider-return`: `orderNsu` ≠ charge → 400; caminho feliz reaproveita o finalizador (spy).
- `PaymentMethodService.save`: Pix inalterado; InfinitePay faz a sondagem, 422 com `redirectUrl`, 400 com `contactId`, 409 duplicado.
- Integração (`prepare-test-database`): materializar billing com meio InfinitePay e transporte `fake` deixa `payment_link_state = ready`; backfill SQL roda sobre fixtures do modelo antigo.
- Web/mobile: `payment-methods-screen` renderiza os dois providers; formulário alterna chips e envia a união certa; `/pay/[token]` mostra "Pagar" + comprovante dobrado para InfinitePay e o bloco antigo para Pix; detalhe mostra o tile certo por `paymentLink.state`.
- `scripts/financial-http-smoke.mjs`: caso InfinitePay com `fake` (cadastra meio, cria billing, confere `paymentLink.url`, chama `provider-return`, vê `paid`).

## 6. Deploy sequence (lições do EZ4, bloco 8/9)

1. **D1** — `payment_methods`: adiciona `provider`, `kind`, `value` nullable. `charges`: adiciona as quatro colunas nullable e o `payment_snapshot` aceita as duas formas (todos os campos opcionais no schema). Nada removido, nenhuma linha de relação muda.
2. **Backfill SQL** (o dono roda; script em `scripts/sql/`).
3. **D2** — código lê só `provider/kind/value` e o snapshot novo; `type`, `pix_key_type`, `pix_key` ficam `@deprecated` sem leitor; entra o unique `owner_id:provider:value`; sai o unique antigo. Vendor, rotas e telas entram aqui. `PAYMENT_METHOD_LINK=live` e `PUBLIC_API_ORIGIN` configurados no ambiente antes deste deploy.
4. **D3** — colunas antigas saem do schema; EZ4 dropa. Snapshot volta a ter `provider`, `value`, `label` obrigatórios.

Rollback é seguro até D3: as colunas antigas continuam populadas. Local: `ez4 serve` sincroniza colunas nullable sozinho; o backfill roda via `seed-local.mjs` quando houver linhas antigas.

## 7. Docs a atualizar

`docs/environments.md` (duas variáveis), `docs/api-oas.yml` (rotas novas, `PaymentMethodInput`, `PublicChargeView.payment/paymentLink`), `docs/api-errors.md` (`infinitepay_checkout_disabled`, 503 de sondagem), `docs/deploy-guide.md` (sequência acima), `docs/notifications.md` (`link_pending`, pushes novos), `docs/manual-qa-script.md` (roteiro InfinitePay com transporte `fake` e com handle real).
