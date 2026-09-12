# API Folder Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape `packages/api/src` into the AGENTS.md Ez4 layout (`api.ts, database.ts, storage.ts, common, <domains>, vendors`) with zero behaviour change.

**Architecture:** One task per domain. Each task moves files with `git mv`, splits `endpoints.ts` into one file per handler, adds `<domain>/routes.ts` and `<domain>/provider.ts`, rewires imports, and ends with `check-types + lint + unit tests` green. `ApiProvider` shrinks per task and is deleted in the last one.

**Tech Stack:** EZ4 0.52 (`@ez4/gateway`, `@ez4/database`, `@ez4/scheduler`, `@ez4/factory`), TypeScript, Biome, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-api-folder-standardization-design.md`

## Global Constraints

- No behaviour change, no logic refactor, no new dependency, no commit/push/migration.
- Move files with `git mv`; tests stay beside the file they test.
- Endpoint files: one handler per file, named after the action (`create.ts`, `list.ts`…), request/response classes and private helpers travel with the handler.
- Providers: `export declare class <Domain>Provider implements Http.Provider` listing only what `tsc` demands.
- Routes: `export type <Domain>Routes = [...]` in `<domain>/routes.ts`; `api.ts` spreads them.
- Gate per task, run from `packages/api`: `pnpm check-types && pnpm lint && pnpm test`.
- Final gate: `pnpm test:integration`, `pnpm openapi:check`, `pnpm dev` boots and survives one cron tick.
- Import fixes: run `pnpm check-types`, fix each reported path, then `pnpm exec biome check --write src test scripts`.

---

### Task 1: common (security, events, authorizer, openapi)

**Files:**
- Move: `src/security/listener.ts` → `src/common/services/listener.ts` (+ `listener.test.ts`, `gateway-runtime.test.ts`)
- Move: `src/security/logger.ts` → `src/common/services/logger.ts`
- Move: `src/security/throttle.ts` → `src/common/utils/throttle.ts`
- Move: `src/events/repository.ts` → `src/common/repositories/events.ts`
- Move: `src/schemas/event.ts` → `src/common/schemas/event.ts`
- Move: `src/authorizers/session.ts` → `src/common/authorizers/session.ts`
- Move: `src/openapi/export.ts` (+ test) → `src/common/utils/openapi.ts` (+ `openapi.test.ts`)
- Modify: `scripts/generate-openapi.mjs`, `src/api.ts`, every importer.

- [x] **Step 1: Move**

```bash
cd packages/api
mkdir -p src/common/{services,utils,repositories,schemas,authorizers}
git mv src/security/listener.ts src/common/services/listener.ts
git mv src/security/listener.test.ts src/common/services/listener.test.ts
git mv src/security/gateway-runtime.test.ts src/common/services/gateway-runtime.test.ts
git mv src/security/logger.ts src/common/services/logger.ts
git mv src/security/throttle.ts src/common/utils/throttle.ts
git mv src/events/repository.ts src/common/repositories/events.ts
git mv src/schemas/event.ts src/common/schemas/event.ts
git mv src/authorizers/session.ts src/common/authorizers/session.ts
git mv src/openapi/export.ts src/common/utils/openapi.ts
git mv src/openapi/export.test.ts src/common/utils/openapi.test.ts
```

- [x] **Step 2: Rewire imports** — `pnpm check-types`, fix paths (`security/listener` → `common/services/listener`, `events/repository` → `common/repositories/events`, `schemas/event` → `common/schemas/event`, `authorizers/session` → `common/authorizers/session`, `security/throttle` → `common/utils/throttle`). `scripts/generate-openapi.mjs` imports `../src/common/utils/openapi.ts`. Integration specs under `test/` too.

- [x] **Step 3: Gate** — `pnpm check-types && pnpm lint && pnpm test` green.

### Task 2: email → common/services/email + vendors, Expo client

**Files:**
- Move: `src/email/service.ts` (+ test), `client.ts`, `compose.ts` → `src/common/services/email/`
- Move: `src/email/vendors/file/service.ts` → `src/common/services/email/transports/file.ts`; `disabled/service.ts` → `transports/disabled.ts`
- Move: `src/email/vendors/resend/service.ts` → `src/vendors/resend/service.ts`
- Move: `src/email/vendors/mailpit/service.ts` → `src/vendors/mailpit/service.ts`; `src/email/mailbox.ts` (+ test) → `src/vendors/mailpit/mailbox.ts`
- Move: `src/email/login-code.ts` (+ test) → `src/users/services/login-code-email.ts` (domain folder created early; Task 4 fills it)
- Create: `src/vendors/expo/client.ts`, `src/vendors/expo/types.ts`, `src/vendors/expo/utils.ts`
- Modify: `src/notifications/transport.ts`

**Interfaces:**
- Produces: `createExpoPushClient(env: Record<string, string | undefined>, request: typeof fetch): { send(input: { token; title; body; url }): Promise<SendResult>; receipt(ticket: string): Promise<ReceiptResult> }`. `SendResult`/`ReceiptResult` keep living in `notifications/transport.ts` and are imported by the client as types.

- [x] **Step 1: Move**

```bash
mkdir -p src/common/services/email/transports src/vendors/{resend,mailpit,expo} src/users/services
git mv src/email/service.ts src/common/services/email/service.ts
git mv src/email/service.test.ts src/common/services/email/service.test.ts
git mv src/email/client.ts src/common/services/email/client.ts
git mv src/email/compose.ts src/common/services/email/compose.ts
git mv src/email/vendors/file/service.ts src/common/services/email/transports/file.ts
git mv src/email/vendors/disabled/service.ts src/common/services/email/transports/disabled.ts
git mv src/email/vendors/resend/service.ts src/vendors/resend/service.ts
git mv src/email/vendors/mailpit/service.ts src/vendors/mailpit/service.ts
git mv src/email/mailbox.ts src/vendors/mailpit/mailbox.ts
git mv src/email/mailbox.test.ts src/vendors/mailpit/mailbox.test.ts
git mv src/email/login-code.ts src/users/services/login-code-email.ts
git mv src/email/login-code.test.ts src/users/services/login-code-email.test.ts
```

- [x] **Step 2: Extract Expo client** — cut `expoHeaders`, `post`, `httpFailure`, `expoError` and the bodies of `push`/`receipt` from `transport.ts` into `vendors/expo/client.ts` (`createExpoPushClient`), response shapes into `types.ts`, `httpFailure`/`expoError` into `utils.ts`. `transport.ts` keeps the `NOTIFICATION_PUSH_TRANSPORT !== 'expo'` guard and delegates: `push: (input) => expo.send(input)`, `receipt: (ticket) => expo.receipt(ticket)`.

- [x] **Step 3: Rewire + gate** — `pnpm check-types`, fix paths, `pnpm lint && pnpm test` (transport.test.ts unchanged, still green).

### Task 3: health domain

- [x] **Step 1**

```bash
mkdir -p src/health/endpoints
git mv src/endpoints/health.ts src/health/endpoints/health.ts
git mv src/endpoints/health.test.ts src/health/endpoints/health.test.ts
git mv src/routes/health.ts src/health/routes.ts
```

Fix `health/routes.ts` import to `./endpoints/health`; `api.ts` imports `./health/routes`. Gate.

### Task 4: users domain (auth + account)

**Files:** every row of the spec's `users` table. Plus create `src/users/routes.ts` (merge of `routes/auth.ts` + `routes/account.ts` as `UserRoutes`) and `src/users/provider.ts`.

- [x] **Step 1: Move**

```bash
mkdir -p src/users/{endpoints,repositories,schemas,services,utils}
for f in email-code email-confirm apple-callback apple-native google-callback logout me oauth-exchange oauth-providers oauth-start refresh; do git mv src/endpoints/auth/$f.ts src/users/endpoints/$f.ts; done
git mv src/endpoints/auth/oauth-shared.ts src/users/utils/oauth.ts
git mv src/repositories/auth-repository.ts src/users/repositories/auth.ts
git mv src/account/repository.ts src/users/repositories/account.ts
git mv src/account/sessions.ts src/users/repositories/sessions.ts
git mv src/account/deletion.ts src/users/services/deletion.ts
git mv src/account/locking.ts src/users/services/locking.ts
git mv src/auth/atomic.ts src/users/utils/atomic.ts
for f in code email-login oauth oauth-commit oauth-flow oauth-provider oidc refresh-session session; do git mv src/auth/$f.ts src/users/services/$f.ts; [ -f src/auth/$f.test.ts ] && git mv src/auth/$f.test.ts src/users/services/$f.test.ts; done
for f in user auth-identity login-code oauth-attempt oauth-grant refresh-token session-family; do git mv src/schemas/$f.ts src/users/schemas/$f.ts; done
git mv src/routes/auth.ts src/users/routes.ts
```

- [x] **Step 2: Split `account/endpoints.ts`** into `users/endpoints/profile.ts` (`profileHandler`) and `users/endpoints/delete-account.ts` (`deleteHandler`); `git rm src/account/endpoints.ts`. Merge `routes/account.ts` entries into `users/routes.ts`, rename the type to `UserRoutes`, `git rm src/routes/account.ts`.

- [x] **Step 3: Provider** — `src/users/provider.ts`:

```ts
import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { EmailService } from '../common/services/email/service';
import type { Db } from '../database';

