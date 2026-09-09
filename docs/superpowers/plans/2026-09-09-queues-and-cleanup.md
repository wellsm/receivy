# Filas EZ4 e remoção dos jobs em banco — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir `outbox_events`, `storage_deletions`, `storage_cleanup_cursors`, `apple_credentials` e os quatro schedulers por `NotificationQueue`, `BillingQueue`, `StorageQueue` (SQS com backoff e DLQ) e três crons que só enfileiram, mantendo a política de avisos.

**Architecture:** O banco continua dono do agendamento (`available_at`); as filas transportam e fazem retry; `queued_at` + janela de 15 min evita duplicar e recupera mensagens perdidas. Produtores gravam e commitam antes do `sendMessage`. Consumidores são idempotentes por lease/estado.

**Tech Stack:** EZ4 0.52 (`@ez4/queue`, `@ez4/local-queue`, `@ez4/aws-queue` novos), Postgres, specs `node:test` via `DatabaseTester`/`QueueTester`, Biome.

**Spec:** `docs/superpowers/specs/2026-09-09-queues-and-cleanup-design.md` (sobre `2026-09-08-billings-and-queues-design.md` §6–§7)

## Global Constraints

- Dependências novas permitidas: exatamente `@ez4/queue@0.52.0` (dependencies), `@ez4/local-queue@0.52.0` e `@ez4/aws-queue@0.52.0` (devDependencies). Nada mais.
- Sem migração: banco local recriado; colunas novas opcionais ou com default.
- Política de avisos intacta: nova cobrança e "Lembrar" imediatos; lembrete às 09:00 no fuso da billing; push primeiro, e-mail `+2h` (`push_followup`), push falho antecipa; receipts `+15 min`; dedup 23 h; backoff `2^n min`; 5 tentativas.
- Fila: `deadLetter { maxAttempts: 5; retention: 20160 }`, `backoff { minDelay: 5; maxDelay: 300 }`, `concurrency: 2`, `timeout: 120`. Produtor commita antes de enviar. Consumidor: terminal → retorna; `transient` → grava backoff e lança; `uncertain` → grava e retorna; `attempt === maxAttempts` → `failed`/`retry_exhausted` e lança.
- Cron: `Cron.Service` com `maxRetries: 1`, handler só consulta e enfileira. `NotificationCron` `cron(0/5 * * * ? *)`, `BillingCron` `cron(0 * * * ? *)`, `StorageCron` `cron(15 * * * ? *)`.
- Nunca logar tokens/códigos; nunca commitar env files. Código/commits em inglês; Biome; early returns; sem one-liners densos.
- Cada task: `lint`, `check-types`, `check-types:test`, `test`, `test:integration` verdes antes do commit; trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_016BY3v9hkgmh7emjR6A5gG2`.

---

### Task 1: Dependências, schema das deliveries, mensagem de conta excluída

**Files:**
- Modify: `packages/api/package.json` (+ lockfile via `pnpm add`), `packages/api/src/schemas/notification.ts` (`NotificationDeliverySchema`: `template: 'initial' | 'reminder' | 'manual'`, `queued_at?: String.DateTime`, `event_id: String.Max<200>` — já é texto), `packages/api/src/notifications/render.ts` (`renderNotice(input, template)` trata `'manual'` como `'reminder'`), `packages/common/src/domain/account.ts` (`ACCOUNT_DELETED` novo texto), `packages/common/src/domain/notifications.ts` (`NotificationDelivery.template` inclui `'manual'`)
- Test: `packages/api/src/notifications/render.test.ts` (criar se não existir: `manual` rende igual a `reminder`), `packages/common` testes existentes.

**Interfaces (Produces):** `ACCOUNT_DELETED = 'Conta excluída no Receivy. Arquivos e avisos pendentes são removidos em segundo plano. Isso não altera registros compartilhados preservados.'`; coluna `queued_at`; template `manual`.

- [ ] **Step 1:** `cd packages/api && pnpm add @ez4/queue@0.52.0 && pnpm add -D @ez4/local-queue@0.52.0 @ez4/aws-queue@0.52.0`; confirmar `node_modules/@ez4/local-queue/dist/test.*` exporta `QueueTester`.
- [ ] **Step 2 (RED):** teste `renderNotice(inputs, 'manual', secret)` igual a `'reminder'`; web/mobile testes que citam `ACCOUNT_DELETED` continuam verdes (constante).
- [ ] **Step 3:** implementar schema/render/common.
- [ ] **Step 4:** `pnpm --filter @receivy/common test lint check-types`; `pnpm --filter @receivy/api lint check-types check-types:test test`; `pnpm --filter @receivy/web test`; `pnpm --filter @receivy/mobile test` (só os que citam a constante).
- [ ] **Step 5: Commit** `build(api): add ez4 queue providers and prepare deliveries for queues`

---

### Task 2: Avisos por fila — produtores, cron e consumidor; fim do outbox

**Files:**
- Create: `packages/api/src/notifications/queue.ts` (`NotificationQueue` + `deliverNotification`), `packages/api/src/notifications/cron.ts` (`NotificationCron` + `notificationCronHandler`), `packages/api/src/notifications/planner.ts` (`planNotice`, `enqueueDue`, `NoticeContext`, `dueReminderOffsets`), `packages/api/src/notifications/consumer.ts` (lógica de 1 delivery, extraída de `worker.ts`)
- Delete: `packages/api/src/notifications/outbox.ts`, `worker.ts`, `scheduler.ts`, `src/schemas/outbox-event.ts`
- Modify: `packages/api/src/database.ts` (remove `outbox_events`), `src/charges/materialize.ts` (`persistChargePlan(db, ownerId, plan, billing, context, now, notice: NoticeContext)`; `recordCreation` grava só `activity_events` e chama `planNotice(... 'initial')`), `src/billings/repository.ts` (`createBilling` recebe `notice`, devolve ids devidos; endpoint enfileira após o commit), `src/invites/repository.ts` (`acceptInvite` idem), `src/notifications/repository.ts` (`manualReminder` via `planNotice` + cota por `template = 'manual'`), `src/public/repository.ts` (retomada `pix_required`), `src/proofs/events.ts` (`proofEvent` só `activity_events`), `src/account/deletion.ts` (sem `outbox_events`), `src/provider.ts` (`notificationQueue: Environment.Service<NotificationQueue>`), `src/billings/endpoints.ts`, `src/invites/endpoints.ts`, `src/notifications/endpoints.ts` (enfileiram), `src/public/endpoints.ts`, `ez4.project.js` (`sourceFiles`: `notifications/queue.ts`, `notifications/cron.ts` no lugar de `notifications/scheduler.ts`), `test/fixtures/financial.ts` (sem `outbox_events`)
- Test: `packages/api/test/notifications/notifications.spec.ts` (reescrita), `billings.spec.ts`, `invites.spec.ts`, `proofs.spec.ts` (asserções de outbox → deliveries/`sendMessage`)

**Interfaces:**
```ts
// planner.ts
export type NoticeContext = { config: NotificationConfig; queue: Pick<Queue.Client<NotificationMessage>, 'sendMessage'> };
export type PlannedNotice = { deliveryIds: string[]; due: string[] };            // due = available_at <= now
export async function planNotice(db: DbClient, charge: ChargeRow, eventKey: string, template: 'initial' | 'reminder' | 'manual', config: NotificationConfig, now: number): Promise<PlannedNotice>;
export async function enqueueDue(db: DbClient, queue: NoticeContext['queue'], ids: string[], now: number): Promise<void>; // sendMessage + queued_at
export function dueReminderOffsets(reminders: BillingReminder[], dueDate: string, today: string): number[];
// queue.ts
export declare class NotificationQueue extends Queue.Unordered<{ deliveryId: String.UUID }> { … services: { db; email; variables } ; variables: (as NotificationScheduler today) }
export async function deliverNotification(request: Queue.Incoming<{ deliveryId: string }>, context: Service.Context<NotificationQueue>): Promise<void>;
// cron.ts
export declare class NotificationCron extends Cron.Service { expression: 'cron(0/5 * * * ? *)'; maxRetries: 1; services: { db; notificationQueue; variables } }
export async function notificationCronHandler(_: Cron.Incoming, context): Promise<{ planned: number; enqueued: number }>;
// consumer.ts
export async function processDelivery(db, transport, config, input: { deliveryId; attempt; maxAttempts }, clock = Date.now): Promise<'done' | 'retry'>; // lança em transient
```
Cron — seleção dos lembretes (uma query): charges `pending` com `due_date BETWEEN today-90 AND today+90` joined a billings `active`; em JS, por billing: `today = calendarDate(now, tz)`, `civilHour(now, tz) >= REMINDER_HOUR`, offsets = `dueReminderOffsets(effectiveReminders(billing), due_date, today)` → `planNotice(tx, charge, `charge:${id}:reminder:${today}:${offset}`, 'reminder', …)`. Enfileirar devidas: `rawQuery` `SELECT id FROM notification_deliveries WHERE available_at <= :now AND (state IN ('pending','sending') OR (state = 'accepted' AND channel = 'push')) AND (queued_at IS NULL OR queued_at < :stale) ORDER BY available_at LIMIT 500` com `stale = now - 15 min`.

- [ ] **Step 1 (RED):** specs conforme spec §9 "notifications" — usar `QueueTester.setClientMock('NotificationQueue')` de `@ez4/local-queue/test` e chamar `deliverNotification({ message: { deliveryId }, attempt, maxAttempts: 5, requestId, traceId }, context)` com `context = { db, email, variables }`; incluir: inicial enfileira push + e-mail agendado; manual respeita cota; Pix publicado retoma `pix_required`; cron às 08:45 local não planeja, às 09:00 planeja e enfileira; follow-up entra na fila só após 2 h; `transient` lança e grava `available_at = now + 1 min`; `attempt = 5` grava `failed retry_exhausted` e lança; receipt `accepted` → `delivered`; fallback antecipa; mensagem perdida (`queued_at` há 20 min) é reenfileirada; `queued_at` recente não é.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (mover código de `worker.ts`/`outbox.ts` em vez de reescrever; `processDelivery` mantém as validações e o mapeamento de resultados atuais).
- [ ] **Step 4:** gates + `openapi:check` (sem mudança de rota esperada) + `ez4 serve --local` sobe e loga `Sending message to queue [NotificationQueue]` ao criar cobrança (smoke local).
- [ ] **Step 5: Commit** `feat(api)!: deliver notifications through NotificationQueue and drop the outbox`

---

### Task 3: Materialização por fila

**Files:**
- Create: `packages/api/src/billings/queue.ts` (`BillingQueue` + `materializeBillingOccurrence`), `packages/api/src/billings/cron.ts` (`BillingCron` + `billingCronHandler`)
- Delete: `packages/api/src/billings/scheduler.ts`
- Modify: `packages/api/src/billings/repository.ts` (`materializeBillings` → `dueIndefiniteBillings(db, now): string[]` + `materializeNextOccurrence(db, billingId, notice, now): { materialized: boolean; remaining: boolean; skipped?: string }`), `ez4.project.js`, `docs/superpowers/specs/2026-09-08-billings-and-queues-design.md` §6 (nota "implementado em 2026-09-09")
- Test: `packages/api/test/billings/billings.spec.ts` (casos de materialização), novo `test/billings/billing-queue.spec.ts`

**Interfaces:** `BillingQueue.services: { db; notificationQueue; variables }` (variables = as da `NotificationQueue`, para o `NoticeContext`); mensagem `{ billingId: String.UUID }`.

- [ ] **Step 1 (RED):** cron enfileira só billings devidas (mock `sendMessage`); consumidor materializa uma ocorrência, avisos entram na `NotificationQueue`, `processed_through` avança; com 2 ocorrências devidas reenvia `{ billingId }`; charge já existente só avança; contato arquivado → auditoria `billing.materialization_skipped`, sem lançar; billing pausada → nada.
- [ ] **Step 2–4:** implementar, gates.
- [ ] **Step 5: Commit** `feat(api): materialize indefinite billings through BillingQueue`

---

### Task 4: Limpeza de comprovantes por fila

**Files:**
- Create: `packages/api/src/proofs/queue.ts` (`StorageQueue` + `deleteStoredObject`), `packages/api/src/proofs/cron.ts` (`StorageCron` + `storageCronHandler`)
- Delete: `packages/api/src/proofs/cleanup-scheduler.ts`, `src/schemas/storage-deletion.ts`
- Modify: `packages/api/src/proofs/cleanup.ts` (fica `reconcileProofStorage(db, storage, send, clock)` sem cursor, paginação até 20 páginas, `protectedObject` exportado; remove `enqueueStorageDeletion`, `drainStorageDeletions`), `src/database.ts` (remove `storage_deletions`, `storage_cleanup_cursors`), `src/account/deletion.ts` (`eraseAccount` devolve também `storageMessages: StorageMessage[]`; `deleteHandler` envia após o commit via `context.storageQueue`), `src/provider.ts` (`storageQueue`), `src/account/endpoints.ts`, `ez4.project.js`, `docs/account-lifecycle.md`
- Test: `packages/api/test/proofs/cleanup.spec.ts` (reescrita), `test/account/account.spec.ts`

**Interfaces:** mensagem `{ objectKey: String.Max<200>; chargeId?: String.UUID; purpose: 'orphan' | 'temporary' | 'account' }`; `StorageQueue.services: { db; variables }` (variables de storage como o scheduler atual).

- [ ] **Step 1 (RED):** cron expira intents e envia `temporary`; órfão de 25 h vira mensagem, de 1 h não; objeto protegido não vira; paginação de 2 páginas; consumidor: protegido → retorna sem apagar; apaga; storage lança → handler lança; exclusão de conta devolve mensagens `account` e o endpoint as envia (mock).
- [ ] **Step 2–4:** implementar, gates.
- [ ] **Step 5: Commit** `feat(api): clean proof storage through StorageQueue`

---

### Task 5: Apple, docs, ambiente e fumaça

**Files:**
- Delete: `packages/api/src/auth/apple-credentials.ts`, `src/auth/apple-revocation-scheduler.ts`, `src/schemas/apple-credential.ts`, `test/account/apple-lifecycle.spec.ts`
- Modify: `packages/api/src/database.ts` (remove `apple_credentials`), `src/endpoints/auth/oauth-shared.ts` (sem `retain`/`bind`), `src/auth/apple-native.ts`, `src/auth/oauth-commit.ts` (sem claim/activate), `src/auth/oauth-provider.ts` (remove callbacks do client se existirem), `src/account/deletion.ts` (sem `detachAppleCredentials`; retorno `{ deleted }`), `src/account/endpoints.ts` (`DeleteResponse` sem `providerRevocation`), `src/provider.ts` e `ez4.project.js` (sem `APPLE_CREDENTIAL_ENCRYPTION_KEY_B64`), `src/endpoints/auth/oauth-providers.ts` (idem), `docs/deploy-guide.md` (remove a chave Apple; adiciona seção "Filas e DLQ": nomes `<stage>-receivy-notification-queue` etc., alarme de DLQ, Neon mantido acordado pelo `NotificationCron` de 5 min), `docs/environments.md`, `docs/account-lifecycle.md`, `docs/openapi.json` (regenerar), `test/account/account.spec.ts`, `test/auth-people/native-apple.spec.ts`, `test/fixtures/financial.ts`
- Modify (web/mobile): nenhum código; rodar testes.

- [ ] **Step 1 (RED):** `account.spec.ts` exclusão devolve `{ deleted: true }` e não toca Apple; `native-apple.spec.ts` login nativo sem credencial.
- [ ] **Step 2–4:** remover, gates, `openapi:generate`, `pnpm test` na raiz.
- [ ] **Step 5: Commit** `refactor(api)!: drop stored Apple credentials and revocation`
- [ ] **Step 6 (controller):** `ez4 serve --local` com filas; criar cobrança pelo app/web e ver `Sending message to queue [NotificationQueue]` + delivery `disabled`/`accepted`; aguardar um tick de cada cron.

## Self-review

- Spec §3 → T2/T3/T4 (declarações); §4 → T1/T2; §5 → T3; §6 → T4; §7 → T5; §8 → T2–T5; §9 → todas.
- `NoticeContext` (T2) consumido por T3; `storageQueue` (T4) por `deleteHandler`; `ACCOUNT_DELETED` (T1) só texto.
- Sem placeholders: queries, chaves de evento, estados e mensagens definidos.
