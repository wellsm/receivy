# Canal WhatsApp na régua — design

Segunda fatia do plano Pro em notificação. Depende de
`2026-09-10-regua-cobranca-design.md`, que entrega a régua com canal por etapa:
aqui `whatsapp` entra como terceiro valor de canal.

Reescrito em 11/09/2026 contra a arquitetura atual: schedules dinâmicos por
cobrança, envio síncrono, `events` como log e vendors em `src/vendors`. A versão
anterior descrevia máquina de estados de entrega, polling de recibo e varredura
de timeout, nada disso existe mais. **A fatia ficou bem menor por causa disso.**

## 1. Objetivo

- `whatsapp` como terceiro canal, pela **Meta Cloud API direto**, sem BSP.
- Alcançar só quem pediu: opt-in do destinatário na página pública da cobrança,
  com verificação do telefone por código.
- Cota por ciclo de assinatura, degradando para e-mail quando acabar.
- Honrar opt-out por mensagem recebida.

## 2. Escopo

Dentro: `packages/api` (`vendors/meta/`, `notifications/`, `users/`, `public/`,
`api.ts`, `docs/openapi.json`), `packages/common` (canal e limites de plano),
`packages/web` (bloco de opt-in na página pública), `docs/`.

Fora: janela de 24 h e conversa free-form, respostas que não sejam opt-out,
WhatsApp para o dono da cobrança, cobrança da assinatura, pacote extra, BSP.

Sem dependência nova: a Meta Cloud API é HTTP com `fetch`, igual ao Expo.

## 3. Onde cada coisa mora

A estrutura de domínio do repositório decide isso sem ambiguidade.

| Peça | Lugar |
|---|---|
| Cliente HTTP da Meta | `vendors/meta/{client,types,utils}.ts` |
| Composição e gate por variável | `notifications/services/transport.ts` |
| Render de template | `notifications/services/render.ts` |
| Rotas de webhook | `notifications/routes.ts` |
| Handler de webhook | `notifications/endpoints/whatsapp-webhook.ts` |
| Consentimento e telefone | `users/` (schema, repositório, endpoint de opt-out) |
| Opt-in pelo token público | `public/endpoints/` |
| Cota | `users/schemas/plan-usage.ts` e `users/repositories/plan-usage.ts` |

`vendors/expo/client.ts` é o molde: `createExpoPushClient(env, request)` devolve
uma interface pequena, e `transport.ts` liga e desliga por variável. O cliente da
Meta segue igual, com `createMetaWhatsappClient(env, request)`.

## 4. Configuração

| Variável | Valor | Papel |
|---|---|---|
| `NOTIFICATION_WHATSAPP_TRANSPORT` | `meta` ou `disabled` | Liga o canal |
| `WHATSAPP_PHONE_NUMBER_ID` | id numérico | Remetente |
| `WHATSAPP_ACCESS_TOKEN` | token de sistema | Autorização |
| `WHATSAPP_APP_SECRET` | segredo do app | Assinatura do webhook |
| `WHATSAPP_VERIFY_TOKEN` | string nossa | Aperto de mão do webhook |
| `WHATSAPP_QUOTA_PER_CYCLE` | inteiro, referência `50` | Cota do `pro` |

Todas com default literal em `ez4.project.js` e no provider do domínio, no padrão
de `EXPO_ACCESS_TOKEN`. Nenhuma aparece em log, nem parcialmente.

## 5. Consentimento

### 5.1 Por que na página pública

O devedor costuma ser conta `pending`, criada por quem cobra, que nunca abriu o
app. O único lugar onde ele chega hoje é `/pay/<token>`, aberto pelo link do
aviso inicial que `announceCharges` dispara na criação da cobrança.

**Cuidado.** Esse aviso não sai quando a cobrança nasce sem chave Pix:
`sendChargeNotice` grava `notice.skipped` com `reason: 'pix_required'` e volta.
Por isso o convite de opt-in é um bloco **da página**, exibido sempre que ela
abre, e nunca um texto dentro de um template.

### 5.2 Fluxo

1. O devedor abre `/pay/<token>` e marca "avisar no WhatsApp".
2. Digita o telefone; a página chama `POST /public/charges/{token}/whatsapp/code`.
3. A API normaliza para E.164 com o `normalizePhone` que `users/` já usa, grava
   um código de seis dígitos com hash, e envia pelo próprio canal WhatsApp.
4. O devedor digita o código; a página chama `.../whatsapp/confirm`.
5. A API grava telefone, verificação e opt-in no usuário apontado por
   `charge.debtor_user_id`, registra um evento de conta, e manda um e-mail
   avisando que o canal foi ativado.

O token público prova que quem está na página recebeu o link. O código prova que
quem digitou controla o telefone.

### 5.3 Risco aceito

As duas provas não provam que o telefone **é** do devedor. Quem tiver o link pode
cadastrar o próprio número e passar a receber os lembretes daquela pessoa. O link
já expõe valor, descrição e chave Pix, então não abre dado novo. Mitigações:
e-mail a cada ativação, `POST /account/whatsapp/opt-out` autenticado, e opt-out
por mensagem, que funciona mesmo sem conta.

