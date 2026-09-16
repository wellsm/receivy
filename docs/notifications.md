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

## Charges under review

A charge is under review while `proof_state = 'pending'`, whether the payer sent a file (`proof_kind = 'file'`)
or declared the payment without one (`proof_kind = 'declaration'`). Nothing chases it meanwhile:
`sendChargeNotice` records `notice.skipped { reason: 'in_review' }` for the initial notice, reminders, the
follow-up and the manual reminder; `planReminders` does not arm it; `POST /charges/{id}/reminders` answers 409
`CHARGE_IN_REVIEW`. Reminders whose day passed during the review are not sent later.

Payment notices are push only (`notifications/services/payment-notices.ts`), fired by the endpoints after the
action commits and never retried:

| When | To | Title |
| --- | --- | --- |
| `POST /charges/{id}/proof/declaration` (or the public one) | whoever answers: the owner of a conta a receber, the payee of a conta a pagar | Pagamento informado |
| `POST /charges/{id}/proof/complete` (or the public one) | the same | Comprovante recebido |
| review accepted, or `pay` answering what was under review | whoever paid | Pagamento confirmado |
| review rejected | whoever paid | Pagamento não identificado |

Each push opens `<PUBLIC_WEB_ORIGIN>/charges/<id>` and is recorded once per submission as
`notice.payment { key, notice }`.

## Sem avisos

The owner of a conta a receber can switch off the automatic notices of one participant or of one charge
("Não notificar"). The only value the notice gate reads is `charges.notify`, where null reads as true.
`allocations.notify` is the participant's default: `persistChargePlan` copies it to every charge created for them
(creation, the monthly sweep, charges an edit or an invite creates).

- `sendChargeNotice` records `notice.skipped { template, offsetDays?, reason: 'silenced' }` and sends nothing for a
  silenced charge, unless the channel is `'both'`: the manual reminder ("Lembrar") still goes out.
- `announceCharges` skips a silenced charge before the initial notice, `planReminders` does not arm it and
  `followUpCharge` sends no e-mail when the charge was silenced after its push. None of the three records an event.
- A `charge:<id>:notify` schedule armed before the charge was silenced still fires, goes through `sendChargeNotice`
  and hits the gate. Nothing is cancelled. Switching the notices back on resends nothing: the next planned reminder
  goes out, one whose day already passed is lost.
- Not silenced: the payment notices (`notice.payment`: Pagamento informado, Comprovante recebido, Pagamento
  confirmado, Pagamento não identificado), the manual reminder, and the owner's own reminders on a conta a pagar.

`PUT /billings/{id}/participants/{userId}/notify` writes the allocation and the participant's pending charges
(`billing.participant_silenced` / `billing.participant_unsilenced { userId }`); a `PATCH /billings/{id}` whose split
changes the value of someone who stays does the same. `PUT /charges/{id}/notify` writes one charge
(`charge.silenced` / `charge.unsilenced`). The event names keep the old wording: they are history already written.
Sending the value already stored writes and records nothing. A conta a pagar answers 409 `SILENCE_UNAVAILABLE`. Only
the creditor reads `notify: false`; whoever owes always reads `true`.

## Registros

A registro is a conta the owner already received or paid (`billings.settled`), with the counterpart typed as free text
(`billings.counterpart_label`). Nobody is on the other side, so nobody is ever notified, the owner included.

- `sendChargeNotice` records `notice.skipped { template, offsetDays?, reason: 'settled' }` and sends nothing for a charge
  of a registro, on every channel, right after the `silenced` gate.
- `announceCharges` and `planReminders` skip those charges before scheduling anything, and `followUpCharge` sends no
  e-mail. None of the three records an event.
- `POST /charges/{id}/reminders` answers 409 `SETTLED_NO_REMINDERS` ("Registros não têm avisos.").
- Settling is not a notice: each charge of a registro is paid on its due date (`charge.paid { via: 'registered' }`,
  `paid_at` at the start of that day in the billing timezone). `persistChargePlan` pays what is already due in the
  transaction that creates it (creation, the monthly sweep, edits); `BillingCron` calls
  `BillingRepository.settleRegistered` right after `materializeDueBillings` for what came due since. A charge with a
  `charge.reopened` event stays pending until "Marcar como pago".

## Local

`serve --local` runs the cron and the dynamic schedules in-process (they are
`setTimeout`s, so they only fire while the process is up and never more than a
day ahead). `EMAIL_TRANSPORT=mailpit`
shows e-mails at <http://127.0.0.1:8025>; `NOTIFICATION_PUSH_TRANSPORT=disabled`
makes every push answer `disabled`, so the e-mail path is what you see locally.
