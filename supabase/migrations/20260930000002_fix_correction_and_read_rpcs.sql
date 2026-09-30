-- =============================================================================
-- Migration: 20260930000002_fix_correction_and_read_rpcs.sql
-- Description:
--   1. DB-04: Hardens fn_approve_correction_request, fn_reject_correction_request,
--      and fn_cascade_reading_correction to derive reviewer identity from auth.uid(),
--      verify role + plant authorization, and log the real caller role.
--   2. DB-06: Restricts get_dashboard_aggregates, get_train_last_readings, and
--      latest_power_readings_before to only return data for plants the caller has access to.
--      Restricts alert recipient functions to service_role only.
--   3. DB-07: Hardens fn_set_product_meter_mirror to require manager/admin role.
-- =============================================================================

-- ── 1. DB-04: Secure Correction RPCs ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction(
  p_table "text",
  p_row_id "uuid",
  p_new_current numeric,
  p_admin_id "uuid",
  p_reason "text" DEFAULT 'Admin correction'::"text"
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $_$
DECLARE
  v_entity_col  TEXT;
  v_entity_id   UUID;
  v_plant_id    UUID;
  v_read_dt     TIMESTAMPTZ;
  v_old_current NUMERIC;
  v_old_prev    NUMERIC;
  v_next_id     UUID;
  v_caller_id   UUID := COALESCE(auth.uid(), p_admin_id);
  v_caller_role TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_entity_col := CASE p_table
    WHEN 'locator_readings'       THEN 'locator_id'
    WHEN 'well_readings'          THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
    ELSE NULL
  END;
  IF v_entity_col IS NULL THEN
    RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  EXECUTE format(
    'SELECT %I, plant_id, reading_datetime, current_reading, previous_reading FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_entity_id, v_plant_id, v_read_dt, v_old_current, v_old_prev
  USING p_row_id;

  IF v_plant_id IS NULL THEN
    RAISE EXCEPTION 'Row % not found in %', p_row_id, p_table;
  END IF;

  -- Authorization check: caller must be Manager, Analyst, or Admin on this plant
  IF NOT (
    public.is_manager_or_analyst_or_admin(v_caller_id)
    AND public.user_has_plant_access(v_plant_id, v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to cascade corrections on plant %', v_plant_id;
  END IF;

  -- Determine actual caller role
  SELECT COALESCE(
    (SELECT role::text FROM public.user_roles WHERE user_id = v_caller_id ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Manager' THEN 2 WHEN 'Data Analyst' THEN 3 ELSE 4 END LIMIT 1),
    'Operator'
  ) INTO v_caller_role;

  INSERT INTO raw_edit_log (source_table, source_id, column_name, old_value, new_value, edited_by, edited_role)
  VALUES (p_table, p_row_id, 'current_reading', v_old_current, p_new_current, v_caller_id, v_caller_role);

  EXECUTE format(
    'UPDATE %I SET current_reading = $1, daily_volume = $1 - COALESCE(previous_reading,0), norm_status = ''normalized'' WHERE id = $2',
    p_table
  ) USING p_new_current, p_row_id;

  EXECUTE format(
    'SELECT id, current_reading FROM %I WHERE %I = $1 AND plant_id = $2 AND reading_datetime > $3 AND norm_status NOT IN (''retracted'') ORDER BY reading_datetime ASC LIMIT 1',
    p_table, v_entity_col
  ) INTO v_next_id, v_old_prev USING v_entity_id, v_plant_id, v_read_dt;

  IF v_next_id IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I SET previous_reading = $1, daily_volume = current_reading - $1 WHERE id = $2',
      p_table
    ) USING p_new_current, v_next_id;
  END IF;

  INSERT INTO reading_normalizations (source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role)
  VALUES (p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason, v_caller_id, v_caller_role);

  RETURN jsonb_build_object('updated_id', p_row_id, 'old_value', v_old_current, 'new_value', p_new_current, 'cascade_id', v_next_id);
END;
$_$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(text, uuid, numeric, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_approve_correction_request(
  p_request_id uuid,
  p_reviewer_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_applied BOOLEAN := false;
  v_cascade_res JSONB;
  v_caller_id UUID := COALESCE(auth.uid(), p_reviewer_id);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_req
  FROM public.correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request % not found', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Correction request % is already %', p_request_id, v_req.status;
  END IF;

  -- Authorization check
  IF NOT (
    public.is_manager_or_analyst_or_admin(v_caller_id)
    AND public.user_has_plant_access(v_req.plant_id, v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to approve correction request for plant %', v_req.plant_id;
  END IF;

  IF v_req.source_table IN ('locator_readings', 'well_readings', 'product_meter_readings') THEN
    v_cascade_res := public.fn_cascade_reading_correction(
      v_req.source_table,
      v_req.source_id,
      v_req.proposed_value,
      v_caller_id,
      COALESCE(p_note, 'Approved correction request: ' || v_req.reason)
    );
    v_applied := true;
  END IF;

  UPDATE public.correction_requests
  SET status = 'approved',
      resolved_by = v_caller_id,
      resolved_at = now(),
      resolution_note = p_note
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'applied', v_applied,
    'request_id', p_request_id,
    'cascade_result', v_cascade_res
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_approve_correction_request(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_reject_correction_request(
  p_request_id uuid,
  p_reviewer_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_caller_id UUID := COALESCE(auth.uid(), p_reviewer_id);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_note IS NULL OR trim(p_note) = '' THEN
    RAISE EXCEPTION 'A reason is required to reject a correction request';
  END IF;

  SELECT * INTO v_req
  FROM public.correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request % not found', p_request_id;
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Correction request % is already %', p_request_id, v_req.status;
  END IF;

  -- Authorization check
  IF NOT (
    public.is_manager_or_analyst_or_admin(v_caller_id)
    AND public.user_has_plant_access(v_req.plant_id, v_caller_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to reject correction request for plant %', v_req.plant_id;
  END IF;

  IF v_req.source_table IN ('locator_readings', 'well_readings', 'product_meter_readings') THEN
    EXECUTE format(
      'UPDATE %I SET norm_status = ''normal'' WHERE id = $1 AND norm_status = ''pending_review''',
      v_req.source_table
    ) USING v_req.source_id;
  END IF;

  UPDATE public.correction_requests
  SET status = 'rejected',
      resolved_by = v_caller_id,
      resolved_at = now(),
      resolution_note = p_note
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'applied', false,
    'request_id', p_request_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reject_correction_request(uuid, uuid, text) TO authenticated, service_role;

-- ── 2. DB-06: Plant Access Checks in Read RPCs ──────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dashboard_aggregates(
  p_plant_ids         uuid[],
  p_today_start       timestamptz,
  p_today_end         timestamptz,
  p_yesterday_start   timestamptz,
  p_yesterday_end     timestamptz,
  p_today_date        date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw_water_today       numeric := 0;
  v_raw_water_yesterday   numeric := 0;
  v_consumption_today     numeric := 0;
  v_consumption_yesterday numeric := 0;
  v_production_today      numeric := 0;
  v_production_yesterday  numeric := 0;
  v_blending_today        numeric := 0;
  v_nrw_today             numeric := NULL;
  v_nrw_yesterday         numeric := NULL;
  v_by_plant              jsonb := '[]'::jsonb;
  v_authorized_ids        uuid[];
BEGIN
  -- Filter p_plant_ids to only authorized plants
  SELECT COALESCE(array_agg(p.id), '{}'::uuid[])
  INTO v_authorized_ids
  FROM unnest(COALESCE(p_plant_ids, '{}'::uuid[])) p(id)
  WHERE public.user_has_plant_access(p.id);

  IF v_authorized_ids IS NULL OR array_length(v_authorized_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'raw_water_vol', 0,
      'y_raw_water_vol', 0,
      'production', 0,
      'y_production', 0,
      'consumption', 0,
      'y_consumption', 0,
      'blending', 0,
      'nrw', NULL,
      'y_nrw', NULL,
      'by_plant', '[]'::jsonb
    );
  END IF;

  -- 1. Raw Water (well_readings)
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0)
  INTO v_raw_water_today, v_raw_water_yesterday
  FROM public.well_readings
  WHERE plant_id = ANY(v_authorized_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end
    AND (is_meter_replacement IS NOT TRUE);

  -- 2. Consumption (power_readings)
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_consumption_kwh, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_consumption_kwh, 0) ELSE 0 END), 0)
  INTO v_consumption_today, v_consumption_yesterday
  FROM public.power_readings
  WHERE plant_id = ANY(v_authorized_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end;

  -- 3. Production (product_meter_readings)
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0)
  INTO v_production_today, v_production_yesterday
  FROM public.product_meter_readings
  WHERE plant_id = ANY(v_authorized_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end
    AND (is_meter_replacement IS NOT TRUE);

  -- 4. Blending Today (blending_events)
  SELECT
    COALESCE(SUM(COALESCE(daily_volume, 0)), 0)
  INTO v_blending_today
  FROM public.blending_events
  WHERE plant_id = ANY(v_authorized_ids)
    AND event_date = p_today_date
    AND (is_meter_replacement IS NOT TRUE);

  -- 5. Per-plant breakdown
  WITH plant_scope AS (
    SELECT p.id AS plant_id, p.name AS plant_name, p.status
    FROM public.plants p
    WHERE p.id = ANY(v_authorized_ids)
  ),
  pw AS (
    SELECT plant_id,
      SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS rw_t,
      SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS rw_y
    FROM public.well_readings
    WHERE plant_id = ANY(v_authorized_ids)
      AND reading_datetime >= p_yesterday_start AND reading_datetime <= p_today_end
      AND (is_meter_replacement IS NOT TRUE)
    GROUP BY plant_id
  ),
  pp AS (
    SELECT plant_id,
      SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_consumption_kwh, 0) ELSE 0 END) AS con_t,
      SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_consumption_kwh, 0) ELSE 0 END) AS con_y
    FROM public.power_readings
    WHERE plant_id = ANY(v_authorized_ids)
      AND reading_datetime >= p_yesterday_start AND reading_datetime <= p_today_end
    GROUP BY plant_id
  ),
  pm AS (
    SELECT plant_id,
      SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS prod_t,
      SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS prod_y
    FROM public.product_meter_readings
    WHERE plant_id = ANY(v_authorized_ids)
      AND reading_datetime >= p_yesterday_start AND reading_datetime <= p_today_end
      AND (is_meter_replacement IS NOT TRUE)
    GROUP BY plant_id
  ),
  pb AS (
    SELECT plant_id,
      SUM(COALESCE(daily_volume, 0)) AS blend_t
    FROM public.blending_events
    WHERE plant_id = ANY(v_authorized_ids)
      AND event_date = p_today_date
      AND (is_meter_replacement IS NOT TRUE)
    GROUP BY plant_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'plant_id', ps.plant_id,
    'plant_name', ps.plant_name,
    'status', ps.status,
    'raw_water_vol', COALESCE(pw.rw_t, 0),
    'y_raw_water_vol', COALESCE(pw.rw_y, 0),
    'production', COALESCE(pm.prod_t, 0),
    'y_production', COALESCE(pm.prod_y, 0),
    'consumption', COALESCE(pp.con_t, 0),
    'y_consumption', COALESCE(pp.con_y, 0),
    'blending', COALESCE(pb.blend_t, 0)
  )), '[]'::jsonb)
  INTO v_by_plant
  FROM plant_scope ps
  LEFT JOIN pw ON pw.plant_id = ps.plant_id
  LEFT JOIN pp ON pp.plant_id = ps.plant_id
  LEFT JOIN pm ON pm.plant_id = ps.plant_id
  LEFT JOIN pb ON pb.plant_id = ps.plant_id;

  RETURN jsonb_build_object(
    'raw_water_vol', v_raw_water_today,
    'y_raw_water_vol', v_raw_water_yesterday,
    'production', v_production_today,
    'y_production', v_production_yesterday,
    'consumption', v_consumption_today,
    'y_consumption', v_consumption_yesterday,
    'blending', v_blending_today,
    'nrw', v_nrw_today,
    'y_nrw', v_nrw_yesterday,
    'by_plant', v_by_plant
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_aggregates(uuid[], timestamptz, timestamptz, timestamptz, timestamptz, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_train_last_readings(train_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
  v_authorized_train_ids uuid[];
BEGIN
  IF train_ids IS NULL OR array_length(train_ids, 1) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT COALESCE(array_agg(t.id), '{}'::uuid[])
  INTO v_authorized_train_ids
  FROM public.ro_trains t
  WHERE t.id = ANY(train_ids)
    AND public.user_has_plant_access(t.plant_id);

  IF v_authorized_train_ids IS NULL OR array_length(v_authorized_train_ids, 1) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  WITH ranked AS (
    SELECT
      r.train_id,
      r.reading_datetime,
      r.feed_pressure_psi,
      r.feed_flow,
      r.permeate_flow,
      r.recovery_pct,
      r.rejection_pct,
      r.dp_psi,
      ROW_NUMBER() OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime DESC) AS rn
    FROM public.ro_train_readings r
    WHERE r.train_id = ANY(v_authorized_train_ids)
  )
  SELECT COALESCE(
    jsonb_object_agg(
      train_id::text,
      jsonb_build_object(
        'reading_datetime', reading_datetime,
        'feed_pressure_psi', feed_pressure_psi,
        'feed_flow', feed_flow,
        'permeate_flow', permeate_flow,
        'recovery_pct', recovery_pct,
        'rejection_pct', rejection_pct,
        'dp_psi', dp_psi
      )
    ),
    '{}'::jsonb
  )
  INTO v_res
  FROM ranked
  WHERE rn = 1;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_train_last_readings(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.latest_power_readings_before(
  plant_ids uuid[],
  target_dt timestamptz
)
RETURNS TABLE (
  plant_id uuid,
  meter_reading_kwh numeric,
  reading_datetime timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authorized_ids uuid[];
BEGIN
  IF plant_ids IS NULL OR array_length(plant_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(p.id), '{}'::uuid[])
  INTO v_authorized_ids
  FROM unnest(plant_ids) p(id)
  WHERE public.user_has_plant_access(p.id);

  IF v_authorized_ids IS NULL OR array_length(v_authorized_ids, 1) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      pr.plant_id AS r_plant_id,
      pr.meter_reading_kwh AS r_kwh,
      pr.reading_datetime AS r_dt,
      ROW_NUMBER() OVER (PARTITION BY pr.plant_id ORDER BY pr.reading_datetime DESC) AS rn
    FROM public.power_readings pr
    WHERE pr.plant_id = ANY(v_authorized_ids)
      AND pr.reading_datetime < target_dt
      AND pr.meter_reading_kwh IS NOT NULL
  )
  SELECT r_plant_id, r_kwh, r_dt
  FROM ranked
  WHERE rn = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) TO authenticated, service_role;

-- Restrict edge function alert recipient queries to service_role only
REVOKE ALL ON FUNCTION public.get_offline_alert_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_offline_alert_recipients(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_push_alert_recipient_ids(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_alert_recipient_ids(uuid, text) TO service_role;

-- ── 3. DB-07: Hardened Mirror Setter ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_set_product_meter_mirror(
  p_meter_id uuid,
  p_derived_from_locator_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers and administrators can configure meter mirrors';
  END IF;

  UPDATE public.product_meters
     SET derived_from_locator_id = p_derived_from_locator_id,
         is_derived              = TRUE
   WHERE id = p_meter_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_meters row % not found', p_meter_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_set_product_meter_mirror(uuid, uuid) TO authenticated, service_role;
