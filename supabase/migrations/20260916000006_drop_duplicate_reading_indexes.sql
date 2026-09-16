-- =============================================================================
-- 20260916000006_drop_duplicate_reading_indexes.sql
-- Phase 1 of the reading-storage work: drop the byte-identical duplicate indexes
-- the 2026-09-11 migration squash left on the two hourly-written reading tables.
--
--   ro_train_readings
--     idx_rtr_train_dt  ≡  idx_ro_train_readings_train_id_reading_datetime
--                           both: (train_id, reading_datetime DESC)
--
--   ro_pretreatment_readings
--     ro_pretreatment_readings_train_id_dt_idx  ≡  idx_pretreatment_train_dt
--                           both: (train_id, reading_datetime DESC)
--     ro_pretreatment_readings_plant_id_idx     ≡  idx_ro_pretreatment_readings_plant_id
--                           both: (plant_id)
--
-- (verified in supabase/migrations/20260911044610_baseline_schema.sql at
--  lines 7796/7824, 7712/7944 and 7776/7940 respectively)
--
-- WHY THIS IS SAFE
--   Each pair has an identical definition, so the duplicate is a second full
--   copy of the same index: pure write amplification (every hourly INSERT
--   maintains both) plus permanent disk. Removing one member of an identical
--   pair cannot change any query's result set.
--
-- WHY IT IS THE ONLY IMMEDIATE SPACE WIN
--   DROP INDEX unlinks the index file, so the bytes go back to the OS at once —
--   unlike DELETE, which merely marks tuples dead and needs VACUUM FULL (and its
--   ACCESS EXCLUSIVE lock) to return anything.
--
-- LOCKING
--   DROP INDEX takes a brief ACCESS EXCLUSIVE lock on the table. Supabase
--   migrations run inside a transaction, so CONCURRENTLY is not available here;
--   apply in the same low-traffic window the existing sweeps use (~00:10 PHT —
--   see .github/workflows/backfill-missing-readings.yml).
--
-- RE-RUN / PARTIAL-APPLY SAFETY
--   Each drop runs ONLY while its twin still exists, so this can never leave a
--   table without that access path (e.g. if someone already dropped one copy by
--   hand, or a re-run happens after a partial failure). RAISE NOTICE reports what
--   actually happened.
--
-- PREREQUISITE
--   Confirm idx_scan = 0 for all four indexes first, via
--   public.fn_duplicate_index_report() or public.fn_reading_storage_report().
--   An exact-duplicate index still costs storage even when unused, so this is
--   safe either way — but the check confirms nothing interesting depends on it.
-- =============================================================================

DO $$
DECLARE
  v_dropped text[] := ARRAY[]::text[];
BEGIN
  -- ─ ro_train_readings ──────────────────────────────────────────────────────
  IF to_regclass('public.idx_rtr_train_dt') IS NOT NULL
     AND to_regclass('public.idx_ro_train_readings_train_id_reading_datetime') IS NOT NULL THEN
    DROP INDEX public.idx_rtr_train_dt;
    v_dropped := v_dropped || 'idx_rtr_train_dt'::text;
  END IF;

  -- ─ ro_pretreatment_readings ───────────────────────────────────────────────
  IF to_regclass('public.ro_pretreatment_readings_train_id_dt_idx') IS NOT NULL
     AND to_regclass('public.idx_pretreatment_train_dt') IS NOT NULL THEN
    DROP INDEX public.ro_pretreatment_readings_train_id_dt_idx;
    v_dropped := v_dropped || 'ro_pretreatment_readings_train_id_dt_idx'::text;
  END IF;

  IF to_regclass('public.ro_pretreatment_readings_plant_id_idx') IS NOT NULL
     AND to_regclass('public.idx_ro_pretreatment_readings_plant_id') IS NOT NULL THEN
    DROP INDEX public.ro_pretreatment_readings_plant_id_idx;
    v_dropped := v_dropped || 'ro_pretreatment_readings_plant_id_idx'::text;
  END IF;

  -- ── OPT-IN, NOT ENABLED ───────────────────────────────────────────────────
  -- idx_ro_pretreatment_readings_train_id (train_id) is prefix-redundant behind
  -- idx_pretreatment_train_dt (train_id, reading_datetime DESC) — any lookup
  -- that can use (train_id) alone can use the composite — but it is NOT a
  -- byte-identical duplicate, so it belongs to its own decision. Uncomment only
  -- after confirming idx_scan = 0 for it:
  --
  -- IF to_regclass('public.idx_ro_pretreatment_readings_train_id') IS NOT NULL
  --    AND to_regclass('public.idx_pretreatment_train_dt') IS NOT NULL THEN
  --   DROP INDEX public.idx_ro_pretreatment_readings_train_id;
  --   v_dropped := v_dropped || 'idx_ro_pretreatment_readings_train_id'::text;
  -- END IF;

  -- ── OPT-IN, NOT ENABLED ───────────────────────────────────────────────────
  -- idx_rtr_train_dt_covering (train_id, reading_datetime) INCLUDE
  -- (permeate_meter, feed_meter, reject_meter) can also satisfy the DESC
  -- ordering via a backward scan, so in principle it could replace
  -- idx_ro_train_readings_train_id_reading_datetime too. It is wider per entry,
  -- so that is a size-vs-width trade that must be decided from idx_scan and
  -- EXPLAIN, not guessed. Deliberately left out.

  RAISE NOTICE 'Dropped % duplicate index(es): %',
    coalesce(array_length(v_dropped, 1), 0), v_dropped;
END $$;