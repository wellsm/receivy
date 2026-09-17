-- Bloco 9 backfill: old shape -> new shape (contacts, contact-scoped payment_methods, owner-only payable splits,
-- one payer per registro a receber).
--
-- Run once, by hand, after D2 is deployed and before D3 (D3 stops writing the old columns and starts
-- reading only the new ones). Every statement is guarded (`IS NULL` / `NOT EXISTS`), so this script is
-- idempotent: it is safe to run again (e.g. to confirm nothing changed) or to re-run after a partial
-- failure.
--
-- What this does NOT do:
--   * It never invents a payer for a receivable registro whose `counterpart_label` is NULL or blank
--     (rows counted by `receivable_registros_without_payer` below). Those registros have no allocation
--     with a non-owner `user_id`, so any patch/reschedule on them fails the new normalizer (it requires
--     exactly one payer) until the owner edits the registro in the app and gives it one. This is
--     deliberate: the backfill must not guess who paid.
--   * A conta a pagar whose typed Pix key equals a key the owner already holds under `contact_id IS NULL`
--     (their own key) is never re-filed as a contact-scoped key: the unique index
--     `payment_methods_owner_id_pix_key_type_pix_key_uk` is on `(owner_id, pix_key_type, pix_key)` alone
--     (no `contact_id`), so a second row would violate it, and the app now answers 409 for that case
--     anyway. `payment_method_id` is pointed at the existing owner-owned row instead. Counted by
--     `keys_pointing_at_owner_key` below. ACT ON THESE: the app reads an explicit `payment_method_id`
--     only inside the billing's own scope, so a conta a pagar pointing at an owner-scoped key answers
--     "Chave Pix indisponível." on any edit that re-materializes its charges. The owner re-types the key
--     on that billing in the app (it is then filed under the contact) or archives the owner-scoped row.
--   * Two payables of the same owner filed under different contacts but carrying the same typed key
--     can only ever own one `payment_methods` row between them (same unique index as above). Step 3
--     picks one canonical row deterministically (earliest billing `created_at`, then billing `id`) and
--     points BOTH billings' `payment_method_id` at it — the other billing's `contact_id` and this row's
--     `contact_id` then disagree. Counted by `keys_shared_across_contacts` below. ACT ON THESE too, for
--     the same reason as above: the "losing" billing's key is out of its scope and reads as unavailable
--     until the owner re-types it on that billing.
--   * A typed key whose only matching `payment_methods` row is archived is never pointed at: step 3
--     leaves `payment_method_id` NULL (the unique index is not partial, so no second row can be
--     inserted for that key either). Those billings stay in `keyed_without_method`, which is a hard
--     stop; `keyed_billings_matching_archived_key` below says how many of them are this case.
--   * A registro label that matches more than one contact of the same owner (two contacts that happen
--     to share a `users.name`) resolves to exactly one of them, deterministically (earliest contact
--     `created_at`, then contact `id`) — never to both. Counted by `ambiguous_registro_labels` below.
--   * If a registro's `counterpart_label` happens to equal the owner's own name, step 2 still mints a
--     new pending user with that name (a namesake) — there is no contact linking an owner to
--     themselves, so this is expected, not a bug.
--
-- Run the whole thing inside BEGIN/ROLLBACK first and read the ten sanity counters at the end. The
-- first four must be zero; each has a listing query below it (run by hand) and a one-line cause. The
-- last six are informational counts to hand the owner, not failures — each also has a listing query.

BEGIN;

-- 0. Step 5 deletes the payee allocations step 1 reads, so a payable that carried more than one of them
--    can no longer be spotted once the script has run. Record them up front; the counter at the end
--    reads this temp table, which lives (and dies) with this transaction.
CREATE TEMP TABLE bloco9_multi_payee ON COMMIT DROP AS
SELECT b.id AS billing_id, b.owner_id, b.description, count(*) AS payees
FROM billings b
JOIN allocations a ON a.billing_id = b.id AND a.user_id <> b.owner_id
WHERE b.type = 'payable'
GROUP BY b.id, b.owner_id, b.description
HAVING count(*) > 1;

