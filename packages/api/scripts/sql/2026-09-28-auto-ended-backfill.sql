-- Auto-end backfill: única and parcelada billings that were already fully settled before the automatic end
-- existed move to "Encerradas", exactly as `billings/services/settlement.ts` would have moved them.
--
-- Run once, by hand, after the API that adds `billings.auto_ended_at` is deployed. Guarded by the same rule as the
-- service (active or paused, única or parcelada, nothing pending, something paid), so it is idempotent: a second
-- run touches nothing. Billings ended by hand stay as they are (no `auto_ended_at`).

-- What it will move, before moving it.
SELECT count(*) AS billings_to_end
FROM billings b
WHERE b.state IN ('active', 'paused')
  AND b.recurrence IN ('once', 'until')
  AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.billing_id = b.id AND c.state = 'pending')
  AND EXISTS (SELECT 1 FROM charges c WHERE c.billing_id = b.id AND c.state = 'paid');

BEGIN;

WITH ended AS (
  UPDATE billings b
  SET state = 'ended', auto_ended_at = now(), updated_at = now()
  WHERE b.state IN ('active', 'paused')
    AND b.recurrence IN ('once', 'until')
    AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.billing_id = b.id AND c.state = 'pending')
    AND EXISTS (SELECT 1 FROM charges c WHERE c.billing_id = b.id AND c.state = 'paid')
  RETURNING b.id
)
INSERT INTO events (id, type, eventable_type, eventable_id, payload, created_at)
SELECT gen_random_uuid(), 'billing.auto_ended', 'billing', ended.id, '{"via":"backfill"}', now()
FROM ended;

COMMIT;
