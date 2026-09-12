# Cobrança como centro: eventos, schedulers e upload por evento do bucket

Decisões de 2026-09-11. Objetivo: menos tabelas e menos estado operacional em volta de `charges`,
seguindo o padrão do FreightHero (`sign-url` + evento do bucket; schedulers dinâmicos por entidade).

## O que sai

| Antes | Depois |
| --- | --- |
| `payment_proofs` (histórico de arquivos) | colunas `proof_*` na cobrança; histórico em `events` |
| `upload_intents` + `finalize` chamado pelo cliente | slot `proof_state = uploading` + evento do bucket em `proofs/*` |
| `payments` | `charges.state = paid` + `paid_at`; quem quitou vai para `events` |
| `public_links` | `charges.public_id/link_version/link_expires_at/link_revoked_at` |
| `activity_events` (uma linha por sujeito) | `events` (`eventable_type/id`, `type`, `actor_user_id`, `payload` JSON) |
| `notification_deliveries` + `NotificationQueue` + `NotificationCron` | envio direto pelo transporte + `charge:<id>:notify` armado pelo `ChargeNotificationCron` (05:30 UTC) |
| `BillingQueue` + `BillingCron` | `BillingCron` diário (05:00 UTC) + materialização inline na criação/patch |
| `StorageQueue` + `StorageCron` | `charge:<id>:upload-expiry` + exclusão direta ao substituir/retirar |
| `closure_reason` no comprovante | some: o estado da cobrança explica |

Ficam: `device_tokens`, `proof_throttles` (cotas anti-abuso), o bucket `ProofFiles`, `billing_invites`, `billing_guests`.

## Cobrança

```
proof_state      uploading | pending | accepted | rejected | null
proof_file       { key, name, mime, size, sha256? }   (JSON)
proof_sender_user_id (null = link público), proof_actor_hash, proof_expires_at (só uploading)
proof_sent_at, proof_reviewed_at, proof_reason
public_id (unique), link_version, link_expires_at, link_revoked_at
```

Um comprovante por vez. Substituir ou retirar apaga o objeto anterior. Reabrir zera `paid_at`
e volta um comprovante aceito para `pending`. Pagamento manual ou cancelamento não mexem no
comprovante pendente: ele continua `pending` e a tela lê o estado da cobrança.

## Upload

1. `POST /charges/{id}/proof` (devedor) ou `POST /public/charges/{token}/proof` (link): grava o
   slot (`uploading`, chave `proofs/<chargeId>/<uuid>`, mime e tamanho declarados, ator, 5 min),
   arma `charge:<id>:upload-expiry` e devolve `getWriteUrl`.
2. Cliente faz o PUT direto no bucket.
3. Evento do bucket (`Bucket.UseEvent` em `proofs/*`): acha a cobrança pela chave, confere que é
   o slot atual, lê o objeto, valida magic bytes, tamanho e sha256, passa a `pending`, grava
   `proof.uploaded`. Chave desconhecida ou bytes inválidos: apaga o objeto e limpa o slot.
4. Cliente consulta a cobrança (ou `GET /public/charges/{token}/proof`) até `pending`.

Limite continua 10 MB (o PUT não passa pela API).

## Agendamento (decisão final, mesmo dia)

- `BillingCron`, diário às 05:00 UTC (já passou da meia-noite em todo fuso do Brasil): materializa as
  ocorrências vencidas de toda assinatura ativa (`materializeDueBillings`); criação e patch de
  data/reativação também materializam inline, então o cron só cobre o "virou o dia".
- `ChargeNotificationCron`, diário às 05:30 UTC, depois das cobranças do dia existirem: para cada
  cobrança pendente e offset habilitado cujo instante (`vencimento + offset`, **06:00** no fuso da
  conta) cai nas próximas 24h, arma `charge:<id>:notify` (`planReminders`).
- `charge:<id>:notify` (dinâmico, um por cobrança, saltos de horas, nunca de dias):
  - `stage: first`: push para cada device ativo; sem device, e-mail na hora. Se foi push, rearma o
    mesmo identificador para +2h com `stage: followup`.
  - `stage: followup`: e-mail, só se a cobrança segue pendente e sem comprovante em revisão, e nunca
    duas vezes para o mesmo template/offset.
  - A mesma regra vale para o aviso inicial (criação). O lembrete manual é diferente: push (se há
    device) e e-mail ao mesmo tempo, sem follow-up.
- `charge:<id>:upload-expiry` (dinâmico, +5 min): libera slot de upload abandonado.
- Sem `billing:<id>:charge`: o emulador local do EZ4 é `setTimeout`, que estoura acima de ~24 dias, e
  a varredura diária é mais previsível para um app Brasil-only.

## Notificações

Envio direto pelo transporte. Sem receipt do Expo, sem fila. O "fallback" é o e-mail de +2h após
um push sem resposta (comprovante). Cota do lembrete manual: um `notice.sent` manual por cobrança
nas últimas 24h, via `events`.

## Endpoints

```
POST   /charges/{id}/proof            → { uploadUrl, expiresAt }
GET    /charges/{id}/proof/download   → { url }
DELETE /charges/{id}/proof
POST   /charges/{id}/proof/review     { decision, reason? } → ChargeDetail
POST   /charges/{id}/pay | /reopen | /cancel | /reminders
POST   /charges/{id}/public-link | /public-link/rotate ; DELETE /charges/{id}/public-link
GET    /public/charges/{token} ; POST|GET|DELETE /public/charges/{token}/proof
```

Somem: `/charges/{id}/proofs*`, `/charges/{id}/payments`, `/charges/{id}/deliveries`.

## Entregas

1. API + common: schema, `events`, schedulers, upload por evento, remoção das filas/crons/tabelas,
   testes de integração, OpenAPI. Banco resetado.
2. Web e mobile: `charge.proof` no lugar da lista, novos endpoints, docs.
