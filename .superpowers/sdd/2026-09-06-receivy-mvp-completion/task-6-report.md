# Task 6 — account lifecycle and legal UI

Status: DONE_WITH_CONCERNS (documented external acceptance gates and MVP limits).
Base: ac8b95e2ea3cb1dea3781ec25a066b912feb150d.
Branch: work/receivy-foundation. Date: 2026-09-07.
No subagents, worktree/reset, deployment, real-account deletion or production calls.

## Controller-approved boundary

- Preserve necessary financial ownership using an anonymized, non-login user
  tombstone instead of schema-wide nullable ownership. Existing amounts, payment
  states/dates/methods and counterparties' immutable snapshots remain intact.
- Delete attributable identity, clear BOTH recipient user ID and historical email
  authorization, and prevent same-email re-registration from regaining history.
- Authenticated sender_user_id is the proof ownership evidence. Remove matching
  proof/upload objects through Task5's durable journal and clear payment references;
  preserve the payment fact. Anonymous capability and counterparty files are retained,
  not presumed owned by the deleting creditor. No blanket third-party erasure.
- Five-minute, HMAC-signed, authenticated session-bound export authorization. JSON is
  generated at download; no persisted exports, storage prefix or cleanup worker.
- New device registrations bind to the authenticated family. Logout/replay/revoke
  disable that family and conservative unlinked legacy registrations; deletion
  disables all owned registrations. Already accepted/in-flight sends cannot be recalled.
- Repository deletion is idempotent. HTTP retries with revoked credentials return
  ordinary 401. Clients clear authentication but show an unconfirmed outcome on
  401/network ambiguity; only an actual success response confirms deletion.
- Launch contract stays pt-BR/BR/BRL per controller ruling. Name and actual IANA
  timezone are editable; other locale/country values are not falsely advertised.

## Implemented

API account routes: PATCH /account/profile; GET /account/sessions;
DELETE /account/sessions/{id}; DELETE /account; POST /account/export;
POST /account/export/download. All use the real authorizer and reflected literal
request/response contracts. Export ticket travels in a body, never a URL.

Authorizer now verifies persisted family ownership/revocation and active user after
JWT verification. Service-level cache explicitly sets authorizerTTL: 0. Logout's
refresh-token-only contract remains valid after access expiration. Session issuance,
refresh/OAuth grant consumption/auth-user lookup/verified-person linking exclude
deleted users. Existing email/code, Google and Apple routes remain unchanged.
Refresh lock order is user -> family -> token, aligning with account/device operations.
Owner-locked contact, Pix, expense, recurrence and notification mutations reject
deleted users. Charge operations also check that their actor is still active.

Erasure locks user, families, future rules and affected charges; charge -> delivery
-> device order matches the notification worker. It revokes links while retaining
tombstones, ends owned rules, removes owned proof references and journals deletion
transactionally, scrubs recipient routing/render inputs and affected supported or
unsupported outbox payloads, removes own auth artifacts/settings and unnecessary
contacts, anonymizes retained identity, and writes an anonymous audit fact. Existing
refresh hashes are removed. A journal validation failure rolls back ALL local changes.
Notification expansion refuses an erased creditor, preventing new initial capability
creation even if a stale event becomes visible. Native deletion concurrency is
idempotent; storage retry continues independently of now-revoked credentials.

Export enumeration is explicit: own profile/people/contact values/Pix methods,
expense/recurrence summaries, authenticated uploaded-proof metadata, preferences,
activity facts and authorized charge/payment history. It excludes login/OAuth
artifacts, refresh/device tokens, public capabilities, object keys and signing secrets.
Web creates a JSON Blob attachment named receivy-dados.json; native shares JSON text
through the OS sheet (not a server-persisted file). Both settings screens wire profile,
session revoke, export and explicitly confirmed deletion. Name-less initial login
shows a name-only form with device-derived timezone. Existing timeline is not erased.

