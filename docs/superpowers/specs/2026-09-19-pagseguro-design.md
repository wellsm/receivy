# PagBank (PagSeguro) como segundo provider de link de pagamento

Data: 2026-09-19. Depende de "Meios de pagamento + InfinitePay" (`docs/superpowers/specs/2026-09-18-meios-de-pagamento-infinitepay-design.md`) em produção: `payment_methods` genérica, `PaymentProvider`, `ensurePaymentLink`, `settleByProvider`, webhook por charge, página pública com "Pagar".

## Problema

O InfinitePay foi o primeiro provider porque não pede credencial. O PagBank pede: toda chamada leva `Authorization: Bearer <token>` do vendedor. Isso traz o que adiamos de propósito: credencial por usuário guardada no Receivy, cifrada, e um webhook assinado com essa credencial.

## Decisões

- **Token colado agora, Connect (OAuth) depois.** O usuário gera o token no app PagBank (Vendas → Integrações → Gerar Token) e cola no Receivy. O modelo de dados já comporta o Connect (`credentials.kind`), sem código para ele.
- **Tabela `integrations`** guarda a credencial, uma por `(owner, provider)`; `payment_methods.integration_id` aponta para ela. O segredo fica em `credentials.ciphertext` (AES-256-GCM); metadados em claro no mesmo jsonb.
- **`PAYMENT_METHOD_LINK` ganha `sandbox`**: PagBank em `sandbox.api.pagseguro.com` (token de sandbox); InfinitePay não tem sandbox e se comporta como `live`.
- **Webhook por checkout** (`notification_urls`), assinado: `x-authenticity-token = sha256(token + '-' + corpo cru)`. Confere a assinatura **e** re-lê o pedido (`GET /orders/{id}`) antes de baixar. O payload nunca decide.
- **Cancelar inativa o checkout** (`POST /checkouts/{id}/inactivate`), best-effort após o commit.
- **Formas de pagamento**: `PIX` + `CREDIT_CARD`; juros do parcelamento com o comprador (padrão PagBank).
- **Validação do token ao salvar**: `GET /checkouts/CHEC_0…` → 401 = inválido, 404 = válido. Nada é criado.
- **Sem retorno com ids**: o PagBank volta para `redirect_url` sem identificar a transação; a página pública mostra "em confirmação" até o webhook.
- **PagBank só em meio próprio**, como o InfinitePay.

## Fora de escopo

Connect OAuth; boleto; repasse/isenção de taxa; `customer`/endereço pré-preenchidos; rotação automática de token; Pix direto (API Pix do PagBank).

## Fatos da API PagBank (verificados em 2026-09-19)

- Hosts: produção `https://api.pagseguro.com`, sandbox `https://sandbox.api.pagseguro.com`. Header `Authorization: Bearer <token>`; token gerado no app/portal, sem expiração documentada.
- `POST /checkouts`: `reference_id` (≤64), `expiration_date` (ISO-8601), `customer?`, `customer_modifiable` (padrão true), `items[{ reference_id?, name?, quantity, unit_amount }]` (obrigatório), `payment_methods[{ type: PIX | CREDIT_CARD | ... }]`, `redirect_url` (≤255), `notification_urls[]`, `soft_descriptor` (≤17). Resposta: `{ id: 'CHEC_…', reference_id, status: 'ACTIVE', links[{ rel: 'PAY' | 'SELF' | 'INACTIVATE', href, method }] }`. Sem `expiration_date` o checkout expira em 2 h.
- `POST /checkouts/{id}/inactivate` → 200 `{ id, status: 'INACTIVE', links }`; 400 `{}`.
- Notificação (POST em `notification_urls`): pedido `{ id: 'ORDE_…', reference_id, created_at, customer, items, charges[{ id: 'CHAR_…', reference_id, status: PAID | IN_ANALYSIS | DECLINED | CANCELED | WAITING, created_at, paid_at, amount: { value, currency, summary: { total, paid, refunded } }, payment_method: { type, installments?, card? }, payment_response: { code, message, reference } }] }`. Headers `x-authenticity-token`, `x-product-origin` (`CHECKOUT` | `ORDER`), `x-product-id`. Sem política de retry documentada.
- Autenticidade: `x-authenticity-token` = SHA-256 hex de `"<token>-<corpo cru sem reformatar>"`.
- `GET /orders/{id}` devolve o pedido com `charges[]` (Consultar pedido).
- Qualquer GET sem token ou com token inválido → `401 { error_messages: [{ error: 'invalid_authorization_header' }] }` (produção e sandbox, confirmado).

