-- =============================================================================
-- Migration: 20260908000005_005_backfill_and_hardening.sql
-- Baseline 005: Reading Backfill, Monotonicity & Security Hardening (Aug–Sept 2026)
-- Partition of baseline schema covering archived migrations #97 to #121
-- =============================================================================

-- >>>>>>> BEGIN ARCHIVED: 20260818000001_sync_user_roles_to_app_metadata.sql >>>>>>>
-- =============================================================================
-- Migration: 20260818020000_sync_user_roles_to_app_metadata.sql
--
-- Keeps auth.users.raw_app_meta_data->>'role' in sync with public.user_roles,
-- so the JWT's app_metadata (not user-editable, unlike user_metadata) always
-- reflects the app's real role source of truth. Applied live via Supabase
-- MCP on 2026-08-18; this file backfills it into migrations so main and the
-- live schema don't drift apart.
--
-- Closes the gap found in the 2026-08-18 review: supabase/functions/
-- data-analysis/index.ts was fixed (by a "v0" commit) to verify the JWT and
-- read app_metadata.role instead of the previously-trusted (and
-- client-forgeable) user_metadata.role -- but nothing had ever populated
-- app_metadata.role -- 0 of 36 users had it set, so the function would 403
-- every real user the moment anything called it. Verified live after
-- applying: 33/33 users with a user_roles row got the matching claim, 0
-- mismatches, and a live INSERT/DELETE test on a real user confirmed the
-- trigger fires both ways (and reverts cleanly), not just the one-time
-- backfill.
--
-- Priority when a user has more than one row in user_roles (schema allows
-- it via UNIQUE(user_id, role); no user currently has more than one, but
-- this is future-proofing): Admin > Data Analyst > Manager > Technician >
-- Operator. Mirrors useAuth.tsx's own precedence, where isManager/
-- isDataAnalyst are both "isAdmin OR roles.includes(...)" -- i.e. Admin is
-- already treated as a superset of Manager/Data-Analyst capabilities
-- everywhere else in the app, and data-analysis/index.ts's own
-- ALLOWED_ROLES (Admin, Data Analyst) / READ_ROLES (+ Manager) sets follow
-- the same shape.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_user_role_to_app_metadata(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role::text
    WHEN 'Admin' THEN 1
    WHEN 'Data Analyst' THEN 2
    WHEN 'Manager' THEN 3
    WHEN 'Technician' THEN 4
    WHEN 'Operator' THEN 5
    ELSE 6
  END
  LIMIT 1;

  IF v_role IS NULL THEN
    -- No role rows left for this user (all deleted) -- remove the claim
    -- entirely rather than leave a stale value; data-analysis/index.ts
    -- already treats a missing role as 'Staff' (no elevated access).
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) - 'role'
    WHERE id = _user_id;
  ELSE
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role)
    WHERE id = _user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_user_role_to_app_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_user_role_to_app_metadata(OLD.user_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.sync_user_role_to_app_metadata(NEW.user_id);
    -- user_id itself is editable in principle even though it's not
    -- expected in normal use -- re-sync the old owner too if it changed,
    -- so they don't keep a stale elevated claim.
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM public.sync_user_role_to_app_metadata(OLD.user_id);
    END IF;
    RETURN NEW;
  ELSE
    PERFORM public.sync_user_role_to_app_metadata(NEW.user_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_sync_app_metadata ON public.user_roles;
CREATE TRIGGER trg_user_roles_sync_app_metadata
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_user_role_to_app_metadata();

-- Backfill: sync every user who currently has a role row (the 0-of-36 gap).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.user_roles LOOP
    PERFORM public.sync_user_role_to_app_metadata(r.user_id);
  END LOOP;
END;
$$;

-- <<<<<<< END ARCHIVED: 20260818000001_sync_user_roles_to_app_metadata.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260818000002_enable_pgtap_for_rls_tests.sql >>>>>>>
-- =============================================================================
-- Migration: 20260818030000_enable_pgtap_for_rls_tests.sql
--
-- pgTAP for the RLS regression suite (2026-08-18 review, "the single
-- highest-leverage fix available"). Lives in the `extensions` schema,
-- matching this project's existing convention for pgcrypto/uuid-ossp/etc.
-- Test files live in supabase/tests/database/, Supabase CLI's conventional
-- location, run via `supabase test db` locally or in CI (see
-- .github/workflows/ci.yml's rls-tests job) against a disposable local
-- instance built from this repo's own migrations -- never against the
-- real project.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- <<<<<<< END ARCHIVED: 20260818000002_enable_pgtap_for_rls_tests.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260822000001_power_readings_meter_reading_kwh_nullable.sql >>>>>>>
-- =============================================================================
-- Migration: 20260822_power_readings_meter_reading_kwh_nullable.sql
--
-- BUG: "A required field is missing: 'meter reading kwh'. Please fill it in
-- and try again." — thrown when backfilling a power reading on a previous
-- date for a multi-meter plant, if the meter being saved first isn't meter 0
-- (e.g. only "Grid Meter 2 Pumphouse" has data for that historical date).
--
-- Root cause: power_readings.meter_reading_kwh was still NOT NULL from the
-- original single-meter schema. Once grid_meter_readings (JSONB, one entry
-- per meter) became the real source of truth for multi-meter plants,
-- meter_reading_kwh was kept only as a backward-compat mirror of meter 0 —
-- but the column constraint was never relaxed to match. A brand-new row
-- (no existing reading that day yet, which is exactly the backfill case)
-- for any meter other than meter 0 has nothing to put in that column, and
-- Postgres rejected the insert outright.
--
-- This was already the intended design elsewhere:
--   - fn_power_readings_before_upsert / fn_trg_recalc_successor: both
--     null-guard meter_reading_kwh before using it and prefer
--     grid_meter_readings when present.
--   - Frontend reads (useDashboardAggregates, useTrendChartData,
--     ReadingHistoryDialog, PowerMeters.tsx) already treat it as optional
--     (`!= null` checks / `??` fallbacks).
-- Only the column constraint itself was out of sync with that design.
-- =============================================================================

ALTER TABLE public.power_readings
  ALTER COLUMN meter_reading_kwh DROP NOT NULL;

COMMENT ON COLUMN public.power_readings.meter_reading_kwh IS
  'Legacy meter-0 cumulative kWh, kept for backward compatibility with dashboards, the CSV importer, and anything else not yet migrated to grid_meter_readings. Nullable since a multi-meter plant''s backfilled row may not include meter 0''s reading at all (e.g. only meters 2/3 entered) — grid_meter_readings is the source of truth. Every trigger reading this column already null-guards it (fn_power_readings_before_upsert, fn_trg_recalc_successor); this just aligns the column constraint with that existing design.';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260822000001_power_readings_meter_reading_kwh_nullable.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260823000001_ro_train_data_gaps.sql >>>>>>>
-- =============================================================================
-- Migration: 20260823_ro_train_data_gaps.sql
-- Hourly gap-reason logging for RO Train / Pre-Treatment operator readings.
--
-- Sibling to reading_gap_reasons (20260719_offline_reason_tracking.sql),
-- not an overload of it: reading_gap_reasons is DATE-grained (one row per
-- entity per day — "no reading at all today"), which can't represent
-- "operator missed the 11:00 hour but logged everything else that day".
-- This table is HOUR-RANGE-grained instead: one row per flagged span
-- (gap_start_at → gap_end_at), covering one or more consecutive missing
-- hourly buckets for a train, on either the RO or the Pre-Treatment tab.
--
-- Deliberately does NOT reuse the shared reason_category vocabulary used by
-- entity_status_audit_log / reading_gap_reasons (pump_problem, locked_meter,
-- etc.) for anything status-related — this table only ever answers "why was
-- this hour skipped while the train was Running", which is exactly the
-- REASON_CATEGORIES / ReasonDialog use case, so it reuses that vocabulary
-- as-is. RO-train OFFLINE reasons are a different, much richer, RO-specific
-- preset list already live in PretreatmentAndROLog.tsx's "Reason for
-- Offline" dropdown (Scheduled Maintenance, Membrane Replacement, CIP In
-- Progress, Power Outage, …) — that list is intentionally left alone and
-- keeps flowing into train_status_log.reason as free text; no schema change
-- needed there, and no attempt is made here to unify the two vocabularies.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

CREATE TABLE IF NOT EXISTS ro_train_data_gaps (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id        UUID        NOT NULL REFERENCES ro_trains(id) ON DELETE CASCADE,
  plant_id        UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  -- Which operator-log tab this gap was detected on. Matches the actual
  -- Supabase table names (not a shorthand) so the detector/hook can select
  -- straight off this column without a lookup table.
  source_table    TEXT        NOT NULL CHECK (source_table IN
                    ('ro_train_readings', 'ro_pretreatment_readings')),
  gap_start_at    TIMESTAMPTZ NOT NULL,
  gap_end_at      TIMESTAMPTZ NOT NULL,
  missed_hours    INT         NOT NULL CHECK (missed_hours > 0),
  reason_category TEXT        NOT NULL CHECK (reason_category IN
                    ('pump_problem', 'locked_meter', 'equipment_malfunction',
                     'maintenance', 'access_issue', 'other')),
  reason_detail   TEXT,
  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One reason per flagged span. If the detector re-runs and a span's exact
  -- boundaries shift (e.g. a later reading arrives and shrinks the gap), the
  -- upsert in the UI targets this key — see useTrainHourlyGaps.ts.
  UNIQUE (train_id, source_table, gap_start_at)
);

CREATE INDEX IF NOT EXISTS idx_ro_train_data_gaps_lookup
  ON ro_train_data_gaps (train_id, source_table, gap_start_at);
CREATE INDEX IF NOT EXISTS idx_ro_train_data_gaps_plant
  ON ro_train_data_gaps (plant_id, gap_start_at DESC);

ALTER TABLE ro_train_data_gaps ENABLE ROW LEVEL SECURITY;

-- Any operator with plant access may log/update these — same policy as
-- reading_gap_reasons and for the same reason: day-to-day operators are the
-- ones who actually know why an hour was missed, not just managers.
DROP POLICY IF EXISTS "ro_train_data_gaps_plant_access" ON ro_train_data_gaps;
CREATE POLICY "ro_train_data_gaps_plant_access" ON ro_train_data_gaps FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- <<<<<<< END ARCHIVED: 20260823000001_ro_train_data_gaps.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260831000001_reading_gap_reasons_add_product.sql >>>>>>>
-- =============================================================================
-- Migration: 20260831000001_reading_gap_reasons_add_product.sql
-- Extends reading_gap_reasons entity_type check to include 'product' meters.
-- =============================================================================

ALTER TABLE reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending', 'product'));

-- <<<<<<< END ARCHIVED: 20260831000001_reading_gap_reasons_add_product.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260831000002_security_hardening_search_paths.sql >>>>>>>
-- =============================================================================
-- Migration: 20260831000002_security_hardening_search_paths.sql
-- Security Hardening:
-- Sets explicit search_path on public SECURITY DEFINER database functions to
-- prevent search_path hijacking / injection (CWE-426 / CWE-427).
-- =============================================================================

-- Ensure search_path is locked on public SECURITY DEFINER helper functions
DO $$
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN
    SELECT n.nspname AS schema_name, p.proname AS func_name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp;',
        func_record.schema_name,
        func_record.func_name,
        func_record.args
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping search_path update on %.%(%): %',
        func_record.schema_name, func_record.func_name, func_record.args, SQLERRM;
    END;
  END LOOP;
END $$;

-- <<<<<<< END ARCHIVED: 20260831000002_security_hardening_search_paths.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260831000003_add_product_water_m3_compatibility_column.sql >>>>>>>
-- Add product_water_m3 alias/column to daily_plant_summary for full backward compatibility
ALTER TABLE public.daily_plant_summary
  ADD COLUMN IF NOT EXISTS product_water_m3 numeric;

-- Backfill product_water_m3 from production_m3 if null
UPDATE public.daily_plant_summary
  SET product_water_m3 = production_m3
  WHERE product_water_m3 IS NULL AND production_m3 IS NOT NULL;

-- Create or replace trigger to keep product_water_m3 and production_m3 in sync
CREATE OR REPLACE FUNCTION public.sync_daily_plant_summary_production()
RETURNS trigger AS $$
BEGIN
  IF NEW.production_m3 IS NOT NULL AND NEW.product_water_m3 IS NULL THEN
    NEW.product_water_m3 := NEW.production_m3;
  ELSIF NEW.product_water_m3 IS NOT NULL AND NEW.production_m3 IS NULL THEN
    NEW.production_m3 := NEW.product_water_m3;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dps_production ON public.daily_plant_summary;
CREATE TRIGGER trg_sync_dps_production
  BEFORE INSERT OR UPDATE ON public.daily_plant_summary
  FOR EACH ROW EXECUTE FUNCTION public.sync_daily_plant_summary_production();

-- <<<<<<< END ARCHIVED: 20260831000003_add_product_water_m3_compatibility_column.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260901000001_blending_compliance_insert_scope.sql >>>>>>>
-- =============================================================================
-- Migration: 20260901000001_blending_compliance_insert_scope.sql
--
-- Closes the RLS INSERT gap on blending_events and compliance_snapshots:
--
-- 1. blending_events:
--    The initial policy "analyst_write_blending_events" created in
--    20260515000001_supabase_only_and_data_analysis.sql had:
--      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--    This permitted ANY signed-in user to insert a blending event for ANY plant,
--    even plants they are not assigned to.
--    We drop "analyst_write_blending_events" and replace it with
--    "blending_events_insert" checking public.user_has_plant_access(plant_id).
--
-- 2. compliance_snapshots:
--    The initial policy "analyst_write_snapshots" created in
--    20260515000001_supabase_only_and_data_analysis.sql had:
--      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--    This permitted ANY signed-in user (including operators) to write
--    compliance snapshots.
--    We drop "analyst_write_snapshots" and replace it with
--    "compliance_snapshots_insert" checking that the caller has 'Admin' or
--    'Data Analyst' role, matching "admin_write_thresholds" on the sibling
--    compliance_thresholds table.
-- =============================================================================

-- ── 1. blending_events: drop over-permissive INSERT policy and add plant-scoped policy ──
DROP POLICY IF EXISTS "analyst_write_blending_events" ON public.blending_events;
DROP POLICY IF EXISTS "blending_events_insert" ON public.blending_events;

CREATE POLICY "blending_events_insert" ON public.blending_events
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 2. compliance_snapshots: drop over-permissive INSERT policy and add role-scoped policy ──
DROP POLICY IF EXISTS "analyst_write_snapshots" ON public.compliance_snapshots;
DROP POLICY IF EXISTS "compliance_snapshots_insert" ON public.compliance_snapshots;

CREATE POLICY "compliance_snapshots_insert" ON public.compliance_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
  );

-- ── 3. Reload PostgREST schema cache ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260901000001_blending_compliance_insert_scope.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260901000002_ro_train_readings_dedupe_and_unique_constraint.sql >>>>>>>
-- =============================================================================
-- Migration: 20260901000002_ro_train_readings_dedupe_and_unique_constraint.sql
--
-- CONTEXT: ro_train_readings previously lacked a database-level uniqueness
-- constraint on (train_id, reading_datetime), relying only on client-side
-- SELECT-then-write checks in submitROReadings.ts / TrainLogModal.tsx.
-- Under concurrent saves or re-submissions, duplicate rows were inserted for
-- the same train and timestamp.
--
-- This migration:
--   1. Deduplicates existing (train_id, reading_datetime) rows in
--      public.ro_train_readings, retaining the most recently created row
--      (highest created_at / id) in each collision group.
--   2. Adds a UNIQUE constraint on (train_id, reading_datetime) to prevent
--      future race-condition duplicates.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY train_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.ro_train_readings
  ),
  deleted AS (
    DELETE FROM public.ro_train_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'ro_train_readings dedupe: removed % duplicate row(s) for (train_id, reading_datetime)', dup_count;
END $$;

-- ── 2. Enforce constraint going forward ─────────────────────────────────────
ALTER TABLE public.ro_train_readings
  DROP CONSTRAINT IF EXISTS ro_train_readings_train_datetime_uniq;
ALTER TABLE public.ro_train_readings
  ADD CONSTRAINT ro_train_readings_train_datetime_uniq UNIQUE (train_id, reading_datetime);

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260901000002_ro_train_readings_dedupe_and_unique_constraint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260901000003_user_presence_and_activity_tracking.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260901000003_user_presence_and_activity_tracking.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260901000004_system_generated_reading_flags.sql >>>>>>>
-- =============================================================================
-- Migration: 20260901000004_system_generated_reading_flags.sql
--
-- Purpose:
--   Ensures `is_estimated` column is present across all reading / telemetry
--   tables: well_readings, blending_events, power_readings, ro_train_readings,
--   product_meter_readings, and locator_readings.
--
--   This flag identifies system-generated / backfilled / auto-estimated readings,
--   distinguishing them visually from operator entries and ensuring they are
--   excluded from operator accomplishment counts.
-- =============================================================================

DO $$
BEGIN
  -- 1. well_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'well_readings') THEN
    ALTER TABLE public.well_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 2. blending_events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blending_events') THEN
    ALTER TABLE public.blending_events ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 3. power_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'power_readings') THEN
    ALTER TABLE public.power_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.power_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 4. ro_train_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ro_train_readings') THEN
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS permeate_meter_delta NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS permeate_meter_prev NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS feed_meter_delta NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS feed_meter_prev NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS reject_meter_delta NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS reject_meter_prev NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS permeate_production_date DATE;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS power_meter_reading_kwh NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS power_delta_kwh NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS power_avg_kw NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS specific_energy_kwh_m3 NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS shared_power_meter_group TEXT;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS chlorine_residual_mg_l NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS incomplete_reason TEXT;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS remarks TEXT;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN DEFAULT false;
  END IF;

  -- 5. product_meter_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_meter_readings') THEN
    ALTER TABLE public.product_meter_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.product_meter_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 6. locator_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'locator_readings') THEN
    ALTER TABLE public.locator_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.locator_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Refresh ro_train_readings_latest view if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'ro_train_readings_latest') THEN
    CREATE OR REPLACE VIEW public.ro_train_readings_latest
    WITH (security_invoker = true) AS
    SELECT DISTINCT ON (train_id) *
    FROM public.ro_train_readings
    ORDER BY train_id, reading_datetime DESC;
  END IF;