Web /terms and /privacy are public pages; native provides equivalent in-app text.
Disclosures explicitly distinguish manual reconciliation from banking/payment/Pix
verification and explain shared-record retention, asynchronous cleanup and already
sent notices. Operator contacts remain configurable via NEXT_PUBLIC_OPERATOR_CONTACT
and EXPO_PUBLIC_OPERATOR_CONTACT; defaults say the operator has not supplied them.
Detailed allowlist and retention caveats: docs/account-lifecycle.md.

## RED / GREEN evidence and exact commands

Commands executed with Node 24.15.0 and pnpm 11.5.3. Native fixtures assert
current_database() = receivy_tests. The regular receivy database was not reset.
The HTTP supplement used only the disposable compose stack on port 55435.

1. `pnpm --filter @receivy/api exec ez4 test -e test.env.example --local --reset -- test/account/`
   - Bootstrap RED (equivalent direct Node command before files existed): tests1,
     pass0, fail1, ERR_MODULE_NOT_FOUND src/account/repository.
     Direct form, cwd packages/api: `node --env-file=test.env.example ./node_modules/@ez4/project/bin/cli.mjs test -e test.env.example --local --reset -- test/account/`.
   - First behavioral GREEN4/4: real issued access then remote revocation; foreign/
     missing families; logout/replay disabling push; foreign/expired/tampered/revoked
     export; erase and same-email re-registration denied old history.
   - Genuine expanded RED3/4: "Missing expected rejection (HttpUnauthorizedError):
     a pre-authorized request cannot recreate contacts after erasure". Added active
     user checks under existing owner locks (contacts/Pix); GREEN4/4.
   - File case initially asserted undefined for SQL NULL; native driver returned null.
     Corrected test expectation, not implementation; accepted proof FK reread is NULL.
   - Expanded final GREEN5/5: rollback on journal enqueue failure; concurrent erase
     idempotence; family-linked plus actual legacy registrations; refresh replay racing
     registration leaves no active family device; deleted user denied even with an
     injected unrevoked fixture family; own proof deleted, anonymous proof retained;
     failed storage deletion retries to durable deleted state without credentials.
2. `pnpm --filter @receivy/web exec vitest run src/components/account-settings.test.tsx`
   - Bootstrap RED: missing account-settings import. Equivalent initial direct command
     used `node node_modules/vitest/vitest.mjs run src/components/account-settings.test.tsx`
     from packages/web. GREEN2/2: EXCLUIR required, real success and HTTP401 wording
     distinct, exactly scoped DELETE request. Included in full workspace gate.
3. `pnpm --filter @receivy/mobile exec jest src/components/account-settings.test.tsx --runInBand`
   - Initial direct-node attempt failed to resolve @babel/runtime because it bypassed
     pnpm's environment; this is NOT a behavioral RED claim. Normal pnpm command
     resolves installed runtime without dependency changes. GREEN2/2, last rerun2/2:
     explicit confirmation prevents mutation and success/uncertain outcome differ.
4. `pnpm --filter @receivy/api test:integration`
   - Full native GREEN52/52, then GREEN53/53 after rollback test addition.
   - Existing financial/proof/notification/recurrence suites remained green.
5. `pnpm --filter @receivy/api check-types:test`
   - Early failures exposed typed FK scalar clearing and BucketTester required signing
     options. Used the already-proven scoped sqlNull scalar boundary (not relation-null
     casts) and supplied test signing MIME/expiry. Final exit0.
6. `pnpm --filter @receivy/api test:http-smoke`
   - Fixture RED401 vs old expected403 exposed its fake sid/nonexistent foreign family.
     Added persisted real owner and foreign families; no authorizer bypass.
   - GREEN: financial/account HTTP transport smoke PASS. Existing ownership/concurrent
     reminder/recurrence response checks plus profile/session/export response shapes,
     actual HTTP remote revoke, identical old JWT immediately401 and export401.
