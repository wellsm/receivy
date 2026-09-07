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
  than UTC 07/09, hid the create FAB on the draft route, and distinguished ledger
  installments. Production public smoke confirmed no-store/nosniff/no-referrer and
  matching nonces on all ten scripts. After the last production rebuild, a real AX
  click immediately displayed `Chave Pix copiada.`; the IAB clipboard reader still
  observed its own empty clipboard surface, so content-level clipboard inspection
  remains a tool limitation rather than claimed proof.

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
