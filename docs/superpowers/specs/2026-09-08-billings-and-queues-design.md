# Billings únicos e jobs em fila — design

Data: 2026-09-08. Substitui as seções "Compras, rateios e cobranças",
"Recorrências" e "Timeline, notificações e auditoria" de
`2026-09-04-receivy-mvp-design.md` no que conflitar. Regras de rateio, Pix,
link público, comprovante e autenticação continuam valendo.

## 1. Objetivo

Uma única entidade para "quero cobrar alguém ou alguns": uma vez, todo mês (ou
ano) até uma data, ou todo mês (ou ano) até eu cancelar. Todo trabalho
assíncrono sai das tabelas de estado do Postgres e passa a rodar em filas SQS
do EZ4, com retry e dead-letter. Menos tabelas, um fluxo de criação, um
mecanismo de job.

Critérios de sucesso:

- `expenses`, `expense_allocations`, `recurrences`, `recurrence_allocations`,
  `recurrence_reminders` e `recurrence_occurrences` viram `billings` +
  `allocations`; `charges` aponta para `billing_id`.
- `outbox_events`, `storage_deletions`, `storage_cleanup_cursors` e
  `apple_credentials` deixam de existir. Total: 30 → 22 tabelas.
- Nenhum cron executa efeito externo; cron só descobre trabalho por data e
  enfileira. Consumidores são idempotentes; falha esgotada vai para DLQ.
- Web e Expo têm uma tela "Nova cobrança" com seletor de tipo e uma aba
  "Cobranças" que lista `billings`. A Timeline continua sendo o feed de
  `charges`.
- `pnpm verify`, `test:integration` e smoke local (web com cookies reais, iOS
  via Maestro) passam ao fim de cada fatia.

## 2. Escopo

Incluído: schema novo (reset do banco local, sem migração de dados), API
`/billings`, contratos em `@receivy/common`, telas web e Expo, três filas EZ4
(`NotificationQueue`, `BillingQueue`, `StorageQueue`), remoção da revogação
Apple, specs de integração reescritas, OpenAPI e docs.

Fora: pagamento parcial, frequências além de mensal/anual, renomear
`payment_methods` → `pix_keys` (decisão aberta, ver §11), migração de dados de
ambiente existente (não há deploy).

## 3. Modelo de dados

Todos os IDs são UUID; dinheiro em centavos; datas civis em `date`; instantes
em UTC; calendário no timezone IANA do `billing`.

### `billings`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `id`, `owner_id` | uuid | dono é o credor de todas as `charges` geradas |
| `type` | `once` \| `until` \| `indefinite` | ver §4 |
| `frequency` | `monthly` \| `yearly` \| nulo | obrigatório em `until` e `indefinite`; nulo em `once` |
| `description` | text ≤ 500 | snapshot nas `charges` |
| `total_cents`, `currency` | int, `'BRL'` | valor de cada ocorrência |
| `start_date` | date | primeiro vencimento; dia (e mês, no anual) da regra vêm daqui |
| `end_date` | date \| nulo | obrigatório em `until`; nulo nos demais |
| `timezone` | text | IANA, obrigatório |
| `payment_method_id` | uuid \| nulo | chave Pix escolhida; nulo = padrão do dono na materialização |
| `reminders` | json \| nulo | `[{ offsetDays, enabled }]`; nulo = usa `notification_preferences.reminder_offsets` do dono |
| `state` | `active` \| `paused` \| `ended` | `paused` só é aceito em `indefinite` |
| `processed_through` | date \| nulo | cursor de materialização, só `indefinite` |
| `idempotency_key`, `request_hash` | text | único por `(owner_id, idempotency_key)`; hash diferente com mesma chave → 409 |
| `created_at`, `updated_at` | timestamptz | |

Índices: PK; `(owner_id, idempotency_key)` único; `owner_id`; `(state, type)`.

### `allocations`

Substitui `expense_allocations` e `recurrence_allocations`, mesma forma:
`id`, `billing_id`, `kind` (`owner` \| `person`), `person_id` (nulo para
`owner`), `split_mode` (`fixed` \| `equal` \| `percentage`), `basis_points`
(nulo fora de `percentage`), `amount_cents` (parte resolvida por ocorrência),
`allocation_order`, `created_at`. Índices: PK; `billing_id`;
`(billing_id, allocation_order)` único; `person_id`.

