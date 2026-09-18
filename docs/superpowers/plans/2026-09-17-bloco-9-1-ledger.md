# SDD ledger — plan: docs/superpowers/plans/2026-09-17-bloco-9-1-contact-pix.md

Spec: docs/superpowers/specs/2026-09-17-bloco-9-1-contact-pix.md (read). Git: local commits on main, never push (owner's standing choice). `packages/api/src/users/services/session.ts` stays uncommitted.

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 → T3/T4 | `ContactInput.paymentMethod` (`{ pixKeyType, pixKey, label? }`) | forms post the same shape; consistent |
| T1 → T2 | `electDefault` and `upsertContactKey` untouched by T2 | consistent |
| T2 → T3/T4 | `BillingInput.paymentMethodId` only; `draft.pix` = method id for both directions | forms send `paymentMethodId`; consistent |
| T2 ↔ web/mobile compile | removing `pixInline` from the draft breaks both forms until T3/T4 | **known**: T2 verifies common+API only; web/mobile tsc red between T2 and T4. Ruling below. |
| T1 self | tests vs code | `save` files + elects; three cases cover create/edit/no-key |
| T2 self | specs migrate `pix:` inputs to a pre-created contact key | `PaymentMethodRepository.save(db, OWNER, {…, contactId})` exists (T3 of block 9) |
| T3/T4 self | selector reuse | the receivable listbox (`billing-pix-options`) takes `methods`; scoping by direction is the implementer's job |

Ruling: T2 leaves web/mobile red on `pixInline` until T3/T4 land (three consecutive local commits, nothing deployed in between) — alternative would be keeping a dead `pixInline` in the draft for two tasks. Cost if wrong: none at runtime.
Ruling: the new contact field is `paymentMethod` (not `pix`) so a second kind (`type: 'link'`) later extends one input type; UI copy stays "Chave Pix" because that is what it is today.
Task 1: implementer DONE (458805b). Review dispatched.
Task 1: review — Approved with 1 Important (plan-mandated): the edit case never proves the old key was demoted. Ruling: tighten the assertion (exactly one default, the old key present with `isDefault: false`); fix round 1. Minor (deferred): redundant `label ?? 'Pix'` at the call site; test 3 only checks length.
Task 1: fix round 1/5 (1 addressed, 0 open — edit case proves the demotion; commit 634ca0d). Scoped re-review dispatched.
Task 1: complete (commits 3317f40..634ca0d, review clean after 1 round)
Task 2: implementer DONE (df489b1). Concerns: idempotency fingerprint changes for old payable requests carrying `pix` (replay → IdempotencyMismatchError — accepted: mobile is TestFlight-only, no old clients in flight); `normalizeBillingPix` deleted (never exported); `ReceivableHasNoPayeeError` guard on `patch.pix` removed (a receivable pointing at an owner key is legitimate). Review dispatched.
Task 2: complete (commits 634ca0d..df489b1, review Approved). Carried into T3/T4 (Important): the payable PATCH branch in both forms (`web billing-form-screen.tsx:~451`, `mobile:~586`) still builds `...(input.pix ? { pix } : {})` — must send `paymentMethodId`/`clearPaymentMethod` like the receivable branch. Minor (deferred): no test for a receivable refusing a contact key (now 404 via pixSnapshot in-transaction); no CurrentMonth snapshot-rewrite test for a `paymentMethodId` patch; `draft.pix` dual meaning undocumented; stale "Pix" mention in billing-scope.ts comment.
Task 3: implementer DONE (7f09328; web 368/368, tsc/eslint/contract clean). Notes: contact edit route is `/contacts/{id}/edit` (`/contacts/{id}` is the ledger); the seat effect preserves `draft.pix` when it is already a key of the loaded contact; adding a key on contact edit makes it the default (by spec). Review dispatched.
Task 3: review — Approved with 3 Important. Rulings: #1 (scope-dialog trigger on a Pix change of a recurring payable claimed, untested) → fix round: add the case; #2 (archive without confirmation, unlike pix-settings) → fix round: same ConfirmDialog; #3 (loadKeys/act duplicated with pix-settings-screen) → deferred, second occurrence. Minors deferred: masked-in-state convention flip; `editing` vs `billing.id` style.
Task 3: fix round 1/5 (2 addressed, 0 open — scope-dialog test; archive confirmation; commit 6e14644). Scoped re-review dispatched.
Task 3: complete (commits df489b1..6e14644, review clean after 1 round)
Task 4: implementer DONE (5b75034; mobile check-types/lint clean, 284 pass + the pre-existing feed failure). Notes: Maestro `e2e/smoke/03-contact-charge.yaml` already stale, one more "E-mail" text on the contact screen; contact e-mail `accessibilityLabel` → "E-mail (opcional)" (chip "E-mail" of PixKeyFields made it ambiguous); payable key selector reloads on `useFocusEffect` (the form stays mounted while the user registers a key on the contact). Review dispatched.
Task 4: review — Needs fixes (3 Important). Rulings: #1 focus-return untested and the mock replays without cleanups → fix round: test + mock runs cleanups first; #2 `draft.pix` leaks a contact key onto a receivable when the direction flips → fix round on mobile (reset `pix` on direction change, with a test) and **carried to T5 for the web twin (same gap)**; #3 a failed archive/default is hidden behind the Modal → fix round: error rendered inside the dialog (or dialog closes and the error shows) + busy state on confirm. Minors in the round: `live` guard in `loadKeys`, the indentation. Deferred: focus effect bypassing `update()`'s locked guard (harmless); archive-dialog duplication (2nd occurrence); Maestro `03-contact-charge.yaml` already dead at :63 and now also misindexed at :65-67 — owner's call when Maestro is next touched.
Task 4: fix round 1/5 (3 Important + 2 minors addressed; the focus test exposed a real ordering bug, solved by deriving the paying key at render (`payingKey()`) instead of writing draft.pix in the effect; commit 865352c). Scoped re-review dispatched.
Task 4: complete (commits 6e14644..865352c, review clean after 1 round)
Task 5: implementer DONE (cfd112c, 9c9d087; all four packages green except the three known baselines; sweep found nothing to delete). Review dispatched.
Task 5: complete (commits 865352c..9c9d087, review clean). All 5 tasks complete; final whole-branch review over 3317f40..9c9d087.

## Final review (3317f40..9c9d087): With fixes. Rulings:
- Important #1 (web `act()` leaves the ConfirmDialog open on a failed archive, error hidden) → fix wave: mirror mobile (close the dialog, error in the form alert, busy state) + test.
- Important #2 (Maestro `e2e/smoke/03-contact-charge.yaml:65-67` `text: "E-mail", index: 1` now ambiguous) → fix wave: select the input by its accessibility label "E-mail (opcional)" (or id), and fix the already-dead `:63` hint step if trivially identifiable; Maestro cannot run here — the owner runs the smoke.
- Minor #3 (draft.pix comment: web persists the resolved id, mobile derives) → fix wave, one line. Minor #4 (archived pointed key silently re-pointed to the default on the next save) → accepted: the save IS the re-point, by the user, through the form. #5/#6/#7 deferred.
Final fix wave: implementer left the tree uncommitted (cited the global no-commit rule); controller committed the five files as the fix commit (owner authorized local commits on main for this flow) + docs commit. Scoped re-review dispatched.
Final fix wave re-review: all findings addressed (9c9d087..a26ce86). Bloco 9.1 complete.
