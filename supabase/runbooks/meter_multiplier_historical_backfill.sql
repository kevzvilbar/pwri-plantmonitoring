-- =============================================================================
-- meter_multiplier_historical_backfill.sql
--
-- Backfill: correct historical multiplier_at_reading and daily_volume
-- for pre-20260926000001 readings that carry the column default (1).
--
-- =============================================================================
-- Context & Safety Rules:
-- 1. This is a two-step, human-reviewed process, NOT a blind auto-backfill.
--    Run `supabase/runbooks/meter_multiplier_historical_backfill_audit.sql` FIRST.
-- 2. Review the output, verify each entity and date range, and copy confirmed
--    (id, corrected_multiplier) pairs into the target_corrections allow-list below.
-- 3. Staging dry run + second reviewer sign-off are required before running in
--    production (see docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md Decision 4).
-- 4. Guard Clause: If you see a "division by zero" error in the output, that is
--    the safeguard WORKING AS DESIGNED (aborted transaction because updated row
--    count did not match allow-list count).
--
-- Run in: Supabase Dashboard -> SQL Editor, as an Admin.
-- =============================================================================

BEGIN;

-- 1. Bypass auto-populate override triggers to prevent them from overwriting
--    historical values back to today's live entity multiplier during updates.
ALTER TABLE public.locator_readings DISABLE TRIGGER trg_locator_reading_integrity;
ALTER TABLE public.well_readings DISABLE TRIGGER trg_well_reading_integrity;
ALTER TABLE public.product_meter_readings DISABLE TRIGGER trg_product_meter_reading_integrity;


-- ── LOCATOR READINGS CORRECTION ──────────────────────────────────────────────
-- trg_locator_readings_set_daily_volume remains ENABLED and will recompute
-- daily_volume automatically based on the updated multiplier_at_reading.
WITH target_corrections (id, corrected_multiplier) AS (
  VALUES
    -- Paste confirmed (id, multiplier) pairs from Phase 0 audit here.
    -- Example:
    -- ('00000000-0000-0000-0000-000000000000'::uuid, 10)
    (NULL::uuid, NULL::numeric) -- Placeholder: remove or replace with real pairs
),
valid_corrections AS (
  SELECT id, corrected_multiplier
  FROM target_corrections
  WHERE id IS NOT NULL AND corrected_multiplier IS NOT NULL
),
updated_locators AS (
  UPDATE public.locator_readings lr
     SET multiplier_at_reading = vc.corrected_multiplier,
         remarks = CASE
           WHEN lr.remarks IS NULL OR lr.remarks = ''
             THEN '[Multiplier Backfill ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '] corrected from ×' || lr.multiplier_at_reading || ' to ×' || vc.corrected_multiplier || ' — see docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md'
           ELSE lr.remarks || ' | [Multiplier Backfill ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '] corrected from ×' || lr.multiplier_at_reading || ' to ×' || vc.corrected_multiplier
         END
    FROM valid_corrections vc
   WHERE lr.id = vc.id
     AND lr.multiplier_at_reading IS DISTINCT FROM vc.corrected_multiplier
  RETURNING lr.id
)
-- Guard clause: fail transaction if row count doesn't match allow-list
SELECT CASE
  WHEN (SELECT count(*) FROM updated_locators) NOT IN (0, (SELECT count(*) FROM valid_corrections))
  THEN (SELECT 1/0)
END;


-- ── WELL READINGS CORRECTION ─────────────────────────────────────────────────
-- trg_well_readings_daily_volume remains ENABLED and will recompute
-- daily_volume automatically based on the updated multiplier_at_reading.
WITH target_corrections (id, corrected_multiplier) AS (
  VALUES
    (NULL::uuid, NULL::numeric) -- Placeholder: remove or replace with real pairs
),
valid_corrections AS (
  SELECT id, corrected_multiplier
  FROM target_corrections
  WHERE id IS NOT NULL AND corrected_multiplier IS NOT NULL
),
updated_wells AS (
  UPDATE public.well_readings wr
     SET multiplier_at_reading = vc.corrected_multiplier,
         remarks = CASE
           WHEN wr.remarks IS NULL OR wr.remarks = ''
             THEN '[Multiplier Backfill ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '] corrected from ×' || wr.multiplier_at_reading || ' to ×' || vc.corrected_multiplier || ' — see docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md'
           ELSE wr.remarks || ' | [Multiplier Backfill ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '] corrected from ×' || wr.multiplier_at_reading || ' to ×' || vc.corrected_multiplier
         END
    FROM valid_corrections vc
   WHERE wr.id = vc.id
     AND wr.multiplier_at_reading IS DISTINCT FROM vc.corrected_multiplier
  RETURNING wr.id
)
SELECT CASE
  WHEN (SELECT count(*) FROM updated_wells) NOT IN (0, (SELECT count(*) FROM valid_corrections))
  THEN (SELECT 1/0)