### `charges`

Mantém todas as colunas atuais, com estas mudanças:

- `source`, `source_id`, `source_occurrence_id` → `billing_id` (obrigatório).
- `installment`, `installment_count` passam a ser nulos em `indefinite`;
  `once` grava `1/1`; `until` grava `k/N`.
- `billing_type` (snapshot de `billings.type`) para filtrar a timeline e
  devolver `billingType` sem join.
- Índice único novo `(billing_id, debtor_person_id, due_date)`: garante que a
  materialização nunca duplica uma ocorrência e substitui
  `recurrence_occurrences`.

### Tabelas que somem

| Tabela | Substituída por |
| --- | --- |
| `expenses`, `recurrences` | `billings` |
| `expense_allocations`, `recurrence_allocations` | `allocations` |
| `recurrence_reminders` | `billings.reminders` (json) |
| `recurrence_occurrences` | índice único em `charges` |
| `outbox_events` | mensagem na `NotificationQueue` |
| `storage_deletions`, `storage_cleanup_cursors` | `StorageQueue` + varredura completa |
| `apple_credentials` | nada (ver §7) |

### `notification_deliveries`

Continua como registro de idempotência e histórico por canal. Perde
`available_at`, `lease_until` e `attempts` (o SQS controla tentativas). Ganha
`attempt_count` só informativo, gravado pelo consumidor a partir de
`request.attempt`. Estados: `pending` \| `sending` \| `accepted` \|
`delivered` \| `disabled` \| `failed` \| `uncertain` \| `suppressed`.
`idempotency_key` único: `charge:<id>:initial`, `charge:<id>:reminder:<offset>`,
`charge:<id>:manual:<eventId>`, sufixo `:email` ou `:push`.

Lista final (22): `users`, `auth_identities`, `login_codes`,
`oauth_attempts`, `oauth_grants`, `session_families`, `refresh_tokens`,
`people`, `person_contacts`, `payment_methods`, `billings`, `allocations`,
`charges`, `payments`, `public_links`, `upload_intents`, `payment_proofs`,
`proof_throttles`, `notification_preferences`, `device_tokens`,
`notification_deliveries`, `activity_events`.

## 4. Regras de domínio

### Tipos

| `type` | Significado | Materialização | Estados válidos |
| --- | --- | --- | --- |
| `once` | uma cobrança por pessoa, vencimento `start_date` | todas as `charges` na criação, na mesma transação | `active`, `ended` |
| `until` | `frequency` de `start_date` até `end_date` inclusive | todas as `charges` na criação; `installment_count` = número de datas no intervalo | `active`, `ended` |
| `indefinite` | `frequency` a partir de `start_date`, sem fim | job por janela de lembrete (§6) | `active`, `paused`, `ended` |

`end_date < start_date` → 422. `until` com mais de 120 ocorrências → 422
(guarda contra explosão de linhas). `once` ignora `frequency`, `end_date`,
`processed_through`.

### Rateio

Igual ao spec original: `fixed`, `equal`, `percentage`, largest remainder,
ordem estável, parte do dono não gera `charge`. `resolveExpenseSplit` em
`@receivy/common` passa a se chamar `resolveBillingSplit(totalCents, split)`.
`total_cents` é o valor de **cada ocorrência** em todos os tipos: `once` cobra
uma vez, `until` e `indefinite` cobram esse valor a cada data. O rateio é
resolvido uma vez e repetido em cada ocorrência, então a soma por pessoa e por
ocorrência permanece exata. Não existe mais "total da compra dividido em N";
o atalho "N vezes" da tela só calcula `end_date`.

### Calendário

`recurrenceDates(rule, from, to, limit)` continua a fonte: dia 29–31 limita ao
último dia do mês; anual em 29/fev usa 28/fev em ano não bissexto. A regra
lê dia e mês de `start_date`; os campos `day` e `month` deixam de existir.

### Edição e estado

`PATCH /billings/{id}` aceita `description`, `totalCents`, `split`,
`paymentMethodId`, `reminders`, `state`. Estender o fim de uma `until` fica
fora da slice 1: `endDate` não é patchável para nenhum tipo. Regras:

