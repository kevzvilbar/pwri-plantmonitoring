-- =============================================================================
-- Migration: 20260723_manager_data_corrections_access.sql
--
-- src/pages/DataCorrections.tsx already gates its own UI on
--   isAdmin || isManager || isDataAnalyst
-- (see the "Access restricted" card in that file), and the sidebar/bottom-nav
-- link is now shown to Manager too. But the two things that actually enforce
-- write access underneath the page were never updated to match:
--
-- 1. fn_cascade_reading_correction (used by "Edit value" and "Approve
--    correction request") only allows Admin / Data Analyst. A Manager
--    hitting either action gets 'Not authorized to correct readings'.
-- 2. reading_normalizations — the append-only audit table that Pending /
--    Inbox / History all read from and write to directly (approve, reject,
--    retract) — only has RLS policies for Admin / Data Analyst. A Manager's
--    direct inserts/selects against that table are silently denied by RLS.
--
-- This migration adds 'Manager' to both, so Manager gets the same
-- correction/approve/reject/retract capability Admin and Data Analyst
-- already have — not just a view of the page.
--
-- Note: correction_requests (the table backing the "Inbox" tab / operator
-- submitted correction requests) is not created by any migration in this
-- repo — it was set up directly in the Supabase dashboard at some point, so
-- its current RLS can't be inspected or safely rewritten from here. It has a
-- plant_id column, so it most likely already follows the same
-- "*_plant_access" FOR ALL pattern as every other operational table (see
-- 20260419_initial_schema_enums_and_roles.sql), in which case Manager
-- already has read/update access via plant assignment and no change is
-- needed. If it turns out to have its own Admin/Data-Analyst-only policies,
-- apply the same fix as below to it directly in the Supabase SQL editor.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. fn_cascade_reading_correction — allow Manager ─────────────────────────
-- Redefinition is identical to the 20260720_recursive_cascade_and_meter_rollover.sql
-- version (recursive downstream repair), with Manager added to the role check.

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
  IF NOT (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
    OR public.has_role(auth.uid(), 'Manager')
  ) THEN
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
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 WHEN 'Manager' THEN 3 ELSE 4 END
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

-- ── 2. reading_normalizations RLS — allow Manager ────────────────────────────
-- Same policies as 20260514_normalization.sql, with Manager added.

DROP POLICY IF EXISTS "analyst_read_normalizations" ON reading_normalizations;
CREATE POLICY "analyst_read_normalizations"
  ON reading_normalizations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
      OR public.has_role(auth.uid(), 'Manager')
    )
  );

DROP POLICY IF EXISTS "analyst_insert_normalizations" ON reading_normalizations;
CREATE POLICY "analyst_insert_normalizations"
  ON reading_normalizations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
      OR public.has_role(auth.uid(), 'Manager')
    )
    AND performed_by = auth.uid()
  );

-- No UPDATE or DELETE — audit table stays append-only.

-- ── Done ──────────────────────────────────────────────────────────────────────
-- locator_readings / well_readings / product_meter_readings need no changes:
-- they're already covered by each table's blanket "<table>_plant_access" FOR ALL
-- policy (USING public.user_has_plant_access(plant_id)), which is role-agnostic —
-- any authenticated user assigned to the plant, Manager included, can already
-- UPDATE norm_status on those tables directly.