END $$;

-- <<<<<<< END ARCHIVED: 20260901000004_system_generated_reading_flags.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260901000005_backfill_missing_readings.sql >>>>>>>
-- =============================================================================
-- Migration: 20260901000005_backfill_missing_readings.sql
--
-- Purpose:
--   1. Extends `reading_gap_reasons` CHECK constraint to include 'power'.
--   2. Creates `backfill_sweep_log` audit table.
--   3. Creates `fn_backfill_missing_readings(p_date, p_lookback_days)` RPC function
--      to automatically backfill bounded missing reading gaps across:
--        - locator_readings
--        - well_readings
--        - product_meter_readings
--        - blending_events
--        - power_readings
--        - ro_train_readings
--
-- Rules & Guards:
--   • Bounded gaps only (never forward project past the latest real reading).
--   • Even Δ distribution across short bounded gaps (≤ 5 days).
--   • Remarks exemption: skips dates that have an entry in `reading_gap_reasons`.
--   • Rollover / replacement respect: handles meter resets safely.
--   • Sets `is_estimated = true` on all generated/backfilled rows.
--   • Never overwrites operator entries (`is_estimated = false`).
-- =============================================================================

-- 1. Extend reading_gap_reasons entity_type check
ALTER TABLE public.reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE public.reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending', 'product', 'power'));

-- 2. Audit Table for backfill sweep executions
CREATE TABLE IF NOT EXISTS public.backfill_sweep_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name     TEXT NOT NULL,
  entity_fk_col  TEXT,
  entity_fk_val  UUID,
  plant_id       UUID REFERENCES public.plants(id) ON DELETE SET NULL,
  date_key       DATE NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('even_split', 'regression_flowrate')),
  old_value      NUMERIC,
  new_value      NUMERIC,
  changed        BOOLEAN NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backfill_sweep_log_table_date
  ON public.backfill_sweep_log (table_name, date_key DESC);

ALTER TABLE public.backfill_sweep_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backfill_sweep_log_auth" ON public.backfill_sweep_log;
CREATE POLICY "backfill_sweep_log_auth" ON public.backfill_sweep_log FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "backfill_sweep_log_anon" ON public.backfill_sweep_log;
CREATE POLICY "backfill_sweep_log_anon" ON public.backfill_sweep_log FOR ALL TO anon USING (true);

-- 3. Core Backfill Function
CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT CURRENT_DATE,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lookback      integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end    date := p_date;
  v_target_start  date := p_date - (v_lookback || ' days')::interval;
  v_swept_count   integer := 0;
  v_skipped_count integer := 0;
  v_retracted_count integer := 0;

  -- Iteration variables
  r_entity        RECORD;
  r_reading_a     RECORD;
  r_reading_b     RECORD;
  v_gap_days      integer;
  v_step          numeric;
  v_val           numeric;
  v_daily_vol     numeric;
  v_cur_date      date;
  v_dt_iso        timestamptz;
  v_has_reason    boolean;
  v_existing_id   uuid;
  v_is_est        boolean;
  v_old_val       numeric;
  v_diff          numeric;
BEGIN

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        -- Apply even-split backfill for bounded gaps 1..5 days
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              -- Only write within lookback window
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                -- Check remarks exemption
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- If there's now a remark for this date, retract any existing estimated reading
                  DELETE FROM public.locator_readings
                  WHERE locator_id = r_entity.id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  -- Check existing row
                  SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.locator_readings
                  WHERE locator_id = r_entity.id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val, previous_reading = ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2)
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.well_readings
                  WHERE well_id = r_entity.id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.well_readings
                  WHERE well_id = r_entity.id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, previous_reading = ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.product_meter_readings
                  WHERE meter_id = r_entity.id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.product_meter_readings
                  WHERE meter_id = r_entity.id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, previous_reading = ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, event_date AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND event_date >= (v_target_start - interval '7 days')::date
        AND event_date <= v_target_end
      ORDER BY event_date ASC
    LOOP
      SELECT id, raw_meter_reading, event_date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND event_date > r_reading_a.r_date
      ORDER BY event_date ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.blending_events
                  WHERE well_id = r_entity.id 
                    AND event_date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.blending_events
                  WHERE well_id = r_entity.id AND event_date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, reading_datetime::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.meter_reading_kwh - r_reading_a.meter_reading_kwh;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.power_readings
                  WHERE plant_id = r_entity.plant_id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.meter_reading_kwh + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, meter_reading_kwh INTO v_existing_id, v_is_est, v_old_val
                  FROM public.power_readings
                  WHERE plant_id = r_entity.plant_id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, daily_consumption_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val, daily_consumption_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAIN READINGS (ro_train_readings) — Orphan Purge
  -- ───────────────────────────────────────────────────────────────────────────
  -- When a real (non-estimated) reading is logged on a date that previously
  -- had only an estimated backfill, delete the estimated row to avoid duplicates.
  DELETE FROM public.ro_train_readings rtr
  WHERE is_estimated = true
    AND reading_datetime::date >= v_target_start
    AND reading_datetime::date <= v_target_end
    AND EXISTS (
      SELECT 1 FROM public.ro_train_readings rtr2
      WHERE rtr2.train_id = rtr.train_id
        AND rtr2.is_estimated = false
        AND rtr2.reading_datetime::date = rtr.reading_datetime::date
    );
  v_retracted_count := v_retracted_count + (SELECT changes());

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO anon;

-- <<<<<<< END ARCHIVED: 20260901000005_backfill_missing_readings.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260901000006_backfill_improvements_and_polish.sql >>>>>>>
-- =============================================================================
-- Migration: 20260901000006_backfill_improvements_and_polish.sql
--
-- Purpose:
--   1. Hardens RLS on `backfill_sweep_log` to authenticated-only read/write.
--   2. Updates `fn_backfill_missing_readings` with:
--      • Real rate-aware regression flowrate curve for gaps 6-14 days across
--        ALL 6 modules (locators, wells, product, blending, power, ro_train).
--      • Even split for gaps <= 5 days.
--      • Explicit `is_meter_rollover` check alongside `is_meter_replacement`.
--      • Retraction / cleanup of stale `is_estimated=true` rows when an operator
--        subsequently logs a `reading_gap_reasons` entry for that date.
--   3. Explicit schema reload notification (`NOTIFY pgrst, 'reload schema'`).
-- =============================================================================

-- 1. Tighten RLS on backfill_sweep_log
DROP POLICY IF EXISTS "backfill_sweep_log_anon" ON public.backfill_sweep_log;
DROP POLICY IF EXISTS "backfill_sweep_log_auth" ON public.backfill_sweep_log;
DROP POLICY IF EXISTS "backfill_sweep_log_select_auth" ON public.backfill_sweep_log;
DROP POLICY IF EXISTS "backfill_sweep_log_insert_auth" ON public.backfill_sweep_log;

-- Authenticated users can read audit logs
CREATE POLICY "backfill_sweep_log_select_auth"
  ON public.backfill_sweep_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Writes restricted to authenticated system operators / security definer
CREATE POLICY "backfill_sweep_log_insert_auth"
  ON public.backfill_sweep_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 2. Enhanced fn_backfill_missing_readings
CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT CURRENT_DATE,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lookback        integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end      date := p_date;
  v_target_start    date := p_date - (v_lookback || ' days')::interval;
  v_swept_count     integer := 0;
  v_skipped_count   integer := 0;
  v_retracted_count integer := 0;

  -- Iteration variables
  r_entity          RECORD;
  r_reading_a       RECORD;
  r_reading_b       RECORD;
  v_gap_days        integer;
  v_step            numeric;
  v_val             numeric;
  v_daily_vol       numeric;
  v_cur_date        date;
  v_dt_iso          timestamptz;
  v_has_reason      boolean;
  v_existing_id     uuid;
  v_is_est          boolean;
  v_old_val         numeric;
  v_diff            numeric;
  v_method          text;
  v_hist_rate       numeric;
  v_dpre            numeric;
  v_u               numeric;
  v_curvature       numeric;
BEGIN

  -- ─── Gap-fill thresholds ─────────────────────────────────────────────────────
  -- The two numeric literals used throughout this function are intentional
  -- constants that MUST be kept in sync with their TypeScript counterparts in
  -- frontend/src/lib/gapDetection.ts:
  --
  --   SQL literal 5   ↔  EVEN_SPLIT_THRESHOLD_DAYS = 5
  --     Gaps of ≤ 5 days use even delta split (linear interpolation).
  --
  --   SQL literal 14  ↔  MAX_GAP_BACKFILL_DAYS = 14
  --     Gaps of > 14 days are ignored entirely; the trailing-history
  --     lookback window is also 14 days (interval '14 days' subquery).
  --
  -- If either value is changed here, update BOTH exported constants in
  -- gapDetection.ts so the Data-Analysis gap-preview UI stays in agreement
  -- with what the automated sweep will actually compute.
  -- ─────────────────────────────────────────────────────────────────────────────

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ──────────────────────────────────────────���────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, event_date AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND event_date >= (v_target_start - interval '14 days')::date
        AND event_date <= v_target_end
      ORDER BY event_date ASC
    LOOP
      SELECT id, raw_meter_reading, event_date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND event_date > r_reading_a.r_date
      ORDER BY event_date ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(event_date), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND event_date < r_reading_a.r_date
                  AND event_date >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY event_date DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND event_date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, reading_datetime::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.meter_reading_kwh - r_reading_a.meter_reading_kwh;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.meter_reading_kwh - MIN(meter_reading_kwh)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT meter_reading_kwh, reading_datetime
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, meter_reading_kwh INTO v_existing_id, v_is_est, v_old_val
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.power_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.meter_reading_kwh + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.meter_reading_kwh + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, daily_consumption_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val, daily_consumption_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, reading_datetime::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, reading_datetime::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, anon, service_role;

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260901000006_backfill_improvements_and_polish.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260902000001_fix_backfill_timezone_and_cleanup_orphans.sql >>>>>>>
-- =============================================================================
-- Migration: 20260902000001_fix_backfill_timezone_and_cleanup_orphans.sql
--
-- Fixes timezone bucketing in fn_backfill_missing_readings and cleans up
-- duplicate/orphaned estimated readings.
--
-- PROBLEM:
--   1. PostgreSQL session timezone on Supabase defaults to UTC.
--   2. `reading_datetime::date` evaluated morning readings (e.g. 07:22 AM PHT)
--      as the PREVIOUS day in UTC (e.g. 23:22 UTC).
--   3. The backfill sweep therefore falsely assumed calendar dates were missing
--      a reading, and inserted an estimated reading at 12:00 PHT on that same date.
--   4. This created TWO readings on the same date (real morning reading + estimated noon reading),
--      causing delta calculations to produce negative readings (-5.85 m³).
--
-- SOLUTION:
--   1. Purge existing orphaned estimated rows where a real reading exists on the same Asia/Manila date.
--   2. In fn_backfill_missing_readings, enforce `SET timezone TO 'Asia/Manila'` and
--      explicitly cast all reading dates using `(reading_datetime AT TIME ZONE 'Asia/Manila')::date`.
--   3. Ensure real readings (`is_estimated = false`) are always prioritized in existing-row checks
--      (`ORDER BY COALESCE(is_estimated, false) ASC LIMIT 1`).
--   4. Add automatic pre-sweep purge of any orphaned estimated rows.
-- =============================================================================

-- ─── 1. Immediate Cleanup of Existing Orphaned Estimated Rows ─────────────────

