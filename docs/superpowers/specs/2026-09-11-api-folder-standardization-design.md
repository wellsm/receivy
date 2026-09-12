# API folder standardization

Date: 2026-09-11
Scope: `packages/api/src` only. Mobile and web already follow AGENTS.md.

## Goal

Make `packages/api/src` match the Ez4 layout in `AGENTS.md`:

```
src/{api.ts,database.ts,storage.ts,common,<domains>,vendors}
```

Pure restructure. No behaviour change, no logic refactor, no dependency added. Only one
non-move edit: the Expo push HTTP call moves out of the notifications transport into a
vendor client (section 5).

## Target tree

```
src
  api.ts            Http.Service: defaults, cache, routes (spread of <domain>/routes), cors
  database.ts       Database.Service: imports schemas from each domain + common
  storage.ts        Bucket.Service (unchanged)
  common
    authorizers/session.ts
    services/listener.ts        (from security/listener.ts)
    services/logger.ts          (from security/logger.ts)
    services/email/service.ts   (from email/service.ts, the Factory.Service aggregate)
    services/email/client.ts    (from email/client.ts)
    services/email/compose.ts   (from email/compose.ts)
    services/email/transports/file.ts      (from email/vendors/file/service.ts)
    services/email/transports/disabled.ts  (from email/vendors/disabled/service.ts)
    repositories/events.ts      (from events/repository.ts)
    schemas/event.ts            (from schemas/event.ts)
    utils/throttle.ts           (from security/throttle.ts)
    utils/openapi.ts            (from openapi/export.ts)
  vendors
    resend/service.ts           (from email/vendors/resend/service.ts)
    mailpit/service.ts          (from email/vendors/mailpit/service.ts)
    mailpit/mailbox.ts          (from email/mailbox.ts, test helper over the Mailpit REST API)
    expo/client.ts              (extracted from notifications/transport.ts)
  health
  users
  contacts
  payment-methods
  billings
  charges
  invites
  public
  proofs
  notifications
  timeline
```

Each domain:

```
<domain>
  endpoints/<one file per handler>.ts
  repositories/<name>.ts
  schemas/<table>.ts
  services/<name>.ts
  utils/<name>.ts        only when the domain has one
  crons/<name>.ts        Cron.Service with a fixed expression
  schedulers/<name>.ts   Cron.Service with expression 'dynamic'
  events/<name>.ts       Bucket.UseEvent handlers
  routes.ts              export type <Domain>Routes = [Http.UseRoute<...>, ...]
  provider.ts            export declare class <Domain>Provider implements Http.Provider
```

Tests stay next to the file they test (`foo.test.ts` beside `foo.ts`).

## Domain map

### users (auth + account, as in the AGENTS.md example)