- `once` e `until`: só `state: 'ended'` (cancela todas as `charges` pendentes
  na mesma transação) e `reminders`/`paymentMethodId`; demais campos → 409,
  porque as `charges` já existem e são snapshot.
- `indefinite`: qualquer campo; afeta só ocorrências ainda não materializadas.
  Trocar data para trás rebobina `processed_through` como hoje.
  `state: 'paused'` para o job; `active` retoma a partir de hoje sem gerar
  ocorrências perdidas; `ended` é terminal e cancela pendentes.
- Estado `ended` não aceita mais PATCH → 409.

### Timeline

Feed de `charges` do usuário (credor ou devedor vinculado), um item por
`charge`. Para `indefinite` ativo, projeta as próximas ocorrências não
materializadas como `billing_preview` (hoje `recurrence_preview`), dentro do
filtro de datas. Nada muda para quem paga.

### Lembretes

Origem dos offsets, nesta ordem: `billings.reminders` (se não nulo) →
`notification_preferences.reminder_offsets` do dono → `[-3, 0, 2]`. Editar
lembretes afeta lembretes ainda não enfileirados; enfileirados não são
cancelados.

## 5. API e contratos

Rotas removidas: `POST/GET /expenses*`, todas as `/recurrences*`.

| Rota | Efeito |
| --- | --- |
| `POST /billings` | cria; header `idempotency-key` obrigatório; devolve `BillingDetail` com `charges` já geradas (`once`/`until`) ou `previews` (`indefinite`) |
| `GET /billings` | lista do dono, paginada por cursor, ordem `created_at desc`; filtros `type`, `state` |
| `GET /billings/{id}` | detalhe com `allocations`, `charges` (todas, ordenadas por `due_date`, `installment`) e `previews` |
| `GET /billings/{id}/preview` | próximas 90 dias projetadas (só `indefinite`); 409 nos demais |
| `PATCH /billings/{id}` | edição e transição de estado no mesmo corpo (§4) |

`charges`, `public-link`, `proofs`, `payments`, `timeline`, `people`,
`payment-methods`, `notification-preferences` e `devices` não mudam de rota.
`ChargeDetail` troca `source` por `billingId` e `billingType`.

Contratos em `@receivy/common` (campos explícitos, sem `Omit`, por causa da
reflexão do EZ4):

```ts
type BillingType = 'once' | 'until' | 'indefinite';
type BillingFrequency = 'monthly' | 'yearly';
type BillingState = 'active' | 'paused' | 'ended';
type BillingReminder = { offsetDays: number; enabled: boolean };
type BillingInput = {
  type: BillingType; frequency?: BillingFrequency;
  description?: string; totalCents: number;
  startDate: string; endDate?: string; timezone: string;
  paymentMethodId?: string; reminders?: BillingReminder[];
  split: BillingSplit;
};
type BillingPatch = Partial<Pick<BillingInput, 'description' | 'totalCents' | 'split' | 'paymentMethodId' | 'reminders'>> & { state?: BillingState };
type BillingDetail = { id; type; frequency?; description; total: Money; startDate; endDate?; timezone; paymentMethodId?; reminders: BillingReminder[]; state; installmentCount?: number; allocations: BillingAllocation[]; charges: ChargeDetail[]; previews: BillingPreview[]; nextMaterialization: string | null; createdAt; updatedAt };
type BillingsPage = { billings: BillingSummary[]; nextCursor: string | null };
```

`RecurrenceDraft`/`buildRecurrenceInput` viram `BillingDraft`/
`buildBillingInput`, usados pelas duas telas.

## 6. Filas e crons

Pacotes: `@ez4/queue`, `@ez4/aws-queue`, `@ez4/local-queue` (0.52.0, mesma
linha do restante). Todas as filas são `Queue.Service` em modo padrão, com:

```ts
deadLetter: Queue.UseDeadLetter<{ maxAttempts: 5; retention: 20160 }>; // 14 dias
backoff: Queue.UseBackoff<{ minDelay: 5; maxDelay: 300 }>;
```