### 5.4 Escopo

O consentimento é do destinatário e **global**, como `device_tokens` já é. Um
segundo cobrador não pede opt-in de novo.

## 6. Dados

### 6.1 `users`

```ts
/** E.164, provado por código; distinto de `phone`, digitado no onboarding. */
whatsapp_phone?: String.Max<20>;
whatsapp_verified_at?: String.DateTime;
/** Registro do aceite; ausente significa nunca aceitou. */
whatsapp_opt_in_at?: String.DateTime;
/** Vence o opt-in quando mais recente que ele. */
whatsapp_opt_out_at?: String.DateTime;
/** Início do ciclo do plano; à mão hoje, pela assinatura depois. */
plan_cycle_anchor?: String.Date;
```

Consentimento não mora em `users.preferences`. Preferência é gosto e pode ser
sobrescrita em bloco; consentimento é registro com data.

### 6.2 `whatsapp_verifications`

Espelha `login_codes`, que já resolve isso para e-mail: `user_id`, `phone`,
`code_hash`, `attempts`, `expires_at`, `consumed_at`. Cinco tentativas, dez
minutos, um código vivo por usuário.

### 6.3 `plan_usage`

`user_id`, `cycle_start`, `whatsapp_sent`, com único em `user_id:cycle_start`.

### 6.4 Eventos

Não há tabela de entrega. O log é `events`, e o canal entra nele:

| Tipo | Quando | Payload |
|---|---|---|
| `notice.sent` | como hoje | `channels` passa a poder conter `whatsapp`; ganha `providerId` com o `wamid` |
| `notice.skipped` | como hoje | `reason` ganha `no_whatsapp_consent`, `quota_exhausted`, `whatsapp_disabled` |
| `notice.delivered` | webhook da Meta | `{ providerId, channel: 'whatsapp' }` |
| `notice.failed` | webhook da Meta | `{ providerId, channel: 'whatsapp' }` |

`events.type` é `String.Max<80>` livre, então nada muda de schema.

## 7. Templates

A Meta só aceita template pré-aprovado com parâmetros posicionais. O corpo deixa
de ser nosso.

| Constante | Categoria | Parâmetros |
|---|---|---|
| `WHATSAPP_TEMPLATE_VERIFY` | authentication | `1` código |
| `WHATSAPP_TEMPLATE_CREATED` | utility | `1` nome de quem cobra, `2` valor, `3` vencimento, `4` descrição |
| `WHATSAPP_TEMPLATE_REMINDER` | utility | iguais |

Rodapé fixo nos utility: `Responda SAIR para não receber mais avisos.` O link vai
como parâmetro de botão de URL, não no corpo.

`render.ts` ganha `renderWhatsapp(input, template, secret)` devolvendo
`{ name, language: 'pt_BR', params, urlParam }`. `renderNotice` não muda.

**A ordem dos parâmetros é a que a Meta aprovou.** Submeter os templates cedo é o
que trava essa ordem antes de ela vazar para o código.

## 8. Envio

`sendChargeNotice` hoje faz, em sequência: resolve destinatário, monta o render,
percorre dispositivos empurrando push, e manda e-mail quando nenhum push entrou
ou quando o modo é `both`. O WhatsApp entra como um bloco antes do e-mail, com a
mesma forma.

```
se a etapa pediu whatsapp:
  transporte desligado        -> reason 'whatsapp_disabled'
  sem consentimento válido    -> reason 'no_whatsapp_consent'
  cota do ciclo esgotada      -> reason 'quota_exhausted'
  tudo certo                  -> envia; channels.push('whatsapp')
```

Consentimento válido é `whatsapp_phone` e `whatsapp_verified_at` presentes,
`whatsapp_opt_in_at` presente, e `whatsapp_opt_out_at` ausente ou anterior ao
opt-in.

O e-mail continua saindo quando **nenhum canal empurrado entrou**. Ou seja, a
degradação de WhatsApp para e-mail cai sozinha na regra que já existe, sem ramo
novo: se o WhatsApp não saiu e o push não saiu, o e-mail sai.

**A ausência de fila é o que torna isso simples.** Na arquitetura anterior o
canal era decidido no planejamento, gravado em linha, e executado depois, o que
obrigava a tomar cota e checar consentimento em transação separada do envio.
Agora a decisão e o envio acontecem na mesma função, no mesmo instante, e a cota
é consumida exatamente quando a mensagem sai. Some o problema de contar uma
mensagem que nunca foi enviada.

## 9. Webhook

### 9.1 Autenticidade

O gateway expõe `Http.RawBody`, que é `string`: uma rota cujo `body` é declarado
como `string` recebe o corpo sem parse. Então a assinatura da Meta é validada do
jeito certo, HMAC-SHA256 do corpo cru com `WHATSAPP_APP_SECRET`, comparado com
`timingSafeEqual`.

Ordem no handler: valida a assinatura, recusa com `HttpNotFoundError` quando não
bate, e só então dá `JSON.parse` no corpo que ele mesmo conferiu.

A Meta manda snake_case, então a rota declara
`preferences: { namingStyle: 'snake' }`.

