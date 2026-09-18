# API errors

The API answers every failure with the stock EZ4 envelope:

```json
{ "type": "error", "message": "A cobrança já foi encerrada.", "context": { "code": "CHARGE_CLOSED" } }
```

- `message` — copy for the user, in pt-BR, only on the statuses below. On other statuses it is
  gateway text (validation details, "Not found") and clients must not display it.
- `context.code` — stable machine code of a domain error (`packages/api/src/<domain>/errors.ts`).
  Absent on gateway-raised errors (400 validation, 401, 403, 404).
- `context.fields` — optional map `field -> message` when a domain error points at a field.

| Status | Source | Client shows |
|---|---|---|
| 400 | Schema validation (`@ez4/gateway`) or `HttpBadRequestError` | "Confira os dados informados." |
| 401 / 403 / 404 | `HttpUnauthorizedError`, `HttpForbiddenError`, `HttpNotFoundError` | the screen's own fallback |
| 403 | `ForbiddenError` subclasses | the screen's own fallback (`apiErrorMessage` shows `message` only on 409/422/429) |
| 409 | `ConflictError` subclasses | `message` (generic conflict copy if absent) |
| 422 | `UnprocessableEntityError` subclasses | `message` ("Confira os dados informados." if absent) |
| 429 | `TooManyRequestsError`, `ReminderQuotaError` | `message` (generic quota copy if absent) |
| 503 | `ServiceUnavailableError` subclasses | `message` |
| 5xx | unexpected | the screen's own fallback |

`apiErrorMessage(status, body, fallback)` in `@receivy/common` applies this table; `apiErrorCode(body)`
reads the code.

## How a domain error is declared

```ts
// packages/api/src/charges/errors.ts
export class ChargeClosedError extends ConflictError {
  constructor() {
    super('A cobrança já foi encerrada.', 'CHARGE_CLOSED');
  }
}
```

`packages/api/src/api.ts` lists every class under `httpErrors` by status; the gateway maps the
class to that status. The base classes (`ConflictError` 409, `UnprocessableEntityError` 422,
`RateLimitedError` 429) live in `packages/api/src/common/errors.ts` and carry the same status so
the request listener logs it.

## Billing scope errors

| Code | Status | When |
|---|---|---|
| `PENDING_CHARGES_WITHOUT_STATE` | 422 | `PATCH /billings/{id}` sends `pendingCharges` without `state` `paused`/`ended` |
| `EDIT_SCOPE_NOT_RECURRING` | 422 | `PATCH /billings/{id}` sends `applyTo` for a Única or Parcelado billing |

## Payment methods errors

| Code | Status | When |
|---|---|---|
| `PAYMENT_METHOD_TAKEN` | 409 | `POST /payment-methods` or `PATCH /payment-methods/{id}` with a `value` already registered for the owner (or the contact) |
| `INFINITEPAY_CHECKOUT_DISABLED` | 422 | the InfinitePay handle has no external checkout enabled; `context.fields.redirectUrl` opens the app screen that turns it on |
| `PAYMENT_LINK_UNAVAILABLE` | 503 | InfinitePay did not answer while probing the handle (`POST /payment-methods`) or confirming a payment (`POST /public/charges/{token}/provider-return`) |

## Quotas

No quota is keyed by client IP: the stock gateway does not expose one, and browsers reach the API
through the Next BFF anyway. Buckets are keyed by what the API verified:

| Route | Key | Limit / 10 min |
|---|---|---|
| `POST /auth/email/code` | normalized e-mail | 5 (plus a 60 s resend cooldown) |
| `POST /auth/email/confirm` | the code itself | 5 attempts per code |
| public charge / invite reads, `POST /public/charges/{token}/provider-return` | link `public_id`, after the token was verified; bucket `public-read` | 60 |
| `POST /invites/{token}/accept` | invite `public_id` | 120 |
| public proof upload / complete / withdraw | charge `public_id` | 12 |
| `POST /charges/{id}/reminders` | charge | 1 per 24 h |

A guessed token costs one indexed read and a 404; it never creates a throttle row.

## Payment review errors

| Code | Status | When |
|---|---|---|
| `CHARGE_IN_REVIEW` | 409 | declaring a payment, or `POST /charges/{id}/reminders`, while a file or a declaration waits for an answer |
| `PROOF_DECLARATION_FORBIDDEN` | 403 | declaring from the collecting side; declaring by the owner of a conta a pagar when the payee cannot confirm (no active payee — settle by hand instead); `pay` by the owner of a conta a pagar when the payee can confirm (the payee must confirm — declare instead) |

## Silence errors

| Code | Status | When |
|---|---|---|
| `SILENCE_UNAVAILABLE` | 409 | `PUT /billings/{id}/participants/{userId}/notify` or `PUT /charges/{id}/notify` on a conta a pagar |

## Registro errors

| Code | Status | When |
|---|---|---|
| `SETTLED_LOCKED` | 409 | `PATCH /billings/{id}` sends `settled` different from the stored value, `counterpartLabel` on a conta that is not a registro, `split`, `paymentMethodId`, `pix`, `payeeUserId`, `reminders`, `clearPaymentMethod`, `clearPix` or `clearPayee` on a registro; or `POST /billings/{id}/invite` / `POST /invites/{token}/accept` on a registro (criar ou aceitar convite numa conta registro) |
| `SETTLED_NO_REMINDERS` | 409 | `POST /charges/{id}/reminders` on a charge of a registro |