| Fila | Mensagem | Produtor | Consumidor |
| --- | --- | --- | --- |
| `NotificationQueue` | `{ deliveryId: uuid }` | `POST /billings` (aviso inicial), `POST /charges/{id}/reminder` (manual), `BillingQueue` (aviso da ocorrência), `NotificationCron` (lembretes do dia) | carrega a `delivery`, renderiza, envia por e-mail ou push, grava `accepted`/`uncertain`/`failed`/`suppressed` |
| `BillingQueue` | `{ billingId: uuid }` | `BillingCron` | materializa **uma** ocorrência em transação (`charges` + `deliveries` pendentes), avança `processed_through`, enfileira os avisos |
| `StorageQueue` | `{ objectKey: string; purpose: 'orphan' \| 'temporary' \| 'account' }` | rejeição/troca de comprovante, expiração de `upload_intents`, exclusão de conta, `StorageCron` (órfãos) | apaga o objeto no storage configurado |

Contrato do produtor: a linha de banco (`delivery`, `charge`) é gravada e
commitada **antes** do `sendMessage`. Se o `sendMessage` falhar, a linha fica
`pending` e o cron seguinte a reenfileira (o cron também varre `pending` com
`created_at` há mais de 10 min). Nunca o contrário: mensagem sem linha é
descartada pelo consumidor com log.

Contrato do consumidor:

1. Ler a linha; se já está em estado terminal, retornar sem fazer nada
   (idempotência; SQS pode entregar mais de uma vez).
2. Marcar `sending` com `attempt_count = request.attempt`.
3. Executar o efeito externo. Resultado `accepted`/`delivered`/`suppressed`
   → gravar e terminar. `uncertain` (provedor não confirmou) → gravar
   `uncertain` e **não** lançar; não se reenvia e-mail que talvez tenha
   chegado.
4. Erro transitório (rede, 5xx, 429) → lançar. O SQS reentrega com backoff.
5. Na última tentativa (`request.attempt === request.maxAttempts`), gravar
   `failed` com `reason` antes de lançar; a mensagem vai para a DLQ com o
   mesmo payload para inspeção.

Crons (`Cron.Service`, `maxRetries: 1`, handler só consulta e enfileira):

| Cron | Expressão | Trabalho |
| --- | --- | --- |
| `NotificationCron` | a cada 5 min | para `charges` pendentes com `due_date` entre hoje−90 e hoje+90 no timezone do `billing`, calcular offsets devidos hoje, inserir `delivery` `pending` se a `idempotency_key` não existir, enfileirar; reenfileirar `pending` antigas |
| `BillingCron` | a cada hora | `billings` `indefinite` ativos cuja próxima ocorrência (após `processed_through`) tem data de materialização ≤ hoje → enfileirar `{ billingId }` |
| `StorageCron` | a cada hora | listar objetos do bucket sem `payment_proofs`/`upload_intents` correspondentes e enfileirar `orphan`/`temporary`; varredura completa por prefixo, sem cursor |

Os quatro schedulers atuais (`NotificationScheduler`, `RecurrenceScheduler`,
`ProofCleanupScheduler`, `AppleRevocationScheduler`) deixam de existir.

Local: `@ez4/local-queue` executa o handler em processo com o delay
configurado; `ez4 serve --local` sobe filas junto com gateway e schedulers.
Nenhuma variável nova de ambiente; nomes das filas seguem o prefixo do stage.

AWS: `@ez4/aws-queue` cria a fila, a DLQ e a assinatura Lambda. Alarme de DLQ
fica como item de deploy no `docs/deploy-guide.md`, não neste spec.

## 7. Exclusão de conta

Alinhada ao Rewarlo: apaga `auth_identities`, `session_families`,
`refresh_tokens`, `device_tokens`, `oauth_grants` do usuário; anonimiza
`users` como hoje (`deleted_at` e e-mail liberado para reuso); `billings` do dono vão
para `ended` e `charges` pendentes para `cancelled`; comprovantes enviados pelo
usuário são removidos via `StorageQueue` com `purpose: 'account'`; registros
compartilhados (cobranças onde ele é devedor, comprovantes de terceiros)
permanecem com referências anonimizadas. Não há chamada à Apple nem token
Apple armazenado; `apple_credentials`, `detachAppleCredentials`,
`drainAppleRevocations` e a mensagem `ACCOUNT_DELETED` sobre Ajustes da Apple
saem. O login nativo Apple valida o `id_token` e não guarda refresh token.

## 8. Experiência