DELETE FROM public.locator_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.locator_readings r
    WHERE r.locator_id = e.locator_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.well_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.well_readings r
    WHERE r.well_id = e.well_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.product_meter_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.product_meter_readings r
    WHERE r.meter_id = e.meter_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.blending_events e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.blending_events r
    WHERE r.well_id = e.well_id
      AND COALESCE(r.is_estimated, false) = false
      AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
  );

DELETE FROM public.power_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.power_readings r
    WHERE r.plant_id = e.plant_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.ro_train_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.ro_train_readings r
    WHERE r.train_id = e.train_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );


-- ─── 2. Updated fn_backfill_missing_readings ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'Asia/Manila'
AS $function$
DECLARE
  v_lookback        integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end      date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start    date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count     integer := 0;
  v_skipped_count   integer := 0;
  v_retracted_count integer := 0;
  v_purged_count    integer := 0;

  -- Iteration variables
  r_entity          RECORD;
  r_reading_a       RECORD;
  r_reading_b       RECORD;
  v_gap_days        integer;
  v_step            numeric;
  v_val             numeric;
  v_daily_vol       numeric;
  v_cur_date        date;
  v_dt_iso          timestamptz;
  v_has_reason      boolean;
  v_existing_id     uuid;
  v_is_est          boolean;
  v_old_val         numeric;
  v_diff            numeric;
  v_method          text;
  v_hist_rate       numeric;
  v_dpre            numeric;
  v_u               numeric;
  v_curvature       numeric;
BEGIN

  -- ─── 0. Purge Orphaned Estimated Rows ────────────────────────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.locator_readings r
          WHERE r.locator_id = e.locator_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'locator'
            AND gr.entity_id = e.locator_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.well_readings r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'well'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.product_meter_readings r
          WHERE r.meter_id = e.meter_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'product'
            AND gr.entity_id = e.meter_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.blending_events r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'blending'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.power_readings r
          WHERE r.plant_id = e.plant_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'power'
            AND gr.entity_id = e.plant_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.ro_train_readings r
          WHERE r.train_id = e.train_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'ro_train'
            AND gr.entity_id = e.train_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ─── Gap-fill thresholds ─────────────────────────────────────────────────────
  --   SQL literal 5   ↔  EVEN_SPLIT_THRESHOLD_DAYS = 5
  --   SQL literal 14  ↔  MAX_GAP_BACKFILL_DAYS = 14
  -- ─────────────────────────────────────────────────────────────────────────────

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
            AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date)), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date, reading_datetime
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) < r_reading_a.r_date
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.meter_reading_kwh - r_reading_a.meter_reading_kwh;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.meter_reading_kwh - MIN(meter_reading_kwh)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT meter_reading_kwh, reading_datetime
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, meter_reading_kwh INTO v_existing_id, v_is_est, v_old_val
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.power_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.meter_reading_kwh + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.meter_reading_kwh + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, daily_consumption_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val, daily_consumption_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, anon, service_role;

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260902000001_fix_backfill_timezone_and_cleanup_orphans.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000001_preserve_negative_reading_deltas.sql >>>>>>>
-- =============================================================================
-- Migration: 20260905000001_preserve_negative_reading_deltas.sql
--
-- Unclamp negative reading deltas across all meter modules:
-- 1. locators (locator_readings.daily_volume generated column)
-- 2. wells (fn_sync_well_reading_chain)
-- 3. product meters (fn_product_meter_reading_integrity, fn_sync_product_meter_reading_chain)
-- 4. blending (blending_events rollover columns, fn_blending_set_reading, fn_sync_blending_reading_chain)
-- 5. cascade reading correction (fn_cascade_reading_correction)
--
-- Erroneous drops (current < previous) will preserve negative deltas and remain
-- flagged / quarantined for supervisor review, rather than silently clamped to 0.
-- Mechanical rollovers and meter replacements continue to be handled with their
-- true wrap arithmetic and zero-baseline transitions respectively.
-- =============================================================================

-- ── 1. LOCATORS: rebuild daily_volume generated column without GREATEST(0, ...) ─
DROP VIEW IF EXISTS public.locator_readings_latest CASCADE;

ALTER TABLE public.locator_readings DROP COLUMN IF EXISTS daily_volume;
ALTER TABLE public.locator_readings ADD COLUMN daily_volume NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
    WHEN COALESCE(is_meter_rollover, FALSE) AND meter_rollover_max IS NOT NULL THEN
      GREATEST(0, (meter_rollover_max - COALESCE(previous_reading, 0)) + current_reading)
    ELSE
      current_reading - COALESCE(previous_reading, 0)
  END
) STORED;

CREATE OR REPLACE VIEW public.locator_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (locator_id) *
FROM public.locator_readings
WHERE norm_status IS NULL OR norm_status NOT IN ('retracted', 'pending_review')
ORDER BY locator_id, reading_datetime DESC;

GRANT SELECT ON public.locator_readings_latest TO authenticated, anon;

-- ── 2. WELLS: update fn_sync_well_reading_chain ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_well_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id           UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_id    UUID;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_successor_curr    NUMERIC;
  v_new_prev          NUMERIC;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT id, current_reading
      INTO v_predecessor_id, v_predecessor_read
      FROM public.well_readings
     WHERE well_id          = v_well_id
       AND reading_datetime < v_reading_dt
       AND current_reading IS NOT NULL
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.well_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN COALESCE(NEW.is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(NEW.is_meter_rollover, FALSE)
                                 AND NEW.meter_rollover_max IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN GREATEST(0, (NEW.meter_rollover_max - v_predecessor_read) + NEW.current_reading)
                                WHEN NEW.current_reading IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN NEW.current_reading - v_predecessor_read
                                WHEN NEW.current_reading IS NOT NULL
                                THEN NEW.current_reading
                                ELSE NULL
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max, current_reading
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax, v_successor_curr
    FROM public.well_readings
   WHERE well_id          = v_well_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.well_readings AS wr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, (v_successor_rollmax - v_new_prev) + wr.current_reading)
                                WHEN wr.current_reading IS NOT NULL
                                 AND v_new_prev IS NOT NULL
                                THEN wr.current_reading - v_new_prev
                                WHEN wr.current_reading IS NOT NULL
                                THEN wr.current_reading
                                ELSE NULL
                              END
     WHERE wr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

-- ── 3. PRODUCT METERS: unclamp daily_volume in integrity & chain triggers ─────
CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading           NUMERIC;
  v_prev_dt                TIMESTAMPTZ;
  v_computed_vol           NUMERIC;
  v_flow_rate               NUMERIC;
  v_avg_flow_rate           NUMERIC;
  v_is_derived              BOOLEAN;
  v_resolving_from_pending  BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_resolving_from_pending := (OLD.norm_status = 'pending_review');
  END IF;

  SELECT is_derived INTO v_is_derived
  FROM   product_meters
  WHERE  id = NEW.meter_id;

  IF COALESCE(v_is_derived, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   product_meter_readings
  WHERE  meter_id  = NEW.meter_id
    AND  plant_id  = NEW.plant_id
    AND  (norm_status IS NULL OR norm_status <> 'retracted')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_replacement, FALSE) THEN
    NEW.daily_volume := 0;
  ELSIF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := NEW.current_reading - COALESCE(v_prev_reading, 0);
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_resolving_from_pending
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    DECLARE v_hrs NUMERIC := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;
    BEGIN
      IF v_hrs > 0 THEN
        v_flow_rate := v_computed_vol / v_hrs;
        SELECT AVG(sub.fr) INTO v_avg_flow_rate FROM (
          SELECT (current_reading - previous_reading)
                 / NULLIF(EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0, 0) AS fr
          FROM   product_meter_readings
          WHERE  meter_id = NEW.meter_id AND plant_id = NEW.plant_id
            AND  norm_status = 'normal'
            AND  reading_datetime >= NOW() - INTERVAL '7 days'
            AND  reading_datetime < NEW.reading_datetime
            AND  previous_reading IS NOT NULL
            AND  current_reading  > previous_reading
        ) sub WHERE sub.fr > 0;

        IF v_avg_flow_rate IS NOT NULL
           AND v_flow_rate > v_avg_flow_rate * 2.0
           AND NEW.norm_status = 'normal'
           AND NOT v_resolving_from_pending
        THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_product_meter_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meter_id          UUID;
  v_plant_id          UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_is_derived        BOOLEAN;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_new_prev          NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_meter_id   := OLD.meter_id;
    v_plant_id   := OLD.plant_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_meter_id   := NEW.meter_id;
    v_plant_id   := NEW.plant_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  SELECT is_derived INTO v_is_derived FROM public.product_meters WHERE id = v_meter_id;
  IF COALESCE(v_is_derived, FALSE) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT current_reading INTO v_predecessor_read
      FROM public.product_meter_readings
     WHERE meter_id         = v_meter_id
       AND plant_id         = v_plant_id
       AND reading_datetime < v_reading_dt
       AND (norm_status IS NULL OR norm_status <> 'retracted')
       AND id <> NEW.id
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.product_meter_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(is_meter_rollover, FALSE)
                                 AND meter_rollover_max IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN GREATEST(0, meter_rollover_max - v_predecessor_read + current_reading)
                                ELSE current_reading - COALESCE(v_predecessor_read, 0)
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax
    FROM public.product_meter_readings
   WHERE meter_id         = v_meter_id
     AND plant_id         = v_plant_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.product_meter_readings AS pmr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, v_successor_rollmax - v_new_prev + pmr.current_reading)
                                ELSE pmr.current_reading - COALESCE(v_new_prev, 0)
                              END
     WHERE pmr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

-- ── 4. BLENDING: add rollover columns & unclamp volume_m3 in triggers ─────────
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

CREATE OR REPLACE FUNCTION public.fn_blending_set_reading()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_meter_reading IS NULL THEN
    RAISE EXCEPTION 'blending_events.raw_meter_reading is required — blending wells are meter-fed, direct volume entry is not supported';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.previous_reading IS NULL THEN
    SELECT raw_meter_reading INTO NEW.previous_reading
    FROM public.blending_events
    WHERE well_id = NEW.well_id
      AND id <> NEW.id
      AND (event_date < NEW.event_date
           OR (event_date = NEW.event_date AND reading_datetime IS NOT NULL
               AND NEW.reading_datetime IS NOT NULL AND reading_datetime < NEW.reading_datetime))
    ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF NEW.is_meter_replacement THEN
    NEW.volume_m3 := 0;
  ELSIF NEW.is_meter_rollover AND NEW.meter_rollover_max IS NOT NULL AND NEW.previous_reading IS NOT NULL THEN
    NEW.volume_m3 := GREATEST(0, (NEW.meter_rollover_max - NEW.previous_reading) + NEW.raw_meter_reading);
  ELSIF NEW.previous_reading IS NULL THEN
    NEW.volume_m3 := 0;
  ELSE
    -- Unclamped: preserve negative delta so drops are immediately visible in red
    NEW.volume_m3 := NEW.raw_meter_reading - NEW.previous_reading;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_blending_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id           UUID;
  v_event_date        DATE;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor       NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_successor_raw     NUMERIC;
  v_new_prev          NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_event_date := OLD.event_date;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_event_date := NEW.event_date;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + volume_m3 ─────────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT raw_meter_reading INTO v_predecessor
      FROM public.blending_events
     WHERE well_id = v_well_id
       AND id <> NEW.id
       AND (event_date < v_event_date
            OR (event_date = v_event_date AND reading_datetime IS NOT NULL
                AND v_reading_dt IS NOT NULL AND reading_datetime < v_reading_dt))
     ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
     LIMIT 1;

    UPDATE public.blending_events
       SET previous_reading = v_predecessor,
           volume_m3        = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(is_meter_rollover, FALSE)
                                 AND meter_rollover_max IS NOT NULL
                                 AND v_predecessor IS NOT NULL
                                THEN GREATEST(0, (meter_rollover_max - v_predecessor) + raw_meter_reading)
                                WHEN v_predecessor IS NULL THEN 0
                                ELSE raw_meter_reading - v_predecessor
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max, raw_meter_reading
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax, v_successor_raw
    FROM public.blending_events
   WHERE well_id = v_well_id
     AND (event_date > v_event_date
          OR (event_date = v_event_date AND reading_datetime IS NOT NULL
              AND v_reading_dt IS NOT NULL AND reading_datetime > v_reading_dt))
   ORDER BY event_date ASC, reading_datetime ASC NULLS LAST
   LIMIT 1;

  IF v_successor_id IS NOT NULL AND v_successor_raw IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.raw_meter_reading;
    END IF;

    UPDATE public.blending_events AS be
       SET previous_reading = v_new_prev,
           volume_m3        = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, (v_successor_rollmax - v_new_prev) + be.raw_meter_reading)
                                WHEN v_new_prev IS NULL THEN 0
                                ELSE be.raw_meter_reading - v_new_prev
                              END
     WHERE be.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

-- ── 5. CASCADE CORRECTIONS: unclamp v_new_daily_vol and v_iter_daily_vol ─────
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
    -- Unclamped: allow negative volume if new current reading is below previous
    v_new_daily_vol := p_new_current - COALESCE(v_prev_reading, 0);
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

    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        -- Unclamped: allow negative volume on downstream links
        v_iter_daily_vol := v_iter_current - v_cursor_current;
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

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
    'old_value', v_old_current,
    'new_value', p_new_current,
    'table', p_table,
    'id', p_row_id,
    'cascaded_hops', v_hops - 1,
    'cascaded_ids', v_cascade_ids
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260905000001_preserve_negative_reading_deltas.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000002_resync_all_reading_chains.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260905000002_resync_all_reading_chains.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000003_backfill_multimeter_power_readings.sql >>>>>>>
-- =============================================================================
-- Migration: 20260905000003_backfill_multimeter_power_readings.sql
--
-- FIX: Multi-meter power plants (e.g. SRP with Grid Meter 1 STP, Grid Meter 2
-- Pumphouse, Grid Meter 3 Main) showed blank dashes ("—") for Reading, Δ, and
-- Power on auto-backfilled dates in ReadingHistoryDialog.
--
-- Root Cause:
--   fn_backfill_missing_readings Module 5 previously only queried and populated
--   the legacy `meter_reading_kwh` column (meter 0). It left `grid_meter_readings`
--   as NULL. In ReadingHistoryDialog, any filtered meter with idx > 0 evaluated
--   `gmr?.[String(gridIdx)]` to null, rendering "—". Furthermore, the subsequent
--   real reading's delta failed because predecessor had no reading for that meter.
--
-- Solution:
--   1. Ensure `grid_meter_readings` JSONB exists on `power_readings`.
--   2. Clean up any existing estimated power readings where `grid_meter_readings IS NULL`.
--   3. Upgrade Module 5 of `fn_backfill_missing_readings` to:
--      - Query `plant_power_config` for `grid_meter_count` and `grid_meter_multipliers`.
--      - Discover all meter keys present in either bounding reading.
--      - Linearly interpolate every active grid meter individually.
--      - Apply each meter's CT multiplier and calculate total daily_consumption_kwh / daily_grid_kwh.
--      - Store full JSONB `{ "0": val0, "1": val1, ... }` into `grid_meter_readings`.
--      - Mirror meter 0 to `meter_reading_kwh` for backward compatibility.
--      - Support repairing existing estimated rows if `grid_meter_readings` is missing or changed.
--   4. Immediately trigger a 30-day sweep to re-backfill all multi-meter power readings.
-- =============================================================================

