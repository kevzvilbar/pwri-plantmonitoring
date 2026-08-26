-- =============================================================================
-- Migration: 20260727_meter_replacement_wiring.sql
--
-- Wires "Replace Meter" into the actual reading-history UI across all four
-- meter-bearing modules (Wells, Locators, Product Meters, RO Trains), instead
-- of the current bare "Repl." checkbox that just flips is_meter_replacement
-- with no record of what the old/new meter actually was.
--
--   1. reading_id on well_meter_replacements / locator_meter_replacements
--      — links a replacement record back to the specific reading that
--        triggered it (was previously untracked).
--   2. product_meters already has meter_brand/size/serial/installed_date
--      (added ad-hoc, codified in 20260721_product_meters_and_readings.sql)
--      but had no replacements table to log swaps against — added here as
--      product_meter_replacements, mirroring locator_meter_replacements.
--   3. ro_trains gets 12 new per-meter identity columns (feed/permeate/reject
--      × brand/size/serial/installed_date) — previously trains had zero
--      meter-identity fields despite already tracking per-meter prev/delta
--      readings.
--   4. ro_train_readings gets three granular replacement flags
--      (is_feed/permeate/reject_meter_replacement) so a Feed meter swap no
--      longer has to share one flag with a Permeate or Reject swap. Existing
--      is_meter_replacement rows are backfilled onto is_permeate_meter_replacement
--      (the only meter type whose delta the app actually recomputed before
--      this migration), and is_meter_replacement itself is kept as a
--      generated OR of the three granular flags so every existing downstream
--      consumer (Dashboard, TrendChart, DataSummaryModal, CSV exports,
--      helpers.recalculateTrainDeltas, etc.) keeps working unchanged.
--   5. ro_train_meter_replacements — new table, one row per train per meter
--      swap, parallel to well/locator/product_meter_replacements.
--
-- All statements use IF NOT EXISTS / OR REPLACE so this is safe to re-run.
-- =============================================================================

-- ── 1. reading_id on the existing well/locator replacement tables ───────────

ALTER TABLE public.well_meter_replacements
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.well_readings(id) ON DELETE SET NULL;

ALTER TABLE public.locator_meter_replacements
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.locator_readings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wmr_reading ON public.well_meter_replacements(reading_id);
CREATE INDEX IF NOT EXISTS idx_lmr_reading ON public.locator_meter_replacements(reading_id);

-- ── 2. product_meter_replacements ────────────────────────────────────────────
-- Mirrors locator_meter_replacements' column naming (product_meters uses the
-- same meter_brand/meter_size/meter_serial/meter_installed_date shape as
-- locators, not wells' unprefixed brand/size/serial).

