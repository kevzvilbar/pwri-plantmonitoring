-- =============================================================================
-- 20260806153000_meter_rollover_backfill.sql
-- Backfill: mark missed meter rollovers + recompute their daily_volume
-- =============================================================================
-- Context: 20260720_recursive_cascade_and_meter_rollover.sql added
-- is_meter_rollover / meter_rollover_max and rollover-aware daily_volume, but
-- only for readings entered (or corrected) AFTER that migration ran, and only
-- on the path where the operator actually checked "meter rollover" at entry.
-- Rows saved before then — or saved after but without the box checked, then
-- waved through Pending Review — still have is_meter_rollover = false and
-- daily_volume clamped to 0 for that day, silently under-counting
-- production. (The History dialog's negative-Δ display bug and Pending
-- Review's missing "Mark as rollover" action are separate, already-patched
-- frontend issues — this script only touches stored data, and only for rows
-- that predate those fixes or otherwise slipped through before they were
-- classified as genuine rollovers.)
--
-- This is a two-step, human-reviewed process, NOT a blind auto-backfill:
-- a backward reading can also be a genuine data-entry error, and those must
-- NOT be marked as rollovers. Same reasoning as
-- 20260428_cleanup_bad_imports.sql's explicit target_names allow-list.
--
--   STEP 1 (below): read-only. Lists every backward-jump candidate across
--   well_readings / locator_readings / product_meter_readings with a guessed
--   meter_rollover_max (10^digits(previous_reading) - 0.01) and the daily_volume
--   that guess implies. Review each row against the actual meter's register
--   size before trusting the guess.
--
--   STEP 2 (bottom): guarded UPDATE. Copy the id(s) you've confirmed as real
--   rollovers from Step 1 into target_ids per table, double-check
--   confirmed_max against the physical meter, then run. Rows not listed are
--   left untouched. Idempotent — re-running after a row is fixed is a no-op
--   for that id.
--
-- Run this in: Supabase Dashboard → SQL Editor, as an Admin.
-- =============================================================================

-- ── STEP 1: Candidate audit (read-only — run this first, review the output) ──

SELECT
  'well_readings' AS source_table, wr.id, w.name AS entity_name,
  wr.reading_datetime, wr.previous_reading, wr.current_reading,
  wr.current_reading - wr.previous_reading AS naive_delta,
  wr.daily_volume AS stored_daily_volume,
  power(10, length(floor(wr.previous_reading)::text)) - 0.01 AS guessed_meter_max,
  GREATEST(0, round(
    (power(10, length(floor(wr.previous_reading)::text)) - 0.01) - wr.previous_reading + wr.current_reading
  )) AS guessed_daily_volume_if_rollover,
  wr.norm_status
FROM well_readings wr
JOIN wells w ON w.id = wr.well_id
WHERE wr.previous_reading IS NOT NULL
  AND wr.current_reading < wr.previous_reading
  AND wr.is_meter_rollover = false

UNION ALL

SELECT
  'locator_readings', lr.id, l.name,
  lr.reading_datetime, lr.previous_reading, lr.current_reading,
  lr.current_reading - lr.previous_reading,
  lr.daily_volume,
  power(10, length(floor(lr.previous_reading)::text)) - 0.01,
  GREATEST(0, round(
    (power(10, length(floor(lr.previous_reading)::text)) - 0.01) - lr.previous_reading + lr.current_reading
  )),
  lr.norm_status
FROM locator_readings lr
JOIN locators l ON l.id = lr.locator_id
WHERE lr.previous_reading IS NOT NULL
  AND lr.current_reading < lr.previous_reading
  AND lr.is_meter_rollover = false

UNION ALL

SELECT
  'product_meter_readings', pmr.id, pm.name,
  pmr.reading_datetime, pmr.previous_reading, pmr.current_reading,
  pmr.current_reading - pmr.previous_reading,
  pmr.daily_volume,
  power(10, length(floor(pmr.previous_reading)::text)) - 0.01,
  GREATEST(0, round(
    (power(10, length(floor(pmr.previous_reading)::text)) - 0.01) - pmr.previous_reading + pmr.current_reading
  )),
  pmr.norm_status
FROM product_meter_readings pmr
JOIN product_meters pm ON pm.id = pmr.meter_id
WHERE pmr.previous_reading IS NOT NULL
  AND pmr.current_reading < pmr.previous_reading
  AND pmr.is_meter_rollover = false

ORDER BY 1, 4 DESC;

-- Sanity check while reviewing Step 1's output:
--  - A real rollover's current_reading should look like an early reading for
--    that entity (small, near its historical minimum) and previous_reading
--    should sit close under guessed_meter_max.
--  - A data-entry error more often looks like a plausible mid-range value
--    with a digit dropped/transposed — guessed_daily_volume_if_rollover will
--    usually look implausibly large or small for that entity's normal flow.
--    Do NOT include those ids in Step 2.

-- ── STEP 2: Guarded backfill — only runs for ids you've confirmed ──────────
-- Fill in target_ids + confirmed_max per table (empty array = skip that
-- table entirely). confirmed_max should come from the physical meter's
-- actual register size, NOT copy-pasted blindly from Step 1's guess.

DO $$
DECLARE
  -- Example based on the Well 9 case (May 5, 2026): 6-digit register
  -- wrapping at 999999.99. Replace with the real id(s) + confirmed max.
  well_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];  -- e.g. ARRAY['00000000-0000-0000-0000-000000000000']
  well_confirmed_max CONSTANT NUMERIC := 999999.99;

  locator_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];
  locator_confirmed_max CONSTANT NUMERIC := 999999.99;

  product_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];
  product_confirmed_max CONSTANT NUMERIC := 999999.99;

  cnt BIGINT;
BEGIN
  IF array_length(well_target_ids, 1) IS NOT NULL THEN
    UPDATE well_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = well_confirmed_max,
           daily_volume       = GREATEST(0, round(well_confirmed_max - previous_reading + current_reading))
     WHERE id = ANY(well_target_ids)
       AND is_meter_rollover = false;   -- idempotent guard
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'well_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'well_readings: no target_ids set — skipped';
  END IF;

  IF array_length(locator_target_ids, 1) IS NOT NULL THEN
    UPDATE locator_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = locator_confirmed_max
           -- daily_volume is GENERATED ALWAYS AS on this table — Postgres
           -- recomputes it automatically from the two columns above.
     WHERE id = ANY(locator_target_ids)
       AND is_meter_rollover = false;
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'locator_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'locator_readings: no target_ids set — skipped';
  END IF;

  IF array_length(product_target_ids, 1) IS NOT NULL THEN
    UPDATE product_meter_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = product_confirmed_max,
           daily_volume       = GREATEST(0, round(product_confirmed_max - previous_reading + current_reading))
     WHERE id = ANY(product_target_ids)
       AND is_meter_rollover = false;
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'product_meter_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'product_meter_readings: no target_ids set — skipped';
  END IF;
END
$$;

-- Note: none of the three affected rows' downstream neighbors need repair
-- here — current_reading on the corrected row isn't changing, only
-- is_meter_rollover / meter_rollover_max / daily_volume on that single row,
-- so the next reading's previous_reading (already equal to this row's
-- current_reading) is untouched. fn_cascade_reading_correction is only
-- needed when current_reading itself is being changed.
