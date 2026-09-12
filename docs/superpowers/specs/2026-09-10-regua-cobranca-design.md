# Régua de cobrança com canal por etapa — design

Primeira das duas fatias do plano Pro em notificação. Entrega a régua
configurável usando os canais que já existem (`push`, `email`), sem depender de
nada externo. A segunda (`canal-whatsapp`) pluga o WhatsApp na régua desenhada
aqui.

Reescrito em 11/09/2026 contra a arquitetura atual de notificação: schedules
dinâmicos por cobrança, envio síncrono e `events` como log. A versão anterior
descrevia `notification_deliveries`, fila e consumidor, que não existem mais.

## 1. Objetivo

- Cada etapa da régua declara **em quais canais** ela sai, em vez de o canal ser
  deduzido da existência de dispositivo.
- O perfil ganha uma **régua padrão** que semeia toda cobrança nova, editável por
  cobrança.
- A escalação continua **fixa**: e-mail é sempre o fallback quando o push não
  entra.
- Entra a noção de plano (`free` / `pro`) no schema, para que a fatia 2 não
  obrigue a mexer de novo em tudo.

Fora do objetivo: mudar conteúdo de template, horário de envio, o modelo de
eventos ou qualquer regra de materialização.

## 2. Escopo

Dentro: `packages/common` (`domain/billing.ts`, `domain/billing-draft.ts`,
`domain/billing-calendar.ts`, `domain/user-preferences.ts`), `packages/api`
(`users/schemas/user.ts`, `users/repositories/`, `billings/services/reminders.ts`,
`billings/repositories/billing.ts`, `notifications/services/send.ts`,
`notifications/schedulers/charge-notify.ts`, `docs/openapi.json`),
`packages/web` e `packages/mobile` (formulário de cobrança e perfil).

Fora: WhatsApp, cota, cobrança de assinatura, paywall com pagamento, editor de
texto de template.

Sem dependência nova.

## 3. Como está hoje

Vale escrever, porque é o que torna esta fatia pequena.

- `planReminders` (`notifications/services/send.ts`) roda uma vez por dia e, para
  cada cobrança pendente, arma `charge:<id>:notify` no instante de cada etapa
  cuja hora cai nas próximas 24 h.
- `chargeNotifyHandler` dispara, e `notifyCharge` chama `sendChargeNotice` com
  `channel: 'auto'`.
- `'auto'` significa: push em todos os dispositivos ativos e **e-mail apenas se
  nenhum push entrou**. Isso já é, letra por letra, a regra de fallback que a
  régua quer.
- Se algum push entrou, `notifyCharge` rearma o mesmo schedule duas horas depois
  para o follow-up de e-mail.
- O resultado é um evento `notice.sent` ou `notice.skipped`, com
  `{ template, offsetDays, channels, reason }` no payload. Não há tabela de
  entrega, não há retry.

Traduzindo para a linguagem da régua: **o comportamento de hoje é uma etapa
`['push','email']`**, e o modo `'auto'` sozinho é uma etapa `['push']`.

## 4. Modelo de dados

### 4.1 `BillingReminder`

```ts
export type ReminderChannel = 'push' | 'email';

export type BillingReminder = {
  offsetDays: number;
  enabled: boolean;
  /** Ausente = comportamento atual: push com follow-up de e-mail. */
  channels?: ReminderChannel[];
};
```

Opcional de propósito: etapa gravada antes desta fatia mantém o comportamento
atual e **nenhuma linha é migrada**. `DEFAULT_BILLING_REMINDERS` continua
`[{ offsetDays: 0, enabled: true }]`.

### 4.2 Validação

`validateReminders` (`billing-calendar.ts`) já exige offset inteiro até 90,
`enabled` booleano e offsets únicos. Acrescenta, só quando `channels` existe:
array não vazio, canais conhecidos, sem repetição.

O teto de dez etapas deixa de ser constante e vira parâmetro:
`validateReminders(reminders, limits)`, com `limits` vindo de `PLAN_LIMITS`, o
mapa de plano para limites que nasce nesta fatia e que a fatia 2 estende com a
cota de WhatsApp. `packages/common` continua sem saber o que é plano; quem
resolve o número é o chamador.

### 4.3 `users`

```ts
/** Ausente significa 'free'. Editado à mão nesta fatia. */
plan?: 'free' | 'pro';
/** JSON de UserPreferences; chave ausente cai no padrão de cada uma. */
preferences?: String.Max<4000>;
```

```ts
export type UserPreferences = {
  /** Régua copiada para toda cobrança nova; null usa PROFILE_DEFAULT_REMINDERS. */
  reminders?: BillingReminder[];
};
```

Colunas opcionais, nunca `NOT NULL`: coluna obrigatória sobre linhas existentes
exigiria `ALTER` com `DEFAULT`, e esta fatia não mexe em migração.

**Escrita é merge por chave.** O `PUT` recebe objeto parcial e grava só as
chaves enviadas. Sem isso, a tela que edita a régua apaga qualquer preferência
que outra tela tenha gravado, e o bug só nasce quando existir a segunda chave.

O planner nunca lê `users.preferences`. É semente de formulário; a política mora
em `billings.reminders`.

## 5. Régua padrão do perfil

