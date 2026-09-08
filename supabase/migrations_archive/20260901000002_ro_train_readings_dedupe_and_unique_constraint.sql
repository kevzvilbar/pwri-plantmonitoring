-- =============================================================================
-- Migration: 20260901000002_ro_train_readings_dedupe_and_unique_constraint.sql
--
-- CONTEXT: ro_train_readings previously lacked a database-level uniqueness
-- constraint on (train_id, reading_datetime), relying only on client-side
-- SELECT-then-write checks in submitROReadings.ts / TrainLogModal.tsx.
-- Under concurrent saves or re-submissions, duplicate rows were inserted for
-- the same train and timestamp.
--
-- This migration:
--   1. Deduplicates existing (train_id, reading_datetime) rows in
--      public.ro_train_readings, retaining the most recently created row
--      (highest created_at / id) in each collision group.
--   2. Adds a UNIQUE constraint on (train_id, reading_datetime) to prevent
--      future race-condition duplicates.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY train_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.ro_train_readings
  ),
  deleted AS (
    DELETE FROM public.ro_train_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'ro_train_readings dedupe: removed % duplicate row(s) for (train_id, reading_datetime)', dup_count;
END $$;

-- ── 2. Enforce constraint going forward ─────────────────────────────────────
ALTER TABLE public.ro_train_readings
  DROP CONSTRAINT IF EXISTS ro_train_readings_train_datetime_uniq;
ALTER TABLE public.ro_train_readings
  ADD CONSTRAINT ro_train_readings_train_datetime_uniq UNIQUE (train_id, reading_datetime);

NOTIFY pgrst, 'reload schema';