- **Nova cobrança** (web e Expo, uma tela): seletor "Uma vez / Até uma data /
  Sem fim" no topo; campos de calendário aparecem conforme o tipo (`until`:
  frequência + data final ou "N vezes", que vira `end_date`; `indefinite`:
  frequência). Pessoas, rateio, Pix e lembretes são os mesmos blocos para os
  três tipos. Revisão exata antes de criar, rascunho preservado em falha de
  rede e retry idempotente continuam. Sem `fieldset` aninhado; um bloco por
  etapa.
- **Aba Cobranças** (substitui "Recorrências"): lista `billings` do dono, um
  item por `billing` com tipo, valor, próxima data e estado. Detalhe mostra as
  `charges` por pessoa/vencimento (e previews em `indefinite`), com pausar,
  retomar, encerrar e editar conforme §4.
- **Timeline**: inalterada como feed de `charges` (5 pessoas = 5 itens);
  `billing_preview` no lugar de `recurrence_preview`.
- **Ajustes**: sem mudança nesta entrega além de remover o texto Apple da
  exclusão de conta.

## 9. Erros

`{ code, message, correlationId }` como hoje, com os códigos já existentes:
validação de tipo/datas/ocorrências → 400 `INVALID_REQUEST`; PATCH em
`ended`, campo incompatível com o tipo ou `paused` fora de `indefinite` → 409
`CONFLICT`. Clientes mapeiam só `code` via `apiErrorMessage`; a mensagem do
servidor explica o motivo para logs e smoke.

## 10. Testes

Integração (EZ4 `DatabaseTester` + `QueueTester`):

- `billings.spec.ts`: criação dos três tipos com rateios `fixed`/`equal`/
  `percentage`, exatidão de centavos por pessoa e por ocorrência, `until` com
  dia 31 e 29/fev, idempotência por chave, PATCH por tipo/estado, `ended`
  cancelando pendentes, `QueueTester.getClientMock('NotificationQueue')`
  provando um `sendMessage` por `delivery`.
- `billing-queue.spec.ts`: `BillingCron` enfileira só o devido; consumidor
  materializa uma ocorrência, reentrega da mesma mensagem não duplica
  (índice único), pausa/retomada, `processed_through`.
- `notifications.spec.ts` (reescrita): cron cria `deliveries` sem duplicar,
  consumidor cobre cada estado, `uncertain` não relança, última tentativa
  grava `failed`, `pending` antiga é reenfileirada.
- `storage.spec.ts`: produtores enfileiram, consumidor apaga e é idempotente,
  varredura de órfãos.
- `account.spec.ts`: exclusão sem Apple; `apple-lifecycle.spec.ts` sai.
- Unidade (`vitest`/`jest`): `planBillingCharges`, `buildBillingInput`,
  seletor de tipo nas telas, mapeamento de erros. Contrato OpenAPI × BFF ×
  Expo atualizado para `/billings`.
- Smoke: web com cookies reais criando `once` e `indefinite`; iOS via Maestro
  `03-contact-charge.yaml` adaptado ao seletor de tipo.

## 11. Decisões

Fechadas: `once`/`until`/`indefinite`; materialização total para tipos
finitos; cron descobre e SQS executa; reset de banco sem migração; nomes
`billings` + `charges`; `reminders` json; PATCH único; aba Cobranças;
exclusão de conta igual ao Rewarlo.

Abertas (não bloqueiam): renomear `payment_methods` → `pix_keys` e
`/payment-methods` → `/pix-keys`; alarme de DLQ no deploy.

## 12. Entrega

1. **Billings**: schema, `billings/repository.ts`, rotas, contratos, timeline,
   telas web e Expo, `billings.spec.ts`, OpenAPI, docs.
2. **Filas de notificação e materialização**: pacotes de fila, `NotificationQueue`,
   `BillingQueue`, `NotificationCron`, `BillingCron`, remoção de `outbox_events`,
   `notifications.spec.ts` e `billing-queue.spec.ts`.
3. **Storage e conta**: `StorageQueue`, `StorageCron`, remoção de
   `storage_deletions`, `storage_cleanup_cursors`, `apple_credentials` e do
   scheduler Apple; `storage.spec.ts`, `account.spec.ts`.

Cada fatia tem seu plano em `docs/superpowers/plans/` e fecha com os gates de
§10.