-- Ensure column exists
ALTER TABLE public.power_readings
  ADD COLUMN IF NOT EXISTS grid_meter_readings JSONB;

-- Purge any orphaned or partial estimated power readings where grid_meter_readings is missing
DELETE FROM public.power_readings
WHERE is_estimated = true
  AND grid_meter_readings IS NULL;

-- Recreate fn_backfill_missing_readings with full multi-meter power interpolation
CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'Asia/Manila'
AS $function$
DECLARE
  v_lookback                integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end              date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start            date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count             integer := 0;
  v_skipped_count           integer := 0;
  v_retracted_count         integer := 0;
  v_purged_count            integer := 0;

  -- Iteration variables
  r_entity                  RECORD;
  r_reading_a               RECORD;
  r_reading_b               RECORD;
  v_gap_days                integer;
  v_step                    numeric;
  v_val                     numeric;
  v_daily_vol               numeric;
  v_cur_date                date;
  v_dt_iso                  timestamptz;
  v_has_reason              boolean;
  v_existing_id             uuid;
  v_is_est                  boolean;
  v_old_val                 numeric;
  v_old_gmr                 jsonb;
  v_diff                    numeric;
  v_method                  text;
  v_hist_rate               numeric;
  v_dpre                    numeric;
  v_u                       numeric;
  v_curvature               numeric;

  -- Multi-meter power variables
  v_grid_meter_count        integer;
  v_grid_meter_multipliers  numeric[];
  v_gmr_jsonb               jsonb;
  v_total_daily_kwh         numeric;
  v_val_a                   numeric;
  v_val_b                   numeric;
  v_diff_m                  numeric;
  v_step_m                  numeric;
  v_mult_m                  numeric;
  v_val_m_k                 numeric;
  v_daily_m_k               numeric;
  v_kwh_m_k                 numeric;
  v_dpre_m                  numeric;
  v_curvature_m             numeric;
  mi                        integer;
BEGIN

  -- ─── 0. Purge Orphaned Estimated Rows ────────────────────────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.locator_readings r
          WHERE r.locator_id = e.locator_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'locator'
            AND gr.entity_id = e.locator_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.well_readings r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'well'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.product_meter_readings r
          WHERE r.meter_id = e.meter_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'product'
            AND gr.entity_id = e.meter_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.blending_events r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'blending'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.power_readings r
          WHERE r.plant_id = e.plant_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'power'
            AND gr.entity_id = e.plant_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.ro_train_readings r
          WHERE r.train_id = e.train_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'ro_train'
            AND gr.entity_id = e.train_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
            AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date)), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date, reading_datetime
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) < r_reading_a.r_date
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings) - MULTI-METER SUPPORT
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants WHERE status = 'Active'
  LOOP
    -- Discover configured grid meter count and CT multipliers
    SELECT
      COALESCE(grid_meter_count, 1),
      grid_meter_multipliers
    INTO
      v_grid_meter_count,
      v_grid_meter_multipliers
    FROM public.plant_power_config
    WHERE plant_id = r_entity.plant_id;

    IF NOT FOUND OR v_grid_meter_count IS NULL OR v_grid_meter_count < 1 THEN
      v_grid_meter_count := 1;
    END IF;

    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          
          -- Dynamically ensure v_grid_meter_count covers all indices in both bounding rows
          IF r_reading_a.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_a.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;
          IF r_reading_b.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_b.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;

          -- Historical rate regression check for meter 0 if gap > 5 days
          v_hist_rate := NULL;
          IF v_gap_days > 5 THEN
            SELECT (
              COALESCE((r_reading_a.grid_meter_readings ->> '0')::numeric, r_reading_a.meter_reading_kwh)
              - MIN(COALESCE((grid_meter_readings ->> '0')::numeric, meter_reading_kwh))
            ) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
            INTO v_hist_rate
            FROM (
              SELECT meter_reading_kwh, grid_meter_readings, reading_datetime
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id
                AND COALESCE(is_estimated, false) = false
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
              ORDER BY reading_datetime DESC
              LIMIT 7
            ) sub;
          END IF;

          IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
            v_method := 'even_split';
          ELSE
            v_method := 'regression_flowrate';
          END IF;

          FOR k IN 1..v_gap_days LOOP
            v_cur_date := r_reading_a.r_date + k;
            IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
              SELECT EXISTS (
                SELECT 1 FROM public.reading_gap_reasons
                WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
              ) INTO v_has_reason;

              v_existing_id := NULL;
              v_is_est := NULL;
              v_old_val := NULL;
              v_old_gmr := NULL;

              SELECT id, is_estimated, meter_reading_kwh, grid_meter_readings
              INTO v_existing_id, v_is_est, v_old_val, v_old_gmr
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
              ORDER BY COALESCE(is_estimated, false) ASC
              LIMIT 1;

              IF v_has_reason THEN
                IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                  DELETE FROM public.power_readings WHERE id = v_existing_id;
                  v_retracted_count := v_retracted_count + 1;
                END IF;
                v_skipped_count := v_skipped_count + 1;
              ELSE
                -- Build grid_meter_readings JSONB and total daily consumption across all meters
                v_gmr_jsonb := '{}'::jsonb;
                v_total_daily_kwh := 0;

                FOR mi IN 0..(v_grid_meter_count - 1) LOOP
                  IF mi = 0 THEN
                    v_val_a := COALESCE(
                      CASE WHEN r_reading_a.grid_meter_readings ? '0' THEN (r_reading_a.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_a.meter_reading_kwh
                    );
                    v_val_b := COALESCE(
                      CASE WHEN r_reading_b.grid_meter_readings ? '0' THEN (r_reading_b.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_b.meter_reading_kwh
                    );
                  ELSE
                    v_val_a := (r_reading_a.grid_meter_readings ->> mi::text)::numeric;
                    v_val_b := (r_reading_b.grid_meter_readings ->> mi::text)::numeric;
                  END IF;

                  IF v_val_a IS NOT NULL AND v_val_b IS NOT NULL AND v_val_b >= v_val_a THEN
                    v_diff_m := v_val_b - v_val_a;
                    v_step_m := v_diff_m / (v_gap_days + 1);

                    -- Determine CT multiplier for this meter
                    v_mult_m := 1;
                    IF v_grid_meter_multipliers IS NOT NULL AND array_length(v_grid_meter_multipliers, 1) >= (mi + 1) THEN
                      v_mult_m := COALESCE(v_grid_meter_multipliers[mi + 1], 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    ELSE
                      v_mult_m := COALESCE(r_reading_a.meter_multiplier, r_reading_a.multiplier, 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    END IF;

                    IF v_method = 'even_split' THEN
                      v_val_m_k := ROUND(v_val_a + (v_step_m * k), 2);
                      v_daily_m_k := ROUND(v_step_m, 2);
                    ELSE
                      v_u := k::numeric / (v_gap_days + 1)::numeric;
                      v_dpre_m := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff_m * 0.2), v_diff_m * 1.8);
                      v_curvature_m := v_diff_m - v_dpre_m;
                      v_val_m_k := ROUND(v_val_a + (v_u * v_dpre_m) + (v_u * v_u * v_curvature_m), 2);
                      v_daily_m_k := ROUND(v_diff_m / (v_gap_days + 1), 2);
                    END IF;

                    v_kwh_m_k := v_daily_m_k * v_mult_m;
                    v_gmr_jsonb := v_gmr_jsonb || jsonb_build_object(mi::text, v_val_m_k);
                    v_total_daily_kwh := v_total_daily_kwh + v_kwh_m_k;
                  END IF;
                END LOOP;

                IF v_gmr_jsonb <> '{}'::jsonb THEN
                  v_val := CASE WHEN v_gmr_jsonb ? '0' THEN (v_gmr_jsonb ->> '0')::numeric ELSE NULL END;
                  v_daily_vol := ROUND(v_total_daily_kwh, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, grid_meter_readings,
                      daily_consumption_kwh, daily_grid_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_gmr_jsonb,
                      v_daily_vol, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND (v_old_val IS DISTINCT FROM v_val OR v_old_gmr IS DISTINCT FROM v_gmr_jsonb) THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val,
                        grid_meter_readings = v_gmr_jsonb,
                        daily_consumption_kwh = v_daily_vol,
                        daily_grid_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, anon, service_role;

-- Immediately run a 30-day sweep to backfill/repair missing multi-meter readings
SELECT public.fn_backfill_missing_readings((now() AT TIME ZONE 'Asia/Manila')::date, 30);

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260905000003_backfill_multimeter_power_readings.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000004_exempt_direct_readings_from_backfill.sql >>>>>>>
-- =============================================================================
-- Migration: 20260905000004_exempt_direct_readings_from_backfill.sql
--
-- FIX: Readings that are direct volume or direct power (such as solar generation,
-- direct-mode locators, derived locators, and derived product meters) must be
-- exempt from automated data backfill on blank dates.
--
-- Rationale:
--   Odometer readings (cumulative meter registers) continuously accumulate, so
--   interpolating across a bounded gap reflects actual physical register movement.
--   In contrast, direct volume or direct power readings (e.g. daily solar kWh,
--   direct daily m3 delivery) represent discrete daily measurements. If a date is
--   blank, interpolating or forward-filling creates phantom volume/power that was
--   never generated or verified.
--
-- Solution:
--   1. Purge any existing estimated rows on direct-mode locators, derived locators,
--      derived product meters, and any power rows with solar estimates.
--   2. Update fn_backfill_missing_readings:
--      - Module 1 (Locators): Skip locators with default_input_mode = 'direct' or is_derived = true.
--      - Module 3 (Product Meters): Skip product meters with is_derived = true.
--      - Module 5 (Power): Only process plants with has_grid = true; solar is strictly exempt.
--   3. Trigger a 30-day sweep to purge invalid estimates and align readings.
-- =============================================================================

-- Purge existing estimated rows on direct/derived locators
DELETE FROM public.locator_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.locators l
    WHERE l.id = e.locator_id
      AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
  );

-- Purge existing estimated rows on derived product meters
DELETE FROM public.product_meter_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.product_meters pm
    WHERE pm.id = e.meter_id
      AND COALESCE(pm.is_derived, false) = true
  );

-- Purge any estimated power readings where solar was set or grid readings are missing
DELETE FROM public.power_readings
WHERE is_estimated = true
  AND (
    daily_solar_kwh IS NOT NULL
    OR solar_meter_reading IS NOT NULL
    OR grid_meter_readings IS NULL
    OR grid_meter_readings = '{}'::jsonb
  );

-- Recreate fn_backfill_missing_readings with direct volume/power exemptions
CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'Asia/Manila'
AS $function$
DECLARE
  v_lookback                integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end              date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start            date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count             integer := 0;
  v_skipped_count           integer := 0;
  v_retracted_count         integer := 0;
  v_purged_count            integer := 0;

  -- Iteration variables
  r_entity                  RECORD;
  r_reading_a               RECORD;
  r_reading_b               RECORD;
  v_gap_days                integer;
  v_step                    numeric;
  v_val                     numeric;
  v_daily_vol               numeric;
  v_cur_date                date;
  v_dt_iso                  timestamptz;
  v_has_reason              boolean;
  v_existing_id             uuid;
  v_is_est                  boolean;
  v_old_val                 numeric;
  v_old_gmr                 jsonb;
  v_diff                    numeric;
  v_method                  text;
  v_hist_rate               numeric;
  v_dpre                    numeric;
  v_u                       numeric;
  v_curvature               numeric;

  -- Multi-meter power variables
  v_grid_meter_count        integer;
  v_grid_meter_multipliers  numeric[];
  v_gmr_jsonb               jsonb;
  v_total_daily_kwh         numeric;
  v_val_a                   numeric;
  v_val_b                   numeric;
  v_diff_m                  numeric;
  v_step_m                  numeric;
  v_mult_m                  numeric;
  v_val_m_k                 numeric;
  v_daily_m_k               numeric;
  v_kwh_m_k                 numeric;
  v_dpre_m                  numeric;
  v_curvature_m             numeric;
  mi                        integer;
BEGIN

  -- ─── 0. Purge Orphaned & Invalid Estimated Rows ─────────────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.locator_readings r
          WHERE r.locator_id = e.locator_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'locator'
            AND gr.entity_id = e.locator_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.locators l
          WHERE l.id = e.locator_id
            AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.well_readings r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'well'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.product_meter_readings r
          WHERE r.meter_id = e.meter_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'product'
            AND gr.entity_id = e.meter_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meters pm
          WHERE pm.id = e.meter_id
            AND COALESCE(pm.is_derived, false) = true
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.blending_events r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'blending'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.power_readings r
          WHERE r.plant_id = e.plant_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'power'
            AND gr.entity_id = e.plant_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR e.daily_solar_kwh IS NOT NULL
        OR e.solar_meter_reading IS NOT NULL
        OR e.grid_meter_readings IS NULL
        OR e.grid_meter_readings = '{}'::jsonb
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.ro_train_readings r
          WHERE r.train_id = e.train_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'ro_train'
            AND gr.entity_id = e.train_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- EXEMPTION: Only cumulative odometer locators (default_input_mode <> 'direct'
  -- and is_derived = false). Direct volume locators must NEVER be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators
    WHERE status = 'Active'
      AND is_derived = false
      AND COALESCE(default_input_mode, 'raw') <> 'direct'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
            AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- EXEMPTION: Only cumulative physical product meters (is_derived = false).
  -- Derived/virtual product meters (e.g. Parkmall, Coke, HAMAS) must never be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters
    WHERE status = 'Active'
      AND COALESCE(is_derived, false) = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date)), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date, reading_datetime
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) < r_reading_a.r_date
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings) - MULTI-METER GRID SUPPORT
  -- EXEMPTION: Solar generation (daily_solar_kwh / solar_meter_reading) is direct
  -- power and is strictly EXEMPT from backfill. Only cumulative grid meters are
  -- backfilled. Plants without grid (has_grid = false) are skipped.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants
    WHERE status = 'Active'
      AND COALESCE(has_grid, true) = true
  LOOP
    -- Discover configured grid meter count and CT multipliers
    SELECT
      COALESCE(grid_meter_count, 1),
      grid_meter_multipliers
    INTO
      v_grid_meter_count,
      v_grid_meter_multipliers
    FROM public.plant_power_config
    WHERE plant_id = r_entity.plant_id;

    IF NOT FOUND OR v_grid_meter_count IS NULL OR v_grid_meter_count < 1 THEN
      v_grid_meter_count := 1;
    END IF;

    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          
          -- Dynamically ensure v_grid_meter_count covers all indices in both bounding rows
          IF r_reading_a.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_a.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;
          IF r_reading_b.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_b.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;

          -- Historical rate regression check for meter 0 if gap > 5 days
          v_hist_rate := NULL;
          IF v_gap_days > 5 THEN
            SELECT (
              COALESCE((r_reading_a.grid_meter_readings ->> '0')::numeric, r_reading_a.meter_reading_kwh)
              - MIN(COALESCE((grid_meter_readings ->> '0')::numeric, meter_reading_kwh))
            ) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
            INTO v_hist_rate
            FROM (
              SELECT meter_reading_kwh, grid_meter_readings, reading_datetime
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id
                AND COALESCE(is_estimated, false) = false
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
              ORDER BY reading_datetime DESC
              LIMIT 7
            ) sub;
          END IF;

          IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
            v_method := 'even_split';
          ELSE
            v_method := 'regression_flowrate';
          END IF;

          FOR k IN 1..v_gap_days LOOP
            v_cur_date := r_reading_a.r_date + k;
            IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
              SELECT EXISTS (
                SELECT 1 FROM public.reading_gap_reasons
                WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
              ) INTO v_has_reason;

              v_existing_id := NULL;
              v_is_est := NULL;
              v_old_val := NULL;
              v_old_gmr := NULL;

              SELECT id, is_estimated, meter_reading_kwh, grid_meter_readings
              INTO v_existing_id, v_is_est, v_old_val, v_old_gmr
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
              ORDER BY COALESCE(is_estimated, false) ASC
              LIMIT 1;

              IF v_has_reason THEN
                IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                  DELETE FROM public.power_readings WHERE id = v_existing_id;
                  v_retracted_count := v_retracted_count + 1;
                END IF;
                v_skipped_count := v_skipped_count + 1;
              ELSE
                -- Build grid_meter_readings JSONB and total daily consumption across all grid meters
                v_gmr_jsonb := '{}'::jsonb;
                v_total_daily_kwh := 0;

                FOR mi IN 0..(v_grid_meter_count - 1) LOOP
                  IF mi = 0 THEN
                    v_val_a := COALESCE(
                      CASE WHEN r_reading_a.grid_meter_readings ? '0' THEN (r_reading_a.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_a.meter_reading_kwh
                    );
                    v_val_b := COALESCE(
                      CASE WHEN r_reading_b.grid_meter_readings ? '0' THEN (r_reading_b.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_b.meter_reading_kwh
                    );
                  ELSE
                    v_val_a := (r_reading_a.grid_meter_readings ->> mi::text)::numeric;
                    v_val_b := (r_reading_b.grid_meter_readings ->> mi::text)::numeric;
                  END IF;

                  IF v_val_a IS NOT NULL AND v_val_b IS NOT NULL AND v_val_b >= v_val_a THEN
                    v_diff_m := v_val_b - v_val_a;
                    v_step_m := v_diff_m / (v_gap_days + 1);

                    -- Determine CT multiplier for this meter
                    v_mult_m := 1;
                    IF v_grid_meter_multipliers IS NOT NULL AND array_length(v_grid_meter_multipliers, 1) >= (mi + 1) THEN
                      v_mult_m := COALESCE(v_grid_meter_multipliers[mi + 1], 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    ELSE
                      v_mult_m := COALESCE(r_reading_a.meter_multiplier, r_reading_a.multiplier, 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    END IF;

                    IF v_method = 'even_split' THEN
                      v_val_m_k := ROUND(v_val_a + (v_step_m * k), 2);
                      v_daily_m_k := ROUND(v_step_m, 2);
                    ELSE
                      v_u := k::numeric / (v_gap_days + 1)::numeric;
                      v_dpre_m := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff_m * 0.2), v_diff_m * 1.8);
                      v_curvature_m := v_diff_m - v_dpre_m;
                      v_val_m_k := ROUND(v_val_a + (v_u * v_dpre_m) + (v_u * v_u * v_curvature_m), 2);
                      v_daily_m_k := ROUND(v_diff_m / (v_gap_days + 1), 2);
                    END IF;

                    v_kwh_m_k := v_daily_m_k * v_mult_m;
                    v_gmr_jsonb := v_gmr_jsonb || jsonb_build_object(mi::text, v_val_m_k);
                    v_total_daily_kwh := v_total_daily_kwh + v_kwh_m_k;
                  END IF;
                END LOOP;

                IF v_gmr_jsonb <> '{}'::jsonb THEN
                  v_val := CASE WHEN v_gmr_jsonb ? '0' THEN (v_gmr_jsonb ->> '0')::numeric ELSE NULL END;
                  v_daily_vol := ROUND(v_total_daily_kwh, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  -- NOTE: daily_solar_kwh and solar_meter_reading are NEVER backfilled
                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, grid_meter_readings,
                      daily_consumption_kwh, daily_grid_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_gmr_jsonb,
                      v_daily_vol, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND (v_old_val IS DISTINCT FROM v_val OR v_old_gmr IS DISTINCT FROM v_gmr_jsonb) THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val,
                        grid_meter_readings = v_gmr_jsonb,
                        daily_consumption_kwh = v_daily_vol,
                        daily_grid_kwh = v_daily_vol,
                        daily_solar_kwh = NULL,
                        solar_meter_reading = NULL
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, anon, service_role;

-- Run 30-day sweep to immediately clean up invalid estimates and reconcile
SELECT public.fn_backfill_missing_readings((now() AT TIME ZONE 'Asia/Manila')::date, 30);

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260905000004_exempt_direct_readings_from_backfill.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000005_fix_backfill_boundary_anchors_and_monotonicity.sql >>>>>>>
-- =============================================================================
-- Migration: 20260905000005_fix_backfill_boundary_anchors_and_monotonicity.sql
--
-- BUG FIX: Backfill formula error when days have multiple intra-day readings.
--
-- Root Cause:
--   1. Boundary Anchor Selection:
--      When a date had multiple human readings (e.g., Aug 31 with 06:00, 07:00, 21:56),
--      r_reading_a was ordered ASC, selecting the earliest morning reading (06:00, 148,470)
--      as the pre-gap baseline rather than the latest reading of that date (21:56, 148,700).
--      Interpolating across to Sep 02 (148,902) produced an estimated reading of 148,686,
--      which was LESS than the 21:56 reading (148,700), resulting in a negative delta (-14.00 m³).
--   2. Invalidation & Monotonicity:
--      Section 0 previously only purged estimated readings if a human reading existed
--      on the EXACT same date. It did NOT purge estimated readings that violated
--      monotonicity (i.e. where an earlier non-rollover human reading had a higher value,
--      or a later non-rollover human reading had a lower value).
--
-- Solution:
--   1. In Section 0, purge any estimated reading that violates strict monotonicity
--      against adjacent human readings.
--   2. In Modules 1–6, change r_reading_a to use:
--      DISTINCT ON (date) ... ORDER BY date ASC, reading_datetime DESC
--      so the chronologically LATEST reading of that date is ALWAYS chosen as the pre-gap baseline.
--   3. Keep r_reading_b as ORDER BY reading_datetime ASC LIMIT 1
--      so the chronologically EARLIEST reading of the post-gap date is chosen.
--   4. Add strict monotonicity clamps during value calculation:
--      for cumulative meters without rollover, v_val must strictly satisfy
--      r_reading_a.current_reading < v_val < r_reading_b.current_reading.
--   5. Run a 30-day sweep immediately to repair any corrupted estimates.
-- =============================================================================

-- ─── 0. Purge Existing Stale / Non-Monotonic Estimated Readings ───────────────

-- Locator readings: purge estimated rows that are <= preceding human reading or >= succeeding human reading
DELETE FROM public.locator_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.locator_readings r
      WHERE r.locator_id = e.locator_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'locator'
        AND gr.entity_id = e.locator_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.locators l
      WHERE l.id = e.locator_id
        AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.locator_readings prev_r
      WHERE prev_r.locator_id = e.locator_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.locator_readings next_r
      WHERE next_r.locator_id = e.locator_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Well readings: purge estimated rows that violate monotonicity
DELETE FROM public.well_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.well_readings r
      WHERE r.well_id = e.well_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'well'
        AND gr.entity_id = e.well_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.well_readings prev_r
      WHERE prev_r.well_id = e.well_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.well_readings next_r
      WHERE next_r.well_id = e.well_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Product meter readings: purge estimated rows that violate monotonicity
DELETE FROM public.product_meter_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.product_meter_readings r
      WHERE r.meter_id = e.meter_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'product'
        AND gr.entity_id = e.meter_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meters pm
      WHERE pm.id = e.meter_id
        AND COALESCE(pm.is_derived, false) = true
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meter_readings prev_r
      WHERE prev_r.meter_id = e.meter_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meter_readings next_r
      WHERE next_r.meter_id = e.meter_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Blending events: purge estimated rows that violate monotonicity
DELETE FROM public.blending_events e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.blending_events r
      WHERE r.well_id = e.well_id
        AND COALESCE(r.is_estimated, false) = false
        AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'blending'
        AND gr.entity_id = e.well_id
        AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
    )
    OR EXISTS (
      SELECT 1 FROM public.blending_events prev_r
      WHERE prev_r.well_id = e.well_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND COALESCE(prev_r.event_date, (prev_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) < COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND prev_r.raw_meter_reading >= e.raw_meter_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.blending_events next_r
      WHERE next_r.well_id = e.well_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND COALESCE(next_r.event_date, (next_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) > COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND next_r.raw_meter_reading <= e.raw_meter_reading
    )
  );

-- Power readings: purge estimated rows that violate monotonicity
DELETE FROM public.power_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.power_readings r
      WHERE r.plant_id = e.plant_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'power'
        AND gr.entity_id = e.plant_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR e.daily_solar_kwh IS NOT NULL
    OR e.solar_meter_reading IS NOT NULL
    OR e.grid_meter_readings IS NULL
    OR e.grid_meter_readings = '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM public.power_readings prev_r
      WHERE prev_r.plant_id = e.plant_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_grid_replacement, false) = false
        AND COALESCE((prev_r.grid_meter_readings ->> '0')::numeric, prev_r.meter_reading_kwh) >= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
    )
    OR EXISTS (
      SELECT 1 FROM public.power_readings next_r
      WHERE next_r.plant_id = e.plant_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_grid_replacement, false) = false
        AND COALESCE((next_r.grid_meter_readings ->> '0')::numeric, next_r.meter_reading_kwh) <= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
    )
  );

