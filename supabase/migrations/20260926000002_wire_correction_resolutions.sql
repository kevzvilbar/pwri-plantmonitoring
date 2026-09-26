-- =============================================================================
-- Migration: 20260926000002_wire_correction_resolutions.sql
-- Description:
--   1. Expands correction_requests_source_table_check to allow 'ro_pretreatment_readings'.
--   2. Implements atomic RPC functions fn_approve_correction_request and
--      fn_reject_correction_request that apply reading value cascades on approval
--      and reset norm_status on rejection.
-- =============================================================================

-- ── 1. Update source_table check constraint ─────────────────────────────────

ALTER TABLE public.correction_requests
  DROP CONSTRAINT IF EXISTS correction_requests_source_table_check;

ALTER TABLE public.correction_requests
  ADD CONSTRAINT correction_requests_source_table_check
  CHECK (source_table IN (
    'locator_readings',
    'well_readings',
    'product_meter_readings',
    'ro_train_readings',
    'ro_pretreatment_readings'
  ));

-- ── 2. Atomic Approval Function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_approve_correction_request(
  p_request_id uuid,
  p_reviewer_id uuid,
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
BEGIN
  -- 1. Re-select the correction_requests row FOR UPDATE and confirm status = 'pending'
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

  -- 2. If source_table in ('locator_readings', 'well_readings', 'product_meter_readings'), apply reading correction
  IF v_req.source_table IN ('locator_readings', 'well_readings', 'product_meter_readings') THEN
    v_cascade_res := public.fn_cascade_reading_correction(
      v_req.source_table,
      v_req.source_id,
      v_req.proposed_value,
      p_reviewer_id,
      COALESCE(p_note, 'Approved correction request: ' || v_req.reason)
    );
    v_applied := true;
  END IF;

  -- 3. Update correction_requests row
  UPDATE public.correction_requests
  SET status = 'approved',
      resolved_by = p_reviewer_id,
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

-- ── 3. Atomic Rejection Function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_reject_correction_request(
  p_request_id uuid,
  p_reviewer_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
BEGIN
  IF p_note IS NULL OR trim(p_note) = '' THEN
    RAISE EXCEPTION 'A reason is required to reject a correction request';
  END IF;

  -- 1. Re-select row FOR UPDATE and confirm status = 'pending'
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

  -- 2. For tables with norm_status, reset to 'normal'
  IF v_req.source_table IN ('locator_readings', 'well_readings', 'product_meter_readings') THEN
    EXECUTE format(
      'UPDATE %I SET norm_status = ''normal'' WHERE id = $1 AND norm_status = ''pending_review''',
      v_req.source_table
    ) USING v_req.source_id;
  END IF;

  -- 3. Update correction_requests row
  UPDATE public.correction_requests
  SET status = 'rejected',
      resolved_by = p_reviewer_id,
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

-- ── 4. Grants ───────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.fn_approve_correction_request(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_approve_correction_request(uuid, uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_reject_correction_request(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reject_correction_request(uuid, uuid, text) TO authenticated, service_role;
