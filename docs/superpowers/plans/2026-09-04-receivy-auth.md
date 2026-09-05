# Receivy Passwordless Authentication Implementation Plan

**Goal:** Add the approved passwordless account/session slice to the EZ4 API,
Next BFF and Expo client without exposing tokens to browser JavaScript.

**Architecture:** Keep authentication in the EZ4 modular monolith so web and
mobile share one identity/session model. The API owns email-code verification,
OAuth identity validation and rotating bearer sessions. Next stores API tokens in
`__Host-` HttpOnly cookies and exposes only BFF routes. Expo stores the refresh
token in SecureStore and access tokens in memory. Better Auth is not used because
its built-in session model does not match the approved refresh-family replay
contract and would put a second HTTP/auth runtime beside EZ4.

**Security constraints:** Six CSPRNG digits, HMAC-SHA-256 at rest, 10-minute TTL,
five attempts, 60-second cooldown, constant-time verification, generic request and
confirmation errors, 15-minute access JWT, 30-day opaque rotating refresh token,
no secrets/tokens/codes in logs, localStorage or AsyncStorage.

---

## Task 1: Shared auth contracts and pure security rules

- Extend `@receivy/common` with request/response/user/session contracts.
- Write failing tests for email normalization and public auth result shapes.
- Add API pure-function tests for code generation, HMAC verification, expiry,
  attempt exhaustion and token hashing.
- Stop when pure rules pass without database or provider mocks.

## Task 2: EZ4 identity database and email-code endpoints

- Declare `users`, `auth_identities`, `login_codes`, `session_families` and
  `refresh_tokens` in one EZ4 Postgres service.
- Add repositories with transaction-scoped ownership and atomic code consumption.
- Add `POST /auth/email/code`, `POST /auth/email/confirm`, `POST /auth/refresh`,
  `POST /auth/logout` and authorized `GET /auth/me`.
- Add a Resend transport boundary; local tests inject a fake transport and never
  print code bodies.
- Verify migrations against the local Postgres container and exercise request,
  confirm, refresh rotation and replay revocation.

## Task 3: Next BFF and passwordless web UI

- Add `/login` with the adapted Stitch emerald direction and no unsupported
  security/product claims.
- Add BFF handlers for request/confirm/refresh/logout/me.
- Set/clear secure HttpOnly `__Host-receivy_access` and
  `__Host-receivy_refresh` cookies; do not return refresh tokens to the browser.
- Add middleware/server guards and tests for generic errors, cookie flags and open
  redirects.

## Task 4: Expo passwordless client

- Add login and six-digit confirmation routes using the same copy and tokens.
- Add an API client that keeps access tokens in memory, refresh tokens in
  `expo-secure-store`, and collapses concurrent refresh calls.
- Test storage boundaries, retry behavior and the no-password UI.

## Task 5: Google and Apple authorization-code flows

Implementation checkpoint: API/BFF/Expo wired; real provider activation remains
credential-bound. Google uses provider PKCE; both flows bind the Receivy grant
to the initiating client's S256 challenge. Apple uses confidential code exchange
with state/nonce (its provider API does not document PKCE). See `docs/oauth-setup.md`.

- Add PKCE/state/nonce start and callback/exchange endpoints with issuer,
  signature, audience, expiry and verified-email checks.
- Add Next callback routes and Expo development-build clients.
- Keep providers disabled when credentials are absent; never add placeholder
  secrets. Document exact redirect URIs and Apple Private Relay setup.

## Task 6: Auth verification checkpoint

Local Postgres smoke validated wrong verifier 401, valid grant exchange 200,
replayed grant 401, and removed only its isolated fixtures. Google/Apple
consent and native development-build checks remain pending real configuration.

- Run `pnpm verify` and focused API/BFF/mobile auth tests.
- Exercise email-code login locally with a fake transport fixture.
- Record provider flows that require user-owned Google/Apple/Resend credentials.
- Commit the increment without starting people or financial-domain work.
