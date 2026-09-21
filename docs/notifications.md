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
  sends it later, when the key is published through the first public link. The initial
  notice uses the first enabled rule in the effective config.
- **Reminders** (`template = 'reminder'`): planned once a day by
  `ChargeNotificationCron` (05:30 UTC, `src/notifications/crons/arm-notify.ts`, after `BillingCron`
  created the day's charges). `planReminders` arms `charge:<id>:notify` for every
  enabled offset whose 06:00 (billing timezone) falls in the next 24 hours; the handler
  (`src/notifications/schedulers/charge-notify.ts`) sends and skips an offset already
  recorded in `events`. Channels are resolved per rule by `resolveChannels` based on
  the effective config.
- **Manual reminder** (`template = 'manual'`): `POST /charges/{id}/reminders`. The
  creditor pressed the button; it goes out using the owner's `manual` channels (bypasses
  the silence gate and keeps 1 per 24 hours). One per charge per 24 hours, counted
  over `notice.sent` events; a `notice.skipped` never blocks the next attempt. The
  response contains `{ channels, dropped }` listing outcomes per channel.

## Channels

Channels are resolved per reminder rule through `resolveChannels`, which returns
the channels available for that rule based on contact data and opt-out state.
`notifyCharge` sends to each resolved channel: push to every active `device_tokens`
row of the recipient, and e-mail when a non-opted-out address exists. A conta a
pagar never sends over WhatsApp. Channels that cannot be reached (no phone, no consent,
no e-mail, opted-out) are recorded as `dropped: [{ channel, reason }]` with reasons
`no_email`, `no_phone`, `no_consent`, `opted_out`, or `unavailable`. A `device_unregistered`
answer deactivates the device. There is no receipt polling: what the provider accepted
is what was sent.

The recipient is the debtor of a conta a receber, or the owner of a conta a pagar
(self copy, no public link, no opt-out link). The owner's own reminder follows the
configured channels the same way a debtor's does: e-mail goes out whenever the rule
that fired wants it, not push only. The rendered copy lives in `render.ts` and carries
the signed `/pay/<token>` link built from the charge's own `public_id`,
`link_version` and `link_expires_at` (`ensurePublicLink` mints them when missing).

## Opt-out

E-mails carry a `List-Unsubscribe` header pointing to `${PUBLIC_WEB_ORIGIN}/opt-out/<token>`
and include a "Parar de receber" footer link to the same. The token is an HMAC over
the user id and the e-mail it was sent to, with no expiry. `POST /public/notices/opt-out/{token}`
records the opt-out in `users.email_opt_out_at`; that is the only column these routes write.
`users.whatsapp_opt_out_at` is reserved for phase 3 — nothing writes it yet.
`DELETE /public/notices/opt-out/{token}` clears the e-mail opt-out timestamp. The web
UI plan adds the opt-out page (`/opt-out/<token>`) that calls these routes. `GET /charges/{id}/reminders/preview`
shows what channels would receive the next reminder without sending anything.

## Charges under review

A charge is under review while `proof_state = 'pending'`, whether the payer sent a file (`proof_kind = 'file'`)
or declared the payment without one (`proof_kind = 'declaration'`). Nothing chases it meanwhile:
`sendChargeNotice` records `notice.skipped { reason: 'in_review' }` for the initial notice, reminders and the
manual reminder; `planReminders` does not arm it; `POST /charges/{id}/reminders` answers 409
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

## Link de pagamento (InfinitePay, PagBank)

A conta a receber billed through InfinitePay or PagBank carries a checkout link instead of a Pix key.
Before any notice goes out, `sendChargeNotice` calls `ensurePaymentLink`, which mints the link on first
use (or retries a link that previously failed) and writes `charge.payment_link.created` or
`charge.payment_link.failed { reason: 'checkout_disabled' | 'unauthorized' | 'no_credential' | 'unavailable' }`
(`checkout_disabled` only happens on InfinitePay; `unauthorized` — PagBank refused the stored token — and
`no_credential` — the method has no readable credential — only happen on PagBank). While the link is not
`ready`, `notice.skipped { reason: 'link_pending' }` is recorded instead of sending — same as
`pix_required` for a conta a receber without a Pix key.