-- 1. Conta a pagar: the payee sits in the split as the one non-owner part. Point contact_id at the
--    owner's agenda entry for that user. A legacy payable may hold more than one non-owner part (the
--    old shape allowed a split); `DISTINCT ON` picks exactly one — lowest `sort_order`, tie-broken by
--    allocation id — instead of whichever row the planner happened to join first. The others are
--    counted by `payables_with_multiple_payees` below and dropped by step 5 like any payee part.
WITH payees AS (
  SELECT DISTINCT ON (a.billing_id) a.billing_id, c.id AS contact_id
  FROM allocations a
  JOIN billings b ON b.id = a.billing_id
  JOIN contacts c ON c.user_id = a.user_id AND c.owner_id = b.owner_id
  WHERE b.type = 'payable' AND a.user_id <> b.owner_id AND b.contact_id IS NULL
  ORDER BY a.billing_id, a.sort_order ASC, a.id ASC
)
UPDATE billings b
SET contact_id = p.contact_id
FROM payees p
WHERE p.billing_id = b.id
  AND b.contact_id IS NULL;

-- 2. Registro labels become contacts without e-mail (a pending user + agenda entry), one per
--    (owner, label) — but a label that already matches an existing contact's user name under the same
--    owner (any status: a pre-existing app contact, or one this script created on an earlier run) is
--    reused instead of inventing a second pending user.
WITH labels AS (
  SELECT DISTINCT owner_id, btrim(counterpart_label) AS label
  FROM billings
  WHERE kind = 'record' AND counterpart_label IS NOT NULL AND btrim(counterpart_label) <> ''
),
new_labels AS (
  -- One fresh id per (owner, label) generated up front and reused in both inserts below, so the two
  -- statements never have to re-match rows by name — which would misfile identically-named labels
  -- belonging to different owners (e.g. two owners both typing "Mãe").
  SELECT l.owner_id, l.label, gen_random_uuid() AS new_user_id
  FROM labels l
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts c JOIN users u ON u.id = c.user_id
    WHERE c.owner_id = l.owner_id AND u.name = l.label
  )
),
made_users AS (
  INSERT INTO users (id, name, status, locale, timezone, country, currency, created_at, updated_at)
  SELECT nl.new_user_id, nl.label, 'pending', 'pt-BR', u.timezone, 'BR', 'BRL', now(), now()
  FROM new_labels nl JOIN users u ON u.id = nl.owner_id
  RETURNING id
)
INSERT INTO contacts (id, owner_id, user_id, created_at, updated_at)
SELECT gen_random_uuid(), nl.owner_id, nl.new_user_id, now(), now()
FROM new_labels nl
WHERE nl.new_user_id IN (SELECT id FROM made_users);

-- 2a. Payable registro: the label is who received. `label_contacts` picks exactly one contact per
--     (owner, name) — the earliest created, tie-broken by id — so an owner with two contacts sharing a
--     name never gets an arbitrary match (see `ambiguous_registro_labels` below).
WITH label_contacts AS (
  SELECT DISTINCT ON (c.owner_id, u.name) c.owner_id, u.name, c.id AS contact_id
  FROM contacts c
  JOIN users u ON u.id = c.user_id
  ORDER BY c.owner_id, u.name, c.created_at ASC, c.id ASC
)
UPDATE billings b
SET contact_id = lc.contact_id
FROM label_contacts lc
WHERE b.kind = 'record' AND b.type = 'payable' AND b.counterpart_label IS NOT NULL
  AND btrim(b.counterpart_label) <> ''
  AND lc.owner_id = b.owner_id AND lc.name = btrim(b.counterpart_label)
  AND b.contact_id IS NULL;

-- 2b. Receivable registro: the label is who paid — an allocation, and the charges' debtor. Same
--     `label_contacts` tie-break as 2a, so an ambiguous label produces exactly one allocation, never
--     two. A registro whose label is NULL or blank has nobody to become the payer and is skipped on
--     purpose (see `receivable_registros_without_payer` below). `sort_order` picks the next free slot
--     instead of hardcoding 0 — the unique index is on `(billing_id, sort_order)`, not
--     `(billing_id, user_id)`, so 0 could already be taken.
WITH label_contacts AS (
  SELECT DISTINCT ON (c.owner_id, u.name) c.owner_id, u.name, c.user_id
  FROM contacts c
  JOIN users u ON u.id = c.user_id
  ORDER BY c.owner_id, u.name, c.created_at ASC, c.id ASC
)
INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at)
SELECT gen_random_uuid(), b.id, lc.user_id,
       COALESCE((SELECT max(x.sort_order) + 1 FROM allocations x WHERE x.billing_id = b.id), 0), false, now()
