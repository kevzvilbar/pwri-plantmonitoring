-- =============================================================================
-- 20260916000002_train_status_log_no_identical_timestamps.sql
-- DB backstop against duplicate train_status_log rows for the same train at
-- the same instant — the writer-level root cause of the
--   "Offline Aug 19, 08:13 → Aug 19, 08:13 · 0m · back Online At"
-- zero-duration banner (RO_TRAIN_ALERT_SYSTEM_RECONCILIATION.md §3 layer 3).
--
-- ROOT CAUSE
-- Four independent app writers insert into train_status_log without
-- coordinating (auto-flagger, operator offline→online save, uptime
-- exemption, manager quick-toggle — the last had no guard at all). The
-- consolidated app writer (lib/trainStatusLogWriter.ts) + its per-writer
-- guards stop this at the source; this trigger is the belt-and-braces layer
-- so a slip-through of every app guard still can't reach the table.
--
-- FIX
-- A BEFORE INSERT OR UPDATE trigger rejects any row whose
-- (train_id, confirmed_at) already exists. SECURITY DEFINER so the existence
-- check can't be blinded by the table's RLS policy (a row the writer can't
-- SELECT must still block the write).
-- =============================================================================

-- 1. Clean up pre-existing duplicates so legit inserts after this migration
--    don't fail on a stale collision. Only exact duplicates
--    (same train, timestamp, AND status) are removed — those are unambiguous
--    double-writes. Rows sharing a timestamp but differing in status are kept
--    for human review: dropping either side would silently rewrite history,
--    and the display layer already collapses/degrades those gracefully.
DELETE FROM public.train_status_log a
USING public.train_status_log b
WHERE a.train_id = b.train_id
  AND a.confirmed_at = b.confirmed_at
  AND a.status = b.status
  AND a.ctid > b.ctid;

-- 2. The guard function.
CREATE OR REPLACE FUNCTION public.fn_reject_duplicate_train_status_ts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.train_status_log
    WHERE train_id = NEW.train_id
      AND confirmed_at = NEW.confirmed_at
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION
      'train_status_log already has a row for train % at confirmed_at % (duplicate transition)',
      NEW.train_id, NEW.confirmed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Attach to INSERT and to UPDATEs that move a row's timestamp/train
--    (the operator save backdates the open row's confirmed_at — that must
--    not be allowed to collide with a sibling row either).
DROP TRIGGER IF EXISTS trg_train_status_log_no_identical_ts ON public.train_status_log;
CREATE TRIGGER trg_train_status_log_no_identical_ts
  BEFORE INSERT OR UPDATE OF train_id, confirmed_at ON public.train_status_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reject_duplicate_train_status_ts();