7. `pnpm verify`
   - Exit0: workspace, lint, all types, common8/API17/web20 test files and mobile16
     suites (43 tests), all builds and existing Expo Doctor wrapper passed.
   - Doctor reports21/22 with the already-acknowledged SDK56 Hermes V1 warning;
     wrapper accepts that pinned-version warning. Watchman recrawl warning persists.
   - Later focused gate after session lock-order change:
     `pnpm --filter @receivy/api test` ->17 files/65 tests passed;
     native account5/5 and final test types exit0.
8. `git diff --check` ->exit0.

No output was silently treated as a passed test: initial shell pnpm commands attempted
package-manager resolution and failed fetching; ctx_execute spawnSync('pnpm',...) uses
the installed11.5.3 environment successfully. No dependency install/change was needed.

## Generated cache metadata evidence

Read-only command (no AWS calls, no deployment):

```sh
pnpm --filter @receivy/api exec node --input-type=module -e "process.loadEnvFile('./test.env.example'); const {buildMetadata}=await import('@ez4/project/library'); for(const mod of ['@ez4/gateway/library','@ez4/database/library','@ez4/storage/library','@ez4/scheduler/library']) { const m=await import(mod); m.registerTriggers(); } const m=buildMetadata(['./src/api.ts']); console.log(Object.keys(m.metadata)); console.log(JSON.stringify(m.metadata.Api?.cache));"
```

Exit0, generated services @variables/@options/Api/Db/ProofFiles and Api.cache exactly
`{"authorizerTTL":0}`. Pinned AWS provider maps it to cacheTTL and then
AuthorizerResultTtlInSeconds on create/update without an observed truthy fallback.
Actual deployed gateway configuration remains an external acceptance gate.

## Files

- packages/api/src/account/{repository,sessions,deletion,endpoints}.ts;
  src/routes/account.ts; src/api.ts; src/authorizers/session.ts.
- packages/api/src/repositories/auth-repository.ts; schemas/{user,notification}.ts;
  people/repository.ts; payment-methods/repository.ts; expenses/repository.ts;
  charges/repository.ts; recurrences/repository.ts; notifications/{repository,endpoints,outbox}.ts.
- packages/api/test/account/account.spec.ts; scripts/financial-http-smoke.mjs.
- packages/common/src/domain/account.ts; packages/common/src/index.ts.
- packages/web/src/components/account-{settings,settings.test,onboarding}.tsx;
  app/{page,settings/page,privacy/page,terms/page}.tsx; lib/financial-proxy.ts.
- packages/mobile/src/account/client.ts; components/account-settings{,.test}.tsx;
  components/{legal-text,session-gate}.tsx; app/settings.tsx.
- docs/account-lifecycle.md; this report.

Root-owned docs/mvp-acceptance.md, docs/testing.md, completion plan and progress.md
were not edited or included in the task commit.

## Self-review and concerns

- Confirmed no public proof MIME widening, new storage adapter, auth exemption,
  generic SQL fixture replacement, new relation-as-primary key or real secret.
- Cross-account authorization, historical re-registration, SQL NULL clearing,
  cleanup rollback/retry, source/client delete confirmation and real HTTP revocation
  are tested. Expo physical-device permissions/delivery and OS share-sheet handling
  require device acceptance; no device/provisioning was authorized.
- The export is an explicit account-data representation, not a full raw database
  backup; it includes expense/recurrence summaries and charge/payment details rather
  than internal idempotency hashes or every internal allocation/reminder row.
- Erasure is atomic locally, not atomic with external notification acceptance or
  storage I/O. Cleanup may remain pending/blocked if the provider stays unavailable;
  the existing durable journal exposes that condition. No promised legal deadline.
- Anonymous/counterparty files and shared free-text financial descriptions remain
  under the approved retention boundary. A user tombstone remains for FK consistency,
  not as a sign-in account. Legal/operator contact review is an external release gate.
- pt-BR/BR locale/country are honest fixed launch values, not editable international
  preferences. Native export shares JSON text; saved copies/shared destinations are
  controlled by the user, not retained by the API.
- Full native device builds/credential-dependent OAuth/provider sends/deployed AWS
  cache policy were not claimed tested. Task7's known provider/logging/network and
  SDK56 external gates remain unchanged; this task adds no production configuration.