export declare class UserProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    AUTH_JWT_SECRET: Environment.Variable<'AUTH_JWT_SECRET'>;
    LOGIN_CODE_HASH_KEY: Environment.Variable<'LOGIN_CODE_HASH_KEY'>;
    OAUTH_PROVIDERS_CONFIG_B64: Environment.Variable<'OAUTH_PROVIDERS_CONFIG_B64'>;
    OAUTH_GOOGLE_ENABLED: Environment.VariableOrValue<'OAUTH_GOOGLE_ENABLED', 'false'>;
    OAUTH_APPLE_ENABLED: Environment.VariableOrValue<'OAUTH_APPLE_ENABLED', 'false'>;
    OAUTH_REDIRECT_ALLOW_LIST: Environment.Variable<'OAUTH_REDIRECT_ALLOW_LIST'>;
  };
}
```

Trim to what `tsc` demands. Handlers in `users/endpoints` and `users/services` switch `Service.Context<ApiProvider>` → `Service.Context<UserProvider>`. `common/authorizers/session.ts` gets its own `SessionAuthorizerProvider` (db + `AUTH_JWT_SECRET`) declared in the same file.

- [x] **Step 4: Rewire + gate.**

### Task 5: contacts, payment-methods, timeline (db-only domains)

For each domain D with handlers H:

- [x] `mkdir -p src/D/{endpoints,repositories,schemas}`; `git mv src/D/repository.ts src/D/repositories/<singular>.ts`; `git mv src/schemas/<singular>.ts src/D/schemas/<singular>.ts`; `git mv src/routes/D.ts src/D/routes.ts`.
- [x] Split `src/D/endpoints.ts` into `src/D/endpoints/<action>.ts` per handler (contacts: list, create, update, archive, get; payment-methods: list, create, edit, default, archive, plus `git mv validation.ts services/validation.ts` with test; timeline: timeline, contact-ledger). `git rm src/D/endpoints.ts`.
- [x] `src/D/provider.ts`:

```ts
import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';

