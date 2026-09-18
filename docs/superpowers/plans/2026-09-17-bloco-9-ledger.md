# SDD ledger — plan: docs/superpowers/plans/2026-09-17-bloco-9-contact-receives.md

Spec: docs/superpowers/specs/2026-09-17-bloco-9-contact-receives.md (read).
Git: owner chose local commits straight on main, never push. WIP committed as 38b53c0; `packages/api/src/users/services/session.ts` (TTL hack) deliberately left uncommitted — implementers must never stage it.

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 → T2 | nullable columns, then relation lines | consistent; separate commits so the owner deploys them apart |
| T3 → T4 | scope rule `contact_id ? id : { isNull: true }` | T4 `pixSnapshot` uses the same predicate; consistent |
| T3 → T6 | `upsertContactKey(db, ownerId, contactId, pix: PixSnapshot)` | T6 passes `input.pix` after `normalizeBillingPix`; `label` may be optional there → default `'Pix'` at the call (plan self-review already says so) |
| T4 → T6 | `PayableMaterialization { payer; contactId? }` | `payableOf` builds exactly that; consistent |
| T5 → T6 | `BillingContact`, `BillingInput.contactId`, `BillingPatch.contactId/clearContact` | `contactOf` returns `BillingContact`; consistent |
| T5 → T10 | `BillingDraft.payee` holds a contact id | forms switch the picker to `contact.id`; consistent |
| T5 ↔ T7 | `ListChargeItem.billing` loses `type`/`direction` | feed type filter must compare `recurrence` (T7 says so); consistent |
| T6 ↔ T8 | T6 stops writing old columns; T8 backfills from them | **Conflict**: `billings.type` is NOT NULL since block 8 (`type: Direction` required in the schema). An insert without `type` fails at D3, before D4 drops the column. Ruling below. |
| T8 ↔ T9 | backfill before D3 | rows created by old code between the SQL run and the D3 deploy would lack `contact_id`. Ruling below. |
| T9 → T11 | `@deprecated` then delete | consistent |
| T1 self | test = integration run with `--reset` | agrees with itself |
| T3 self | tests vs code | `list(db, owner, archived, contactId)`, `save` with `contactId`, `upsertContactKey`, `makeDefault` scope — all exercised |
| T4 self | unit test stubs `findOne`/`findMany` by scope | matches the predicate the code uses |
| T5 self | normalizer tests vs code | `'Chave Pix só com um contato que recebe.'` message used in both |
| T6 self | integration cases vs code | `BillingRepository.create` signature is a hint (grep) — implementer adapts; fine |
| T7 self | `counterpartName` test vs code | consistent; `proofs` join shape is an open check, named in the task |
| T8 self | SQL sanity counters | idempotent statements (`IS NULL` / `NOT EXISTS` guards) |
| T10 self | form tests vs code | consistent |

Ruling: T6/T9 keep writing `billings.type` (derived: `contact_id ? 'payable' : 'receivable'`) on insert and update until T11 removes the column — the plan's "do not write `type`" is overridden — because the column is NOT NULL and D4 is the only step that drops it. Cost if wrong: one extra line to delete at T11.
Ruling: the owner runs the backfill SQL immediately before deploying D3, and the script is idempotent so a second run right after D3 closes the window — recorded in the T8 hand-off. Cost if wrong: a handful of rows created in the window keep `contact_id` NULL and read as receivable until the SQL is re-run.
Ruling: T1 and T2 are dispatched as one batch (same shape, two files each) with two separate commits, so the owner still deploys D1 and D2 apart. Cost if wrong: none — the commits are independent.

## Execution

