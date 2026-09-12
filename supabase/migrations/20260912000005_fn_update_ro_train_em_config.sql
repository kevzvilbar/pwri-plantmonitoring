-- RO Train EM config update function with authorization checks
-- Can only be called by managers/admins of the plant

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
  v_is_manager boolean;
  v_is_admin boolean;
  v_user_id uuid := auth.uid();
  v_updates jsonb := '{}'::jsonb;
BEGIN
  -- Get the plant_id for this train
  SELECT plant_id INTO v_plant_id
  FROM public.ro_trains
  WHERE id = p_train_id;
  
  IF v_plant_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Train not found'
    );
  END IF;

  -- Check if user is admin (bypass plant check)
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    -- Check if user is a manager of this plant
    SELECT EXISTS (
      SELECT 1 FROM public.plant_managers
      WHERE plant_id = v_plant_id AND user_id = v_user_id
    ) INTO v_is_manager;

    IF NOT v_is_manager THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Insufficient permissions: must be plant manager or admin'
      );
    END IF;
  END IF;

  -- Build update JSON dynamically (only include non-null values)
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

  -- Perform the update
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

-- Grant execute to authenticated users (RLS/authorization handled inside function)
GRANT EXECUTE ON FUNCTION public.fn_update_ro_train_em_config(uuid, boolean, boolean, boolean, boolean, boolean) TO authenticated;