export declare class ContactProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
  };
}
```

(`PaymentMethodProvider`, `TimelineProvider` identical.) Add `variables: Environment.ServiceVariables` only if a handler reads `context.variables`.
- [x] Rewire + gate.

### Task 6: billings, charges

- [x] billings: `git mv` `repository.ts → repositories/billing.ts`, `guests.ts/reminders.ts/request.ts(+test) → services/`, `cron.ts → crons/materialize.ts`, `schemas/billing.ts, billing-guest.ts → billings/schemas/`, `routes/billings.ts → billings/routes.ts`. Split endpoints: create, list, get, preview, patch, resolve-guest. `BillingProvider`: db, email, chargeNotifyScheduler + `PUBLIC_LINK_HMAC_SECRET`, `PUBLIC_WEB_ORIGIN` (trim by tsc).
- [x] charges: `repository.ts → repositories/charge.ts`, `materialize.ts → services/materialize.ts`, `schemas/charge.ts`, `routes/charges.ts`. Split endpoints: get, cancel, pay, reopen. `ChargeProvider`: db.
- [x] `ez4.project.js` `sourceFiles`: `./src/billings/crons/materialize.ts`.
- [x] Rewire + gate.

### Task 7: invites, public

- [x] invites: `repository.ts → repositories/invite.ts`, `links.ts → services/links.ts`, `schemas/invite.ts`, `routes/invites.ts`. Split endpoints: create, revoke, public, accept. `InviteProvider`: db + `PUBLIC_LINK_HMAC_SECRET`, `PUBLIC_WEB_ORIGIN`.
- [x] public: `repository.ts → repositories/public-link.ts`, `capability.ts(+test) → services/capability.ts`, `links.ts → services/links.ts`, `routes/public.ts`. Split endpoints: create-link, rotate-link, revoke-link, charge. `PublicProvider`: db + `PUBLIC_LINK_HMAC_SECRET`.
- [x] Rewire + gate.

### Task 8: proofs

- [x] `repository.ts → repositories/proof.ts`; `bucket-storage.ts(+test), storage.ts, throttle.ts, validation.ts(+test) → services/`; `bucket-event.ts → events/receive-object.ts`; `scheduler.ts → schedulers/upload-expiry.ts`; `schemas/proof-throttle.ts`; `routes/proofs.ts`. Split endpoints: start-upload, withdraw, review, download, public-start-upload, public-state, public-withdraw. `ProofProvider`: db, proofFiles, uploadExpiryScheduler + `PUBLIC_LINK_HMAC_SECRET`.
- [x] `ez4.project.js`: `./src/proofs/schedulers/upload-expiry.ts`.
- [x] Rewire + gate.

### Task 9: notifications

- [x] `repository.ts → repositories/notification.ts`; `context.ts, planner.ts, render.ts(+test), send.ts, direct.ts, transport.ts(+test) → services/`; `cron.ts → crons/arm-notify.ts`; `scheduler.ts → schedulers/charge-notify.ts`; `schemas/notification.ts`; `routes/notifications.ts`. Split endpoints: register-device, manual-reminder. `NotificationProvider`: db, email, chargeNotifyScheduler + `NOTIFICATION_PUSH_TRANSPORT`, `EXPO_ACCESS_TOKEN`.
- [x] `ez4.project.js`: `./src/notifications/crons/arm-notify.ts`, `./src/notifications/schedulers/charge-notify.ts`.
- [x] Rewire + gate.

### Task 10: cleanup, docs, final gate

- [x] `git rm src/provider.ts`; confirm `src/{account,auth,authorizers,email,endpoints,events,openapi,repositories,routes,schemas,security}` are empty and gone (`rmdir`).
- [x] `api.ts` route imports all point at `./<domain>/routes`; `database.ts` schema imports at `./<domain>/schemas/*` and `./common/schemas/event`.
- [x] `test/**/*.spec.ts` import paths (grep `from '../../src/`).
- [x] Docs: replace old `src/...` paths in `docs/testing.md`, `docs/notifications.md`, `docs/proof-storage.md`, `docs/environments.md`, `docs/oauth-setup.md`, `docs/deploy-guide.md`, `docs/mvp-acceptance.md` (grep `packages/api/src` and `src/`).
- [x] Append one line to `~/Projects/ai-rules/notes/receivy.md` describing the new layout.
- [x] Final gate: `pnpm check-types && pnpm lint && pnpm test && pnpm test:integration && pnpm openapi:check`; `pnpm dev` boots (Ctrl-C after cron/schedulers register); `git diff --stat docs/openapi.json` empty.
