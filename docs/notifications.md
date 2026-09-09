# Notifications pipeline

## Overview

`notification_deliveries` is the only state a notice ever has — there is no
outbox table and no separate worker process. One row is one attempt at
delivering one notice over one channel to one recipient key (a device or an
e-mail address).

Two EZ4 services move the pipeline:

- **`NotificationQueue`** (`src/notifications/queue.ts`) is the transport.
  `deliverNotification` receives `{ deliveryId }` messages and calls
  `processDelivery` (`src/notifications/consumer.ts`), which claims exactly
  one row and either sends it or polls its push receipt.
- **`NotificationCron`** (`src/notifications/cron.ts`) runs every 5 minutes.
  It plans automatic reminders whose civil date/hour arrived
  (`planDueReminders`) and enqueues every delivery that is due, including
  ones the queue never saw (`enqueueDueDeliveries`).

Producers write the delivery rows and commit them in the same transaction as
the business event (charge creation, a manual reminder request, Pix
publication); the queue message is only sent **after** that commit
(`planNotice` / `enqueueDue` in `src/notifications/planner.ts`). A failed
`sendMessage` leaves the row with `queued_at` unset, and the next cron pass
picks it up — nothing is lost, at worst delivery is delayed to the next pass.

## Event keys and idempotency

Each notice has a logical `event_id`, used to group its channels and to
detect a push-then-email fallback for the same notice:

- `charge:<id>:initial`
- `charge:<id>:reminder:<localDate>:<offsetDays>`
- `charge:<id>:manual:<uuid>`

Every delivery row also carries `idempotency_key = digest(`${event_id}/${channel}/${key}`)`
(`key` is the device id for push, the e-mail address for e-mail). A repeated
call to `planNotice` for the same key is inert: it finds the existing row and
either leaves it alone or, for a charge still waiting on a Pix key
(`reason = 'pix_required'`, `attempts = 0`), updates it in place. This is how
the reminder cron stays safe to run every 5 minutes and how Pix publication
can "resume" a delivery that was created before a payment method existed.

## When notices are produced

- **Initial notice** (`template = 'initial'`) — planned inside the same
  transaction that creates the charge row, for every path that creates a
  charge: `POST /billings`, invite acceptance, and recurrence materialization
  (`recordCreation` in `src/charges/materialize.ts`, called from
  `persistChargePlan`). The caller enqueues the due deliveries after commit.
- **Manual reminder** (`template = 'manual'`) — the creditor calls
  `manualReminder` (`src/notifications/repository.ts`), which is capped to
  one per charge per rolling 24 hours: it counts `template = 'manual'` rows
  for the charge created in the last 24h and rejects with 429 above that.
  Terminal charges reject manual reminders.
- **Automatic reminders** (`template = 'reminder'`) — `NotificationCron`
  scans `pending` charges of `active` billings whose `due_date` falls within
  a ±90-day window, and for each offset enabled in `billings.reminders` (or
  `DEFAULT_BILLING_REMINDERS`, currently `[{ offsetDays: 0, enabled: true }]`,
  from `packages/common/src/domain/billing.ts`) whose `due_date + offset`
  equals today **and** the local hour in the billing's timezone is at or
  after 09:00 (`REMINDER_HOUR`), it calls `planNotice(..., 'reminder')` with
  `event_id = charge:<id>:reminder:<today>:<offset>`. The idempotency key
  makes repeated 5-minute passes within the same local day a no-op. If the
  cron is down for the rest of that local day, that day's reminder is simply
  not sent — the next pass sees a new civil date and does not replay it.
  Recurring occurrences use the immutable occurrence's own `reminders` and
  timezone, not a later edit to the billing rule.
- **Pix publication** — publishing a Pix key on a charge whose initial notice
  was suppressed with `reason = 'pix_required'` and `attempts = 0` replans
  that row in place and resumes it (`src/public/repository.ts`).

## Channels

For each eligible notice (charge `pending`, valid Pix and public link):

1. Active devices exist for the recipient and push is enabled → one `push`
   delivery per device (up to 10, most recent first) with `available_at = now`,
   **plus** one `email` delivery with `available_at = now + 2h` and
   `reason = 'push_followup'`, if the recipient has an e-mail.
2. No devices → a single `email` delivery with `available_at = now`.
3. A push delivery reaches definitive `failed` and a pending, not-yet-sent
   follow-up e-mail exists for the same `event_id` → its `available_at` is
   pulled forward to `now` (`fallback` in `consumer.ts`); if no follow-up row
   exists yet (only possible for notices planned before this design), one is
   inserted instead. A pending/accepted/uncertain/delivered/disabled/suppressed
   push sibling blocks the fallback.
4. A recipient without a linked account still gets e-mail from the
   immutable `recipient_email_snapshot`, on the same schedule; never push.

Recipients always come from the charge's immutable snapshots, never a
contact's current e-mail. A device row only exists for a recipient with a
verified account matching that snapshot.