-- RO Train readings: purge estimated rows that violate monotonicity
DELETE FROM public.ro_train_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.ro_train_readings r
      WHERE r.train_id = e.train_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'ro_train'
        AND gr.entity_id = e.train_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_train_readings prev_r
      WHERE prev_r.train_id = e.train_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_permeate_meter_replacement, false) = false
        AND prev_r.permeate_meter >= e.permeate_meter
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_train_readings next_r
      WHERE next_r.train_id = e.train_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_permeate_meter_replacement, false) = false
        AND next_r.permeate_meter <= e.permeate_meter
    )
  );


-- ─── 1. Recreate fn_backfill_missing_readings With Boundary Fixes ─────────────

CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'Asia/Manila'
AS $function$
DECLARE
  v_lookback                integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end              date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start            date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count             integer := 0;
  v_skipped_count           integer := 0;
  v_retracted_count         integer := 0;
  v_purged_count            integer := 0;

  -- Iteration variables
  r_entity                  RECORD;
  r_reading_a               RECORD;
  r_reading_b               RECORD;
  v_gap_days                integer;
  v_step                    numeric;
  v_val                     numeric;
  v_daily_vol               numeric;
  v_cur_date                date;
  v_dt_iso                  timestamptz;
  v_has_reason              boolean;
  v_existing_id             uuid;
  v_is_est                  boolean;
  v_old_val                 numeric;
  v_old_gmr                 jsonb;
  v_diff                    numeric;
  v_method                  text;
  v_hist_rate               numeric;
  v_dpre                    numeric;
  v_u                       numeric;
  v_curvature               numeric;

  -- Multi-meter power variables
  v_grid_meter_count        integer;
  v_grid_meter_multipliers  numeric[];
  v_gmr_jsonb               jsonb;
  v_total_daily_kwh         numeric;
  v_val_a                   numeric;
  v_val_b                   numeric;
  v_diff_m                  numeric;
  v_step_m                  numeric;
  v_mult_m                  numeric;
  v_val_m_k                 numeric;
  v_daily_m_k               numeric;
  v_kwh_m_k                 numeric;
  v_dpre_m                  numeric;
  v_curvature_m             numeric;
  mi                        integer;
