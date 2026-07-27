-- =============================================================================
-- Migration: 20260720_recursive_cascade_and_meter_rollover.sql
-- Fixes two data-integrity gaps found in a follow-up audit of the Data
-- Corrections workflow:
--
-- 1. fn_cascade_reading_correction only repaired the SINGLE next reading's
--    previous_reading after a correction. In the common case (correcting one
--    isolated bad reading) that is sufficient, because only the immediate
--    next row's previous_reading depends on the corrected row's
--    current_reading. But real deployments can already have BROKEN chains
--    further downstream — from raw edits made via /data-analysis/edit-raw,
--    from regression-applied corrections (which write corrected_value
--    directly and never call this function at all), or from earlier manual
--    DB fixes — where previous_reading no longer matches the prior row's
--    current_reading for two or more consecutive links. This migration
--    replaces the single-hop fix with a bounded walk that keeps repairing
--    previous_reading / daily_volume forward until it reaches a link that
--    is already internally consistent (or runs out of rows), so a
--    correction actually heals the whole downstream chain, not just the
--    first link of it.
--
-- 2. Meter rollovers (mechanical odometer wraps, e.g. 99999 -> 00012) were
--    indistinguishable from data-entry backward readings: readingGuards.ts
--    flagged both as 'pending_review' with the same code path, and daily
--    volume for either case was clamped to 0 (GREATEST(0, current -
--    previous)), silently discarding real production on legitimate
--    rollover days. This adds `is_meter_rollover` and `meter_rollover_max`
--    columns to the three volumetric reading tables so a rollover can be
--    marked explicitly and its true delta computed as
--    (meter_max - previous) + current instead of clamped to zero.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Meter-rollover columns ────────────────────────────────────────────────
-- meter_rollover_max is the odometer's wrap point (e.g. 99999 for a 5-digit
-- mechanical counter). Stored per-reading (not looked up from the entity
-- config table) so the generated/derived daily_volume expression for
-- locator_readings — which can only reference columns on the same row —
-- has everything it needs without a cross-table lookup.

ALTER TABLE well_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

ALTER TABLE product_meter_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

-- locator_readings.daily_volume is GENERATED ALWAYS AS (current_reading -
-- COALESCE(previous_reading,0)) STORED with no rollover awareness AND no
-- floor at zero — a rollover previously produced a large *negative* daily
-- volume that fed straight into dashboards and NRW calculations. Add the
-- rollover columns, then rebuild the generated expression to be both
-- rollover-aware and floored at zero (matching the clamping already used
-- everywhere else in the app for this table's siblings).
ALTER TABLE locator_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

ALTER TABLE locator_readings DROP COLUMN IF EXISTS daily_volume;
ALTER TABLE locator_readings ADD COLUMN daily_volume NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN is_meter_rollover AND meter_rollover_max IS NOT NULL THEN
      GREATEST(0, (meter_rollover_max - COALESCE(previous_reading, 0)) + current_reading)
    ELSE
      GREATEST(0, current_reading - COALESCE(previous_reading, 0))
  END
) STORED;

COMMENT ON COLUMN well_readings.is_meter_rollover IS
  'True when current_reading < previous_reading because the mechanical meter wrapped around, not because of a data-entry error. Distinct from the pre-existing meter REPLACEMENT flow (new physical meter installed).';
COMMENT ON COLUMN well_readings.meter_rollover_max IS
  'The odometer wrap point for this reading (e.g. 99999). Used with is_meter_rollover to compute the true delta instead of clamping to zero.';

-- ── 2. fn_cascade_reading_correction — recursive downstream repair ──────────

DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction(
  p_table       TEXT,
  p_row_id      UUID,
  p_new_current NUMERIC,
  p_admin_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_col      TEXT;
  v_has_stored_vol  BOOLEAN;
  v_old_current     NUMERIC;
  v_prev_reading    NUMERIC;
  v_entity_id       UUID;
  v_reading_dt      TIMESTAMPTZ;
  v_new_daily_vol   NUMERIC;
  v_role            TEXT;

  -- Walk state for the recursive downstream repair.
  v_cursor_current  NUMERIC;      -- the "true" current_reading to propagate forward
  v_cursor_dt       TIMESTAMPTZ;  -- reading_datetime of the row we just fixed
  v_iter_id         UUID;
  v_iter_prev       NUMERIC;
  v_iter_current    NUMERIC;
  v_iter_dt         TIMESTAMPTZ;
  v_iter_rollover   BOOLEAN;
  v_iter_max        NUMERIC;
  v_iter_daily_vol  NUMERIC;
  v_cascade_ids     UUID[] := ARRAY[]::UUID[];
  v_hops            INT := 0;
  v_max_hops        CONSTANT INT := 500;  -- safety cap against runaway loops on corrupt data
BEGIN
  IF NOT (public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')) THEN
    RAISE EXCEPTION 'Not authorized to correct readings';
  END IF;

  IF p_table NOT IN ('locator_readings', 'well_readings', 'product_meter_readings', 'ro_train_readings') THEN
    RAISE EXCEPTION 'Unknown source table: %', p_table;
  END IF;

  IF p_table = 'ro_train_readings' THEN
    RAISE EXCEPTION 'ro_train_readings does not use the single-value cascade correction model';
  END IF;

  v_entity_col := CASE p_table
    WHEN 'locator_readings' THEN 'locator_id'
    WHEN 'well_readings' THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
  END;
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
  v_has_stored_vol := (p_table <> 'locator_readings');

  EXECUTE format(
    'SELECT current_reading, previous_reading, reading_datetime, %I FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_old_current, v_prev_reading, v_reading_dt, v_entity_id
  USING p_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reading % not found in %', p_row_id, p_table;
  END IF;

  IF v_has_stored_vol THEN
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, daily_volume = $2, norm_status = ''normalized'' WHERE id = $3',
      p_table
    ) USING p_new_current, v_new_daily_vol, p_row_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, norm_status = ''normalized'' WHERE id = $2',
      p_table
    ) USING p_new_current, p_row_id;
  END IF;

  -- ── Recursive cascade ────────────────────────────────────────────────────
  -- Walk forward link by link. At each hop, check whether the next row's
  -- previous_reading already matches the upstream current_reading we're
  -- propagating. If it does, the chain is consistent from here on and we
  -- stop — this is what makes a normal single-point correction terminate
  -- after exactly one hop, same as before. If it does NOT match (a
  -- pre-existing broken link further down the chain), fix it and keep
  -- walking using that row's own current_reading as the new cursor value.
  v_cursor_current := p_new_current;
  v_cursor_dt := v_reading_dt;

  LOOP
    v_hops := v_hops + 1;
    EXIT WHEN v_hops > v_max_hops;

    EXECUTE format(
      'SELECT id, previous_reading, current_reading, reading_datetime, is_meter_rollover, meter_rollover_max
         FROM %I WHERE %I = $1 AND reading_datetime > $2 ORDER BY reading_datetime ASC LIMIT 1',
      p_table, v_entity_col
    ) INTO v_iter_id, v_iter_prev, v_iter_current, v_iter_dt, v_iter_rollover, v_iter_max
    USING v_entity_id, v_cursor_dt;

    EXIT WHEN v_iter_id IS NULL;

    -- Chain is already consistent from this point on — nothing further to fix.
    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        v_iter_daily_vol := GREATEST(0, v_iter_current - v_cursor_current);
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      -- locator_readings: daily_volume is GENERATED and recomputes itself
      -- from previous_reading / is_meter_rollover / meter_rollover_max —
      -- only previous_reading needs writing here.
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

    -- This row's own current_reading is what the NEXT row's previous_reading
    -- must match, so it becomes the new cursor for the next iteration.
    v_cursor_current := v_iter_current;
    v_cursor_dt := v_iter_dt;
  END LOOP;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 ELSE 3 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object(
    'success', true,
    'cascade_id', v_cascade_ids[1],           -- kept for backward compatibility with existing callers
    'cascade_ids', to_jsonb(v_cascade_ids),
    'cascade_hops', array_length(v_cascade_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- ── 3. regression_results.truncated ──────────────────────────────────────────
-- run_regression() previously applied a hard 2 000-row .limit() with no way
-- for the caller to know the date range actually had more data than was
-- used. The service now fetches one row past the limit to detect this and
-- needs a column to persist the flag alongside each stored result.

ALTER TABLE regression_results
  ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN regression_results.truncated IS
  'True when the source date range had more rows than the regression row cap (see ROW_LIMIT in regression_service.py) — the fitted line only reflects the first ROW_LIMIT rows in chronological order.';