Defesa em profundidade: só aceita evento cujo `wamid` já apareça em algum
`notice.sent`, e ignora o resto em silêncio.

### 9.2 Rotas

```ts
Http.UseRoute<{ name: 'whatsappVerify'; path: 'GET /webhooks/whatsapp'; handler: typeof whatsappVerifyHandler }>,
Http.UseRoute<{
  name: 'whatsappEvent';
  path: 'POST /webhooks/whatsapp';
  handler: typeof whatsappEventHandler;
  preferences: { namingStyle: 'snake' };
}>
```

Sem autorizador, como `GET /public/charges/{token}` já é.

### 9.3 O que ele faz

| Evento | Efeito |
|---|---|
| `sent` | nada |
| `delivered` | grava `notice.delivered` |
| `read` | nada |
| `failed` | grava `notice.failed` e manda o e-mail daquele evento na hora |
| mensagem `SAIR`, `PARAR` ou `STOP` | grava `whatsapp_opt_out_at` no dono do telefone |
| qualquer outra mensagem | ignorada |

O opt-out compara depois de `normalize('NFD')`, remoção de diacríticos, remoção
de tudo que não é letra, e maiúsculas. Falhar em honrar opt-out derruba o
*quality rating* da conta, e rating baixo corta o limite de envio de **todos** os
usuários de uma vez. É a única regra desta spec cuja violação é coletiva.

### 9.4 Não existe varredura de timeout

Na arquitetura anterior, uma entrega `accepted` sem webhook ficaria presa num
estado para sempre, e isso exigia varredura. Aqui não há estado: o envio já
terminou e já virou `notice.sent`. Um webhook que nunca chega significa apenas
que a timeline não ganha a linha de entrega. Nada trava, nada precisa ser varrido.

## 10. Cota

### 10.1 Ciclo

A janela é o ciclo da assinatura. `plan_cycle_anchor` é a virada; o ciclo corrente
é o intervalo entre a âncora somada de N meses e a de N mais um, com N tal que
hoje caia dentro. Sem âncora, começa no dia 1 do mês corrente. Dia que não existe
no mês é grampeado no último dia.

Hoje a âncora é escrita à mão. Quando a assinatura existir, ela escreve nessa
coluna e nada mais muda.

### 10.2 Contagem

Contador por dono e ciclo, incrementado na mesma transação do envio.

A cota é do **dono da cobrança**, e o evento fica pendurado na cobrança, não no
dono. Derivar a contagem exigiria juntar com `charges` para achar `creditor_id` a
cada envio. O contador é estado duplicado assumido de propósito.

### 10.3 Limites

`PLAN_LIMITS`, que nasceu na fatia anterior, ganha um campo. Nada é renomeado:

```ts
export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: { maxSteps: 2, channels: false, whatsappPerCycle: 0 },
  pro: { maxSteps: 5, channels: true, whatsappPerCycle: 50 }
};
```

Referência: `pro` a R$ 14,90 por mês com 50 mensagens. A R$ 0,05 por mensagem
utility estimados, a cota cheia custa R$ 2,50, um sexto da mensalidade. O preço
por mensagem precisa ser confirmado no painel da Meta. Plano novo é chave nova.

## 11. Régua

`ReminderChannel` passa a ser `'push' | 'email' | 'whatsapp'`, e o editor das duas
plataformas ganha o toggle sozinho, porque já percorre `REMINDER_CHANNELS`.

Etapa que pede `whatsapp` e `push` dispara os dois no mesmo instante. A espera de
duas horas continua exclusiva do par push mais e-mail.

## 12. Segurança

- Token, app secret e verify token nunca em log, resposta ou erro.
- Corpo e erro da Meta ficam dentro de `vendors/meta/`, como o Expo já faz.
- As rotas de código e confirmação passam pelo throttle que a página pública já
  usa, com baldes próprios por token e por telefone.
- Código só como hash, cinco tentativas, dez minutos.
- A API pública nunca devolve o telefone inteiro, só os quatro últimos dígitos.

## 13. Testes

- `common`: `whatsapp` como canal de etapa; `PLAN_LIMITS`.
- Envio: cada linha do bloco de §8; opt-out mais recente que opt-in vence;
  50ª mensagem passa e 51ª degrada; ciclo novo zera; sem âncora usa o dia 1.
- Vendor: `disabled` sem variável; `wamid` vira `providerId`; 429 e 5xx
  transientes, 4xx permanente.
- Webhook: assinatura inválida recusa; aperto de mão responde o challenge;
  `delivered` e `failed` gravam evento; `failed` manda o e-mail; `wamid`
  desconhecido é ignorado; `SAIR`, `sair` e `Sair!` gravam opt-out.
- Público: código e confirmação gravam opt-in; cinco erros bloqueiam; token
  inválido não cria verificação; resposta nunca traz o telefone inteiro.

## 14. Fora desta fatia

Janela de 24 h e conversa free-form, que é o caminho natural para baratear a
cota. WhatsApp para o dono. Pacote extra quando a cota acaba. Comprovante enviado
pelo próprio WhatsApp.
