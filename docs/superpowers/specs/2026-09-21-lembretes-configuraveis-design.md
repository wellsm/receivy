# Lembretes configuráveis por canal — design

Data: 2026-09-21. Estado: aprovado em conversa, aguardando revisão do dono antes do plano de execução.

## 1. Objetivo

Deixar o usuário definir **quando** e **por quais canais** cada cobrança lembra o devedor: um padrão na conta do
usuário, que cada conta (billing) herda e pode sobrescrever. O mesmo padrão alimenta o lembrete manual, que passa
a só confirmar o que vai sair. Push deixa de ser "primeiro canal com e-mail duas horas depois" e vira um canal
implícito, enviado sempre que houver aparelho; e-mail e WhatsApp são os canais configuráveis. WhatsApp entra no
modelo agora, com transporte desligado; a cota por plano e o transporte real são fases seguintes.

Também entra o **opt-out do destinatário**: "Parar de receber" no e-mail (inclusive nos avisos que já existem
hoje) e, quando existir, no WhatsApp.

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| Níveis | Usuário > Conta. O mais específico vence. Sem nível por contato. |
| Herança | Conta com `reminders` nulo herda o padrão do dono **no momento do envio**, inclusive mudanças futuras. Editar na conta grava uma cópia própria. "Voltar ao padrão" grava nulo. |
| Canais | Por lembrete: cada offset marca e-mail e/ou WhatsApp. Push não é configurável: vai sempre que houver aparelho ativo. |
| Teto de lembretes | Até **5** offsets únicos por configuração, entre **-14 e +14** dias. Substitui o teto atual de 10 e ±90. |
| Follow-up | Removido. Um único envio por lembrete, com todos os canais resolvidos de uma vez. Sem `stage: 'followup'`. |
| Lembrete manual | Usa `config.manual` do dono. Modal só confirma, mostrando os canais que vão sair e por que os outros não vão. Continua furando o silêncio da cobrança e limitado a 1 por 24 h. |
| Conta a pagar | Auto-lembrete do dono: push e e-mail conforme config; WhatsApp nunca. |
| Número do WhatsApp | Credor informa no contato e declara consentimento. Se o devedor preencheu o próprio `phone` no onboarding, o dele vence. |
| Opt-out | Por canal, na linha do destinatário (`users`). Vale para todos os credores e para o lembrete manual. Link assinado no e-mail; botão de resposta rápida no WhatsApp. |
| Plano Grátis | Chip WhatsApp bloqueado na UI. API ignora `whatsapp: true` enquanto a cota do plano for 0. |
| Legado | Linhas de `billings.reminders` sem `channels` leem como e-mail só. Sem migração de dados. |

Fora de escopo desta fase: cota mensal de WhatsApp e excedente (fase 2), transporte WhatsApp, templates Meta,
webhook de status e opt-out por resposta rápida (fase 3), nível por contato, horário do lembrete (segue 06:00 no
fuso da conta), desativar push dentro do app.

## 3. Modelo

### 3.1 Domínio (`packages/common/src/domain/reminders.ts`, novo)

```ts
export type ChannelSet = { email: boolean; whatsapp: boolean };

export type ReminderRule = { offsetDays: number; enabled: boolean; channels: ChannelSet };

export type ReminderConfig = { reminders: ReminderRule[]; manual: ChannelSet };

export const REMINDER_MAX_RULES = 5;
export const REMINDER_MAX_OFFSET = 14;

export const SYSTEM_REMINDER_CONFIG: ReminderConfig = {
  reminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }],
  manual: { email: true, whatsapp: true }
};
```

`BillingReminder` e `DEFAULT_BILLING_REMINDERS` em `billing.ts` saem; quem os usa passa a usar `ReminderRule` e
`SYSTEM_REMINDER_CONFIG`. `validateReminders` em `billing-calendar.ts` passa a validar `ReminderRule[]`: inteiro,
`|offsetDays| <= 14`, únicos, `1..5` itens, `channels` com os dois booleanos. Um item legado sem `channels`
normaliza para `{ email: true, whatsapp: false }` na leitura, nunca na escrita.

### 3.2 Resolução

```ts
/** billing.reminders ?? owner.reminder_config ?? SYSTEM_REMINDER_CONFIG */
export function effectiveConfig(billingReminders: ReminderRule[] | null, ownerConfig: ReminderConfig | null): ReminderConfig;
```

