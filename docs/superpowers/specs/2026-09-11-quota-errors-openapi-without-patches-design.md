# Quotas, error envelope and OpenAPI without gateway patches

Date: 2026-09-11
Context: the pnpm patches on `@ez4/aws-gateway` / `@ez4/local-gateway` / `@ez4/pgclient` were
removed. Stock EZ4 exposes no client IP, serializes errors as
`{ type: 'error', message, context }`, and maps custom error classes to status codes through
`Http.UseDefaults<{ httpErrors }>`.

## A. Quotas keyed by what the API can trust

Every `*-ip` bucket goes away, together with `trustedClientIp`. The remaining keys are things
the API verified itself.

| Route | Before | After |
|---|---|---|
| `POST /auth/email/code` | `otp-request-ip` 30 + `otp-request-email` 5 | `otp-request-email` 5 per 10 min. The 60 s cooldown in `replaceLoginCode` already refuses a resend to the same address. |
| `POST /auth/email/confirm` | `otp-confirm-ip` 60 | none. `login_codes.attempts >= 5` already exhausts the code. |
| `POST /auth/apple/native/start` / `exchange` | per IP 30 | none. `start` only stores a single-use attempt with its own expiry; `exchange` consumes it. |
| `GET /public/charges/{token}`, `GET /public/invites/{token}` | `public-read-ip` 240 + per token 60 | resolve the token first (DB read + HMAC, 404 on failure), then `public-read:<public_id>` 60. |
| `POST /invites/{token}/accept` | `public-read-ip` + `invite-accept:<token>` 120 | resolve first, then `invite-accept:<public_id>` 120. |
| `POST/DELETE /public/charges/{token}/proof` | `proof-ip` 120 + `capability:<token>` 12 | resolve first, then `capability:<public_id>` 12. |
| `GET /public/charges/{token}/proof` | `public-read-ip` + per token | resolve first, then `public-read:<public_id>`. |

Verify-first closes the real hole: today an invalid token inserted a `proof_throttles` row per
guess. After: a guess costs one indexed read and returns 404, no write.

Changes:
- `common/utils/throttle.ts`: drop `trustedClientIp` and `isIP`; `allowEmailCode(db, email, secret)`;
  `throttlePublicRead(db, key, bucket = PUBLIC_READ)` consumes one bucket keyed by `key`.
- `proofs/services/throttle.ts`: `throttleProof(db, key, now)` consumes only `capability:<key>`.
- `public/repositories/public-link.ts`: `getPublicCharge` split into `resolvePublicCharge` (exists)
  + `publicChargeView(db, charge)`; the wrapper stays for tests.
- `invites/services/links.ts`: `resolveInvite` exported; `getPublicInvite` split into
  `resolveInvite` + `publicInviteView(db, invite, now)`; wrapper stays.
- `proofs/repositories/proof.ts`: `publicProofState` split into `resolvePublicCharge` +
  `proofStateView(charge, token, secret)`; wrapper stays.
- Endpoints `public/charge`, `invites/public`, `invites/accept`, `proofs/public-*`: resolve, throttle by
  `public_id`, then act. `acceptInvite` keeps resolving internally (one extra indexed read).
- Users endpoints: `email-code` calls `allowEmailCode(db, email, key)`; `email-confirm` and
  `apple-native` lose their quota lines.

Tests: `test/auth-people/throttle.spec.ts` rewritten (invalid tokens leave `proof_throttles`
untouched; a valid capability hits 429 on the 13th call); `otp-policy.spec.ts`, `proofs.spec.ts`
(lines ~500-545), `invites.spec.ts` (~571-601) lose the IP cases; `listener.test.ts` loses the
`trustedClientIp` asserts.

## B. Error envelope through `httpErrors`

- `common/errors.ts`:

```ts
export type ApiErrorContext = { code: string; fields?: Record<string, string> };

export abstract class ApiError extends ServiceError<ApiErrorContext> {
  constructor(message: string, code: string, fields?: Record<string, string>) {
    super(message, fields ? { code, fields } : { code });
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') {
    super(message, 'RATE_LIMITED');
  }
}
```

- `<domain>/errors.ts` holds the domain classes; one class per distinct meaning, message in
  pt-BR, `code` in UPPER_SNAKE. Sites of `HttpConflictError` (37), `HttpUnprocessableEntityError`
  (7) and `HttpError(429)` (2) throw those classes instead. The four English messages in
  `public/repositories/public-link.ts` and `common/utils/throttle.ts` become pt-BR.
- `api.ts`:

```ts
defaults: Http.UseDefaults<{
  listener: typeof requestListener;
  preferences: { namingStyle: NamingStyle.CamelCase };
  httpErrors: {
    409: [ChargeClosedError, ...];
    422: [ProofTooLargeError, ...];
    429: [TooManyRequestsError, ReminderQuotaError];
  };
}>;
```

- Wire format, fixed by the base class: `{ "type": "error", "message": "<pt-BR>", "context": { "code": "<CODE>", "fields"?: {...} } }`.
- 400/401/403/404 keep the stock `Http*Error` classes; clients show generic copy by status.
- Client (`packages/common/src/domain/api-error.ts`): `apiErrorMessage(status, body, fallback)`.
  409 and 422 with a string `body.message` show it; every other status maps to the existing copy
  (`INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`,
  `INTERNAL_ERROR`). `apiErrorCode(body)` returns `context.code` for callers that branch on it.
  Web `responseMessage`, mobile `financial/client.ts`, `contacts/client.ts`,
  `notifications/client.ts` pass `response.status`. Tests updated.
- `docs/api-errors.md` documents the envelope, the codes and which statuses carry copy.

## C. OpenAPI from `@ez4/docs-gateway`

- `@ez4/docs-gateway@0.52.0` as devDependency of `@receivy/api`; `yaml@^2.9.0` as devDependency
  of `@receivy/web` (both already in the pnpm store).
- `openapi:generate`: `node --env-file=local.env ./node_modules/@ez4/project/bin/cli.mjs generate -e local.env -- gateway:oas ../../docs`
  writes `docs/receivy-api-oas.yml`.
- `openapi:check`: `scripts/check-openapi.mjs` generates into a temp folder and compares with
  `docs/receivy-api-oas.yml`; exits 1 with "OpenAPI is stale" on a diff.
- Deleted: `src/common/utils/openapi.ts` (+ test), `scripts/generate-openapi.mjs`, `docs/openapi.json`.
- `packages/web/src/lib/openapi-contract.test.ts` parses the YAML with `yaml`; assertions unchanged.
- The stock generator does not describe error bodies; `docs/api-errors.md` is the reference.

## D. Patch tests

`src/common/services/gateway-runtime.test.ts` and `test/auth-people/sql-redaction.spec.ts` are
deleted. `docs/mvp-acceptance.md` and `docs/testing.md` stop citing IP quotas, `correlationId`,
`openapi.json` and the patches.

## Gate

`pnpm check-types`, `check-types:test`, `lint` (no new findings), `test`, `test:integration`,
`openapi:check`; web `vitest` for `financial-response` and `openapi-contract`; mobile jest for
`financial/client`, `contacts`, `notifications`. `pnpm dev` boots.

## Plan

1. Quotas (section A) + tests. Gate: types, unit, integration.
2. Errors (section B): base class, domain classes, throw sites, `api.ts`, clients, docs. Gate:
   api + web + mobile tests.
3. OpenAPI (section C): deps, scripts, generator run, web test. Gate: `openapi:check`, web test.
4. Delete patch tests, docs cleanup, full gate.