| From | To |
|---|---|
| `endpoints/auth/email-code.ts` | `users/endpoints/email-code.ts` |
| `endpoints/auth/email-confirm.ts` | `users/endpoints/email-confirm.ts` |
| `endpoints/auth/apple-callback.ts` | `users/endpoints/apple-callback.ts` |
| `endpoints/auth/apple-native.ts` | `users/endpoints/apple-native.ts` |
| `endpoints/auth/google-callback.ts` | `users/endpoints/google-callback.ts` |
| `endpoints/auth/logout.ts` | `users/endpoints/logout.ts` |
| `endpoints/auth/me.ts` | `users/endpoints/me.ts` |
| `endpoints/auth/oauth-exchange.ts` | `users/endpoints/oauth-exchange.ts` |
| `endpoints/auth/oauth-providers.ts` | `users/endpoints/oauth-providers.ts` |
| `endpoints/auth/oauth-start.ts` | `users/endpoints/oauth-start.ts` |
| `endpoints/auth/oauth-shared.ts` | `users/utils/oauth.ts` |
| `endpoints/auth/refresh.ts` | `users/endpoints/refresh.ts` |
| `account/endpoints.ts` (`profileHandler`, `deleteHandler`) | `users/endpoints/profile.ts`, `users/endpoints/delete-account.ts` |
| `repositories/auth-repository.ts` | `users/repositories/auth.ts` |
| `account/repository.ts` | `users/repositories/account.ts` |
| `account/sessions.ts` | `users/repositories/sessions.ts` |
| `account/deletion.ts` | `users/services/deletion.ts` |
| `account/locking.ts` | `users/services/locking.ts` |
| `auth/atomic.ts` | `users/utils/atomic.ts` |
| `auth/code.ts` (+ test) | `users/services/code.ts` |
| `auth/email-login.ts` (+ test) | `users/services/email-login.ts` |
| `auth/oauth.ts` (+ test) | `users/services/oauth.ts` |
| `auth/oauth-commit.ts` | `users/services/oauth-commit.ts` |
| `auth/oauth-flow.ts` (+ test) | `users/services/oauth-flow.ts` |
| `auth/oauth-provider.ts` (+ test) | `users/services/oauth-provider.ts` |
| `auth/oidc.ts` (+ test) | `users/services/oidc.ts` |
| `auth/refresh-session.ts` (+ test) | `users/services/refresh-session.ts` |
| `auth/session.ts` (+ test) | `users/services/session.ts` |
| `email/login-code.ts` (+ test) | `users/services/login-code-email.ts` |
| `schemas/user.ts` | `users/schemas/user.ts` |
| `schemas/auth-identity.ts` | `users/schemas/auth-identity.ts` |
| `schemas/login-code.ts` | `users/schemas/login-code.ts` |
| `schemas/oauth-attempt.ts` | `users/schemas/oauth-attempt.ts` |
| `schemas/oauth-grant.ts` | `users/schemas/oauth-grant.ts` |
| `schemas/refresh-token.ts` | `users/schemas/refresh-token.ts` |
| `schemas/session-family.ts` | `users/schemas/session-family.ts` |
| `routes/auth.ts` + `routes/account.ts` | `users/routes.ts` (`UserRoutes`) |

### contacts

| From | To |
|---|---|
| `contacts/endpoints.ts` | `contacts/endpoints/{list,create,update,archive,get}.ts` |
| `contacts/repository.ts` | `contacts/repositories/contact.ts` |
| `schemas/contact.ts` | `contacts/schemas/contact.ts` |
| `routes/contacts.ts` | `contacts/routes.ts` |

### payment-methods

| From | To |
|---|---|
| `payment-methods/endpoints.ts` | `payment-methods/endpoints/{list,create,edit,default,archive}.ts` |
| `payment-methods/repository.ts` | `payment-methods/repositories/payment-method.ts` |
| `payment-methods/validation.ts` (+ test) | `payment-methods/services/validation.ts` |
| `schemas/payment-method.ts` | `payment-methods/schemas/payment-method.ts` |
| `routes/payment-methods.ts` | `payment-methods/routes.ts` |

### billings

| From | To |
|---|---|
| `billings/endpoints.ts` | `billings/endpoints/{create,list,get,preview,patch,resolve-guest}.ts` |
| `billings/repository.ts` | `billings/repositories/billing.ts` |
| `billings/guests.ts` | `billings/services/guests.ts` |
| `billings/reminders.ts` | `billings/services/reminders.ts` |
| `billings/request.ts` (+ test) | `billings/services/request.ts` |
| `billings/cron.ts` | `billings/crons/materialize.ts` |
| `schemas/billing.ts`, `schemas/billing-guest.ts` | `billings/schemas/` |
| `routes/billings.ts` | `billings/routes.ts` |

### charges

| From | To |
|---|---|
| `charges/endpoints.ts` | `charges/endpoints/{get,cancel,pay,reopen}.ts` |
| `charges/repository.ts` | `charges/repositories/charge.ts` |
| `charges/materialize.ts` | `charges/services/materialize.ts` |
| `schemas/charge.ts` | `charges/schemas/charge.ts` |
| `routes/charges.ts` | `charges/routes.ts` |

### invites

| From | To |
|---|---|
| `invites/endpoints.ts` | `invites/endpoints/{create,revoke,public,accept}.ts` |
| `invites/repository.ts` | `invites/repositories/invite.ts` |
| `invites/links.ts` | `invites/services/links.ts` |
| `schemas/invite.ts` | `invites/schemas/invite.ts` |
| `routes/invites.ts` | `invites/routes.ts` |