Vive em `packages/api/src/billings/utils/reminders.ts`, substituindo `effectiveReminders`. Uma conta guarda só
`reminders`; `manual` vem sempre do dono. Materialização (`earliestOffset`) e planejamento diário (`planReminders`)
passam a chamar a resolução com o dono carregado junto.

### 3.3 Banco

| Tabela | Coluna | Tipo | Nota |
|---|---|---|---|
| `users` | `reminder_config` | JSON, nulo | Nulo = padrão do sistema. |
| `users` | `email_opt_out_at` | timestamp, nulo | Preenchido pelo link do e-mail. |
| `users` | `whatsapp_opt_out_at` | timestamp, nulo | Preenchido pela resposta rápida (fase 3). Coluna nasce agora. |
| `contacts` | `phone` | texto E.164, nulo | Digitado pelo credor. |
| `contacts` | `whatsapp_consent_at` | timestamp, nulo | Credor marcou "tenho consentimento". Nulo bloqueia WhatsApp por esse contato. |
| `billings` | `reminders` | JSON, nulo | Sem mudança de tipo. Conteúdo passa a `ReminderRule[]`. |

Colunas novas são nulas: o EZ4 sincroniza sozinho, sem migração.

## 4. Envio

### 4.1 `sendChargeNotice`

Assinatura passa a receber o `ChannelSet` já resolvido em vez de `channel: 'auto' | 'email' | 'both'`:

```ts
type SendOptions = { offsetDays?: number; channels: ChannelSet };
```

Portões atuais continuam na mesma ordem (pendente, em revisão, silenciada, registro, sem destinatário, Pix,
link). Depois deles, por canal:

| Canal | Sai quando | Motivo de queda (`dropped.reason`) |
|---|---|---|
| push | há aparelho ativo do destinatário | não registra queda: push é implícito |
| email | `channels.email`, destinatário tem e-mail, `email_opt_out_at` nulo | `no_email`, `opted_out` |
| whatsapp | `channels.whatsapp`, conta a receber, número efetivo existe, `whatsapp_consent_at` ou `user.phone` do devedor, `whatsapp_opt_out_at` nulo, transporte ligado, cota do plano > 0 | `no_phone`, `no_consent`, `opted_out`, `unavailable`, `quota` |

Regra de e-mail simplificada: e-mail sai sempre que marcado e possível. Não depende mais de push ter falhado.

Evento `notice.sent` ganha `dropped?: { channel: 'email' | 'whatsapp'; reason: string }[]`. `channels` continua
como está (um `push` por aparelho) para não quebrar `emailAlreadySent`, a deduplicação do scheduler e a cota do
manual. `emailAlreadySent` deixa de existir junto com o follow-up.

### 4.2 Scheduler

`charge-notify.ts` perde o `stage`. `notifyCharge` resolve a config, encontra a regra pelo `offsetDays` do
evento e chama `sendChargeNotice` com `rule.channels`. `followUpCharge` e `EMAIL_FOLLOWUP_MS` saem. Aviso inicial
(`announceCharges`) usa os canais da **primeira regra habilitada**; sem regra habilitada, usa
`SYSTEM_REMINDER_CONFIG.reminders[0].channels`.

### 4.3 Manual

`POST /charges/{id}/reminders` continua sem corpo. Serviço resolve `config.manual` do dono e envia. Resposta passa a
`202 { channels: NoticeChannel[]; dropped: Dropped[] }`; `queued` some, o cliente deriva de `channels.length`.
Novo `GET /charges/{id}/reminders/preview` devolve o mesmo formato sem enviar, para o modal.

### 4.4 Opt-out por e-mail

- Todo e-mail de aviso (inicial, lembrete, manual) ganha rodapé "Parar de receber avisos do Receivy" com link
  `GET /public/notices/opt-out/{token}` e cabeçalho `List-Unsubscribe`.
- Token: HMAC com `PUBLIC_LINK_HMAC_SECRET` sobre `userId` e `email`, sem expiração, mesmo padrão do link público.
- Endpoint público grava `users.email_opt_out_at` e renderiza página simples no web (`/opt-out/[token]`) com
  "Você não recebe mais e-mails de cobrança. Quem te cobra ainda pode te mandar o link direto." e botão "Voltar a
  receber", que limpa a coluna.
- Login por código continua saindo: opt-out cobre só avisos de cobrança.

## 5. API