## 1. Dados e contrato

### Banco

`integrations` (nova):

| coluna | tipo | nota |
|---|---|---|
| `id` | UUID | |
| `owner_id` | UUID → users | |
| `provider` | `PaymentProvider` | `pagseguro` |
| `credentials` | jsonb `IntegrationCredentialsSchema` | ver abaixo |
| `label` | `String.Max<120>` | "Conta PagBank" |
| `revoked_at?` | DateTime | arquivar o método revoga |
| `created_at`, `updated_at` | | |

Unique `owner_id:provider`.

```ts
export interface IntegrationCredentialsSchema {
  kind: IntegrationCredentialKind;            // 'token' | 'connect'
  /** AES-256-GCM `v1.<iv>.<tag>.<ct>` (base64url) of the secret part: { token } or { accessToken, refreshToken }. */
  ciphertext: String.Max<2048>;
  /** Connect only, readable without decrypting. */
  accountId?: String.Max<120>;
  expiresAt?: String.DateTime;
  scope?: String.Max<200>;
}
```

`payment_methods.integration_id?` → `integrations.id` (relation `integration_id@integration`). Método PagBank: `provider = pagseguro`, `kind = null`, `value = label`, `integration_id` obrigatório (validado no service).

`charges`: `provider_link_id?` (`String.Max<120>`, o `CHEC_…`); `payment_snapshot` ganha `integrationId?` (jsonb, aditivo; só PagBank). `provider_transaction_id` recebe o `CHAR_…`.

Deploy: tudo aditivo (tabela nova, colunas nullable, campo jsonb opcional) → um deploy só. Local: `ez4 serve` sincroniza.

### Cifra

`packages/api/src/common/services/secret-box.ts`: `seal(plain: string, keyB64): string` / `open(sealed: string, keyB64): string` (AES-256-GCM, IV 12 bytes, tag 16, saída `v1.<iv>.<tag>.<ct>` base64url). Chave `PAYMENT_CREDENTIAL_KEY_B64` (32 bytes base64), uma por stage. Local e test trazem uma chave fixa de exemplo em `local.env.example`/`test.env.example` (o fake não chama o PagBank, mas o roundtrip precisa funcionar). Sem chave (`disabled`/vazia) → salvar PagBank responde 503 `PAYMENT_CREDENTIAL_KEY_MISSING`.

### `@receivy/common`

```ts
PaymentProvider.PagSeguro = 'pagseguro'
PaymentMethodInput |= { provider: PaymentProvider.PagSeguro; token?: string; label?: string }   // token obrigatório ao criar, opcional ao editar (vazio = mantém)
PaymentMethod                                                            // inalterado: nunca expõe token; `value` = label
paymentMethodText(pagseguro) → { title: 'PagBank', value: label }
paymentMethodCopyValue(pagseguro) → ''                                    // UI esconde o copiar
```

### API: erros novos

| código | status | quando |
|---|---|---|
| `PAGSEGURO_TOKEN_INVALID` | 422 | `verifyToken` → 401 |
| `PAYMENT_CREDENTIAL_KEY_MISSING` | 503 | chave de cifra ausente |
| `PAYMENT_LINK_UNAVAILABLE` (existe) | 503 | PagBank fora do ar na validação |

## 2. API

### Modo

`PAYMENT_METHOD_LINK = live | sandbox | fake | disabled`. `paymentLinkProvider(variables)` devolve um **registro por provider**: `{ [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client }`; `sandbox` troca só o host do PagBank; `fake` devolve o fake para os dois (mesmo `Map` em memória, chaveado por `orderNsu`); `disabled` devolve `unavailable` para tudo.

### Vendor `vendors/pagseguro/`

`types.ts`, `client.ts` (`createPagSeguroClient(host, request = fetch)`), `client.test.ts`. Uniões de resultado, nunca lança, `AbortSignal.timeout(8_000)`, corpo do PagBank nunca sai:

```ts
verifyToken(token): Promise<{ status: 'valid' | 'invalid' | 'unavailable' }>            // GET /checkouts/CHEC_00000000-0000-0000-0000-000000000000
createCheckout(token, { referenceId, amountCents, description, expiresAt, redirectUrl, webhookUrl }):
  Promise<{ status: 'created'; id: string; url: string } | { status: 'unauthorized' } | { status: 'unavailable' }>
  // body: reference_id, expiration_date, customer_modifiable: true, items: [{ reference_id, name (≤100), quantity: 1, unit_amount }],
  //       payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }], redirect_url, notification_urls: [webhookUrl], soft_descriptor: 'Receivy'
  //       url = links.find(rel === 'PAY').href
getOrder(token, orderId): Promise<{ status: 'found'; charges: { id; status; amountCents; paidCents; method }[] } | { status: 'unauthorized' } | { status: 'unavailable' }>
inactivate(token, checkoutId): Promise<{ status: 'done' | 'unauthorized' | 'unavailable' }>
```