END;


-- ── PRODUCT METER READINGS CORRECTION ────────────────────────────────────────
-- fn_product_meter_reading_integrity computed daily_volume itself; since it
-- is disabled to prevent the multiplier override, we compute daily_volume here.
WITH target_corrections (id, corrected_multiplier) AS (
  VALUES
    (NULL::uuid, NULL::numeric) -- Placeholder: remove or replace with real pairs
),
valid_corrections AS (
  SELECT id, corrected_multiplier
  FROM target_corrections
  WHERE id IS NOT NULL AND corrected_multiplier IS NOT NULL
),
updated_products AS (
  UPDATE public.product_meter_readings pmr
     SET multiplier_at_reading = vc.corrected_multiplier,
         daily_volume = CASE
           WHEN COALESCE(pmr.is_meter_replacement, false) THEN 0
           WHEN COALESCE(pmr.is_meter_rollover, false) AND pmr.meter_rollover_max IS NOT NULL
             THEN GREATEST(0, (pmr.meter_rollover_max - COALESCE(pmr.previous_reading, 0) + pmr.current_reading) * vc.corrected_multiplier)
           ELSE GREATEST(0, (pmr.current_reading - COALESCE(pmr.previous_reading, 0)) * vc.corrected_multiplier)
         END,
         remarks = CASE
           WHEN pmr.remarks IS NULL OR pmr.remarks = ''
             THEN '[Multiplier Backfill ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '] corrected from ×' || pmr.multiplier_at_reading || ' to ×' || vc.corrected_multiplier || ' — see docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md'
           ELSE pmr.remarks || ' | [Multiplier Backfill ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '] corrected from ×' || pmr.multiplier_at_reading || ' to ×' || vc.corrected_multiplier
         END
    FROM valid_corrections vc
   WHERE pmr.id = vc.id
     AND pmr.multiplier_at_reading IS DISTINCT FROM vc.corrected_multiplier
  RETURNING pmr.id
)
SELECT CASE
  WHEN (SELECT count(*) FROM updated_products) NOT IN (0, (SELECT count(*) FROM valid_corrections))
  THEN (SELECT 1/0)
END;


-- ── PHASE 3: AUDIT TRAIL LOGGING ─────────────────────────────────────────────
-- Log one meter_events row per corrected entity recording the historical fix.
-- Replace the placeholders with the actual corrected entity details.
/*
INSERT INTO public.meter_events (
  entity_type,
  entity_id,
  plant_id,
  event_type,
  effective_at,
  old_reading_convention,
  new_multiplier,
  new_multiplier_enabled,
  performed_by,
  notes
) VALUES (
  'locator', -- 'locator' | 'well' | 'product_meter'
  '<entity_id>'::uuid,
  '<plant_id>'::uuid,
  'multiplier_cutover',
  now(),
  'raw',
  10,
  true,
  '<performing_user_id>'::uuid,
  'Historical backfill: corrected multiplier_at_reading from column default (1) to true value (10) for pre-20260926000001 readings, Jan 1 - Sept 26 2026. See docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md.'
);
*/


-- ── RE-ENABLE TRIGGERS ───────────────────────────────────────────────────────
ALTER TABLE public.locator_readings ENABLE TRIGGER trg_locator_reading_integrity;
ALTER TABLE public.well_readings ENABLE TRIGGER trg_well_reading_integrity;
ALTER TABLE public.product_meter_readings ENABLE TRIGGER trg_product_meter_reading_integrity;

COMMIT;