### public (public charge links)

| From | To |
|---|---|
| `public/endpoints.ts` | `public/endpoints/{create-link,rotate-link,revoke-link,charge}.ts` |
| `public/repository.ts` | `public/repositories/public-link.ts` |
| `public/capability.ts` (+ test) | `public/services/capability.ts` |
| `public/links.ts` | `public/services/links.ts` |
| `routes/public.ts` | `public/routes.ts` |

### proofs

| From | To |
|---|---|
| `proofs/endpoints.ts` | `proofs/endpoints/{start-upload,withdraw,review,download,public-start-upload,public-state,public-withdraw}.ts` |
| `proofs/repository.ts` | `proofs/repositories/proof.ts` |
| `proofs/bucket-storage.ts` (+ test) | `proofs/services/bucket-storage.ts` |
| `proofs/storage.ts` | `proofs/services/storage.ts` |
| `proofs/throttle.ts` | `proofs/services/throttle.ts` |
| `proofs/validation.ts` (+ test) | `proofs/services/validation.ts` |
| `proofs/bucket-event.ts` | `proofs/events/receive-object.ts` |
| `proofs/scheduler.ts` | `proofs/schedulers/upload-expiry.ts` |
| `schemas/proof-throttle.ts` | `proofs/schemas/proof-throttle.ts` |
| `routes/proofs.ts` | `proofs/routes.ts` |

### notifications

| From | To |
|---|---|
| `notifications/endpoints.ts` | `notifications/endpoints/{register-device,manual-reminder}.ts` |
| `notifications/repository.ts` | `notifications/repositories/notification.ts` |
| `notifications/context.ts` | `notifications/services/context.ts` |
| `notifications/planner.ts` | `notifications/services/planner.ts` |
| `notifications/render.ts` (+ test) | `notifications/services/render.ts` |
| `notifications/send.ts` | `notifications/services/send.ts` |
| `notifications/direct.ts` | `notifications/services/direct.ts` |
| `notifications/transport.ts` (+ test) | `notifications/services/transport.ts` (Expo call moves to `vendors/expo/client.ts`) |
| `notifications/cron.ts` | `notifications/crons/arm-notify.ts` |
| `notifications/scheduler.ts` | `notifications/schedulers/charge-notify.ts` |
| `schemas/notification.ts` | `notifications/schemas/notification.ts` |
| `routes/notifications.ts` | `notifications/routes.ts` |

### timeline

| From | To |
|---|---|
| `timeline/endpoints.ts` | `timeline/endpoints/{timeline,contact-ledger}.ts` |
| `timeline/repository.ts` | `timeline/repositories/timeline.ts` |
| `routes/timeline.ts` | `timeline/routes.ts` |

### health

`endpoints/health.ts` (+ test) and `routes/health.ts` become `health/endpoints/health.ts` and
`health/routes.ts` (`HealthRoutes`). A tiny domain, but it keeps `common` free of endpoints.

### removed folders

`account/ auth/ authorizers/ email/ endpoints/ events/ openapi/ repositories/ routes/ schemas/ security/`
and `src/provider.ts`.

## Providers

`src/provider.ts` (`ApiProvider`) is deleted. Each domain declares its own provider listing
only the services and variables its handlers, crons, schedulers and events read:

| Provider | services | variables |
|---|---|---|
| `SessionAuthorizerProvider` (`common/authorizers/session.ts`) | db | `AUTH_JWT_SECRET` |
| `UserProvider` | db, email | `APP_STAGE`, `AUTH_JWT_SECRET`, `LOGIN_CODE_HASH_KEY`, `OAUTH_PROVIDERS_CONFIG_B64`, `OAUTH_GOOGLE_ENABLED`, `OAUTH_APPLE_ENABLED`, `OAUTH_REDIRECT_ALLOW_LIST` |
| `ContactProvider`, `PaymentMethodProvider`, `ChargeProvider`, `TimelineProvider` | db | – |
| `BillingProvider` | db, email, chargeNotifyScheduler (cron) | `PUBLIC_LINK_HMAC_SECRET`, `PUBLIC_WEB_ORIGIN` |
| `InviteProvider` | db | `PUBLIC_LINK_HMAC_SECRET`, `PUBLIC_WEB_ORIGIN` |
| `PublicProvider` | db | `PUBLIC_LINK_HMAC_SECRET` |
| `ProofProvider` | db, proofFiles, uploadExpiryScheduler | `PUBLIC_LINK_HMAC_SECRET` |
| `NotificationProvider` | db, email, chargeNotifyScheduler | `NOTIFICATION_PUSH_TRANSPORT`, `EXPO_ACCESS_TOKEN` |

The table is the starting point. The final list per provider is whatever `tsc` demands once
handlers are typed with `Service.Context<XProvider>`; nothing extra is declared. Vendor
variables (`RESEND_*`, `EMAIL_TRANSPORT`) stay on the email factory / vendor services as
today (Factory.Service pattern).

Crons and schedulers keep their own `services` map as today; only the import paths change.

## Expo vendor

`notifications/transport.ts` today builds the Expo headers, the `post` helper and the
response mapping for `push` and `receipt` inline. That code moves to
`vendors/expo/client.ts` as `createExpoPushClient(env, request)` returning
`{ send(message): Promise<SendResult>; receipt(ticket): Promise<ReceiptResult> }`, with the
Expo response shapes in `vendors/expo/types.ts` and `httpFailure`/`expoError` in
`vendors/expo/utils.ts`. `transport.ts` keeps the `NOTIFICATION_PUSH_TRANSPORT !== 'expo'`
guard and the e-mail branch, and delegates to the client. `transport.test.ts` already injects
`request` (a `fetch` mock), so its assertions and mocks do not change.

## Files outside `src`

- `ez4.project.js` `sourceFiles`: `billings/crons/materialize.ts`, `notifications/crons/arm-notify.ts`,
  `notifications/schedulers/charge-notify.ts`, `proofs/schedulers/upload-expiry.ts`.
- `test/**/*.spec.ts` (integration): import paths only.
- `scripts/generate-openapi.mjs`: `../src/common/utils/openapi.ts`.
- Docs citing `src/...` paths: `docs/testing.md`, `docs/notifications.md`, `docs/proof-storage.md`,
  `docs/environments.md`, `docs/oauth-setup.md`, `docs/deploy-guide.md`, `docs/mvp-acceptance.md`.
  Plans under `docs/superpowers/plans` are history and stay as written.
- `~/Projects/ai-rules/notes/receivy.md`: append one line with the new layout (append only).

`security/gateway-runtime.test.ts` and `test/auth-people/sql-redaction.spec.ts` only move
(`common/services/listener.test.ts` keeps its sibling; gateway-runtime goes to
`common/services/gateway-runtime.test.ts`). Deleting them belongs to the vendor-patch
decision, not to this task.

## Execution rules

1. Move with `git mv` so history follows the file.
2. Split `endpoints.ts` files by cutting each handler (with its request/response types and
   private helpers) into its own file. Helpers used by more than one handler in the same
   domain go to `<domain>/utils/<name>.ts`.
3. Fix imports guided by `tsc`; then `biome check --write` for import order and format.
4. Gate, all green before done: `pnpm check-types`, `pnpm lint`, `pnpm test` (91 unit),
   `pnpm test:integration` (107), `pnpm openapi:check`, and `pnpm dev` boots without an
   import-cycle crash on the first cron tick.
5. No commit, no push, no migration. No new dependency. No logic refactor.

## Risks

- Import cycles: `events` moving to `common` and schemas into domains changes the graph;
  `ez4 serve` crashes on the first cron tick when a repository cycle exists (see notes).
  Check by booting the local server, not only by `tsc`.
- `openapi:check` compares generated output; route names and paths are unchanged so the
  document must be byte-identical. Any diff is a mistake in the move.
- Web `openapi-contract.test.ts` reads `docs/openapi.json`; unaffected as long as the
  document is identical.
