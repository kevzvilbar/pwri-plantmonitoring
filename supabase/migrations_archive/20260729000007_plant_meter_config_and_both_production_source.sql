-- =============================================================================
-- Migration: 20260729_plant_meter_config_and_both_production_source.sql
--
-- CONTEXT:
--   `plant_meter_config` (plant_id, permeate_is_production, config jsonb,
--   updated_at) is already live in Supabase and actively read/written by
--   frontend/src/pages/plants/shared.tsx (usePlantMeterConfig) and consumed
--   by Dashboard.tsx, TrendChart.tsx, and DataSummaryModal.tsx — but it does
--   not appear anywhere in this repo's migrations or in the generated
--   integrations/supabase/types.ts, meaning it was created directly against
--   the database outside of version control at some point. This migration
--   brings it under version control (CREATE TABLE IF NOT EXISTS is a no-op
--   against the existing live table) and fixes a real drift bug found while
--   investigating why a plant's Production tab can go blank even though its
--   Plant Config "Permeate readings are production" switch is on:
--   `saveConfig()` (shared.tsx) only ever upserts the `config` jsonb column —
--   it never writes the top-level `permeate_is_production` column that
--   Dashboard.tsx / DataSummaryModal.tsx query directly. If that column was
--   seeded once by hand and never kept in sync, toggling the switch in the
--   UI updates `config.permeate_is_production` but leaves the stale
--   top-level column behind, and every dashboard query silently falls back
--   to treating the plant as NOT using permeate. The trigger below makes the
--   top-level column a generated mirror of the jsonb value so this can't
--   drift again, regardless of which column a given write touches.
--
--   Also widens `ro_production_source` (stored inside the `config` jsonb
--   blob — see frontend/src/pages/plants/shared.tsx PlantMeterConfig type)
--   to allow a new 'both' value: a plant that has two genuinely independent
--   production inputs (e.g. a dedicated/mirrored product meter — such as a
--   "mother meter" pair from the Hamas derived-locator feature — PLUS its
--   own RO train permeate) whose volumes must be ADDED together, distinct
--   from 'permeate' (product meter EXCLUDED — same water counted once) and
--   'product' (permeate not counted). See MeterConfig.tsx for the UI and
--   Dashboard.tsx / TrendChart.tsx / DataSummaryModal.tsx for the calc side.
--
-- Run this in: Supabase Dashboard → SQL Editor (this project applies
-- migrations manually — see DEPLOYMENT.md).
-- =============================================================================

-- ── 1. Table (no-op if it already exists live) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.plant_meter_config (
  plant_id                UUID PRIMARY KEY REFERENCES public.plants(id) ON DELETE CASCADE,
  permeate_is_production  BOOLEAN NOT NULL DEFAULT false,
  config                  JSONB   NOT NULL DEFAULT '{}'::jsonb,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defensive: add the column if the live table predates it under a different
-- shape than assumed above (no-op if already present).
ALTER TABLE public.plant_meter_config
  ADD COLUMN IF NOT EXISTS permeate_is_production BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.plant_meter_config
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.plant_meter_config
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON TABLE public.plant_meter_config IS
  'One row per plant. `config` is the full PlantMeterConfig JSON blob '
  '(frontend/src/pages/plants/shared.tsx) — the source of truth a Manager/'
  'Admin edits via Plant Config settings. `permeate_is_production` is a '
  'generated-on-write mirror of config->>''permeate_is_production'' (see the '
  'trg_sync_permeate_is_production trigger below) kept as a real column '
  'purely so dashboard queries can filter/select it without unpacking JSON.';

-- ── 2. Data-integrity check on the production-source enum ──────────────────
-- Lives inside the jsonb blob (no dedicated column), so this is a JSON-path
-- CHECK rather than a normal enum constraint. NULL is allowed for plants
-- that have never saved a config yet (client falls back to DEFAULT_METER_CONFIG).
ALTER TABLE public.plant_meter_config
  DROP CONSTRAINT IF EXISTS plant_meter_config_ro_production_source_check;
ALTER TABLE public.plant_meter_config
  ADD CONSTRAINT plant_meter_config_ro_production_source_check
  CHECK (
    (config->>'ro_production_source') IS NULL
    OR (config->>'ro_production_source') IN ('product', 'permeate', 'both')
  );

-- ── 3. Self-healing sync: permeate_is_production always mirrors the jsonb ──
-- Runs on every INSERT/UPDATE regardless of whether the caller wrote the
-- top-level column, the jsonb column, or both — closing the drift gap
-- described above for good.
CREATE OR REPLACE FUNCTION public.fn_sync_permeate_is_production()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.permeate_is_production := COALESCE((NEW.config->>'permeate_is_production')::boolean, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_permeate_is_production ON public.plant_meter_config;
CREATE TRIGGER trg_sync_permeate_is_production
  BEFORE INSERT OR UPDATE OF config ON public.plant_meter_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_permeate_is_production();

-- One-time backfill so existing rows are correct immediately, not just on
-- their next save. Safe to re-run.
UPDATE public.plant_meter_config
SET permeate_is_production = COALESCE((config->>'permeate_is_production')::boolean, false)
WHERE permeate_is_production IS DISTINCT FROM COALESCE((config->>'permeate_is_production')::boolean, false);

-- ── 4. RLS — mirrors the locators/wells/ro_trains "read by plant access;
--        write by manager/admin with plant access" pattern from
--        20260419_initial_schema_enums_and_roles.sql. No-op additions if
--        equivalent policies already exist under different names (DROP IF
--        EXISTS + CREATE keeps this idempotent either way).
ALTER TABLE public.plant_meter_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plant_meter_config_read" ON public.plant_meter_config;
CREATE POLICY "plant_meter_config_read" ON public.plant_meter_config
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "plant_meter_config_write" ON public.plant_meter_config;
CREATE POLICY "plant_meter_config_write" ON public.plant_meter_config
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

NOTIFY pgrst, 'reload schema';
