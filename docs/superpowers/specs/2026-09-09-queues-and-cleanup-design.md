# Filas EZ4 e remoção dos jobs em banco — design

Executa as fatias 2 e 3 de `2026-09-08-billings-and-queues-design.md` (§6 e §7)
com os ajustes exigidos pelo que entrou depois: política de avisos
(`2026-09-08-profile-and-delivery-policy-design.md` §5), convites
(`2026-09-08-billings-list-form-invites-design.md` §4) e a remoção das
preferências de notificação. Onde este documento e o §6/§7 originais
divergirem, vale este.

## 1. Objetivo

- Trocar `outbox_events`, `storage_deletions`, `storage_cleanup_cursors` e
  `apple_credentials` por três filas SQS (`NotificationQueue`, `BillingQueue`,
  `StorageQueue`) com retry por backoff e DLQ, e três crons magros que só
  consultam e enfileiram.
- Manter intactas as regras de entrega: aviso de nova cobrança imediato,
  lembrete às 09:00 no fuso da cobrança, push antes do e-mail com 2 h de
  espera, push falho antecipa o e-mail, receipts de push, janela de dedup.
- Exclusão de conta sem Apple: nenhum token Apple guardado, nenhuma revogação.

## 2. Escopo

Dentro: `packages/api` (código, specs, `ez4.project.js`, `docs/openapi.json`),
`packages/common` (mensagem `ACCOUNT_DELETED`), `packages/web` e
`packages/mobile` (só a mensagem de conta excluída e seus testes), `docs/*.md`.
Dependências novas aprovadas: `@ez4/queue` (runtime), `@ez4/local-queue` e
`@ez4/aws-queue` (dev), todas `0.52.0`.

Fora: mudar templates de e-mail/push, novos tipos de aviso (comprovante,
pagamento continuam só no feed), alarmes de DLQ (item do guia de deploy).

## 3. Filas

Todas `Queue.Unordered<Mensagem>` com:

```ts
deadLetter: Queue.UseDeadLetter<{ maxAttempts: 5; retention: 20160 }>; // 14 dias
backoff: Queue.UseBackoff<{ minDelay: 5; maxDelay: 300 }>;
subscriptions: [Queue.UseSubscription<{ handler: typeof …; concurrency: 2; timeout: 120 }>];
```

| Fila | Mensagem | Produtores | Consumidor |
|---|---|---|---|
| `NotificationQueue` | `{ deliveryId: uuid }` | `POST /billings` e aceite de convite (aviso inicial), `POST /charges/{id}/reminders` (manual), publicação do Pix (retoma `pix_required`), `BillingQueue` (aviso da ocorrência), `NotificationCron` (lembretes do dia, follow-ups, receipts e mensagens perdidas) | `deliverNotification`: envia 1 delivery ou consulta 1 receipt |
| `BillingQueue` | `{ billingId: uuid }` | `BillingCron` (e o próprio consumidor quando sobram ocorrências) | `materializeBillingOccurrence`: materializa **uma** ocorrência e enfileira os avisos |
| `StorageQueue` | `{ objectKey: string; chargeId: uuid \| null; purpose: 'orphan' \| 'temporary' \| 'account' }` | exclusão de conta, `StorageCron` (intents expirados e órfãos) | `deleteStoredObject`: apaga o objeto se ninguém mais o referencia |

Contrato do produtor: a linha (`notification_deliveries`, `charges`) é gravada
e commitada **antes** do `sendMessage`. `sendMessage` falhou → a linha fica
`pending` com `queued_at` nulo e o cron seguinte enfileira. Mensagem sem linha →
consumidor loga e retorna.

Contrato do consumidor (`Queue.Incoming<M>`):

1. Carregar a linha; estado terminal ou `available_at > now` → retornar.
2. `attempts = request.attempt`; marcar `sending`/lease como hoje.
3. Efeito externo. Resultado definitivo (`accepted`, `delivered`, `suppressed`,
   `failed` por regra) → gravar e limpar `queued_at`. `uncertain` → gravar
   `uncertain` e retornar (nunca reenviar e-mail que talvez chegou).
4. Erro transitório (rede, 5xx, 429) → lançar. SQS reentrega com backoff; a
   linha continua `sending` com `queued_at` preenchido, então o cron não a
   duplica.
5. `request.attempt === request.maxAttempts` → gravar `failed` com `reason`
   (`retry_exhausted`) e lançar; a mensagem vai para a DLQ.

Idempotência: SQS pode entregar duas vezes; o `lease_until` e o estado da
linha fazem a segunda entrega retornar sem efeito.

## 4. Avisos

### Tabela `notification_deliveries`

