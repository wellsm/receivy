# Notifications

There is no delivery ledger and no queue. A notice is sent the moment something
asks for it, through `notificationTransport` (Expo push, Resend e-mail), and the
outcome is one line in `events`: `notice.sent { template, channels, offsetDays? }`
or `notice.skipped { template, reason }`.

## Who sends what

- **Initial notice** (`template = 'initial'`): `announceCharges` right after the
  transaction that created the charges (billing creation, materialization, invite
  acceptance, guest added). A conta a pagar skips it: the owner just typed the bill.
  A conta a receber without a Pix key skips it too (`reason = pix_required`) and
  sends it later, when the key is published through the first public link.
- **Reminders** (`template = 'reminder'`): planned once a day by
  `ChargeNotificationCron` (05:30 UTC, `src/notifications/crons/arm-notify.ts`, after `BillingCron`
  created the day's charges). `planReminders` arms
  `charge:<id>:notify` for every enabled offset whose 06:00 (billing timezone)
  falls in the next 24 hours; the handler (`src/notifications/schedulers/charge-notify.ts`)
  sends and skips an offset already recorded in `events`.
- **Manual reminder** (`template = 'manual'`): `POST /charges/{id}/reminders`. The
  creditor pressed the button, so it goes out on every channel at once (push when
  there is a device, e-mail when there is an address) and arms no follow-up. One
  per charge per 24 hours, counted over `notice.sent` events; a `notice.skipped`
  never blocks the next attempt. The response `queued: false` means nobody could
  be reached.

## Channels and the follow-up rule

`notifyCharge` pushes to every active `device_tokens` row of the recipient and
falls back to e-mail right away only when there is no device. When a push went
out, the same `charge:<id>:notify` schedule is re-armed two hours later
(`stage = 'followup'`): `followUpCharge` then e-mails only if the charge is still
pending with no proof under review, and never twice for the same template and
offset. A `device_unregistered` answer deactivates the device. There is no
receipt polling: what the provider accepted is what was sent.

The recipient is the debtor of a conta a receber, or the owner of a conta a pagar
(self copy, no public link). The rendered copy lives in `render.ts` and carries
the signed `/pay/<token>` link built from the charge's own `public_id`,
`link_version` and `link_expires_at` (`ensurePublicLink` mints them when missing).

## Local

`serve --local` runs the cron and the dynamic schedules in-process (they are
`setTimeout`s, so they only fire while the process is up and never more than a
day ahead). `EMAIL_TRANSPORT=mailpit`
shows e-mails at <http://127.0.0.1:8025>; `NOTIFICATION_PUSH_TRANSPORT=disabled`
makes every push answer `disabled`, so the e-mail path is what you see locally.
