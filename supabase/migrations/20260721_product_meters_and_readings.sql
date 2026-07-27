-- =============================================================================
-- Migration: 20260721_product_meters_and_readings.sql
--
-- Adds product_meters and product_meter_readings tables, which are referenced
-- throughout the frontend (ProductMeters.tsx, Dashboard.tsx,
-- EntityHistoryChart.tsx, LocatorDialogs.tsx) but were never codified in a
-- migration — they appear to have been created ad-hoc via the Supabase
-- dashboard.
--
-- Also adds:
--   • product_meter_audit_log (referenced in ProductMeters.tsx)
--   • locators.product_meter_id FK  (referenced in LocatorDialogs.tsx)
--   • ro_trains.product_meter_id FK (referenced in Dashboard.tsx)
--
-- All CREATE TABLE statements use IF NOT EXISTS so this is safe to run
-- against a database that already has these tables from a prior dashboard
-- operation.
-- =============================================================================

-- ── 1. product_meters ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_meters (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id             UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'Active'
                         CHECK (status IN ('Active', 'Inactive')),
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  meter_brand          TEXT,
  meter_size           TEXT,
  meter_serial         TEXT,
  meter_installed_date DATE,
  gps_lat              NUMERIC,
  gps_lng              NUMERIC,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_meters_plant
  ON product_meters (plant_id, status);

ALTER TABLE product_meters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meters_plant_access" ON product_meters;
CREATE POLICY "product_meters_plant_access" ON product_meters
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 2. product_meter_readings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_meter_readings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id          UUID        NOT NULL REFERENCES product_meters(id) ON DELETE CASCADE,
  plant_id          UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  reading_datetime  TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_reading   NUMERIC,
  previous_reading  NUMERIC,
  daily_volume      NUMERIC,
  recorded_by       UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmr_meter_dt
  ON product_meter_readings (meter_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_pmr_plant_dt
  ON product_meter_readings (plant_id, reading_datetime DESC);

ALTER TABLE product_meter_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meter_readings_plant_access" ON product_meter_readings;
CREATE POLICY "product_meter_readings_plant_access" ON product_meter_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 3. product_meter_audit_log ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_meter_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id    UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  meter_id    UUID        NOT NULL,
  meter_name  TEXT,
  old_value   TEXT,
  new_value   TEXT,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_audit_plant
  ON product_meter_audit_log (plant_id, timestamp DESC);

ALTER TABLE product_meter_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meter_audit_read" ON product_meter_audit_log;
CREATE POLICY "product_meter_audit_read" ON product_meter_audit_log
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "product_meter_audit_write" ON product_meter_audit_log;
CREATE POLICY "product_meter_audit_write" ON product_meter_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 4. FK columns on existing tables ─────────────────────────────────────────
-- locators.product_meter_id  (LocatorDialogs.tsx, Dashboard.tsx)
-- ro_trains.product_meter_id (Dashboard.tsx)

ALTER TABLE locators  ADD COLUMN IF NOT EXISTS product_meter_id UUID
  REFERENCES product_meters(id) ON DELETE SET NULL;

ALTER TABLE ro_trains ADD COLUMN IF NOT EXISTS product_meter_id UUID
  REFERENCES product_meters(id) ON DELETE SET NULL;

-- Reload PostgREST schema cache so the new tables are immediately visible.
NOTIFY pgrst, 'reload schema';