PagBank's webhook checks the request before touching anything: an unreadable credential records
`charge.provider.ignored { reason: 'no_credential' }`, a signature that does not match the stored token
records `charge.provider.rejected { reason: 'signature' }`, and a notification with no `PAID` charge
records `charge.provider.rejected { reason: 'not_paid', statuses }`. Only then does it call the same
finalizer as InfinitePay.

The payer's return and both webhooks share one finalizer (`settleByProvider`), which never trusts the
request body: it always confirms with the provider before moving the charge. It records
`charge.provider.rejected { reason: 'unauthorized' }` (the provider refused the credential outright) or a
plain `charge.provider.rejected` (the provider says not paid), `charge.provider.mismatch` (paid less than
the charge), `charge.provider.ignored` (the charge already left `pending` — a race with a manual
settlement), or `charge.paid { via: 'provider', provider, transactionNsu, receiptUrl? }` on success. These
fire direct pushes, outside the notice pipeline:

| When | To | Title |
| --- | --- | --- |
| the checkout link failed to mint (`checkout_disabled`) | the owner | Link de pagamento não criado |
| PagBank refused the stored token (`unauthorized`) | the owner | Token do PagBank inválido |
| the provider confirmed less than the charge's amount (`mismatch`) | the owner | Valor divergente na InfinitePay / no PagBank |
| the provider confirmed a payment on a charge that already left `pending` (`ignored`) | the owner | Pagamento recebido pela InfinitePay / pelo PagBank |
| the charge is marked paid by the provider | the creditor | Pagamento recebido pela InfinitePay / pelo PagBank |
| the charge is marked paid by the provider | the debtor | Pagamento confirmado |

Cancelling one charge (`POST /charges/{id}/cancel`) asks the provider (InfinitePay or PagBank) to
inactivate its checkout link and records `charge.payment_link.inactivated` on success, or
`charge.payment_link.inactivate_failed { linkId, reason }` when the provider answers anything but success
or "unsupported" (nothing is recorded for "unsupported"); the mass cancel paths in
`billings/services/billing.ts` (pausing/ending a billing, editing a month) only mark the charges cancelled
and leave any open provider link behind.

## Plano

`syncSubscription` (`plans/services/sync.ts`) is the only place a plan notice goes out: it re-reads
the subscription at Stripe, writes the transition, and after the transaction commits sends an
e-mail + push to the owner through `notifyPlan` (`plans/services/notices.ts`). Failures never reach
the caller — a failed notice is a `console.warn`, not a thrown error. Each notice also records one
event on the owner's account (`EventableType.Account`): `plan.subscribed`, `plan.payment_failed` or
`plan.canceled { subscriptionId, pausedIds }`. A downgrade additionally pauses every billing
`applyDowngrade` picked (newest excess indefinite first, then every linked-checkout billing), each
with its own `billing.paused { reason: 'plan' }` event.

| When | Title | Subject |
| --- | --- | --- |
| Free → Basic (`plan.subscribed`) | Plano Básico ativo | Seu plano Básico está ativo |
| a Stripe invoice fails while the subscription is `past_due` (`plan.payment_failed`) | Pagamento do plano falhou | Atualize o cartão do seu plano |
| Basic → Free (`plan.canceled`) | Seu plano Básico acabou | Seu plano Básico acabou |

The link in every plan notice points at `<PUBLIC_WEB_ORIGIN>/settings/plan`. Replaying the same
Stripe event (`row.last_event_id` unchanged) skips the whole block: no second downgrade, no second
notice.

## Sem avisos

The owner of a conta a receber can switch off the automatic notices of one participant or of one charge
("Não notificar"). The only value the notice gate reads is `charges.notify`, where null reads as true.
`allocations.notify` is the participant's default: `persistChargePlan` copies it to every charge created for them
(creation, the monthly sweep, charges an edit or an invite creates).

- `sendChargeNotice` records `notice.skipped { template, offsetDays?, reason: 'silenced' }` and sends nothing for a
  silenced charge, unless the channel is `'both'`: the manual reminder ("Lembrar") still goes out.
- `announceCharges` skips a silenced charge before the initial notice, and `planReminders` does not arm it.
  Neither records an event.
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
- `announceCharges` and `planReminders` skip those charges before scheduling anything. Neither records an event.
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
