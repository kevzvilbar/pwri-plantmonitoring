-- =============================================================================
-- 20260912000003_ro_train_data_gaps_unique.sql
-- Fixes "log why" on the Operator Log's missing-hours badge always failing.
--
-- ROOT CAUSE
-- submitGapReason (hooks/useTrainLogActions.tsx) upserts into
-- ro_train_data_gaps with:
--   onConflict: 'train_id,source_table,gap_start_at'
-- but the table only ever had a PLAIN index on those columns
-- (idx_ro_train_data_gaps_lookup) — never a UNIQUE constraint. Postgres
-- rejects every such upsert with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification" (PostgREST error code 42P10)
-- so the dialog always showed an error and nothing was ever saved.
--
-- FIX: replace the plain lookup index with a UNIQUE constraint on exactly the
-- conflict target the app has always used (same columns, same order).
-- =============================================================================

-- Drop the old non-unique lookup index (the unique constraint provides its
-- own index for the same lookups, so nothing loses performance).
DROP INDEX IF EXISTS public.idx_ro_train_data_gaps_lookup;

-- Idempotent: do nothing if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_ro_train_data_gaps_gap'
      AND conrelid = 'public.ro_train_data_gaps'::regclass
  ) THEN
    -- Deduplicate any rows that already violate uniqueness (retries of the
    -- broken upsert could never insert, but an older path might have) by
    -- keeping the newest per (train_id, source_table, gap_start_at).
    DELETE FROM public.ro_train_data_gaps a
    USING public.ro_train_data_gaps b
    WHERE a.train_id = b.train_id
      AND a.source_table = b.source_table
      AND a.gap_start_at = b.gap_start_at
      AND a.id < b.id;

    ALTER TABLE public.ro_train_data_gaps
      ADD CONSTRAINT uq_ro_train_data_gaps_gap
      UNIQUE (train_id, source_table, gap_start_at);
  END IF;
END $$;
