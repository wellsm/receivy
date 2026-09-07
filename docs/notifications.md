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
notice); otherwise an enabled email snapshot is used. Without either, a
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
credential/payload errors are definitive failures. Worker pages are bounded at
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
same conservative 23-hour window. Polling never resubmits push. DeviceNotRegistered
deactivates the token. Email fallback is possible only when **all** push delivery
rows for that logical event definitively failed; accepted, pending, successful,
disabled, suppressed, or uncertain siblings prevent it.

This deliberately favors avoiding automatic duplicate notices over guaranteed
notice delivery. A valid charge can have a missed notice. Provider receipt does
not prove that a person read it. A send already in flight cannot be recalled by
a concurrent payment, preference change, or capability revocation; the public
capability itself is still checked on access.

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

`enqueueStorageDeletion(tx, { key, chargeId, purpose }, now)` writes a unique
durable journal row inside a caller-owned transaction. Purpose is `orphan`,
`temporary`, or `account`. Task 6 must acquire the charge lock and remove only
eligible proof references/invalidate intents in its account-deletion transaction
before enqueueing. The deletion worker always blocks referenced/in-flight
objects, including purpose `account`; it does not make retention-policy decisions.

`drainStorageDeletions(db, storage, clock)` claims up to 100 rows with a 60-second
lease, rechecks references, commits, then deletes externally. Delete is idempotent;
unknown acknowledgement can safely retry. Failures back off 1/2/4/8 minutes and
become observable `blocked` after five attempts. Enqueueing an existing blocked
row re-arms it; a later reconciliation can therefore retry old orphan failures.
The journal has **no user/charge foreign key** and continues after the charge or
account is removed. Confirmed missing charge is allowed; failed DB reads abort
without external deletion. No test resets the normal Receivy database.

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
