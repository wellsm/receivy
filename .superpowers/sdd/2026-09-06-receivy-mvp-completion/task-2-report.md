# Task 2 report — Financial clients

## Outcome

Implemented the financial slice in both real clients. The Next app now loads the
authenticated timeline through a method/path-allowlisted BFF, creates and reviews
split/installment expenses, opens persisted charge details, manages Pix keys, and
shows a contact ledger. The Expo app has the equivalent authenticated timeline,
creation/review, charge actions, Pix settings, and ledger routes. No demo finance
remains in either timeline.

Money display now avoids floating-point division: `MAX_SAFE_INTEGER` cents renders
with the final cent intact, signed ledger values including `-1` cent format exactly,
and `makeMoney` rejects unsafe integers. BRL entry is strict and never partially
parses malformed strings. Civil-date defaults use the local/device calendar rather
than UTC truncation.

The public Next page exposes only the minimal charge DTO and literal Pix key. It is
dynamic/read-only until Task 3, has a functional copy control with synchronous
fallback plus pending/failure feedback, and receives per-request nonce CSP,
`private, no-store`, `no-referrer`, `nosniff`, and `noindex` headers. Native public
sharing requires explicit `EXPO_PUBLIC_WEB_URL`; it never treats the API URL as the
public web origin or invents a production domain.

## Main files

- Shared exact values/form input: `packages/common/src/domain/{money,financial-form}.ts`
- Web transport/security: `packages/web/src/lib/financial-proxy.ts`,
  `packages/web/src/app/api/financial/[...path]/route.ts`, `packages/web/src/proxy.ts`
- Web flows: `packages/web/src/components/{timeline-screen,charge-create-screen,charge-detail-screen,pix-settings-screen,person-ledger-screen,public-pix-copy}.tsx`
- Web routes: `packages/web/src/app/{charges,pay,people/[id],settings}/**`
- Expo transport/config: `packages/mobile/src/financial/client.ts`,
  `packages/mobile/.env.example`, `packages/mobile/package.json`
- Expo flows/routes: `packages/mobile/src/components/{home-screen,charge-create-screen,charge-detail-screen,pix-settings-screen,person-ledger-screen}.tsx`, `packages/mobile/src/app/{charges,people/[id],settings.tsx}`
- Responsive visual system: `packages/web/src/app/globals.css`, existing native Uniwind tokens

## RED / GREEN evidence

- Money RED: common suite failed 2 cases: unsafe input was accepted and
  `MAX_SAFE_INTEGER` displayed `...,90` instead of `...,91`.
- Money GREEN: common 42/42, including signed `-R$ 0,01` and civil-timezone boundary.
- BRL parser RED: missing module; GREEN covers 12 strict parsing/boundary cases.
- Web financial RED: missing timeline/creator modules; subsequent idempotency test
  proved the same key survives a 503 retry. BFF allowlist RED failed all 21 cases
  before method/path validation existed.
- Expo RED: missing financial client/live home/detail modules. GREEN covers native
  idempotency, explicit web-base config, typed 422 messages, live timeline and
  debtor read-only Pix copy.
- Public copy RED: missing component/CSP public bypass, then explicit pending and
  denial branches. GREEN: 3 copy tests including timeout-visible pending state and
  manual-copy guidance.

## Verification

- `pnpm verify` — exit 0: workspace contract; 4/4 lint and type tasks; common
  42/42, API 55/55, web 41/41 at that checkpoint, Expo 15/15; all four builds.
  Repository verifier acknowledged the existing Expo 56 Hermes warning as designed.
- After final copy/ledger/rotation fixes: web 43/43; web lint, types and Next
  production build exit 0; Expo 15/15, lint/types exit 0, Expo export exit 0.
- Root visual QA inspected real rendered pages at 390/768/1440. Confirmed no document
  overflow, corrected the 390 summary collision, verified local 06/09 date rather
  than UTC 07/09, and hid the create FAB on the draft route. Production public smoke
  confirmed no-store/nosniff/no-referrer and
  matching nonces on all ten scripts. After the last production rebuild, a real AX
  click immediately displayed `Chave Pix copiada.`; the IAB clipboard reader still
  observed its own empty clipboard surface, so content-level clipboard inspection
  remains a tool limitation rather than claimed proof.
