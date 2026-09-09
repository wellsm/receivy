# Notifications and proof cleanup

## Delivery policy

The worker consumes only `charge.created`, `charge.reminder`, and
`charge.manual_reminder`. It leaves proof, payment, and recurrence-materialization
outbox events untouched for a future explicitly defined consumer. These rows do
not block the allowlisted queue; the job logs their `unsupportedPending` count.
There are no automatic proof-review/payment-status notices in this MVP.

Recipients come from the charge's immutable recipient user/email snapshots,
never a contact's current email. A subsequently verified account matching the
snapshot can receive push. Active devices are selected first (up to 10 per
notice), only when the configured push transport is enabled; otherwise an enabled
email snapshot is used. Explicitly disabled push routes new notices to email
upfront rather than creating disabled push siblings. Existing disabled push rows
are not reinterpreted or replayed. With both transports disabled, new delivery
rows remain observably disabled and no provider call occurs. Without either, a
suppressed/manual-only delivery remains visible. Recipient email/push preferences
are rechecked before sending.

Expense creation snapshots the creditor's default reminder offsets and timezone
in the same transaction as the charge/outbox. Default offsets are `-3, 0, +2`;
an empty list disables reminders. Existing minimal pre-worker events remain
compatible and use current defaults when first consumed. Recurrences use the
immutable occurrence's `reminders_json` and timezone, not an edited rule. A UTC
scan compares each reminder's stored civil date in its stored IANA timezone.
Missed enabled reminder dates remain eligible on the next worker run.

The authenticated creditor can explicitly request a new manual reminder, limited
to one per charge per rolling 24 hours under the charge lock. This is a new
intentional event, not an automatic retry of an uncertain notice. Terminal
charges reject manual reminders and suppress unsent collection notices.

## Meaning of delivery states

| State | Meaning |
| --- | --- |
| pending | Scheduled/retry pending |
| sending | Durable 60-second lease acquired before external submission |
| accepted | Provider accepted the submission; not proof of human/device receipt |
| delivered | Expo receipt reports successful handoff to the platform push service |
| disabled | Explicit transport disabled; no real submission was made |
| failed | Definitive permanent failure or exhausted retry budget |
| uncertain | Acceptance/receipt cannot safely be established; no automatic new submission |
| suppressed | Charge/capability/preference/channel no longer permits submission |

An outbox row's legacy `delivered` state means the event was expanded/consumed,
not remote notification delivery. Only `notification_deliveries` represents
provider outcomes. Disabled deliveries are not silently replayed on enabling
transports; a new explicit reminder can be requested.

Transient sends back off at 1, 2, 4, 8 minutes, at most five submissions. Provider
submission credential/payload errors are definitive failures. Receipt-query errors
are observation failures, not evidence that the original push failed. Worker pages are bounded at
100 events per expansion (two expansions per run) and 100 delivery attempts.
The one-minute UTC job has a 300-second execution timeout. Claim/acknowledgement
transactions never contain provider calls. Expired email leases can retry with
the same key; expired push sending leases become uncertain.

### Approved uncertainty tradeoff

Resend deduplication lasts 24 hours. This implementation stops retries at **23
hours from the first attempt**, with a one-hour margin. Event/channel/recipient
idempotency keys, recipient, sender, origin, description, amount, due date and
capability metadata are stable. A stored render hash suppresses retries if
template/signing configuration would change the body. Complete capability tokens
and rendered email bodies are never persisted; the HMAC token is derived only in
memory. An existing revoked/expired public capability is never renewed by the
worker. Rotation/revocation suppresses pending/retry messages using old metadata.

Expo does not offer equivalent submission idempotency. A lost submission response
or expired sending lease becomes uncertain: no automatic resend or email
fallback. Known tickets are polled after 15 minutes, every 15 minutes, within the
same conservative 23-hour window. Polling never resubmits push. Receipt-query
HTTP 401/403 (and other non-retryable query errors or malformed receipt statuses)
become `uncertain` with reason `receipt_observation_failed`, never failed or
email-fallbacked. Transient query failures retain acceptance and retry observation.
Only an explicit negative receipt establishes failure of the accepted submission.
DeviceNotRegistered deactivates a registration only when its current token matches
the attempted token's persisted fingerprint. Email fallback is possible only when **all** push delivery
rows for that logical event definitively failed; accepted, pending, successful,
disabled, suppressed, or uncertain siblings prevent it.

This deliberately favors avoiding automatic duplicate notices over guaranteed
notice delivery. A valid charge can have a missed notice. Provider receipt does
not prove that a person read it. A send already in flight cannot be recalled by
a concurrent payment, preference change, or capability revocation; the public
capability itself is still checked on access.

### Device removal and rotation

Explicit removal replaces the raw token with a unique non-deliverable tombstone,
retains the inactive original-owned device row/ID/history, and suppresses its
pending deliveries. The released token can be registered by another account on
a separate row; active foreign tokens still conflict. Removal is idempotent and
cannot affect a subsequent owner's registration. Legacy inactive rows may require
repeat removal to release their token; both settings screens show inactive rows
and retain the existing Remove control. The cost is retained inactive rows.

