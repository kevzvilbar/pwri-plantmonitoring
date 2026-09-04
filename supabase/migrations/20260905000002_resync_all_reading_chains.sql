-- =============================================================================
-- Migration: 20260905000002_resync_all_reading_chains.sql
--
-- Retroactively resync all previous_reading and daily_volume chains across
-- locator_readings, well_readings, and product_meter_readings.
--
-- Fixes historical rows (e.g. MCWD - M2 in June 2026) where previous_reading
-- was frozen at an old baseline (e.g. 824,631.0) causing massive cumulative
-- values to appear in the single-reading delta column.
-- =============================================================================

-- ── 1. LOCATOR READINGS RESYNC ───────────────────────────────────────────────
-- Only raw/cumulative locators (skip direct-mode where previous_reading is 0 by design).
WITH ranked_locators AS (
  SELECT
    lr.id,
    LAG(lr.current_reading) OVER (
      PARTITION BY lr.locator_id
      ORDER BY lr.reading_datetime ASC, lr.created_at ASC
    ) AS calculated_prev
  FROM public.locator_readings lr
  JOIN public.locators l ON l.id = lr.locator_id
  WHERE COALESCE(l.default_input_mode, 'raw') != 'direct'
    AND lr.current_reading IS NOT NULL
)
UPDATE public.locator_readings lr
SET previous_reading = rl.calculated_prev
FROM ranked_locators rl
WHERE lr.id = rl.id
  AND lr.previous_reading IS DISTINCT FROM rl.calculated_prev;

-- ── 2. WELL READINGS RESYNC ──────────────────────────────────────────────────
-- Only update rows where current_reading is present.
WITH ranked_wells AS (
  SELECT
    wr.id,
    LAG(wr.current_reading) OVER (
      PARTITION BY wr.well_id
      ORDER BY wr.reading_datetime ASC, wr.created_at ASC
    ) AS calculated_prev
  FROM public.well_readings wr
  WHERE wr.current_reading IS NOT NULL
)
UPDATE public.well_readings wr
SET previous_reading = rw.calculated_prev,
    daily_volume = CASE
      WHEN COALESCE(wr.is_meter_replacement, FALSE) THEN 0
      WHEN COALESCE(wr.is_meter_rollover, FALSE) AND wr.meter_rollover_max IS NOT NULL AND rw.calculated_prev IS NOT NULL THEN
        GREATEST(0, (wr.meter_rollover_max - rw.calculated_prev) + wr.current_reading)
      WHEN rw.calculated_prev IS NOT NULL THEN
        wr.current_reading - rw.calculated_prev
      ELSE
        wr.current_reading
    END
FROM ranked_wells rw
WHERE wr.id = rw.id
  AND (
    wr.previous_reading IS DISTINCT FROM rw.calculated_prev
    OR wr.daily_volume IS DISTINCT FROM (
      CASE
        WHEN COALESCE(wr.is_meter_replacement, FALSE) THEN 0
        WHEN COALESCE(wr.is_meter_rollover, FALSE) AND wr.meter_rollover_max IS NOT NULL AND rw.calculated_prev IS NOT NULL THEN
          GREATEST(0, (wr.meter_rollover_max - rw.calculated_prev) + wr.current_reading)
        WHEN rw.calculated_prev IS NOT NULL THEN
          wr.current_reading - rw.calculated_prev
        ELSE
          wr.current_reading
      END
    )
  );

-- ── 3. PRODUCT METER READINGS RESYNC ─────────────────────────────────────────
-- Only non-derived product meters (derived meters get current_reading/daily_volume from locators).
WITH ranked_product AS (
  SELECT
    pmr.id,
    LAG(pmr.current_reading) OVER (
      PARTITION BY pmr.meter_id
      ORDER BY pmr.reading_datetime ASC, pmr.created_at ASC
    ) AS calculated_prev
  FROM public.product_meter_readings pmr
  JOIN public.product_meters pm ON pm.id = pmr.meter_id
  WHERE COALESCE(pm.is_derived, FALSE) = FALSE
    AND (pmr.norm_status IS NULL OR pmr.norm_status <> 'retracted')
    AND pmr.current_reading IS NOT NULL
)
UPDATE public.product_meter_readings pmr
SET previous_reading = rp.calculated_prev,
    daily_volume = CASE
      WHEN COALESCE(pmr.is_meter_replacement, FALSE) THEN 0
      WHEN COALESCE(pmr.is_meter_rollover, FALSE) AND pmr.meter_rollover_max IS NOT NULL AND rp.calculated_prev IS NOT NULL THEN
        GREATEST(0, (pmr.meter_rollover_max - rp.calculated_prev) + pmr.current_reading)
      WHEN rp.calculated_prev IS NOT NULL THEN
        pmr.current_reading - rp.calculated_prev
      ELSE
        pmr.current_reading
    END
FROM ranked_product rp
WHERE pmr.id = rp.id
  AND (
    pmr.previous_reading IS DISTINCT FROM rp.calculated_prev
    OR pmr.daily_volume IS DISTINCT FROM (
      CASE
        WHEN COALESCE(pmr.is_meter_replacement, FALSE) THEN 0
        WHEN COALESCE(pmr.is_meter_rollover, FALSE) AND pmr.meter_rollover_max IS NOT NULL AND rp.calculated_prev IS NOT NULL THEN
          GREATEST(0, (pmr.meter_rollover_max - rp.calculated_prev) + pmr.current_reading)
        WHEN rp.calculated_prev IS NOT NULL THEN
          pmr.current_reading - rp.calculated_prev
        ELSE
          pmr.current_reading
      END
    )
  );