Ganha `queued_at?: datetime` (última vez que foi enfileirada; nulo quando o
efeito terminou ou a linha ainda não foi enfileirada) e `template` passa a
`'initial' | 'reminder' | 'manual'` (`manual` renderiza como `reminder`).
`event_id` vira uma chave lógica em texto (`charge:<id>:initial`,
`charge:<id>:reminder:<localDate>:<offset>`, `charge:<id>:manual:<deliveryBatch>`),
usada por `fallback` para agrupar push e e-mail do mesmo aviso. Os demais
campos e a `idempotency_key` (`digest(`${eventKey}/${channel}/${key}`)`) ficam.

### Produção

`planNotice(tx, charge, eventKey, template, config, now)` é o `planDelivery`
atual: resolve destinatário, dispositivos, link público, `render_inputs`,
supressões, e insere push (`available_at = now`) + e-mail (`now + 2h`,
`push_followup`) ou só e-mail. Devolve os ids criados e quais já estão devidos.
`enqueueDue(queue, tx-committed rows)` faz `sendMessage` para as devidas e
grava `queued_at`.

- **Nova cobrança**: `persistChargePlan` recebe `notice: NoticeContext`
  (`config` + fila) e, para cada charge criada, chama `planNotice(... 'initial')`
  dentro da transação; o chamador (`createBilling`, aceite de convite,
  `BillingQueue`) enfileira as devidas após o commit.
- **Pix publicado** (`public/repository.ts`): deliveries `suppressed` com
  `reason = 'pix_required'` e `attempts = 0` da charge são replanejadas
  (o update-in-place que já existe) e enfileiradas.
- **Lembrar manual**: `manualReminder` chama `planNotice(... 'manual')` com
  `eventKey = charge:<id>:manual:<uuid>`; a cota de 24 h passa a contar
  deliveries `template = 'manual'` da charge com `created_at > now - 24h`.
- **Lembretes automáticos**: `NotificationCron` (a cada 5 min) percorre
  charges `pending` de billings `active` cujo `due_date` está entre hoje−90 e
  hoje+90; para cada offset habilitado (`billings.reminders` ou
  `DEFAULT_BILLING_REMINDERS`) com `due_date + offset === hoje` no fuso da
  billing **e** hora local ≥ 09:00, chama `planNotice(... 'reminder',
  eventKey = charge:<id>:reminder:<hoje>:<offset>)` — a `idempotency_key`
  torna a repetição do cron inócua. Depois enfileira tudo o que está devido:
  `state IN ('pending','accepted'[push],'sending')`, `available_at <= now`,
  `queued_at IS NULL OR queued_at < now - 15 min` (mensagem perdida).
- Receipts de push (`accepted`, `available_at = +15 min`) e o e-mail de
  follow-up (+2 h) são apenas linhas com `available_at` futuro: o cron as
  enfileira quando vencem. `fallback` continua antecipando o follow-up.

### Consumo

`deliverNotification(request: Queue.Incoming<{ deliveryId }>, context)` é o
miolo de `runNotifications` para **uma** linha: claim, validações
(capacidade do link, dispositivo, hash do corpo, janela de dedup), envio ou
receipt via `notificationTransport`, aplicação do resultado (inclusive
backoff `2^n min` gravado em `available_at` para `transient`), `fallback` e
desativação de token. Diferenças: `attempts = request.attempt`; `transient`
grava o backoff e **lança** (SQS reentrega); `uncertain` não lança;
`retry_exhausted` acontece em `request.attempt === request.maxAttempts`.
`runNotifications`, `expandOutbox`, `scheduleReminders`, a contagem de
`unsupportedPending` e o `NotificationScheduler` deixam de existir.

### Exclusão de conta

Deliveries pendentes do usuário viram `suppressed` e `render_inputs`/chaves
são limpos como hoje; sem `outbox_events` não há a segunda varredura.

## 5. Materialização

`BillingCron` (a cada hora): billings `indefinite` + `active` com próxima
ocorrência (a partir de `processed_through`) cuja data de materialização
(`due_date - |min offset|`) ≤ hoje no fuso da billing → `sendMessage({ billingId })`.
Ele **não** materializa.

`materializeBillingOccurrence` (consumidor): transação com `lockOwner` +
lock da billing; recalcula a próxima ocorrência; se já existe charge para a
data, só avança `processed_through`; senão `planBillingCharges` +
`persistChargePlan` (com `NoticeContext`) + `audit('billing.materialized')`;
avança `processed_through`. Após o commit enfileira os avisos devidos e, se
ainda houver ocorrência devida, envia `{ billingId }` de novo (auto-encadeado,
uma ocorrência por mensagem). `HttpNotFoundError` (contato/Pix arquivado) →
grava `audit('billing.materialization_skipped', { reason })` e retorna sem
lançar (não é transitório). `materializeBillings` (loop com orçamento) e
`BillingScheduler` saem.

## 6. Comprovantes

`StorageCron` (a cada hora, pula quando `PROOF_STORAGE_MODE = 'disabled'`):

1. `upload_intents` `pending` com `expires_at < now - 24h` → `expired` e
   `sendMessage({ objectKey, chargeId, purpose: 'temporary' })`.