CREATE TABLE IF NOT EXISTS public.product_meter_replacements (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id                  UUID        NOT NULL REFERENCES public.product_meters(id) ON DELETE CASCADE,
  plant_id                  UUID        NOT NULL REFERENCES public.plants(id),
  reading_id                UUID        REFERENCES public.product_meter_readings(id) ON DELETE SET NULL,
  replacement_date          DATE        NOT NULL,
  old_meter_brand           TEXT,
  old_meter_size            TEXT,
  old_meter_serial          TEXT,
  old_meter_final_reading   NUMERIC,
  new_meter_brand           TEXT,
  new_meter_size            TEXT,
  new_meter_serial          TEXT,
  new_meter_initial_reading NUMERIC,
  new_meter_installed_date  DATE,
  replaced_by               UUID        REFERENCES public.user_profiles(id),
  remarks                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmr_repl_meter   ON public.product_meter_replacements(meter_id);
CREATE INDEX IF NOT EXISTS idx_pmr_repl_reading ON public.product_meter_replacements(reading_id);

ALTER TABLE public.product_meter_replacements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meter_replacements_plant_access" ON public.product_meter_replacements;
CREATE POLICY "product_meter_replacements_plant_access" ON public.product_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 3. ro_trains — per-meter identity columns ────────────────────────────────

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS feed_meter_brand              TEXT,
  ADD COLUMN IF NOT EXISTS feed_meter_size                TEXT,
  ADD COLUMN IF NOT EXISTS feed_meter_serial              TEXT,
  ADD COLUMN IF NOT EXISTS feed_meter_installed_date      DATE,
  ADD COLUMN IF NOT EXISTS permeate_meter_brand           TEXT,
  ADD COLUMN IF NOT EXISTS permeate_meter_size            TEXT,
  ADD COLUMN IF NOT EXISTS permeate_meter_serial          TEXT,
  ADD COLUMN IF NOT EXISTS permeate_meter_installed_date  DATE,
  ADD COLUMN IF NOT EXISTS reject_meter_brand             TEXT,
  ADD COLUMN IF NOT EXISTS reject_meter_size              TEXT,
  ADD COLUMN IF NOT EXISTS reject_meter_serial            TEXT,
  ADD COLUMN IF NOT EXISTS reject_meter_installed_date    DATE;

COMMENT ON COLUMN public.ro_trains.feed_meter_serial IS
  'Current feed-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''feed'').';
COMMENT ON COLUMN public.ro_trains.permeate_meter_serial IS
  'Current permeate-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''permeate'').';
COMMENT ON COLUMN public.ro_trains.reject_meter_serial IS
  'Current reject-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''reject'').';

-- ── 4. ro_train_readings — granular replacement flags ───────────────────────

ALTER TABLE public.ro_train_readings
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_feed_meter_replacement     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_permeate_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reject_meter_replacement   BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every pre-existing is_meter_replacement row was set through the
-- old shared toggle, whose only real effect was zeroing permeate_meter_delta
-- (recalculateTrainDeltas never looked at feed/reject) — so backfill those
-- rows onto the permeate flag specifically, not all three.
UPDATE public.ro_train_readings
  SET is_permeate_meter_replacement = true
  WHERE is_meter_replacement = true
    AND is_permeate_meter_replacement = false;

COMMENT ON COLUMN public.ro_train_readings.is_feed_meter_replacement IS
  'True when this reading immediately follows a feed-meter swap.';
COMMENT ON COLUMN public.ro_train_readings.is_permeate_meter_replacement IS
  'True when this reading immediately follows a permeate-meter swap. permeate_meter_delta is treated as 0 for this row.';
COMMENT ON COLUMN public.ro_train_readings.is_reject_meter_replacement IS
  'True when this reading immediately follows a reject-meter swap.';

-- Keep the legacy shared is_meter_replacement column in sync as an OR of the
-- three granular flags, so every existing consumer that still reads
-- is_meter_replacement (Dashboard.tsx, TrendChart.tsx, DataSummaryModal.tsx,
-- CSV export, helpers.recalculateTrainDeltas) continues to see the same
-- true/false it always has, with zero changes required on their end.
--
-- is_meter_replacement is treated as fully DERIVED here — this trigger always
-- overwrites it from the three granular flags and ignores whatever value (if
-- any) was supplied for is_meter_replacement itself in the same statement.
-- (Confirmed the only two writers of this column — TrainLogModal.tsx and
-- TrainDetail.tsx's toggleMeterReplacement — are being updated in this same
-- change to only ever set the granular flags, never is_meter_replacement
-- directly, so this is safe.) A one-way OR that also included the incoming
-- is_meter_replacement value would latch true forever once set, since
-- clearing all three granular flags would never be able to pull a
-- previously-true shared flag back down to false.
CREATE OR REPLACE FUNCTION public.sync_ro_train_reading_meter_replacement_flag()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_meter_replacement := (
    NEW.is_feed_meter_replacement
    OR NEW.is_permeate_meter_replacement
    OR NEW.is_reject_meter_replacement
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ro_train_reading_meter_replacement ON public.ro_train_readings;
CREATE TRIGGER trg_sync_ro_train_reading_meter_replacement
  BEFORE INSERT OR UPDATE ON public.ro_train_readings
  FOR EACH ROW EXECUTE FUNCTION public.sync_ro_train_reading_meter_replacement_flag();

-- ── 5. ro_train_meter_replacements ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ro_train_meter_replacements (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id                  UUID        NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id                  UUID        NOT NULL REFERENCES public.plants(id),
  reading_id                UUID        REFERENCES public.ro_train_readings(id) ON DELETE SET NULL,
  meter_type                TEXT        NOT NULL CHECK (meter_type IN ('feed', 'permeate', 'reject')),
  replacement_date          DATE        NOT NULL,
  old_meter_serial          TEXT,
  old_meter_final_reading   NUMERIC,
  new_meter_brand           TEXT,
  new_meter_size            TEXT,
  new_meter_serial          TEXT,
  new_meter_initial_reading NUMERIC,
  new_meter_installed_date  DATE,
  replaced_by               UUID        REFERENCES public.user_profiles(id),
  remarks                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rtmr_train   ON public.ro_train_meter_replacements(train_id, meter_type);
CREATE INDEX IF NOT EXISTS idx_rtmr_reading ON public.ro_train_meter_replacements(reading_id);

ALTER TABLE public.ro_train_meter_replacements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ro_train_meter_replacements_plant_access" ON public.ro_train_meter_replacements;
CREATE POLICY "ro_train_meter_replacements_plant_access" ON public.ro_train_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 6. Reload PostgREST schema cache ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