BEGIN

  -- ─── 0. Purge Orphaned & Non-Monotonic Estimated Rows ───────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.locator_readings r
          WHERE r.locator_id = e.locator_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'locator'
            AND gr.entity_id = e.locator_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.locators l
          WHERE l.id = e.locator_id
            AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
        )
        OR EXISTS (
          SELECT 1 FROM public.locator_readings prev_r
          WHERE prev_r.locator_id = e.locator_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.locator_readings next_r
          WHERE next_r.locator_id = e.locator_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.well_readings r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'well'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.well_readings prev_r
          WHERE prev_r.well_id = e.well_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.well_readings next_r
          WHERE next_r.well_id = e.well_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.product_meter_readings r
          WHERE r.meter_id = e.meter_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'product'
            AND gr.entity_id = e.meter_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meters pm
          WHERE pm.id = e.meter_id
            AND COALESCE(pm.is_derived, false) = true
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meter_readings prev_r
          WHERE prev_r.meter_id = e.meter_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meter_readings next_r
          WHERE next_r.meter_id = e.meter_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.blending_events r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'blending'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.blending_events prev_r
          WHERE prev_r.well_id = e.well_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND COALESCE(prev_r.event_date, (prev_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) < COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND prev_r.raw_meter_reading >= e.raw_meter_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.blending_events next_r
          WHERE next_r.well_id = e.well_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND COALESCE(next_r.event_date, (next_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) > COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND next_r.raw_meter_reading <= e.raw_meter_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.power_readings r
          WHERE r.plant_id = e.plant_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'power'
            AND gr.entity_id = e.plant_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR e.daily_solar_kwh IS NOT NULL
        OR e.solar_meter_reading IS NOT NULL
        OR e.grid_meter_readings IS NULL
        OR e.grid_meter_readings = '{}'::jsonb
        OR EXISTS (
          SELECT 1 FROM public.power_readings prev_r
          WHERE prev_r.plant_id = e.plant_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_grid_replacement, false) = false
            AND COALESCE((prev_r.grid_meter_readings ->> '0')::numeric, prev_r.meter_reading_kwh) >= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
        )
        OR EXISTS (
          SELECT 1 FROM public.power_readings next_r
          WHERE next_r.plant_id = e.plant_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_grid_replacement, false) = false
            AND COALESCE((next_r.grid_meter_readings ->> '0')::numeric, next_r.meter_reading_kwh) <= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.ro_train_readings r
          WHERE r.train_id = e.train_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'ro_train'
            AND gr.entity_id = e.train_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_train_readings prev_r
          WHERE prev_r.train_id = e.train_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_permeate_meter_replacement, false) = false
            AND prev_r.permeate_meter >= e.permeate_meter
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_train_readings next_r
          WHERE next_r.train_id = e.train_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_permeate_meter_replacement, false) = false
            AND next_r.permeate_meter <= e.permeate_meter
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- EXEMPTION: Only cumulative odometer locators (default_input_mode <> 'direct'
  -- and is_derived = false). Direct volume locators must NEVER be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators
    WHERE status = 'Active'
      AND is_derived = false
      AND COALESCE(default_input_mode, 'raw') <> 'direct'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
            AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  -- Strict Monotonicity Guard: ensure v_val stays strictly between bounding readings
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- EXEMPTION: Only cumulative physical product meters (is_derived = false).
  -- Derived/virtual product meters (e.g. Parkmall, Coke, HAMAS) must never be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters
    WHERE status = 'Active'
      AND COALESCE(is_derived, false) = false
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON (COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date))
             id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC, reading_datetime DESC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC, reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date)), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date, reading_datetime
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) < r_reading_a.r_date
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.raw_meter_reading OR v_val >= r_reading_b.raw_meter_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings) - MULTI-METER GRID SUPPORT
  -- EXEMPTION: Solar generation (daily_solar_kwh / solar_meter_reading) is direct
  -- power and is strictly EXEMPT from backfill. Only cumulative grid meters are
  -- backfilled. Plants without grid (has_grid = false) are skipped.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants
    WHERE status = 'Active'
      AND COALESCE(has_grid, true) = true
  LOOP
    -- Discover configured grid meter count and CT multipliers
    SELECT
      COALESCE(grid_meter_count, 1),
      grid_meter_multipliers
    INTO
      v_grid_meter_count,
      v_grid_meter_multipliers
    FROM public.plant_power_config
    WHERE plant_id = r_entity.plant_id;

    IF NOT FOUND OR v_grid_meter_count IS NULL OR v_grid_meter_count < 1 THEN
      v_grid_meter_count := 1;
    END IF;

    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          
          -- Dynamically ensure v_grid_meter_count covers all indices in both bounding rows
          IF r_reading_a.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_a.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;
          IF r_reading_b.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_b.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;

          -- Historical rate regression check for meter 0 if gap > 5 days
          v_hist_rate := NULL;
          IF v_gap_days > 5 THEN
            SELECT (
              COALESCE((r_reading_a.grid_meter_readings ->> '0')::numeric, r_reading_a.meter_reading_kwh)
              - MIN(COALESCE((grid_meter_readings ->> '0')::numeric, meter_reading_kwh))
            ) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
            INTO v_hist_rate
            FROM (
              SELECT meter_reading_kwh, grid_meter_readings, reading_datetime
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id
                AND COALESCE(is_estimated, false) = false
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
              ORDER BY reading_datetime DESC
              LIMIT 7
            ) sub;
          END IF;

          IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
            v_method := 'even_split';
          ELSE
            v_method := 'regression_flowrate';
          END IF;

          FOR k IN 1..v_gap_days LOOP
            v_cur_date := r_reading_a.r_date + k;
            IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
              SELECT EXISTS (
                SELECT 1 FROM public.reading_gap_reasons
                WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
              ) INTO v_has_reason;

              v_existing_id := NULL;
              v_is_est := NULL;
              v_old_val := NULL;
              v_old_gmr := NULL;

              SELECT id, is_estimated, meter_reading_kwh, grid_meter_readings
              INTO v_existing_id, v_is_est, v_old_val, v_old_gmr
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
              ORDER BY COALESCE(is_estimated, false) ASC
              LIMIT 1;

              IF v_has_reason THEN
                IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                  DELETE FROM public.power_readings WHERE id = v_existing_id;
                  v_retracted_count := v_retracted_count + 1;
                END IF;
                v_skipped_count := v_skipped_count + 1;
              ELSE
                -- Build grid_meter_readings JSONB and total daily consumption across all grid meters
                v_gmr_jsonb := '{}'::jsonb;
                v_total_daily_kwh := 0;

                FOR mi IN 0..(v_grid_meter_count - 1) LOOP
                  IF mi = 0 THEN
                    v_val_a := COALESCE(
                      CASE WHEN r_reading_a.grid_meter_readings ? '0' THEN (r_reading_a.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_a.meter_reading_kwh
                    );
                    v_val_b := COALESCE(
                      CASE WHEN r_reading_b.grid_meter_readings ? '0' THEN (r_reading_b.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_b.meter_reading_kwh
                    );
                  ELSE
                    v_val_a := (r_reading_a.grid_meter_readings ->> mi::text)::numeric;
                    v_val_b := (r_reading_b.grid_meter_readings ->> mi::text)::numeric;
                  END IF;

                  IF v_val_a IS NOT NULL AND v_val_b IS NOT NULL AND v_val_b >= v_val_a THEN
                    v_diff_m := v_val_b - v_val_a;
                    v_step_m := v_diff_m / (v_gap_days + 1);

                    -- Determine CT multiplier for this meter
                    v_mult_m := 1;
                    IF v_grid_meter_multipliers IS NOT NULL AND array_length(v_grid_meter_multipliers, 1) >= (mi + 1) THEN
                      v_mult_m := COALESCE(v_grid_meter_multipliers[mi + 1], 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    ELSE
                      v_mult_m := COALESCE(r_reading_a.meter_multiplier, r_reading_a.multiplier, 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    END IF;

                    IF v_method = 'even_split' THEN
                      v_val_m_k := ROUND(v_val_a + (v_step_m * k), 2);
                      v_daily_m_k := ROUND(v_step_m, 2);
                    ELSE
                      v_u := k::numeric / (v_gap_days + 1)::numeric;
                      v_dpre_m := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff_m * 0.2), v_diff_m * 1.8);
                      v_curvature_m := v_diff_m - v_dpre_m;
                      v_val_m_k := ROUND(v_val_a + (v_u * v_dpre_m) + (v_u * v_u * v_curvature_m), 2);
                      v_daily_m_k := ROUND(v_diff_m / (v_gap_days + 1), 2);
                    END IF;

                    -- Strict monotonicity clamp per meter
                    IF v_val_m_k < v_val_a THEN v_val_m_k := v_val_a; END IF;
                    IF v_val_m_k > v_val_b THEN v_val_m_k := v_val_b; END IF;

                    v_kwh_m_k := v_daily_m_k * v_mult_m;
                    v_gmr_jsonb := v_gmr_jsonb || jsonb_build_object(mi::text, v_val_m_k);
                    v_total_daily_kwh := v_total_daily_kwh + v_kwh_m_k;
                  END IF;
                END LOOP;

                IF v_gmr_jsonb <> '{}'::jsonb THEN
                  v_val := CASE WHEN v_gmr_jsonb ? '0' THEN (v_gmr_jsonb ->> '0')::numeric ELSE NULL END;
                  v_daily_vol := ROUND(v_total_daily_kwh, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  -- NOTE: daily_solar_kwh and solar_meter_reading are NEVER backfilled
                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, grid_meter_readings,
                      daily_consumption_kwh, daily_grid_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_gmr_jsonb,
                      v_daily_vol, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND (v_old_val IS DISTINCT FROM v_val OR v_old_gmr IS DISTINCT FROM v_gmr_jsonb) THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val,
                        grid_meter_readings = v_gmr_jsonb,
                        daily_consumption_kwh = v_daily_vol,
                        daily_grid_kwh = v_daily_vol,
                        daily_solar_kwh = NULL,
                        solar_meter_reading = NULL
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.permeate_meter OR v_val >= r_reading_b.permeate_meter THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, anon, service_role;

-- Run 30-day sweep to immediately clean up invalid estimates and reconcile
SELECT public.fn_backfill_missing_readings((now() AT TIME ZONE 'Asia/Manila')::date, 30);

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260905000005_fix_backfill_boundary_anchors_and_monotonicity.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000006_robust_backfill_and_audit.sql >>>>>>>
-- =============================================================================
-- Migration: 20260905000006_robust_backfill_and_audit.sql
--
-- COMPREHENSIVE BACKFILL HARDENING:
--   1. Strict Monotonicity Enforcement:
--      - Replaces clamping in Module 5 (Power) with strict rejection and skip.
--      - If any meter in a plant violates monotonicity or decreases without a
--        replacement flag, candidate readings are discarded and the day is skipped.
--      - Modules 1–4 and 6 strictly require v_val to be strictly between bounds
--        and day-over-day delta > 0.
--   2. Auditability & Observability:
--      - Expands backfill_sweep_log check constraint to accept 'monotonicity_rejected'.
--      - When a monotonicity check fails, increments v_skipped_count and writes an
--        audit row into backfill_sweep_log detailing the rejection.
--   3. True Day-over-Day Delta for Non-Linear Regressions:
--      - Replaces flat average deltas with actual daily difference v_val - v_prev_val
--        across wells, product meters, blending, power, and RO trains.
--   4. Distinct Calendar Day Historical Sampling:
--      - In historical rate calculations, queries DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
--        so days with multiple sub-daily readings count as single calendar days.
--   5. Security & Access Control:
--      - Revokes EXECUTE on fn_backfill_missing_readings from 'anon'.
--      - Grants EXECUTE only to 'authenticated' and 'service_role'.
--   6. Immediate Stale / Corrupted Estimate Purge & 30-Day Sweep:
--      - Deletes any estimate violating strict monotonicity against real readings.
--      - Runs an automatic 30-day sweep to repair historical estimates.
-- =============================================================================

-- ─── 1. Expand backfill_sweep_log Method Check Constraint ─────────────────────
ALTER TABLE public.backfill_sweep_log DROP CONSTRAINT IF EXISTS backfill_sweep_log_method_check;
ALTER TABLE public.backfill_sweep_log ADD CONSTRAINT backfill_sweep_log_method_check
  CHECK (method IN ('even_split', 'regression_flowrate', 'monotonicity_rejected', 'monotonicity_clamp_prevented'));

-- ─── 2. Purge Existing Stale / Non-Monotonic Estimated Readings ───────────────

-- Locator readings
DELETE FROM public.locator_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.locator_readings r
      WHERE r.locator_id = e.locator_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'locator'
        AND gr.entity_id = e.locator_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.locators l
      WHERE l.id = e.locator_id
        AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.locator_readings prev_r
      WHERE prev_r.locator_id = e.locator_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.locator_readings next_r
      WHERE next_r.locator_id = e.locator_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Well readings
DELETE FROM public.well_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.well_readings r
      WHERE r.well_id = e.well_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'well'
        AND gr.entity_id = e.well_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.well_readings prev_r
      WHERE prev_r.well_id = e.well_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.well_readings next_r
      WHERE next_r.well_id = e.well_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Product meter readings
DELETE FROM public.product_meter_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.product_meter_readings r
      WHERE r.meter_id = e.meter_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'product'
        AND gr.entity_id = e.meter_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meters pm
      WHERE pm.id = e.meter_id
        AND COALESCE(pm.is_derived, false) = true
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meter_readings prev_r
      WHERE prev_r.meter_id = e.meter_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meter_readings next_r
      WHERE next_r.meter_id = e.meter_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Blending events
DELETE FROM public.blending_events e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.blending_events r
      WHERE r.well_id = e.well_id
        AND COALESCE(r.is_estimated, false) = false
        AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'blending'
        AND gr.entity_id = e.well_id
        AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
    )
    OR EXISTS (
      SELECT 1 FROM public.blending_events prev_r
      WHERE prev_r.well_id = e.well_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND COALESCE(prev_r.event_date, (prev_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) < COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND prev_r.raw_meter_reading >= e.raw_meter_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.blending_events next_r
      WHERE next_r.well_id = e.well_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND COALESCE(next_r.event_date, (next_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) > COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND next_r.raw_meter_reading <= e.raw_meter_reading
    )
  );

-- Power readings
DELETE FROM public.power_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.power_readings r
      WHERE r.plant_id = e.plant_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'power'
        AND gr.entity_id = e.plant_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.power_readings prev_r
      WHERE prev_r.plant_id = e.plant_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND (
          (prev_r.meter_reading_kwh IS NOT NULL AND e.meter_reading_kwh IS NOT NULL AND prev_r.meter_reading_kwh >= e.meter_reading_kwh)
          OR
          (prev_r.grid_meter_readings ? '0' AND e.grid_meter_readings ? '0' AND (prev_r.grid_meter_readings ->> '0')::numeric >= (e.grid_meter_readings ->> '0')::numeric)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.power_readings next_r
      WHERE next_r.plant_id = e.plant_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND (
          (next_r.meter_reading_kwh IS NOT NULL AND e.meter_reading_kwh IS NOT NULL AND next_r.meter_reading_kwh <= e.meter_reading_kwh)
          OR
          (next_r.grid_meter_readings ? '0' AND e.grid_meter_readings ? '0' AND (next_r.grid_meter_readings ->> '0')::numeric <= (e.grid_meter_readings ->> '0')::numeric)
        )
    )
  );

-- RO train readings
DELETE FROM public.ro_train_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.ro_train_readings r
      WHERE r.train_id = e.train_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'ro_train'
        AND gr.entity_id = e.train_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_trains t
      WHERE t.id = e.train_id AND t.status <> 'Running'
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_train_readings prev_r
      WHERE prev_r.train_id = e.train_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_permeate_meter_replacement, false) = false
        AND prev_r.permeate_meter >= e.permeate_meter
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_train_readings next_r
      WHERE next_r.train_id = e.train_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_permeate_meter_replacement, false) = false
        AND next_r.permeate_meter <= e.permeate_meter
    )
  );


-- ─── 3. Recreate fn_backfill_missing_readings ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'Asia/Manila'
AS $function$
DECLARE
  v_lookback                integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end              date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start            date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count             integer := 0;
  v_skipped_count           integer := 0;
  v_retracted_count         integer := 0;
  v_purged_count            integer := 0;

  -- Iteration variables
  r_entity                  RECORD;
  r_reading_a               RECORD;
  r_reading_b               RECORD;
  v_gap_days                integer;
  v_step                    numeric;
  v_val                     numeric;
  v_prev_val                numeric;
  v_daily_vol               numeric;
  v_cur_date                date;
  v_dt_iso                  timestamptz;
  v_has_reason              boolean;
  v_existing_id             uuid;
  v_is_est                  boolean;
  v_old_val                 numeric;
  v_old_gmr                 jsonb;
  v_diff                    numeric;
  v_method                  text;
  v_hist_rate               numeric;
  v_dpre                    numeric;
  v_u                       numeric;
  v_u_prev                  numeric;
  v_curvature               numeric;

  -- Multi-meter power variables
  v_grid_meter_count        integer;
  v_grid_meter_multipliers  numeric[];
  v_gmr_jsonb               jsonb;
  v_total_daily_kwh         numeric;
  v_val_a                   numeric;
  v_val_b                   numeric;
  v_diff_m                  numeric;
  v_step_m                  numeric;
  v_mult_m                  numeric;
  v_val_m_k                 numeric;
  v_prev_m_k                numeric;
  v_daily_m_k               numeric;
  v_kwh_m_k                 numeric;
  v_dpre_m                  numeric;
  v_curvature_m             numeric;
  mi                        integer;
  v_power_day_valid         boolean;