FROM billings b
JOIN label_contacts lc ON lc.owner_id = b.owner_id AND lc.name = btrim(b.counterpart_label)
WHERE b.kind = 'record' AND b.type = 'receivable' AND b.counterpart_label IS NOT NULL
  AND btrim(b.counterpart_label) <> ''
  AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id = lc.user_id);

UPDATE charges ch
SET debtor_id = a.user_id
FROM billings b
JOIN allocations a ON a.billing_id = b.id AND a.user_id <> b.owner_id
WHERE ch.billing_id = b.id AND b.kind = 'record' AND b.type = 'receivable' AND ch.debtor_id IS NULL;

-- 3. The key typed on a conta a pagar becomes the contact's payment method and the billing points at
--    it. When the owner already holds that exact (pix_key_type, pix_key) under their own scope
--    (contact_id IS NULL), the NOT EXISTS guard below skips the insert — the unique index forbids a
--    second row for the same (owner_id, pix_key_type, pix_key) regardless of contact_id — and the final
--    UPDATE points payment_method_id at that pre-existing owner-owned row instead.
--    Two separate statements on purpose: a single `WITH inserted AS (INSERT ...) UPDATE ... FROM
--    payment_methods` runs both parts against the same query snapshot, so the UPDATE's plain
--    `payment_methods` scan never sees the row `inserted` just created — it only ever matches a
--    pre-existing key. Splitting them lets the UPDATE run as its own statement, which does see what
--    the INSERT committed within this transaction.
--    The `DISTINCT ON` picks one billing's contact per (owner, key) deterministically — earliest
--    billing `created_at`, tie-broken by billing `id` — instead of an arbitrary row, because two
--    payables filed under different contacts can carry the same typed key (see
--    `keys_shared_across_contacts` below); whichever billing "wins" here decides which contact the new
--    payment_methods row belongs to, but the closing UPDATE still matches on (owner_id, pix_key_type,
--    pix_key) alone, so it points every billing sharing that key — including the "losing" one — at the
--    same single row.
WITH keyed AS (
  SELECT b.id AS billing_id, b.created_at AS billing_created_at, b.owner_id, b.contact_id, b.pix_key_type, b.pix_key,
         COALESCE(b.pix_label, 'Pix') AS label
  FROM billings b
  WHERE b.pix_key IS NOT NULL AND b.contact_id IS NOT NULL
)
INSERT INTO payment_methods (id, owner_id, contact_id, type, pix_key_type, pix_key, label, is_default, created_at, updated_at)
SELECT DISTINCT ON (k.owner_id, k.pix_key_type, k.pix_key) gen_random_uuid(), k.owner_id, k.contact_id, 'pix', k.pix_key_type, k.pix_key, k.label, true, now(), now()
FROM keyed k
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods p WHERE p.owner_id = k.owner_id AND p.pix_key_type = k.pix_key_type AND p.pix_key = k.pix_key
)
ORDER BY k.owner_id, k.pix_key_type, k.pix_key, k.billing_created_at ASC, k.billing_id ASC;

--    An archived key is never pointed at: the billing keeps `payment_method_id` NULL and shows up in
--    `keyed_without_method` (a hard stop) with `keyed_billings_matching_archived_key` explaining why.
--    The `NOT EXISTS` guard above deliberately stays blind to `archived_at`: the unique index is not
--    partial, so an archived row still owns that (owner, type, key) and a second insert would fail.
UPDATE billings b
SET payment_method_id = p.id
FROM payment_methods p
WHERE p.owner_id = b.owner_id AND p.pix_key_type = b.pix_key_type AND p.pix_key = b.pix_key
  AND p.archived_at IS NULL
  AND b.pix_key IS NOT NULL AND b.payment_method_id IS NULL;

-- 4. Only one default per contact scope (the DISTINCT ON above may leave a second key for the same
--    contact). Tie-broken by id too: every row this script inserts in one run shares the same `now()`.
--    Only scopes that actually hold two or more defaults are touched, so a re-run never demotes a
--    default the app or the owner elected after the first run.
UPDATE payment_methods p
SET is_default = false
WHERE p.contact_id IS NOT NULL
  AND p.is_default
  AND 1 < (
    SELECT count(*) FROM payment_methods d
    WHERE d.owner_id = p.owner_id AND d.contact_id = p.contact_id AND d.is_default
  )
  AND p.id <> (
    SELECT q.id FROM payment_methods q
    WHERE q.owner_id = p.owner_id AND q.contact_id = p.contact_id AND q.is_default
    ORDER BY q.created_at ASC, q.id ASC LIMIT 1
  );