| Rota | Autorização | Corpo / resposta |
|---|---|---|
| `GET /me/reminders` | sessão | `{ config: ReminderConfig; inherited: boolean }` (`inherited` = coluna nula) |
| `PUT /me/reminders` | sessão | corpo `ReminderConfig`; valida teto e faixa; grava; devolve igual ao GET |
| `DELETE /me/reminders` | sessão | volta ao padrão do sistema (coluna nula) |
| `PUT /contacts/{id}` | sessão | ganha `phone?` e `whatsappConsent: boolean` |
| `GET /charges/{id}/reminders/preview` | sessão, credor | `{ channels, dropped }` |
| `POST /charges/{id}/reminders` | sessão, credor | resposta `{ channels, dropped }` |
| `GET /public/notices/opt-out/{token}` | pública | grava opt-out, 302 para o web |
| `DELETE /public/notices/opt-out/{token}` | pública | limpa opt-out |

`POST /billings` e `PATCH /billings/{id}`: `reminders` aceita `ReminderRule[]` ou `null`. `GET /billings/{id}`
devolve `reminders: ReminderRule[] | null` e `effectiveReminders: ReminderRule[]` para a UI mostrar o herdado.

## 6. UI

### 6.1 Perfil > Lembretes (web e mobile)

- Lista de até 5 linhas. Cada linha: seletor de dias com rótulo humano ("3 dias antes", "no dia", "2 dias depois"),
  toggle ativo, chips **E-mail** e **WhatsApp**. Botão "Adicionar lembrete" some na 5ª linha.
- Bloco "Lembrete manual" com os dois chips e a frase "É o que sai quando você toca em Lembrar".
- Disclaimer fixo: "Notificação no app vai sempre que a pessoa permitir no celular dela."
- Chip WhatsApp: bloqueado com "Plano Básico" no Grátis; com "Em breve" enquanto o transporte estiver desligado
  (`GET /me` passa a expor `whatsappAvailable`).
- Rodapé: "Voltar ao padrão" (chama DELETE).

### 6.2 Form da conta

- Bloco "Lembretes" recolhido: "Usando seu padrão: no dia, e-mail". Botão "Personalizar" copia a config efetiva
  para o draft e abre o mesmo editor da 6.1 sem o bloco manual. Botão "Voltar ao padrão" limpa para nulo.
- Contas já geradas continuam editáveis (`FROZEN_NOTE` já permite lembretes).
- `billing-draft.ts`: `reminders: ReminderDraft[] | null`; nulo é o estado inicial de conta nova.

### 6.3 Contato

- Campo "WhatsApp" (telefone com máscara BR, salvo em E.164) e checkbox "Essa pessoa concordou em receber
  cobranças por WhatsApp". Sem checkbox, o número salva mas o canal não sai.
- Se o devedor já tem `phone` próprio, o campo mostra "Número informado pela própria pessoa" e fica só leitura.

### 6.4 Modal Lembrar (web detalhe, mobile detalhe, `RemindSheet` do feed)

- Abre chamando o preview. Mostra "Vai por: notificação, e-mail" e, abaixo, os que não vão com o motivo em uma
  linha ("WhatsApp: sem número no contato"). Botão único "Enviar lembrete".
- Sem nenhum canal possível: botão desabilitado e texto "Ninguém alcançável. Compartilhe o link direto."

### 6.5 E-mail

Rodapé com "Parar de receber" em todos os avisos de cobrança, já nesta fase.

## 7. Testes

- Domínio: `validateReminders` (teto 5, ±14, únicos, legado sem `channels`), `effectiveConfig` (três níveis).
- API: seleção de canal por regra, `dropped` por motivo, manual com `config.manual`, preview sem envio, opt-out
  grava e limpa, e-mail carrega o link, follow-up não é mais armado, aviso inicial usa a primeira regra.
- Web e mobile: editor limita a 5 linhas e ±14, chip bloqueado por plano e por disponibilidade, bloco da conta
  alterna herdado e próprio, modal mostra canais e motivos, contato salva telefone e consentimento.
- Contrato OpenAPI (`docs/api-oas.yml` e `openapi-contract.test.ts`) atualizado com as rotas novas e a resposta do
  manual.

## 8. Fases seguintes (não fazem parte deste plano)

1. Plano: `PLAN_LIMITS.whatsapp` (Grátis 0, Básico 150, Pro 400), contador mensal a partir de `notice.sent`, motivo
   `quota`, pacote excedente na fatura Stripe.
2. WhatsApp: transporte Meta Cloud API, 4 templates de utilidade, webhook de status, resposta rápida "Parar de
   receber" gravando `whatsapp_opt_out_at`.