## Consumer contract

`processDelivery` runs entirely per delivery row, inside two transactions:

1. **Claim** — lock the charge and the row; a terminal state, a future
   `available_at`, or a held `lease_until` makes the call a no-op. Otherwise
   set `state = 'sending'` (or `'accepted'` when this is a receipt poll) with
   a 60-second `lease_until`, increment `attempts` (receipt polls don't
   consume an attempt), and record `first_attempt_at` once.
2. **External call** — push/email send, or an Expo receipt query.
3. **Settle** — reload under lock, verify the lease still matches, and write
   the outcome.

Outcome handling:

- **Transient** provider error (network, 5xx, 429) → the row's own backoff
  is written to `available_at` (`2^attempts` minutes, capped at 15 minutes)
  and the handler **throws**, so SQS redelivers the message. The row stays
  `sending`/`accepted` with `queued_at` still set, so the cron does not
  duplicate it while the message is in flight.
- **Uncertain** (e.g. a lost Expo submission response, an expired sending
  lease, or a receipt query that failed observation) → written as
  `uncertain` and the handler returns normally; there is no automatic resend
  or e-mail fallback for an uncertain push.
- **Accepted push** → becomes a receipt-poll candidate: `state = 'accepted'`,
  `available_at = now + 15 min`. The cron re-enqueues it when that time
  arrives, and every 15 minutes after, within the same dedup window.
- `attempts` reaching `MAX_SEND_ATTEMPTS` (5) marks the row `failed` with
  `reason = 'retry_exhausted'`.
- Resend's own dedup window is 24h; this pipeline stops retrying at **23
  hours** from `first_attempt_at` (`reason = 'provider_window_expired'` or
  `'receipt_window_expired'`), a one-hour safety margin.

`queued_at` records the last time a row was published to the queue; it is
cleared whenever the row settles into any state (including going back to
`pending` for a retry). `NotificationCron`'s `enqueueDueDeliveries` re-sends
any due row whose `queued_at` is null **or** older than 15 minutes
(`QUEUE_STALE_MS`) — this recovers a message SQS never delivered or that was
otherwise lost, without needing a DLQ round-trip. A missed reminder day is
never replayed; only the delivery *message*, not the reminder occurrence
itself, is recovered this way.

## Suppression reasons

Verbatim from the code (`planner.ts`, `consumer.ts`, `repository.ts`,
`account/deletion.ts`):

| Reason | Meaning |
| --- | --- |
| `pix_required` | Charge has no Pix key snapshot yet; resumed on publication |
| `charge_or_capability_inactive` | Charge is not `pending`, or the public link is missing/revoked/expired/mismatched |
| `no_enabled_channel` | No active device and no e-mail for the recipient |
| `device_changed` | The device's current token no longer matches the one this delivery was planned for |
| `render_configuration_changed` | The rendered body hash no longer matches (template/signing config changed) |
| `account_deleted` | Recipient or creditor account was deleted |

## Device rotation and token deactivation

Explicit device removal (`src/account/sessions.ts`) replaces the token with a
unique non-deliverable tombstone, keeps the inactive row, and suppresses its
pending deliveries. A rotated/removed token never lets an in-flight push
retarget itself: `device_token_hash` is persisted on the row before
submission and compared against the device's current token on every claim; a
mismatch suppresses the row (`device_changed`) rather than sending to the new
token. `DeviceNotRegistered` from Expo deactivates the device only when its
current token still matches the attempted token's persisted fingerprint —
never a rotated one.

## Account deletion effects

Deleting an account revokes session families (which deactivates its device
rows via `disableSessionDevices`), revokes public links on charges the user
touches, marks that user's still-`pending` deliveries `suppressed` with
`reason = 'account_deleted'`, and scrubs every delivery row for those charges
(`render_inputs`, `recipient_key`, `recipient_user_id`) regardless of state.
Keeping the public-link tombstone (`revoked_at`) prevents the queue from
minting a replacement capability for a retained charge with no link.

## Local emulation

`ez4 serve --local` (the `dev` script) runs the queue and cron handlers
in-process against the local database — there is no separate worker to
start. `NOTIFICATION_EMAIL_TRANSPORT=file` writes rendered e-mails to disk
instead of calling Resend, and is only accepted when `APP_STAGE=local`
(`src/email/client.ts` / `src/email/service.ts` reject it otherwise, forcing
`resend` or `disabled` in every deployed stage).

## Operations

Each queue (`NotificationQueue`, `BillingQueue`, `StorageQueue`) has its own
SQS dead-letter queue: after 5 attempts a message moves to
`<stage>-receivy-notification-queue-deadletter`. A non-empty DLQ is always
lost work — an undelivered notice, an occurrence that failed to
materialize, or a file that failed to delete. See `docs/deploy-guide.md`
("Filas e DLQ") for the CloudWatch alarm to set on
`ApproximateNumberOfMessagesVisible` per DLQ and for the resource naming
convention.