-- 5. Payable split holds the owner alone from now on: the payee part leaves. Runs after step 1, which
--    still needs to read the payee's allocation row to resolve contact_id. `sort_order` picks the next
--    free slot rather than hardcoding 0, same reasoning as 2b.
DELETE FROM allocations a
USING billings b
WHERE a.billing_id = b.id AND b.type = 'payable' AND a.user_id <> b.owner_id;

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at)
SELECT gen_random_uuid(), b.id, b.owner_id,
       COALESCE((SELECT max(x.sort_order) + 1 FROM allocations x WHERE x.billing_id = b.id), 0), true, now()
FROM billings b
WHERE b.type = 'payable'
  AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id = b.owner_id);

-- 6. Sanity.
--
-- Must be zero:
--
--   SELECT id, owner_id, description FROM billings WHERE type = 'payable' AND contact_id IS NULL;
--   -- payable_without_contact: this bill names nobody who receives. There is no "conta a pagar without
--   -- a contact" in the new model: a bill that is the owner's alone is a conta a pagar to a contact
--   -- without an account — "Luz", "Aluguel", "Padaria". For each row the owner creates a contact for
--   -- whoever receives (a contact needs no e-mail: name alone is enough) and links it to the billing,
--   -- by hand here or by editing the billing in the app; then re-run. The alternative is to accept the
--   -- row as it is, and at D3 it reads as a conta a receber (type is derived: contact_id IS NULL means
--   -- receivable), which flips its direction in the feed and its totals.
--
--   SELECT id, owner_id, description FROM billings WHERE pix_key IS NOT NULL AND payment_method_id IS NULL;
--   -- keyed_without_method: step 3 only looks at billings that already have a contact_id — this is
--   -- almost always downstream of a payable_without_contact row above. Fix that first, then re-run.
--   -- The other cause is a key whose only payment_methods row is archived (see
--   -- `keyed_billings_matching_archived_key`): un-archive it in the app, or re-type the key on the
--   -- billing, then re-run.
--
--   SELECT id, owner_id, description FROM billings
--     WHERE kind = 'record' AND type = 'payable' AND counterpart_label IS NOT NULL AND contact_id IS NULL;
--   -- registro_payable_without_contact: step 2/2a could not match this label to any contact (check
--   -- for stray whitespace or punctuation the label CTE's btrim doesn't strip), then re-run.
--
--   SELECT ch.id, ch.owner_id, ch.description FROM charges ch
--     JOIN billings b ON b.id = ch.billing_id
--     JOIN contacts c ON c.id = b.contact_id
--     WHERE b.type = 'payable' AND ch.state = 'pending' AND ch.creditor_id IS DISTINCT FROM c.user_id;
--   -- payable_charges_creditor_mismatch: a pending charge's creditor was never the billing's payee (or
--   -- the payee changed after the charge was created). This backfill does not guess which is right —
--   -- the owner reconciles the charge or the billing's contact by hand, then re-run.
--
-- Informational (may be non-zero — see the header notes above for what each means):
--
--   SELECT id, owner_id, description FROM billings b
--     WHERE kind = 'record' AND type = 'receivable'
--       AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id <> b.owner_id);
--   -- receivable_registros_without_payer
--
--   SELECT b.id, b.owner_id, b.description FROM billings b
--     JOIN payment_methods p ON p.id = b.payment_method_id
--     WHERE b.pix_key IS NOT NULL AND p.contact_id IS NULL;
--   -- keys_pointing_at_owner_key
--
--   SELECT owner_id, pix_key_type, pix_key, array_agg(DISTINCT contact_id) AS contacts FROM billings
--     WHERE type = 'payable' AND pix_key IS NOT NULL AND contact_id IS NOT NULL
--     GROUP BY owner_id, pix_key_type, pix_key HAVING count(DISTINCT contact_id) > 1;
--   -- keys_shared_across_contacts
--
--   SELECT c.owner_id, u.name, array_agg(c.id) AS contacts FROM contacts c
--     JOIN users u ON u.id = c.user_id
--     GROUP BY c.owner_id, u.name HAVING count(*) > 1;
--   -- ambiguous_registro_labels (contacts sharing a name under the same owner; not every group here
--   -- necessarily has a registro pointed at it — cross-check against counterpart_label by hand)
--
--   SELECT * FROM bloco9_multi_payee;  -- inside this transaction, before COMMIT/ROLLBACK; standalone:
--   SELECT b.id, b.owner_id, b.description, count(*) AS payees FROM billings b
--     JOIN allocations a ON a.billing_id = b.id AND a.user_id <> b.owner_id
--     WHERE b.type = 'payable' GROUP BY b.id, b.owner_id, b.description HAVING count(*) > 1;
--   -- payables_with_multiple_payees: step 1 kept the lowest `sort_order` as the receiving contact and
--   -- step 5 dropped the rest. The owner checks these bills named the right person. Only the first run
--   -- ever reports them: by the second there are no payee allocations left to count.
--
--   SELECT b.id, b.owner_id, b.description FROM billings b
--     WHERE b.pix_key IS NOT NULL AND b.payment_method_id IS NULL
--       AND EXISTS (SELECT 1 FROM payment_methods p WHERE p.owner_id = b.owner_id
--                     AND p.pix_key_type = b.pix_key_type AND p.pix_key = b.pix_key
--                     AND p.archived_at IS NOT NULL);
--   -- keyed_billings_matching_archived_key: the only row holding this key is archived, so step 3 left
--   -- the billing without a method on purpose. These are a subset of keyed_without_method above.
SELECT
  (SELECT count(*) FROM billings WHERE type = 'payable' AND contact_id IS NULL) AS payable_without_contact,
  (SELECT count(*) FROM billings WHERE pix_key IS NOT NULL AND payment_method_id IS NULL) AS keyed_without_method,
  (SELECT count(*) FROM billings WHERE kind = 'record' AND counterpart_label IS NOT NULL AND contact_id IS NULL AND type = 'payable') AS registro_payable_without_contact,
  (SELECT count(*) FROM charges ch
     JOIN billings b ON b.id = ch.billing_id
     JOIN contacts c ON c.id = b.contact_id
     WHERE b.type = 'payable' AND ch.state = 'pending' AND ch.creditor_id IS DISTINCT FROM c.user_id
  ) AS payable_charges_creditor_mismatch,
  (SELECT count(*) FROM billings b
     WHERE b.kind = 'record' AND b.type = 'receivable'
       AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id <> b.owner_id)
  ) AS receivable_registros_without_payer,
  (SELECT count(*) FROM billings b JOIN payment_methods p ON p.id = b.payment_method_id
     WHERE b.pix_key IS NOT NULL AND p.contact_id IS NULL
  ) AS keys_pointing_at_owner_key,
  (SELECT count(*) FROM (
     SELECT owner_id, pix_key_type, pix_key FROM billings
     WHERE type = 'payable' AND pix_key IS NOT NULL AND contact_id IS NOT NULL
     GROUP BY owner_id, pix_key_type, pix_key HAVING count(DISTINCT contact_id) > 1
   ) shared
  ) AS keys_shared_across_contacts,
  (SELECT count(*) FROM (
     SELECT DISTINCT b.owner_id, btrim(b.counterpart_label) AS label
     FROM billings b
     WHERE b.kind = 'record' AND b.counterpart_label IS NOT NULL AND btrim(b.counterpart_label) <> ''
   ) registro_labels
   WHERE (
     SELECT count(*) FROM contacts c JOIN users u ON u.id = c.user_id
     WHERE c.owner_id = registro_labels.owner_id AND u.name = registro_labels.label
   ) > 1
  ) AS ambiguous_registro_labels,
  (SELECT count(*) FROM bloco9_multi_payee) AS payables_with_multiple_payees,
  (SELECT count(*) FROM billings b
     WHERE b.pix_key IS NOT NULL AND b.payment_method_id IS NULL
       AND EXISTS (
         SELECT 1 FROM payment_methods p
         WHERE p.owner_id = b.owner_id AND p.pix_key_type = b.pix_key_type AND p.pix_key = b.pix_key
           AND p.archived_at IS NOT NULL
       )
  ) AS keyed_billings_matching_archived_key;

COMMIT;
