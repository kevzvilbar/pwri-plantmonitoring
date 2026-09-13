-- fn_update_ro_train_em_config was checking public.profiles / public.plant_managers,
-- neither of which exist in this schema (confirmed via information_schema — the real
-- user table is public.user_profiles, roles live in public.user_roles, and there is
-- no plant_managers table at all). Every call was failing live with
-- "relation \"public.profiles\" does not exist".
--
-- A prior fix (20260912000005 as last edited) swapped in public.user_roles but kept
-- role = 'admin' (the app_role enum values are capitalized: 'Admin', 'Manager', etc,
-- so this would trade one Postgres error for another - "invalid input value for enum
-- app_role") and still referenced the nonexistent plant_managers table for the
-- non-admin path.
--
-- Fix: delegate to public.user_has_ro_write_access(plant_id), the same access check
-- already gating RO train writes elsewhere in this app, instead of re-deriving
-- admin/manager status from scratch.

CREATE OR REPLACE FUNCTION public.fn_update_ro_train_em_config(
  p_train_id uuid,
  p_uses_em_meter boolean DEFAULT NULL,
  p_em_all_streams boolean DEFAULT NULL,
  p_em_stream_feed boolean DEFAULT NULL,
  p_em_stream_permeate boolean DEFAULT NULL,
  p_em_stream_reject boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plant_id uuid;
  v_updates jsonb := '{}'::jsonb;
BEGIN
  SELECT plant_id INTO v_plant_id
  FROM public.ro_trains
  WHERE id = p_train_id;

  IF v_plant_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Train not found'
    );
  END IF;

  IF NOT public.user_has_ro_write_access(v_plant_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient permissions: no RO write access for this plant'
    );
  END IF;

  IF p_uses_em_meter IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('uses_em_meter', p_uses_em_meter);
  END IF;
  IF p_em_all_streams IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('em_all_streams', p_em_all_streams);
  END IF;
  IF p_em_stream_feed IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('em_stream_feed', p_em_stream_feed);
  END IF;
  IF p_em_stream_permeate IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('em_stream_permeate', p_em_stream_permeate);
  END IF;
  IF p_em_stream_reject IS NOT NULL THEN
    v_updates := v_updates || jsonb_build_object('em_stream_reject', p_em_stream_reject);
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
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_ro_train_em_config(uuid, boolean, boolean, boolean, boolean, boolean) TO authenticated;