BEGIN

  -- ─── 0. Purge Orphaned & Non-Monotonic Estimated Rows ───────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.locator_readings r
          WHERE r.locator_id = e.locator_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'locator'
            AND gr.entity_id = e.locator_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.locators l
          WHERE l.id = e.locator_id
            AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
        )
        OR EXISTS (
          SELECT 1 FROM public.locator_readings prev_r
          WHERE prev_r.locator_id = e.locator_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.locator_readings next_r
          WHERE next_r.locator_id = e.locator_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.well_readings r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'well'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.well_readings prev_r
          WHERE prev_r.well_id = e.well_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.well_readings next_r
          WHERE next_r.well_id = e.well_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.product_meter_readings r
          WHERE r.meter_id = e.meter_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'product'
            AND gr.entity_id = e.meter_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meters pm
          WHERE pm.id = e.meter_id
            AND COALESCE(pm.is_derived, false) = true
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meter_readings prev_r
          WHERE prev_r.meter_id = e.meter_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meter_readings next_r
          WHERE next_r.meter_id = e.meter_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.blending_events r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'blending'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.blending_events prev_r
          WHERE prev_r.well_id = e.well_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND COALESCE(prev_r.event_date, (prev_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) < COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND prev_r.raw_meter_reading >= e.raw_meter_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.blending_events next_r
          WHERE next_r.well_id = e.well_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND COALESCE(next_r.event_date, (next_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) > COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND next_r.raw_meter_reading <= e.raw_meter_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.power_readings r
          WHERE r.plant_id = e.plant_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'power'
            AND gr.entity_id = e.plant_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.power_readings prev_r
          WHERE prev_r.plant_id = e.plant_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND (
              (prev_r.meter_reading_kwh IS NOT NULL AND e.meter_reading_kwh IS NOT NULL AND prev_r.meter_reading_kwh >= e.meter_reading_kwh)
              OR
              (prev_r.grid_meter_readings ? '0' AND e.grid_meter_readings ? '0' AND (prev_r.grid_meter_readings ->> '0')::numeric >= (e.grid_meter_readings ->> '0')::numeric)
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.power_readings next_r
          WHERE next_r.plant_id = e.plant_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND (
              (next_r.meter_reading_kwh IS NOT NULL AND e.meter_reading_kwh IS NOT NULL AND next_r.meter_reading_kwh <= e.meter_reading_kwh)
              OR
              (next_r.grid_meter_readings ? '0' AND e.grid_meter_readings ? '0' AND (next_r.grid_meter_readings ->> '0')::numeric <= (e.grid_meter_readings ->> '0')::numeric)
            )
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.ro_train_readings r
          WHERE r.train_id = e.train_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'ro_train'
            AND gr.entity_id = e.train_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_trains t
          WHERE t.id = e.train_id AND t.status <> 'Running'
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_train_readings prev_r
          WHERE prev_r.train_id = e.train_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_permeate_meter_replacement, false) = false
            AND prev_r.permeate_meter >= e.permeate_meter
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_train_readings next_r
          WHERE next_r.train_id = e.train_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_permeate_meter_replacement, false) = false
            AND next_r.permeate_meter <= e.permeate_meter
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- EXEMPTION: Only cumulative odometer locators (default_input_mode <> 'direct'
  -- and is_derived = false). Direct volume locators must NEVER be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators
    WHERE status = 'Active'
      AND is_derived = false
      AND COALESCE(default_input_mode, 'raw') <> 'direct'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
            AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff > 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(r_day), 0)
              INTO v_hist_rate
              FROM (
                SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
                       current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_day
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date DESC, reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  -- Strict Monotonicity Guard: ensure v_val stays strictly between bounding readings
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, v_val, false
                    );
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          ELSIF v_diff <= 0 THEN
            -- Monotonicity violation on boundary readings: log skip
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                INSERT INTO public.backfill_sweep_log (
                  table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                ) VALUES (
                  'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', null, null, false
                );
                v_skipped_count := v_skipped_count + 1;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff > 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(r_day), 0)
              INTO v_hist_rate
              FROM (
                SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
                       current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_day
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date DESC, reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_prev_val := ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_u_prev := (k - 1)::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_prev_val := ROUND(r_reading_a.current_reading + (v_u_prev * v_dpre) + (v_u_prev * v_u_prev * v_curvature), 2);
                  END IF;
                  v_daily_vol := v_val - v_prev_val;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading OR v_daily_vol <= 0 THEN
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, v_val, false
                    );
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          ELSIF v_diff <= 0 THEN
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                INSERT INTO public.backfill_sweep_log (
                  table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                ) VALUES (
                  'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', null, null, false
                );
                v_skipped_count := v_skipped_count + 1;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- EXEMPTION: Only cumulative physical product meters (is_derived = false).
  -- Derived/virtual product meters (e.g. Parkmall, Coke, HAMAS) must never be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters
    WHERE status = 'Active'
      AND COALESCE(is_derived, false) = false
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff > 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(r_day), 0)
              INTO v_hist_rate
              FROM (
                SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
                       current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_day
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date DESC, reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_prev_val := ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_u_prev := (k - 1)::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_prev_val := ROUND(r_reading_a.current_reading + (v_u_prev * v_dpre) + (v_u_prev * v_u_prev * v_curvature), 2);
                  END IF;
                  v_daily_vol := v_val - v_prev_val;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading OR v_daily_vol <= 0 THEN
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, v_val, false
                    );
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          ELSIF v_diff <= 0 THEN
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                INSERT INTO public.backfill_sweep_log (
                  table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                ) VALUES (
                  'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', null, null, false
                );
                v_skipped_count := v_skipped_count + 1;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON (COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date))
             id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC, reading_datetime DESC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC, reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff > 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(r_day), 0)
              INTO v_hist_rate
              FROM (
                SELECT DISTINCT ON (COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date))
                       raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_day
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) < r_reading_a.r_date
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) DESC, reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_prev_val := ROUND(r_reading_a.raw_meter_reading + (v_step * (k - 1)), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_u_prev := (k - 1)::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_prev_val := ROUND(r_reading_a.raw_meter_reading + (v_u_prev * v_dpre) + (v_u_prev * v_u_prev * v_curvature), 2);
                  END IF;
                  v_daily_vol := v_val - v_prev_val;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.raw_meter_reading OR v_val >= r_reading_b.raw_meter_reading OR v_daily_vol <= 0 THEN
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, v_val, false
                    );
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          ELSIF v_diff <= 0 THEN
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                INSERT INTO public.backfill_sweep_log (
                  table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                ) VALUES (
                  'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', null, null, false
                );
                v_skipped_count := v_skipped_count + 1;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings) - MULTI-METER GRID SUPPORT
  -- EXEMPTION: Solar generation (daily_solar_kwh / solar_meter_reading) is direct
  -- power and is strictly EXEMPT from backfill. Only cumulative grid meters are
  -- backfilled. Plants without grid (has_grid = false) are skipped.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants
    WHERE status = 'Active'
      AND COALESCE(has_grid, true) = true
  LOOP
    -- Discover configured grid meter count and CT multipliers
    SELECT
      COALESCE(grid_meter_count, 1),
      grid_meter_multipliers
    INTO
      v_grid_meter_count,
      v_grid_meter_multipliers
    FROM public.plant_power_config
    WHERE plant_id = r_entity.plant_id;

    IF NOT FOUND OR v_grid_meter_count IS NULL OR v_grid_meter_count < 1 THEN
      v_grid_meter_count := 1;
    END IF;

    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          
          -- Dynamically ensure v_grid_meter_count covers all indices in both bounding rows
          IF r_reading_a.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_a.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;
          IF r_reading_b.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_b.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;

          -- Historical rate regression check for meter 0 if gap > 5 days
          v_hist_rate := NULL;
          IF v_gap_days > 5 THEN
            SELECT (
              COALESCE((r_reading_a.grid_meter_readings ->> '0')::numeric, r_reading_a.meter_reading_kwh)
              - MIN(COALESCE((grid_meter_readings ->> '0')::numeric, meter_reading_kwh))
            ) / NULLIF(r_reading_a.r_date - MIN(r_day), 0)
            INTO v_hist_rate
            FROM (
              SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
                     meter_reading_kwh, grid_meter_readings, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_day
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id
                AND COALESCE(is_estimated, false) = false
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
              ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date DESC, reading_datetime DESC
              LIMIT 7
            ) sub;
          END IF;

          IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
            v_method := 'even_split';
          ELSE
            v_method := 'regression_flowrate';
          END IF;

          FOR k IN 1..v_gap_days LOOP
            v_cur_date := r_reading_a.r_date + k;
            IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
              SELECT EXISTS (
                SELECT 1 FROM public.reading_gap_reasons
                WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
              ) INTO v_has_reason;

              v_existing_id := NULL;
              v_is_est := NULL;
              v_old_val := NULL;
              v_old_gmr := NULL;

              SELECT id, is_estimated, meter_reading_kwh, grid_meter_readings
              INTO v_existing_id, v_is_est, v_old_val, v_old_gmr
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
              ORDER BY COALESCE(is_estimated, false) ASC
              LIMIT 1;

              IF v_has_reason THEN
                IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                  DELETE FROM public.power_readings WHERE id = v_existing_id;
                  v_retracted_count := v_retracted_count + 1;
                END IF;
                v_skipped_count := v_skipped_count + 1;
              ELSE
                -- Build grid_meter_readings JSONB and total daily consumption across all grid meters
                v_gmr_jsonb := '{}'::jsonb;
                v_total_daily_kwh := 0;
                v_power_day_valid := true;

                FOR mi IN 0..(v_grid_meter_count - 1) LOOP
                  IF mi = 0 THEN
                    v_val_a := COALESCE(
                      CASE WHEN r_reading_a.grid_meter_readings ? '0' THEN (r_reading_a.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_a.meter_reading_kwh
                    );
                    v_val_b := COALESCE(
                      CASE WHEN r_reading_b.grid_meter_readings ? '0' THEN (r_reading_b.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_b.meter_reading_kwh
                    );
                  ELSE
                    v_val_a := (r_reading_a.grid_meter_readings ->> mi::text)::numeric;
                    v_val_b := (r_reading_b.grid_meter_readings ->> mi::text)::numeric;
                  END IF;

                  IF v_val_a IS NOT NULL AND v_val_b IS NOT NULL THEN
                    IF v_val_b < v_val_a THEN
                      -- Decreasing meter reading without meter replacement flag: invalidate entire day
                      v_power_day_valid := false;
                      EXIT;
                    END IF;

                    v_diff_m := v_val_b - v_val_a;
                    v_step_m := v_diff_m / (v_gap_days + 1);

                    -- Determine CT multiplier for this meter
                    v_mult_m := 1;
                    IF v_grid_meter_multipliers IS NOT NULL AND array_length(v_grid_meter_multipliers, 1) >= (mi + 1) THEN
                      v_mult_m := COALESCE(v_grid_meter_multipliers[mi + 1], 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    ELSE
                      v_mult_m := COALESCE(r_reading_a.meter_multiplier, r_reading_a.multiplier, 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    END IF;

                    IF v_method = 'even_split' THEN
                      v_val_m_k := ROUND(v_val_a + (v_step_m * k), 2);
                      v_prev_m_k := ROUND(v_val_a + (v_step_m * (k - 1)), 2);
                    ELSE
                      v_u := k::numeric / (v_gap_days + 1)::numeric;
                      v_u_prev := (k - 1)::numeric / (v_gap_days + 1)::numeric;
                      v_dpre_m := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff_m * 0.2), v_diff_m * 1.8);
                      v_curvature_m := v_diff_m - v_dpre_m;
                      v_val_m_k := ROUND(v_val_a + (v_u * v_dpre_m) + (v_u * v_u * v_curvature_m), 2);
                      v_prev_m_k := ROUND(v_val_a + (v_u_prev * v_dpre_m) + (v_u_prev * v_u_prev * v_curvature_m), 2);
                    END IF;

                    v_daily_m_k := v_val_m_k - v_prev_m_k;

                    -- Strict monotonicity per meter:
                    -- If meter is advancing, intermediate reading must strictly advance
                    IF v_val_b > v_val_a AND (v_val_m_k <= v_val_a OR v_val_m_k >= v_val_b OR v_daily_m_k <= 0) THEN
                      v_power_day_valid := false;
                      EXIT;
                    END IF;

                    v_kwh_m_k := v_daily_m_k * v_mult_m;
                    v_gmr_jsonb := v_gmr_jsonb || jsonb_build_object(mi::text, v_val_m_k);
                    v_total_daily_kwh := v_total_daily_kwh + v_kwh_m_k;
                  END IF;
                END LOOP;

                IF NOT v_power_day_valid OR v_gmr_jsonb = '{}'::jsonb THEN
                  INSERT INTO public.backfill_sweep_log (
                    table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                  ) VALUES (
                    'power_readings', null, null, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, null, false
                  );
                  v_skipped_count := v_skipped_count + 1;
                  CONTINUE;
                END IF;

                v_val := CASE WHEN v_gmr_jsonb ? '0' THEN (v_gmr_jsonb ->> '0')::numeric ELSE NULL END;
                v_daily_vol := ROUND(v_total_daily_kwh, 2);
                v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                -- NOTE: daily_solar_kwh and solar_meter_reading are NEVER backfilled
                IF v_existing_id IS NULL THEN
                  INSERT INTO public.power_readings (
                    plant_id, reading_datetime, meter_reading_kwh, grid_meter_readings,
                    daily_consumption_kwh, daily_grid_kwh, is_estimated
                  ) VALUES (
                    r_entity.plant_id, v_dt_iso, v_val, v_gmr_jsonb,
                    v_daily_vol, v_daily_vol, true
                  );
                  INSERT INTO public.backfill_sweep_log (
                    table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                  ) VALUES (
                    'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                  );
                  v_swept_count := v_swept_count + 1;
                ELSIF v_is_est = true AND (v_old_val IS DISTINCT FROM v_val OR v_old_gmr IS DISTINCT FROM v_gmr_jsonb) THEN
                  UPDATE public.power_readings
                  SET meter_reading_kwh = v_val,
                      grid_meter_readings = v_gmr_jsonb,
                      daily_consumption_kwh = v_daily_vol,
                      daily_grid_kwh = v_daily_vol,
                      daily_solar_kwh = NULL,
                      solar_meter_reading = NULL
                  WHERE id = v_existing_id;
                  INSERT INTO public.backfill_sweep_log (
                    table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                  ) VALUES (
                    'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                  );
                  v_swept_count := v_swept_count + 1;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff > 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN(r_day), 0)
              INTO v_hist_rate
              FROM (
                SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
                       permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_day
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND COALESCE(is_estimated, false) = false
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date DESC, reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_prev_val := ROUND(r_reading_a.permeate_meter + (v_step * (k - 1)), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_u_prev := (k - 1)::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_prev_val := ROUND(r_reading_a.permeate_meter + (v_u_prev * v_dpre) + (v_u_prev * v_u_prev * v_curvature), 2);
                  END IF;
                  v_daily_vol := v_val - v_prev_val;

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.permeate_meter OR v_val >= r_reading_b.permeate_meter OR v_daily_vol <= 0 THEN
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, v_val, false
                    );
                    v_skipped_count := v_skipped_count + 1;
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          ELSIF v_diff <= 0 THEN
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                INSERT INTO public.backfill_sweep_log (
                  table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                ) VALUES (
                  'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, 'monotonicity_rejected', null, null, false
                );
                v_skipped_count := v_skipped_count + 1;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

-- ─── 4. Security & Permissions (S6) ──────────────────────────────────────────
-- fn_backfill_missing_readings performs mutations across 6 reading tables.
-- Unauthenticated 'anon' must NOT have execute permissions on this function.
REVOKE EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, service_role;

-- ─── 5. Immediate Repair Sweep & Schema Cache Reload ──────────────────────────
SELECT public.fn_backfill_missing_readings((now() AT TIME ZONE 'Asia/Manila')::date, 30);
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260905000006_robust_backfill_and_audit.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260905000007_fix_production_costs_power_discrepancy.sql >>>>>>>
-- =============================================================================
-- Migration: 20260905000007_fix_production_costs_power_discrepancy.sql
--
-- FIX DAILY PRODUCTION COSTS DISCREPANCY & POWER SPIKE:
--   1. Update public.recompute_production_cost(_plant_id uuid, _date date):
--      - Correctly use Manila time zone for date matching: (reading_datetime AT TIME ZONE 'Asia/Manila')::date = _date
--      - Support modern daily_grid_kwh along with daily_consumption_kwh
--      - Remove double-multiplier multiplication: v_kwh is already multiplied kWh,
--        so v_power_cost := v_kwh * COALESCE(v_rate, 0)
--   2. Data Repair for SRP (Sep 1-5, 2026):
--      - Normalize power_readings.daily_grid_kwh and production_costs.power_cost
--        to distribute the 66,243 kWh across Sep 3 (28,320 kWh), Sep 4 (20,868 kWh),
--        and Sep 5 (17,055 kWh) instead of 0 on Sep 3/4 and 760,000 lump sum on Sep 5.
-- =============================================================================

-- ─── 1. Recreate recompute_production_cost ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_production_cost(_plant_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_chem numeric := 0;
  v_kwh numeric := 0;
  v_prod numeric := 0;
  v_rate numeric := 0;
  v_power_cost numeric := 0;
BEGIN
  SELECT COALESCE(SUM(calculated_cost), 0) INTO v_chem
  FROM public.chemical_dosing_logs
  WHERE plant_id = _plant_id AND (log_datetime AT TIME ZONE 'Asia/Manila')::date = _date;

  SELECT COALESCE(SUM(COALESCE(NULLIF(daily_grid_kwh, 0), NULLIF(daily_consumption_kwh, 0), 0)), 0) INTO v_kwh
  FROM public.power_readings
  WHERE plant_id = _plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = _date;

  SELECT COALESCE(SUM(daily_volume), 0) INTO v_prod
  FROM public.well_readings
  WHERE plant_id = _plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = _date;

  SELECT rate_per_kwh INTO v_rate
  FROM public.power_tariffs
  WHERE plant_id = _plant_id AND effective_date <= _date
  ORDER BY effective_date DESC LIMIT 1;

  -- v_kwh is physical kWh (already post-multiplier), rate is ₱/kWh
  v_power_cost := v_kwh * COALESCE(v_rate, 0);

  INSERT INTO public.production_costs(plant_id, cost_date, chem_cost, power_cost, production_m3, cost_per_m3)
  VALUES (_plant_id, _date, v_chem, v_power_cost, v_prod,
          CASE WHEN v_prod > 0 THEN (v_chem + v_power_cost) / v_prod ELSE NULL END)
  ON CONFLICT (plant_id, cost_date) DO UPDATE
  SET chem_cost = EXCLUDED.chem_cost,
      power_cost = EXCLUDED.power_cost,
      production_m3 = EXCLUDED.production_m3,
      cost_per_m3 = EXCLUDED.cost_per_m3,
      updated_at = now();
END;
$func$;

-- ─── 2. Data Repair for SRP (Sep 1–5, 2026) ──────────────────────────────────
DO $do$
DECLARE
  v_srp_id uuid;
  v_rate numeric;
BEGIN
  SELECT id INTO v_srp_id FROM public.plants WHERE name ILIKE '%SRP%' LIMIT 1;
  IF v_srp_id IS NOT NULL THEN
    -- Get current tariff rate for SRP
    SELECT rate_per_kwh INTO v_rate
    FROM public.power_tariffs
    WHERE plant_id = v_srp_id AND effective_date <= '2026-09-05'
    ORDER BY effective_date DESC LIMIT 1;
    v_rate := COALESCE(v_rate, 11.5);

    -- Normalize power_readings daily_grid_kwh
    UPDATE public.power_readings
    SET daily_grid_kwh = 28320
    WHERE plant_id = v_srp_id
      AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-09-03'
      AND (daily_grid_kwh IS NULL OR daily_grid_kwh = 0);

    UPDATE public.power_readings
    SET daily_grid_kwh = 20868
    WHERE plant_id = v_srp_id
      AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-09-04'
      AND (daily_grid_kwh IS NULL OR daily_grid_kwh = 0);

    UPDATE public.power_readings
    SET daily_grid_kwh = 17055
    WHERE plant_id = v_srp_id
      AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-09-05'
      AND daily_grid_kwh > 50000;

    -- Update production_costs for Sep 3, Sep 4, Sep 5
    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost, production_m3, cost_per_m3)
    VALUES (v_srp_id, '2026-09-03', ROUND(28320 * v_rate, 2), 0, 0, NULL)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
    SET power_cost = ROUND(28320 * v_rate, 2),
        cost_per_m3 = CASE WHEN production_costs.production_m3 > 0 THEN (COALESCE(production_costs.chem_cost, 0) + ROUND(28320 * v_rate, 2)) / production_costs.production_m3 ELSE NULL END,
        updated_at = now();

    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost, production_m3, cost_per_m3)
    VALUES (v_srp_id, '2026-09-04', ROUND(20868 * v_rate, 2), 0, 0, NULL)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
    SET power_cost = ROUND(20868 * v_rate, 2),
        cost_per_m3 = CASE WHEN production_costs.production_m3 > 0 THEN (COALESCE(production_costs.chem_cost, 0) + ROUND(20868 * v_rate, 2)) / production_costs.production_m3 ELSE NULL END,
        updated_at = now();

    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost, production_m3, cost_per_m3)
    VALUES (v_srp_id, '2026-09-05', ROUND(17055 * v_rate, 2), 0, 0, NULL)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
    SET power_cost = ROUND(17055 * v_rate, 2),
        cost_per_m3 = CASE WHEN production_costs.production_m3 > 0 THEN (COALESCE(production_costs.chem_cost, 0) + ROUND(17055 * v_rate, 2)) / production_costs.production_m3 ELSE NULL END,
        updated_at = now();
  END IF;
END;
$do$;

-- <<<<<<< END ARCHIVED: 20260905000007_fix_production_costs_power_discrepancy.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260906000001_security_emergency_fixes.sql >>>>>>>
-- Emergency security fixes identified during 2026-09-06 architecture review.
-- Addresses:
--   1. backfill_sweep_log fully open to anon (ALL policy created in 20260901000005)
--   2. locator_readings_latest SELECT granted to anon (20260905000001)
--   3. Search-path regressions on September functions (missing pg_temp)
--   4. Default PUBLIC execute grants on sensitive functions

-- ── 1. Drop the dangerously permissive anon policy on backfill_sweep_log ────
DROP POLICY IF EXISTS "backfill_sweep_log_anon" ON public.backfill_sweep_log;

-- Replace with authenticated-only read access for audit visibility
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'backfill_sweep_log'
      AND policyname = 'backfill_sweep_log_authenticated_read'
  ) THEN
    CREATE POLICY "backfill_sweep_log_authenticated_read"
      ON public.backfill_sweep_log FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- ── 2. Revoke anon access to locator_readings_latest view ──────────────────
REVOKE SELECT ON public.locator_readings_latest FROM anon;
-- Also check and revoke on other *_latest views that may have the same issue
DO $$ BEGIN
  EXECUTE 'REVOKE SELECT ON public.well_readings_latest FROM anon';
  EXECUTE 'REVOKE SELECT ON public.product_meter_readings_latest FROM anon';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 3. Re-harden search_path on ALL SECURITY DEFINER functions ─────────────
-- The original hardening in 20260831000002 was a one-time static loop.
-- Functions created or replaced in September 2026 missed this.
-- This dynamically finds and fixes all SECURITY DEFINER functions.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
      r.schema_name, r.function_name, r.args
    );
    RAISE NOTICE 'Hardened search_path: %.%(%)', r.schema_name, r.function_name, r.args;
  END LOOP;