- The final ledger due-date/installment/state copy and the final removal of global
  overdue from the receivable card were covered by code/tests but were not reopened
  in a later visual screenshot. A `127.0.0.1` dev-only debtor attempt was invalidated
  by Next cross-origin HMR/font blocking and is not presented as production evidence.

## Review fix round 1

All eight independent-review findings were reproduced and addressed without changing
API semantics:

- Uncertain expense attempts now freeze both the submitted DTO and idempotency key,
  lock every editable control, and only expose exact replay. Typed 4xx/422 rejection
  unlocks the draft and does not create a retry impasse.
- Both people pickers retain `nextCursor`, load subsequent pages, preserve selected
  contacts, and search the accumulated pages locally.
- Percentages use one strict integer basis-point parser: comma and dot decimals with
  at most two places are supported; signs, exponent notation, excess precision, and
  values above 100 are rejected rather than rounded.
- Native review renders every literal installment amount, including residual cents.
- Native timeline now exposes Today/Week filters, state/installment markers, cursor
  loading, and generation guards. Web and native discard reversed stale filters and
  obsolete pagination responses.
- Native Pix mutation failure preserves the draft. Mutation success followed by a
  refresh failure clears the now-saved draft but reports that the displayed list may
  be stale instead of claiming it was updated.
- Paid and cancelled payable details retain historical Pix data without instructing
  another transfer and show explicit terminal guidance.

### Fix-round RED / GREEN evidence

- `pnpm --filter @receivy/common test -- financial-form.test.ts`: RED 12 failures
  because the strict parser did not exist; GREEN 54/54 package tests.
- `pnpm --filter @receivy/web test -- charge-create-screen.test.tsx`: RED 3 targeted
  failures (mutable uncertain retry, missing people pagination, comma percentage);
  GREEN with the expanded web suite. The definitive-rejection regression also proves
  the draft is editable after a confirmed 422.
- `pnpm --filter @receivy/mobile test -- charge-create-screen.test.tsx`: RED for
  missing exact retry/pagination/installment output, then an additional RED proving
  installment controls were still editable; GREEN 5/5 focused creation regressions.
- `pnpm --filter @receivy/web test -- timeline-screen.test.tsx`: deterministic
  reverse-resolution RED 2/4, then GREEN 4/4 timeline tests.
- `pnpm --filter @receivy/mobile test -- home-screen.test.tsx`: RED 2/3 for missing
  state/paging/date UI and stale overwrite; GREEN 4/4 including obsolete pagination.
- `pnpm --filter @receivy/mobile test -- pix-settings-screen.test.tsx`: RED 2/2 for
  lost failed draft and false refresh success; GREEN 2/2.
- Web/native charge-detail terminal suites were RED 2/2 each, then GREEN (web 2/2,
  native 3/3 including the existing pending debtor path).
- Final self-review added a RED assertion showing the web review panel's primary
  submit still bypassed exact replay while uncertain; disabling it made web 50/50,
  lint, types, and the production build pass again.

### Final verification after review fixes

- `pnpm verify` completed successfully: workspace contract; lint 4/4; types 4/4;
  common 54/54, API 55/55, web 50/50, native 27/27 (186 tests total); builds 4/4.
  The final SDK check acknowledged the existing Expo 56 Hermes warning as required.

## Self-review and known boundaries

- BFF accepts only frozen financial methods/paths, checks trusted origin for every
  mutation, sources Authorization only from the HttpOnly access cookie, forwards
  only the idempotency header, and cannot proxy auth/public paths.
- API error bodies/statuses including exact-cent 422 responses pass through; clients
  render their message instead of replacing it with a generic transport error.
- Terminal charges expose no invalid state transition controls. Browser/device copy
  and share failures are visible and preserve the draft/detail state.
- `PersonLedger` has no contact name field. The ledger title therefore stays generic;
  adding a name would require a separate contact read/contract decision and is left
  for Task 7 rather than silently expanding the API.
- Web charge transitions use explanatory native `window.confirm` dialogs. Real CUA
  could open the dialog but then lost focus control, so that automation limitation is
  recorded; confirmation copy/state changes are covered by the implementation gates.
- Proof upload/review, recurrence, notifications, account/session lifecycle and
  deployment configuration remain intentionally outside Task 2.