Accepted/in-flight pushes cannot be recalled by removal; receipt observation and
uncertainty remain intact. The worker persists `device_token_hash` before external
submission and retains it through receipt polling. Old-token outcomes never
deactivate a rotated token, and rotation during a transient in-flight submission
suppresses its later retry rather than retargeting it. The field is optional for
existing rows: legacy accepted tickets without a fingerprint are still observed,
but cannot deactivate any current registration because their attempted token is
unknown. No guessed fingerprint is backfilled from the current device token.

Sources checked 2026-09-07: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Expo submission and receipts](https://docs.expo.dev/push-notifications/sending-notifications/),
[Expo registration setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Configuration and clients

Explicit defaults in `ez4.project.js` keep both notification transports disabled:

```text
NOTIFICATION_EMAIL_TRANSPORT=disabled
NOTIFICATION_PUSH_TRANSPORT=disabled
EXPO_ACCESS_TOKEN=disabled
PUBLIC_WEB_ORIGIN=http://localhost:3000
```

Production activation requires `NOTIFICATION_EMAIL_TRANSPORT=resend`, a valid
`RESEND_API_KEY` and `RESEND_FROM_EMAIL`, and/or
`NOTIFICATION_PUSH_TRANSPORT=expo` with the project's Expo access token when push
security is enabled. `PUBLIC_WEB_ORIGIN` must be the actual public app origin;
`PUBLIC_LINK_HMAC_SECRET` is the existing capability signing secret. Login email
configuration is unchanged and independent. No automated SMS/WhatsApp exists.

Both settings screens save email/push preferences and reminder defaults, and
remove registered devices. The mobile settings action asks permission, obtains
the real Expo token with configured EAS project ID, and registers it through the
authenticated API. There is no fake token fallback. Push taps open only the
configured public origin's `/pay/` capability path. Both charge screens expose
manual reminders and an explicit delivery-history refresh, with honest uncertain,
disabled and accepted wording. No UI is shared between platforms.

Physical iOS/Android builds, Expo project/APNs/FCM credentials, real Resend domain
and acceptance/receipt delivery are **external acceptance gates**, not tested
production capabilities. No provider account, project or credential was created.

Safe operator inspection should select only `id`, `charge_id`, `channel`, `state`,
`reason`, `attempts`, `available_at`, and timestamps. Never log `render_inputs`,
recipient keys/email, device tokens, provider bodies, capabilities or signed URLs.
Existing EZ4/framework SQL/access-log issues remain the separate hardening gate.

## Durable proof cleanup / Task 6 handoff

`reconcileProofStorage(db, storage, clock)` scans one bounded storage page and up
to 100 stale pending intents. S3 uses ListObjectsV2 MaxKeys=100 and a durable
continuation cursor. The explicit loopback development filesystem adapter uses
streamed directory enumeration with an offset cursor; deletion during a scan can
skip entries until the next complete scan. It is not a production storage mode.

Only objects at least **24 hours old** are reconciliation candidates. Final keys
follow `proofs/{chargeId}/{proofId}`. Under the same charge lock as finalization,
the worker checks persisted proof references and live pending upload intents.
It never substitutes a failed DB read for an empty result. Finalization already
rechecks intent expiry under that lock after storage I/O. Recent/in-flight and
committed proofs are retained. Unknown temporary objects with no remaining intent
are conservatively retained; known expired/finalized temporary objects can be
queued. No bucket-wide expiration is applied to retained proofs.

`reconcileProofStorage(db, storage, send, clock)` is the body of `StorageCron`
(`src/proofs/cron.ts`). It expires stale intents and scans the bucket page by page
(20 pages per run, no persisted cursor), sending one `StorageQueue` message
(`{ objectKey, chargeId?, purpose }`, purpose `orphan`, `temporary` or `account`)
per candidate. Every send happens **after** its transaction commits; a failed send
leaves the intent `expired` and the next orphan scan finds the object again.
Account erasure produces the `account` messages the same way.

`deleteStoredObject` (`src/proofs/queue.ts`) is the consumer. It rejects a key that
does not match `^(temporary|proofs)/<uuid>/<uuid>$`, locks the charge when the
message carries one (a missing charge row is allowed, since erasure removes it),
revalidates references and in-flight intents, then deletes. A referenced object is
skipped, not failed. A storage error is rethrown so SQS retries with backoff and,
after five attempts, moves the message to the dead letter queue. There is no
deletion journal: deleting an absent object succeeds, which makes redelivery safe.
No test resets the normal Receivy database.

Task 6 must also disable/delete devices and recipient delivery render inputs,
and suppress supported pending outbox/delivery events before removing public-link
rows; otherwise a retained pending charge without a link is eligible for safe
initial-link creation. Preserve a revoked link tombstone or otherwise prevent
background capability recreation for retained history. Do not erase another
account's retained finance/proofs simply to unblock cleanup.

EZ4 0.52 schema cautions: use an independent UUID primary key plus unique user ID
for preference-like relational tables (a relational primary key caused an unsafe
parent-ID rewrite in the native fixture). Public common response DTOs must be
explicit type literals: interfaces were rejected as non-Http.JsonBody, and mapped
types/intersections have separate known reflection limitations. Actual HTTP DTO
assertions are included in the existing disposable transport smoke.
