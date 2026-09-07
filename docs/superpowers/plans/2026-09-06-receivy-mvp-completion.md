# Receivy MVP completion

Spec: `docs/superpowers/specs/2026-09-04-receivy-mvp-design.md`.
Continue the existing working branch and preserve the prior validated contacts
and calculation increment. Do not move or reset the user's checkout.

## Global Constraints

- Node.js 24, pnpm 11.5.3, API EZ4 0.52.0, Next BFF and Expo SDK 56.
- No UI sharing between web and mobile; contracts and pure domain logic in common.
- Preserve email/code, Google and Apple login. No passwords or bank integrations.
- Every private operation validates ownership server-side. Monetary values are
  safe integer cents. Domain mutation and audit/outbox writes are transactional.
- No deployment, production account creation or use of reference-project secrets.
- Public capability tokens are HMAC-signed with 90-day expiry and version rotation;
  public responses contain no email, phone, internal IDs or other debts.
- All required capabilities must be wired to clients, not merely scaffolded.
- API integration tests follow the user-requested FreightHero convention:
  test/**/*.spec.ts, node:test/assert, DatabaseTester via ez4 test --local, typed
  fixture lifecycle and dedicated testOptions database; service testers for side
  effects. Custom shell/psql/HTTP scripts are not the primary regression suite.
- Full verification plus local HTTP/Postgres authorization/concurrency tests;
  record credential/device-dependent checks honestly as external acceptance gates.

### Task 1: Financial API and contracts

Implement payment-methods, expenses, charges, public capability reads and base
timeline in packages/api and shared DTOs in common. Follow current EZ4 schema,
database, protected route, repository and error conventions. Reuse pure
resolveExpenseSplit/planExpenseCharges rather than recomputing amounts.

Payment methods: owner-scoped list/create/edit/default/archive; validate Pix types
CPF/CNPJ/email/phone/random and normalize without exposing to other accounts.
Expenses: transactional create/read, owner-scoped Idempotency-Key bound to payload,
reject archived/foreign people and keys; store allocations and immutable charge
snapshots (description, amount, dates, Pix and recipient identity/email snapshot).
Support a later verified-email match without allowing contact edits to transfer
historical access. Optional description defaults to a neutral label.
Charges: creditor/debtor read matrix, creditor-only cancel/manual integral payment,
one payment per charge, stable terminal states, audit events and initial outbox.
Public links: create/rotate/revoke, HMAC token publicId.expires.signature tied to
version, 90-day expiry and strict minimal read; require configured secret, no
hardcoded production fallback. Timeline: pagination and filters direction/status/
source/from/to, account-relative totals; no demo amounts. Include person ledger.

Write focused tests first; add repeatable native EZ4 DatabaseTester specs
of idempotency, snapshots, cross-account rejection, debtor access, manual payment
concurrency and link expiry/rotation. Keep files domain-focused. Commit only task
files. Keep HTTP transport smoke small and supplementary. No web/mobile changes
here. Emit contracts/routes summary for task 2.

### Task 2: Financial clients

Implement actual timeline, charge creation/review/detail, Pix settings and contact
ledger on Next BFF/web and Expo using task 1 DTOs. Preserve Stitch-derived Receivy
tokens and responsive visual language, touch targets and accessible errors. Use
tests first. Forms support existing equal/fixed/percentage rules and installments,
owner portion, optional description, first due date and Pix selection. Show preview
before persist, retain idempotency key on uncertain retry, navigate to persisted
detail. Preserve exact cents in display too: fix the existing formatMoney division
rounding at safe-integer boundaries with a regression test and reject unsafe money
inputs. Offer creator payment/cancel/share/link rotation, debtor read-only finance
and Pix copy. Public page displays minimum read with no-store/no-referrer and
restricted CSP. All browser authenticated requests use BFF; native uses auth client.
Remove demo finance and inert navigation/actions where live alternatives exist.
Test web and native components/services; verify builds and 390/768/1440 layouts.

### Task 3: Private proof storage and review

Implement S3 private bucket/config/presigned upload and download adapters, upload
intents, public/authenticated upload/finalize routes, creditor proof review and
proof/payment timeline events. One pending upload per charge, 10 MB max JPG/PNG/PDF,
server-generated keys, object ownership/size/magic bytes/hash validation. Capability
and IP throttling, short attachment downloads, no upload on paid/cancelled charges.
Accept proof creates integral payment and paid state atomically; reject preserves
proof and permits retry. Public web and Expo/web details wire file selection,
upload, pending/rejection state and review. Local test adapter only when explicitly
configured in local mode; production must never silently fall back to local.
Test authorization, invalid files, replay and concurrent acceptance. No OCR.

### Task 4: Recurrences

Implement owner-scoped CRUD/pause/reactivate/end, allocations/reminders, 90-day
preview and hourly EZ4 job. Monthly/yearly clamping including Feb 29; IANA user
timezone, materialize at first enabled reminder else due date. Unique occurrence
constraint prevents duplicate charges; edits do not mutate snapshots. Add virtual
timeline projections and recurrence list/editor/detail on both clients. Reuse
expense creation internals with source metadata. Tests first covering pause,
future edit, DST/calendar, concurrent job replay and snapshot invariants.

### Task 5: Notifications

Implement transactional outbox processing, initial/reminder templates, recipient
push-first/email fallback policy, default reminder offsets -3/0/+2, preferences,
Expo device registration/removal and delivery receipts. Retry/backoff/dead-letter
with observable safe metadata; idempotency per recipient/channel/event. No external
effects inside transactions and no automated WhatsApp/SMS. Configure Resend and
Expo transport with explicit disabled local defaults; wire preference/device UI
and user-triggered manual reminders with server rate limits. Test deduplication,
backoff and failure without rolling back charges.

Integrate bounded durable storage cleanup/reconciliation for expired intents and
unreferenced final proof objects, using Task3's key/metadata contract and a grace
period that cannot delete in-flight or committed proofs. Coordinate with Task6
account-file deletion retries. Best-effort rollback deletion alone is not durable
cleanup. Retained proof objects must never inherit temporary bucket-wide expiry.

### Task 6: Account lifecycle and legal UI

Implement onboarding name, profile locale/timezone, session listing/revocation,
export private short-lived signed JSON and account deletion workflow. Delete
revokes sessions/links, removes own files and anonymizes necessary retained
references without deleting another user's financial records; prevent subsequent
use of revoked access tokens. Export contains only authorized own data. Expose
settings actions on web/native with explicit destructive confirmation. Add terms
and privacy clearly describing organizer/manual reconciliation, not a bank.
Tests first: export isolation, session invalidation, deletion consistency/retry.

### Task 7: Cross-flow hardening and release acceptance

Audit against the entire spec and fix missing actionable requirements: contacts
search/ledger/linkage badge, error envelope, correlation/redaction, rate limits,
public headers, history immutability and client parity. Generate/check OpenAPI,
run pnpm verify and local HTTP scenario payer-without-account to payment, debtor
timeline linkage, recurring creation, export/deletion. Verify Docker web build/run
and native development build where locally available. Do not deploy or provision
paid services. Document exact configuration and credentials still needed for
external provider/S3/email/push/EAS acceptance; never mark untested gates passed.
Migrate earlier auth/people repository proof scripts into the same DatabaseTester
suite where equivalent coverage is not yet present; preserve pure unit tests.