2. Varredura de órfãos: `storage.list` paginado até 20 páginas por execução
   (sem cursor persistido); objetos com mais de 24 h que casam
   `^(temporary|proofs)/<uuid>/<uuid>$` e não são protegidos
   (`payment_proofs` ou `upload_intents` pendente válido) → mensagem
   `orphan`/`temporary`.

`deleteStoredObject` (consumidor): revalida `protectedObject` (com lock da
charge quando houver `chargeId`) → protegido: retorna (não é erro); senão
`storage.delete(key)`; erro do storage → lança (backoff/DLQ). Sem tabela de
estado: a idempotência vem do próprio storage (apagar o que não existe é
sucesso).

Exclusão de conta: os `enqueueStorageDeletion` viram uma lista de mensagens
`purpose: 'account'` enviadas após o commit. `storage_deletions`,
`storage_cleanup_cursors`, `enqueueStorageDeletion`, `drainStorageDeletions`,
`ProofCleanupScheduler` saem; `reconcileProofStorage` vira o corpo do
`StorageCron`.

## 7. Apple

Saem: `apple_credentials` (tabela + schema), `auth/apple-credentials.ts`
(`journalAppleCredential`, `bindAppleCredential`, `claimAppleActivation`,
`activateAppleCredential`, `detachAppleCredentials`, `drainAppleRevocations`),
`AppleRevocationScheduler`, os callbacks `retain`/`bind` de
`endpoints/auth/oauth-shared.ts`, a variável `APPLE_CREDENTIAL_ENCRYPTION_KEY_B64`
(`provider.ts`, `ez4.project.js`, `docs/deploy-guide.md`, `docs/environments.md`)
e `test/account/apple-lifecycle.spec.ts`. O login Apple (web e nativo)
continua validando o `id_token` e criando `auth_identities`; nenhum refresh
token é guardado.

`eraseAccount` devolve `{ deleted: boolean }` (sem `providerRevocation`); o
endpoint `DELETE /account` idem. `ACCOUNT_DELETED` passa a:
"Conta excluída no Receivy. Arquivos e avisos pendentes são removidos em
segundo plano. Isso não altera registros compartilhados preservados."
Web e mobile só trocam a constante e os testes que a citam.

## 8. Wiring

- `ez4.project.js`: `sourceFiles` passam a `src/api.ts`, `src/notifications/queue.ts`,
  `src/notifications/cron.ts`, `src/billings/queue.ts`, `src/billings/cron.ts`,
  `src/proofs/queue.ts`, `src/proofs/cron.ts`. Providers locais: `@ez4/local-queue`
  ao lado dos atuais; AWS: `@ez4/aws-queue`.
- `ApiProvider.services` ganha `notificationQueue`, `storageQueue`
  (`Environment.Service<…>`); `BillingQueue.services` ganha `notificationQueue`.
  As filas declaram `variables` iguais às dos schedulers que substituem.
- Local: `ez4 serve --local` executa handlers em processo com o delay do
  backoff; teste de fumaça: criar cobrança → log `Sending message to queue
  [NotificationQueue]` → delivery `accepted`/`disabled` em segundos.

## 9. Testes

- `notifications.spec.ts` reescrita por comportamento: produção (inicial,
  manual com cota, retomada por Pix, lembrete às 09:00 via cron, follow-up 2 h,
  mensagens perdidas re-enfileiradas após 15 min, nada enfileirado antes da
  hora), consumo (claim, receipts, `uncertain`, `transient` lança e grava
  backoff, `maxAttempts` grava `failed` e lança, fallback antecipa follow-up,
  token rotacionado, janela de dedup). `QueueTester.setClientMock('NotificationQueue')`
  para asserir `sendMessage`; handlers chamados com `{ message, attempt,
  maxAttempts, requestId, traceId }` falsos.
- `billings.spec.ts`: cron enfileira só o devido; consumidor materializa uma
  ocorrência, encadeia, pula arquivados com auditoria.
- `cleanup.spec.ts`: cron expira intents e detecta órfãos com paginação;
  consumidor respeita `protectedObject`, apaga, lança em erro de storage.
- `account.spec.ts`: exclusão sem Apple, mensagens `account` enviadas após o
  commit, `{ deleted: true }`.
- Web/mobile: testes que citam `ACCOUNT_DELETED` continuam passando (constante).

## 10. Decisões

- Agendamento fica no banco (`available_at`), SQS só transporta: SQS atrasa no
  máximo 15 min e o follow-up é de 2 h.
- `queued_at` + janela de 15 min substitui a coluna de estado da fila: simples
  e tolerante a mensagem perdida.
- Erro transitório lança (retry/DLQ do SQS) e ainda grava o backoff na linha:
  se a mensagem se perder, o cron reenfileira no horário certo.
- Uma ocorrência por mensagem na materialização: mensagens pequenas, sem
  orçamento global.
- Órfãos sem cursor persistido: varredura por páginas com teto por execução.
- Apple: sem revogação porque nenhum token é retido; Rewarlo faz o mesmo.
