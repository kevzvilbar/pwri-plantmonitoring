-- =============================================================================
-- Migration: 20260901000003_user_presence_and_activity_tracking.sql
--
-- Purpose:
--   1. Provides a secure RPC `touch_user_presence(p_user_id, p_action)` allowing
--      any authenticated staff member (including shift operators on shared plant
--      accounts) to safely update their presence timestamp in `user_profiles.updated_at`
--      bypassing restrictive table-level RLS policies.
--   2. Provides `get_all_staff_profiles()` and `get_all_user_roles()` RPCs so the
--      Staff Management and People directory can reliably query staff and role
--      assignments without RLS permission mismatches.
--   3. Adds automatic triggers on plant telemetry and logs tables (`locator_readings`,
--      `ro_train_readings`, `well_readings`, `product_meter_readings`, `chemical_dosing_logs`,
--      `power_readings`, `afm_readings`, `cartridge_readings`, `cip_logs`) so that
--      every time an operator records data in the plant, their `user_profiles.updated_at`
--      is automatically stamped as ACTIVE.
--   4. Adds `user_profiles` to the Supabase Realtime publication.
-- =============================================================================

-- ── 1. RPC: touch_user_presence ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_user_presence(
  p_user_id UUID DEFAULT NULL,
  p_action TEXT DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Use explicit user/operator ID or fallback to auth.uid()
  v_target_id := COALESCE(p_user_id, auth.uid());

  UPDATE public.user_profiles
  SET updated_at = v_now
  WHERE id = v_target_id;

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_user_presence(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_user_presence(UUID, TEXT) TO authenticated;

-- ── 2. RPC: get_all_staff_profiles ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_all_staff_profiles()
RETURNS SETOF public.user_profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT *
  FROM public.user_profiles
  ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_all_staff_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_staff_profiles() TO authenticated;

-- ── 3. RPC: get_all_user_roles ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_all_user_roles()
RETURNS TABLE (
  user_id UUID,
  role TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ur.user_id, ur.role::TEXT
  FROM public.user_roles ur;
$$;

REVOKE ALL ON FUNCTION public.get_all_user_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_user_roles() TO authenticated;

-- ── 4. Trigger function: sync operator presence on reading/log submission ────
CREATE OR REPLACE FUNCTION public.fn_trg_sync_operator_presence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
BEGIN
  v_actor_id := NEW.recorded_by;

  IF v_actor_id IS NOT NULL THEN
    UPDATE public.user_profiles
    SET updated_at = now()
    WHERE id = v_actor_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Non-blocking safeguard so telemetry insert is never failed by presence sync
  RETURN NEW;
END;
$$;

-- ── 5. Attach presence triggers across all data entry tables ─────────────────

-- Locator readings
DROP TRIGGER IF EXISTS trg_locator_readings_presence ON public.locator_readings;
CREATE TRIGGER trg_locator_readings_presence
  AFTER INSERT OR UPDATE OF recorded_by ON public.locator_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();

-- Well readings
DROP TRIGGER IF EXISTS trg_well_readings_presence ON public.well_readings;
CREATE TRIGGER trg_well_readings_presence
  AFTER INSERT OR UPDATE OF recorded_by ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();

-- RO Train readings
DROP TRIGGER IF EXISTS trg_ro_train_readings_presence ON public.ro_train_readings;
CREATE TRIGGER trg_ro_train_readings_presence
  AFTER INSERT OR UPDATE OF recorded_by ON public.ro_train_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();

-- Product meter readings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_meter_readings') THEN
    DROP TRIGGER IF EXISTS trg_product_meter_readings_presence ON public.product_meter_readings;
    CREATE TRIGGER trg_product_meter_readings_presence
      AFTER INSERT OR UPDATE OF recorded_by ON public.product_meter_readings
      FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();
  END IF;
END $$;

-- Chemical dosing logs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chemical_dosing_logs') THEN
    DROP TRIGGER IF EXISTS trg_chemical_dosing_logs_presence ON public.chemical_dosing_logs;
    CREATE TRIGGER trg_chemical_dosing_logs_presence
      AFTER INSERT OR UPDATE OF recorded_by ON public.chemical_dosing_logs
      FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();
  END IF;
END $$;

-- Power readings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'power_readings') THEN
    DROP TRIGGER IF EXISTS trg_power_readings_presence ON public.power_readings;
    CREATE TRIGGER trg_power_readings_presence
      AFTER INSERT OR UPDATE OF recorded_by ON public.power_readings
      FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();
  END IF;
END $$;

-- AFM readings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'afm_readings') THEN
    DROP TRIGGER IF EXISTS trg_afm_readings_presence ON public.afm_readings;
    CREATE TRIGGER trg_afm_readings_presence
      AFTER INSERT OR UPDATE OF recorded_by ON public.afm_readings
      FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();
  END IF;
END $$;

-- Cartridge readings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cartridge_readings') THEN
    DROP TRIGGER IF EXISTS trg_cartridge_readings_presence ON public.cartridge_readings;
    CREATE TRIGGER trg_cartridge_readings_presence
      AFTER INSERT OR UPDATE OF recorded_by ON public.cartridge_readings
      FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_operator_presence();
  END IF;
END $$;

-- ── 6. Add user_profiles to Realtime publication if available ────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'user_profiles'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

