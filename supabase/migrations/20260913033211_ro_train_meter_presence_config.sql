-- RO Train per-train meter presence configuration
--
-- Adds 3 boolean columns to ro_trains so Plant Configuration can mark each
-- train as having a feed, permeate, and/or reject meter installed. All default
-- true so existing trains keep today's behavior (all meters visible) until
-- explicitly disabled per train.
--
-- This mirrors the existing per-train EM config pattern
-- (20260912000004_ro_train_em_meter_config.sql + fn_update_ro_train_em_config).
--
-- Used by:
--   - frontend/src/lib/trainMeterPresence.ts (trainMeterFlags helper)
--   - frontend/src/pages/plants/config/sections/RoTrainsMeterSection.tsx
--     (per-train meter presence table)
--   - frontend/src/pages/ROTrains/pretreatment/PretreatmentAndROLog.tsx
--     (per-train meter visibility in the reading form)

ALTER TABLE ro_trains
  ADD COLUMN has_feed_meter     boolean NOT NULL DEFAULT true,
  ADD COLUMN has_permeate_meter boolean NOT NULL DEFAULT true,
  ADD COLUMN has_reject_meter   boolean NOT NULL DEFAULT true;

-- No backfill needed: defaults preserve existing behavior.

-- ── Secure RPC ───────────────────────────────────────────────────────────────
-- Mirrors fn_update_ro_train_em_config: only non-null fields are written,
-- access is gated by public.user_has_ro_write_access(plant_id).

CREATE OR REPLACE FUNCTION public.fn_update_ro_train_meter_config(
  p_train_id           uuid,
  p_has_feed_meter     boolean DEFAULT NULL,
  p_has_permeate_meter boolean DEFAULT NULL,
  p_has_reject_meter   boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plant_id uuid;
  v_updates  jsonb := '{}'::jsonb;
BEGIN
  SELECT plant_id INTO v_plant_id
  FROM public.ro_trains
  WHERE id = p_train_id;

  IF v_plant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Train not found');
  END IF;

  IF NOT public.user_has_ro_write_access(v_plant_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient permissions: no RO write access for this plant'
    );
  END IF;

  IF p_has_feed_meter IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('has_feed_meter', p_has_feed_meter);
  END IF;
  IF p_has_permeate_meter IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('has_permeate_meter', p_has_permeate_meter);
  END IF;
  IF p_has_reject_meter IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('has_reject_meter', p_has_reject_meter);
  END IF;

  IF v_updates <> '{}'::jsonb THEN
    EXECUTE format(
      'UPDATE public.ro_trains SET %s WHERE id = $1',
      (
        SELECT string_agg(key || ' = ' || value::text, ', ')
        FROM jsonb_each_text(v_updates)
      )
    ) USING p_train_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'train_id', p_train_id,
    'updated_fields', v_updates
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_ro_train_meter_config(uuid, boolean, boolean, boolean) TO authenticated;