### Interface comum dos providers

`vendors/types.ts` (ou `charges/services/payment-link.ts`):

```ts
interface CheckoutClient {
  createLink(input: { orderNsu; amountCents; description; webhookUrl; redirectUrl; expiresAt; identity?: string; credential?: string }): Promise<PaymentLinkResult>;
  //   PaymentLinkResult |= { status: 'unauthorized' }; `created` ganha `linkId?` (CHEC_…)
  checkPayment(input): Promise<PaymentCheckResult>;   // InfinitePay: { handle, orderNsu, transactionNsu, slug }; PagBank: { credential, orderId }
  inactivate?(input: { credential; linkId }): Promise<{ status: 'done' | 'unauthorized' | 'unavailable' }>;
}
type CheckoutClients = Record<PaymentProvider.InfinitePay | PaymentProvider.PagSeguro, CheckoutClient>;
```

Os adaptadores InfinitePay e PagBank implementam `CheckoutClient` por cima dos clientes de vendor; `identity` = handle, `credential` = token decifrado (só em memória, nunca logado).

### `ensurePaymentLink`

Escolhe `clients[snapshot.provider]`. PagBank: lê `snapshot.integrationId` → `IntegrationRepository.get` (não revogada) → `open(credentials.ciphertext)` → `createLink({ credential, expiresAt: expiração do link público, ... })`. `created` grava `payment_link_url`, `provider_link_id`, `ready`. `unauthorized` → `failed` + evento `charge.payment_link.failed { reason: 'unauthorized' }` + push ao dono "Token do PagBank inválido: refaça a conexão" (só na transição). Integração revogada/ausente → `failed { reason: 'no_credential' }`.

### Webhook `POST /webhooks/pagseguro/{token}`

Rota sem authorizer, `body: string` (cru), `headers: { 'x-authenticity-token'?: string }`:

1. Token de capability (`ProviderWebhook`) → `chargeId`; inválido → 200 vazio.
2. Charge → snapshot PagBank → integração → credencial. Sem credencial → 200 (evento `charge.provider.ignored { reason: 'no_credential' }`).
3. `sha256(credential + '-' + body)` ≠ header → 200 vazio (evento `charge.provider.rejected { reason: 'signature' }`).
4. Parse do JSON; `reference_id !== chargeId` → 200. Pega `charges[]` com `status === 'PAID'`; nenhuma → 200 (evento `charge.provider.rejected { reason: 'not_paid', status }`).
5. `settleByProvider` com `{ provider: pagseguro, chargeId, transactionNsu: CHAR_id, orderId: ORDE_id, receiptUrl: undefined }`: o `checkPayment` do PagBank faz `getOrder(credential, orderId)` e exige a mesma `CHAR_` com `PAID` e `amount.summary.paid >= amount_cents`. Fluxo de estados/eventos/pushes igual ao InfinitePay (`replayed`, `ignored`, `mismatch`, `settled`). `unavailable` → 400 (PagBank reenvia? não documentado; 400 é o melhor sinal).

Throttle: bucket por charge (`public-read`), como no retorno InfinitePay.

### Cancelar

`ChargeService.cancel`: após o commit, se snapshot PagBank e `provider_link_id` → `inactivate` best-effort; evento `charge.payment_link.inactivated` ou `charge.payment_link.inactivate_failed { reason }`. Nunca falha o cancelamento.

### Métodos de pagamento

`PaymentMethodService.save` com `provider = pagseguro`:
- `contactId` → 400 (só meio próprio).
- Criar sem `token` → 400 "Informe o token do PagBank."
- Quota `enforceQuota(db, 'pagseguro-verify:' + ownerId, 10)`.
- `verifyToken` → `invalid` → 422 `PAGSEGURO_TOKEN_INVALID`; `unavailable` → 503.
- Sem chave de cifra → 503 `PAYMENT_CREDENTIAL_KEY_MISSING`.
- Transação: `IntegrationRepository.upsert(owner, pagseguro, { kind: 'token', ciphertext }, label)` (restaura se revogada) + método `{ provider: pagseguro, kind: null, value: label, integration_id }`. Editar com `token` vazio mantém a credencial; com token novo, re-verifica e substitui.
- `archive` de método PagBank → `IntegrationRepository.revoke` (a menos que outro método vivo aponte para ela — não existe hoje, uma por owner).

