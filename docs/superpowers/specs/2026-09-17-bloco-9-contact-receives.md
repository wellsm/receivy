# Bloco 9 — the receiving contact owns the billing side

Decisions taken on 2026-09-17 (owner + Claude), recorded here so the plan argues from them.

## Model

- `billings.contact_id` (nullable, → `contacts.id`) names **who receives**. `NULL` means the owner receives. No self-contact is ever created.
- **Who pays always lives in `allocations`** (`user_id` per part, the owner part carries the owner). One or many payers.
- `billings.type` is **derived**: `contact_id IS NULL → receivable`, otherwise `payable`. The column goes away.
- Pix leaves the billing. `payment_methods.contact_id` (nullable, → `contacts.id`) marks a key the owner keeps **about a contact** ("how I pay this person"). `NULL` keeps today's meaning: the owner's own key. `billings.payment_method_id` stays the single pointer, for either kind of key.
- `is_default` is scoped per `(owner_id, contact_id)`: one default among the owner's own keys, one default per contact.
- The unique index `(owner_id, pix_key_type, pix_key)` stays: the same key under two contacts is a mistake worth surfacing.
- A contact key is private to the owner by construction (`contacts` and `payment_methods` are `owner_id`-scoped). No payload that crosses to the other side may carry it.
- Every `counterpart_*` column goes away. A registro's "de quem" is a payer allocation; its "para quem" is `contact_id`. A registro counterpart with no account is a contact without e-mail (already supported: pending user).
- Charges keep their axis: `creditor_id = contact.user_id ?? owner_id`, `debtor_id = allocation.user_id`.

## Contract

- `BillingInput`: `contactId?` replaces `payeeUserId`; `counterpartLabel` and `type` go away; `pix?` stays and now means "the key of the receiving contact" — the API upserts it into that contact's `payment_methods` and points `paymentMethodId` at it.
- `BillingPatch`: `contactId?` / `clearContact?` replace `payeeUserId` / `clearPayee`; `counterpartLabel` goes away; `pix` / `clearPix` keep working through the contact key.
- `BillingSummary` / `BillingDetail`: `type` stays (derived); `payeeName` / `payee` / `counterpartLabel` become `contact: { id, userId, name, avatar } | null`; `BillingDetail.pix` stays, resolved from the payment method.
- `PaymentMethod`: gains `contactId: string | null`. `GET /payment-methods?contactId=` lists a contact's keys; without the parameter it lists the owner's own, so today's screens keep working.
- `GET /charges` (feed bench) adds `billing.contact` and `creditor`, so the feed names the counterpart by join.

## Deploy sequence (EZ4 lessons from block 8)

1. **D1** — add the two nullable columns, no relation lines. Nothing removed.
2. **D2** — add the two relation lines (`'contact_id@contact': 'contacts:id'`) with **no other change on those tables**. Separate deploy: `@ez4/pgmigration` 0.53 runs the tmp-FK dance twice when a relation and a column of the same table change together.
3. **Backfill SQL** (owner runs, listed in the plan).
4. **D3** — code reads only the new columns; old ones stay declared `@deprecated` with no reader.
5. **D4** — old columns leave the schema; EZ4 drops them.

Rollback before D4 is safe at every step: the old columns are still populated until D4.

## Out of scope

- Several keys per contact in the UI (the model already allows it).
- Creating a contact inline from the billing form: the picker offers existing contacts; new ones come from the contacts screen.
- The feed card actions (plan A of the feed session) — they land after this block, on the new payload.