Baseline note: `account.spec.ts` had lost the grace-window expectations (pre-existing drift, not the implementer's); re-applied and committed as 6ba47f0 → integration baseline back to `fail 1`.
Task 1: complete (commits 38b53c0..0bebfab, review clean; ⚠️ commit boundary verified by controller with `git show --stat`: D1 = two schema files only)
Task 2: complete (commits 0bebfab..a1681c7, review clean; D2 = database.ts only)
Task 3: implementer DONE (1d04d21) with a correctness concern: `upsertContactKey` looks a duplicate up by `(owner, contact, type, key)` but the unique index is `(owner, type, key)` → same key under another scope raises a raw constraint violation.
Ruling: the lookup ignores the scope; a match under the same contact is reused, a match under another scope (owner's own key or another contact) throws `PixKeyTakenError` (409) — the spec keeps the index precisely to surface that, and a friendly 409 is the surfacing, not a 500. Covered by a fifth test case. Cost if wrong: a 409 where a silent reuse across scopes would have been wanted.
Task 3: fix round 1/5 (1 addressed, 0 open — cross-scope duplicate → PixKeyTakenError; commits 1d04d21..91dc1f6)
Task 3: review — Important (plan-mandated): `upsertContactKey` un-archives a key but never re-elects it default when its scope has none. Ruling: real; the brief's pseudocode had the gap; fix now (round 2): after un-archiving, if no other active key in the scope, set `is_default: true`; cover with a test. Cost if wrong: none beyond the one line.
Task 3: minor (deferred): contact-vs-other-contact collision untested; `save` edit with a stray `contactId` 404s (brief-mandated: editing never moves scope); two near-identical duplicate lookups (2 cases, below the abstraction bar).
Task 3: ⚠️ resolved by controller: `upsertContactKey` TOCTOU — Task 6 calls it inside the billing transaction after `lockOwner`; carried into the T6 dispatch.
Task 3: fix round 2/5 (1 addressed, 0 open — resurrected key takes the empty default seat; commits 91dc1f6..1fb7614)
Task 3: complete (commits 6ba47f0..1fb7614, review clean)
Ruling (T4): to keep every commit typechecking, the T4 implementer also updates `payableOf` in `billing.ts` to build `{ payer: ChargePayer.Owner, contactId: row.contact_id }` (no inline `pix`), leaving `billingPix` in place for the detail DTO until T6. Cost if wrong: between T4 and T6 a payable created by the still-old create path materializes with the contact's default key instead of the typed one — both land in the same deploy (D3), so no runtime window.
Task 4: implementer DONE_WITH_CONCERNS (ca5c32c): 2 integration cases (`clearPayee on a conta a pagar…CurrentMonth`, `shows the payee the same charge as receivable…`) now fail because the old create path's inline `pix` no longer materializes — expected fallout owned by T6; implementer also touched `BillingRepository.create` to resolve the contact from the payee user id (beyond the ruling text). Review dispatched.
Task 4: review — Important ×2: `create()` in billing.ts gained an unauthorized contact lookup (beyond the ruling) and bypasses `ContactRepository`. Ruling: revert `create()` to the smallest compiling form `{ payer: ChargePayer.Owner }` (no contact resolution — Task 6 rewrites `create()` from `input.contactId`); both findings fall with it. The 2 integration failures stay until T6 (expected). Minor (deferred, plan-mandated): `materialize.test.ts` stub ignores `owner_id` — tenant isolation untested at unit level (production filter unchanged).
Task 4: fix round 1/5 (2 addressed, 0 open — create() back to `{ payer: ChargePayer.Owner }`; commits ca5c32c..c0b5217)
Task 4: complete (commits 1fb7614..c0b5217, review clean; 2 integration cases left red on purpose for T6: `clearPayee…CurrentMonth`, `shows the payee the same charge as receivable…`)
Ruling (T5): the contract change is additive during the block — `contactId`/`clearContact`/`BillingContact`/`contact` come in, while `type`, `payeeUserId`, `clearPayee`, `counterpartLabel`, `payeeName`, `payee`, `BillingPayee` stay declared `@deprecated`; the normalizer derives `type` as `contactId ? payable : (input.type ?? receivable)` and still forwards `payeeUserId`/`counterpartLabel` for the old create path. T6 removes the deprecated input/patch fields when it rewrites the repository; T10 removes the deprecated DTO fields when the clients stop reading them. Reason: otherwise common's tsc stays green but the API and both clients stop compiling for two tasks. Cost if wrong: a little more deletion at T6/T10.
Task 5: implementer DONE (056aa15) with concerns: `'counterpartLabel' in input` presence gate in the normalizer; extra files touched (`billing-footer.ts`, `billing-card.test.ts`, `billing-scope.test.ts`, `billing.ts` placeholder `contact: null`). Review dispatched.
Task 5: complete (commits c0b5217..056aa15, review clean — Approved)
Task 5: Ruling on Important #1 (plan-mandated): the draft now sends `contactId` while `create()` still plans charges from `payeeUserId` → a contact payable created by the new client would get no creditor. No runtime window (clients ship with D3 after T6), so no T5 fix; carried into T6 as an explicit acceptance: `create()`, `planBillingCharges` input, `billingInputFrom` and `patch()` read `input.contactId` and the payable charge's `creditor_id` = `contact.user_id`. Cost if wrong: T6 review catches it.
Task 5: Ruling on Important #2: `'counterpartLabel' in input` presence gate vs `billingInputFrom` always spreading the key — T6 deletes the deprecated `payeeUserId`/`counterpartLabel`/`type` input and patch fields and the legacy branches with them, so the gate disappears rather than being patched. Cost if wrong: T6 grows.
Task 5: minor (deferred): a contact payable's `paymentMethodId` is silently dropped by the normalizer (legacy path threw) — T6 decides (the contact key becomes the method, so the input may simply be honoured); web/mobile `BillingSummary`/`BillingDetail` fixtures need `contact: null` — T10.
Task 6: implementer DONE_WITH_CONCERNS (3dd7e49, 0c180d5). Rulings on the concerns:
- #1 `dto().pix` 404s when the pointed contact key is archived → real defect: the detail read must answer `pix: null` (a `HttpNotFoundError` from `pixSnapshot` on the read path is swallowed into null); fix before review. Cost if wrong: none.
- #2 `clearContact` leaves an empty conta a receber (nobody pays) → the spec has no "conta a pagar without a contact", so clearing makes no sense: drop `clearContact` from `BillingPatch`/`PatchBody` and the repository; changing who receives is `contactId` (payable→payable); the T5-review acceptance "clearContact behaves like clearPayee" was wrong and is withdrawn. Fix before review. Cost if wrong: a field to re-add.
- #3 `split` on a payable silently ignored → minor (deferred): a 400 would be kinder; leave.
- #4 registro counterpart frozen (contact is an entity now; rename happens on the contact) → accepted, by design.
- #5 `filters.type` / `searchBillingIds` still read the `type` column → carried into T9 (stop reading old columns) explicitly.
Task 6: pre-review fix round (2 addressed — pix read path null on archived key; clearContact withdrawn, contact move drops the pointed key; commit 1235073). Review dispatched over 056aa15..1235073.
Task 6: review — Needs fixes (2 Important). Rulings:
- `clearPix` no longer clears (falls back to the contact default; the spec test got inverted). Ruling: withdraw `clearPix` like `clearContact` — Pix belongs to the contact now; a conta a pagar always pays through the contact's effective key, and removing a key is `PaymentMethodRepository.archive`. `pix` on a patch keeps meaning "file this key under the contact and point at it". Cost if wrong: a field to re-add.
- multi-payer registro a receber plans one charge for the whole total to the first payer. Ruling: the normalizer refuses it — a registro a receber has exactly one payer (`'Registro a receber tem um pagador só.'`); a registro a pagar is `[Owner]` by derivation. Cost if wrong: a product feature (split registro) blocked until designed.
- Minor (deferred): lock-order comment in materialize.ts now stale (fixed in the round as a one-liner); registro a pagar detail shows the contact's Pix (display only); empty `payee` on the payable form throws 'Selecione ao menos um contato.' and `billingDraftSummary` returns null → T10; registro spec fixture names (`empresaId` = user id, `imobiliariaId` = contact id); `counterpartIdOf(split)` passed as `payeeUserId` for receivables is dead; `BillingDraft.counterpartLabel` write-only until T10.
Task 6: fix round 1/5 (2 addressed, 0 open — clearPix withdrawn; one payer per registro a receber; comment; commit 9ac24ed). T10 must drop `clearPix` from both clients and make the registro-a-receber form pick a single payer.
Task 6: complete (commits 056aa15..9ac24ed, review clean after 1 pre-review round + 1 fix round)
Task 7: implementer DONE (5f48b3d); `proofs` join = array (`proofs?.[0]`), `contact` join = object|undefined; unset optional columns read back as `null`. Web red owned by T10 (from T5/T6 contract change, not T7): `billing-form-screen.test.tsx` 6 cases (registro name, payee/pix, clearPayee, inline key error, seed+patch, registro edit); tsc in `billing-form-screen.tsx` ×5, its test ×1, `billing-detail-screen.test.tsx` ×1 (`contact` missing on fixtures). Review dispatched.
Task 7: review — Approved with 1 Important (no test proves the web card renders `counterpartName` with `viewerEmail` threaded) → fix round 1. Minor (deferred): `contact.nickname?` reads back `null` at runtime (EZ4 nullable column) — durable note candidate; card computes `chargeDirection` twice (harmless).
Task 7: fix round 1/5 (1 addressed, 0 open — feed card counterpart test; commit 28c5447)
Task 7: complete (commits 9ac24ed..28c5447, review clean)
Ruling (T8): after T6 a registro a receber needs exactly one payer, so a legacy receivable registro with an empty `counterpart_label` has nobody to become its allocation — the script must not invent one; it reports the count as a fourth sanity counter and the owner decides (name them, or accept they stay read-only until renamed). Cost if wrong: those rows fail `normalizeBillingInput` on reschedule/patch until handled.
Task 8: implementer DONE (9737fcf): dry-run counters 0,0,0,1,1 as expected; idempotent second run (0 rows affected). Three plan-SQL bugs found and fixed by the dry-run: UPDATE…JOIN referencing the target table (syntax), INSERT+UPDATE in one WITH reading the same snapshot (the UPDATE never saw the new key), label collisions across owners in step 2. Review dispatched.
Task 8: review — Needs fixes. Critical: step-3 UPDATE points a billing at a key row scoped to another contact when two contacts share a typed key. Ruling: one row per `(owner, type, key)` is all the unique index allows, so both billings point at it explicitly (like the owner-key case; `pixSnapshot` honours explicit ids) with a deterministic `DISTINCT ON … ORDER BY` and a sixth counter `keys_shared_across_contacts` for the owner to repoint later — never silent. Important: duplicate-name contacts (tie-break earliest `created_at, id` + counter `ambiguous_registro_labels`); operator guidance for non-zero must-be-zero counters (listing queries in the header); `creditor_id` mismatch counter; `sort_order` via `MAX+1`. Minors: "six" wording; ORDER BY id for determinism; header note on a label equal to the owner's own name.
Task 8: fix round 1/5 (6 addressed, 0 open — shared keys, name ties, operator guidance, creditor counter, sort_order, wording; commit dc1c1b2; 8 counters 0,0,0,0,1,1,1,1 on the extended fixture)
Task 8: complete (commits 28c5447..dc1c1b2, review clean after 1 round). Note for the owner: `payable_charges_creditor_mismatch` never exercised non-zero in the fixture.
Task 9: implementer DONE (7b89016): reads removed in billing.ts SELECT/Row, raw SQL search filter, EZ4 list where, charge.ts + timeline.ts `counterpart_label` readers; schema columns deprecated; `type` still written. Review dispatched.
Task 9: complete (commits dc1c1b2..7b89016, review clean). Deploy-runbook note: D3 assumes the backfill counters read zero; rows left without a resolvable contact lose their label display.
Task 10: implementer DONE (6451760, 2b900db, 81067d5): web 353/353, mobile 267/268 (1 pre-existing `feed-screen.test.tsx` failure, confirmed by stash), common 308, OAS regenerated + contract test green. Concerns: a registro a receber has no `contact` in the DTO (payer lives in the split) → detail header falls back to the first charge's name; `patchDraft` signature changed to `{ contact }` on both platforms. Review dispatched.
Task 10: review — Approved with 2 Important. Rulings:
- #1 (plan-mandated) a registro a receber lost its counterpart name (badge bare "Registro", header "De " with no charge). Ruling: the DTOs gain `counterpart: BillingContact | null` = "the other side as the owner knows them" — the receiving contact on a payable, the single payer's agenda entry on a registro a receber, null on a live receivable (many payers); screens display `counterpart`, the form seat keeps seeding from `contact`. Cost if wrong: one more DTO field to maintain.
- #2 empty seat on a registro a receber still says 'Selecione ao menos um contato.' → `'Escolha quem pagou.'`, with tests on both platforms.
- Minors fixed in the round because they are one-liners: 4 whitespace lines; web seat `<fieldset>` gets a `<legend>` carrying "De quem"/"Para quem"/"Quem recebe"; locked chip drops `aria-pressed`/`title`.
- Minors deferred: `contactById` falls back to "Contato" when the seated contact is outside recent/directory though `billing.contact.name` is known; `paymentMethods(contactId?)` has no caller yet; `SEAT_PREVIEW` sentinel in `billing-footer.ts` reads oddly; no `clearPix` on edit is by design (archive the contact key) — final review to confirm the detail screens offer a path to that.
Task 10: fix round 1/5 (3 addressed, 0 open — `counterpart` DTO field filled by the API and displayed; 'Escolha quem pagou.'; whitespace/legend/aria; commits 4edbf85, 4b1a2e4). Deferred: `counterpartOf` = 2 extra round trips per registro a receber in the list (batch if latency bites).
Task 10: complete (commits 7b89016..4b1a2e4, review clean after 1 round)
Task 11: implementer DONE (49ca3e9). Review dispatched.
Task 11: complete (commits 4b1a2e4..49ca3e9, review clean). All 11 tasks complete; final whole-branch review over 38b53c0..49ca3e9.

## Final review (38b53c0..49ca3e9): With fixes. Rulings:
- Critical 1 (nickname + contact id cross to the counterpart in GET /charges): real spec violation → fix wave: `billing.contact` is projected only when `owner_id === viewer`.
- Critical 2 (owner-only payable has no home; backfill counter blocks D3): the spec stands — a bill "mine alone" is a conta a pagar to a contact without account (create "Luz", "Aluguel"…); the counter stays a hard stop, its guidance says exactly that; `'Só comigo'` badge/test removed as unreachable. Owner confirms before D3. Cost if wrong: product decision to revisit.
- Important 3, 6, 7 (backfill: step 4 not re-run-safe; step 1 nondeterministic with 2+ payees; step 3 may point at an archived key): fix wave, with counters.
- Important 4 (a receivable may publish a contact-scoped key): fix wave — explicit `paymentMethodId` must live in the scope of the billing (`contact_id IS NULL` on a receivable, the contact on a payable) in `pixSnapshot` and `public-link.ts`.
- Important 5 (installed mobile builds break at D3): parked — mobile is TestFlight-only (block 8 ledger), no compatibility window; recorded in the deploy checklist.
- Important 8 (no UI path to remove a contact key): parked as a known product gap (follow-up: contact keys in the Pix settings screen).
- Important 9 (edit form shows "Contato"): fix wave.
- Minors 10, 11, 12, 13, 14, 15: fix wave (pure removals / one-liners); 16 skipped.
Final fix wave: DONE (1dd9640, a34350b, c73df88, 26069af, 16fbe28). Concern: fix D's strict scope makes legacy pointers the backfill deliberately creates (owner key on a payable; shared key across contacts) throw 'Chave Pix indisponível.' on the write path (new occurrences / reschedule). Ruling: the scope check is enforced where the risk is — on a receivable (no contact) the explicit key must have `contact_id IS NULL` (that is the leak/publish case) — while on a payable any key of the owner is accepted (new pointers are already validated by `assertContactKey`; legacy ones are counted for the operator). `public-link` keeps the receivable rule. F's `NOT EXISTS` staying blind to `archived_at` is accepted (non-partial unique index); `payables_with_multiple_payees` reporting only on the first run is accepted (informational).
Final fix wave: complete (commits 49ca3e9..3317f40, incl. the scope adjustment). Scoped re-review dispatched.
Final fix wave re-review: all findings addressed (49ca3e9..3317f40). Block complete.