### Fake local

`createFakeCheckoutClient(webOrigin)` serve os dois providers: `createLink` → `${webOrigin}/dev/checkout/${provider}/${orderNsu}?redirect=…`; `checkPayment` paga o valor lembrado; `verifyToken` sempre `valid`; `inactivate` `done`. Para o PagBank fechar offline (não há retorno com ids), a API ganha `POST /dev/checkout/pagseguro/{orderNsu}/pay` que existe em qualquer modo mas responde 404 fora de `fake` (guarda no handler) e roda `settleByProvider` com o fake. A página fake do web chama essa rota e volta para `/pay/{token}`.

## 3. Notificações e eventos

- Push "Token do PagBank inválido" (`payment_link.failed { reason: 'unauthorized' }`, só na transição para `failed`).
- Eventos novos: `charge.payment_link.inactivated`, `charge.payment_link.inactivate_failed`, `charge.provider.rejected { reason: 'signature' | 'not_paid' }`, `charge.provider.ignored { reason: 'no_credential' }`. `charge.paid { via: 'provider', provider: 'pagseguro', transactionNsu: CHAR_…, captureMethod: 'pix' | 'credit_card' }`.
- E-mail: rodapé "O pagamento acontece pelo link do PagBank de quem cobra."

## 4. Interface

Web e mobile, mesmos arquivos.

- **Formulário**: chip "PagBank". Campos: token (`type="password"` / `secureTextEntry`, `autoCapitalize="none"`, botão colar no mobile), rótulo (padrão "PagBank"). Hint: "Gere o token no app PagBank em Vendas → Integrações → Gerar Token. Ele fica cifrado no Receivy." Erros: 422 `PAGSEGURO_TOKEN_INVALID` → "Token inválido ou sem permissão."; 503 → mensagem da API. Edição: token vazio mantém o atual (placeholder "•••••• (mantido)").
- **Lista**: "PagBank · <label>", ícone `Landmark` (web) / `assets/images/auth/bank.svg` (mobile); sem botão copiar (`paymentMethodCopyValue` vazio). Excluir → arquiva e revoga.
- **Página pública**: bloco "1 · PAGUE PELO LINK" com hint "Pix ou cartão, pelo PagBank. A confirmação chega sozinha depois do pagamento."; voltou do PagBank e ainda `pending` (query `?returned=1` no `redirect_url`) → aviso "Pagamento em confirmação: se você pagou, isto atualiza em instantes" + `<meta http-equiv="refresh" content="10">` enquanto pendente; pago → "Pagamento confirmado" (sem recibo).
- **Detalhe da cobrança**: tiles iguais ao InfinitePay. Cancelada com `payment_link.inactivated` → linha "Link inativado no PagBank".
- **Fake**: `/dev/infinitepay/[orderNsu]` vira `/dev/checkout/[provider]/[orderNsu]`; PagBank chama a rota de fake da API.

## 5. Testes

- Vendor: `verifyToken` 401/404/5xx; `createCheckout` corpo + `PAY` href + 401; `getOrder`; `inactivate`.
- `secret-box`: roundtrip, chave errada falha, `v1` prefixo.
- `ensurePaymentLink` PagBank: credencial decifrada só na chamada; `unauthorized` → failed + push na transição; integração revogada → `no_credential`.
- Webhook: assinatura errada → 200 sem escrita; assinatura ok + `getOrder` PAID → `settled`; replay; `paid < amount` → mismatch; charge cancelada → ignored.
- Cancel → inativa (fake) + evento.
- Service `save`: 400 sem token, 422 inválido, 503 sem chave, upsert/restauração da integração, edição mantendo token, archive revoga.
- Integração ponta a ponta com o fake (criar método → conta → link → rota fake de pagamento → paga).
- Web/mobile: chip PagBank com token oculto; 422; lista sem copiar; página "em confirmação".

## 6. Deploy

Um deploy (tudo aditivo). Antes dele: `PAYMENT_CREDENTIAL_KEY_B64` (32 bytes: `openssl rand -base64 32`) em `dev.env`/`prd.env`; `PAYMENT_METHOD_LINK=sandbox` no dev enquanto testa com token de sandbox. Trocar a chave depois invalida todas as credenciais guardadas (sem rotação nesta versão).

## 7. Docs

`environments.md` (`sandbox`, chave), `api-errors.md` (dois códigos), `notifications.md` (eventos/push), `manual-qa-script.md` (sandbox PagBank), `api-oas.yml` regenerado.