END $$;

-- ── 4. Revoke default PUBLIC execute on sensitive mutation functions ────────
-- Postgres grants EXECUTE to PUBLIC by default on new functions.
-- These should only be callable by authenticated users or specific roles.
DO $$
DECLARE
  fn TEXT;
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fn_sweep_derived_meters',
    'fn_backfill_missing_readings',
    'fn_cascade_reading_correction',
    'fn_compute_daily_plant_summary',
    'recompute_production_cost'
  ] LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn, r.args);
      RAISE NOTICE 'Secured function: %(%)', fn, r.args;
    END LOOP;
  END LOOP;
END $$;

-- <<<<<<< END ARCHIVED: 20260906000001_security_emergency_fixes.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260906000002_performance_indexes_and_cost_trigger_optimization.sql >>>>>>>
-- Performance indexes and cost trigger optimization identified during 2026-09-06 architecture review.
-- Addresses:
--   1. Composite index on well_readings(well_id, reading_datetime DESC) for reading chain synchronization
--   2. Unique constraint index on power_readings(plant_id, reading_datetime) to prevent duplicate submissions
--   3. Foreign key indexes on hardware lifecycle replacement tables
--   4. Column-restricted cost recalculation triggers to eliminate redundant recalculation chains

-- ── 1. Composite & Unique Query Indexes ─────────────────────────────────────

-- Eliminates sequential bitmap scans on well reading chain traversal
CREATE INDEX IF NOT EXISTS idx_well_readings_well_dt
  ON public.well_readings(well_id, reading_datetime DESC);

-- Prevents race-condition duplicate power readings per plant/timestamp
CREATE UNIQUE INDEX IF NOT EXISTS idx_power_readings_plant_dt
  ON public.power_readings(plant_id, reading_datetime);

-- Indexes for meter replacement history joins
CREATE INDEX IF NOT EXISTS idx_well_meter_replacements_well_id
  ON public.well_meter_replacements(well_id);

CREATE INDEX IF NOT EXISTS idx_locator_meter_replacements_plant_id
  ON public.locator_meter_replacements(plant_id);

CREATE INDEX IF NOT EXISTS idx_product_meter_replacements_meter_id
  ON public.product_meter_replacements(meter_id);

-- ── 2. Cost Trigger Recalculation Optimization ──────────────────────────────
-- Restrict UPDATE triggers to only fire when relevant numeric/date columns change,
-- preventing write amplification during audit logs, status updates, or remarks edits.

DROP TRIGGER IF EXISTS trg_well_cost ON public.well_readings;
CREATE TRIGGER trg_well_cost
  AFTER INSERT OR DELETE OR UPDATE OF daily_volume, reading_datetime, well_id
  ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();

DROP TRIGGER IF EXISTS trg_power_cost ON public.power_readings;
CREATE TRIGGER trg_power_cost
  AFTER INSERT OR DELETE OR UPDATE OF total_kwh, total_cost, reading_datetime, plant_id
  ON public.power_readings
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();

DROP TRIGGER IF EXISTS trg_chem_cost ON public.chemical_dosing_logs;
CREATE TRIGGER trg_chem_cost
  AFTER INSERT OR DELETE OR UPDATE OF amount_used_kg, cost_php, date, plant_id
  ON public.chemical_dosing_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();

-- <<<<<<< END ARCHIVED: 20260906000002_performance_indexes_and_cost_trigger_optimization.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260906000003_revoke_anon_function_grants.sql >>>>>>>
-- =============================================================================
-- Migration: 20260906000003_revoke_anon_function_grants.sql
--
-- Purpose:
--   Closes the anon-execute hole left by 20260906000001. That migration
--   revoked PUBLIC execute on sensitive functions but did not remove earlier
--   explicit grants TO anon. In PostgreSQL, REVOKE FROM PUBLIC does not
--   affect explicit per-role grants, so these functions remained callable
--   by unauthenticated users via PostgREST RPC.
-- =============================================================================

DO $$
DECLARE
  fn TEXT;
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fn_sweep_derived_meters',
    'fn_backfill_missing_readings'
  ] LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn, r.args);
      RAISE NOTICE 'Secured function: %(%)', fn, r.args;
    END LOOP;
  END LOOP;
END $$;

-- <<<<<<< END ARCHIVED: 20260906000003_revoke_anon_function_grants.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260906000004_secure_remaining_function_grants.sql >>>>>>>
-- Security hardening follow-up: REVOKE default PUBLIC EXECUTE on remaining
-- September 2026 SECURITY DEFINER functions that were missed by the emergency
-- fix (20260906000001 only covered 5 named functions).
--
-- Affected functions:
--   fn_sync_well_reading_chain
--   fn_product_meter_reading_integrity
--   fn_sync_product_meter_reading_chain
--   fn_blending_set_reading
--   fn_sync_blending_reading_chain
--   fn_trg_sync_operator_presence
--
-- These are trigger-side functions (not user-facing RPCs), but PostgREST
-- still exposes any stored procedure as an RPC endpoint unless EXECUTE is
-- revoked from PUBLIC. Default-deny: authenticated users who need them
-- already have access via the role grants in their creation migrations; the
-- app never calls these directly from the client.

DO $$
DECLARE
  fn TEXT;
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fn_sync_well_reading_chain',
    'fn_product_meter_reading_integrity',
    'fn_sync_product_meter_reading_chain',
    'fn_blending_set_reading',
    'fn_sync_blending_reading_chain',
    'fn_trg_sync_operator_presence'
  ] LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn, r.args);
      RAISE NOTICE 'Secured function: %(%)', fn, r.args;
    END LOOP;
  END LOOP;
END $$;

-- <<<<<<< END ARCHIVED: 20260906000004_secure_remaining_function_grants.sql <<<<<<<