```ts
export const PROFILE_DEFAULT_REMINDERS: BillingReminder[] = [
  { offsetDays: -1, enabled: true, channels: ['push'] },
  { offsetDays: 0, enabled: true, channels: ['push', 'email'] }
];
```

Aviso no dia anterior só por push; no dia do vencimento push com follow-up de
e-mail. Usada em dois lugares: a tela de perfil, e o formulário de cobrança
nova, que copia a régua para dentro do rascunho. A partir daí a régua pertence à
cobrança, e editar o perfil não altera cobrança já criada.

## 6. Como o canal viaja até o envio

Três mudanças pequenas em cadeia, e nada mais.

**Um.** `ChargeNotifySchedule` (`notifications/schedulers/charge-notify.ts`)
ganha `channels?: ReminderChannel[]`. `planReminders` já percorre
`effectiveReminders`; passa `reminder.channels` adiante junto do `offsetDays` que
já coloca no evento.

**Dois.** `SendOptions` ganha `channels?: ReminderChannel[]`. O campo `channel`
continua existindo para os dois casos que não vêm de etapa: `'email'` no
follow-up e `'both'` no lembrete manual.

**Três.** `notifyCharge` arma o follow-up **apenas quando a etapa pediu e-mail**.
Hoje ele arma sempre que um push entrou.

Tabela completa do que cada etapa produz:

| Etapa pede | Comportamento |
|---|---|
| `['push']` | push em todo dispositivo ativo; e-mail imediato **só se nenhum push entrou**; sem follow-up |
| `['email']` | e-mail imediato, sem tocar em dispositivo |
| `['push','email']` | push agora, follow-up de e-mail em 2 h; se nenhum push entrou, e-mail imediato |
| ausente (legado) | idêntico a `['push','email']` |

Três consequências que valem registro:

- **O fallback não é configurável.** Etapa só de push em quem não tem dispositivo
  vira e-mail. Lembrete não entregue é o pior resultado do produto.
- **A espera de duas horas é exclusiva do par.** Ela existe para evitar e-mail
  redundante depois de um push, não para espaçar canais em geral.
- **Nada muda em idempotência.** O guarda de reenvio compara `template` e
  `offsetDays` nos eventos `notice.sent`, e uma etapa continua sendo um
  `offsetDays`.

### 6.1 O que muda no evento de follow-up

`followUpCharge` já checa se um `notice.sent` daquele `template`/`offsetDays` já
incluiu `email`. Isso continua valendo sem alteração: uma etapa `['push']` que
caiu no fallback de e-mail nunca arma follow-up, então a checagem nem é
alcançada.

## 7. Superfícies

- **API.** `POST` e `PUT` de billing aceitam `channels` dentro de `reminders`.
  Conta ganha `GET`/`PUT` de `preferences`, com merge por chave.
- **Mobile e web.** Editor de régua em `components/forms`, uma linha por etapa
  com o offset e um toggle por canal. Mesma peça nas duas plataformas. O perfil
  usa o mesmo componente.
- **Timeline.** Já lê `events`; passa a exibir `payload.channels` de cada
  `notice.sent`, e o `reason` de cada `notice.skipped`.

## 8. Plano e gate

`users.plan` nasce `free` e é editado à mão. O gate é estreito de propósito, para
não regredir quem já usa o produto:

| Capacidade | Free | Pro |
|---|---|---|
| Editar `offsetDays` e `enabled` | sim, como hoje | sim |
| Etapas por cobrança | até 2 | até 5 |
| Escolher canal por etapa | não | sim |
| Editar a régua padrão do perfil | não | sim |

Editar offsets já está em produção; trancar isso seria tirar função de quem tem.
O que vira Pro é o controle de canal, que é novidade. `free` mandando `channels`
recebe `403`; estourar o teto recebe `400`, porque é validação de conteúdo.

O teto vale **só na escrita**: régua já gravada continua sendo executada por
`planReminders` mesmo acima do limite. Limite em escrita falha na frente do
usuário; limite em leitura falharia semanas depois, invisível.

`PROFILE_DEFAULT_REMINDERS` tem exatamente duas etapas, então o Free recebe a
régua padrão inteira e fica no teto sem sentir.

## 9. Testes

- `packages/common`: validação de `channels`; teto por plano;
  `DEFAULT_BILLING_REMINDERS` inalterado; `PROFILE_DEFAULT_REMINDERS`.
- `notifications`: cada linha da tabela de §6, incluindo etapa sem `channels`
  reproduzindo o comportamento atual; follow-up armado só quando a etapa pediu
  e-mail; lembrete manual segue em `'both'`.
- `billings`: `free` com `channels` recebe `403`; `free` com 3 etapas e `pro` com
  6 recebem `400`; régua de 5 etapas gravada continua sendo armada após downgrade.
- `users`: `PUT` de `preferences` com só `reminders` preserva chave desconhecida.
- Clientes: formulário semeado pela régua do perfil; edição por cobrança não
  vaza para o perfil.

## 10. Decisões fechadas

1. Espera de 2 h mantida no par push mais e-mail.
2. Tetos por plano: duas etapas no `free`, cinco no `pro`, só na escrita.
3. Consentimento e canal novo ficam para a fatia 2.
