-- Meios de pagamento genéricos: pix_key_type/pix_key -> provider/kind/value, e o snapshot da charge
-- { method, type, value, label } -> { provider, kind, value, label }.
--
-- Run once, by hand, after D1 is deployed and immediately before D2 (D2 writes only the new columns and
-- the new snapshot shape). Every statement is guarded, so re-running is safe; run it again right before
-- D2 if charges were created in between.

BEGIN;

UPDATE payment_methods
   SET provider = 'pix', kind = pix_key_type, value = pix_key
 WHERE provider IS NULL AND pix_key IS NOT NULL;

UPDATE charges
   SET payment_snapshot = jsonb_strip_nulls(jsonb_build_object(
         'provider', 'pix',
         'kind', payment_snapshot->'type',
         'value', payment_snapshot->'value',
         'label', payment_snapshot->'label'))
 WHERE payment_snapshot ? 'method';

-- Any row here blocks D2: the new unique index on owner_id:provider:value would fail to create.
-- Archive or merge one of each pair's methods before deploying D2.
SELECT owner_id, value, count(*) AS rows
  FROM payment_methods
 WHERE value IS NOT NULL
 GROUP BY owner_id, value
HAVING count(*) > 1;

-- Sanity: both must be zero before D2.
SELECT count(*) AS methods_without_provider FROM payment_methods WHERE provider IS NULL;
SELECT count(*) AS charges_with_old_snapshot FROM charges WHERE payment_snapshot ? 'method';

COMMIT;
