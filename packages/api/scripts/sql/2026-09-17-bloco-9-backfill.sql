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
--     anyway. `payment_method_id` is pointed at the existing owner-owned row instead (`pixSnapshot`
--     accepts an explicit id regardless of scope). Counted by `keys_pointing_at_owner_key` below.
--
-- Run the whole thing inside BEGIN/ROLLBACK first and read the six sanity counters at the end.

BEGIN;

-- 1. Conta a pagar: the payee sits in the split as the one non-owner part. Point contact_id at the
--    owner's agenda entry for that user.
UPDATE billings b
SET contact_id = c.id
FROM allocations a
JOIN contacts c ON c.user_id = a.user_id
WHERE a.billing_id = b.id
  AND c.owner_id = b.owner_id
  AND b.type = 'payable'
  AND a.user_id <> b.owner_id
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

-- 2a. Payable registro: the label is who received.
UPDATE billings b
SET contact_id = c.id
FROM contacts c
JOIN users u ON u.id = c.user_id
WHERE b.kind = 'record' AND b.type = 'payable' AND b.counterpart_label IS NOT NULL
  AND btrim(b.counterpart_label) <> ''
  AND c.owner_id = b.owner_id AND u.name = btrim(b.counterpart_label)
  AND b.contact_id IS NULL;

-- 2b. Receivable registro: the label is who paid — an allocation, and the charges' debtor. A registro
--     whose label is NULL or blank has nobody to become the payer and is skipped on purpose (see
--     `receivable_registros_without_payer` below).
INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at)
SELECT gen_random_uuid(), b.id, c.user_id, 0, false, now()
FROM billings b
JOIN contacts c ON c.owner_id = b.owner_id
JOIN users u ON u.id = c.user_id AND u.name = btrim(b.counterpart_label)
WHERE b.kind = 'record' AND b.type = 'receivable' AND b.counterpart_label IS NOT NULL
  AND btrim(b.counterpart_label) <> ''
  AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id = c.user_id);

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
WITH keyed AS (
  SELECT b.id AS billing_id, b.owner_id, b.contact_id, b.pix_key_type, b.pix_key, COALESCE(b.pix_label, 'Pix') AS label
  FROM billings b
  WHERE b.pix_key IS NOT NULL AND b.contact_id IS NOT NULL
)
INSERT INTO payment_methods (id, owner_id, contact_id, type, pix_key_type, pix_key, label, is_default, created_at, updated_at)
SELECT DISTINCT ON (k.owner_id, k.pix_key_type, k.pix_key) gen_random_uuid(), k.owner_id, k.contact_id, 'pix', k.pix_key_type, k.pix_key, k.label, true, now(), now()
FROM keyed k
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods p WHERE p.owner_id = k.owner_id AND p.pix_key_type = k.pix_key_type AND p.pix_key = k.pix_key
);

UPDATE billings b
SET payment_method_id = p.id
FROM payment_methods p
WHERE p.owner_id = b.owner_id AND p.pix_key_type = b.pix_key_type AND p.pix_key = b.pix_key
  AND b.pix_key IS NOT NULL AND b.payment_method_id IS NULL;

-- 4. Only one default per contact scope (the DISTINCT ON above may leave a second key for the same contact).
UPDATE payment_methods p
SET is_default = false
WHERE p.contact_id IS NOT NULL
  AND p.id <> (
    SELECT id FROM payment_methods q
    WHERE q.owner_id = p.owner_id AND q.contact_id = p.contact_id AND q.archived_at IS NULL
    ORDER BY q.created_at ASC LIMIT 1
  );

-- 5. Payable split holds the owner alone from now on: the payee part leaves. Runs after step 1, which
--    still needs to read the payee's allocation row to resolve contact_id.
DELETE FROM allocations a
USING billings b
WHERE a.billing_id = b.id AND b.type = 'payable' AND a.user_id <> b.owner_id;

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at)
SELECT gen_random_uuid(), b.id, b.owner_id, 0, true, now()
FROM billings b
WHERE b.type = 'payable'
  AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id = b.owner_id);

-- 6. Sanity. The first three must be zero. The last two are informational counts to hand the owner,
--    not failures: see the header notes above.
SELECT
  (SELECT count(*) FROM billings WHERE type = 'payable' AND contact_id IS NULL) AS payable_without_contact,
  (SELECT count(*) FROM billings WHERE pix_key IS NOT NULL AND payment_method_id IS NULL) AS keyed_without_method,
  (SELECT count(*) FROM billings WHERE kind = 'record' AND counterpart_label IS NOT NULL AND contact_id IS NULL AND type = 'payable') AS registro_payable_without_contact,
  (SELECT count(*) FROM billings b
     WHERE b.kind = 'record' AND b.type = 'receivable'
       AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.billing_id = b.id AND a.user_id <> b.owner_id)
  ) AS receivable_registros_without_payer,
  (SELECT count(*) FROM billings b JOIN payment_methods p ON p.id = b.payment_method_id
     WHERE b.pix_key IS NOT NULL AND p.contact_id IS NULL
  ) AS keys_pointing_at_owner_key;

COMMIT;
