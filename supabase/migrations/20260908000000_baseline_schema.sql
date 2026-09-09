-- =============================================================================
-- Migration: 20260908000000_baseline_schema.sql
-- Baseline schema squash - represents complete database state as of 2026-09-08
-- Generated from 121 archived migrations + 0 reconciliation migration(s)
-- =============================================================================
-- 
-- This migration consolidates all historical migrations into a single baseline.
-- Subsequent migrations (20260909000001+) should be applied on top of this baseline.
-- 
-- To verify: apply this migration to a fresh database, then apply all migrations
-- with timestamp > 20260908000000. The result should match production.
-- =============================================================================

-- >>>>>>> BEGIN ARCHIVED: 20260419000001_initial_schema_enums_and_roles.sql >>>>>>>

-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('Operator','Technician','Manager','Admin','Data Analyst');
CREATE TYPE public.profile_status AS ENUM ('Pending','Active','Suspended');
CREATE TYPE public.plant_status AS ENUM ('Active','Inactive');
CREATE TYPE public.train_status AS ENUM ('Running','Offline','Maintenance');
CREATE TYPE public.severity_level AS ENUM ('Low','Medium','High','Critical');
CREATE TYPE public.incident_status AS ENUM ('Open','InProgress','Resolved','Closed');
CREATE TYPE public.frequency_type AS ENUM ('Daily','Weekly','Monthly','Quarterly','Yearly');

-- =========================================================
-- HELPER: updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================
-- PLANTS
-- =========================================================
CREATE TABLE public.plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  status public.plant_status NOT NULL DEFAULT 'Active',
  design_capacity_m3 NUMERIC,
  num_ro_trains INTEGER NOT NULL DEFAULT 0,
  address TEXT,
  gps_lat NUMERIC,
  gps_lng NUMERIC,
  geofence_radius_m INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_plants_updated BEFORE UPDATE ON public.plants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- USER PROFILES (no role column!)
-- =========================================================
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  suffix TEXT,
  designation TEXT,
  immediate_head_id UUID REFERENCES public.user_profiles(id),
  plant_assignments UUID[] NOT NULL DEFAULT '{}',
  status public.profile_status NOT NULL DEFAULT 'Pending',
  profile_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_profiles_updated BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- USER ROLES (separate for security)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- =========================================================
-- SECURITY DEFINER HELPERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'Admin');
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('Admin','Manager'));
$$;

CREATE OR REPLACE FUNCTION public.user_has_plant_access(_plant_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND _plant_id = ANY(plant_assignments)
    );
$$;

-- =========================================================
-- LOCATORS
-- =========================================================
CREATE TABLE public.locators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_desc TEXT,
  address TEXT,
  gps_lat NUMERIC,
  gps_lng NUMERIC,
  meter_brand TEXT,
  meter_size TEXT,
  meter_serial TEXT,
  meter_installed_date DATE,
  status public.plant_status NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_locators_plant ON public.locators(plant_id);
CREATE TRIGGER trg_locators_updated BEFORE UPDATE ON public.locators
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.locator_meter_replacements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locator_id UUID NOT NULL REFERENCES public.locators(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  replacement_date DATE NOT NULL,
  old_meter_brand TEXT, old_meter_size TEXT, old_meter_serial TEXT,
  old_meter_final_reading NUMERIC,
  new_meter_brand TEXT, new_meter_size TEXT, new_meter_serial TEXT,
  new_meter_initial_reading NUMERIC,
  new_meter_installed_date DATE,
  replaced_by UUID REFERENCES public.user_profiles(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lmr_locator ON public.locator_meter_replacements(locator_id);

CREATE TABLE public.locator_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locator_id UUID NOT NULL REFERENCES public.locators(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_reading NUMERIC NOT NULL,
  previous_reading NUMERIC,
  daily_volume NUMERIC GENERATED ALWAYS AS (current_reading - COALESCE(previous_reading,0)) STORED,
  gps_lat NUMERIC, gps_lng NUMERIC,
  off_location_flag BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID REFERENCES public.user_profiles(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lr_plant_dt ON public.locator_readings(plant_id, reading_datetime DESC);
CREATE INDEX idx_lr_locator_dt ON public.locator_readings(locator_id, reading_datetime DESC);

-- =========================================================
-- WELLS
-- =========================================================
CREATE TABLE public.wells (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size TEXT,
  status public.plant_status NOT NULL DEFAULT 'Active',
  diameter TEXT,
  drilling_depth_m NUMERIC,
  has_power_meter BOOLEAN NOT NULL DEFAULT FALSE,
  meter_brand TEXT, meter_size TEXT, meter_serial TEXT,
  meter_installed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wells_plant ON public.wells(plant_id);
CREATE TRIGGER trg_wells_updated BEFORE UPDATE ON public.wells
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.well_pms_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id UUID NOT NULL REFERENCES public.wells(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  record_type TEXT NOT NULL DEFAULT 'PMS' CHECK (record_type IN ('PMS','Pump Replacement','Monthly PWL')),
  date_gathered DATE NOT NULL,
  static_water_level_m NUMERIC,
  pumping_water_level_m NUMERIC,
  pump_setting TEXT,
  pump_installed TEXT,
  motor_hp NUMERIC,
  tds_ppm NUMERIC,
  turbidity_ntu NUMERIC,
  recorded_by UUID REFERENCES public.user_profiles(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wpms_well ON public.well_pms_records(well_id);

CREATE TABLE public.well_meter_replacements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id UUID NOT NULL REFERENCES public.wells(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  replacement_date DATE NOT NULL,
  old_serial TEXT, old_final_reading NUMERIC,
  new_brand TEXT, new_size TEXT, new_serial TEXT,
  new_initial_reading NUMERIC, new_installed_date DATE,
  replaced_by UUID REFERENCES public.user_profiles(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.well_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id UUID NOT NULL REFERENCES public.wells(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_reading NUMERIC,
  previous_reading NUMERIC,
  daily_volume NUMERIC,
  power_meter_reading NUMERIC,
  gps_lat NUMERIC, gps_lng NUMERIC,
  off_location_flag BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wr_plant_dt ON public.well_readings(plant_id, reading_datetime DESC);

-- =========================================================
-- RO TRAINS
-- =========================================================
CREATE TABLE public.ro_trains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  train_number INTEGER NOT NULL,
  name TEXT,
  status public.train_status NOT NULL DEFAULT 'Running',
  num_afm INTEGER NOT NULL DEFAULT 0,
  num_booster_pumps INTEGER NOT NULL DEFAULT 0,
  num_hp_pumps INTEGER NOT NULL DEFAULT 0,
  num_cartridge_filters INTEGER NOT NULL DEFAULT 0,
  num_filter_housings INTEGER NOT NULL DEFAULT 0,
  num_controllers INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plant_id, train_number)
);
CREATE TRIGGER trg_ro_trains_updated BEFORE UPDATE ON public.ro_trains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ro_train_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id UUID NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  feed_meter NUMERIC, permeate_meter NUMERIC, reject_meter NUMERIC,
  feed_flow NUMERIC, permeate_flow NUMERIC, reject_flow NUMERIC,
  suction_pressure_psi NUMERIC,
  feed_pressure_psi NUMERIC,
  reject_pressure_psi NUMERIC,
  dp_psi NUMERIC,
  recovery_pct NUMERIC,
  rejection_pct NUMERIC,
  salt_passage_pct NUMERIC,
  feed_tds NUMERIC, permeate_tds NUMERIC, reject_tds NUMERIC,
  feed_ph NUMERIC, permeate_ph NUMERIC, reject_ph NUMERIC,
  turbidity_ntu NUMERIC, temperature_c NUMERIC,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rtr_train_dt ON public.ro_train_readings(train_id, reading_datetime DESC);
CREATE INDEX idx_rtr_plant_dt ON public.ro_train_readings(plant_id, reading_datetime DESC);

CREATE TABLE public.afm_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id UUID NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  afm_unit_number INTEGER NOT NULL,
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL DEFAULT 'Running' CHECK (mode IN ('Running','Backwash')),
  inlet_pressure_psi NUMERIC, outlet_pressure_psi NUMERIC,
  dp_psi NUMERIC,
  backwash_start TIMESTAMPTZ, backwash_end TIMESTAMPTZ,
  meter_initial NUMERIC, meter_final NUMERIC,
  backwash_volume NUMERIC,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pump_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id UUID NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  pump_type TEXT NOT NULL CHECK (pump_type IN ('Booster','HighPressure')),
  pump_number INTEGER NOT NULL,
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_pressure_psi NUMERIC,
  l1_amp NUMERIC, l2_amp NUMERIC, l3_amp NUMERIC,
  voltage NUMERIC,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cartridge_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id UUID NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  cartridge_number INTEGER NOT NULL,
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  inlet_pressure_psi NUMERIC, outlet_pressure_psi NUMERIC,
  dp_psi NUMERIC,
  bag_replaced BOOLEAN NOT NULL DEFAULT FALSE,
  pieces_replaced INTEGER,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cip_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id UUID NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  start_datetime TIMESTAMPTZ,
  end_datetime TIMESTAMPTZ,
  sls_g NUMERIC,
  hcl_l NUMERIC,
  caustic_soda_kg NUMERIC,
  conducted_by UUID REFERENCES public.user_profiles(id),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- CHEMICALS
-- =========================================================
CREATE TABLE public.chemical_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  chemical_name TEXT NOT NULL,
  unit TEXT,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plant_id, chemical_name)
);
CREATE TRIGGER trg_chem_inv_updated BEFORE UPDATE ON public.chemical_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.chemical_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chemical_name TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  effective_date DATE NOT NULL,
  updated_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cp_chem_date ON public.chemical_prices(chemical_name, effective_date DESC);

CREATE TABLE public.chemical_dosing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  log_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  chlorine_kg NUMERIC NOT NULL DEFAULT 0,
  smbs_kg NUMERIC NOT NULL DEFAULT 0,
  anti_scalant_l NUMERIC NOT NULL DEFAULT 0,
  soda_ash_kg NUMERIC NOT NULL DEFAULT 0,
  free_chlorine_reagent_pcs INTEGER NOT NULL DEFAULT 0,
  product_water_free_cl_ppm NUMERIC,
  calculated_cost NUMERIC,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cdl_plant_dt ON public.chemical_dosing_logs(plant_id, log_datetime DESC);

CREATE TABLE public.power_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  reading_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
  meter_reading_kwh NUMERIC NOT NULL,
  daily_consumption_kwh NUMERIC,
  recorded_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pr_plant_dt ON public.power_readings(plant_id, reading_datetime DESC);

-- =========================================================
-- MAINTENANCE
-- =========================================================
CREATE TABLE public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID REFERENCES public.plants(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  equipment_name TEXT NOT NULL,
  frequency public.frequency_type NOT NULL,
  checklist_steps TEXT[],
  schedule_start_date DATE,
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.checklist_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  plant_id UUID REFERENCES public.plants(id),
  execution_date DATE NOT NULL DEFAULT CURRENT_DATE,
  frequency public.frequency_type,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by UUID REFERENCES public.user_profiles(id),
  completed_at TIMESTAMPTZ,
  findings TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ce_template ON public.checklist_executions(template_id);

-- =========================================================
-- INCIDENTS
-- =========================================================
CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id),
  incident_ref TEXT UNIQUE,
  incident_type TEXT,
  severity public.severity_level,
  status public.incident_status NOT NULL DEFAULT 'Open',
  what_description TEXT,
  where_location TEXT,
  gps_lat NUMERIC, gps_lng NUMERIC,
  when_datetime TIMESTAMPTZ,
  who_reporter UUID REFERENCES public.user_profiles(id),
  witness TEXT,
  weather TEXT,
  temperature_c NUMERIC,
  immediate_action TEXT,
  photo_url TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  preventive_measures TEXT,
  resolved_by UUID REFERENCES public.user_profiles(id),
  resolved_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.user_profiles(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-generate incident_ref like INC-2026-001
CREATE OR REPLACE FUNCTION public.generate_incident_ref()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  cnt INTEGER;
BEGIN
  IF NEW.incident_ref IS NULL THEN
    SELECT COUNT(*)+1 INTO cnt FROM public.incidents WHERE incident_ref LIKE 'INC-'||yr||'-%';
    NEW.incident_ref := 'INC-'||yr||'-'||lpad(cnt::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_incident_ref BEFORE INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.generate_incident_ref();

-- =========================================================
-- NOTIFICATIONS
-- =========================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plant_id UUID REFERENCES public.plants(id),
  alert_type TEXT NOT NULL,
  severity public.severity_level NOT NULL DEFAULT 'Medium',
  title TEXT NOT NULL,
  message TEXT,
  link_path TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user_read ON public.notifications(user_id, read, created_at DESC);

-- =========================================================
-- PROFILE AUTO-CREATE on auth signup
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id, status, profile_complete)
  VALUES (NEW.id, 'Pending', FALSE)
  ON CONFLICT (id) DO NOTHING;
  -- default role: Operator (Pending status keeps them locked out of writes)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'Operator')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- ENABLE RLS ON ALL TABLES
-- =========================================================
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locator_meter_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locator_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.well_pms_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.well_meter_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.well_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ro_trains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ro_train_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afm_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pump_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartridge_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cip_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_dosing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.power_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- PLANTS: any authenticated user can read; only admin/manager can write
CREATE POLICY "plants_select_authenticated" ON public.plants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "plants_write_admin_manager" ON public.plants
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- USER_PROFILES: read all (for dropdowns); user updates own; admin updates anyone
CREATE POLICY "profiles_select_authenticated" ON public.user_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_self" ON public.user_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_self" ON public.user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_admin_all" ON public.user_profiles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- USER_ROLES: only admins manage; users can see their own
CREATE POLICY "roles_select_self" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "roles_admin_all" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- LOCATORS / WELLS / RO_TRAINS: read by plant access; write by manager/admin with plant access
CREATE POLICY "locators_read" ON public.locators
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));
CREATE POLICY "locators_write" ON public.locators
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

CREATE POLICY "wells_read" ON public.wells
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));
CREATE POLICY "wells_write" ON public.wells
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

CREATE POLICY "ro_trains_read" ON public.ro_trains
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));
CREATE POLICY "ro_trains_write" ON public.ro_trains
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- READINGS / OPERATIONAL DATA: full access for assigned plant users (operators write data)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'locator_meter_replacements','locator_readings',
    'well_pms_records','well_meter_replacements','well_readings',
    'ro_train_readings','afm_readings','pump_readings','cartridge_readings','cip_logs',
    'chemical_inventory','chemical_dosing_logs','power_readings',
    'checklist_executions','incidents'
  ])
  LOOP
    EXECUTE format('CREATE POLICY "%s_plant_access" ON public.%I FOR ALL TO authenticated USING (public.user_has_plant_access(plant_id)) WITH CHECK (public.user_has_plant_access(plant_id));', t, t);
  END LOOP;
END $$;

-- CHEMICAL PRICES: any auth read; manager/admin write
CREATE POLICY "chem_prices_read" ON public.chemical_prices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "chem_prices_write" ON public.chemical_prices
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- CHECKLIST TEMPLATES: any auth read; manager/admin write
CREATE POLICY "checklist_templates_read" ON public.checklist_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "checklist_templates_write" ON public.checklist_templates
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- NOTIFICATIONS: own only
CREATE POLICY "notifications_own_select" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notifications_own_update" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_insert_authenticated" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- =========================================================
-- SEED PLANTS
-- =========================================================
INSERT INTO public.plants (name, status, design_capacity_m3, num_ro_trains, address, gps_lat, gps_lng) VALUES
  ('Mambaling','Active', 5000, 10, 'Brgy. Mambaling, Cebu City', 10.2931, 123.8766),
  ('SRP','Active', 4200, 7, 'South Road Properties, Cebu City', 10.2711, 123.8724),
  ('Guizo','Active', 1800, 2, 'Guizo, Mandaue City', 10.3311, 123.9222),
  ('Umapad','Active', 6000, 11, 'Umapad, Mandaue City', 10.3488, 123.9388);

-- <<<<<<< END ARCHIVED: 20260419000001_initial_schema_enums_and_roles.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260419000002_notifications_rls.sql >>>>>>>

DROP POLICY IF EXISTS "notifications_insert_authenticated" ON public.notifications;
CREATE POLICY "notifications_insert_self" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- <<<<<<< END ARCHIVED: 20260419000002_notifications_rls.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260420000001_chemical_deliveries.sql >>>>>>>
-- ============ chemical_deliveries ============
CREATE TABLE public.chemical_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  chemical_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'kg',
  unit_cost numeric,
  supplier text,
  delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  remarks text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chemical_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY chem_deliveries_read ON public.chemical_deliveries FOR SELECT TO authenticated USING (user_has_plant_access(plant_id));
CREATE POLICY chem_deliveries_write ON public.chemical_deliveries FOR ALL TO authenticated
  USING (is_manager_or_admin(auth.uid()) AND user_has_plant_access(plant_id))
  WITH CHECK (is_manager_or_admin(auth.uid()) AND user_has_plant_access(plant_id));
CREATE INDEX idx_chem_deliveries_plant_chem ON public.chemical_deliveries(plant_id, chemical_name, delivery_date DESC);

-- ============ ro_pretreatment_readings ============
CREATE TABLE public.ro_pretreatment_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  train_id uuid NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  reading_datetime timestamptz NOT NULL DEFAULT now(),
  backwash_start timestamptz,
  backwash_end timestamptz,
  mmf_readings jsonb DEFAULT '[]'::jsonb,            -- [{unit:1, reading:123.4}, ...]
  booster_pumps jsonb DEFAULT '[]'::jsonb,           -- [{unit:1, target_pressure_psi:..., amperage:...}]
  afm_units jsonb DEFAULT '[]'::jsonb,               -- [{unit:1, inlet_psi:..., outlet_psi:...}]
  hpp_target_pressure_psi numeric,
  filter_housings jsonb DEFAULT '[]'::jsonb,         -- [{unit:1, in_psi:..., out_psi:...}]
  bag_filters_changed integer DEFAULT 0,
  remarks text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ro_pretreatment_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ro_pretreatment_access ON public.ro_pretreatment_readings FOR ALL TO authenticated
  USING (user_has_plant_access(plant_id)) WITH CHECK (user_has_plant_access(plant_id));
CREATE INDEX idx_pretreatment_train_dt ON public.ro_pretreatment_readings(train_id, reading_datetime DESC);

-- ============ chemical_residual_samples ============
CREATE TABLE public.chemical_residual_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosing_log_id uuid NOT NULL REFERENCES public.chemical_dosing_logs(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  sample_index integer NOT NULL,
  sampling_point text,
  residual_ppm numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chemical_residual_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY residual_samples_access ON public.chemical_residual_samples FOR ALL TO authenticated
  USING (user_has_plant_access(plant_id)) WITH CHECK (user_has_plant_access(plant_id));
CREATE INDEX idx_residual_dosing ON public.chemical_residual_samples(dosing_log_id);

-- ============ chemical_inventory: standardize unit ============
ALTER TABLE public.chemical_inventory ADD COLUMN IF NOT EXISTS unit_type text;
UPDATE public.chemical_inventory SET unit_type = COALESCE(unit, 'kg') WHERE unit_type IS NULL;

-- <<<<<<< END ARCHIVED: 20260420000001_chemical_deliveries.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260420000002_power_tariffs.sql >>>>>>>
-- power_tariffs
CREATE TABLE public.power_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  rate_per_kwh numeric NOT NULL,
  multiplier numeric NOT NULL DEFAULT 1,
  provider text,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_power_tariffs_plant_date ON public.power_tariffs(plant_id, effective_date DESC);
ALTER TABLE public.power_tariffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY power_tariffs_read ON public.power_tariffs FOR SELECT TO authenticated USING (true);
CREATE POLICY power_tariffs_write ON public.power_tariffs FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid())) WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- electric_bills
CREATE TABLE public.electric_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  billing_month date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  previous_reading numeric NOT NULL,
  current_reading numeric NOT NULL,
  multiplier numeric NOT NULL DEFAULT 1,
  total_kwh numeric GENERATED ALWAYS AS ((current_reading - previous_reading) * multiplier) STORED,
  total_amount numeric NOT NULL,
  generation_charge numeric,
  distribution_charge numeric,
  other_charges numeric,
  remarks text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_electric_bills_plant_month ON public.electric_bills(plant_id, billing_month DESC);
ALTER TABLE public.electric_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY electric_bills_access ON public.electric_bills FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id)) WITH CHECK (public.user_has_plant_access(plant_id));
CREATE TRIGGER trg_electric_bills_updated BEFORE UPDATE ON public.electric_bills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- production_costs
CREATE TABLE public.production_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  cost_date date NOT NULL,
  chem_cost numeric NOT NULL DEFAULT 0,
  power_cost numeric NOT NULL DEFAULT 0,
  production_m3 numeric NOT NULL DEFAULT 0,
  total_cost numeric GENERATED ALWAYS AS (chem_cost + power_cost) STORED,
  cost_per_m3 numeric,
  driver_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plant_id, cost_date)
);
CREATE INDEX idx_production_costs_plant_date ON public.production_costs(plant_id, cost_date DESC);
ALTER TABLE public.production_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_costs_access ON public.production_costs FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id)) WITH CHECK (public.user_has_plant_access(plant_id));
CREATE TRIGGER trg_production_costs_updated BEFORE UPDATE ON public.production_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- train_status_log
CREATE TABLE public.train_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id uuid NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  status text NOT NULL,
  reason text,
  confirmed_by uuid,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_train_status_log_train ON public.train_status_log(train_id, confirmed_at DESC);
ALTER TABLE public.train_status_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY train_status_log_access ON public.train_status_log FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id)) WITH CHECK (public.user_has_plant_access(plant_id));

-- Add price_per_unit to chemical_inventory
ALTER TABLE public.chemical_inventory ADD COLUMN IF NOT EXISTS price_per_unit numeric;

-- Helper: upsert daily production_cost rollup
CREATE OR REPLACE FUNCTION public.recompute_production_cost(_plant_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chem numeric := 0;
  v_kwh numeric := 0;
  v_prod numeric := 0;
  v_rate numeric := 0;
  v_mult numeric := 1;
  v_power_cost numeric := 0;
BEGIN
  SELECT COALESCE(SUM(calculated_cost),0) INTO v_chem
  FROM public.chemical_dosing_logs
  WHERE plant_id = _plant_id AND log_datetime::date = _date;

  SELECT COALESCE(SUM(daily_consumption_kwh),0) INTO v_kwh
  FROM public.power_readings
  WHERE plant_id = _plant_id AND reading_datetime::date = _date;

  SELECT COALESCE(SUM(daily_volume),0) INTO v_prod
  FROM public.well_readings
  WHERE plant_id = _plant_id AND reading_datetime::date = _date;

  SELECT rate_per_kwh, multiplier INTO v_rate, v_mult
  FROM public.power_tariffs
  WHERE plant_id = _plant_id AND effective_date <= _date
  ORDER BY effective_date DESC LIMIT 1;

  v_power_cost := v_kwh * COALESCE(v_rate,0) * COALESCE(v_mult,1);

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
$$;

-- Trigger fn to recompute on changes
CREATE OR REPLACE FUNCTION public.trg_recompute_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plant uuid;
  v_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_plant := OLD.plant_id;
    v_date := COALESCE(OLD.log_datetime, OLD.reading_datetime)::date;
  ELSE
    v_plant := NEW.plant_id;
    v_date := COALESCE(NEW.log_datetime, NEW.reading_datetime)::date;
  END IF;
  PERFORM public.recompute_production_cost(v_plant, v_date);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_chem_cost AFTER INSERT OR UPDATE OR DELETE ON public.chemical_dosing_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();
CREATE TRIGGER trg_power_cost AFTER INSERT OR UPDATE OR DELETE ON public.power_readings
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();
CREATE TRIGGER trg_well_cost AFTER INSERT OR UPDATE OR DELETE ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();

-- <<<<<<< END ARCHIVED: 20260420000002_power_tariffs.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260421000001_backwash_mode_and_daily_summary.sql >>>>>>>
-- 1) Plants: add backwash mode flag
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS backwash_mode text NOT NULL DEFAULT 'independent'
    CHECK (backwash_mode IN ('independent','synchronized'));

-- 2) Daily plant summary table (per plant per day)
CREATE TABLE IF NOT EXISTS public.daily_plant_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  summary_date date NOT NULL,
  production_m3 numeric,
  locator_consumption_m3 numeric,
  blending_m3 numeric,
  raw_water_consumption_m3 numeric,
  power_kwh numeric,
  pv_ratio numeric,
  feed_tds numeric,
  permeate_tds numeric,
  reject_tds numeric,
  product_tds numeric,
  raw_turbidity_ntu numeric,
  recovery_pct numeric,
  rejection_pct numeric,
  downtime_hrs numeric,
  feed_pressure_psi numeric,
  reject_pressure_psi numeric,
  notes text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_dps_plant_date ON public.daily_plant_summary(plant_id, summary_date DESC);

ALTER TABLE public.daily_plant_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dps_access ON public.daily_plant_summary;
CREATE POLICY dps_access ON public.daily_plant_summary
  FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

DROP TRIGGER IF EXISTS trg_dps_updated ON public.daily_plant_summary;
CREATE TRIGGER trg_dps_updated
  BEFORE UPDATE ON public.daily_plant_summary
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Remove previously seeded RO trains (user asked to omit prior seed)
-- Only delete trains that have no readings yet to avoid breaking real data
DELETE FROM public.ro_trains t
WHERE NOT EXISTS (SELECT 1 FROM public.ro_train_readings r WHERE r.train_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.ro_pretreatment_readings p WHERE p.train_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.afm_readings a WHERE a.train_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.cartridge_readings c WHERE c.train_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.cip_logs cl WHERE cl.train_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.pump_readings pr WHERE pr.train_id = t.id);

-- <<<<<<< END ARCHIVED: 20260421000001_backwash_mode_and_daily_summary.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260422000001_cost_recompute_trigger.sql >>>>>>>
CREATE OR REPLACE FUNCTION public.trg_recompute_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plant uuid;
  v_date date;
  v_ts timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_plant := OLD.plant_id;
    -- Try log_datetime (chem_dosing) first, then reading_datetime (well/power)
    BEGIN v_ts := OLD.log_datetime; EXCEPTION WHEN undefined_column THEN v_ts := NULL; END;
    IF v_ts IS NULL THEN
      BEGIN v_ts := OLD.reading_datetime; EXCEPTION WHEN undefined_column THEN v_ts := NULL; END;
    END IF;
  ELSE
    v_plant := NEW.plant_id;
    BEGIN v_ts := NEW.log_datetime; EXCEPTION WHEN undefined_column THEN v_ts := NULL; END;
    IF v_ts IS NULL THEN
      BEGIN v_ts := NEW.reading_datetime; EXCEPTION WHEN undefined_column THEN v_ts := NULL; END;
    END IF;
  END IF;
  IF v_ts IS NOT NULL THEN
    v_date := v_ts::date;
    PERFORM public.recompute_production_cost(v_plant, v_date);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260422000001_cost_recompute_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260422000002_well_depth_history.sql >>>>>>>
-- Allow logging historical changes of well drilling depth via well_pms_records
ALTER TABLE public.well_pms_records
  ADD COLUMN IF NOT EXISTS drilling_depth_m numeric;

-- <<<<<<< END ARCHIVED: 20260422000002_well_depth_history.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260424000001_blending_well_flag.sql >>>>>>>
-- Optional Supabase migration: blending-well flag on `wells` table.
-- The app currently tracks blending wells in Mongo (collection
-- `blending_wells`) so this is NOT required to run. Apply this migration
-- when you want the flag stored alongside the wells row in Supabase.

alter table if exists public.wells
    add column if not exists is_blending_well boolean not null default false;

comment on column public.wells.is_blending_well is
    'True if this well injects directly into the Product Water line '
    '(bypasses RO). Volumes are still recorded but flagged in audit.';

create index if not exists wells_is_blending_idx
    on public.wells (plant_id, is_blending_well)
    where is_blending_well = true;

-- <<<<<<< END ARCHIVED: 20260424000001_blending_well_flag.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260424000002_checklist_step_executions.sql >>>>>>>
-- Per-step checklist execution tracking for PM checklists
CREATE TABLE IF NOT EXISTS public.checklist_step_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.checklist_executions(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  plant_id uuid REFERENCES public.plants(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  step_text text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  value text,
  notes text,
  completed_by uuid REFERENCES public.user_profiles(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_cse_execution ON public.checklist_step_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_cse_template ON public.checklist_step_executions(template_id);
CREATE INDEX IF NOT EXISTS idx_cse_plant ON public.checklist_step_executions(plant_id);

ALTER TABLE public.checklist_step_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checklist_step_executions_plant_access"
  ON public.checklist_step_executions
  FOR ALL TO authenticated
  USING (plant_id IS NULL OR public.user_has_plant_access(plant_id))
  WITH CHECK (plant_id IS NULL OR public.user_has_plant_access(plant_id));

-- <<<<<<< END ARCHIVED: 20260424000002_checklist_step_executions.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260424000003_deletion_audit_log.sql >>>>>>>
-- =====================================================================
-- Deletion Audit Log
-- Run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- =====================================================================

create table if not exists public.deletion_audit_log (
  id              uuid        primary key default gen_random_uuid(),
  kind            text        not null check (kind in ('user', 'plant')),
  entity_id       uuid        not null,
  entity_label    text,
  action          text        not null check (action in ('soft', 'hard')),
  actor_user_id   uuid        references auth.users(id) on delete set null,
  actor_label     text,
  reason          text,
  dependencies    jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists deletion_audit_log_kind_entity_idx
  on public.deletion_audit_log (kind, entity_id);

create index if not exists deletion_audit_log_created_idx
  on public.deletion_audit_log (created_at desc);

alter table public.deletion_audit_log enable row level security;

-- Admins and Managers may read the full log.
drop policy if exists "audit log readable by admin/manager"
  on public.deletion_audit_log;
create policy "audit log readable by admin/manager"
  on public.deletion_audit_log
  for select
  using (public.is_manager_or_admin(auth.uid()));

-- Admins and Managers may insert (actions are gated server-side anyway).
drop policy if exists "audit log insertable by admin/manager"
  on public.deletion_audit_log;
create policy "audit log insertable by admin/manager"
  on public.deletion_audit_log
  for insert
  with check (public.is_manager_or_admin(auth.uid()));

-- Log rows are immutable: no update / delete policies -> denied by default.

-- <<<<<<< END ARCHIVED: 20260424000003_deletion_audit_log.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260424000004_plant_access_suspension_enforcement.sql >>>>>>>
-- 1) Tighten plant access: require Active status (suspension now enforced at DB layer)
CREATE OR REPLACE FUNCTION public.user_has_plant_access(_plant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND status = 'Active'
        AND _plant_id = ANY(plant_assignments)
    );
$function$;

-- 2) Lock down user_profiles SELECT — drop the open "everyone can read all" policy.
DROP POLICY IF EXISTS profiles_select_authenticated ON public.user_profiles;

-- Self can read own full profile
DROP POLICY IF EXISTS profiles_select_self ON public.user_profiles;
CREATE POLICY profiles_select_self
  ON public.user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Admins can read all profiles (already covered by profiles_admin_all but explicit SELECT helps)
-- (profiles_admin_all already grants ALL to admins so we don't add a duplicate.)

-- Managers may read profiles of users assigned to plants they administer (needed for Employees screen).
-- Simpler approach: any manager/admin can read all profiles.
DROP POLICY IF EXISTS profiles_select_manager ON public.user_profiles;
CREATE POLICY profiles_select_manager
  ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- 3) Replace blanket profiles_update_self with a column-restricted update via SECURITY DEFINER RPC.
DROP POLICY IF EXISTS profiles_update_self ON public.user_profiles;

-- RPC: update only safe profile fields (never status, plant_assignments, profile_complete, immediate_head_id)
CREATE OR REPLACE FUNCTION public.update_own_profile(
  _username text,
  _first_name text,
  _middle_name text,
  _last_name text,
  _suffix text,
  _designation text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.user_profiles SET
    username = COALESCE(_username, username),
    first_name = COALESCE(_first_name, first_name),
    middle_name = _middle_name,
    last_name = COALESCE(_last_name, last_name),
    suffix = _suffix,
    designation = _designation,
    updated_at = now()
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.update_own_profile(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text,text,text,text,text,text) TO authenticated;

-- RPC: complete onboarding — sets safe fields + plant_assignments + activates account.
-- Only allowed when profile_complete is still false (one-time use).
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  _username text,
  _first_name text,
  _middle_name text,
  _last_name text,
  _suffix text,
  _designation text,
  _plant_assignments uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complete boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _plant_assignments IS NULL OR array_length(_plant_assignments, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one plant assignment is required';
  END IF;

  SELECT profile_complete INTO v_complete FROM public.user_profiles WHERE id = auth.uid();
  IF v_complete THEN
    RAISE EXCEPTION 'Profile already complete; ask an Admin to change plant assignments';
  END IF;

  UPDATE public.user_profiles SET
    username = _username,
    first_name = _first_name,
    middle_name = _middle_name,
    last_name = _last_name,
    suffix = _suffix,
    designation = _designation,
    plant_assignments = _plant_assignments,
    profile_complete = true,
    status = 'Active',
    updated_at = now()
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding(text,text,text,text,text,text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text,text,text,text,text,text,uuid[]) TO authenticated;

-- <<<<<<< END ARCHIVED: 20260424000004_plant_access_suspension_enforcement.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260425000001_archived_plant_data.sql >>>>>>>
-- =====================================================================
-- 20260425 archived_plant_data
--   Snapshot table used by /api/admin/plants/{id} (DELETE) when called
--   with archive=true. Each row stores a JSONB blob of one source row
--   from a non-cascading child table (well_readings, locator_readings,
--   incidents, …) that was about to be force-deleted along with its
--   parent plant. This preserves operational history for compliance /
--   regulator review even after the plant is hard-deleted.
--
--   Pair with hard_delete_plant(force=True, archive=True). The actor's
--   audit-log row (deletion_audit_log) keeps the high-level "who/why",
--   while this table keeps the "what" at row-level fidelity.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.archived_plant_data (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id      UUID NOT NULL,
  plant_name    TEXT,
  source_table  TEXT NOT NULL,
  source_row_id UUID,
  payload       JSONB NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by   UUID,
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS archived_plant_data_plant_idx
  ON public.archived_plant_data(plant_id);
CREATE INDEX IF NOT EXISTS archived_plant_data_table_idx
  ON public.archived_plant_data(source_table);
CREATE INDEX IF NOT EXISTS archived_plant_data_archived_at_idx
  ON public.archived_plant_data(archived_at DESC);

ALTER TABLE public.archived_plant_data ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated Admin or Manager (parity with deletion_audit_log).
DROP POLICY IF EXISTS archived_plant_data_read ON public.archived_plant_data;
CREATE POLICY archived_plant_data_read
  ON public.archived_plant_data
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('Admin', 'Manager')
    )
  );

-- Write: Admin only. The backend writes via the user-scoped Supabase
-- client, so RLS still applies.
DROP POLICY IF EXISTS archived_plant_data_insert ON public.archived_plant_data;
CREATE POLICY archived_plant_data_insert
  ON public.archived_plant_data
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'Admin'
    )
  );

-- <<<<<<< END ARCHIVED: 20260425000001_archived_plant_data.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260425000002_import_analysis.sql >>>>>>>
-- =====================================================================
-- AI Universal Import — analysis & decision log
-- Run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- =====================================================================

create table if not exists public.import_analysis (
  id                  uuid        primary key default gen_random_uuid(),
  actor_user_id       uuid        references auth.users(id) on delete set null,
  actor_label         text,
  plant_id            uuid        references public.plants(id) on delete set null,
  filename            text        not null,
  file_kind           text,                          -- xlsx | xlsm | txt | csv | docx | ...
  file_size           integer,
  ai_provider         text,                          -- openai | rule-based
  ai_model            text,
  status              text        not null default 'pending'
                                  check (status in ('pending', 'synced', 'rejected', 'partial')),
  wellmeter_detected  boolean     not null default false,
  tables              jsonb       not null,          -- per-table classification + sample rows
  decisions           jsonb,                         -- per-table approve/reject + edits made by admin
  reason              text,
  decided_by          uuid        references auth.users(id) on delete set null,
  decided_at          timestamptz,
  sync_summary        jsonb,                         -- {created: {wells: N, ...}, inserted: {well_readings: N, ...}, skipped: [...]}
  created_at          timestamptz not null default now()
);

create index if not exists import_analysis_actor_idx
  on public.import_analysis (actor_user_id);

create index if not exists import_analysis_status_idx
  on public.import_analysis (status, created_at desc);

create index if not exists import_analysis_created_idx
  on public.import_analysis (created_at desc);

alter table public.import_analysis enable row level security;

-- Admin / Manager may read every analysis row.
drop policy if exists "import_analysis readable by admin/manager"
  on public.import_analysis;
create policy "import_analysis readable by admin/manager"
  on public.import_analysis
  for select
  using (public.is_manager_or_admin(auth.uid()));

-- Admin / Manager may insert their own analysis runs.
drop policy if exists "import_analysis insertable by admin/manager"
  on public.import_analysis;
create policy "import_analysis insertable by admin/manager"
  on public.import_analysis
  for insert
  with check (public.is_manager_or_admin(auth.uid()));

-- Updates are Admin-only — and only via the /api/import/ai-sync endpoint
-- which performs strict validation, audit logging, and status transitions.
-- Manager can read + create analyses but cannot mutate decisions/status
-- directly through the Supabase API, matching the server-side
-- _require_roles({"Admin"}) check on the sync endpoint.
drop policy if exists "import_analysis updatable by admin/manager"
  on public.import_analysis;
drop policy if exists "import_analysis updatable by admin"
  on public.import_analysis;
create policy "import_analysis updatable by admin"
  on public.import_analysis
  for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- No delete policy — analysis rows are kept for audit history.

-- Recommended (but not strictly required) uniqueness — prevents the
-- get-or-create race in _ensure_entity from creating duplicate wells /
-- locators / ro_trains under the same plant when two admins approve
-- overlapping analyses at the same time. Wrapped in DO blocks so the
-- migration is idempotent and tolerates pre-existing data with dups.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'wells_plant_name_uq'
  ) then
    begin
      execute 'create unique index wells_plant_name_uq on public.wells (plant_id, lower(name))';
    exception when others then
      raise notice 'wells_plant_name_uq skipped: %', sqlerrm;
    end;
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'locators_plant_name_uq'
  ) then
    begin
      execute 'create unique index locators_plant_name_uq on public.locators (plant_id, lower(name))';
    exception when others then
      raise notice 'locators_plant_name_uq skipped: %', sqlerrm;
    end;
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'ro_trains_plant_name_uq'
  ) then
    begin
      execute 'create unique index ro_trains_plant_name_uq on public.ro_trains (plant_id, lower(name))';
    exception when others then
      raise notice 'ro_trains_plant_name_uq skipped: %', sqlerrm;
    end;
  end if;
end $$;

-- <<<<<<< END ARCHIVED: 20260425000002_import_analysis.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260427000001_energy_meter_integration.sql >>>>>>>
-- 20260427 Energy & Meter Integration
-- ------------------------------------------------------------------
-- Adds:
-- 1. Dedicated electric-meter columns on `wells`
--    (water meter columns already exist; this is the second meter).
-- 2. Solar / grid configuration on `plants`.
-- 3. Per-reading solar/grid kWh split on `power_readings` so the
--    Dashboard EnergyMixCard can show stacked bars + today KPIs.
-- ------------------------------------------------------------------

-- 1. WELLS — dedicated electric meter
ALTER TABLE public.wells
  ADD COLUMN IF NOT EXISTS electric_meter_brand          TEXT,
  ADD COLUMN IF NOT EXISTS electric_meter_size           TEXT,
  ADD COLUMN IF NOT EXISTS electric_meter_serial         TEXT,
  ADD COLUMN IF NOT EXISTS electric_meter_installed_date DATE;

COMMENT ON COLUMN public.wells.electric_meter_brand
  IS 'Brand of the dedicated kWh meter on this well (separate from water meter)';

-- 2. PLANTS — energy source flags
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS has_solar         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_grid          BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS solar_capacity_kw NUMERIC(12,2);

COMMENT ON COLUMN public.plants.has_solar IS 'Plant has rooftop / hybrid solar generation';
COMMENT ON COLUMN public.plants.has_grid  IS 'Plant draws power from utility grid';

-- 3. POWER_READINGS — solar / grid daily kWh (operator-entered)
ALTER TABLE public.power_readings
  ADD COLUMN IF NOT EXISTS daily_solar_kwh NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_grid_kwh  NUMERIC(14,2) DEFAULT 0;

COMMENT ON COLUMN public.power_readings.daily_solar_kwh
  IS 'kWh produced from solar on this reading''s day (0 if plant has no solar)';
COMMENT ON COLUMN public.power_readings.daily_grid_kwh
  IS 'kWh drawn from grid on this reading''s day (0 if plant is off-grid)';

-- Backfill: for legacy rows where solar/grid not split, treat the existing
-- daily_consumption_kwh as 100% grid so charts don't show empty bars.
UPDATE public.power_readings
SET daily_grid_kwh = COALESCE(daily_consumption_kwh, 0)
WHERE daily_grid_kwh = 0
  AND daily_solar_kwh = 0
  AND COALESCE(daily_consumption_kwh, 0) > 0;

-- <<<<<<< END ARCHIVED: 20260427000001_energy_meter_integration.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260428000001_admin_approval_flow.sql >>>>>>>
-- =====================================================================
-- 20260428 Admin Approval Flow (replaces Supabase email confirmation)
-- =====================================================================
-- Pre-requisite (manual, you):
--   Supabase Studio → Authentication → Providers → Email →
--   turn OFF "Confirm email". This lets sign-ups create an
--   auth.users row immediately. Approval is then gated by the
--   `confirmed` flag below.
--
-- This migration:
--   1. Adds `confirmed BOOLEAN NOT NULL DEFAULT FALSE` to user_profiles.
--   2. Backfills `confirmed=TRUE` for users already `Active` so the
--      flow is non-disruptive for the existing org.
--   3. Updates handle_new_user() so new sign-ups land at confirmed=false.
--   4. Adds RPC `approve_user(_user_id, _approve)` callable only by
--      Admins (Manager+) — sets confirmed and (when approving) status.
--   5. Adds an RLS UPDATE policy on user_profiles allowing Admins to
--      flip the `confirmed` flag directly via a regular UPDATE (the RPC
--      is the recommended path; this is a belt-and-braces fallback).
-- =====================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.confirmed
  IS 'Admin approval flag. New signups land at FALSE; Admin must call '
     'approve_user() (or set the column directly) to unlock the app.';

-- 1. Non-disruptive backfill: anyone already Active is implicitly approved.
UPDATE public.user_profiles
   SET confirmed = TRUE
 WHERE status = 'Active' AND confirmed = FALSE;

-- 2. Update auto-profile trigger so future sign-ups land confirmed=false.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_profiles (id, status, profile_complete, confirmed)
  VALUES (NEW.id, 'Pending', FALSE, FALSE)
  ON CONFLICT (id) DO NOTHING;
  -- default role: Operator (Pending status + confirmed=false keep them out
  -- of the app until Admin approves and assigns a designation/role).
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'Operator')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. RPC: only Admins can approve / un-approve. Returns the updated row.
CREATE OR REPLACE FUNCTION public.approve_user(
  _user_id UUID,
  _approve BOOLEAN DEFAULT TRUE
)
RETURNS public.user_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result public.user_profiles;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only Admins may approve user accounts.'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  UPDATE public.user_profiles
     SET confirmed = _approve,
         status    = CASE
                       WHEN _approve THEN 'Active'::public.profile_status
                       ELSE status
                     END,
         updated_at = now()
   WHERE id = _user_id
   RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'No user_profiles row found for %', _user_id;
  END IF;

  RETURN result;
END;
$$;

-- 4. Belt-and-braces RLS: Admin can UPDATE user_profiles.confirmed
-- (and other fields) for any user. The existing self-service UPDATE
-- policy is unchanged — users still only mutate their own non-admin
-- fields via the RPC `update_own_profile`.
DROP POLICY IF EXISTS "user_profiles admin full update" ON public.user_profiles;
CREATE POLICY "user_profiles admin full update"
  ON public.user_profiles
  FOR UPDATE
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Admins also need broad read on user_profiles to power the approval queue
-- (the existing read policies in the original migration already cover this
--  for Manager+; if your project locked it down further, uncomment below):
-- DROP POLICY IF EXISTS "user_profiles admin read" ON public.user_profiles;
-- CREATE POLICY "user_profiles admin read"
--   ON public.user_profiles FOR SELECT
--   USING (public.is_manager_or_admin(auth.uid()));

-- 5. Grant execute on the RPC to authenticated users — the RPC itself
-- enforces the Admin check.
GRANT EXECUTE ON FUNCTION public.approve_user(UUID, BOOLEAN) TO authenticated;

-- <<<<<<< END ARCHIVED: 20260428000001_admin_approval_flow.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260428000002_admin_audit_enhancements.sql >>>>>>>
-- =====================================================================
-- 20260428 Admin RBAC + Audit Enhancements
-- Run this in the Supabase SQL editor BEFORE 20260428_promote_admin_kevin.sql
-- =====================================================================
-- 1. Extend deletion_audit_log to accept kind = 'well'
-- 2. Create login_attempts table for sign-in audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. deletion_audit_log: allow kind='well' (iter 6 wells bulk delete)
-- ---------------------------------------------------------------------
ALTER TABLE public.deletion_audit_log
  DROP CONSTRAINT IF EXISTS deletion_audit_log_kind_check;

ALTER TABLE public.deletion_audit_log
  ADD CONSTRAINT deletion_audit_log_kind_check
  CHECK (kind IN ('user', 'plant', 'well'));

-- ---------------------------------------------------------------------
-- 2. login_attempts: every sign-in click (success or failure)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL,
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  success       BOOLEAN     NOT NULL,
  error_reason  TEXT,
  user_agent    TEXT,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_email_idx
  ON public.login_attempts (lower(email), attempted_at DESC);

CREATE INDEX IF NOT EXISTS login_attempts_attempted_idx
  ON public.login_attempts (attempted_at DESC);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Anyone (anon role included) may insert a login attempt — the row only
-- contains an email + success flag; the actual credentials are never stored.
DROP POLICY IF EXISTS "login_attempts insertable by anyone" ON public.login_attempts;
CREATE POLICY "login_attempts insertable by anyone"
  ON public.login_attempts
  FOR INSERT
  WITH CHECK (true);

-- Only Admins may read the audit trail.
DROP POLICY IF EXISTS "login_attempts readable by admin" ON public.login_attempts;
CREATE POLICY "login_attempts readable by admin"
  ON public.login_attempts
  FOR SELECT
  USING (public.is_admin(auth.uid()));

-- Rows are immutable: no UPDATE / DELETE policies → denied by default.

-- <<<<<<< END ARCHIVED: 20260428000002_admin_audit_enhancements.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260428000003_cleanup_bad_imports.sql >>>>>>>
-- =====================================================================
-- 20260428 Cleanup: hard-delete bad-imported plants
--          ('Mambaling 3', 'SRP MCWD')
-- =====================================================================
-- This script:
--   1. Snapshots the plant_ids + dependency counts BEFORE deletion.
--   2. Inserts one audit row per plant into `deletion_audit_log` BEFORE
--      the plant rows go away (so the FK in actor_user_id and the row
--      itself remain referenceable).
--   3. Explicitly deletes all dependent rows that don't have
--      ON DELETE CASCADE through their primary parent (locator_*, well_*,
--      ro_train_readings, incidents) — needed because their plant_id
--      FKs are NO ACTION and would block the final plant delete.
--   4. Deletes the plants. The remaining tables with
--      ON DELETE CASCADE on plants(id) (locators, wells, ro_trains,
--      chemical_inventory, chemical_dosing_logs, power_readings,
--      power_tariffs, electric_bills, production_costs,
--      chemical_deliveries, ro_pretreatment_readings,
--      daily_plant_summary, checklist_templates) are removed by the
--      cascade chain.
--   5. Wrapped in a SAVEPOINT-friendly DO block; counts reported via
--      RAISE NOTICE so you can verify in the SQL editor output pane.
--
-- Pre-requisites:
--   - Run 20260424_deletion_audit_log.sql first (audit table).
--   - Run 20260428_admin_audit_enhancements.sql first (kind='well'
--     constraint relax, login_attempts table — both unrelated to
--     plant cleanup but already part of iter-7 setup).
--   - Run this AS AN ADMIN (auth.uid() must resolve to an Admin row
--     in user_roles, otherwise the audit-log RLS policy blocks the
--     insert).
--
-- Idempotent: re-running after the plants are gone does nothing
-- (the WHERE filter matches zero rows) and emits a 'no plants found'
-- notice.
-- =====================================================================

DO $$
DECLARE
  target_names CONSTANT TEXT[] := ARRAY['Mambaling 3', 'SRP MCWD'];
  doomed_ids   UUID[];
  plant_row    RECORD;
  acting_uid   UUID := auth.uid();
  cnt          BIGINT;
BEGIN
  -- 1. Snapshot the plant ids
  SELECT array_agg(id) INTO doomed_ids
  FROM public.plants
  WHERE name = ANY(target_names);

  IF doomed_ids IS NULL OR array_length(doomed_ids, 1) IS NULL THEN
    RAISE NOTICE 'No plants found matching %; nothing to do.', target_names;
    RETURN;
  END IF;

  RAISE NOTICE 'Cleaning up % plant(s): %', array_length(doomed_ids, 1), doomed_ids;

  -- 2. Audit-log BEFORE delete (one row per plant, with dependency
  --    snapshot). Uses our actual schema: kind / entity_id / entity_label
  --    / action / actor_user_id / actor_label / reason / dependencies.
  FOR plant_row IN
    SELECT id, name FROM public.plants WHERE id = ANY(doomed_ids)
  LOOP
    INSERT INTO public.deletion_audit_log (
      kind, entity_id, entity_label, action,
      actor_user_id, actor_label, reason, dependencies
    )
    SELECT
      'plant',
      plant_row.id,
      plant_row.name,
      'hard',
      acting_uid,
      'Smart-import cleanup script',
      'Smart importation error cleanup',
      jsonb_build_object(
        'wells',                   (SELECT count(*) FROM public.wells              WHERE plant_id = plant_row.id),
        'locators',                (SELECT count(*) FROM public.locators           WHERE plant_id = plant_row.id),
        'ro_trains',               (SELECT count(*) FROM public.ro_trains          WHERE plant_id = plant_row.id),
        'well_readings',           (SELECT count(*) FROM public.well_readings      WHERE plant_id = plant_row.id),
        'locator_readings',        (SELECT count(*) FROM public.locator_readings   WHERE plant_id = plant_row.id),
        'power_readings',          (SELECT count(*) FROM public.power_readings     WHERE plant_id = plant_row.id),
        'incidents',               (SELECT count(*) FROM public.incidents          WHERE plant_id = plant_row.id),
        'production_costs',        (SELECT count(*) FROM public.production_costs   WHERE plant_id = plant_row.id),
        'chemical_inventory',      (SELECT count(*) FROM public.chemical_inventory WHERE plant_id = plant_row.id)
      );
  END LOOP;

  -- 3. Delete dependent rows whose plant_id FK has NO CASCADE.
  --    (These would otherwise block the plant DELETE.)

  --    Wipe deepest descendants first (readings) before parents.
  DELETE FROM public.well_meter_replacements
   WHERE plant_id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  well_meter_replacements:    -%', cnt;

  DELETE FROM public.well_pms_records
   WHERE plant_id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  well_pms_records:           -%', cnt;

  DELETE FROM public.well_readings
   WHERE plant_id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  well_readings:              -%', cnt;

  DELETE FROM public.locator_meter_replacements
   WHERE plant_id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  locator_meter_replacements: -%', cnt;

  DELETE FROM public.locator_readings
   WHERE plant_id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  locator_readings:           -%', cnt;

  -- ro_train_readings.plant_id is also NO ACTION
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ro_train_readings') THEN
    DELETE FROM public.ro_train_readings
     WHERE plant_id = ANY(doomed_ids);
    GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  ro_train_readings:          -%', cnt;
  END IF;

  -- ro_train_replacements.plant_id may or may not cascade — clear to be safe.
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ro_train_replacements') THEN
    DELETE FROM public.ro_train_replacements
     WHERE plant_id = ANY(doomed_ids);
    GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  ro_train_replacements:      -%', cnt;
  END IF;

  -- Incidents.plant_id is NOT NULL with no cascade — must clear first.
  DELETE FROM public.incidents
   WHERE plant_id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  incidents:                  -%', cnt;

  -- checklist_executions.plant_id has no cascade either.
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='checklist_executions') THEN
    DELETE FROM public.checklist_executions
     WHERE plant_id = ANY(doomed_ids);
    GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  checklist_executions:       -%', cnt;
  END IF;

  -- 4. Detach plants from any user_profiles.plant_assignments arrays.
  UPDATE public.user_profiles
     SET plant_assignments = (
       SELECT COALESCE(array_agg(p), '{}')::uuid[]
       FROM unnest(plant_assignments) AS p
       WHERE p <> ALL(doomed_ids)
     )
  WHERE plant_assignments && doomed_ids;
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  user_profiles plant_assignments updated: %', cnt;

  -- 5. Finally, drop the plants. Cascade rules clear every remaining
  --    table (locators, wells, ro_trains, chemical_*, power_*,
  --    production_costs, daily_plant_summary, checklist_templates,
  --    electric_bills).
  DELETE FROM public.plants WHERE id = ANY(doomed_ids);
  GET DIAGNOSTICS cnt = ROW_COUNT;  RAISE NOTICE '  plants:                     -% (DONE)', cnt;
END
$$;

-- <<<<<<< END ARCHIVED: 20260428000003_cleanup_bad_imports.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260428000004_promote_admin_kevin.sql >>>>>>>
-- =====================================================================
-- 20260428 Promote Kevin Vilbar to Admin
-- =====================================================================
-- Pre-requisites:
--   1. Run 20260428_admin_audit_enhancements.sql first.
--   2. Kevin must have already signed up at /auth using:
--        Email:    kevzvilbar@gmail.com
--        Password: BPWI2025!
-- This script does NOT create an auth.users row — Supabase only allows
-- that via the dashboard or the service-role key. Once the auth row
-- exists, this script attaches a complete `user_profiles` record and
-- assigns the Admin role.
-- =====================================================================

DO $$
DECLARE
  kevin_id UUID;
BEGIN
  SELECT id INTO kevin_id
  FROM auth.users
  WHERE lower(email) = lower('kevzvilbar@gmail.com')
  LIMIT 1;

  IF kevin_id IS NULL THEN
    -- Production promotion is optional during a fresh local/preview bootstrap.
    -- The auth user may not exist until the application sign-up flow runs.
    RAISE NOTICE
      'Skipping Kevin Vilbar admin promotion: no auth.users row exists yet.';
    RETURN;
  END IF;

  -- Upsert profile
  INSERT INTO public.user_profiles
    (id, username, first_name, last_name, designation, status, profile_complete, confirmed)
  VALUES
    (kevin_id, 'Kevz', 'Kevin', 'Vilbar', 'Admin', 'Active', TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
  SET first_name       = EXCLUDED.first_name,
      last_name        = EXCLUDED.last_name,
      username         = EXCLUDED.username,
      designation      = EXCLUDED.designation,
      status           = EXCLUDED.status,
      profile_complete = TRUE,
      confirmed        = TRUE,
      updated_at       = now();

  -- Grant Admin role (idempotent thanks to the (user_id, role) unique key)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (kevin_id, 'Admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'Kevin Vilbar (%) promoted to Admin.', kevin_id;
END
$$;

-- <<<<<<< END ARCHIVED: 20260428000004_promote_admin_kevin.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260514000001_normalization.sql >>>>>>>
-- =============================================================================
-- Migration: 20260514_normalization.sql
-- Data Normalization Workflow — reading_normalizations audit table +
-- norm_status columns on all reading tables.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Enum for normalization actions ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE reading_norm_action AS ENUM ('tag', 'normalize', 'retract');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Normalization audit table ──────────────────────────────────────────────
-- Append-only. One row per action (tag / normalize / retract).
-- Preserves original_value so any retraction can restore it.
CREATE TABLE IF NOT EXISTS reading_normalizations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT        NOT NULL,  -- 'locator_readings' | 'well_readings' | …
  source_id       UUID        NOT NULL,  -- FK to the reading row (polymorphic)
  action          reading_norm_action NOT NULL,
  original_value  NUMERIC,               -- preserved reading value at time of action
  adjusted_value  NUMERIC,               -- corrected value (NULL for tag-only)
  note            TEXT,                  -- analyst note
  performed_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_role  TEXT        NOT NULL,  -- 'Admin' | 'Data Analyst'
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  retractable     BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_reading_norm_source
  ON reading_normalizations (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_reading_norm_performed_at
  ON reading_normalizations (performed_at DESC);

-- ── 3. norm_status column on reading tables ───────────────────────────────────
-- 'normal'     → no anomaly detected
-- 'erroneous'  → flagged by analyst / regression engine
-- 'normalized' → value corrected by analyst (adjusted_value stored in audit table)
-- 'retracted'  → normalization undone; original value still applies

ALTER TABLE locator_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

ALTER TABLE well_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

-- product_meter_readings is created by a later migration in fresh installs;
-- apply this column when the table already exists, otherwise let its owning
-- migration add the column after creating the table.
DO $$ BEGIN
  ALTER TABLE product_meter_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT
    CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
    DEFAULT 'normal';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ro_train_readings may not exist in all deployments; guard with a DO block
DO $$ BEGIN
  ALTER TABLE ro_train_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT
    CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
    DEFAULT 'normal';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 4. Add 'Data Analyst' to app_role enum ────────────────────────────────────
-- Supabase enums cannot be altered with IF NOT EXISTS, so we guard manually.
DO $$ BEGIN
  ALTER TYPE app_role ADD VALUE 'Data Analyst';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. RLS policies for reading_normalizations ────────────────────────────────
ALTER TABLE reading_normalizations ENABLE ROW LEVEL SECURITY;

-- Admin and Data Analyst can read all normalization records
CREATE POLICY "analyst_read_normalizations"
  ON reading_normalizations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
    )
  );

-- Admin and Data Analyst can insert normalization records
CREATE POLICY "analyst_insert_normalizations"
  ON reading_normalizations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
    )
    AND performed_by = auth.uid()
  );

-- No UPDATE or DELETE — audit table is append-only
-- (Retract creates a new 'retract' row, it does not delete the previous one)

-- ── 6. RLS: allow Analysts to update norm_status on reading tables ─────────────
-- locator_readings
CREATE POLICY "analyst_update_norm_status_locator"
  ON locator_readings FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
  )
  WITH CHECK (true);

-- well_readings
CREATE POLICY "analyst_update_norm_status_well"
  ON well_readings FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
  )
  WITH CHECK (true);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this migration:
--   1. Assign the 'Data Analyst' role to users via Admin → Users tab.
--   2. The NormalizeButton will appear on reading rows for those users.
--   3. The Normalization tab in the Admin console will show flagged readings.

-- <<<<<<< END ARCHIVED: 20260514000001_normalization.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260515000001_supabase_only_and_data_analysis.sql >>>>>>>
-- =============================================================================
-- Migration: 20260515_supabase_only_and_data_analysis.sql
-- Replaces all MongoDB-backed collections with Supabase tables.
-- Adds Data Analysis & Review Page infrastructure (regression results).
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. status_checks (was MongoDB) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS status_checks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. downtime_events (was MongoDB) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS downtime_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id     UUID        REFERENCES plants(id) ON DELETE CASCADE,
  event_date   DATE        NOT NULL,
  duration_hrs NUMERIC     NOT NULL DEFAULT 0,
  subsystem    TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_downtime_plant_date ON downtime_events (plant_id, event_date DESC);

ALTER TABLE downtime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_downtime" ON downtime_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_downtime" ON downtime_events FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'Admin') OR
    public.has_role(auth.uid(), 'Data Analyst') OR
    public.has_role(auth.uid(), 'Manager')
  )
);

-- ── 3. blending_wells (was MongoDB) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blending_wells (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id     UUID        UNIQUE NOT NULL,
  plant_id    UUID        NOT NULL,
  well_name   TEXT,
  plant_name  TEXT,
  tagged_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  tagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_blending_wells_plant ON blending_wells (plant_id);

ALTER TABLE blending_wells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_blending_wells" ON blending_wells FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_blending_wells" ON blending_wells FOR ALL USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── 4. blending_events (was MongoDB) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blending_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id    UUID        NOT NULL,
  well_id     UUID        NOT NULL,
  well_name   TEXT,
  plant_name  TEXT,
  event_date  DATE        NOT NULL,
  volume_m3   NUMERIC     NOT NULL DEFAULT 0,
  noted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blending_events_plant_date ON blending_events (plant_id, event_date DESC);

ALTER TABLE blending_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_blending_events" ON blending_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_blending_events" ON blending_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 5. compliance_thresholds (was MongoDB) ────────────────────────────────────
-- scope = 'global' or a plant_id UUID
CREATE TABLE IF NOT EXISTS compliance_thresholds (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        TEXT        NOT NULL UNIQUE,
  thresholds   JSONB       NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE compliance_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_thresholds" ON compliance_thresholds FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin_write_thresholds" ON compliance_thresholds FOR ALL USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── 6. compliance_snapshots (was MongoDB) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id      UUID        REFERENCES plants(id) ON DELETE CASCADE,
  evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  violations    JSONB       NOT NULL DEFAULT '[]',
  summary       TEXT
);
CREATE INDEX IF NOT EXISTS idx_compliance_snap_plant ON compliance_snapshots (plant_id, evaluated_at DESC);

ALTER TABLE compliance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_snapshots" ON compliance_snapshots FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_snapshots" ON compliance_snapshots FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 7. operator_switch_log (was MongoDB) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_switch_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id         UUID        REFERENCES plants(id) ON DELETE SET NULL,
  from_operator_id UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  to_operator_id   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  switched_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  switched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operator_switch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_switch_log" ON operator_switch_log FOR SELECT USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Manager')
);
CREATE POLICY "auth_write_switch_log" ON operator_switch_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 8. ai_chat_sessions (was MongoDB) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  session_id   TEXT        PRIMARY KEY,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  messages     JSONB       NOT NULL DEFAULT '[]',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_chat_sessions (user_id, updated_at DESC);

ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_sessions" ON ai_chat_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "admin_read_sessions" ON ai_chat_sessions FOR SELECT USING (
  public.has_role(auth.uid(), 'Admin')
);

-- ── 9. Data Analysis Regression Results ───────────────────────────────────────
-- Stores per-column regression analysis results linked to reading tables.
-- One row per (source_table, column_name, plant_id, analysis run).
CREATE TABLE IF NOT EXISTS regression_results (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table   TEXT        NOT NULL,        -- 'well_readings' | 'locator_readings' | ...
  column_name    TEXT        NOT NULL,         -- e.g. 'daily_volume', 'current_reading'
  plant_id       UUID        REFERENCES plants(id) ON DELETE CASCADE,
  date_from      DATE,
  date_to        DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_role   TEXT        NOT NULL DEFAULT 'Data Analyst',
  row_count      INT         NOT NULL DEFAULT 0,
  r_squared      NUMERIC,                      -- goodness of fit
  slope          NUMERIC,
  intercept      NUMERIC,
  -- Array of per-reading corrections.  Each element:
  -- { reading_id, original_value, corrected_value, z_score, is_outlier, note }
  corrections    JSONB       NOT NULL DEFAULT '[]',
  status         TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'retracted'))
);
CREATE INDEX IF NOT EXISTS idx_regression_table_col ON regression_results (source_table, column_name);
CREATE INDEX IF NOT EXISTS idx_regression_plant ON regression_results (plant_id, created_at DESC);

ALTER TABLE regression_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analyst_read_regression" ON regression_results FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'Admin') OR
    public.has_role(auth.uid(), 'Data Analyst') OR
    public.has_role(auth.uid(), 'Manager')
  )
);

CREATE POLICY "analyst_insert_regression" ON regression_results FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'Admin') OR
    public.has_role(auth.uid(), 'Data Analyst')
  )
);

CREATE POLICY "analyst_update_regression" ON regression_results FOR UPDATE USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── 10. Raw-edit audit log ─────────────────────────────────────────────────────
-- Tracks direct edits to raw values made from the Data Analysis page.
CREATE TABLE IF NOT EXISTS raw_edit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT        NOT NULL,
  source_id       UUID        NOT NULL,
  column_name     TEXT        NOT NULL,
  old_value       NUMERIC,
  new_value       NUMERIC,
  edited_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_role     TEXT        NOT NULL,
  edited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_raw_edit_source ON raw_edit_log (source_table, source_id);

ALTER TABLE raw_edit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analyst_read_raw_edit_log" ON raw_edit_log FOR SELECT USING (
  public.has_role(auth.uid(), 'Admin') OR
  public.has_role(auth.uid(), 'Data Analyst') OR
  public.has_role(auth.uid(), 'Manager')
);

CREATE POLICY "analyst_insert_raw_edit_log" ON raw_edit_log FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this migration:
--   1. All MongoDB collections are now Supabase tables with RLS.
--   2. regression_results and raw_edit_log support the Data Analysis page.
--   3. Remove MONGO_URL / DB_NAME from your environment variables.
--   4. Assign 'Data Analyst' roles to relevant users in Admin → Users.

-- <<<<<<< END ARCHIVED: 20260515000001_supabase_only_and_data_analysis.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260717000001_reading_edit_audit_log.sql >>>>>>>
-- =====================================================================
-- Reading Edit Audit Log
-- Run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
--
-- Captures every edit/delete made to an already-submitted operational
-- reading (RO train readings, pretreatment readings, chemical dosing
-- logs) so managers can see who changed what and when. Written from the
-- frontend by logReadingEdit() in ROTrains.tsx, right after a successful
-- update/delete — best-effort (a failed insert here never blocks the
-- actual save).
-- =====================================================================

create table if not exists public.reading_edit_audit_log (
  id              uuid        primary key default gen_random_uuid(),
  table_name      text        not null check (table_name in (
                                'ro_train_readings',
                                'ro_pretreatment_readings',
                                'chemical_dosing_logs'
                              )),
  record_id       uuid        not null,
  plant_id        uuid        references public.plants(id) on delete set null,
  train_id        uuid,
  action          text        not null default 'update' check (action in ('update', 'delete')),
  actor_user_id   uuid        references auth.users(id) on delete set null,
  actor_label     text,
  changes         jsonb,
  edited_at       timestamptz not null default now()
);

create index if not exists reading_edit_audit_log_record_idx
  on public.reading_edit_audit_log (table_name, record_id);

create index if not exists reading_edit_audit_log_plant_idx
  on public.reading_edit_audit_log (plant_id, edited_at desc);

alter table public.reading_edit_audit_log enable row level security;

-- Admins and Managers may read the full log.
drop policy if exists "reading edit log readable by admin/manager"
  on public.reading_edit_audit_log;
create policy "reading edit log readable by admin/manager"
  on public.reading_edit_audit_log
  for select
  using (public.is_manager_or_admin(auth.uid()));

-- Any authenticated user with access to the plant may insert a log row —
-- operators log their own edits, not just managers, since operators are
-- now allowed to edit their own recent entries.
drop policy if exists "reading edit log insertable by plant users"
  on public.reading_edit_audit_log;
create policy "reading edit log insertable by plant users"
  on public.reading_edit_audit_log
  for insert
  with check (
    plant_id is null or public.user_has_plant_access(plant_id)
  );

-- Log rows are immutable: no update / delete policies -> denied by default.

-- <<<<<<< END ARCHIVED: 20260717000001_reading_edit_audit_log.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260718000001_pending_review_and_cascade_correction.sql >>>>>>>
-- =============================================================================
-- Migration: 20260718_pending_review_and_cascade_correction.sql
-- Fixes two bugs found in the Data Corrections / reading-guard workflow:
--
-- 1. src/lib/readingGuards.ts (and LocatorSection.tsx / WellSection.tsx) save
--    backward or spike-flagged readings with norm_status = 'pending_review'.
--    The 20260514_normalization.sql CHECK constraint only allowed
--    'normal' | 'erroneous' | 'normalized' | 'retracted', so every one of
--    those saves was failing with a check-constraint violation. This adds
--    'pending_review' to the allowed set.
--
-- 2. src/pages/DataCorrections.tsx calls a Postgres RPC function
--    fn_cascade_reading_correction(p_table, p_row_id, p_new_current,
--    p_admin_id, p_reason) that was never created in any migration, so the
--    "Edit value" / "Approve correction request" actions always failed.
--    This creates it.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Allow 'pending_review' on all four reading tables ────────────────────

ALTER TABLE locator_readings DROP CONSTRAINT IF EXISTS locator_readings_norm_status_check;
ALTER TABLE locator_readings
  ADD CONSTRAINT locator_readings_norm_status_check
  CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));

ALTER TABLE well_readings DROP CONSTRAINT IF EXISTS well_readings_norm_status_check;
ALTER TABLE well_readings
  ADD CONSTRAINT well_readings_norm_status_check
  CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));

DO $$ BEGIN
  ALTER TABLE product_meter_readings DROP CONSTRAINT IF EXISTS product_meter_readings_norm_status_check;
  ALTER TABLE product_meter_readings
    ADD CONSTRAINT product_meter_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ro_train_readings may not exist in all deployments; guard as the original migration did
DO $$ BEGIN
  ALTER TABLE ro_train_readings DROP CONSTRAINT IF EXISTS ro_train_readings_norm_status_check;
  ALTER TABLE ro_train_readings
    ADD CONSTRAINT ro_train_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 2. wells.gps_lat / gps_lng ───────────────────────────────────────────────
-- WellDialogs.tsx (Add and Edit) has always read/written these two columns,
-- with defensive fallback logic for when they're missing from the schema
-- cache — but no migration ever actually created them.

ALTER TABLE wells
  ADD COLUMN IF NOT EXISTS gps_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_lng NUMERIC;

-- ── 3. fn_cascade_reading_correction ─────────────────────────────────────────
-- Corrects a single reading's current_reading and cascades the change forward:
--   - Recomputes this row's own daily_volume (for tables where it's a plain
--     stored column — locator_readings.daily_volume is GENERATED ALWAYS AS
--     and is left for Postgres to recompute).
--   - Finds the NEXT chronological reading for the same entity and updates
--     its previous_reading (and, where applicable, its own daily_volume) so
--     the delta chain stays consistent.
--   - Marks the row 'normalized' and writes an append-only audit row to
--     reading_normalizations.
-- Only usable by Admin / Data Analyst, matching the reading_normalizations
-- RLS policies.

-- The function may already exist (with parameter defaults that CREATE OR
-- REPLACE cannot change) from an earlier partial attempt — drop it first so
-- this definition applies cleanly either way.
DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

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
  v_next_id         UUID;
  v_cascade_id      UUID;
  v_role            TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')) THEN
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
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
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
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
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

  -- Cascade: the next chronological reading for this entity has its
  -- previous_reading pinned to the OLD current_reading — fix it to match.
  EXECUTE format(
    'SELECT id FROM %I WHERE %I = $1 AND reading_datetime > $2 ORDER BY reading_datetime ASC LIMIT 1',
    p_table, v_entity_col
  ) INTO v_next_id
  USING v_entity_id, v_reading_dt;

  IF v_next_id IS NOT NULL THEN
    IF v_has_stored_vol THEN
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = GREATEST(0, current_reading - $1) WHERE id = $2',
        p_table
      ) USING p_new_current, v_next_id;
    ELSE
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING p_new_current, v_next_id;
    END IF;
    v_cascade_id := v_next_id;
  END IF;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 ELSE 3 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object('success', true, 'cascade_id', v_cascade_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- <<<<<<< END ARCHIVED: 20260718000001_pending_review_and_cascade_correction.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260719000001_offline_reason_tracking.sql >>>>>>>
-- =============================================================================
-- Migration: 20260719_offline_reason_tracking.sql
-- Adds "why is there no data" reason tracking for Wells, Locators, and RO
-- Trains, replacing blank Data Summary cells with an explanation.
--
-- Two distinct situations, two mechanisms:
--
-- 1. Entity marked Offline/Inactive (a status change, may span many days).
--    entity_status_audit_log never existed as a real table (only ever written
--    through a defensive try/catch — "table may not exist yet"), so this
--    creates it for the first time, with reason columns included from the
--    start.
--
-- 2. Entity still Active/Running, but no reading was logged for a specific
--    day (no status change involved). New table: reading_gap_reasons, one
--    row per (entity, day).
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. entity_status_audit_log ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_status_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  plant_id        UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  entity_type     TEXT        NOT NULL CHECK (entity_type IN ('Well', 'Locator', 'RO Train')),
  entity_id       UUID        NOT NULL,
  entity_label    TEXT,
  from_status     TEXT        NOT NULL,
  to_status       TEXT        NOT NULL,
  reason_category TEXT        CHECK (reason_category IN
                    ('pump_problem', 'locked_meter', 'equipment_malfunction',
                     'maintenance', 'access_issue', 'other')),
  reason_detail   TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defensive — in case the table already exists (e.g. created ad hoc via
-- Studio) without these columns.
ALTER TABLE entity_status_audit_log ADD COLUMN IF NOT EXISTS reason_category TEXT;
ALTER TABLE entity_status_audit_log ADD COLUMN IF NOT EXISTS reason_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_status_audit_entity
  ON entity_status_audit_log (entity_type, entity_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_entity_status_audit_plant
  ON entity_status_audit_log (plant_id, timestamp DESC);

ALTER TABLE entity_status_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_status_audit_read" ON entity_status_audit_log;
CREATE POLICY "entity_status_audit_read" ON entity_status_audit_log FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "entity_status_audit_write" ON entity_status_audit_log;
CREATE POLICY "entity_status_audit_write" ON entity_status_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- ── 2. reading_gap_reasons ────────────────────────────────────────────────────
-- Any operator with plant access may log/update these — unlike status
-- changes, this isn't manager-gated, since it's the day-to-day operator who
-- knows why a reading wasn't taken.

CREATE TABLE IF NOT EXISTS reading_gap_reasons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT        NOT NULL CHECK (entity_type IN ('well', 'locator', 'ro_train')),
  entity_id       UUID        NOT NULL,
  plant_id        UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  gap_date        DATE        NOT NULL,
  reason_category TEXT        NOT NULL CHECK (reason_category IN
                    ('pump_problem', 'locked_meter', 'equipment_malfunction',
                     'maintenance', 'access_issue', 'other')),
  reason_detail   TEXT,
  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, gap_date)
);

CREATE INDEX IF NOT EXISTS idx_reading_gap_reasons_lookup
  ON reading_gap_reasons (entity_type, entity_id, gap_date);
CREATE INDEX IF NOT EXISTS idx_reading_gap_reasons_plant
  ON reading_gap_reasons (plant_id, gap_date DESC);

ALTER TABLE reading_gap_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reading_gap_reasons_plant_access" ON reading_gap_reasons;
CREATE POLICY "reading_gap_reasons_plant_access" ON reading_gap_reasons FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- <<<<<<< END ARCHIVED: 20260719000001_offline_reason_tracking.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260720000001_recursive_cascade_and_meter_rollover.sql >>>>>>>
-- =============================================================================
-- Migration: 20260720_recursive_cascade_and_meter_rollover.sql
-- Fixes two data-integrity gaps found in a follow-up audit of the Data
-- Corrections workflow:
--
-- 1. fn_cascade_reading_correction only repaired the SINGLE next reading's
--    previous_reading after a correction. In the common case (correcting one
--    isolated bad reading) that is sufficient, because only the immediate
--    next row's previous_reading depends on the corrected row's
--    current_reading. But real deployments can already have BROKEN chains
--    further downstream — from raw edits made via /data-analysis/edit-raw,
--    from regression-applied corrections (which write corrected_value
--    directly and never call this function at all), or from earlier manual
--    DB fixes — where previous_reading no longer matches the prior row's
--    current_reading for two or more consecutive links. This migration
--    replaces the single-hop fix with a bounded walk that keeps repairing
--    previous_reading / daily_volume forward until it reaches a link that
--    is already internally consistent (or runs out of rows), so a
--    correction actually heals the whole downstream chain, not just the
--    first link of it.
--
-- 2. Meter rollovers (mechanical odometer wraps, e.g. 99999 -> 00012) were
--    indistinguishable from data-entry backward readings: readingGuards.ts
--    flagged both as 'pending_review' with the same code path, and daily
--    volume for either case was clamped to 0 (GREATEST(0, current -
--    previous)), silently discarding real production on legitimate
--    rollover days. This adds `is_meter_rollover` and `meter_rollover_max`
--    columns to the three volumetric reading tables so a rollover can be
--    marked explicitly and its true delta computed as
--    (meter_max - previous) + current instead of clamped to zero.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Meter-rollover columns ────────────────────────────────────────────────
-- meter_rollover_max is the odometer's wrap point (e.g. 99999 for a 5-digit
-- mechanical counter). Stored per-reading (not looked up from the entity
-- config table) so the generated/derived daily_volume expression for
-- locator_readings — which can only reference columns on the same row —
-- has everything it needs without a cross-table lookup.

ALTER TABLE well_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

DO $$ BEGIN
  ALTER TABLE product_meter_readings
    ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- locator_readings.daily_volume is GENERATED ALWAYS AS (current_reading -
-- COALESCE(previous_reading,0)) STORED with no rollover awareness AND no
-- floor at zero — a rollover previously produced a large *negative* daily
-- volume that fed straight into dashboards and NRW calculations. Add the
-- rollover columns, then rebuild the generated expression to be both
-- rollover-aware and floored at zero (matching the clamping already used
-- everywhere else in the app for this table's siblings).
ALTER TABLE locator_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

ALTER TABLE locator_readings DROP COLUMN IF EXISTS daily_volume;
ALTER TABLE locator_readings ADD COLUMN daily_volume NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN is_meter_rollover AND meter_rollover_max IS NOT NULL THEN
      GREATEST(0, (meter_rollover_max - COALESCE(previous_reading, 0)) + current_reading)
    ELSE
      GREATEST(0, current_reading - COALESCE(previous_reading, 0))
  END
) STORED;

COMMENT ON COLUMN well_readings.is_meter_rollover IS
  'True when current_reading < previous_reading because the mechanical meter wrapped around, not because of a data-entry error. Distinct from the pre-existing meter REPLACEMENT flow (new physical meter installed).';
COMMENT ON COLUMN well_readings.meter_rollover_max IS
  'The odometer wrap point for this reading (e.g. 99999). Used with is_meter_rollover to compute the true delta instead of clamping to zero.';

-- ── 2. fn_cascade_reading_correction — recursive downstream repair ──────────

DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

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
  IF NOT (public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')) THEN
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
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
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
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
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
  -- Walk forward link by link. At each hop, check whether the next row's
  -- previous_reading already matches the upstream current_reading we're
  -- propagating. If it does, the chain is consistent from here on and we
  -- stop — this is what makes a normal single-point correction terminate
  -- after exactly one hop, same as before. If it does NOT match (a
  -- pre-existing broken link further down the chain), fix it and keep
  -- walking using that row's own current_reading as the new cursor value.
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

    -- Chain is already consistent from this point on — nothing further to fix.
    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        v_iter_daily_vol := GREATEST(0, v_iter_current - v_cursor_current);
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      -- locator_readings: daily_volume is GENERATED and recomputes itself
      -- from previous_reading / is_meter_rollover / meter_rollover_max —
      -- only previous_reading needs writing here.
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

    -- This row's own current_reading is what the NEXT row's previous_reading
    -- must match, so it becomes the new cursor for the next iteration.
    v_cursor_current := v_iter_current;
    v_cursor_dt := v_iter_dt;
  END LOOP;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 ELSE 3 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object(
    'success', true,
    'cascade_id', v_cascade_ids[1],           -- kept for backward compatibility with existing callers
    'cascade_ids', to_jsonb(v_cascade_ids),
    'cascade_hops', array_length(v_cascade_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- ── 3. regression_results.truncated ──────────────────────────────────────────
-- run_regression() previously applied a hard 2 000-row .limit() with no way
-- for the caller to know the date range actually had more data than was
-- used. The service now fetches one row past the limit to detect this and
-- needs a column to persist the flag alongside each stored result.

ALTER TABLE regression_results
  ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN regression_results.truncated IS
  'True when the source date range had more rows than was read (see ROW_LIMIT in regression_service.py) — the fitted line only reflects the first ROW_LIMIT rows in chronological order.';

-- <<<<<<< END ARCHIVED: 20260720000001_recursive_cascade_and_meter_rollover.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000001_missing_rls_policies.sql >>>>>>>
-- =============================================================================
-- Migration: 20260721_missing_rls_policies.sql
--
-- Adds missing RLS policies to tables that have ALTER TABLE … ENABLE ROW
-- LEVEL SECURITY but zero CREATE POLICY statements, and adds RLS entirely to
-- status_checks (which had neither).
--
-- With RLS enabled but no policies, Supabase defaults to DENY ALL for
-- authenticated users. This migration fixes the silent read/write failures
-- these tables currently cause in the app.
-- =============================================================================

-- ── Tables that all follow the user_has_plant_access(plant_id) pattern ────────

-- afm_readings
DROP POLICY IF EXISTS "afm_readings_plant_access" ON afm_readings;
CREATE POLICY "afm_readings_plant_access" ON afm_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- cartridge_readings
DROP POLICY IF EXISTS "cartridge_readings_plant_access" ON cartridge_readings;
CREATE POLICY "cartridge_readings_plant_access" ON cartridge_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- checklist_executions (plant_id nullable; fall back to plant_id IS NULL for global templates)
DROP POLICY IF EXISTS "checklist_executions_plant_access" ON checklist_executions;
CREATE POLICY "checklist_executions_plant_access" ON checklist_executions
  FOR ALL TO authenticated
  USING  (plant_id IS NULL OR public.user_has_plant_access(plant_id))
  WITH CHECK (plant_id IS NULL OR public.user_has_plant_access(plant_id));

-- chemical_dosing_logs
DROP POLICY IF EXISTS "chemical_dosing_logs_plant_access" ON chemical_dosing_logs;
CREATE POLICY "chemical_dosing_logs_plant_access" ON chemical_dosing_logs
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- chemical_inventory
DROP POLICY IF EXISTS "chemical_inventory_plant_access" ON chemical_inventory;
CREATE POLICY "chemical_inventory_plant_access" ON chemical_inventory
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- cip_logs
DROP POLICY IF EXISTS "cip_logs_plant_access" ON cip_logs;
CREATE POLICY "cip_logs_plant_access" ON cip_logs
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- incidents
DROP POLICY IF EXISTS "incidents_plant_access" ON incidents;
CREATE POLICY "incidents_plant_access" ON incidents
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- locator_meter_replacements
DROP POLICY IF EXISTS "locator_meter_replacements_plant_access" ON locator_meter_replacements;
CREATE POLICY "locator_meter_replacements_plant_access" ON locator_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- power_readings
DROP POLICY IF EXISTS "power_readings_plant_access" ON power_readings;
CREATE POLICY "power_readings_plant_access" ON power_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- pump_readings
DROP POLICY IF EXISTS "pump_readings_plant_access" ON pump_readings;
CREATE POLICY "pump_readings_plant_access" ON pump_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ro_train_readings
DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON ro_train_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- well_meter_replacements
DROP POLICY IF EXISTS "well_meter_replacements_plant_access" ON well_meter_replacements;
CREATE POLICY "well_meter_replacements_plant_access" ON well_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- well_pms_records
DROP POLICY IF EXISTS "well_pms_records_plant_access" ON well_pms_records;
CREATE POLICY "well_pms_records_plant_access" ON well_pms_records
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── Audit-log tables: read = admin only, write = service role ─────────────────

-- reading_edit_audit_log
DROP POLICY IF EXISTS "reading_edit_audit_log_read" ON reading_edit_audit_log;
CREATE POLICY "reading_edit_audit_log_read" ON reading_edit_audit_log
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "reading_edit_audit_log_write" ON reading_edit_audit_log;
CREATE POLICY "reading_edit_audit_log_write" ON reading_edit_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- deletion_audit_log  (admin-read only; writes via service-role backend)
DROP POLICY IF EXISTS "deletion_audit_log_admin_read" ON deletion_audit_log;
CREATE POLICY "deletion_audit_log_admin_read" ON deletion_audit_log
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- import_analysis  (admin-read only)
DROP POLICY IF EXISTS "import_analysis_admin_read" ON import_analysis;
CREATE POLICY "import_analysis_admin_read" ON import_analysis
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "import_analysis_write" ON import_analysis;
CREATE POLICY "import_analysis_write" ON import_analysis
  FOR ALL TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- login_attempts  (admin-read only; written by auth triggers / service role)
DROP POLICY IF EXISTS "login_attempts_admin_read" ON login_attempts;
CREATE POLICY "login_attempts_admin_read" ON login_attempts
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- ── status_checks: add RLS (currently has none at all) ────────────────────────
-- This is an internal heartbeat table — any authenticated user can insert a
-- row; reads are admin-only.
ALTER TABLE status_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_checks_write" ON status_checks;
CREATE POLICY "status_checks_write" ON status_checks
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "status_checks_admin_read" ON status_checks;
CREATE POLICY "status_checks_admin_read" ON status_checks
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- <<<<<<< END ARCHIVED: 20260721000001_missing_rls_policies.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000002_outlier_count_column.sql >>>>>>>
-- ============================================================
-- §4 item 4 — Materialize outlier_count on regression_results
-- ============================================================
--
-- PROBLEM:
--   Every call to DataAnalysis.tsx's regression-results query was pulling
--   the full `corrections` JSONB array (potentially hundreds of rows × many
--   KB each) purely to count how many entries have is_outlier=true.
--   That count is then shown in the result-list card header.
--
-- FIX:
--   Add a real integer column that is kept in sync with the corrections array
--   by a trigger.  Reads only need to select `outlier_count`; the full
--   `corrections` blob is only fetched when a result card is expanded.
--
-- BACKFILL:
--   Existing rows are populated immediately via UPDATE.
--
-- TRIGGER:
--   Fires BEFORE INSERT OR UPDATE on regression_results so the column is
--   always correct at write time — no async job needed.

-- 1) Add column (idempotent)
ALTER TABLE public.regression_results
  ADD COLUMN IF NOT EXISTS outlier_count integer NOT NULL DEFAULT 0;

-- 2) Backfill existing rows
UPDATE public.regression_results
SET outlier_count = (
  SELECT COUNT(*)::int
  FROM jsonb_array_elements(
    COALESCE(corrections, '[]'::jsonb)
  ) AS elem
  WHERE (elem ->> 'is_outlier')::boolean IS TRUE
)
WHERE outlier_count = 0;   -- skip rows already set (safe for re-runs)

-- 3) Trigger function — recomputes on every insert/update that touches corrections
CREATE OR REPLACE FUNCTION public.trg_regression_results_outlier_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.outlier_count := (
    SELECT COUNT(*)::int
    FROM jsonb_array_elements(
      COALESCE(NEW.corrections, '[]'::jsonb)
    ) AS elem
    WHERE (elem ->> 'is_outlier')::boolean IS TRUE
  );
  RETURN NEW;
END;
$$;

-- 4) Attach trigger (drop first so migration is re-runnable)
DROP TRIGGER IF EXISTS trg_regression_results_outlier_count
  ON public.regression_results;

CREATE TRIGGER trg_regression_results_outlier_count
BEFORE INSERT OR UPDATE OF corrections
ON public.regression_results
FOR EACH ROW EXECUTE FUNCTION public.trg_regression_results_outlier_count();

-- <<<<<<< END ARCHIVED: 20260721000002_outlier_count_column.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000003_pressure_unique_constraint.sql >>>>>>>
-- =============================================================================
-- Migration: 20260721_pressure_unique_constraint.sql
--
-- Codifies the `uix_well_one_per_user_per_hour` unique index that was created
-- directly in the Supabase dashboard (ad-hoc) and therefore missing from
-- migrations. Without this migration, a full DB rebuild from migrations would
-- silently lose the constraint.
--
-- Constraint intent: prevent an operator from inserting two separate
-- well_readings rows for the same well within the same clock-hour. Updates
-- to an existing row are not affected.
--
-- Uses IF NOT EXISTS — safe to run against a DB that already has the index.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uix_well_one_per_user_per_hour
  ON well_readings (well_id, recorded_by, date_trunc('hour', reading_datetime, 'Asia/Manila'));

-- <<<<<<< END ARCHIVED: 20260721000003_pressure_unique_constraint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000004_product_meters_and_readings.sql >>>>>>>
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
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  norm_status       TEXT        NOT NULL DEFAULT 'normal'
                    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted')),
  is_meter_rollover  BOOLEAN     NOT NULL DEFAULT false,
  meter_rollover_max NUMERIC
);

-- Keep databases that already had this table aligned with fresh installs.
ALTER TABLE product_meter_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

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

-- <<<<<<< END ARCHIVED: 20260721000004_product_meters_and_readings.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000001_derived_meter_support.sql >>>>>>>
-- Derived-meter support (Section 7.3 of master plan)
-- Allows a locator to be marked as "has no physical meter" with its value
-- derived from mother-meter minus all sibling locators. Optionally mirrors
-- the computed value into a product_meters row on another plant.

ALTER TABLE locators
  ADD COLUMN IF NOT EXISTS is_derived        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_meter_id UUID REFERENCES product_meters(id);

ALTER TABLE product_meters
  ADD COLUMN IF NOT EXISTS is_derived             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_locator_id UUID REFERENCES locators(id);

-- Index for the cron sweep to find derived locators quickly
CREATE INDEX IF NOT EXISTS idx_locators_is_derived
  ON locators (is_derived) WHERE is_derived = true;

CREATE INDEX IF NOT EXISTS idx_product_meters_is_derived
  ON product_meters (is_derived) WHERE is_derived = true;

COMMENT ON COLUMN locators.is_derived IS
  'When true, this locator has no physical meter; its reading is computed as mother_meter − Σ(sibling locators).';
COMMENT ON COLUMN locators.derived_from_meter_id IS
  'The product meter (mother meter) this derived locator''s reading is subtracted from. NULL when is_derived=false.';
COMMENT ON COLUMN product_meters.is_derived IS
  'When true, this meter''s reading is a mirror of a derived locator from another plant.';
COMMENT ON COLUMN product_meters.derived_from_locator_id IS
  'The locator whose derived value is mirrored into this product meter row. NULL when is_derived=false.';

-- <<<<<<< END ARCHIVED: 20260722000001_derived_meter_support.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000002_mother_meter_derived.sql >>>>>>>
-- ============================================================
-- §7.3 — Mother Meter / Locators derived-meter config
-- ============================================================
--
-- CONTEXT:
--   The "Hamas case" (plant SRP supplies Mambaling through a shared
--   pipeline).  A locator at SRP (Hamas) has no physical meter — its
--   daily volume is derived: total through the mother product meter
--   minus the sum of all other metered locators on the same meter.
--   That derived value must also mirror into a product_meters row at
--   Mambaling so NRW/Dashboard on BOTH plants remain self-consistent.
--
--   Key insight: calc.nrw() is already a single formula fed by pivot
--   sums grouped by plant_id.  No NRW or Dashboard code changes are
--   needed — the feature reduces to "compute one number, write it into
--   two existing tables."
--
-- SCHEMA ADDITIONS:
--   locators
--     is_derived            BOOL  — true = no physical meter; value computed
--     derived_from_meter_id UUID  — the product_meter whose readings are the
--                                   basis for residual computation
--
--   product_meters
--     is_derived            BOOL  — true = mirrors a derived locator's value
--     derived_from_locator_id UUID — which locator provides the value to mirror
--
-- CONSTRAINT:
--   At most ONE derived (is_derived=true) locator per mother meter
--   is enforced via a partial unique index.  The residual formula has
--   no unique answer for two unknowns.

-- ── locators ──────────────────────────────────────────────────────────────────
ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS is_derived              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_meter_id   uuid    REFERENCES public.product_meters(id) ON DELETE SET NULL;

-- Enforce at most one derived locator per mother meter at the DB level.
-- A partial unique index is cheaper than a trigger and self-documenting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_derived_locator_per_meter
  ON public.locators (derived_from_meter_id)
  WHERE is_derived = true AND derived_from_meter_id IS NOT NULL;

-- ── product_meters ────────────────────────────────────────────────────────────
ALTER TABLE public.product_meters
  ADD COLUMN IF NOT EXISTS is_derived               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_locator_id  uuid    REFERENCES public.locators(id) ON DELETE SET NULL;

-- ── is_estimated — mark cron-computed readings so the UI can distinguish them ─
-- Operator-entered readings are is_estimated=false (default).
-- Cron-computed derived readings are is_estimated=true so they can be filtered
-- or labelled in DataSummaryModal and the per-locator history view.
ALTER TABLE public.locator_readings
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.product_meter_readings
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;

-- ── Derived-meter sweep audit table ──────────────────────────────────────────
-- Records every cron run so we can answer "when was this derived value last
-- recomputed?" and skip dates already processed (incremental, not full-history).
CREATE TABLE IF NOT EXISTS public.derived_meter_sweep_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  swept_at        timestamptz NOT NULL DEFAULT now(),
  locator_id      uuid        NOT NULL REFERENCES public.locators(id)  ON DELETE CASCADE,
  date_key        date        NOT NULL,
  old_value       numeric,
  new_value       numeric,
  changed         boolean     NOT NULL DEFAULT false,
  mirror_meter_id uuid        REFERENCES public.product_meters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dms_log_locator_date
  ON public.derived_meter_sweep_log (locator_id, date_key);

-- ── RLS: service-role only (cron job uses service key) ───────────────────────
-- Regular users never read/write this table directly; it's an internal audit log.
ALTER TABLE public.derived_meter_sweep_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY derived_meter_sweep_log_service_only
  ON public.derived_meter_sweep_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- <<<<<<< END ARCHIVED: 20260722000002_mother_meter_derived.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000003_well_readings_optional_columns.sql >>>>>>>
-- =============================================================================
-- Migration: 20260722_well_readings_optional_columns.sql
--
-- Formally adds four columns to well_readings that were created ad-hoc via
-- the Supabase dashboard and therefore absent from all migrations.  Missing
-- from migrations means:
--   1. A DB rebuild from migrations loses the columns silently.
--   2. PostgREST's schema cache may be stale (no NOTIFY was ever sent after
--      adding them ad-hoc), causing UPDATE payloads that include these columns
--      to fail with the misleading error:
--        "relation 'well_readings' does not exist"
--
-- Affected frontend:  ReadingHistoryDialog.tsx → saveEdit() (well module)
--                     WellSection.tsx → saveTds(), saveNtu(), savePressure()
--
-- All ADD COLUMN statements use IF NOT EXISTS — safe against any DB that
-- already has the columns from the prior ad-hoc additions.
-- =============================================================================

-- ── 1. tds_ppm ────────────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS tds_ppm NUMERIC
    CHECK (tds_ppm IS NULL OR tds_ppm >= 0);

COMMENT ON COLUMN public.well_readings.tds_ppm IS
  'Total dissolved solids in parts-per-million. Measured at point of well discharge.';

-- ── 2. turbidity_ntu ─────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS turbidity_ntu NUMERIC
    CHECK (turbidity_ntu IS NULL OR turbidity_ntu >= 0);

COMMENT ON COLUMN public.well_readings.turbidity_ntu IS
  'Water turbidity in Nephelometric Turbidity Units.';

-- ── 3. pressure_psi ──────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS pressure_psi NUMERIC
    CHECK (pressure_psi IS NULL OR pressure_psi >= 0);

COMMENT ON COLUMN public.well_readings.pressure_psi IS
  'Wellhead pressure in pounds per square inch.';

-- ── 4. is_meter_replacement ──────────────────────────────────────────────────
-- Flags readings where the meter was physically replaced.  When true, the
-- daily_volume delta is zeroed so dashboards do not miscount the new meter's
-- lower reading as a production loss.
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.well_readings.is_meter_replacement IS
  'True when this reading immediately follows a physical meter swap. daily_volume is treated as 0 for this row.';

-- ── 5. Index — TDS / NTU queries for water quality reports ──────────────────
CREATE INDEX IF NOT EXISTS idx_well_readings_water_quality
  ON public.well_readings (well_id, reading_datetime DESC)
  WHERE tds_ppm IS NOT NULL OR turbidity_ntu IS NOT NULL;

-- ── 6. Reload PostgREST schema cache ─────────────────────────────────────────
-- Without this, PostgREST keeps its stale in-memory schema and UPDATE
-- payloads that include the new columns are rejected with:
--   "relation 'well_readings' does not exist"
-- This NOTIFY unblocks the issue immediately without needing a server restart.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260722000003_well_readings_optional_columns.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000004_z_pgrst_schema_reload.sql >>>>>>>
-- =============================================================================
-- Migration: 20260722_pgrst_schema_reload.sql
--
-- Forces PostgREST to reload its in-memory schema cache.
--
-- 12 prior migrations added columns, tables, or views to the database without
-- sending NOTIFY pgrst, 'reload schema'.  PostgREST periodically auto-reloads
-- (default: every 10 s in Supabase), but a stale cache in the window between
-- reloads causes UPDATE/INSERT requests to reject columns with the misleading
-- error "relation '<table>' does not exist" instead of a column-not-found msg.
--
-- This is a one-time catch-up.  All future migrations that add schema objects
-- should end with:
--     NOTIFY pgrst, 'reload schema';
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260722000004_z_pgrst_schema_reload.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260723000001_manager_data_corrections_access.sql >>>>>>>
-- =============================================================================
-- Migration: 20260723_manager_data_corrections_access.sql
--
-- src/pages/DataCorrections.tsx already gates its own UI on
--   isAdmin || isManager || isDataAnalyst
-- (see the "Access restricted" card in that file), and the sidebar/bottom-nav
-- link is now shown to Manager too. But the two things that actually enforce
-- write access underneath the page were never updated to match:
--
-- 1. fn_cascade_reading_correction (used by "Edit value" and "Approve
--    correction request") only allows Admin / Data Analyst. A Manager
--    hitting either action gets 'Not authorized to correct readings'.
-- 2. reading_normalizations — the append-only audit table that Pending /
--    Inbox / History all read from and write to directly (approve, reject,
--    retract) — only has RLS policies for Admin / Data Analyst. A Manager's
--    direct inserts/selects against that table are silently denied by RLS.
--
-- This migration adds 'Manager' to both, so Manager gets the same
-- correction/approve/reject/retract capability Admin and Data Analyst
-- already have — not just a view of the page.
--
-- Note: correction_requests (the table backing the "Inbox" tab / operator
-- submitted correction requests) is not created by any migration in this
-- repo — it was set up directly in the Supabase dashboard at some point, so
-- its current RLS can't be inspected or safely rewritten from here. It has a
-- plant_id column, so it most likely already follows the same
-- "*_plant_access" FOR ALL pattern as every other operational table (see
-- 20260419_initial_schema_enums_and_roles.sql), in which case Manager
-- already has read/update access via plant assignment and no change is
-- needed. If it turns out to have its own Admin/Data-Analyst-only policies,
-- apply the same fix as below to it directly in the Supabase SQL editor.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. fn_cascade_reading_correction — allow Manager ─────────────────────────
-- Redefinition is identical to the 20260720_recursive_cascade_and_meter_rollover.sql
-- version (recursive downstream repair), with Manager added to the role check.

DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

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
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
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
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
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
  -- Walk forward link by link. At each hop, check whether the next row's
  -- previous_reading already matches the upstream current_reading we're
  -- propagating. If it does, the chain is consistent from here on and we
  -- stop — this is what makes a normal single-point correction terminate
  -- after exactly one hop, same as before. If it does NOT match (a
  -- pre-existing broken link further down the chain), fix it and keep
  -- walking using that row's own current_reading as the new cursor value.
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

    -- Chain is already consistent from this point on — nothing further to fix.
    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        v_iter_daily_vol := GREATEST(0, v_iter_current - v_cursor_current);
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      -- locator_readings: daily_volume is GENERATED and recomputes itself
      -- from previous_reading / is_meter_rollover / meter_rollover_max —
      -- only previous_reading needs writing here.
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

    -- This row's own current_reading is what the NEXT row's previous_reading
    -- must match, so it becomes the new cursor for the next iteration.
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
    'cascade_id', v_cascade_ids[1],           -- kept for backward compatibility with existing callers
    'cascade_ids', to_jsonb(v_cascade_ids),
    'cascade_hops', array_length(v_cascade_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- ── 2. reading_normalizations RLS — allow Manager ────────────────────────────
-- Same policies as 20260514_normalization.sql, with Manager added.

DROP POLICY IF EXISTS "analyst_read_normalizations" ON reading_normalizations;
CREATE POLICY "analyst_read_normalizations"
  ON reading_normalizations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
      OR public.has_role(auth.uid(), 'Manager')
    )
  );

DROP POLICY IF EXISTS "analyst_insert_normalizations" ON reading_normalizations;
CREATE POLICY "analyst_insert_normalizations"
  ON reading_normalizations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
      OR public.has_role(auth.uid(), 'Manager')
    )
    AND performed_by = auth.uid()
  );

-- No UPDATE or DELETE — audit table stays append-only.

-- ── Done ──────────────────────────────────────────────────────────────────────
-- locator_readings / well_readings / product_meter_readings need no changes:
-- they're already covered by each table's blanket "<table>_plant_access" FOR ALL
-- policy (USING public.user_has_plant_access(plant_id)), which is role-agnostic —
-- any authenticated user assigned to the plant, Manager included, can already
-- UPDATE norm_status on those tables directly.

-- <<<<<<< END ARCHIVED: 20260723000001_manager_data_corrections_access.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260724000001_import_action_in_audit_log.sql >>>>>>>
-- =============================================================================
-- Migration: 20260724_import_action_in_audit_log.sql
-- Extends reading_edit_audit_log to accept 'import' batch log entries.
--
-- Problem: CSV import via ImportROReadingsDialog has no provenance trail —
-- imported rows are currently indistinguishable from live operator entries.
--
-- Changes:
--   1. Widen action CHECK: ('update','delete') → ('update','delete','import')
--   2. Allow record_id to be NULL for import rows (a CSV import covers N records,
--      not a single source_id; we store metadata in the changes jsonb instead).
--   3. Re-enforce NOT NULL for update/delete rows via a compensating CHECK.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- 1. Drop and re-add the action constraint with 'import' included
ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_action_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_action_check
  CHECK (action IN ('update', 'delete', 'import'));

-- 2. Make record_id nullable — import log rows cover many records, not one
ALTER TABLE public.reading_edit_audit_log
  ALTER COLUMN record_id DROP NOT NULL;

-- 3. Compensating check: update/delete rows still require a non-null record_id
ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_record_id_required;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_record_id_required
  CHECK (action = 'import' OR record_id IS NOT NULL);

-- <<<<<<< END ARCHIVED: 20260724000001_import_action_in_audit_log.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260725000001_ro_train_readings_latest_view.sql >>>>>>>
-- Replaces the "select * from ro_train_readings, keep first row per train_id
-- client-side" pattern in ROTrains.tsx (was pulling the entire unbounded
-- history over the wire on every 60s poll).
--
-- DISTINCT ON (train_id) does the "latest row per train" reduction inside
-- Postgres instead of on the client, so payload size stops growing with
-- history depth and stays O(number of trains).

create or replace view public.ro_train_readings_latest
with (security_invoker = true) as
select distinct on (train_id) *
from public.ro_train_readings
order by train_id, reading_datetime desc;

-- Supporting index: without this, DISTINCT ON still needs a sort over the
-- whole table. With it, Postgres can skip-scan by train_id and only touch
-- the newest row per train, which is what keeps this cheap forever.
create index if not exists idx_ro_train_readings_train_id_reading_datetime
  on public.ro_train_readings (train_id, reading_datetime desc);

-- PostgREST needs explicit grants on the view object itself, separate from
-- RLS on the base table. security_invoker (Postgres 15+, which Supabase
-- runs) makes sure the base table's RLS policies still apply per-caller
-- instead of running as the view owner and silently bypassing RLS.
grant select on public.ro_train_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260725000001_ro_train_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260726000001_opex_budgets.sql >>>>>>>
-- opex_budgets: monthly power/chemical opex budget targets per plant, compared
-- against actuals already tracked in production_costs (Costs → Rollup/Budget tabs).
--
-- Visibility AND edit rights are both restricted to Manager/Admin — this is
-- financial planning data, not an operational reading, so unlike most tables
-- in this schema it is NOT read-visible to every role with plant access.

CREATE TABLE public.opex_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  budget_month date NOT NULL,               -- always the 1st of the month
  power_budget numeric NOT NULL DEFAULT 0,
  chem_budget numeric NOT NULL DEFAULT 0,
  total_budget numeric GENERATED ALWAYS AS (power_budget + chem_budget) STORED,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plant_id, budget_month),
  CONSTRAINT opex_budgets_month_is_first_of_month
    CHECK (budget_month = date_trunc('month', budget_month)::date),
  CONSTRAINT opex_budgets_non_negative
    CHECK (power_budget >= 0 AND chem_budget >= 0)
);

CREATE INDEX idx_opex_budgets_plant_month ON public.opex_budgets(plant_id, budget_month DESC);

ALTER TABLE public.opex_budgets ENABLE ROW LEVEL SECURITY;

-- Read: Manager/Admin only, still scoped to plants they're assigned to
-- (is_admin short-circuits user_has_plant_access, so Admins see every plant).
CREATE POLICY opex_budgets_read ON public.opex_budgets FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_insert ON public.opex_budgets FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_update ON public.opex_budgets FOR UPDATE TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_delete ON public.opex_budgets FOR DELETE TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE TRIGGER trg_opex_budgets_updated BEFORE UPDATE ON public.opex_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- <<<<<<< END ARCHIVED: 20260726000001_opex_budgets.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000001_hamas_phase0_roles_and_audit.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase0_roles_and_audit.sql
-- Phase 0 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- Adds:
--   1. is_manager_or_analyst_or_admin() — a NEW helper (Admin+Manager+Data
--      Analyst). Deliberately NOT a rewrite of the existing
--      is_manager_or_admin() (Admin+Manager only), which is used in ~34 RLS
--      policies across 11 other migrations — changing its semantics would
--      silently change permissions everywhere else it's referenced.
--   2. fn_notify_derived_review() — shared notification fan-out used by both
--      the Phase 2 sweep function and the Phase 3 staleness trigger, so the
--      "who gets notified" logic lives in exactly one place.
--   3. Extends reading_edit_audit_log.table_name to allow 'locator_readings',
--      so Hamas overrides reuse the existing audit trail (logReadingEdit() /
--      diffFields() in frontend/src/pages/ro-trains/helpers.tsx) instead of a
--      new parallel logging mechanism.
-- =============================================================================

-- ── 1. Role helper: Admin, Manager, OR Data Analyst ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_manager_or_analyst_or_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('Admin','Manager','Data Analyst')
  );
$$;

COMMENT ON FUNCTION public.is_manager_or_analyst_or_admin(UUID) IS
  'Admin, Manager, or Data Analyst. Used to gate who may override a derived '
  '(is_derived) locator''s value — deliberately separate from '
  'is_manager_or_admin(), which several unrelated RLS policies already rely '
  'on excluding Data Analyst.';

-- ── 2. Shared notification fan-out for derived-locator review events ───────
-- Notifies every Active user who is Admin, Manager, or Data Analyst AND has
-- access to the locator's plant (Admins implicitly have access to all
-- plants, matching user_has_plant_access()'s own logic).
--
-- _kind: 'stale'      — a sibling locator or the mother meter changed; the
--                        derived value for _date may no longer be correct.
--        'superseded' — the sweep recomputed a date that held a manual
--                        override and the new value differs from it.
CREATE OR REPLACE FUNCTION public.fn_notify_derived_review(
  _locator_id UUID,
  _date       DATE,
  _kind       TEXT,
  _detail     TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locator   RECORD;
  v_title     TEXT;
  v_message   TEXT;
  v_severity  public.severity_level;
  v_recipient RECORD;
BEGIN
  SELECT l.id, l.name, l.plant_id, p.name AS plant_name
    INTO v_locator
    FROM public.locators l
    JOIN public.plants   p ON p.id = l.plant_id
   WHERE l.id = _locator_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF _kind = 'superseded' THEN
    v_title    := v_locator.name || ' override superseded';
    v_severity := 'High';
    v_message  := COALESCE(_detail,
      'The sweep recomputed ' || v_locator.name || ' (' || v_locator.plant_name ||
      ') for ' || to_char(_date, 'Mon DD, YYYY') ||
      ' and replaced a manually-entered value with a fresh calculation.');
  ELSE
    v_title    := v_locator.name || ' needs review';
    v_severity := 'Medium';
    v_message  := COALESCE(_detail,
      v_locator.name || ' (' || v_locator.plant_name || ') has new sibling or ' ||
      'mother-meter data for ' || to_char(_date, 'Mon DD, YYYY') ||
      ' — its computed value may be out of date until the next sweep or a manual recalculation.');
  END IF;

  FOR v_recipient IN
    SELECT up.id
      FROM public.user_profiles up
     WHERE up.status = 'Active'
       AND public.is_manager_or_analyst_or_admin(up.id)
       AND (public.is_admin(up.id) OR v_locator.plant_id = ANY(up.plant_assignments))
  LOOP
    INSERT INTO public.notifications (user_id, plant_id, alert_type, severity, title, message, link_path)
    VALUES (v_recipient.id, v_locator.plant_id, 'derived_meter_review', v_severity, v_title, v_message, '/operations?tab=locator');
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_derived_review(UUID, DATE, TEXT, TEXT) IS
  'Fans out a notification to every Active Admin/Manager/Data Analyst with '
  'access to a derived locator''s plant. Called from the Phase 3 staleness '
  'trigger (_kind=stale) and the Phase 2 sweep function (_kind=superseded).';

-- ── 3. Extend the audit log to cover locator_readings ───────────────────────
ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'locator_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000001_hamas_phase0_roles_and_audit.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000002_hamas_phase1_default_input_mode.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase1_default_input_mode.sql
-- Phase 1 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   The "Direct m³ / Raw Meter" toggle in Operations > Locator was never
--   persisted server-side — LocatorSection.tsx read/wrote it to
--   localStorage.getItem('loc-mode-' + locatorId) (see BlendingSection.tsx /
--   PowerSection.tsx for the equivalent pattern in those two tabs, which are
--   NOT touched by this migration — they write to different tables and are
--   out of scope here). That meant two operators on two different devices
--   could see two different modes for the same locator, with no record of
--   which one is actually correct for that meter.
--
--   This column makes the mode a real, plant-config-owned setting: something
--   a Manager/Admin sets once for the locator (mirroring the existing
--   canEdit = isManager || isAdmin convention in ProductMeters.tsx), which
--   Operations then just reads. No new RLS policy is needed — the existing
--   "locators_write" policy (Admin/Manager + plant access) already covers
--   UPDATEs to this new column since it's just another column on `locators`.
-- =============================================================================

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS default_input_mode TEXT NOT NULL DEFAULT 'raw'
    CHECK (default_input_mode IN ('raw', 'direct'));

COMMENT ON COLUMN public.locators.default_input_mode IS
  'raw = operator enters the cumulative meter reading (delta computed by the '
  'DB). direct = operator enters the day''s volume directly. Set once per '
  'locator by Manager/Admin in Plant config; Operations reads this instead '
  'of a per-device localStorage toggle.';

-- Per this project's own convention (see 20260722_z_pgrst_schema_reload.sql):
-- new columns need this or PostgREST can reject requests referencing them
-- with a misleading error until its next periodic cache reload.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000002_hamas_phase1_default_input_mode.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000003_hamas_phase2_sweep_function.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase2_sweep_function.sql
-- Phase 2 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   .github/workflows/derived-meter-sweep.yml already exists and has been
--   calling POST {SUPABASE_URL}/rest/v1/rpc/fn_sweep_derived_meters on a
--   schedule since it was added — but the function itself was never created
--   (the migration it depends on, 20260726_sweep_derived_meters.sql, does
--   not exist in this repo). Every scheduled run has been failing with a
--   Postgres "function does not exist" error. This migration creates that
--   function, matching the exact RPC signature (p_date, p_lookback_days) and
--   JSON response shape ({"ok": true, ...}) the workflow already expects, so
--   no workflow changes are needed beyond the cadence update in Phase 2's
--   accompanying .github/workflows edit.
--
-- FORMULA:
--   For each is_derived locator L with mother meter M = L.derived_from_meter_id,
--   for each date in [p_date - p_lookback_days + 1, p_date]:
--     residual = SUM(M's product_meter_readings.daily_volume that day)
--              − SUM(daily_volume of L's non-derived sibling locators that day)
--   Both source daily_volume columns are already rollover-aware / normalized
--   by the application, so the sweep reads them directly rather than
--   re-deriving current − previous itself.
--
--   Days are bucketed by Asia/Manila calendar date, matching the "yesterday
--   PHT" convention .github/workflows/nightly-summary.yml already uses and
--   the 5-minutes-earlier scheduling comment in derived-meter-sweep.yml.
--
-- WRITE BEHAVIOR (the "supersede" decision from the Hamas planning thread):
--   • No existing reading for that locator/date  → INSERT (is_estimated=true).
--   • Existing reading is sweep-computed (is_estimated=true) and the new
--     residual differs → UPDATE it in place.
--   • Existing reading is a human override (is_estimated=false) and the new
--     residual differs → UPDATE it (supersede), flip back to
--     is_estimated=true, and notify Admin/Manager/Data Analyst via
--     fn_notify_derived_review(..., 'superseded', ...) — "your override was
--     replaced." If the new residual matches the override, it's left alone.
--   • Any successful compute (mother meter had data that day) resolves an
--     open review flag for that locator/date, whether or not the value
--     actually moved.
--   • If a product_meters row mirrors this locator (derived_from_locator_id),
--     the same value is written into that meter's product_meter_readings —
--     it may belong to a different plant (the Hamas/Mambaling case).
--
-- SECURITY:
--   SECURITY DEFINER so it can write across locator_readings /
--   product_meter_readings / derived_meter_sweep_log / notifications
--   regardless of caller. Matches the existing workflow, which calls this
--   using the anon key (no user session) — there is no authenticated caller
--   to check a role against at that call site. The Phase 4 migration
--   separately restricts *direct table writes* to derived-locator readings
--   to Manager/Analyst/Admin; that restriction does not apply to this
--   function's own internal writes. p_lookback_days is capped defensively
--   since this function performs writes and is callable without auth.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters(
  p_date          DATE,
  p_lookback_days INT DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lookback        INT := LEAST(GREATEST(COALESCE(p_lookback_days, 3), 1), 30);
  v_locator         RECORD;
  v_mirror          RECORD;
  v_day             DATE;
  v_mother_vol      NUMERIC;
  v_siblings_vol    NUMERIC;
  v_new_value       NUMERIC;
  v_existing        RECORD;
  v_reading_dt      TIMESTAMPTZ;
  v_changed         BOOLEAN;
  v_was_override    BOOLEAN;
  v_locators_seen   INT := 0;
  v_rows_changed    INT := 0;
BEGIN
  FOR v_locator IN
    SELECT id, name, plant_id, derived_from_meter_id
      FROM public.locators
     WHERE is_derived = TRUE AND derived_from_meter_id IS NOT NULL
  LOOP
    v_locators_seen := v_locators_seen + 1;

    FOR v_day IN
      SELECT generate_series(p_date - (v_lookback - 1), p_date, INTERVAL '1 day')::date
    LOOP
      v_reading_dt := (v_day + TIME '23:59:00') AT TIME ZONE 'Asia/Manila';

      SELECT SUM(COALESCE(pmr.daily_volume, pmr.current_reading - pmr.previous_reading))
        INTO v_mother_vol
        FROM public.product_meter_readings pmr
       WHERE pmr.meter_id = v_locator.derived_from_meter_id
         AND (pmr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;

      -- Can't compute a residual without the mother meter's reading for that day.
      IF v_mother_vol IS NULL THEN
        CONTINUE;
      END IF;

      SELECT SUM(lr.daily_volume)
        INTO v_siblings_vol
        FROM public.locator_readings lr
        JOIN public.locators sib ON sib.id = lr.locator_id
       WHERE sib.product_meter_id = v_locator.derived_from_meter_id
         AND sib.is_derived = FALSE
         AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;

      v_new_value := v_mother_vol - COALESCE(v_siblings_vol, 0);

      SELECT lr.id, lr.daily_volume, lr.is_estimated
        INTO v_existing
        FROM public.locator_readings lr
       WHERE lr.locator_id = v_locator.id
         AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day
       ORDER BY lr.reading_datetime DESC
       LIMIT 1;

      v_changed      := FALSE;
      v_was_override := FOUND AND v_existing.is_estimated = FALSE;

      IF NOT FOUND THEN
        INSERT INTO public.locator_readings
          (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
        VALUES
          (v_locator.id, v_locator.plant_id, v_reading_dt, v_new_value, 0, TRUE);
        v_changed := TRUE;

      ELSIF ABS(COALESCE(v_existing.daily_volume, 0) - v_new_value) > 0.005 THEN
        UPDATE public.locator_readings
           SET current_reading = v_new_value, previous_reading = 0, is_estimated = TRUE
         WHERE id = v_existing.id;
        v_changed := TRUE;
      END IF;

      IF v_changed AND v_was_override THEN
        PERFORM public.fn_notify_derived_review(v_locator.id, v_day, 'superseded', NULL);
      END IF;

      INSERT INTO public.derived_meter_sweep_log
        (locator_id, date_key, old_value, new_value, changed)
      VALUES
        (v_locator.id, v_day, v_existing.daily_volume, v_new_value, v_changed);

      IF v_changed THEN
        v_rows_changed := v_rows_changed + 1;
      END IF;

      -- A successful compute resolves any open "needs review" flag for this
      -- date, whether or not the stored value actually moved.
      -- NOTE: locator_derived_review_flags is created in Phase 3
      -- (20260727_hamas_phase3_review_flags_and_notify.sql), which must run
      -- after this migration. plpgsql doesn't validate table references in a
      -- function body at CREATE time, only at execution — and this function
      -- is never called until well after all five phase migrations have run
      -- (via the cron workflow or the "Recalculate now" button), so the
      -- ordering is safe. It would NOT be safe to call this function
      -- manually between applying Phase 2 and Phase 3.
      UPDATE public.locator_derived_review_flags
         SET resolved_at = now()
       WHERE locator_id = v_locator.id AND date_key = v_day AND resolved_at IS NULL;

      -- Mirror into any product_meters row that mirrors this locator's value
      -- (may belong to a different plant — the Hamas/Mambaling case).
      FOR v_mirror IN
        SELECT id, plant_id FROM public.product_meters WHERE derived_from_locator_id = v_locator.id
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.product_meter_readings
           WHERE meter_id = v_mirror.id
             AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day
        ) THEN
          UPDATE public.product_meter_readings
             SET current_reading = v_new_value, previous_reading = 0,
                 daily_volume = v_new_value, is_estimated = TRUE
           WHERE meter_id = v_mirror.id
             AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;
        ELSE
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_new_value, 0, v_new_value, TRUE);
        END IF;
      END LOOP;

    END LOOP; -- days
  END LOOP; -- derived locators

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'derived_locators_seen', v_locators_seen,
    'rows_changed', v_rows_changed
  );
END;
$$;

COMMENT ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) IS
  'Recomputes residual volume (mother meter minus sibling locators) for every '
  'is_derived locator over a rolling lookback window, mirrors the result into '
  'any linked product_meters row, and notifies Admin/Manager/Data Analyst if '
  'a manual override gets superseded. Called on a schedule by '
  '.github/workflows/derived-meter-sweep.yml and on demand by the '
  '"Recalculate now" button in Operations > Locator.';

-- Callable both by the GitHub Actions cron (anon key, no user session) and by
-- authenticated users clicking "Recalculate now" in the UI.
GRANT EXECUTE ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000003_hamas_phase2_sweep_function.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000004_hamas_phase3_review_flags_and_notify.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase3_review_flags_and_notify.sql
-- Phase 3 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- Watches for edits that can change a derived locator's residual formula
-- (mother meter − Σ sibling locators) and flags the affected date as
-- "needs review" + notifies Admin/Manager/Data Analyst — per the Hamas
-- planning decision, this fires on edits to a SIBLING locator's reading OR
-- the mother meter's own reading, not just siblings.
--
-- Deliberately does NOT fire on edits to the derived locator's own row —
-- those are the sweep (Phase 2) or a manual override (Phase 4) writing the
-- answer, not a new input.
--
-- Deliberately does NOT re-flag/re-notify while a flag for that date is
-- already open, so a run of several sibling edits before anyone's reviewed
-- the first one doesn't spam a notification per edit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.locator_derived_review_flags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  locator_id  UUID        NOT NULL REFERENCES public.locators(id) ON DELETE CASCADE,
  date_key    DATE        NOT NULL,
  flagged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_review_flags_locator_date
  ON public.locator_derived_review_flags (locator_id, date_key);

-- At most one OPEN flag per (locator, date) — repeated triggers for the same
-- unresolved date just no-op against this instead of piling up rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_review_flag
  ON public.locator_derived_review_flags (locator_id, date_key)
  WHERE resolved_at IS NULL;

ALTER TABLE public.locator_derived_review_flags ENABLE ROW LEVEL SECURITY;

-- Read: same audience as the override capability — Admin/Manager/Data
-- Analyst with access to the locator's plant. No client INSERT/UPDATE
-- policy is defined; only the SECURITY DEFINER trigger function and the
-- SECURITY DEFINER sweep function write to this table (mirroring how
-- derived_meter_sweep_log is service/definer-only).
DROP POLICY IF EXISTS "review_flags_read" ON public.locator_derived_review_flags;
CREATE POLICY "review_flags_read" ON public.locator_derived_review_flags
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.locators l
       WHERE l.id = locator_derived_review_flags.locator_id
         AND public.user_has_plant_access(l.plant_id)
    )
  );

-- ── Trigger function ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_flag_derived_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locator_id UUID;
  v_meter_id   UUID;
  v_day        DATE;
  v_relevant   BOOLEAN := TRUE;
  v_sib        RECORD;
BEGIN
  IF TG_TABLE_NAME = 'locator_readings' THEN
    SELECT is_derived, product_meter_id INTO v_sib
      FROM public.locators WHERE id = COALESCE(NEW.locator_id, OLD.locator_id);

    -- A derived locator's own row being written is the sweep/override
    -- answering, not a new sibling input — ignore it here.
    IF v_sib.is_derived THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    v_meter_id := v_sib.product_meter_id;
    v_day := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;

    IF TG_OP = 'UPDATE' THEN
      v_relevant := NEW.current_reading    IS DISTINCT FROM OLD.current_reading
                 OR NEW.previous_reading   IS DISTINCT FROM OLD.previous_reading
                 OR NEW.reading_datetime   IS DISTINCT FROM OLD.reading_datetime
                 OR NEW.is_meter_rollover  IS DISTINCT FROM OLD.is_meter_rollover
                 OR NEW.meter_rollover_max IS DISTINCT FROM OLD.meter_rollover_max;
    END IF;

  ELSIF TG_TABLE_NAME = 'product_meter_readings' THEN
    v_meter_id := COALESCE(NEW.meter_id, OLD.meter_id);
    v_day := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;

    IF TG_OP = 'UPDATE' THEN
      v_relevant := NEW.current_reading  IS DISTINCT FROM OLD.current_reading
                 OR NEW.previous_reading IS DISTINCT FROM OLD.previous_reading
                 OR NEW.daily_volume     IS DISTINCT FROM OLD.daily_volume
                 OR NEW.reading_datetime IS DISTINCT FROM OLD.reading_datetime;
    END IF;

  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT v_relevant OR v_meter_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id INTO v_locator_id
    FROM public.locators
   WHERE derived_from_meter_id = v_meter_id AND is_derived = TRUE
   LIMIT 1;

  IF v_locator_id IS NULL THEN
    RETURN COALESCE(NEW, OLD); -- this meter has no derived (Hamas-style) locator
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.locator_derived_review_flags
     WHERE locator_id = v_locator_id AND date_key = v_day AND resolved_at IS NULL
  ) THEN
    INSERT INTO public.locator_derived_review_flags (locator_id, date_key)
    VALUES (v_locator_id, v_day);

    PERFORM public.fn_notify_derived_review(v_locator_id, v_day, 'stale', NULL);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_derived_review_locator ON public.locator_readings;
CREATE TRIGGER trg_flag_derived_review_locator
  AFTER INSERT OR UPDATE OR DELETE ON public.locator_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_flag_derived_review();

DROP TRIGGER IF EXISTS trg_flag_derived_review_meter ON public.product_meter_readings;
CREATE TRIGGER trg_flag_derived_review_meter
  AFTER INSERT OR UPDATE OR DELETE ON public.product_meter_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_flag_derived_review();

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000004_hamas_phase3_review_flags_and_notify.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000005_hamas_phase4_override_rls.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase4_override_rls.sql
-- Phase 4 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   locator_readings' existing "locator_readings_plant_access" policy is
--   FOR ALL TO authenticated USING (user_has_plant_access(plant_id)) — i.e.
--   role-agnostic. Today, any authenticated user with plant access can
--   already INSERT/UPDATE/DELETE any locator_readings row, including for
--   is_derived locators; only the frontend hiding the input has been
--   preventing it. This migration adds real DB-level enforcement.
--
--   Postgres RLS policies are additive (OR'd) within the same command, so a
--   normal PERMISSIVE policy can't narrow what locator_readings_plant_access
--   already allows. RESTRICTIVE policies are the correct tool: they AND on
--   top of whatever permissive policies already allow, without touching or
--   risking the existing broad policy that lets operators submit their own
--   (non-derived) readings.
--
--   Three separate policies are required — CREATE POLICY takes exactly one
--   command per statement (no "FOR INSERT, UPDATE" shorthand).
-- =============================================================================

DROP POLICY IF EXISTS "derived_locator_readings_insert_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_insert_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "derived_locator_readings_update_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_update_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "derived_locator_readings_delete_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_delete_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

-- Note: these three RESTRICTIVE policies apply only to normal authenticated
-- client sessions. fn_sweep_derived_meters() (Phase 2) is SECURITY DEFINER
-- and bypasses RLS entirely, as does the reading-integrity trigger — neither
-- is affected by this change.

-- <<<<<<< END ARCHIVED: 20260727000005_hamas_phase4_override_rls.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000006_meter_replacement_wiring.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260727000006_meter_replacement_wiring.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260728000001_hamas_phase5_input_mode_aware_guard.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-28, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02). This is the ORIGINAL
-- version, kept for history — see 20260801162405_hamas_phase9_fix_integrity_
-- trigger_direct_mode.sql for the fix applied after the bug it introduced
-- was diagnosed.
--
-- Extended fn_locator_reading_integrity (the general locator_readings
-- validation trigger — spike/backward-reading detection) to be aware of
-- direct-input-mode locators, adding a separate spike check for them. BUG:
-- the pre-existing "NEW.previous_reading := v_prev_reading" override (meant
-- for raw/cumulative meters) was left unconditional, running before the
-- new v_input_mode branch — so it silently clobbered previous_reading on
-- every write to a direct-mode/derived locator (e.g. HAMAS) too. This
-- fought fn_sweep_derived_meters_for_date()'s own explicit writes and was
-- the root cause of HAMAS's history showing 0 m³ for extended stretches.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
BEGIN
  SELECT default_input_mode INTO v_input_mode
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  IF v_input_mode = 'direct' THEN
    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260728000001_hamas_phase5_input_mode_aware_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260728000002_hamas_phase5_derive_config_guard.sql >>>>>>>
-- =============================================================================
-- Migration: 20260728_hamas_phase5_derive_config_guard.sql
-- Phase 5 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   Phases 0-4 built the compute/override/notify engine assuming
--   is_derived=true always comes with a non-null derived_from_meter_id —
--   fn_sweep_derived_meters() (Phase 2) filters on exactly that pair, and a
--   row that violates it just gets silently skipped by the sweep with no
--   error surfaced anywhere.
--
--   Until now the only way to set these two columns was a direct Supabase
--   table edit, so a mismatched pair never actually happened in practice.
--   This phase adds the "Derived / Hamas-style" toggle + mother-meter picker
--   to the Locator dialogs (frontend/src/pages/plants/locators/LocatorDialogs.tsx),
--   which makes it a normal form a Manager/Admin can get wrong — the API
--   layer's own validation (form.is_derived && !form.derived_from_meter_id
--   blocks Save) is a UX convenience, not enforcement. This CHECK constraint
--   is the actual enforcement, matching the project's existing pattern of a
--   client-side check paired with a DB-level one (see e.g. the
--   default_input_mode CHECK from Phase 1).
--
-- NOTE: does not attempt to prevent a derived_from_meter_id that creates a
-- cycle (A derived from a meter that itself mirrors a locator derived from
-- A) — that would need a recursive check across two tables and hasn't come
-- up in practice. Worth a follow-up if this ever gets more than a couple of
-- hops deep.
-- =============================================================================

ALTER TABLE public.locators
  DROP CONSTRAINT IF EXISTS locators_derived_requires_mother_meter;

ALTER TABLE public.locators
  ADD CONSTRAINT locators_derived_requires_mother_meter
  CHECK (NOT is_derived OR derived_from_meter_id IS NOT NULL);

COMMENT ON CONSTRAINT locators_derived_requires_mother_meter ON public.locators IS
  'A derived locator with no mother meter is silently invisible to '
  'fn_sweep_derived_meters() (it filters on is_derived=true AND '
  'derived_from_meter_id IS NOT NULL) — this makes that state impossible '
  'to save instead of failing quietly. Added alongside the Locator-dialog '
  'derive toggle in 20260728 (LocatorDialogs.tsx).';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260728000002_hamas_phase5_derive_config_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260728000003_locator_lock_status.sql >>>>>>>
-- =============================================================================
-- Migration: 20260728_locator_lock_status.sql
-- Phase 1 of the locked-meter + illegal-consumption flagging feature.
--
-- Adds a locator-level is_locked flag, independent of the existing Active/
-- Inactive `status` column. Deliberately NOT reusing `status`:
-- LocatorSection.tsx (~line 386), Dashboard.tsx, ReadingCoverageCard.tsx, and
-- PlantTopology.tsx all filter locators on status = 'Active' — a locator set
-- Inactive drops out of the Operations reading-entry list entirely. Since
-- catching illegal consumption on a locked meter requires readings to KEEP
-- being logged against it, the lock state has to live on a column nothing
-- already filters on.
--
-- Covers both a padlocked-but-connected meter and a physically disconnected
-- one under the single is_locked flag — no need to distinguish the two for
-- how this is handled downstream, so this stays a plain boolean (matching
-- the is_derived / is_estimated convention already used on this table)
-- instead of a multi-value status column.
--
-- Why a meter gets locked is a utility/account-level cause (unpaid bill,
-- tampering, vacant property, safety/repair work) — a different domain from
-- the equipment-failure reasons in the existing entity_status_audit_log
-- constraint (pump problem, equipment malfunction, etc.), which exists for
-- the Well/RO Train offline dialogs and the reading-gap dialog. Both sets
-- write into the same reason_category column, so the constraint below
-- extends to allow both. Keep this list in sync with
-- frontend/src/lib/reasonCodes.ts — REASON_CATEGORIES for the first six,
-- LOCK_REASON_CATEGORIES for the last four ('other' is shared, listed once).
--
-- No changes needed to reading_gap_reasons — the meter-lock reason dialog
-- only writes to entity_status_audit_log (via logStatusChange), not to the
-- reading-gap flow, so only that one constraint needs extending.
--
-- Phase 2 (separate migration) adds locator_lock_violation_flags + the
-- AFTER INSERT trigger on locator_readings that actually flags movement,
-- following the pattern in 20260727_hamas_phase0/phase3.
--
-- NOTE: an earlier draft of this migration (already pushed) created a
-- lock_status TEXT column instead. If that ran against this database, drop
-- it first so it doesn't linger unused alongside is_locked:
--   ALTER TABLE public.locators DROP COLUMN IF EXISTS lock_status;
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.locators.is_locked IS
  'Meter is padlocked/sealed or physically disconnected — independent of '
  'status (Active/Inactive). Unlike status=Inactive, this column is never '
  'filtered on when loading locators for reading entry — operators must '
  'keep being able to log readings against a locked meter so movement can '
  'be caught. See the 20260727 hamas migrations for the sibling '
  'review-flag pattern this feature follows.';

-- Partial index: only the (small) set of locked locators is ever queried by
-- name, so no need to index the common false case.
CREATE INDEX IF NOT EXISTS idx_locators_is_locked
  ON public.locators (is_locked) WHERE is_locked = true;

ALTER TABLE public.entity_status_audit_log
  DROP CONSTRAINT IF EXISTS entity_status_audit_log_reason_category_check;
ALTER TABLE public.entity_status_audit_log
  ADD CONSTRAINT entity_status_audit_log_reason_category_check
  CHECK (reason_category IN
    ('pump_problem', 'locked_meter', 'equipment_malfunction',
     'maintenance', 'access_issue', 'other',
     'unpaid_bill', 'tampering', 'vacant_property', 'safety_repair'));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260728000003_locator_lock_status.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000001_hamas_phase6_mirror_reading_integrity_fix.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-29, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02).
--
-- Fixes fn_sweep_derived_meters_for_date()'s mirror write into
-- product_meter_readings, which left current_reading/previous_reading NULL,
-- causing fn_product_meter_reading_integrity to permanently zero
-- daily_volume for every derived-meter mirror row (e.g. Mambaling's HAMAS,
-- stuck at 0 since 2026-06-29 despite correct residuals being logged in
-- derived_meter_sweep_log). Introduces the running-cumulative model for
-- both the locator row and its mirror (v_prev_cumulative + v_residual) —
-- later found to be inconsistent with how direct-mode locators are read
-- elsewhere in the app; see phase11 for the corrected model.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_prev_cumulative numeric;
  v_new_current     numeric;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;
  v_mirror_prev_cumulative  numeric;
  v_mirror_new_current      numeric;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(COALESCE(lr.daily_volume, 0)), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT current_reading INTO v_prev_cumulative
    FROM public.locator_readings
    WHERE locator_id = r_loc.id AND reading_datetime < v_day_start
    ORDER BY reading_datetime DESC LIMIT 1;
    v_prev_cumulative := COALESCE(v_prev_cumulative, 0);
    v_new_current := v_prev_cumulative + v_residual;

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_new_current, previous_reading = v_prev_cumulative, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_new_current, v_prev_cumulative, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT current_reading INTO v_mirror_prev_cumulative
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND norm_status NOT IN ('retracted', 'pending_review')
        AND reading_datetime < v_day_start
      ORDER BY reading_datetime DESC LIMIT 1;
      v_mirror_prev_cumulative := COALESCE(v_mirror_prev_cumulative, 0);
      v_mirror_new_current := v_mirror_prev_cumulative + v_residual;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_mirror_new_current,
            previous_reading = v_mirror_prev_cumulative,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_mirror_new_current, v_mirror_prev_cumulative, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260729000001_hamas_phase6_mirror_reading_integrity_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000002_hamas_phase7_scoped_sweep.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-29, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02).
--
-- Scopes fn_sweep_derived_meters_for_date() to only touch a (locator, date)
-- pair that's either today or has an open review flag
-- (locator_derived_review_flags) for that date, so a manual override on any
-- other date is never silently overwritten just because the routine sweep
-- ran again. Also (re)introduces fn_sweep_derived_meters(p_date,
-- p_lookback_days) as a thin dispatcher: sweeps the normal lookback window
-- day-by-day, then works through any additional flagged dates outside that
-- window (capped at 90 per call).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today           date        := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_prev_cumulative numeric;
  v_new_current     numeric;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;
  v_mirror_prev_cumulative  numeric;
  v_mirror_new_current      numeric;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    IF p_date <> v_today AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'not today and no open review flag for this date — left untouched'
      );
      CONTINUE;
    END IF;

    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(COALESCE(lr.daily_volume, 0)), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT current_reading INTO v_prev_cumulative
    FROM public.locator_readings
    WHERE locator_id = r_loc.id AND reading_datetime < v_day_start
    ORDER BY reading_datetime DESC LIMIT 1;
    v_prev_cumulative := COALESCE(v_prev_cumulative, 0);
    v_new_current := v_prev_cumulative + v_residual;

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_new_current, previous_reading = v_prev_cumulative, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_new_current, v_prev_cumulative, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT current_reading INTO v_mirror_prev_cumulative
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND norm_status NOT IN ('retracted', 'pending_review')
        AND reading_datetime < v_day_start
      ORDER BY reading_datetime DESC LIMIT 1;
      v_mirror_prev_cumulative := COALESCE(v_mirror_prev_cumulative, 0);
      v_mirror_new_current := v_mirror_prev_cumulative + v_residual;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_mirror_new_current,
            previous_reading = v_mirror_prev_cumulative,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_mirror_new_current, v_mirror_prev_cumulative, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    UPDATE public.locator_derived_review_flags
    SET resolved_at = now()
    WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL;

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters(p_date date DEFAULT NULL::date, p_lookback_days integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_end_date   date    := COALESCE(p_date, ((now() AT TIME ZONE 'Asia/Manila')::date - 1));
  v_lookback   integer := LEAST(GREATEST(COALESCE(p_lookback_days, 1), 1), 30);
  v_start_date date    := v_end_date - (v_lookback - 1);
  v_cursor     date    := v_start_date;
  v_days       jsonb   := '[]'::jsonb;
  v_flagged    date;
  v_extra      integer := 0;
BEGIN
  WHILE v_cursor <= v_end_date LOOP
    v_days := v_days || public.fn_sweep_derived_meters_for_date(v_cursor);
    v_cursor := v_cursor + 1;
  END LOOP;

  FOR v_flagged IN
    SELECT DISTINCT date_key FROM public.locator_derived_review_flags
     WHERE resolved_at IS NULL
       AND date_key NOT BETWEEN v_start_date AND v_end_date
     ORDER BY date_key
     LIMIT 90
  LOOP
    v_days := v_days || public.fn_sweep_derived_meters_for_date(v_flagged);
    v_extra := v_extra + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_start_date,
    'to', v_end_date,
    'extra_flagged_dates_swept', v_extra,
    'finished_at', now(),
    'days', v_days
  );
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260729000002_hamas_phase7_scoped_sweep.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000003_hamas_phase8_sibling_netting_fix.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-29, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02).
--
-- Fixes v_others_vol, which summed the always-NULL locator_readings.
-- daily_volume column instead of computing each sibling's real
-- current-previous delta (with a direct-mode-aware branch, since a direct
-- locator's current_reading already IS its volume). Before this fix the
-- residual mirrored the mother meter's entire volume rather than netting
-- out sibling consumption.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today           date        := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_prev_cumulative numeric;
  v_new_current     numeric;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;
  v_mirror_prev_cumulative  numeric;
  v_mirror_new_current      numeric;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    IF p_date <> v_today AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'not today and no open review flag for this date — left untouched'
      );
      CONTINUE;
    END IF;

    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN lr.previous_reading IS NULL THEN 0
        WHEN sib.default_input_mode = 'direct' THEN GREATEST(0, lr.current_reading)
        ELSE GREATEST(0, lr.current_reading - lr.previous_reading)
      END
    ), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT current_reading INTO v_prev_cumulative
    FROM public.locator_readings
    WHERE locator_id = r_loc.id AND reading_datetime < v_day_start
    ORDER BY reading_datetime DESC LIMIT 1;
    v_prev_cumulative := COALESCE(v_prev_cumulative, 0);
    v_new_current := v_prev_cumulative + v_residual;

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_new_current, previous_reading = v_prev_cumulative, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_new_current, v_prev_cumulative, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT current_reading INTO v_mirror_prev_cumulative
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND norm_status NOT IN ('retracted', 'pending_review')
        AND reading_datetime < v_day_start
      ORDER BY reading_datetime DESC LIMIT 1;
      v_mirror_prev_cumulative := COALESCE(v_mirror_prev_cumulative, 0);
      v_mirror_new_current := v_mirror_prev_cumulative + v_residual;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_mirror_new_current,
            previous_reading = v_mirror_prev_cumulative,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_mirror_new_current, v_mirror_prev_cumulative, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    UPDATE public.locator_derived_review_flags
    SET resolved_at = now()
    WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL;

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'mother_vol', v_mother_vol, 'others_vol', v_others_vol,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260729000003_hamas_phase8_sibling_netting_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000004_blending_events_meter_columns.sql >>>>>>>
-- =============================================================================
-- Migration: 20260729_blending_events_meter_columns.sql
--
-- Formally adds two columns to blending_events that were created ad-hoc via
-- the Supabase dashboard and therefore absent from all migrations — same
-- root cause already fixed for well_readings in
-- 20260722_well_readings_optional_columns.sql. Missing from migrations means:
--   1. A DB rebuild from migrations loses the columns silently.
--   2. PostgREST's schema cache may be stale (no NOTIFY was ever sent after
--      adding them ad-hoc), causing UPDATE/INSERT payloads that include
--      these columns to fail with the misleading error:
--        "relation 'blending_events' does not exist"
--
-- CONTEXT — pairs with the Operations > Blending fix that removed the
-- "Direct m³" input mode (frontend/src/pages/operations/blending/
-- BlendingSection.tsx): every blending well is physically metered, so
-- volume_m3 is now always a delta computed from two raw_meter_reading
-- values, never a directly-typed figure. raw_meter_reading being nullable
-- pre-fix is exactly how rows with no meter reading on record (Direct-mode
-- saves) got into the table with only a volume_m3 figure and no way to
-- verify or recompute it — see ReadingHistoryDialog.tsx's "Reading" column
-- for blending, which surfaces this gap today. NOT NULL isn't applied here
-- because existing Direct-mode rows already violate it; a follow-up
-- data-repair pass should backfill or flag those before tightening this
-- to NOT NULL.
--
-- Affected frontend: BlendingSection.tsx (BlendingForm, BlendingRow, CSV
--                     import), ReadingHistoryDialog.tsx (blending module).
--
-- All ADD COLUMN statements use IF NOT EXISTS — safe against any DB that
-- already has the columns from the prior ad-hoc additions.
-- =============================================================================

-- ── 1. raw_meter_reading ─────────────────────────────────────────────────────
-- The cumulative meter reading the operator read off the physical meter.
-- volume_m3 (the daily delta) is derived from this minus the previous
-- reading — the app has no way to compute a trustworthy volume without it.
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS raw_meter_reading NUMERIC
    CHECK (raw_meter_reading IS NULL OR raw_meter_reading >= 0);

COMMENT ON COLUMN public.blending_events.raw_meter_reading IS
  'Cumulative meter reading at time of entry. volume_m3 is this minus the '
  'previous reading for the same well. Nullable only for legacy rows saved '
  'before the Direct-m³ input mode was removed — new rows should always '
  'populate this.';

-- ── 2. is_meter_replacement ──────────────────────────────────────────────────
-- Flags readings where the meter was physically replaced. When true, the
-- volume_m3 delta is treated as 0 so dashboards don't miscount the new
-- meter's lower reading as a production loss — same convention as
-- well_readings.is_meter_replacement (20260722_well_readings_optional_columns.sql).
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.blending_events.is_meter_replacement IS
  'True when this reading immediately follows a physical meter swap. '
  'volume_m3 is treated as 0 for this row.';

-- ── 3. UPDATE / DELETE RLS policies ──────────────────────────────────────────
-- blending_events was created (20260515_supabase_only_and_data_analysis.sql)
-- with only SELECT and INSERT policies — every other operational readings
-- table (well_readings, locator_readings, ro_train_readings, etc.) got a
-- FOR ALL "{table}_plant_access" policy via the DO-block loop in
-- 20260419_initial_schema_enums_and_roles.sql, but blending_events was never
-- added to that array.
--
-- Effect in production today: ReadingHistoryDialog.tsx's Edit/Delete buttons
-- render unconditionally for blending (canEditDelete = true, no frontend role
-- gate — see line ~568) and call .update()/.delete() against blending_events,
-- but with no UPDATE/DELETE policy those calls affect 0 rows and are caught
-- by the component's own defensive "returned 0 rows. Add policy…" console
-- warnings. So this has been silently broken for every user, and is a direct
-- blocker for fixing the corrupted-volume rows that motivated this migration
-- (rows with volume_m3 holding a raw cumulative reading instead of a delta —
-- see BlendingSection.tsx's removal of the Direct-m³ input mode).
--
-- Matches the plant-access convention used for the other readings tables:
-- any authenticated user with access to the well's plant may write, exactly
-- like well_readings_plant_access / locator_readings_plant_access.
DROP POLICY IF EXISTS "blending_events_update" ON public.blending_events;
CREATE POLICY "blending_events_update" ON public.blending_events
  FOR UPDATE TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "blending_events_delete" ON public.blending_events;
CREATE POLICY "blending_events_delete" ON public.blending_events
  FOR DELETE TO authenticated
  USING (public.user_has_plant_access(plant_id));

-- ── 4. Reload PostgREST schema cache ─────────────────────────────────────────
-- Without this, PostgREST keeps its stale in-memory schema and UPDATE/INSERT
-- payloads that include the new columns are rejected with:
--   "relation 'blending_events' does not exist"
-- This NOTIFY unblocks the issue immediately without needing a server restart.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260729000004_blending_events_meter_columns.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000005_blending_previous_reading_trigger.sql >>>>>>>
-- =============================================================================
-- Migration: 20260729_blending_previous_reading_trigger.sql
--
-- MUST RUN AFTER: 20260729_blending_events_meter_columns.sql (adds
-- raw_meter_reading / is_meter_replacement as real columns, plus the
-- UPDATE/DELETE RLS policies this migration's trigger needs in order for
-- non-admin writes to actually take effect). Safe to run standalone too —
-- the ADD COLUMN IF NOT EXISTS lines below repeat those two columns
-- defensively in case ordering ever gets reversed.
--
-- CONTEXT: removing the "Direct m³" input mode (BlendingSection.tsx) stopped
-- operators from *choosing* to bypass the meter, but the mechanism that
-- actually corrupted volume_m3 historically is still live even after that
-- fix. BlendingRow resolves "previous cumulative reading" from localStorage
-- and computes the delta client-side; when no previous reading is found —
-- a new device, a cleared cache, a different field operator's phone, the
-- first save of the session — it still falls back to storing the raw meter
-- reading itself as if it were the day's volume. A fresh browser has no
-- localStorage entry, so this can still happen for any entry made today,
-- not just the historical rows already sitting in the table.
--
-- This migration moves "what is today's volume" out of the client entirely.
-- previous_reading becomes a real, DB-owned column. The client only ever
-- sends raw_meter_reading (+ reading_datetime, is_meter_replacement); the
-- trigger below resolves previous_reading from the well's own last
-- blending_events row and computes volume_m3 itself, on every INSERT and
-- UPDATE — a client can no longer set volume_m3 directly. A well's
-- first-ever reading now correctly logs 0 m³ today (nothing to diff against
-- yet) instead of dumping the full cumulative reading into "today's
-- volume" — that fallback was the bug.
--
-- Also discovered while writing this: reading_datetime on blending_events
-- has never appeared in any committed migration either (same ad-hoc-via-
-- dashboard pattern already found and fixed for raw_meter_reading /
-- is_meter_replacement in 20260729_blending_events_meter_columns.sql), even
-- though BlendingSection.tsx and ReadingHistoryDialog.tsx have been
-- reading/writing it against this table all along. Added defensively below.
--
-- COMPANION CHANGE: backend/blending_repair_audit.py's --apply path now also
-- writes previous_reading explicitly for every row it corrects (see that
-- file's diff). Without that, this trigger would treat the second row of a
-- repaired run as a fresh baseline — its own predecessor is still
-- unresolved with raw_meter_reading = NULL at that point — and re-zero the
-- exact delta the script just fixed. Run the repair script's --apply only
-- after both this migration and its own updated version are in place.
-- =============================================================================

ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS raw_meter_reading NUMERIC
    CHECK (raw_meter_reading IS NULL OR raw_meter_reading >= 0),
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reading_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_reading NUMERIC;

COMMENT ON COLUMN public.blending_events.previous_reading IS
  'Cumulative reading from this well''s prior blending_events row. Resolved '
  'server-side by trg_blending_set_reading on INSERT when not explicitly '
  'supplied — never trust a client-computed value for this. Left NULL means '
  'this row is this well''s baseline (no prior reading exists yet).';

-- ── Server-side previous_reading resolution + volume_m3 ownership ──────────
CREATE OR REPLACE FUNCTION public.fn_blending_set_reading()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_meter_reading IS NULL THEN
    RAISE EXCEPTION 'blending_events.raw_meter_reading is required — blending wells are meter-fed, direct volume entry is not supported';
  END IF;

  -- Only auto-resolve on INSERT, and only when the caller didn't supply one.
  -- An UPDATE that omits previous_reading simply keeps whatever is already
  -- stored (Postgres carries OLD values forward for columns not present in
  -- the UPDATE's SET list) — so a plain "fix a typo'd reading" edit via
  -- ReadingHistoryDialog never gets silently re-baselined.
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
    -- New meter, nothing to diff against — delta zeroed, this reading
    -- becomes the anchor for future deltas.
    NEW.volume_m3 := 0;
  ELSIF NEW.previous_reading IS NULL THEN
    -- No prior reading exists anywhere for this well — genuine baseline.
    -- This is the actual fix: 0 m³ logged today, not the full cumulative
    -- reading dumped in as "today's volume".
    NEW.volume_m3 := 0;
  ELSE
    IF NEW.raw_meter_reading < NEW.previous_reading THEN
      RAISE EXCEPTION 'raw_meter_reading (%) is below the previous cumulative reading (%) for this well — check for a meter replacement or entry error', NEW.raw_meter_reading, NEW.previous_reading;
    END IF;
    NEW.volume_m3 := NEW.raw_meter_reading - NEW.previous_reading;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blending_set_reading ON public.blending_events;
CREATE TRIGGER trg_blending_set_reading
  BEFORE INSERT OR UPDATE OF raw_meter_reading, previous_reading, is_meter_replacement
  ON public.blending_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_blending_set_reading();

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260729000005_blending_previous_reading_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000006_filter_replacements.sql >>>>>>>
-- ============================================================================
-- Filter Replacement Tracking (Bag / Cartridge filters)
-- Added 2026-07-29
--
-- Adds a dedicated replacement-event table and wires its cost into the
-- existing production_costs rollup as a third bucket, synced via trigger
-- the same way chemical_dosing_logs / power_readings / well_readings
-- already do.
--
-- Verified against the live schema (2026-07-29):
--   - production_costs.total_cost IS a GENERATED column
--     (chem_cost + power_cost) — see 20260420_power_tariffs.sql. Rebuilt
--     below to include filter_cost.
--   - RLS below uses this project's real helper functions,
--     public.user_has_plant_access(plant_id) and
--     public.is_manager_or_admin(auth.uid()), matching
--     chemical_deliveries' policies exactly (20260420_chemical_deliveries.sql).
--   - opex_budgets.filter_budget is intentionally NOT added in this pass —
--     BudgetTab.tsx / useOpexBudget.ts don't read it yet, so it would be an
--     inert column. Add it in a follow-up migration when Budget-tab parity
--     for Filters is actually wired up in the frontend.
-- ============================================================================

-- 0. Catch-up: filter_housing_type was applied directly to the live DB
--    without a committed migration. Idempotent no-op if already present.
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS filter_media_type text
  CHECK (filter_media_type IN ('AFM', 'Sand', 'Other'));

ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

-- 1. Replacement event log — modeled on chemical_deliveries
--    (quantity, unit_cost, supplier, delivery_date).
CREATE TABLE IF NOT EXISTS public.filter_replacements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  train_id            uuid REFERENCES public.ro_trains(id) ON DELETE SET NULL,
  replacement_date    date NOT NULL,
  -- Snapshot, not a live lookup: history must not shift retroactively if the
  -- plant/train's configured housing type is ever changed later.
  filter_housing_type text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  quantity_replaced   integer NOT NULL CHECK (quantity_replaced > 0),
  unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_cost          numeric(14,2) GENERATED ALWAYS AS (quantity_replaced * unit_price) STORED,
  avg_dp_psi          numeric(6,2),
  supplier            text,
  remarks             text,
  recorded_by         uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_plant_date
  ON public.filter_replacements (plant_id, replacement_date DESC);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_train
  ON public.filter_replacements (train_id) WHERE train_id IS NOT NULL;

-- 2. Cost rollup wiring — production_costs gains a third bucket.
ALTER TABLE public.production_costs
  ADD COLUMN IF NOT EXISTS filter_cost numeric(14,2) NOT NULL DEFAULT 0;

-- total_cost is GENERATED (chem_cost + power_cost) today — rebuild it to
-- include filter_cost. Safe to run even though production_costs already has
-- rows: DROP/ADD on a generated column recomputes it from existing data,
-- it does not touch chem_cost/power_cost/filter_cost themselves.
ALTER TABLE public.production_costs DROP COLUMN total_cost;
ALTER TABLE public.production_costs ADD COLUMN total_cost numeric(14,2)
  GENERATED ALWAYS AS (chem_cost + power_cost + filter_cost) STORED;

-- 3. Trigger: keep production_costs.filter_cost in sync with the sum of
--    that plant+date's replacements, mirroring the existing chem/power sync
--    pattern (public.trg_recompute_cost / public.recompute_production_cost)
--    so the Rollup view stays correct without app-layer work. This trigger
--    only ever writes the filter_cost column, so it can't race with
--    recompute_production_cost, which only ever writes chem_cost/power_cost/
--    production_m3/cost_per_m3 — the two never fight over the same field.
CREATE OR REPLACE FUNCTION public.fn_sync_filter_cost_to_production_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_plant uuid;
  target_date  date;
  new_total    numeric(14,2);
BEGIN
  target_plant := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  := COALESCE(NEW.replacement_date, OLD.replacement_date);

  SELECT COALESCE(SUM(total_cost), 0) INTO new_total
  FROM public.filter_replacements
  WHERE plant_id = target_plant AND replacement_date = target_date;

  INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, new_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_filter_replacements_sync_cost ON public.filter_replacements;
CREATE TRIGGER trg_filter_replacements_sync_cost
AFTER INSERT OR UPDATE OR DELETE ON public.filter_replacements
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_filter_cost_to_production_costs();

-- 4. RLS — read: anyone with plant access; write: Manager/Admin only.
--    Matches chemical_deliveries' policies exactly (single combined write
--    policy rather than separate INSERT/UPDATE/DELETE grants).
ALTER TABLE public.filter_replacements ENABLE ROW LEVEL SECURITY;

CREATE POLICY filter_replacements_read ON public.filter_replacements
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

CREATE POLICY filter_replacements_write ON public.filter_replacements
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- <<<<<<< END ARCHIVED: 20260729000006_filter_replacements.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000007_plant_meter_config_and_both_production_source.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260729000007_plant_meter_config_and_both_production_source.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000008_filter_usage_tracking.sql >>>>>>>
-- ============================================================================
-- Migration: 20260729000008_filter_usage_tracking.sql
--
-- Reconciles migration drift (roadmap Phase 1, "CI enforcement"): the filter
-- usage/cost tracking feature was applied against the live DB out-of-band
-- and only ever existed in a stray `frontend/supabase/migrations/` tree that
-- the root CLI never applies. Evidence of the live schema: types.ts carries
-- filter_unit_prices / cartridges_changed / fn_filter_unit_price /
-- filter_usage_daily, and src/lib/filterUsage.ts + EditPretreatReadingDialog
-- query them — yet a fresh `supabase start` (or the CI rls-tests job) could
-- not reproduce any of it. This migration brings those pieces under version
-- control. The stray tree itself is deleted in the same change so there is
-- exactly one migration source of truth again.
--
-- DELIBERATE OMISSION vs the stray file: its step 0 (`DROP TABLE
-- filter_replacements` + its trigger/function) is NOT ported. That drop was
-- cleanup for a failed first attempt in the live DB only; in a fresh
-- environment the root migration 20260729000006_filter_replacements.sql
-- legitimately creates filter_replacements, which the app actively uses
-- (src/lib/filterReplacements.ts, useCostComposition.ts, the history UI).
-- Dropping it here would break a fresh environment, not heal it.
--
-- KNOWN COEXISTENCE (left as-is, matching live): production_costs.filter_cost
-- is written by TWO triggers — trg_filter_replacements_sync_cost (from
-- replacement events, 000006) and trg_pretreatment_sync_filter_cost below
-- (from daily usage counts). Whichever fired last owns the day's value.
-- Unifying them is a product decision (which cost basis is canonical?) and
-- is intentionally deferred — see the trigger dependency graph doc.
--
-- Policy note: the stray file used `auth.jwt() ->> 'role'` with a ⚠ "swap
-- for the real role expression" TODO. This port uses the project's real
-- helpers (user_has_plant_access / is_manager_or_admin) exactly as
-- filter_replacements' policies do, and uses DROP POLICY IF EXISTS so the
-- file is idempotent whether the live table already has the old or no
-- policies.
--
-- Everything here is IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS: safe to
-- run against the live DB (no-op or policy refresh) and against a fresh
-- environment (full apply).
-- ============================================================================

-- 1. Parallel count column to bag_filters_changed (20260420000001), for
--    Cartridge Filter plants. Same habit, one more field on the existing
--    daily Pre-Treatment & RO log form.
ALTER TABLE public.ro_pretreatment_readings
  ADD COLUMN IF NOT EXISTS cartridges_changed integer NOT NULL DEFAULT 0
  CHECK (cartridges_changed >= 0);

-- 2. Effective-dated unit price — deliberately not a single "current price"
--    field: a price change shouldn't silently rewrite last month's cost
--    history. Admin/Manager insert a new row when the price changes; each
--    day's cost uses whatever was in effect on that date.
CREATE TABLE IF NOT EXISTS public.filter_unit_prices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  filter_housing_type text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  effective_from      date NOT NULL,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, filter_housing_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_filter_unit_prices_lookup
  ON public.filter_unit_prices (plant_id, filter_housing_type, effective_from DESC);

ALTER TABLE public.filter_unit_prices ENABLE ROW LEVEL SECURITY;

-- Read: anyone with plant access (same as filter_replacements). Write:
-- Manager/Admin with plant access.
DROP POLICY IF EXISTS filter_unit_prices_select ON public.filter_unit_prices;
CREATE POLICY filter_unit_prices_select ON public.filter_unit_prices
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS filter_unit_prices_write ON public.filter_unit_prices;
CREATE POLICY filter_unit_prices_write ON public.filter_unit_prices
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- 3. Price lookup as of a date. STABLE (read-only, safe in index/trigger
--    contexts); search_path pinned per the project's hardening convention.
CREATE OR REPLACE FUNCTION public.fn_filter_unit_price(
  p_plant_id uuid, p_housing_type text, p_as_of date
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT unit_price
  FROM public.filter_unit_prices
  WHERE plant_id = p_plant_id
    AND filter_housing_type = p_housing_type
    AND effective_from <= p_as_of
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

-- 4. Trigger: recompute that plant+date's filter_cost from usage counts
--    whenever a pretreatment reading's changed-counts (or its train/date)
--    change. Recomputes the whole day, not just the changed row, since
--    multiple trains can report the same day with different housing
--    types/prices. ON CONFLICT (plant_id, cost_date) relies on the UNIQUE
--    constraint production_costs has carried since 20260420000002.
CREATE OR REPLACE FUNCTION public.fn_sync_filter_usage_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_plant uuid := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  date  := (COALESCE(NEW.reading_datetime, OLD.reading_datetime))::date;
  day_total    numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(
    CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
      WHEN 'Bag Filter' THEN
        r.bag_filters_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Bag Filter', target_date), 0)
      ELSE
        r.cartridges_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Cartridge Filter', target_date), 0)
    END
  ), 0)
  INTO day_total
  FROM public.ro_pretreatment_readings r
  JOIN public.plants p ON p.id = r.plant_id
  LEFT JOIN public.ro_trains rt ON rt.id = r.train_id
  WHERE r.plant_id = target_plant
    AND r.reading_datetime::date = target_date;

  INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, day_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_pretreatment_sync_filter_cost ON public.ro_pretreatment_readings;
CREATE TRIGGER trg_pretreatment_sync_filter_cost
AFTER INSERT OR DELETE OR UPDATE OF cartridges_changed, bag_filters_changed, train_id, reading_datetime
ON public.ro_pretreatment_readings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_filter_usage_cost();

-- 5. Read-friendly view for the frontend — one clean source for both the
--    usage chart and the usage history list. security_invoker so the view
--    inherits the underlying tables' RLS (never bypasses it).
CREATE OR REPLACE VIEW public.filter_usage_daily WITH (security_invoker = true) AS
SELECT
  r.id,
  r.plant_id,
  r.train_id,
  r.reading_datetime::date AS reading_date,
  COALESCE(rt.filter_housing_type, p.filter_housing_type) AS filter_housing_type,
  CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
    WHEN 'Bag Filter' THEN r.bag_filters_changed
    ELSE r.cartridges_changed
  END AS quantity_changed,
  CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
    WHEN 'Bag Filter' THEN
      r.bag_filters_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Bag Filter', r.reading_datetime::date), 0)
    ELSE
      r.cartridges_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Cartridge Filter', r.reading_datetime::date), 0)
  END AS cost
FROM public.ro_pretreatment_readings r
JOIN public.plants p ON p.id = r.plant_id
LEFT JOIN public.ro_trains rt ON rt.id = r.train_id;

-- 6. opex_budgets wiring from the stray file is intentionally NOT ported:
--    opex_budgets exists (20260726000001) but BudgetTab.tsx doesn't read
--    filter_budget yet — an inert column, same reasoning 000006 used when
--    it deferred opex wiring for the replacement-event design.

-- <<<<<<< END ARCHIVED: 20260729000008_filter_usage_tracking.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260730000001_hamas_phase6_default_input_mode_guard.sql >>>>>>>
-- =============================================================================
-- Migration: 20260730_hamas_phase6_default_input_mode_guard.sql
-- Phase 6 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- BUG:
--   is_derived (20260722_derived_meter_support.sql) and default_input_mode
--   (20260727_hamas_phase1_default_input_mode.sql) are two independent
--   columns on `locators` with no link between them. default_input_mode is
--   NOT NULL DEFAULT 'raw', and nothing ever set it to 'direct' when a
--   locator became derived — not LocatorDialogs.tsx's own is_derived toggle
--   (it just hides the raw/direct <Select> once is_derived is checked, it
--   never touches the value underneath), and not ProductMeters.tsx's
--   locator-assignment save() (Section: assign/update/unassign loops all set
--   is_derived directly without ever including default_input_mode in the
--   update payload).
--
--   Net effect: a locator can be is_derived = true (no physical meter,
--   value computed by fn_sweep_derived_meters as mother meter − siblings)
--   while default_input_mode is still 'raw' — which sends every reader of
--   this locator (ReadingHistoryDialog, EntityHistoryChart) down the
--   cumulative-meter code path: showing a "Reading" column and computing
--   "Production" as a diff between consecutive rows, for a locator that has
--   no odometer to diff in the first place. This is exactly the state
--   Hamas (SRP) was found in.
--
-- FIX:
--   Same pattern as Phase 5's locators_derived_requires_mother_meter check
--   (client-side convenience + DB-level enforcement) — except a plain CHECK
--   can't self-correct an omitted field, it can only reject the whole write.
--   Since every existing caller already always includes is_derived in its
--   payload but not always default_input_mode, a CHECK constraint would
--   just start throwing on saves that used to succeed. A BEFORE trigger
--   instead auto-corrects default_input_mode to 'direct' whenever
--   is_derived is true, on both INSERT and UPDATE, regardless of which
--   screen (or future screen) is doing the writing.
--
--   The reverse direction (is_derived flips back to false) is intentionally
--   NOT handled by this trigger — a locator coming off derived status needs
--   an admin to actively choose raw vs. direct again (the <Select> reappears
--   in LocatorDialogs.tsx once !is_derived), so the app-code changes
--   accompanying this migration set default_input_mode back to 'raw'
--   explicitly on that transition instead of silently guessing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_force_direct_mode_when_derived()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_derived THEN
    NEW.default_input_mode := 'direct';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_force_direct_mode_when_derived() IS
  'BEFORE INSERT/UPDATE guard on locators: a derived (no-physical-meter) row '
  'can never be saved with default_input_mode = ''raw''. See Phase 6 header '
  'comment (20260730_hamas_phase6_default_input_mode_guard.sql) for the bug '
  'this closes. Deliberately one-directional — does not reset the mode back '
  'to ''raw'' when is_derived is turned off; the app layer handles that.';

DROP TRIGGER IF EXISTS trg_force_direct_mode ON public.locators;

CREATE TRIGGER trg_force_direct_mode
  BEFORE INSERT OR UPDATE ON public.locators
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_force_direct_mode_when_derived();

-- ── One-time backfill ────────────────────────────────────────────────────────
-- Fixes every already-derived locator caught by this bug today, Hamas (SRP)
-- included, without waiting for someone to re-open and re-save its config.
UPDATE public.locators
   SET default_input_mode = 'direct'
 WHERE is_derived = TRUE
   AND default_input_mode IS DISTINCT FROM 'direct';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260730000001_hamas_phase6_default_input_mode_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000001_hamas_phase8_drop_conflicting_prev_reading_guard.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase8_drop_conflicting_prev_reading_guard
-- Applied 2026-08-01 during the HAMAS all-zero-history investigation.
--
-- fn_sweep_derived_meters_for_date() (see phase6/7/8-sibling-netting above —
-- all backfilled from live, previously uncommitted) wrote a real
-- previous_reading (running cumulative) for is_derived locators like HAMAS.
--
-- trg_zz_locator_direct_mode_prev_reading (BEFORE INSERT/UPDATE on
-- locator_readings, fn_locator_direct_mode_prev_reading_guard() — never
-- itself committed to any migration, only discovered via
-- pg_get_functiondef) unconditionally forced previous_reading := 0 for any
-- is_derived or direct-input-mode locator on every write. Because Postgres
-- fires same-timing triggers in name order, this "zz"-prefixed trigger ran
-- AFTER trg_locator_readings_set_daily_volume had already computed
-- daily_volume from the correct previous_reading, then silently clobbered
-- previous_reading back to 0 anyway — leaving current_reading as a real
-- cumulative but previous_reading wrong, and daily_volume stale from
-- whatever it was computed as before the clobber.
--
-- trg_locator_readings_delta (fn_sync_locator_reading_chain, AFTER trigger)
-- would then notice previous_reading didn't match the real chronological
-- predecessor and issue a corrective UPDATE, which re-entered the same
-- BEFORE-trigger gauntlet and got clobbered by the guard again — and also
-- patched the next day's row's previous_reading, cascading corruption
-- forward every time an adjacent date got (re)swept.
--
-- Dropping this guard was the first step; the real fix (making the sweep
-- itself write direct-mode-consistent values, and fixing the OTHER two
-- triggers that were also fighting it) landed in phase9/10/11 below, after
-- this drop alone proved insufficient.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_zz_locator_direct_mode_prev_reading ON public.locator_readings;
DROP FUNCTION IF EXISTS public.fn_locator_direct_mode_prev_reading_guard();

-- <<<<<<< END ARCHIVED: 20260801000001_hamas_phase8_drop_conflicting_prev_reading_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000002_hamas_cleanup_drop_legacy_sweep_overload.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_cleanup_drop_legacy_sweep_overload
-- Applied 2026-08-01.
--
-- fn_sweep_derived_meters(p_lookback_days integer DEFAULT 90) was a legacy
-- overload built directly on production (never committed to git, discovered
-- via pg_get_functiondef during the HAMAS all-zero-history investigation).
-- It predates fn_sweep_derived_meters(p_date, p_lookback_days) — the version
-- actually called by LocatorSection.tsx's "Recalculate now" button and by
-- derived-meter-sweep.yml — and used a different, less careful strategy
-- (a naive SUM(daily_volume) sibling calc with no direct-input-mode
-- awareness). Nothing in the frontend, backend, or GitHub workflows calls
-- this specific single-arg signature — confirmed by grepping the full repo.
-- Dropping it removes a second, confusing implementation of "sweep HAMAS"
-- that could be invoked by accident (e.g. from the SQL editor) and produce
-- results inconsistent with the real dispatcher.
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_sweep_derived_meters(integer);

-- <<<<<<< END ARCHIVED: 20260801000002_hamas_cleanup_drop_legacy_sweep_overload.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000003_hamas_phase9_fix_integrity_trigger_direct_mode.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase9_fix_integrity_trigger_direct_mode
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_locator_reading_integrity (see 20260728044216_hamas_phase5_input_mode_
-- aware_guard.sql above) unconditionally overrode NEW.previous_reading from
-- the last non-pending_review predecessor BEFORE checking input mode, even
-- though it already has separate, correct spike-check logic for direct
-- mode further down. This silently clobbered previous_reading on every
-- write to a direct-mode/derived locator (e.g. HAMAS), fighting the sweep
-- function's own explicit writes and was the actual root cause the phase8
-- guard-drop (above) alone didn't fully address. Fix: only override
-- previous_reading for raw (cumulative-meter) locators; direct-mode
-- locators keep whatever previous_reading the caller set (0, per the sweep
-- function as of phase11 below).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
BEGIN
  SELECT default_input_mode INTO v_input_mode
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  -- Only raw (cumulative-meter) locators get previous_reading derived from
  -- the chronological predecessor. Direct-mode locators (current_reading IS
  -- the period volume) keep whatever the caller set.
  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- RAW MODE (unchanged) — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  -- Spike detection — flow rate > 2x 7-day average
  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260801000003_hamas_phase9_fix_integrity_trigger_direct_mode.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000004_hamas_phase10_chain_sync_skip_direct_mode.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase10_chain_sync_skip_direct_mode
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_sync_locator_reading_chain (trigger trg_locator_readings_delta, AFTER
-- INSERT/UPDATE/DELETE on locator_readings — never itself committed to any
-- migration, only discovered via pg_get_functiondef) maintains a
-- running-cumulative chain (previous_reading = chronological predecessor's
-- current_reading) for raw meters, and patches the successor row's
-- previous_reading whenever any row changes. That concept doesn't apply to
-- direct-mode/derived locators (current_reading IS the period volume,
-- previous_reading is always 0 by design) — applying it there was actively
-- harmful, patching in a real predecessor value and cascading corruption
-- through the chain any time an adjacent date got (re)swept. Make it a
-- no-op for direct-mode locators.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_locator_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locator_id        UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_input_mode        TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_locator_id := OLD.locator_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_locator_id := NEW.locator_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  SELECT default_input_mode INTO v_input_mode FROM public.locators WHERE id = v_locator_id;
  IF v_input_mode = 'direct' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT current_reading
      INTO v_predecessor_read
      FROM public.locator_readings
     WHERE locator_id    = v_locator_id
       AND reading_datetime < v_reading_dt
     ORDER BY reading_datetime DESC
     LIMIT 1;

    IF v_predecessor_read IS NOT NULL
       AND (NEW.previous_reading IS DISTINCT FROM v_predecessor_read) THEN
      UPDATE public.locator_readings
         SET previous_reading = v_predecessor_read
       WHERE id = NEW.id;
    END IF;
  END IF;

  SELECT id
    INTO v_successor_id
    FROM public.locator_readings
   WHERE locator_id      = v_locator_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.locator_readings
         SET previous_reading = OLD.previous_reading
       WHERE id = v_successor_id;
    ELSE
      UPDATE public.locator_readings
         SET previous_reading = NEW.current_reading
       WHERE id = v_successor_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260801000004_hamas_phase10_chain_sync_skip_direct_mode.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000005_hamas_phase11_sweep_writes_direct_volume_not_cumulative.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase11_sweep_writes_direct_volume_not_cumulative
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_sweep_derived_meters_for_date built current_reading as a running
-- cumulative total (prev_cumulative + residual) for both the locator row
-- and its mirror, since phase6 above. That model is inconsistent with
-- everywhere else this data is used: ReadingHistoryDialog.tsx renders a
-- direct-mode locator's current_reading raw, with no subtraction — it only
-- makes sense if current_reading IS the day's volume. fn_locator_reading_
-- integrity's own direct-mode spike-check (phase5/9) makes the same
-- assumption. This is also what let three separate, uncoordinated live
-- objects (the phase5 guard, the now-dropped zz-guard, and the chain-sync
-- trigger) each silently fight over what previous_reading should mean.
--
-- Simplify: current_reading = the day's residual, previous_reading = 0,
-- for both the locator row and its mirror — matching the "direct mode =
-- already a volume" semantic used consistently everywhere else, and
-- removing the predecessor-cumulative lookups entirely (no longer needed).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today           date        := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    IF p_date <> v_today AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'not today and no open review flag for this date — left untouched'
      );
      CONTINUE;
    END IF;

    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN lr.previous_reading IS NULL THEN 0
        WHEN sib.default_input_mode = 'direct' THEN GREATEST(0, lr.current_reading)
        ELSE GREATEST(0, lr.current_reading - lr.previous_reading)
      END
    ), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_residual, previous_reading = 0, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_residual, 0, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_residual,
            previous_reading = 0,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_residual, 0, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    UPDATE public.locator_derived_review_flags
    SET resolved_at = now()
    WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL;

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'mother_vol', v_mother_vol, 'others_vol', v_others_vol,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260801000005_hamas_phase11_sweep_writes_direct_volume_not_cumulative.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000006_notifications_delete_and_pending_review.sql >>>>>>>
-- =============================================================================
-- Migration: 20260801_notifications_delete_and_pending_review.sql
--
-- 1. notifications has SELECT/UPDATE/INSERT policies (20260419, 20260419_
--    notifications_rls) but no DELETE policy, so the "DB Notifications" list
--    in TopBar.tsx has never been able to offer a working X/close button
--    (unlike "Plant Alerts" above it, which is client-side/Zustand and
--    already supports dismiss). This adds the missing policy, scoped to the
--    user's own notifications only — same ownership rule already used by
--    notifications_own_select / notifications_own_update.
--
-- 2. ro_train_readings already has a norm_status column (added in
--    20260514_normalization.sql) and 'pending_review' has been an allowed
--    value since 20260718_pending_review_and_cascade_correction.sql — but
--    no RO save path has ever written to it (confirmed: no INSERT/UPDATE
--    anywhere in the app sets ro_train_readings.norm_status). This is the
--    "the permeate meter error should be flagged" gap: an operator mis-key
--    (e.g. Aug 1 06:43 permeate meter jumping from ~660,977 to 2,153,677 —
--    a 1,493,203 m3 delta / 409,096.71 m3/h flow rate) is written straight
--    through with no guard, no matter how far outside history it is.
--    This does NOT change fn_cascade_reading_correction (which explicitly
--    rejects ro_train_readings — it uses a 3-meter model, not the single
--    current_reading/previous_reading model that RPC assumes) or the
--    Data Corrections / Pending Review table lists (which are scoped to
--    locator/well/product_meter_readings only) — extending those to fully
--    support RO's 3-meter shape is a larger follow-up, not this fix.
--    The frontend (roReadingGuards.ts + PretreatmentAndROLog.tsx +
--    Dashboard.tsx) is responsible for setting/reading norm_status here;
--    this migration only confirms the constraint already allows it and is
--    a safe no-op if 20260514/20260718 already applied.
-- =============================================================================

-- ── 1. notifications: allow a user to delete their own notifications ────────
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
CREATE POLICY "notifications_own_delete" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── 2. ro_train_readings.norm_status — confirm column + constraint exist ────
-- Guarded the same way 20260514/20260718 guard it, so this migration is a
-- safe no-op on any DB that already ran those, and self-healing on one that
-- somehow didn't (e.g. ro_train_readings created after 20260514 by a restore).
DO $$ BEGIN
  ALTER TABLE public.ro_train_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT;
  ALTER TABLE public.ro_train_readings DROP CONSTRAINT IF EXISTS ro_train_readings_norm_status_check;
  ALTER TABLE public.ro_train_readings
    ADD CONSTRAINT ro_train_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_rtr_norm_status ON public.ro_train_readings(norm_status)
  WHERE norm_status = 'pending_review';

-- <<<<<<< END ARCHIVED: 20260801000006_notifications_delete_and_pending_review.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260802000001_migration_state.sql >>>>>>>
-- =====================================================================
-- Migration state (Admin → Migrations panel)
--
-- The FastAPI backend used to track "mark applied" overrides and apply
-- history in two local JSON files beside the server process
-- (backend/state/migration_overrides.json, migration_apply_history.json).
-- That was already fragile (lost on every backend redeploy) and now that
-- the app is Supabase-only, there's no server filesystem to keep it on
-- at all. This table replaces both files with one persistent, RLS-gated
-- row-per-migration-file store.
--
-- One row per filename; either or both of manual_override / apply_history
-- may be null. A file with no row at all has neither.
-- =====================================================================

create table if not exists public.migration_state (
  filename        text primary key,
  -- { marked_at, by_user_id, by_label, note } | null — "I ran this by hand".
  manual_override jsonb,
  -- { applied_at, by_label, note, source } | null — permanent first-known
  -- apply event, preserved even after manual_override is cleared.
  apply_history   jsonb,
  updated_at      timestamptz not null default now()
);

alter table public.migration_state enable row level security;

-- Admin-only, matching require_roles(caller, {"Admin"}) on every route this
-- table replaces (list/mark/unmark/import-history were all Admin-only,
-- stricter than the Manager-inclusive is_manager_or_admin used elsewhere).
drop policy if exists "migration_state_admin_all" on public.migration_state;
create policy "migration_state_admin_all" on public.migration_state
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop trigger if exists trg_migration_state_updated on public.migration_state;
create trigger trg_migration_state_updated
  before update on public.migration_state
  for each row execute function public.update_updated_at_column();

-- <<<<<<< END ARCHIVED: 20260802000001_migration_state.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260806000001_wells_meter_rollover_max_config.sql >>>>>>>
-- =============================================================================
-- Migration: 20260806143000_wells_meter_rollover_max_config.sql
-- Per-well meter rollover config (gap #2 from the meter-rollover diagnostic
-- alongside 20260720_recursive_cascade_and_meter_rollover.sql and
-- 20260806*_meter_rollover_backfill.sql).
--
-- Context: the "meter rollover" checkbox at reading-entry time
-- (frontend/src/pages/operations/wells/WellSection.tsx) defaults the wrap
-- point to a hardcoded '99999' that the operator has to overtype by hand
-- every time. Nothing records what a given well's meter actually wraps at,
-- so that default is frequently wrong (e.g. Well 9's 6-digit register wraps
-- at 999999.99, not 99999.99) and easy to enter incorrectly under pressure
-- during a live reading.
--
-- This column is a per-well source of truth for that wrap point:
--   - WellSection.tsx's entry-time default reads it instead of the literal.
--   - Admin → Edit Well exposes it so it can be set once and reused.
--   - Data Corrections' "Mark as rollover" action (Pending Review tab) can
--     eventually default to it too, though today it still uses a guessed
--     digit-count heuristic per row, same as the backfill script's Step 1 —
--     wiring the two together is a follow-up, not required for either to work.
--
-- NULL means "not configured yet" — callers keep falling back to the
-- guessed/hardcoded default, so this is purely additive and never required.
-- =============================================================================

ALTER TABLE wells
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

COMMENT ON COLUMN wells.meter_rollover_max IS
  'Physical meter register wrap point for this well (e.g. 999999.99 for a 6-digit odometer). NULL = not configured; callers fall back to a guessed or hardcoded default. Used to pre-fill the rollover checkbox at reading entry (WellSection.tsx) and, going forward, the Data Corrections "Mark as rollover" action.';

-- Per this project's convention (see 20260722_z_pgrst_schema_reload.sql):
-- new columns need this or PostgREST can reject requests referencing them
-- with a misleading "relation does not exist" error until its next
-- periodic cache reload.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260806000001_wells_meter_rollover_max_config.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260806000002_meter_rollover_backfill.sql >>>>>>>
-- =============================================================================
-- 20260806153000_meter_rollover_backfill.sql
-- Backfill: mark missed meter rollovers + recompute their daily_volume
-- =============================================================================
-- Context: 20260720_recursive_cascade_and_meter_rollover.sql added
-- is_meter_rollover / meter_rollover_max and rollover-aware daily_volume, but
-- only for readings entered (or corrected) AFTER that migration ran, and only
-- on the path where the operator actually checked "meter rollover" at entry.
-- Rows saved before then — or saved after but without the box checked, then
-- waved through Pending Review — still have is_meter_rollover = false and
-- daily_volume clamped to 0 for that day, silently under-counting
-- production. (The History dialog's negative-Δ display bug and Pending
-- Review's missing "Mark as rollover" action are separate, already-patched
-- frontend issues — this script only touches stored data, and only for rows
-- that predate those fixes or otherwise slipped through before they were
-- classified as genuine rollovers.)
--
-- This is a two-step, human-reviewed process, NOT a blind auto-backfill:
-- a backward reading can also be a genuine data-entry error, and those must
-- NOT be marked as rollovers. Same reasoning as
-- 20260428_cleanup_bad_imports.sql's explicit target_names allow-list.
--
--   STEP 1 (below): read-only. Lists every backward-jump candidate across
--   well_readings / locator_readings / product_meter_readings with a guessed
--   meter_rollover_max (10^digits(previous_reading) - 0.01) and the daily_volume
--   that guess implies. Review each row against the actual meter's register
--   size before trusting the guess.
--
--   STEP 2 (bottom): guarded UPDATE. Copy the id(s) you've confirmed as real
--   rollovers from Step 1 into target_ids per table, double-check
--   confirmed_max against the physical meter, then run. Rows not listed are
--   left untouched. Idempotent — re-running after a row is fixed is a no-op
--   for that id.
--
-- Run this in: Supabase Dashboard → SQL Editor, as an Admin.
-- =============================================================================

-- ── STEP 1: Candidate audit (read-only — run this first, review the output) ──

SELECT
  'well_readings' AS source_table, wr.id, w.name AS entity_name,
  wr.reading_datetime, wr.previous_reading, wr.current_reading,
  wr.current_reading - wr.previous_reading AS naive_delta,
  wr.daily_volume AS stored_daily_volume,
  power(10, length(floor(wr.previous_reading)::text)) - 0.01 AS guessed_meter_max,
  GREATEST(0, round(
    (power(10, length(floor(wr.previous_reading)::text)) - 0.01) - wr.previous_reading + wr.current_reading
  )) AS guessed_daily_volume_if_rollover,
  wr.norm_status
FROM well_readings wr
JOIN wells w ON w.id = wr.well_id
WHERE wr.previous_reading IS NOT NULL
  AND wr.current_reading < wr.previous_reading
  AND wr.is_meter_rollover = false

UNION ALL

SELECT
  'locator_readings', lr.id, l.name,
  lr.reading_datetime, lr.previous_reading, lr.current_reading,
  lr.current_reading - lr.previous_reading,
  lr.daily_volume,
  power(10, length(floor(lr.previous_reading)::text)) - 0.01,
  GREATEST(0, round(
    (power(10, length(floor(lr.previous_reading)::text)) - 0.01) - lr.previous_reading + lr.current_reading
  )),
  lr.norm_status
FROM locator_readings lr
JOIN locators l ON l.id = lr.locator_id
WHERE lr.previous_reading IS NOT NULL
  AND lr.current_reading < lr.previous_reading
  AND lr.is_meter_rollover = false

UNION ALL

SELECT
  'product_meter_readings', pmr.id, pm.name,
  pmr.reading_datetime, pmr.previous_reading, pmr.current_reading,
  pmr.current_reading - pmr.previous_reading,
  pmr.daily_volume,
  power(10, length(floor(pmr.previous_reading)::text)) - 0.01,
  GREATEST(0, round(
    (power(10, length(floor(pmr.previous_reading)::text)) - 0.01) - pmr.previous_reading + pmr.current_reading
  )),
  pmr.norm_status
FROM product_meter_readings pmr
JOIN product_meters pm ON pm.id = pmr.meter_id
WHERE pmr.previous_reading IS NOT NULL
  AND pmr.current_reading < pmr.previous_reading
  AND pmr.is_meter_rollover = false

ORDER BY 1, 4 DESC;

-- Sanity check while reviewing Step 1's output:
--  - A real rollover's current_reading should look like an early reading for
--    that entity (small, near its historical minimum) and previous_reading
--    should sit close under guessed_meter_max.
--  - A data-entry error more often looks like a plausible mid-range value
--    with a digit dropped/transposed — guessed_daily_volume_if_rollover will
--    usually look implausibly large or small for that entity's normal flow.
--    Do NOT include those ids in Step 2.

-- ── STEP 2: Guarded backfill — only runs for ids you've confirmed ──────────
-- Fill in target_ids + confirmed_max per table (empty array = skip that
-- table entirely). confirmed_max should come from the physical meter's
-- actual register size, NOT copy-pasted blindly from Step 1's guess.

DO $$
DECLARE
  -- Example based on the Well 9 case (May 5, 2026): 6-digit register
  -- wrapping at 999999.99. Replace with the real id(s) + confirmed max.
  well_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];  -- e.g. ARRAY['00000000-0000-0000-0000-000000000000']
  well_confirmed_max CONSTANT NUMERIC := 999999.99;

  locator_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];
  locator_confirmed_max CONSTANT NUMERIC := 999999.99;

  product_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];
  product_confirmed_max CONSTANT NUMERIC := 999999.99;

  cnt BIGINT;
BEGIN
  IF array_length(well_target_ids, 1) IS NOT NULL THEN
    UPDATE well_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = well_confirmed_max,
           daily_volume       = GREATEST(0, round(well_confirmed_max - previous_reading + current_reading))
     WHERE id = ANY(well_target_ids)
       AND is_meter_rollover = false;   -- idempotent guard
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'well_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'well_readings: no target_ids set — skipped';
  END IF;

  IF array_length(locator_target_ids, 1) IS NOT NULL THEN
    UPDATE locator_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = locator_confirmed_max
           -- daily_volume is GENERATED ALWAYS AS on this table — Postgres
           -- recomputes it automatically from the two columns above.
     WHERE id = ANY(locator_target_ids)
       AND is_meter_rollover = false;
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'locator_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'locator_readings: no target_ids set — skipped';
  END IF;

  IF array_length(product_target_ids, 1) IS NOT NULL THEN
    UPDATE product_meter_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = product_confirmed_max,
           daily_volume       = GREATEST(0, round(product_confirmed_max - previous_reading + current_reading))
     WHERE id = ANY(product_target_ids)
       AND is_meter_rollover = false;
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'product_meter_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'product_meter_readings: no target_ids set — skipped';
  END IF;
END
$$;

-- Note: none of the three affected rows' downstream neighbors need repair
-- here — current_reading on the corrected row isn't changing, only
-- is_meter_rollover / meter_rollover_max / daily_volume on that single row,
-- so the next reading's previous_reading (already equal to this row's
-- current_reading) is untouched. fn_cascade_reading_correction is only
-- needed when current_reading itself is being changed.

-- <<<<<<< END ARCHIVED: 20260806000002_meter_rollover_backfill.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260806000003_reading_audit_log_add_power_blending_well.sql >>>>>>>
-- Extend reading_edit_audit_log to cover power_readings, blending_events, and
-- well_readings.
--
-- PowerSection.tsx previously had no edit-window gating or audit logging at
-- all (see Design Audit / Critical Issue #3 — the edit path existed but was
-- ungated and unaudited, and delete didn't exist). Investigating that surfaced
-- a bigger issue: the actual edit/delete UI for readings isn't in
-- PowerSection.tsx at all (its local editingId/startEdit are dead code, never
-- called) -- it's the shared ReadingHistoryDialog.tsx, used by all four
-- reading modules (locator, well, power, blending), which had
-- `const canEditDelete = true` hardcoded with no role/ownership/time-window
-- check and no audit logging whatsoever. The frontend fix wires all four
-- modules up to the same canEditEntry/logReadingEdit primitive already used
-- by ro_train_readings/ro_pretreatment_readings/chemical_dosing_logs/
-- locator_readings -- this migration is the DB-side half of that, following
-- the exact same DROP/ADD pattern 20260727_hamas_phase0_roles_and_audit.sql
-- used when locator_readings was added. well_readings is added alongside the
-- other two for the same reason -- it went through this exact dialog too and
-- had no audit coverage despite locator_readings (its closest sibling) having
-- had it since Phase 0.
--
-- blending_events has no recorded_by column (never had per-operator
-- ownership tracking), so canEditEntry naturally degrades to admin/manager/
-- data-analyst-only there -- no schema change needed for the permission
-- check itself, just adding it here so admin-performed blending edits and
-- deletes actually get logged like everywhere else.

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260806000003_reading_audit_log_add_power_blending_well.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000001_hamas_phase12_scoped_sweep_protects_overrides_not_dates.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase12_scoped_sweep_protects_overrides_not_dates
-- Applied 2026-08-07, found while re-investigating SRP↔Mambaling HAMAS still
-- reading 0 for every day after 2026-08-01 despite the phase9-11 fixes.
--
-- ROOT CAUSE:
--   Phase 7's freshness gate is:
--     IF p_date <> v_today AND NOT EXISTS (open review flag for this date)
--       THEN CONTINUE (skip, leave untouched)
--   i.e. it only ever writes a value for TODAY, or for a past date that has
--   an explicit open review flag. Every other past date is permanently
--   frozen at whatever it last held (0, if it was never swept).
--
--   But .github/workflows/derived-meter-sweep.yml — the routine 3x/day
--   cron — is deliberately written to target YESTERDAY (p_date defaults to
--   "yesterday PHT"; see its own header comment: "a sibling correction made
--   during the day shows up in Hamas within 8h"). Yesterday is, by
--   definition, never v_today. So every scheduled run's whole 3-day
--   lookback window (yesterday-2 .. yesterday) hits the gate and gets
--   skipped, every single time — and fn_sweep_derived_meters() still
--   returns {"ok": true}, so the workflow shows green in GitHub Actions
--   while silently doing nothing. This is why HAMAS goes 0 the moment
--   nobody manually intervenes.
--
--   The only path that ever produced a real value was the "Recalculate now"
--   button (LocatorSection.tsx), which passes p_date = today explicitly —
--   but per this same file's phase 2026-07-26 comment, a day's residual is
--   only accurate once that day has *closed* (mother meter + all siblings
--   read for the full day). Recalculating "today" mid-day computes off an
--   incomplete day and, per the note above, that date can then never be
--   corrected later by the routine sweep once the day *does* close —
--   because by then it's no longer "today" and gets skipped.
--
-- FIX:
--   The gate's real intent (see phase7/phase3's own comments) was "don't
--   let a routine re-sweep silently clobber a value a human set on
--   purpose." That's exactly what is_estimated already encodes: sweep
--   writes always set is_estimated = true; every override path
--   (DerivedMeterOverrideDialog's saveOverride, the CSV bulk-override
--   insertDerivedOverrideRows) always sets is_estimated = false. So: skip
--   a (locator, date) pair only if it already holds a human-set
--   (is_estimated = false) value AND nothing has flagged it for review
--   since. Drop the "date must equal today" condition entirely — a date
--   that's never been swept, or one the sweep itself last wrote, is always
--   fair game for the routine catch-up pass, whether that's today or any
--   day in the lookback window. This also means an override made *today*
--   is now protected the same way a past-date override already was
--   (previously it wasn't, since the old gate always fell through for
--   p_date = today regardless of override status).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_has_override    boolean;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    -- Protect a human-set value (is_estimated = false), not a calendar date.
    -- A date the sweep has never touched, or one it last wrote itself
    -- (is_estimated = true), is always eligible for (re)computation.
    SELECT EXISTS (
      SELECT 1 FROM public.locator_readings
       WHERE locator_id = r_loc.id
         AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
         AND is_estimated = false
    ) INTO v_has_override;

    IF v_has_override AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'manually overridden and no open review flag for this date — left untouched'
      );
      CONTINUE;
    END IF;

    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN lr.previous_reading IS NULL THEN 0
        WHEN sib.default_input_mode = 'direct' THEN GREATEST(0, lr.current_reading)
        ELSE GREATEST(0, lr.current_reading - lr.previous_reading)
      END
    ), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_residual, previous_reading = 0, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_residual, 0, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_residual,
            previous_reading = 0,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_residual, 0, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    UPDATE public.locator_derived_review_flags
    SET resolved_at = now()
    WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL;

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'mother_vol', v_mother_vol, 'others_vol', v_others_vol,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260807000001_hamas_phase12_scoped_sweep_protects_overrides_not_dates.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000002_manager_plant_scorecard.sql >>>>>>>
-- =============================================================================
-- Migration: 20260807_manager_plant_scorecard.sql
--
-- Manager data-quality oversight scorecard.
--
-- Adds one RPC, fn_manager_plant_scorecard(from, to), that rolls up gap
-- coverage, flagged/corrected readings, and open exceptions per plant, and
-- attributes each plant to whichever Manager(s) have it in
-- user_profiles.plant_assignments.
--
-- Deliberately stays at the PLANT/MANAGER grain, not per-operator.
-- DataCompletenessRadarCard.tsx already made this call for the existing
-- completeness radar: recorded_by/completed_by are nullable (imports, shared
-- logins) and there's no shift-roster table, so pinning a *missing* entry on
-- one person would misattribute blame that isn't necessarily theirs. This
-- function measures the same thing this app already asks of a Manager
-- elsewhere -- review flagged readings, log gap reasons, resolve correction
-- requests -- rolled up so it's visible whether that's actually happening
-- for each plant, without trying to fingerprint who caused a given gap.
--
-- Two different kinds of column come back, and they answer different
-- questions:
--   * "_in_window" columns (completeness, flagged/error rate, unexplained
--     gaps) are scoped to [p_from, p_to] -- "how did this period go."
--   * "open_*" columns (pending reviews, open correction requests, and
--     their oldest-open-days) are CURRENT STATE as of right now, not as of
--     p_to. norm_status and correction_requests.status are live columns
--     with nothing behind them recording when they changed, so there's no
--     way to reconstruct "what was open as of a past date" -- only what's
--     open today. If you want a true backlog trend over time, call this on
--     a schedule (the existing vercel.json cron pattern) and INSERT the
--     result into a snapshot table, the same way compliance_snapshots
--     already does for Compliance -- happy to add that as a follow-up
--     migration once the shape of this one is confirmed.
--
-- Authorization happens INSIDE the function, not via a table RLS policy.
-- This has to be SECURITY DEFINER to read across reading_normalizations /
-- correction_requests / other plants' rows the caller's own RLS would
-- otherwise hide, which means it must police plant visibility itself or it
-- becomes a privilege-escalation hole. Admin and Data Analyst see every
-- plant; Manager sees only plants in their own plant_assignments; every
-- other role is rejected outright. This mirrors the access model already
-- used by DataCorrections.tsx / reading_normalizations (Admin, Data
-- Analyst, Manager) rather than the narrower Admin/Manager-only model on
-- reading_edit_audit_log, since this is closer in spirit to the
-- corrections workflow than to the edit log.
--
-- correction_requests is read from here but still isn't defined in any
-- migration in this repo (see the note in
-- 20260723_manager_data_corrections_access.sql) -- it was created directly
-- in the Supabase dashboard. This function reads only the columns
-- DataCorrections.tsx already relies on (plant_id, status, created_at). If
-- its real shape has drifted from that, this migration will fail loudly at
-- CREATE-time rather than silently -- worth codifying that table in its own
-- migration while this area is already being touched.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 0. Supporting indexes ────────────────────────────────────────────────────
-- This function (and DataAnalysis/DataCorrections) query norm_status to find
-- exception rows. Only ro_train_readings has an index on it today
-- (20260801_notifications_delete_and_pending_review.sql). 'normal' is the
-- overwhelming majority value on all four tables, so a partial index on the
-- exception rows is both small and exactly what these WHERE clauses need.

CREATE INDEX IF NOT EXISTS idx_well_readings_norm_status
  ON public.well_readings (plant_id, norm_status) WHERE norm_status <> 'normal';
CREATE INDEX IF NOT EXISTS idx_locator_readings_norm_status
  ON public.locator_readings (plant_id, norm_status) WHERE norm_status <> 'normal';
CREATE INDEX IF NOT EXISTS idx_pmr_norm_status
  ON public.product_meter_readings (plant_id, norm_status) WHERE norm_status <> 'normal';

-- ── 1. fn_manager_plant_scorecard ────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_manager_plant_scorecard(date, date);

CREATE OR REPLACE FUNCTION public.fn_manager_plant_scorecard(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  plant_id                         uuid,
  plant_name                       text,
  manager_ids                      uuid[],
  manager_names                    text[],
  wells_completeness_pct           numeric,
  locators_completeness_pct        numeric,
  trains_completeness_pct          numeric,
  meters_completeness_pct          numeric,
  power_completeness_pct           numeric,
  chemicals_completeness_pct       numeric,
  overall_completeness_pct         numeric,
  readings_in_window               integer,
  flagged_in_window                integer,
  error_rate_pct                   numeric,
  unexplained_gaps_in_window       integer,
  open_pending_review_count        integer,
  open_pending_review_oldest_days  integer,
  open_correction_count            integer,
  open_correction_oldest_days      integer,
  status                           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
-- RETURNS TABLE turns plant_id/status into PL/pgSQL variables visible
-- through the whole function body -- without this, every bare `plant_id`
-- or `status` column reference below (wells.plant_id, wells.status,
-- correction_requests.status, ...) is ambiguous against those OUT
-- parameters and the function fails at call time, not at CREATE time.
-- This pragma tells PL/pgSQL to resolve that ambiguity in favor of the
-- SQL column, which is what every reference in this function actually
-- means. (Confirmed by running this migration against a reconstructed
-- copy of this schema -- see the note at the bottom of this file.)
DECLARE
  v_caller      uuid := auth.uid();
  v_full_access boolean;
  v_days        integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  -- Guards against an accidentally (or maliciously) huge range blowing up
  -- the generate_series x entity cross join below -- see "Performance"
  -- note further down.
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'Date range too large (max 366 days)';
  END IF;

  v_full_access := public.has_role(v_caller, 'Admin') OR public.has_role(v_caller, 'Data Analyst');

  IF NOT (v_full_access OR public.has_role(v_caller, 'Manager')) THEN
    RAISE EXCEPTION 'Not authorized to view the manager scorecard';
  END IF;

  v_days := (p_to - p_from) + 1;

  RETURN QUERY
  WITH visible_plants AS (
    -- Admin/Data Analyst: every plant. Manager: only plants they're
    -- actually assigned to -- this is the row-level check that would
    -- otherwise live in an RLS policy on a plain table.
    SELECT p.id, p.name
    FROM public.plants p
    WHERE v_full_access
       OR EXISTS (
            SELECT 1 FROM public.user_profiles up
            WHERE up.id = v_caller AND p.id = ANY(up.plant_assignments)
          )
  ),
  plant_managers AS (
    SELECT vp.id AS plant_id,
           array_agg(DISTINCT up.id)
             FILTER (WHERE up.id IS NOT NULL) AS manager_ids,
           array_agg(DISTINCT COALESCE(NULLIF(BTRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''), up.username))
             FILTER (WHERE up.id IS NOT NULL) AS manager_names
    FROM visible_plants vp
    LEFT JOIN public.user_profiles up
      ON vp.id = ANY(up.plant_assignments)
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = up.id AND ur.role = 'Manager')
    GROUP BY vp.id
  ),

  -- Active-entity pools -- same "Active" filter DataCompletenessRadarCard.tsx
  -- already uses for wells/locators/meters; ro_trains has no status filter
  -- there either (every train counts, Offline included), so this matches it
  -- exactly rather than inventing a stricter definition.
  well_pool    AS (SELECT id AS entity_id, plant_id FROM public.wells    WHERE status = 'Active'),
  locator_pool AS (SELECT id AS entity_id, plant_id FROM public.locators WHERE status = 'Active'),
  train_pool   AS (SELECT id AS entity_id, plant_id FROM public.ro_trains),
  meter_pool   AS (SELECT id AS entity_id, plant_id FROM public.product_meters WHERE status = 'Active'),

  well_pool_n    AS (SELECT plant_id, COUNT(*) AS n FROM well_pool    GROUP BY plant_id),
  locator_pool_n AS (SELECT plant_id, COUNT(*) AS n FROM locator_pool GROUP BY plant_id),
  train_pool_n   AS (SELECT plant_id, COUNT(*) AS n FROM train_pool   GROUP BY plant_id),
  meter_pool_n   AS (SELECT plant_id, COUNT(*) AS n FROM meter_pool   GROUP BY plant_id),

  -- Distinct (entity, day) pairs actually logged in the window.
  well_logged AS (
    SELECT DISTINCT well_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.well_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  locator_logged AS (
    SELECT DISTINCT locator_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.locator_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  train_logged AS (
    SELECT DISTINCT train_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.ro_train_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  meter_logged AS (
    SELECT DISTINCT meter_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.product_meter_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  well_logged_n    AS (SELECT plant_id, COUNT(*) AS n FROM well_logged    GROUP BY plant_id),
  locator_logged_n AS (SELECT plant_id, COUNT(*) AS n FROM locator_logged GROUP BY plant_id),
  train_logged_n   AS (SELECT plant_id, COUNT(*) AS n FROM train_logged   GROUP BY plant_id),
  meter_logged_n   AS (SELECT plant_id, COUNT(*) AS n FROM meter_logged   GROUP BY plant_id),

  -- Power and chemical dosing are logged at the plant level (one entry/day
  -- expected), not per-entity -- same distinction DataCompletenessRadarCard
  -- draws.
  power_logged_n AS (
    SELECT plant_id, COUNT(DISTINCT reading_datetime::date) AS n
    FROM public.power_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
    GROUP BY plant_id
  ),
  chem_logged_n AS (
    SELECT plant_id, COUNT(DISTINCT log_datetime::date) AS n
    FROM public.chemical_dosing_logs
    WHERE log_datetime::date BETWEEN p_from AND p_to
    GROUP BY plant_id
  ),

  completeness AS (
    SELECT
      vp.id AS plant_id,
      -- NULL means "this plant has none of this entity type" (not
      -- applicable), distinct from 0 ("has them, nothing logged").
      -- Deliberately NOT written as LEAST(100, ratio-that-may-be-NULL):
      -- Postgres's LEAST/GREATEST skip NULL arguments rather than
      -- propagating them, so LEAST(100, NULL) evaluates to 100, not NULL
      -- -- that would have silently turned "no locators at this plant"
      -- into a false "100% complete." Confirmed by testing against a
      -- reconstructed copy of this schema; see the note at the bottom of
      -- this file.
      CASE WHEN COALESCE(wp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(wl.n, 0) / (wp.n * v_days), 1)) END AS wells_pct,
      CASE WHEN COALESCE(lp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(ll.n, 0) / (lp.n * v_days), 1)) END AS locators_pct,
      CASE WHEN COALESCE(tp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(tl.n, 0) / (tp.n * v_days), 1)) END AS trains_pct,
      CASE WHEN COALESCE(mp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(ml.n, 0) / (mp.n * v_days), 1)) END AS meters_pct,
      -- Power/chemical dosing are plant-level, not tied to an entity pool
      -- that could be zero, and v_days is already guaranteed >= 1 by the
      -- p_from/p_to validation above -- so these two never hit the same
      -- NULL-vs-0 ambiguity and don't need the CASE wrapper.
      LEAST(100, ROUND(100.0 * COALESCE(pl.n, 0) / v_days, 1)) AS power_pct,
      LEAST(100, ROUND(100.0 * COALESCE(cl.n, 0) / v_days, 1)) AS chemicals_pct
    FROM visible_plants vp
    LEFT JOIN well_pool_n    wp ON wp.plant_id = vp.id
    LEFT JOIN well_logged_n  wl ON wl.plant_id = vp.id
    LEFT JOIN locator_pool_n lp ON lp.plant_id = vp.id
    LEFT JOIN locator_logged_n ll ON ll.plant_id = vp.id
    LEFT JOIN train_pool_n   tp ON tp.plant_id = vp.id
    LEFT JOIN train_logged_n tl ON tl.plant_id = vp.id
    LEFT JOIN meter_pool_n   mp ON mp.plant_id = vp.id
    LEFT JOIN meter_logged_n ml ON ml.plant_id = vp.id
    LEFT JOIN power_logged_n pl ON pl.plant_id = vp.id
    LEFT JOIN chem_logged_n  cl ON cl.plant_id = vp.id
  ),

  -- Gap-day universe, wells/locators/RO trains only -- reading_gap_reasons'
  -- own CHECK constraint doesn't cover product meters, so this function
  -- doesn't claim to either.
  days AS (SELECT generate_series(p_from, p_to, interval '1 day')::date AS day),
  well_expected    AS (SELECT wp.entity_id, wp.plant_id, d.day FROM well_pool wp    CROSS JOIN days d),
  locator_expected AS (SELECT lp.entity_id, lp.plant_id, d.day FROM locator_pool lp CROSS JOIN days d),
  train_expected   AS (SELECT tp.entity_id, tp.plant_id, d.day FROM train_pool tp   CROSS JOIN days d),

  well_missing AS (
    SELECT we.* FROM well_expected we
    WHERE NOT EXISTS (SELECT 1 FROM well_logged wl WHERE wl.entity_id = we.entity_id AND wl.day = we.day)
  ),
  locator_missing AS (
    SELECT le.* FROM locator_expected le
    WHERE NOT EXISTS (SELECT 1 FROM locator_logged ll WHERE ll.entity_id = le.entity_id AND ll.day = le.day)
  ),
  train_missing AS (
    SELECT te.* FROM train_expected te
    WHERE NOT EXISTS (SELECT 1 FROM train_logged tl WHERE tl.entity_id = te.entity_id AND tl.day = te.day)
  ),

  -- "Unexplained" = missing a reading AND missing a reading_gap_reasons row
  -- for that same entity/day. This is the core "is anyone monitoring gaps"
  -- signal -- a gap with a reason logged means someone looked at it.
  gap_unexplained AS (
    SELECT wm.plant_id FROM well_missing wm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reading_gap_reasons g
      WHERE g.entity_type = 'well' AND g.entity_id = wm.entity_id AND g.gap_date = wm.day
    )
    UNION ALL
    SELECT lm.plant_id FROM locator_missing lm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reading_gap_reasons g
      WHERE g.entity_type = 'locator' AND g.entity_id = lm.entity_id AND g.gap_date = lm.day
    )
    UNION ALL
    SELECT tm.plant_id FROM train_missing tm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reading_gap_reasons g
      WHERE g.entity_type = 'ro_train' AND g.entity_id = tm.entity_id AND g.gap_date = tm.day
    )
  ),
  gap_agg AS (
    SELECT plant_id, COUNT(*)::int AS unexplained_gap_count
    FROM gap_unexplained
    GROUP BY plant_id
  ),

  -- Error rate: any reading touched by the normalization workflow
  -- (norm_status <> 'normal') within the window, over total readings taken
  -- in the window.
  readings_window AS (
    SELECT plant_id, norm_status FROM public.well_readings         WHERE reading_datetime::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT plant_id, norm_status FROM public.locator_readings      WHERE reading_datetime::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT plant_id, norm_status FROM public.ro_train_readings     WHERE reading_datetime::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT plant_id, norm_status FROM public.product_meter_readings WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  readings_agg AS (
    SELECT plant_id,
           COUNT(*)::int AS readings_n,
           COUNT(*) FILTER (WHERE norm_status <> 'normal')::int AS flagged_n
    FROM readings_window
    GROUP BY plant_id
  ),

  -- CURRENT open backlog (not window-scoped -- see header note). day here
  -- is reading_datetime, used as an approximate stand-in for "flagged
  -- since" -- there's no separate flagged_at timestamp on these tables, so
  -- this slightly overstates age for anything flagged well after ingestion
  -- (e.g. a later HAMAS sweep). Good enough for a first cut; a real
  -- flagged_at column would make this exact.
  open_reviews AS (
    SELECT plant_id, reading_datetime::date AS day FROM public.well_readings          WHERE norm_status = 'pending_review'
    UNION ALL
    SELECT plant_id, reading_datetime::date          FROM public.locator_readings      WHERE norm_status = 'pending_review'
    UNION ALL
    SELECT plant_id, reading_datetime::date          FROM public.ro_train_readings     WHERE norm_status = 'pending_review'
    UNION ALL
    SELECT plant_id, reading_datetime::date          FROM public.product_meter_readings WHERE norm_status = 'pending_review'
  ),
  open_reviews_agg AS (
    SELECT plant_id, COUNT(*)::int AS n, (CURRENT_DATE - MIN(day)) AS oldest_days
    FROM open_reviews
    GROUP BY plant_id
  ),

  -- Operator-submitted correction requests still awaiting Manager/Admin
  -- action. created_at here is a real "when was this raised" timestamp
  -- (unlike open_reviews' approximation above), so oldest_days is exact.
  open_corrections_agg AS (
    SELECT plant_id, COUNT(*)::int AS n, (CURRENT_DATE - MIN(created_at::date)) AS oldest_days
    FROM public.correction_requests
    WHERE status = 'pending'
    GROUP BY plant_id
  ),

  base AS (
    SELECT
      vp.id                                          AS plant_id,
      vp.name                                        AS plant_name,
      COALESCE(pm.manager_ids, '{}'::uuid[])          AS manager_ids,
      COALESCE(pm.manager_names, '{}'::text[])        AS manager_names,
      c.wells_pct, c.locators_pct, c.trains_pct, c.meters_pct, c.power_pct, c.chemicals_pct,
      ROUND(
        (COALESCE(c.wells_pct, 0) + COALESCE(c.locators_pct, 0) + COALESCE(c.trains_pct, 0)
         + COALESCE(c.meters_pct, 0) + COALESCE(c.power_pct, 0) + COALESCE(c.chemicals_pct, 0))
        / NULLIF(
            (CASE WHEN c.wells_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.locators_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.trains_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.meters_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.power_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.chemicals_pct IS NOT NULL THEN 1 ELSE 0 END),
            0)
      , 1)                                            AS overall_completeness_pct,
      COALESCE(ra.readings_n, 0)                      AS readings_in_window,
      COALESCE(ra.flagged_n, 0)                       AS flagged_in_window,
      ROUND(100.0 * COALESCE(ra.flagged_n, 0) / NULLIF(ra.readings_n, 0), 1) AS error_rate_pct,
      COALESCE(ga.unexplained_gap_count, 0)           AS unexplained_gaps_in_window,
      COALESCE(ora.n, 0)                              AS open_pending_review_count,
      COALESCE(ora.oldest_days, 0)                    AS open_pending_review_oldest_days,
      COALESCE(oca.n, 0)                               AS open_correction_count,
      COALESCE(oca.oldest_days, 0)                     AS open_correction_oldest_days
    FROM visible_plants vp
    LEFT JOIN plant_managers      pm  ON pm.plant_id = vp.id
    LEFT JOIN completeness        c   ON c.plant_id = vp.id
    LEFT JOIN gap_agg             ga  ON ga.plant_id = vp.id
    LEFT JOIN readings_agg        ra  ON ra.plant_id = vp.id
    LEFT JOIN open_reviews_agg    ora ON ora.plant_id = vp.id
    LEFT JOIN open_corrections_agg oca ON oca.plant_id = vp.id
  )
  SELECT
    b.plant_id,
    b.plant_name,
    b.manager_ids,
    b.manager_names,
    b.wells_pct,
    b.locators_pct,
    b.trains_pct,
    b.meters_pct,
    b.power_pct,
    b.chemicals_pct,
    b.overall_completeness_pct,
    b.readings_in_window,
    b.flagged_in_window,
    b.error_rate_pct,
    b.unexplained_gaps_in_window,
    b.open_pending_review_count,
    b.open_pending_review_oldest_days,
    b.open_correction_count,
    b.open_correction_oldest_days,
    -- Tunable thresholds -- 5 days / 80% picked as reasonable v1 defaults,
    -- not derived from anything in this repo. Easiest place to adjust once
    -- there's real data to calibrate against.
    CASE
      WHEN array_length(b.manager_ids, 1) IS NULL THEN 'unmonitored'
      WHEN b.open_pending_review_oldest_days > 5
        OR b.open_correction_oldest_days > 5
        OR COALESCE(b.overall_completeness_pct, 0) < 80
        THEN 'at_risk'
      WHEN b.unexplained_gaps_in_window > 0
        OR b.open_pending_review_count > 0
        OR b.open_correction_count > 0
        THEN 'watch'
      ELSE 'good'
    END AS status
  FROM base b
  ORDER BY b.plant_name;
END;
$$;

-- No PUBLIC execute -- authenticated only, then the function's own role
-- check narrows it further to Admin / Data Analyst / Manager. Existing
-- functions in this repo (fn_cascade_reading_correction) rely solely on the
-- internal check without an explicit REVOKE; adding it here too as
-- defense-in-depth costs nothing.
REVOKE ALL ON FUNCTION public.fn_manager_plant_scorecard(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_manager_plant_scorecard(date, date) TO authenticated;

COMMENT ON FUNCTION public.fn_manager_plant_scorecard(date, date) IS
  'Per-plant data-quality oversight rollup (completeness, unexplained gaps, '
  'flagged/error rate, open corrections) attributed to each plant''s '
  'assigned Manager(s). Admin/Data Analyst see all plants; Manager sees '
  'only their own plant_assignments. Call via '
  'supabase.rpc(''fn_manager_plant_scorecard'', { p_from, p_to }).';

-- ── Known limitations (v1) ───────────────────────────────────────────────────
-- 1. Every pool/logged CTE above scans all plants before visible_plants
--    filters the final output -- fine at this org's current plant count,
--    but if that grows a lot, push `WHERE plant_id IN (SELECT id FROM
--    visible_plants)` into each CTE instead of filtering at the join.
-- 2. open_pending_review_oldest_days uses reading_datetime as a stand-in
--    for "flagged since" (see comment above open_reviews). Add a real
--    flagged_at timestamp to the reading tables' pending_review path for
--    an exact figure.
-- 3. open_correction_count / open_correction_oldest_days depend on
--    correction_requests' current shape (plant_id, status, created_at),
--    unverified against a migration -- see the header note.
-- 4. No history: open_* columns are "as of now" every time this is called.
--    Snapshotting (compliance_snapshots' pattern) is the natural next step
--    if you want a trend line rather than a live-only view.

-- <<<<<<< END ARCHIVED: 20260807000002_manager_plant_scorecard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000003_power_meter_change_required_fields.sql >>>>>>>
-- =============================================================================
-- Migration: 20260807_power_meter_change_required_fields.sql
--
-- Brings power meter replacement in line with the well / locator / product /
-- RO-train pattern from 20260727_meter_replacement_wiring.sql. Until now,
-- power_meter_changes only recorded the CT multiplier change (old_multiplier /
-- new_multiplier) — there was nowhere to record what the OLD physical meter
-- last read and what the NEW physical meter started at.
--
-- Adds:
--   old_meter_final_reading    — cumulative kWh the old meter last read
--   new_meter_initial_reading  — cumulative kWh the new meter read at install
--                                 (this becomes meter_reading_kwh on the
--                                 swap-point power_readings row instead of
--                                 blindly carrying the old value forward)
--   reading_id                 — links back to the specific power_readings row
--                                 the swap produced (new-swap flow) or the
--                                 existing row a post-hoc edit flags (matches
--                                 well_meter_replacements.reading_id /
--                                 locator_meter_replacements.reading_id /
--                                 product_meter_replacements.reading_id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.power_meter_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  meter_index INTEGER NOT NULL DEFAULT 0,
  old_multiplier NUMERIC NOT NULL DEFAULT 1,
  new_multiplier NUMERIC NOT NULL DEFAULT 1,
  change_date DATE NOT NULL DEFAULT CURRENT_DATE,
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.power_meter_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "power_meter_changes_plant_access" ON public.power_meter_changes;
CREATE POLICY "power_meter_changes_plant_access" ON public.power_meter_changes
  FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

ALTER TABLE public.power_meter_changes
  ADD COLUMN IF NOT EXISTS old_meter_final_reading   NUMERIC,
  ADD COLUMN IF NOT EXISTS new_meter_initial_reading NUMERIC,
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.power_readings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_power_meter_changes_reading_id
  ON public.power_meter_changes(reading_id);

COMMENT ON COLUMN public.power_meter_changes.old_meter_final_reading IS
  'Cumulative kWh the OLD physical meter last read before it was swapped out. Required in the UI.';
COMMENT ON COLUMN public.power_meter_changes.new_meter_initial_reading IS
  'Cumulative kWh the NEW physical meter read at install. Required in the UI; becomes meter_reading_kwh on the swap-point power_readings row.';
COMMENT ON COLUMN public.power_meter_changes.reading_id IS
  'The power_readings row this change produced (live swap) or was retroactively flagged against (history edit).';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000003_power_meter_change_required_fields.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000004_reading_anomaly_remarks.sql >>>>>>>
-- =============================================================================
-- Migration: 20260807_reading_anomaly_remarks.sql
-- Run this in: Supabase Dashboard -> SQL Editor
--
-- Part of the flow-rate-based anomaly detection unification (see
-- frontend/src/lib/flowRateGuards.ts for the shared classification logic
-- this table supports).
--
-- Every odometer input (locator/well/product/blending, power, RO train
-- feed/permeate/reject) is now classified against its own rolling-average
-- FLOW RATE (volume or kWh per hour/day), not the raw delta -- a raw delta
-- has a direct relationship with the elapsed time between readings, so it
-- was never a fair "is this normal" comparison whenever a date had no
-- reading. See roReadingGuards.ts / readingGuards.ts for the classification
-- callers.
--
-- Two tiers, both computed from the same rolling average:
--   - "needs_remark": outside the +-50% band around the average rate.
--     Save is blocked client-side until the operator types a remark
--     explaining the reading (own field knowledge -- pump down, meter
--     replaced, unusually high demand, etc.). This is new; nothing in the
--     app previously required an explanation for an out-of-band reading.
--   - "critical": beyond the stricter per-meter-type spike multiplier that
--     already existed (ALERTS.avg_multiplier_warn / power_spike_multiplier /
--     ro_meter_spike_multiplier -- deliberately NOT unified to one number,
--     since different meter types have different natural variance; only the
--     methodology, message format, and remark requirement are unified).
--     Same remark requirement, PLUS the existing pending_review /
--     supervisor-alert behaviour still fires exactly as before.
--
-- This table captures the "needs_remark" / "critical" remark itself, mirroring
-- the table_name + record_id pattern already used by reading_edit_audit_log
-- (NOT the entity_type + entity_id + gap_date pattern used by
-- reading_gap_reasons, which is about missing readings, not the anomaly on a
-- reading that *was* taken).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reading_anomaly_remarks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which saved reading this remark explains. table_name mirrors the
  -- constraint list already used by reading_edit_audit_log, extended with
  -- product_meter_readings (the one reading table that audit log doesn't
  -- cover yet).
  table_name      TEXT        NOT NULL CHECK (table_name IN (
                                'locator_readings',
                                'well_readings',
                                'product_meter_readings',
                                'blending_events',
                                'power_readings',
                                'ro_train_readings'
                              )),
  record_id       UUID        NOT NULL,

  -- ro_train_readings carries three independent meters (feed/permeate/
  -- reject) per row, any subset of which can individually be out-of-band --
  -- NULL for every other table_name, where one row = one meter.
  meter_kind      TEXT        CHECK (meter_kind IN ('feed', 'permeate', 'reject')),

  plant_id        UUID        NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,

  tier            TEXT        NOT NULL CHECK (tier IN ('needs_remark', 'critical')),
  direction       TEXT        NOT NULL CHECK (direction IN ('high', 'low')),
  deviation_pct   NUMERIC     NOT NULL,

  -- Snapshot of the numbers the operator actually saw, so a later audit
  -- doesn't have to reconstruct "what was the average at the time" from a
  -- rolling window that has since moved on.
  flow_rate       NUMERIC,
  avg_flow_rate   NUMERIC,
  rate_unit       TEXT        NOT NULL DEFAULT 'm3/hr' CHECK (rate_unit IN ('m3/hr', 'm3/day', 'kwh/hr')),

  remark_text     TEXT        NOT NULL CHECK (char_length(btrim(remark_text)) > 0),

  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reading_anomaly_remarks_record
  ON public.reading_anomaly_remarks (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_reading_anomaly_remarks_plant
  ON public.reading_anomaly_remarks (plant_id, logged_at DESC);

ALTER TABLE public.reading_anomaly_remarks ENABLE ROW LEVEL SECURITY;

-- Any authenticated user with access to the plant may read -- these are
-- meant to surface on the Dashboard / reading history alongside the reading
-- itself, not just to managers.
DROP POLICY IF EXISTS "reading_anomaly_remarks_read" ON public.reading_anomaly_remarks;
CREATE POLICY "reading_anomaly_remarks_read" ON public.reading_anomaly_remarks
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

-- Operators write their own remarks at save time -- not manager-gated,
-- since it's the field operator who has the explanation, exactly like
-- reading_gap_reasons.
DROP POLICY IF EXISTS "reading_anomaly_remarks_insert" ON public.reading_anomaly_remarks;
CREATE POLICY "reading_anomaly_remarks_insert" ON public.reading_anomaly_remarks
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- Immutable audit-style record: no UPDATE/DELETE policy -> denied by default.

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000004_reading_anomaly_remarks.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000005_ro_trains_booster_pump_targets.sql >>>>>>>
-- Booster pump targets have the same "retyped every reading" problem
-- hpp_target_pressure_psi had (20260807_ro_trains_hpp_target_pressure_
-- setpoint.sql) -- confirmed while building that fix and flagged as a
-- separate follow-up rather than folded in, since a train can have multiple
-- booster pumps and each pump's target is entered in one of two mutually
-- exclusive modes (psi or Hz, toggled per train, not per pump -- the reading
-- form's "Target psi/Hz" toggle already applies to every pump on the train
-- at once via setGlobalMode, so the config shape below matches that: one
-- mode for the whole train, one target value per pump).
--
-- Amperage is NOT part of this -- that's a genuine per-reading measurement
-- (the pump's actual current draw, which varies with load/wear), not a
-- setpoint. Only target/Hz move to config; amp stays exactly as it was,
-- entered fresh on every reading.
--
-- JSONB rather than fixed columns because num_booster_pumps varies per
-- train (0 to N) -- a fixed set of booster_pump_1_target/2_target/... columns
-- would need a schema change every time a train configuration needs more
-- pumps than any train has needed so far. Shape:
--   { "psi_mode": true, "targets": { "1": 45, "2": 50 } }
-- targets is keyed by pump unit number as a string (JSONB object keys are
-- always strings); a unit with no entry (or the whole column null) falls
-- back to the reading form's current fully-editable behavior for that pump,
-- same graceful-degradation approach as the HPP fix -- no train breaks for
-- not having this configured.

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS booster_pump_targets JSONB;

COMMENT ON COLUMN public.ro_trains.booster_pump_targets IS
  'Per-pump target setpoints for this train''s booster pumps, configured once in Train Settings. Shape: {"psi_mode": bool, "targets": {"<unit>": number}}. Auto-fills and locks the corresponding psi/Hz field on every pre-treatment/RO reading; amperage stays per-reading (a real measurement, not a setpoint). A unit missing from targets, or a null column, falls back to the fully-editable per-reading input.';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000005_ro_trains_booster_pump_targets.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000006_ro_trains_hpp_target_pressure_setpoint.sql >>>>>>>
-- Roadmap §5: HPP target pressure was only ever a per-reading field
-- (ro_pretreatment_readings.hpp_target_pressure_psi), meaning an operator
-- retyped the exact same number on every single log entry -- the target
-- pressure a High-Pressure Pump is set to is a slow-changing equipment
-- setpoint, not something that varies reading to reading. A typo on any one
-- entry looked like a real target change in historical data when it was
-- just repeated manual entry.
--
-- Adds it to ro_trains as a per-train config value, configured once in
-- Train Settings (EditTrainDialog in TrainDetail.tsx) alongside num_hp_pumps
-- and the other train-level fields already there. Nullable, no default --
-- existing trains simply have it unset until a Manager/Admin fills it in;
-- the reading-entry form (PretreatmentAndROLog.tsx) falls back to its old
-- fully-editable-input behavior for any train where this is still null, so
-- nothing breaks for trains that haven't been configured yet.
--
-- ro_pretreatment_readings.hpp_target_pressure_psi is kept as-is, not
-- dropped -- once a train has this configured, the reading form auto-fills
-- and submits the train's value on every reading, so the readings table
-- still carries a per-reading historical record of what the target was at
-- that time (useful if the target itself is later changed), it's just no
-- longer manually retyped.

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS hpp_target_pressure_psi NUMERIC;

COMMENT ON COLUMN public.ro_trains.hpp_target_pressure_psi IS
  'High-Pressure Pump target operating pressure (psi), configured once per train in Train Settings. Auto-fills the HPP Target Pressure field on every pre-treatment/RO reading for this train until changed here.';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000006_ro_trains_hpp_target_pressure_setpoint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260808000001_hamas_phase13_repair_mirror_resync_corruption.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase13_repair_mirror_resync_corruption
-- Applied 2026-08-08.
--
-- ROOT CAUSE (frontend — not covered by phases 0-12, which were all
-- backend/SQL):
--   ProductSection.tsx's ProductMeterHistoryDialog has a client-side
--   resyncMeterChain() helper that walks every product_meter_readings row
--   for a meter in chronological order and recomputes:
--     previous_reading = the PRIOR row's raw current_reading
--     daily_volume      = GREATEST(0, current_reading - previous_reading)
--   That's the right model for a normal, monotonically-increasing cumulative
--   meter, but is_derived (mirrored) meters — e.g. Mambaling's "HAMAS",
--   mirrored from SRP's derived "HAMAS (Mambaling)" locator — don't work
--   that way: fn_sweep_derived_meters_for_date() (phase11/phase12) writes
--   each day's own volume directly into current_reading and pins
--   previous_reading at 0, so consecutive rows are independent, not
--   cumulative. resyncMeterChain never checked meter.is_derived, so any
--   edit, delete, or "mark as meter replacement" toggle on this dialog
--   re-walked the whole history as if it were cumulative and clobbered
--   daily_volume back down to ~0 for nearly every day — while SRP's own
--   derived locator kept computing correctly the whole time, because
--   locator_readings.daily_volume is a GENERATED column resyncMeterChain
--   never touches. This is why HAMAS (SRP) and HAMAS (Mambaling) diverged:
--   the sweep's mirror write was always correct, this resync silently
--   overwrote it afterwards. The matching frontend fix guards
--   resyncMeterChain (and saveEdit) against is_derived meters so this can't
--   recur.
--
-- FIX (this migration):
--   One-time data repair, not a new code path. For every is_derived locator,
--   re-derive its mirror product_meter_readings rows directly from the
--   (never-corrupted) locator_readings rows, matched by calendar day in
--   Asia/Manila. This is a straight copy, not a recompute — it's guaranteed
--   to leave every mirror row exactly equal to its source locator for every
--   day that's ever been swept, which is the whole point of the mirror
--   (HAMAS (SRP) = HAMAS (Mambaling)).
--
-- Idempotent: only writes a row when its stored values actually differ from
-- the source locator's; re-running after a successful repair is a no-op and
-- reports 0 rows changed.
-- =============================================================================

DO $$
DECLARE
  r_loc          RECORD;
  r_lr           RECORD;
  v_mirror       RECORD;
  v_day_start    timestamptz;
  v_day_end      timestamptz;
  -- Scalar (not RECORD) OUT targets for the existence-check SELECT below —
  -- a bare RECORD variable that's never yet been assigned a row raises
  -- "record ... is not assigned yet" the first time a zero-row SELECT INTO
  -- hits it, which a plain first lookup easily could. Scalars just come back
  -- NULL, no gotcha, matching how phase12's fn_sweep_derived_meters_for_date
  -- already does this same existence check (v_lr_id / v_old_daily_vol).
  v_mirror_id        uuid;
  v_mirror_cur       numeric;
  v_mirror_prev      numeric;
  v_mirror_vol       numeric;
  v_mirror_estimated boolean;
  v_checked      integer := 0;
  v_changed      integer := 0;
  v_inserted     integer := 0;
BEGIN
  FOR r_loc IN
    SELECT id, name FROM public.locators WHERE is_derived = true
  LOOP
    FOR r_lr IN
      SELECT reading_datetime, daily_volume, is_estimated
      FROM public.locator_readings
      WHERE locator_id = r_loc.id
      ORDER BY reading_datetime
    LOOP
      -- Calendar-day bounds in Asia/Manila, same convention
      -- fn_sweep_derived_meters_for_date() uses for v_day_start/v_day_end.
      v_day_start := date_trunc('day', r_lr.reading_datetime AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila';
      v_day_end   := v_day_start + interval '1 day';

      FOR v_mirror IN
        SELECT id, plant_id FROM public.product_meters
        WHERE derived_from_locator_id = r_loc.id AND is_derived = true
      LOOP
        v_checked := v_checked + 1;

        SELECT id, current_reading, previous_reading, daily_volume, is_estimated
          INTO v_mirror_id, v_mirror_cur, v_mirror_prev, v_mirror_vol, v_mirror_estimated
        FROM public.product_meter_readings
        WHERE meter_id = v_mirror.id
          AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
        ORDER BY reading_datetime DESC LIMIT 1;

        IF v_mirror_id IS NOT NULL THEN
          IF v_mirror_cur  IS DISTINCT FROM r_lr.daily_volume
          OR v_mirror_prev IS DISTINCT FROM 0
          OR v_mirror_vol  IS DISTINCT FROM r_lr.daily_volume THEN
            UPDATE public.product_meter_readings
            SET current_reading  = r_lr.daily_volume,
                previous_reading = 0,
                daily_volume     = r_lr.daily_volume,
                is_estimated     = r_lr.is_estimated
            WHERE id = v_mirror_id;
            v_changed := v_changed + 1;
          END IF;
        ELSE
          -- Source locator has a reading for this day but the mirror never
          -- got one at all (e.g. the derived_from_locator_id link was added
          -- after that day's sweep, or the row was deleted outright).
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id, r_lr.reading_datetime, r_lr.daily_volume, 0, r_lr.daily_volume, r_lr.is_estimated);
          v_inserted := v_inserted + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'hamas_phase13: checked % mirror-day pairs, repaired % existing rows, inserted % missing rows',
    v_checked, v_changed, v_inserted;
END $$;

-- <<<<<<< END ARCHIVED: 20260808000001_hamas_phase13_repair_mirror_resync_corruption.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260808000002_custom_roles.sql >>>>>>>
-- =============================================================================
-- Migration: 20260808_custom_roles.sql
-- Custom role editor: lets an Admin create a NAMED role (e.g. "Plant
-- supervisor") that starts as a copy of one of the five system roles
-- (Operator/Technician/Manager/Data Analyst/Admin) and overrides individual
-- module permissions from there.
--
-- Design choice: a custom role does NOT get its own value in the app_role
-- enum, and does NOT change how any of the ~34 existing RLS policies work.
-- Every user assigned a custom role still carries a normal user_roles row
-- keyed to that role's base_role, so every Postgres-level security check in
-- this schema (is_admin(), is_manager_or_admin(), has_role(), etc.) keeps
-- working unchanged. custom_role_id is purely an additional pointer the
-- frontend uses to compute which modules to show/hide and which buttons to
-- enable — see frontend/src/lib/permissions.ts (effectivePermission()) and
-- frontend/src/pages/admin/RolesPanel.tsx.
--
-- Adds:
--   1. custom_roles              — id, name, base_role, description
--   2. custom_role_overrides     — sparse (module_key, action, allowed) rows;
--                                   only rows that differ from the base
--                                   role's PERMISSION_MATRIX default exist
--   3. user_roles.custom_role_id — nullable pointer, set alongside the
--                                   existing `role` column when an admin
--                                   assigns someone a custom role
--   4. A guard trigger blocking overrides on admin_users / admin_migrations
--      — mirrors "Admin console access can only be granted to the Admin
--      role, to prevent accidental lockout" so a direct API/SQL write can't
--      bypass what the UI already greys out.
-- =============================================================================

-- ── 1. custom_roles ──────────────────────────────────────────────────────────
CREATE TABLE public.custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  base_role   public.app_role NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES public.user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_custom_roles_updated BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.custom_roles IS
  'Named permission presets an Admin builds on top of a system role '
  '(base_role). Does not participate in RLS directly — see migration header.';

-- ── 2. custom_role_overrides ─────────────────────────────────────────────────
-- Sparse by design: a row only exists where the custom role's effective
-- permission differs from PERMISSION_MATRIX[base_role][module_key][action].
-- Keeping it sparse is what makes "3 overrides from base" a simple COUNT(*).
CREATE TABLE public.custom_role_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('view','edit','budget','delete')),
  allowed        BOOLEAN NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (custom_role_id, module_key, action)
);
CREATE INDEX idx_custom_role_overrides_role ON public.custom_role_overrides(custom_role_id);

-- ── 3. Guard: admin_users / admin_migrations can never be overridden ────────
-- Matches PERMISSION_MATRIX's admin_users/admin_migrations entries (Admin
-- only) and REDIRECTS in frontend/src/lib/permissions.ts. Defense-in-depth:
-- the RolesPanel UI already disables these rows, this makes it a hard rule.
CREATE OR REPLACE FUNCTION public.fn_guard_custom_role_override()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.module_key IN ('admin_users', 'admin_migrations') THEN
    RAISE EXCEPTION
      'admin_users and admin_migrations cannot be overridden by a custom role (Admin-only, to prevent accidental lockout)';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_custom_role_override
  BEFORE INSERT OR UPDATE ON public.custom_role_overrides
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_custom_role_override();

-- ── 4. user_roles gets a pointer to the custom role (if any) ────────────────
ALTER TABLE public.user_roles
  ADD COLUMN custom_role_id UUID REFERENCES public.custom_roles(id) ON DELETE SET NULL;

CREATE INDEX idx_user_roles_custom_role ON public.user_roles(custom_role_id) WHERE custom_role_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_role_overrides ENABLE ROW LEVEL SECURITY;

-- Every signed-in user can read role definitions — needed to compute their
-- own effective permissions client-side. Same trust model as
-- PERMISSION_MATRIX already being shipped in the JS bundle today.
CREATE POLICY custom_roles_select ON public.custom_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY custom_role_overrides_select ON public.custom_role_overrides
  FOR SELECT TO authenticated USING (true);

-- Only Admin may create, rename, re-base, or delete custom roles, and only
-- Admin may add/change/remove overrides.
CREATE POLICY custom_roles_admin_write ON public.custom_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY custom_role_overrides_admin_write ON public.custom_role_overrides
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ── Known limitations (v1) ───────────────────────────────────────────────────
-- 1. A user can only hold one custom_role_id at a time (it lives on the same
--    user_roles row as their base role, and RoleSelector-style UIs replace
--    that row wholesale). Fine today since the app already treats "primary
--    role" as singular everywhere (see primaryRole() in UsersPanel.tsx).
-- 2. Per-plant scoping and the Data-Analyst-only REDIRECTS behavior are
--    still governed entirely by frontend/src/lib/permissions.ts, same as
--    before this migration — this only adds the override layer on top.
-- 3. No history/audit trail on override changes yet. If that's needed,
--    reading_edit_audit_log's pattern (table_name/record_id/old/new jsonb)
--    is the natural fit — add 'custom_role_overrides' to its CHECK
--    constraint the same way 20260727_hamas_phase0_roles_and_audit.sql did
--    for locator_readings.

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260808000002_custom_roles.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000001_hamas_phase15_derived_locators_skip_generic_spike.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase15_derived_locators_skip_generic_spike
--
-- Context: derived, direct-mode locators (locators.is_derived = true, e.g.
-- HAMAS) get their daily value written by fn_sweep_derived_meters_for_date(),
-- not by an operator. fn_locator_reading_integrity's direct-mode branch
-- (phase9) applies the same ">2x trailing 7-day average" spike check to this
-- swept output as it does to operator-entered direct-mode readings, which
-- routes normal sweep results into the same Pending Review queue operators
-- use — with no way to tell, from that queue, that the row was never
-- human-entered in the first place.
--
-- Derived locators already have a purpose-built review path:
-- locator_derived_review_flags / fn_flag_derived_review() (phase3), which
-- opens a flag specifically when a sibling locator or the mother meter was
-- edited in a way that could change this locator's residual — surfaced via
-- fn_notify_derived_review(). That mechanism is scoped to the actual risk
-- (an upstream edit), rather than to the resulting number's size, so it
-- doesn't fire on a legitimate large-but-correct swing (e.g. after a long
-- gap in siblings is backfilled) the way the generic spike check does.
--
-- Change: skip the generic >2x spike flag when NEW's locator is derived.
-- Sweep output for derived locators is now always written norm_status =
-- 'normal' by this trigger; any review need is carried entirely by
-- locator_derived_review_flags/fn_flag_derived_review(), not by landing in
-- Pending Review.
--
-- Trade-off, on purpose left as-is rather than "fixed" further: this does
-- remove the safety net that has, in practice, been catching bugs in the
-- sweep pipeline itself (phases 6/8/9/10/11/12/13/14 were all fixes to that
-- pipeline, several same-day). If sweep bugs are still active, consider
-- holding off on this migration, or additionally hardening
-- fn_flag_derived_review()/the sweep function's own internal checks before
-- removing this net. Revert by re-running phase9's CREATE OR REPLACE if
-- needed — this migration only adds the is_derived branch on top of it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
  v_is_derived      BOOLEAN;
BEGIN
  SELECT default_input_mode, is_derived
  INTO   v_input_mode, v_is_derived
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');
  v_is_derived := COALESCE(v_is_derived, FALSE);

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  -- Only raw (cumulative-meter) locators get previous_reading derived from
  -- the chronological predecessor. Direct-mode locators (current_reading IS
  -- the period volume) keep whatever the caller set.
  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    -- Derived locators (HAMAS-style): review need is already carried by
    -- locator_derived_review_flags / fn_flag_derived_review(), keyed to the
    -- actual upstream edit rather than the resulting number's size. Skip
    -- the generic spike check so a legitimate large swing doesn't land in
    -- the operator-facing Pending Review queue with no indication it was
    -- machine-generated.
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- RAW MODE (unchanged) — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  -- Spike detection — flow rate > 2x 7-day average
  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260809000001_hamas_phase15_derived_locators_skip_generic_spike.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000002_hamas_phase14_repair_override_mirror_sync.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase14_repair_override_mirror_sync
-- Applied 2026-08-09.
--
-- ROOT CAUSE (phase14):
--   saveOverride() and insertDerivedOverrideRows() in LocatorSection.tsx only
--   ever wrote to locator_readings. When an operator overrode the derived
--   locator value (e.g. SRP's "HAMAS (Mambaling)" locator → set to 5,294),
--   the corresponding mirror product_meter_readings row (Mambaling's "HAMAS"
--   product meter) was never touched. The sweep's phase12 CONTINUE guard then
--   protects the locator row (is_estimated = false) from re-computation —
--   which is correct — but that same CONTINUE also skips the mirror update
--   for the same iteration, leaving the mirror permanently at whatever the
--   sweep last computed (e.g. 306) rather than the override value (5,294).
--   The locator and mirror stayed diverged indefinitely.
--
--   phase13 (20260808100000) addressed only the historical data at the time it
--   ran. Any override applied after phase13 ran re-introduced the divergence.
--   The matching frontend fix (saveOverride / insertDerivedOverrideRows now
--   call syncDerivedLocatorMirrors) stops future divergence. This migration
--   repairs the current divergence for all dates in locator_readings, whether
--   the value was written by the sweep (is_estimated = true) or by a human
--   override (is_estimated = false).
--
-- WHAT THIS DOES:
--   For every active derived locator:
--     For every date's locator_reading row (sweep or override):
--       Find the mirror product_meter_readings row for the same Asia/Manila
--       calendar day and update it to current_reading = daily_volume =
--       locator_reading.daily_volume. If no mirror row exists for that date,
--       insert one.
--
-- IDEMPOTENT: re-running after a full repair is a no-op (0 rows changed/inserted).
-- =============================================================================

DO $$
DECLARE
  r_loc            RECORD;
  r_lr             RECORD;
  v_mirror         RECORD;
  v_day_start      timestamptz;
  v_day_end        timestamptz;
  v_mirror_id      uuid;
  v_mirror_cur     numeric;
  v_mirror_prev    numeric;
  v_mirror_vol     numeric;
  v_checked        integer := 0;
  v_changed        integer := 0;
  v_inserted       integer := 0;
BEGIN
  FOR r_loc IN
    SELECT id, name
    FROM public.locators
    WHERE is_derived = true
      AND status = 'Active'
  LOOP
    FOR r_lr IN
      SELECT reading_datetime, daily_volume, is_estimated
      FROM public.locator_readings
      WHERE locator_id = r_loc.id
      ORDER BY reading_datetime
    LOOP
      -- Same day-window convention as fn_sweep_derived_meters_for_date:
      -- Asia/Manila calendar day boundaries.
      v_day_start := date_trunc('day', r_lr.reading_datetime AT TIME ZONE 'Asia/Manila')
                       AT TIME ZONE 'Asia/Manila';
      v_day_end   := v_day_start + interval '1 day';

      FOR v_mirror IN
        SELECT id, plant_id
        FROM public.product_meters
        WHERE derived_from_locator_id = r_loc.id
          AND is_derived = true
      LOOP
        v_checked := v_checked + 1;

        SELECT id, current_reading, previous_reading, daily_volume
          INTO v_mirror_id, v_mirror_cur, v_mirror_prev, v_mirror_vol
        FROM public.product_meter_readings
        WHERE meter_id = v_mirror.id
          AND reading_datetime >= v_day_start
          AND reading_datetime <  v_day_end
        ORDER BY reading_datetime DESC
        LIMIT 1;

        IF v_mirror_id IS NOT NULL THEN
          -- Only write if stale to keep the log noise down.
          IF v_mirror_cur  IS DISTINCT FROM r_lr.daily_volume
          OR v_mirror_prev IS DISTINCT FROM 0
          OR v_mirror_vol  IS DISTINCT FROM r_lr.daily_volume THEN
            UPDATE public.product_meter_readings
               SET current_reading  = r_lr.daily_volume,
                   previous_reading = 0,
                   daily_volume     = r_lr.daily_volume,
                   is_estimated     = true
             WHERE id = v_mirror_id;
            v_changed := v_changed + 1;
          END IF;
        ELSE
          -- Locator has a reading for this day but the mirror never got one
          -- (sweep never ran for that date at the mirror, or the row was deleted).
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime,
             current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id,
             v_day_end - interval '1 second',   -- 23:59:59 Manila, matching sweep convention
             r_lr.daily_volume, 0, r_lr.daily_volume, true);
          v_inserted := v_inserted + 1;
        END IF;

        -- Reset scalars so a zero-row SELECT on the next iteration doesn't
        -- re-use the previous iteration's values.
        v_mirror_id   := NULL;
        v_mirror_cur  := NULL;
        v_mirror_prev := NULL;
        v_mirror_vol  := NULL;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE
    'hamas_phase14: checked % mirror-day pairs, repaired % existing rows, inserted % missing rows',
    v_checked, v_changed, v_inserted;
END $$;

-- <<<<<<< END ARCHIVED: 20260809000002_hamas_phase14_repair_override_mirror_sync.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000003_hamas_phase15_product_meter_integrity_guard_and_mirror_trigger.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase15_product_meter_integrity_guard_and_mirror_trigger
-- Applied live 2026-08-09 (direct Supabase MCP access, project sosfbfxovtleuvahxvpm).
--
-- ROOT CAUSE (phase15 — a third, independent cause from phase13/14):
--   trg_product_meter_reading_integrity (BEFORE INSERT OR UPDATE ON
--   product_meter_readings, function fn_product_meter_reading_integrity) has
--   always unconditionally recomputed previous_reading/daily_volume by
--   looking up "the most recent non-retracted/non-pending_review row before
--   this one" and taking a delta — the correct model for a real cumulative
--   meter, but wrong for a mirrored is_derived meter like Mambaling's
--   "HAMAS", where current_reading already IS the period volume (phase11's
--   convention: previous_reading pinned at 0). This function never checked
--   product_meters.is_derived, so it silently overwrote whatever a correct
--   writer (fn_sweep_derived_meters_for_date's mirror loop, or the frontend's
--   syncDerivedLocatorMirrors()) had just set, replacing it with a bogus
--   delta against an unrelated old reading.
--
--   This is the same class of bug phase5/6/7/9/10 already fixed on the
--   *locator_readings* side (fn_locator_reading_integrity /
--   fn_sync_locator_reading_chain) — it was simply never mirrored onto the
--   analogous product_meter_readings-side trigger, so the exact same failure
--   mode was reintroduced one table over.
--
--   Symptom observed live: Mambaling's HAMAS history showed 0 m³ for most of
--   the last 30 days and small-but-wrong values (949, 306) for the two most
--   recent days, while SRP's HAMAS was fully correct throughout — because the
--   locator side (fixed in the earlier live session, 2026-08-01) was never
--   touched by this bug, only the mirror side was.
--
--   Consequence for phase13/14: both of those migrations are pure data
--   repairs — their UPDATE/INSERT statements go through this same trigger.
--   Even if run, this trigger would have re-corrupted the very rows they
--   just repaired in the same statement. phase15 is the reason phase13/14
--   can actually hold.
--
-- FIX PART 1 — fn_product_meter_reading_integrity gets an is_derived guard,
--   mirroring the pattern already used in fn_locator_reading_integrity: for
--   a derived (mirrored) product meter, previous_reading/daily_volume/
--   norm_status are left exactly as the caller set them. A mirror row is
--   never independently "recorded," so it doesn't need — and must not get —
--   its own delta/spike computation; correctness lives entirely upstream in
--   the source locator, which already has its own integrity checks.
--
-- FIX PART 2 — new trigger trg_sync_derived_locator_mirror on
--   locator_readings (AFTER INSERT OR UPDATE OR DELETE), scoped to
--   is_derived locators. Whatever locator_readings ends up with for a given
--   Asia/Manila calendar day — sweep-computed or manually overridden via
--   DerivedMeterOverrideDialog / the CSV bulk-override path — is copied
--   verbatim to every linked product_meters mirror (derived_from_locator_id)
--   for that same day; a delete on the source removes the mirror row too.
--   This makes "HAMAS (SRP) = HAMAS (Mambaling), always" a database-level
--   invariant instead of something each call site has to remember to do.
--
--   This is a deliberate belt-and-suspenders alongside the frontend's own
--   syncDerivedLocatorMirrors() (LocatorSection.tsx, merged same day in
--   correction-fixes-v2.patch): that call only fires from saveOverride() /
--   insertDerivedOverrideRows(), so it can't catch a delete (the History
--   dialog's row-level "X" delete has never called it) or any future write
--   path that forgets to call it. mirror is_estimated is hardcoded true
--   either way — a mirror row is never itself "directly recorded," matching
--   the convention already used by both fn_sweep_derived_meters_for_date and
--   syncDerivedLocatorMirrors.
--
-- DATA REPAIR: performed live for all ~222 days of HAMAS history plus
--   today, using locator_readings as ground truth (re-verified against the
--   screenshots: SRP and Mambaling now match exactly, day for day). Not
--   repeated as a DO block here — phase13/14 already carry that exact
--   repair and are idempotent, so running them after this migration is a
--   safe no-op / confirmation pass, not a second repair.
--
--   One pre-existing, untouched oddity found and *not* repaired here:
--   product_meter_readings has one row for meter b5546271-4302-46c4-aaf4-
--   c495ef96d448 (Mambaling HAMAS) dated 2026-07-01 (current_reading
--   2,721,182.44 — a stale cumulative-style value, daily_volume 4,654) with
--   no corresponding locator_readings row on the SRP side at all. Flagged
--   for Kevz rather than deleted, since it predates the mirror-link backfill
--   and its correct disposition (delete vs. backfill a real SRP value for
--   that date) isn't determinable from data alone.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_is_derived    BOOLEAN;
BEGIN
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
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
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

        IF v_avg_flow_rate IS NOT NULL AND v_flow_rate > v_avg_flow_rate * 2.0 AND NEW.norm_status = 'normal' THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_derived_locator_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locator_id  uuid := COALESCE(NEW.locator_id, OLD.locator_id);
  v_is_derived  boolean;
  v_day         date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_reading_dt  timestamptz;
  v_mirror      RECORD;
  v_mirror_id   uuid;
BEGIN
  SELECT is_derived INTO v_is_derived FROM public.locators WHERE id = v_locator_id;
  IF NOT COALESCE(v_is_derived, FALSE) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_day        := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;
  v_day_start  := (v_day::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end    := ((v_day + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt := v_day_end - interval '1 second';

  FOR v_mirror IN
    SELECT id, plant_id FROM public.product_meters
    WHERE derived_from_locator_id = v_locator_id AND is_derived = true
  LOOP
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;
      CONTINUE;
    END IF;

    SELECT id INTO v_mirror_id
    FROM public.product_meter_readings
    WHERE meter_id = v_mirror.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_mirror_id IS NOT NULL THEN
      UPDATE public.product_meter_readings
      SET current_reading  = NEW.current_reading,
          previous_reading = 0,
          daily_volume     = NEW.current_reading,
          is_estimated     = true
      WHERE id = v_mirror_id;
    ELSE
      INSERT INTO public.product_meter_readings
        (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
      VALUES
        (v_mirror.id, v_mirror.plant_id, v_reading_dt, NEW.current_reading, 0, NEW.current_reading, true);
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_derived_locator_mirror ON public.locator_readings;
CREATE TRIGGER trg_sync_derived_locator_mirror
AFTER INSERT OR UPDATE OR DELETE ON public.locator_readings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_derived_locator_mirror();

-- <<<<<<< END ARCHIVED: 20260809000003_hamas_phase15_product_meter_integrity_guard_and_mirror_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000004_locator_readings_latest_view.sql >>>>>>>
-- Adds a "latest row per locator" view, same pattern as
-- ro_train_readings_latest (20260725000000_ro_train_readings_latest_view.sql):
-- DISTINCT ON does the reduction in Postgres instead of the client running
-- N per-locator queries (see LocatorSection.tsx's `op-loc-latest` query,
-- which currently issues one request per locator to get this exact row).
--
-- This backs the new "Last reading" badge on:
--   • Plant detail → Locators list (pages/plants/locators/LocatorsList.tsx)
--   • Operations → Locator tab (pages/operations/locators/LocatorSection.tsx),
--     which can migrate its op-loc-latest query onto this view too.
--
-- No new index needed — idx_lr_locator_dt (locator_id, reading_datetime desc)
-- already exists from the initial schema and is exactly what DISTINCT ON
-- needs to skip-scan by locator_id.

create or replace view public.locator_readings_latest
with (security_invoker = true) as
select distinct on (locator_id) *
from public.locator_readings
order by locator_id, reading_datetime desc;

-- PostgREST needs an explicit grant on the view object itself, separate from
-- RLS on the base table. security_invoker (Postgres 15+) keeps the base
-- table's RLS policies applying per-caller instead of running as the view
-- owner and silently bypassing plant-level access control.
grant select on public.locator_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000004_locator_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000005_well_readings_latest_view.sql >>>>>>>
-- Adds a "latest row per well" view, same pattern as ro_train_readings_latest
-- (20260725000000_ro_train_readings_latest_view.sql) and locator_readings_latest
-- (20260809140000_locator_readings_latest_view.sql).
--
-- Unlike locator_readings, well_readings has no (well_id, reading_datetime)
-- index yet — only idx_wr_plant_dt (plant_id, reading_datetime desc). Without
-- a well_id-led index, DISTINCT ON (well_id) would still need a sort over the
-- whole table, so this migration adds both, matching the RO train migration's
-- shape rather than the locator one's.
--
-- This also fixes a real gap, not just adds a badge: WellSection.tsx's
-- existing latestByWell is reduced client-side from a 30-day rolling window
-- (see the `op-well-recent` query), so a well that hasn't been read in over
-- 30 days currently reads as "no reading" instead of "very stale" — the
-- wrong message. Pointing that query at this view instead removes the
-- window entirely.

create index if not exists idx_well_readings_well_dt
  on public.well_readings (well_id, reading_datetime desc);

create or replace view public.well_readings_latest
with (security_invoker = true) as
select distinct on (well_id) *
from public.well_readings
order by well_id, reading_datetime desc;

grant select on public.well_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000005_well_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000006_product_meter_readings_latest_view.sql >>>>>>>
-- Adds a "latest row per product meter" view, same pattern as
-- ro_train_readings_latest, locator_readings_latest, and well_readings_latest.
-- idx_pmr_meter_dt (meter_id, reading_datetime desc) already exists from
-- 20260721_product_meters_and_readings.sql — no new index needed.
--
-- This also replaces a real correctness bug in ProductSection.tsx's existing
-- 'product-readings-latest' query, not just adds a badge: that query pulls
-- the last 200 rows for the whole plant, order by reading_datetime desc, and
-- keeps the first row seen per meter_id. On a plant where some meters are
-- read far more often than others, the 200-row window can be entirely
-- consumed by the frequently-read meters before ever reaching a row for a
-- rarely-read one — that meter then reads as "no reading ever" rather than
-- "reading exists, just old", with no relationship to how stale it actually
-- is. Pointing that query at this view instead makes "latest per meter"
-- correct by construction, for the same reading_datetime/daily_volume shape
-- that ProductMeterRow.tsx already consumes from it.
--
-- norm_status filter: matches fn_product_meter_reading_integrity's own
-- definition of "the real previous reading" (see hamas_phase15, same day) —
-- 'retracted' rows are voided and 'pending_review' rows are unconfirmed,
-- so neither should surface as "the latest reading" in a freshness badge.
-- 'erroneous' and 'normalized' are left in, same as that trigger treats
-- them: flagged or corrected, but still a real recorded reading. The
-- `norm_status IS NULL OR` guard is defensive, not load-bearing — the
-- column carries `DEFAULT 'normal'` (20260514_normalization.sql), which
-- Postgres backfills onto pre-existing rows, so there shouldn't be any
-- nulls left in practice.

create or replace view public.product_meter_readings_latest
with (security_invoker = true) as
select distinct on (meter_id) *
from public.product_meter_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by meter_id, reading_datetime desc;

grant select on public.product_meter_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000006_product_meter_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000007_locator_readings_latest_view_exclude_retracted.sql >>>>>>>
-- Corrects locator_readings_latest (20260809140000_locator_readings_latest_view.sql,
-- already applied) to exclude 'retracted' and 'pending_review' rows, matching
-- fn_locator_reading_integrity's own definition of "the real previous
-- reading" and the same fix just applied to well_readings_latest and
-- product_meter_readings_latest (20260809150000 / 20260809160000, same
-- batch) — this one was missed when 140000 was written since the
-- norm_status column and its implications weren't on the radar yet at that
-- point. CREATE OR REPLACE VIEW is safe here: the output column list is
-- unchanged (still `select distinct on (locator_id) *`), only the WHERE
-- clause is added, so this doesn't need to drop the view or touch anything
-- that depends on it.
--
-- Without this, a locator whose most recent row happens to be retracted (a
-- normalization undone) or pending_review (an unconfirmed spike/backward
-- reading, not yet resolved via Data Corrections) would show that voided or
-- unconfirmed row as "the latest reading" in the freshness badge, instead of
-- the last row that's actually confirmed.

create or replace view public.locator_readings_latest
with (security_invoker = true) as
select distinct on (locator_id) *
from public.locator_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by locator_id, reading_datetime desc;

grant select on public.locator_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000007_locator_readings_latest_view_exclude_retracted.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000008_well_readings_latest_view_exclude_retracted.sql >>>>>>>
-- Corrects well_readings_latest (20260809150000_well_readings_latest_view.sql,
-- already applied) to exclude 'retracted' and 'pending_review' rows — the
-- same fix as 20260809170000 for locator_readings_latest, for the same
-- reason: fn_locator_reading_integrity's family of triggers (and
-- hamas_phase15's version of it for product meters) treats a retracted row
-- as voided and a pending_review row as unconfirmed, so neither should
-- surface as "the latest reading" in a freshness badge. well_readings
-- carries the same norm_status column and values (20260514_normalization.sql
-- / 20260718_pending_review_and_cascade_correction.sql).
--
-- CREATE OR REPLACE VIEW is safe: the output column list is unchanged
-- (still `select distinct on (well_id) *`), only the WHERE clause is added.

create or replace view public.well_readings_latest
with (security_invoker = true) as
select distinct on (well_id) *
from public.well_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by well_id, reading_datetime desc;

grant select on public.well_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000008_well_readings_latest_view_exclude_retracted.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000009_blending_events_dedupe_and_unique_constraint.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_blending_events_dedupe_and_unique_constraint.sql
--
-- CONTEXT: blending_events has never had a uniqueness guarantee on
-- (well_id, event_date). The only protection against two rows for the same
-- well on the same day was app-side: BlendingSection.tsx SELECTs to check
-- whether a row already exists, then branches to INSERT or UPDATE. That's a
-- classic check-then-act race — a double-click, a slow network retry, or
-- two people saving around the same time can each pass the "does it exist?"
-- check before either write has landed, producing two rows for the same
-- well/day. Each row then surfaces as its own card in the notification bell
-- (Dashboard.tsx's blending feed alert), which is what showed up as
-- duplicate "Injected NNN m³" notifications for the same well.
--
-- This migration:
--   1. Deduplicates any existing (well_id, event_date) collisions, keeping
--      one row per group (preferring the row with a real reading_datetime,
--      then the most recently entered one).
--   2. Adds a UNIQUE constraint on (well_id, event_date) so Postgres itself
--      rejects any future duplicate, race or not.
--   3. Adds fn_blending_upsert_reading(), an atomic INSERT ... ON CONFLICT
--      DO UPDATE the frontend can call instead of its old select-then-write
--      pair, closing the race window entirely rather than just detecting it
--      after the fact. SECURITY INVOKER, so existing RLS policies
--      (analyst_write_blending_events / blending_events_update) still apply
--      exactly as they do for direct .insert()/.update() calls.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
-- Keep one row per (well_id, event_date): prefer a real reading_datetime
-- over NULL, then the most recently entered (noted_at), then highest id as
-- a final tiebreak. Safe to delete the losers outright — previous_reading
-- on any later row is a value baked in at write time, not a live foreign
-- key, so removing an earlier duplicate can't corrupt a later row's stored
-- delta. reading_edit_audit_log / reading_anomaly_remarks reference
-- blending_events rows by a loosely-typed (table_name, record_id) pair with
-- no FK, so a removed duplicate's audit trail simply stays as history —
-- same as any other hard delete of a blending_events row today.
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY well_id, event_date
        ORDER BY reading_datetime DESC NULLS LAST, noted_at DESC, id DESC
      ) AS rn
    FROM public.blending_events
  ),
  deleted AS (
    DELETE FROM public.blending_events
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;

  RAISE NOTICE 'blending_events dedupe: removed % duplicate row(s) for (well_id, event_date)', dup_count;
END $$;

-- ── 2. Enforce it going forward ─────────────────────────────────────────────
ALTER TABLE public.blending_events
  DROP CONSTRAINT IF EXISTS blending_events_well_date_uniq;
ALTER TABLE public.blending_events
  ADD CONSTRAINT blending_events_well_date_uniq UNIQUE (well_id, event_date);

-- ── 3. Atomic upsert, replacing the racy select-then-write pair ────────────
-- p_update_previous_reading controls whether previous_reading is allowed to
-- overwrite an EXISTING row (the ON CONFLICT DO UPDATE branch):
--   - CSV import (BlendingSection.tsx) always passes previous_reading
--     through on overwrite when it has one, so it passes true.
--   - Manual entry (BlendingRow.save) never wants to re-baseline an
--     existing row from a client-tracked cumulative value, so it passes
--     false — matching the old manual UPDATE branch, which omitted
--     previous_reading entirely.
-- Either way, previous_reading is still used to seed a genuine new row on
-- INSERT; when omitted (NULL), trg_blending_set_reading resolves it from
-- the well's own last row exactly as it already does today.
CREATE OR REPLACE FUNCTION public.fn_blending_upsert_reading(
  p_well_id                 UUID,
  p_plant_id                UUID,
  p_well_name               TEXT,
  p_plant_name              TEXT,
  p_event_date              DATE,
  p_reading_datetime        TIMESTAMPTZ,
  p_raw_meter_reading       NUMERIC,
  p_previous_reading        NUMERIC DEFAULT NULL,
  p_update_previous_reading BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.blending_events
    (well_id, plant_id, well_name, plant_name, event_date, reading_datetime,
     raw_meter_reading, previous_reading)
  VALUES
    (p_well_id, p_plant_id, p_well_name, p_plant_name, p_event_date, p_reading_datetime,
     p_raw_meter_reading, p_previous_reading)
  ON CONFLICT (well_id, event_date) DO UPDATE SET
    plant_id          = EXCLUDED.plant_id,
    well_name         = EXCLUDED.well_name,
    plant_name        = EXCLUDED.plant_name,
    reading_datetime   = COALESCE(EXCLUDED.reading_datetime, public.blending_events.reading_datetime),
    raw_meter_reading = EXCLUDED.raw_meter_reading,
    previous_reading  = CASE
                           WHEN p_update_previous_reading AND EXCLUDED.previous_reading IS NOT NULL
                             THEN EXCLUDED.previous_reading
                           ELSE public.blending_events.previous_reading
                         END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_blending_upsert_reading(
  UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, NUMERIC, NUMERIC, BOOLEAN
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000009_blending_events_dedupe_and_unique_constraint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000010_correction_requests_rls.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_correction_requests_rls.sql
--
-- Likely root cause of "approved correction requests stay stuck in the
-- pending list": correction_requests isn't created by any migration in this
-- repo (see 20260723_manager_data_corrections_access.sql's note) — it was
-- set up directly in the Supabase dashboard, so its RLS has never actually
-- been confirmed from code, only guessed at.
--
-- approveRequest() / rejectRequest() / supersedeOtherCorrectionRequests() in
-- DataCorrections.tsx all update this table. If its current UPDATE policy
-- doesn't grant the resolving user access — e.g. only allows the row's own
-- submitted_by to update it, or requires a role that doesn't match whoever's
-- clicking Approve — Postgres/PostgREST doesn't error on that: an UPDATE a
-- policy narrows to zero matching rows just returns 0 rows affected, no
-- error. The old frontend code didn't check for that, so it showed
-- "Correction approved and applied" regardless, called invalidate(), and
-- fetchCorrectionRequests() re-fetched status='pending' rows and found the
-- same row still there — because it never actually changed. Ruled out the
-- simpler explanation first: invalidate() does target the right query key
-- ('correction-requests-pending'), so this isn't a caching bug.
--
-- This can't be confirmed against the table's actual current policy from
-- here, so this migration is deliberately idempotent (DROP POLICY IF EXISTS
-- before every CREATE) and safe to run either way. It's paired with a
-- frontend fix (DataCorrections.tsx) that now checks the .update() result
-- directly — so if this guess turns out wrong, or something else entirely
-- is blocking the write, that will now surface as a visible error toast
-- instead of a silently-stale row, either way.
--
-- Before applying, you can compare against what's actually live:
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies WHERE tablename = 'correction_requests';
--
-- Policy shape mirrors the rest of the schema:
--   - INSERT: any authenticated user with plant access, only as themselves
--     (submitted_by = auth.uid()) — same as how operators already submit
--     readings directly to locator_readings/well_readings/etc.
--   - SELECT: plant access — both the submitting operator and any approver
--     need to see these rows.
--   - UPDATE (approve/reject/supersede): Admin, Manager, or Data Analyst
--     with plant access — the exact same approver group
--     fn_cascade_reading_correction already checks (20260723 migration),
--     so an operator can never resolve their own or anyone else's request.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  original_value NUMERIC NOT NULL,
  proposed_value NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  submitted_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution_note TEXT,
  resolved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.correction_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "correction_requests_insert_own" ON public.correction_requests;
CREATE POLICY "correction_requests_insert_own" ON public.correction_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_plant_access(plant_id)
    AND submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "correction_requests_select_plant" ON public.correction_requests;
CREATE POLICY "correction_requests_select_plant" ON public.correction_requests
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "correction_requests_resolve_approvers" ON public.correction_requests;
CREATE POLICY "correction_requests_resolve_approvers" ON public.correction_requests
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_analyst_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_analyst_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000010_correction_requests_rls.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000011_notify_submitter_on_correction_rejection.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_notify_submitter_on_correction_rejection.sql
--
-- Gap: when a supervisor rejects an operator's correction_requests row
-- (DataCorrections.tsx → rejectRequest()), the submitting operator was never
-- notified — the request just quietly stopped showing up anywhere on their
-- side, with no indication it was reviewed or why. approveRequest()'s own
-- code comment ("Mark request as approved (triggers operator notification)")
-- implies the approve path already notifies the submitter via some existing
-- trigger, but correction_requests itself isn't created by any migration in
-- this repo — per 20260723_manager_data_corrections_access.sql, it was set
-- up directly in the Supabase dashboard — so that trigger's exact definition
-- isn't visible here to extend safely.
--
-- Rather than guess at it and risk a duplicate/conflicting trigger on the
-- approve path, this adds a new trigger scoped ONLY to the pending→rejected
-- transition. It surfaces resolution_note — now always populated, since the
-- frontend requires a reason before the Reject button is even enabled — as
-- the notification body, so the operator sees why, not just that.
--
-- Before/after applying, you can confirm there's no pre-existing overlap:
--   SELECT tgname, pg_get_triggerdef(oid)
--     FROM pg_trigger WHERE tgrelid = 'public.correction_requests'::regclass;
-- If a rejection ever produces two notifications for the same event, one of
-- the two triggers found there is redundant with this one — drop that one.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_notify_submitter_on_correction_rejection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected'
     AND OLD.status IS DISTINCT FROM 'rejected'
     AND NEW.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, plant_id, alert_type, severity, title, message, link_path)
    VALUES (
      NEW.submitted_by,
      NEW.plant_id,
      'correction_request_rejected',
      'Medium',
      'Correction request rejected',
      'Your correction request (' || NEW.source_table || ': ' ||
        COALESCE(NEW.original_value::text, '—') || ' \u2192 ' ||
        COALESCE(NEW.proposed_value::text, '—') ||
        ') was rejected. Reason: ' ||
        COALESCE(NULLIF(TRIM(NEW.resolution_note), ''), 'No reason given.'),
      '/operations'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_submitter_on_correction_rejection() IS
  'Notifies the operator who submitted a correction_requests row when a '
  'supervisor rejects it, including resolution_note (the required rejection '
  'reason) in the notification body. Scoped narrowly to the pending→rejected '
  'transition so it cannot double-fire alongside whatever already handles '
  'the approved case.';

DROP TRIGGER IF EXISTS trg_notify_submitter_on_correction_rejection ON public.correction_requests;
CREATE TRIGGER trg_notify_submitter_on_correction_rejection
  AFTER UPDATE ON public.correction_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_submitter_on_correction_rejection();

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000011_notify_submitter_on_correction_rejection.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000012_reading_audit_log_add_cip_logs.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_reading_audit_log_add_cip_logs.sql
--
-- CIPLog.tsx's saveEdit() has always called logReadingEdit() with
-- `table_name: 'chemical_dosing_logs' as any` — the comment right above it
-- said why: "cast table_name since cip_logs isn't in the type union yet."
-- 'cip_logs' was never in this table's CHECK constraint either, so casting
-- to a table name that WAS allowed was the only way it worked at all — every
-- CIP edit has been silently misattributed to Chemical Dosing in the audit
-- trail since this page shipped, including now that CIP edits carry a
-- required reason (20260809_reading_edit_audit_log_reason.sql) — that reason
-- has been landing under the wrong table_name too.
--
-- Paired with a frontend fix (CIPLog.tsx, helpers.tsx) that now passes the
-- correct 'cip_logs' literal. Without this migration, that fix alone would
-- turn a silent mislabeling into a silent non-write instead (logReadingEdit
-- swallows insert failures on purpose — audit logging must never block the
-- actual save), which would be worse: CIP edits would stop being audited at
-- all instead of just being audited under the wrong table name.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'cip_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000012_reading_audit_log_add_cip_logs.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000013_reading_edit_audit_log_reason.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_reading_edit_audit_log_reason.sql
--
-- CONTEXT: correctionReasons.ts already defines a shared CORRECTION_REASONS
-- taxonomy, and two surfaces already require picking one — an operator's
-- CorrectionRequestDialog (goes to supervisor approval) and an admin's
-- EditValueModal on the Pending Review tab (DataCorrections.tsx). But the
-- day-to-day "edit an already-saved reading" dialogs used throughout
-- Operations (RO trains, pretreatment, locators, wells, product, blending,
-- power, dosing/CIP logs) never got wired to it — they log a field-level
-- diff via logReadingEdit() -> reading_edit_audit_log, but nothing about
-- *why*. This adds the column that was missing to actually record it.
--
-- Plain TEXT, no CHECK constraint: mirrors correction_requests.reason,
-- which is enforced against CORRECTION_REASONS only at the app layer (the
-- shared dropdown), including a free-typed 'Other' value. Nullable —
-- existing rows have none, and by product decision this only applies to
-- 'update' actions going forward (not 'delete' or bulk 'import'), so NULL
-- stays a normal, valid state at the DB level; the requirement is enforced
-- client-side by gating each dialog's Save button, same pattern the two
-- existing consumers already use.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  ADD COLUMN IF NOT EXISTS reason TEXT;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000013_reading_edit_audit_log_reason.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000001_backfill_well_reading_chain_sync.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — already applied live, never committed until now.
-- Recovered verbatim from the live database (project sosfbfxovtleuvahxvpm)
-- during the Parkmall / "Well 2" Data Summary investigation (2026-08-10).
--
-- Gives well_readings the same AFTER-trigger chain-repair that
-- locator_readings already has (fn_sync_locator_reading_chain): re-derives
-- previous_reading + daily_volume fresh on every insert/update/delete and
-- heals the immediate successor, so an out-of-order backfill or edit
-- doesn't leave a later row's previous_reading permanently stale.
--
-- NOTE: this fixes the trigger going forward only. It does not retroactively
-- repair rows that drifted before this trigger existed — see
-- reading_chain_drift_audit.sql (committed the same day) for the current
-- scale of that backlog across wells. That backlog is a separate, larger
-- cleanup (several wells show real drift, some of it possibly tangled up
-- with un-flagged meter replacements) and is NOT touched by this migration
-- or by the two migrations that follow it today.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_well_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
/*
  Called AFTER INSERT, UPDATE, or DELETE on well_readings.

  Same chain-repair strategy as locator_readings, but because daily_volume
  is a plain column we write all three derived values (previous_reading,
  daily_volume) directly on the mutated row and then heal the successor.

  current_reading may be NULL on well rows (partial reading entry) —
  we guard with NULLIF to avoid writing a nonsensical delta.
*/
DECLARE
  v_well_id           UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_id    UUID;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
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
       AND current_reading IS NOT NULL           -- skip partial rows as predecessors
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.well_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN NEW.current_reading IS NOT NULL
                                 AND v_predecessor_read  IS NOT NULL
                                THEN GREATEST(0, NEW.current_reading - v_predecessor_read)
                                WHEN NEW.current_reading IS NOT NULL
                                THEN NEW.current_reading        -- first reading in chain
                                ELSE NULL
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id
    INTO v_successor_id
    FROM public.well_readings
   WHERE well_id          = v_well_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      -- Successor's predecessor is now OLD's predecessor.
      v_new_prev := OLD.previous_reading;
    ELSE
      -- Successor's predecessor is this row's current_reading.
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.well_readings AS wr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN wr.current_reading IS NOT NULL
                                 AND v_new_prev          IS NOT NULL
                                THEN GREATEST(0, wr.current_reading - v_new_prev)
                                WHEN wr.current_reading IS NOT NULL
                                THEN wr.current_reading
                                ELSE NULL
                              END
     WHERE wr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_well_readings_delta ON public.well_readings;
CREATE TRIGGER trg_well_readings_delta
  AFTER INSERT OR DELETE OR UPDATE OF current_reading ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION fn_sync_well_reading_chain();

-- <<<<<<< END ARCHIVED: 20260810000001_backfill_well_reading_chain_sync.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000002_product_meter_pending_review_predecessor_fix.sql >>>>>>>
-- =============================================================================
-- Root cause of the Parkmall "500,000+ m3/day" Data Summary / detail-chart
-- bug (reported 2026-08-10, screenshots of Dashboard "Data Summary" >
-- Production tab and the Parkmall meter detail chart).
--
-- fn_product_meter_reading_integrity's predecessor lookup excluded BOTH
-- 'retracted' and 'pending_review' rows. Once one row got flagged
-- pending_review (for any reason — even a transient one), every later
-- insert's predecessor lookup skipped over it and fell back further back
-- in time, producing an ever-larger gap that itself exceeded the 2x-average
-- spike threshold and got flagged pending_review too. Self-reinforcing,
-- no way to self-heal: five real days of Parkmall production (~1,200 m3
-- each) compounded into a single 6,270 m3 "daily" figure by day five,
-- and DataSummaryModal.tsx's computePivotFromReadingsNoCache trusts the
-- stored daily_volume directly (correctly, in general — this was a data
-- problem, not a pivot problem).
--
-- 'retracted' genuinely means "voided, don't use." A 'pending_review' row's
-- raw current_reading is still the best known real meter value and should
-- remain a valid predecessor for the next reading — only its own
-- interpretation is in question, not the reading itself. This mirrors how
-- well_readings' and locator_readings' chain-repair already work (no
-- status filtering at all in their predecessor lookups).
--
-- Companion migration 20260810020000 adds the AFTER-trigger cascade repair
-- (product_meter_readings never had one) for defense in depth against
-- out-of-order inserts/edits going forward.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_is_derived    BOOLEAN;
BEGIN
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

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
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

        IF v_avg_flow_rate IS NOT NULL AND v_flow_rate > v_avg_flow_rate * 2.0 AND NEW.norm_status = 'normal' THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Data repair ───────────────────────────────────────────────────────────
-- Clears the false pending_review flags this cascade left on Parkmall and
-- Coke (both at Guizo — same plant, same window; Coke's inflated numbers
-- were smaller and less visually obvious but the same bug). The chain
-- cascade trigger in the companion migration must run first so
-- previous_reading/daily_volume are already correct before this clears
-- the flag; run this repair block AFTER applying 20260810020000.
--
-- UPDATE product_meter_readings
-- SET norm_status = 'normal'
-- WHERE meter_id IN (
--   (SELECT id FROM product_meters WHERE name = 'Parkmall'),
--   (SELECT id FROM product_meters WHERE name = 'Coke')
-- )
-- AND norm_status = 'pending_review'
-- AND reading_datetime >= '2026-08-06' AND reading_datetime <= '2026-08-10 23:59:59';

-- <<<<<<< END ARCHIVED: 20260810000002_product_meter_pending_review_predecessor_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000003_product_meter_readings_chain_cascade_trigger.sql >>>>>>>
-- =============================================================================
-- product_meter_readings never had the AFTER-trigger chain-repair that
-- well_readings (fn_sync_well_reading_chain) and locator_readings
-- (fn_sync_locator_reading_chain) already have. Without it, an
-- out-of-order insert/edit/delete leaves a successor row's
-- previous_reading permanently stale — same class of bug already fixed
-- elsewhere in this schema, now the second half of the Parkmall fix (see
-- 20260810010000, which stops NEW cascades from forming; this one gives
-- every insert/update/delete a self-healing, status-independent recompute
-- + successor patch, for out-of-order backfills going forward).
-- =============================================================================

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

  -- Derived (mirrored) meters get current_reading/daily_volume written
  -- directly by the locator-mirror sweep, not by cumulative-meter diffing
  -- — matches fn_product_meter_reading_integrity's own is_derived guard.
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
                                ELSE GREATEST(0, current_reading - COALESCE(v_predecessor_read, 0))
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
                                ELSE GREATEST(0, pmr.current_reading - COALESCE(v_new_prev, 0))
                              END
     WHERE pmr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_product_meter_readings_delta ON public.product_meter_readings;
CREATE TRIGGER trg_product_meter_readings_delta
  AFTER INSERT OR DELETE OR UPDATE OF current_reading ON public.product_meter_readings
  FOR EACH ROW EXECUTE FUNCTION fn_sync_product_meter_reading_chain();

-- ── Data repair ───────────────────────────────────────────────────────────
-- Fires the new trigger on every existing row so previous_reading /
-- daily_volume are recomputed from the true chronological predecessor.
-- Safe to run repeatedly (idempotent once the chain is correct).
--
-- UPDATE product_meter_readings
-- SET current_reading = current_reading
-- WHERE id IN (SELECT id FROM product_meter_readings ORDER BY meter_id, reading_datetime ASC);

-- <<<<<<< END ARCHIVED: 20260810000003_product_meter_readings_chain_cascade_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000004_blending_events_chain_cascade_trigger.sql >>>>>>>
-- =============================================================================
-- Root cause of the "Well 2" blending History showing inflated multi-
-- thousand-m3 volumes (reported 2026-08-10, screenshots of two "Well 2 —
-- History" dialogs disagreeing — the blending-events view vs the
-- well_readings meter-history view for the same physical meter).
--
-- blending_events only had fn_blending_set_reading (BEFORE INSERT/UPDATE),
-- which resolves previous_reading ONCE, at insert time, and only when the
-- caller didn't already supply one — with no mechanism to re-walk the
-- chain when an earlier row is backfilled after a later one already
-- exists. A well acting as a blending source doesn't always get same-day
-- entries, so a later row's previous_reading gets stuck pointing at
-- whatever was the most recent row AT INSERT TIME, silently skipping any
-- earlier row backfilled afterward and double- (or triple-) counting
-- those skipped days into one. Adds the same AFTER-trigger chain-repair
-- pattern as well_readings / locator_readings / product_meter_readings.
--
-- The successor-patch step deliberately skips any successor whose
-- raw_meter_reading IS NULL — pre-migration legacy rows that carry a
-- manually-set volume_m3 with no meter reading to diff against. Touching
-- those would both compute a meaningless NULL volume and re-fire
-- fn_blending_set_reading (which also fires on UPDATE OF previous_reading)
-- straight into its "raw_meter_reading is required" guard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_blending_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id        UUID;
  v_event_date     DATE;
  v_reading_dt     TIMESTAMPTZ;
  v_predecessor    NUMERIC;
  v_successor_id   UUID;
  v_successor_repl BOOLEAN;
  v_successor_raw  NUMERIC;
  v_new_prev       NUMERIC;
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
  -- Ordering matches fn_blending_set_reading's own convention: event_date,
  -- then reading_datetime as a tiebreaker within the same date.
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
                                WHEN v_predecessor IS NULL THEN 0
                                ELSE GREATEST(0, raw_meter_reading - v_predecessor)
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), raw_meter_reading
    INTO v_successor_id, v_successor_repl, v_successor_raw
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
                                WHEN v_new_prev IS NULL THEN 0
                                ELSE GREATEST(0, be.raw_meter_reading - v_new_prev)
                              END
     WHERE be.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_blending_readings_chain ON public.blending_events;
CREATE TRIGGER trg_blending_readings_chain
  AFTER INSERT OR DELETE OR UPDATE OF raw_meter_reading ON public.blending_events
  FOR EACH ROW EXECUTE FUNCTION fn_sync_blending_reading_chain();

-- ── Data repair ───────────────────────────────────────────────────────────
-- Fires the new trigger on every existing row with a raw meter reading, so
-- previous_reading / volume_m3 are recomputed from the true chronological
-- predecessor. EXCLUDES "Inside Well" (Mambaling) rows dated on or before
-- 2026-07-01: that well's early history has event_date and reading_datetime
-- running ~6-7 days apart from each other in a way that isn't consistent
-- enough to auto-repair safely (see reading_chain_drift_audit.sql) — left
-- alone deliberately, flagged for manual review rather than guessed at.
--
-- UPDATE blending_events
-- SET raw_meter_reading = raw_meter_reading
-- WHERE id IN (
--   SELECT id FROM blending_events
--   WHERE raw_meter_reading IS NOT NULL
--     AND NOT (well_id = (SELECT id FROM wells WHERE name = 'Inside Well' AND plant_id =
--                          (SELECT id FROM plants WHERE name = 'Mambaling'))
--              AND event_date <= '2026-07-01')
--   ORDER BY well_id, event_date ASC, reading_datetime ASC
-- );

-- <<<<<<< END ARCHIVED: 20260810000004_blending_events_chain_cascade_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260811000001_reading_audit_log_add_product_meter.sql >>>>>>>
-- =============================================================================
-- Migration: 20260811_reading_audit_log_add_product_meter.sql
--
-- ProductMeterHistoryDialog (frontend/src/pages/operations/product/
-- ProductSection.tsx) is the "edit an already-saved reading" surface for
-- product meters — the direct sibling of the well/locator/power/blending
-- edit flow in ReadingHistoryDialog.tsx and the RO train/pretreatment/CIP/
-- dosing edit dialogs. Every one of those already requires picking a reason
-- from CORRECTION_REASONS (CorrectionReasonField) and logs the edit via
-- logReadingEdit() -> reading_edit_audit_log. ProductMeterHistoryDialog's
-- saveEdit()/deleteRow() never did either — confirmed by
-- 20260807_reading_anomaly_remarks.sql's own comment describing
-- product_meter_readings as "the one reading table that audit log doesn't
-- cover yet", and by 20260809_reading_edit_audit_log_reason.sql listing
-- "product" among the surfaces the reason column was meant to cover.
--
-- Paired with a frontend fix (ProductSection.tsx, helpers.tsx) that now
-- requires a reason and calls logReadingEdit() with
-- table_name: 'product_meter_readings'. Without this migration, that insert
-- would fail the table_name CHECK constraint — logReadingEdit() swallows
-- insert failures on purpose (audit logging must never block the actual
-- save), so the edit would keep silently going unaudited exactly as before.
-- Same DROP/ADD pattern as 20260806_reading_audit_log_add_power_blending_well.sql
-- and 20260809_reading_audit_log_add_cip_logs.sql.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'cip_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings',
    'product_meter_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260811000001_reading_audit_log_add_product_meter.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260811000002_ro_pretreat_delete_rls_fix.sql >>>>>>>
-- =============================================================================
-- Migration: 20260811_ro_pretreat_delete_rls_fix.sql
--
-- Fixes: the Delete (and Edit) button in the RO Train / Pre-Treatment
-- operator log does nothing for some Manager / Data Analyst users.
--
-- Root cause: TrainLogModal.tsx sets
--     hasFullAccess = isManager || isDataAnalyst
-- and shows the delete/edit controls to those roles for ANY train, with no
-- plant scoping (see frontend/src/pages/ro-trains/helpers.tsx canEditEntry).
-- But the RLS policies on ro_train_readings and ro_pretreatment_readings
-- only ever called user_has_plant_access(plant_id), which for a non-Admin
-- requires the row's plant_id to be in that user's plant_assignments. A
-- Manager/Data Analyst whose plant_assignments don't cover a given train's
-- plant sees the delete button (frontend says "full access"), confirms the
-- dialog, and the DELETE is silently blocked by RLS -- 0 rows affected.
-- TrainLogModal.tsx's doDeleteReading() already detects and reports this via
-- its post-delete `.select('id')` 0-row check (added after the same failure
-- mode hit blending_events -- see 20260729_blending_events_meter_columns.sql).
--
-- Fix: give Manager / Data Analyst unscoped write access to just these two
-- tables, matching what the frontend already assumes. Scoped through a new
-- helper function rather than broadening user_has_plant_access() itself,
-- since that function also backs write policies on locator_readings,
-- well_readings, power_readings, pump_readings, cip_logs, incidents, and
-- others -- broadening it globally would silently hand Manager/Data Analyst
-- unscoped write access to all of those too, which is a bigger change than
-- "fix the RO delete button."
--
-- Supersedes the interactive supabase/migrations/confirm-and-fix-ro-delete.sql
-- draft (same fix, minus the manual per-user diagnostic step). That file can
-- be deleted once this one has been run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_has_ro_write_access(_plant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.user_has_plant_access(_plant_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('Manager', 'Data Analyst')
    );
$$;

DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON public.ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON public.ro_train_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

DROP POLICY IF EXISTS "ro_pretreatment_access" ON public.ro_pretreatment_readings;
CREATE POLICY "ro_pretreatment_access" ON public.ro_pretreatment_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────
-- Re-run this after applying and confirm both policies show USING/WITH CHECK
-- expressions referencing user_has_ro_write_access.
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('ro_train_readings', 'ro_pretreatment_readings')
order by tablename, policyname;

-- <<<<<<< END ARCHIVED: 20260811000002_ro_pretreat_delete_rls_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260812000001_fix_approve_reflag_on_pending_review.sql >>>>>>>
-- =============================================================================
-- Migration: 20260812090000_fix_approve_reflag_on_pending_review.sql
--
-- BUG REPORTED: Data Corrections → Pending tab — clicking "Approve" on a
-- flagged reading (e.g. Parkmall, Coke — both product_meter_readings,
-- Guizo) shows the "approved" toast, but the row is still there after the
-- list refetches / on next visit.
--
-- ROOT CAUSE: this is NOT the RLS-silently-narrows-the-update failure mode
-- the .select('id') checks in DataCorrections.tsx already guard against
-- (see comments there) — the UPDATE genuinely applies. The problem is what
-- happens next, inside the same statement:
--
--   fn_locator_reading_integrity() and fn_product_meter_reading_integrity()
--   both run BEFORE INSERT OR UPDATE and unconditionally re-derive
--   norm_status from the row's raw current_reading/previous_reading
--   whenever the incoming value is norm_status = 'normal':
--
--     IF v_computed_vol < 0 ... AND NEW.norm_status = 'normal' THEN
--       NEW.norm_status := 'pending_review';
--     END IF;
--
--   "Approve" (DataCorrections.tsx resolveOne / bulkResolve) does exactly
--   `UPDATE ... SET norm_status = 'normal' WHERE id = ...` — it doesn't
--   touch current_reading, because the reading is being approved AS-IS,
--   not corrected. That UPDATE is precisely what the trigger's own
--   condition is watching for. Since the raw values didn't change, the
--   backward/spike check still evaluates true, and the trigger silently
--   flips norm_status right back to 'pending_review' before the row is
--   even written — the admin's decision is overwritten inside their own
--   UPDATE statement, with no error raised anywhere.
--
--   This is also why the other two resolution paths look fine and only
--   plain Approve is broken:
--     - "Edit value" (fn_cascade_reading_correction) sets
--       norm_status = 'normalized', which never matches the trigger's
--       `= 'normal'` check, so it's untouched by this bug.
--     - "Mark as rollover" sets is_meter_rollover = true, which the
--       backward-check condition already explicitly excludes.
--     - "Reject" sets norm_status = 'retracted', which also never matches
--       `= 'normal'`.
--   Only the literal "approve this reading unchanged" action collides with
--   the trigger's own re-check condition.
--
--   well_readings is NOT affected — it has no equivalent integrity trigger
--   that re-derives norm_status (trg_well_readings_delta only recomputes
--   previous_reading/daily_volume, and only fires on
--   `UPDATE OF current_reading`, which a plain Approve never touches).
--
-- FIX: both functions gain a `v_resolving_from_pending` flag — true only
-- when this is an UPDATE and the row's norm_status was already
-- 'pending_review' beforehand. When true, the backward/spike auto-flag is
-- skipped, so an explicit admin/reviewer approval sticks. Fresh inserts
-- (TG_OP = 'INSERT', where OLD doesn't exist) and any other edit path are
-- completely unaffected — they're still checked exactly as before. This is
-- deliberately scoped as narrowly as possible: it only changes behavior for
-- the specific "this row was pending_review and is now being explicitly
-- set to normal" transition, which is the definition of "approve."
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading           NUMERIC;
  v_prev_dt                TIMESTAMPTZ;
  v_computed_vol           NUMERIC;
  v_hours_elapsed          NUMERIC;
  v_flow_rate              NUMERIC;
  v_avg_flow_rate          NUMERIC;
  v_input_mode             TEXT;
  v_is_derived             BOOLEAN;
  -- True only for an UPDATE whose OLD row was already 'pending_review' —
  -- i.e. this statement is resolving an existing flag, not introducing a
  -- fresh one. Computed via IF (not inline `TG_OP = 'UPDATE' AND OLD...`)
  -- so OLD is never referenced outside an UPDATE context.
  v_resolving_from_pending BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_resolving_from_pending := (OLD.norm_status = 'pending_review');
  END IF;

  SELECT default_input_mode, is_derived
  INTO   v_input_mode, v_is_derived
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');
  v_is_derived := COALESCE(v_is_derived, FALSE);

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  -- Only raw (cumulative-meter) locators get previous_reading derived from
  -- the chronological predecessor. Direct-mode locators (current_reading IS
  -- the period volume) keep whatever the caller set.
  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    -- Derived locators (HAMAS-style): review need is already carried by
    -- locator_derived_review_flags / fn_flag_derived_review(). Skip the
    -- generic spike check.
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' AND NOT v_resolving_from_pending THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- RAW MODE — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_resolving_from_pending
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  -- Spike detection — flow rate > 2x 7-day average
  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
         AND NOT v_resolving_from_pending
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

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
  -- Same guard as fn_locator_reading_integrity above.
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

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
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

-- ── Data repair ───────────────────────────────────────────────────────────
-- One-time clear for rows already stuck by this bug at the time it was
-- found (Parkmall / Coke, Guizo — the exact rows from the bug report).
-- Safe to run any time after the function bodies above are applied: it's a
-- plain UPDATE ... SET norm_status = 'normal', and with the fixed trigger
-- in place that value will no longer be immediately reverted. Genuinely
-- backward/spike rows that still need a real decision are unaffected by
-- this migration — only rows an admin already tried (and failed) to
-- approve should be re-cleared, so this is commented out rather than
-- auto-applied; uncomment and run once if those specific rows are still
-- stuck after deploying the fix above.
--
-- UPDATE product_meter_readings
-- SET norm_status = 'normal'
-- WHERE meter_id IN (
--   (SELECT id FROM product_meters WHERE name = 'Parkmall'),
--   (SELECT id FROM product_meters WHERE name = 'Coke')
-- )
-- AND norm_status = 'pending_review';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260812000001_fix_approve_reflag_on_pending_review.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260815000001_reading_gap_reasons_add_blending.sql >>>>>>>
-- =============================================================================
-- Migration: 20260815000000_reading_gap_reasons_add_blending.sql
-- Extends reading_gap_reasons (see 20260719_offline_reason_tracking.sql) to
-- accept entity_type = 'blending'.
--
-- The "No reading — why?" gap-reason dialog exists on the Well and Locator
-- tabs (WellSection.tsx / LocatorSection.tsx) but was never added to the
-- Blending tab, so operators had no way to explain a day with no blending
-- meter reading. blending_events is keyed by well_id, but blending wells are
-- tracked as a distinct entity_type here (not 'well') because a well's
-- regular well_readings gap and its blending_events gap are two different
-- things — a well can be logged for one and not the other on the same day.
-- =============================================================================

ALTER TABLE reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending'));

-- <<<<<<< END ARCHIVED: 20260815000001_reading_gap_reasons_add_blending.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260816000001_meter_readings_dedupe_and_unique_constraints.sql >>>>>>>
-- =============================================================================
-- Migration: 20260816000000_meter_readings_dedupe_and_unique_constraints.sql
--
-- CONTEXT: well_readings, locator_readings and product_meter_readings have
-- never had a uniqueness guarantee on (entity_id, reading_datetime) — the
-- same gap blending_events had before 20260809_blending_events_dedupe_and_
-- unique_constraint.sql. WellSection.tsx and LocatorSection.tsx's save()
-- already contain a `error.code === '23505'` handler with a friendly
-- "already submitted within the last hour" toast — that code has been dead
-- since it was written, because no constraint exists to ever raise a 23505
-- here. ProductSection.tsx's ProductMeterRow.save() never got that handling
-- at all.
--
-- The actual failure mode (confirmed against live data): after a successful
-- save, the reading input re-fills with the just-saved value (deliberate —
-- "start from the real odometer value"). If the operator isn't sure the
-- save registered, the field shows the *same* number they just entered.
-- Re-tapping Save resubmits current_reading === previous_reading, quietly
-- creating a genuine, zero-delta duplicate row rather than being rejected.
-- Confirmed live on well_readings, locator_readings and product_meter_
-- readings (~30 existing collisions across all three, oldest from May 2026);
-- power_readings shows no exact-timestamp collisions currently (submitMeter
-- already pre-checks for a same-day row via findExistingReading() and
-- merges into it instead of inserting) so it's left out of this migration.
--
-- This migration:
--   1. Deduplicates existing (entity_id, reading_datetime) collisions per
--      table, keeping the most-recently-entered row (highest created_at) in
--      each group — same tiebreak as the blending_events precedent. Most
--      groups are exact duplicates (identical current_reading) where the
--      choice is moot; a smaller number are two *different* values entered
--      moments apart, which this treats as "the later entry is the
--      operator's corrected/final one." Full list of removed rows reported
--      separately for review, since that assumption isn't verifiable from
--      the data alone.
--   2. Adds a UNIQUE index on (entity_id, reading_datetime) per table so
--      Postgres rejects any future duplicate outright, race or not.
--
-- Deliberately NOT adding an atomic upsert RPC (contrast fn_blending_
-- upsert_reading): blending wants "latest value wins" for one row per
-- well/day. Meter readings don't — two different values at the same
-- timestamp are a conflict to surface to the operator, not silently
-- resolve by overwrite. Insert + 23505 + friendly toast (already written on
-- the Well/Locator side) is the right shape here; Product just needs that
-- same handling added, which is a frontend-only change.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY well_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.well_readings
  ),
  deleted AS (
    DELETE FROM public.well_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'well_readings dedupe: removed % duplicate row(s) for (well_id, reading_datetime)', dup_count;
END $$;

DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY locator_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.locator_readings
  ),
  deleted AS (
    DELETE FROM public.locator_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'locator_readings dedupe: removed % duplicate row(s) for (locator_id, reading_datetime)', dup_count;
END $$;

DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY meter_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.product_meter_readings
  ),
  deleted AS (
    DELETE FROM public.product_meter_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'product_meter_readings dedupe: removed % duplicate row(s) for (meter_id, reading_datetime)', dup_count;
END $$;

-- ── 2. Enforce it going forward ─────────────────────────────────────────────
ALTER TABLE public.well_readings
  DROP CONSTRAINT IF EXISTS well_readings_well_datetime_uniq;
ALTER TABLE public.well_readings
  ADD CONSTRAINT well_readings_well_datetime_uniq UNIQUE (well_id, reading_datetime);

ALTER TABLE public.locator_readings
  DROP CONSTRAINT IF EXISTS locator_readings_locator_datetime_uniq;
ALTER TABLE public.locator_readings
  ADD CONSTRAINT locator_readings_locator_datetime_uniq UNIQUE (locator_id, reading_datetime);

ALTER TABLE public.product_meter_readings
  DROP CONSTRAINT IF EXISTS product_meter_readings_meter_datetime_uniq;
ALTER TABLE public.product_meter_readings
  ADD CONSTRAINT product_meter_readings_meter_datetime_uniq UNIQUE (meter_id, reading_datetime);

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260816000001_meter_readings_dedupe_and_unique_constraints.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260817000001_sweep_function_revoke_anon.sql >>>>>>>
-- =============================================================================
-- Migration: 20260817000000_sweep_function_revoke_anon.sql
-- Removes the `anon` EXECUTE grant on fn_sweep_derived_meters.
--
-- CONTEXT:
--   20260727_hamas_phase2_sweep_function.sql granted EXECUTE to anon so the
--   derived-meter-sweep.yml cron job (no user session) could call it. But
--   the credential that workflow actually uses is
--   VITE_SUPABASE_PUBLISHABLE_KEY -- the same anon key that ships inside the
--   public frontend bundle by Supabase's own design. Granting a
--   SECURITY DEFINER function to `anon` on that basis means the function's
--   only real gate is a key any site visitor can read out of devtools, not
--   "the scheduled job" as intended. Anyone who has ever loaded the app can
--   POST to /rest/v1/rpc/fn_sweep_derived_meters with any p_date /
--   p_lookback_days (capped at 30 inside the function) at any frequency,
--   writing across locator_readings, product_meter_readings, and
--   derived_meter_sweep_log, and re-triggering fn_notify_derived_review's
--   "superseded" notification to Admin/Manager/Data Analyst each time.
--
-- FIX:
--   Revoke anon's EXECUTE grant. The cron workflow switches to the
--   service_role key instead (see the paired derived-meter-sweep.yml diff --
--   service_role is only ever held in GitHub Actions secrets, never shipped
--   to the client, so this closes the gap without touching the function's
--   own logic or its SECURITY DEFINER need). The "Recalculate now" button in
--   Operations > Locator already calls this through an authenticated
--   session, so the existing `authenticated` grant is untouched and that
--   path keeps working exactly as before.
--
--   service_role bypasses RLS/grants in Supabase by design, so it needs no
--   explicit GRANT here to keep working once the workflow switches keys --
--   this migration only removes anon's access.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) FROM anon;

COMMENT ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) IS
  'Recomputes residual volume (mother meter minus sibling locators) for every '
  'is_derived locator over a rolling lookback window, mirrors the result into '
  'any linked product_meters row, and notifies Admin/Manager/Data Analyst if '
  'a manual override gets superseded. Called on a schedule by '
  '.github/workflows/derived-meter-sweep.yml (service_role key as of '
  '2026-08-17 -- see 20260817000000_sweep_function_revoke_anon.sql; anon was '
  'never actually restricted to the cron job, since the anon key ships in '
  'the public frontend bundle) and on demand by the "Recalculate now" '
  'button in Operations > Locator (authenticated session).';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260817000001_sweep_function_revoke_anon.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260817000002_rls_gap_closure_pump_cip_incidents_blending_audit.sql >>>>>>>
-- =============================================================================
-- Migration: 20260817010000_rls_gap_closure_pump_cip_incidents_blending_audit.sql
--
-- Closes the remaining RLS gaps flagged in the 2026-08-17 code review /
-- status report, plus one newly-discovered gap found while verifying them
-- live (see part 2 below). Applied live via Supabase MCP on 2026-08-17;
-- this file backfills it into migrations so main and the live schema don't
-- drift apart (the recurring "committed but never run live" pattern, in
-- reverse).
--
-- PART 1 -- SELECT bypass for Manager/Data Analyst/Admin outside their own
-- plant assignment, same pattern already applied to well_readings,
-- locator_readings, and power_readings (is_manager_or_analyst_or_admin()).
-- Without this, a Manager/Data Analyst/Admin picking a plant outside their
-- own assignment silently gets 0 rows back on these three tables, same bug
-- class as the earlier "data analysis missing for some roles" fix.
-- INSERT/UPDATE/DELETE are untouched -- the existing plant-scoped FOR ALL
-- policies still gate writes for everyone, including Admin (which is fine,
-- since user_has_plant_access() already grants admins full access via
-- is_admin()).
-- =============================================================================

CREATE POLICY "pump_readings_analyst_select_bypass" ON public.pump_readings
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

CREATE POLICY "cip_logs_analyst_select_bypass" ON public.cip_logs
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

CREATE POLICY "incidents_analyst_select_bypass" ON public.incidents
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

-- =============================================================================
-- PART 2 -- blending_events: drop two over-permissive PERMISSIVE policies.
--
-- auth_delete_blending_events (DELETE, USING auth.uid() IS NOT NULL) was
-- already flagged as stray in the 2026-08-17 review. While verifying it
-- live, found the exact same pattern also exists for UPDATE:
-- auth_update_blending_events (UPDATE, USING/WITH CHECK auth.uid() IS NOT
-- NULL) -- not previously flagged. Because Postgres RLS policies for the
-- same command are OR'd together (both are PERMISSIVE), either of these
-- alone grants ANY authenticated user the ability to update or delete ANY
-- blending event in ANY plant, regardless of plant assignment -- making the
-- correctly plant-scoped blending_events_update / blending_events_delete
-- policies sitting right next to them functionally moot. A malicious or
-- merely curious authenticated user could reach this directly via the
-- Supabase REST API even though ReadingHistoryDialog's client-side
-- canEditEntry()/hasFullAccess() checks make the UI itself behave
-- correctly -- RLS is the real boundary, and it wasn't holding.
--
-- Dropping both. blending_events_update / blending_events_delete (both
-- FOR ... TO authenticated USING user_has_plant_access(plant_id)) already
-- grant the intended access: any role with plant access can edit/delete
-- within their own plant, same model as every other operational table in
-- this app, with per-row ownership/time restrictions enforced client-side
-- via canEditEntry() (the established pattern here, not changed by this
-- migration). auth_read_blending_events (SELECT, also auth.uid() IS NOT
-- NULL, no plant check) is untouched -- that one was already reviewed and
-- deliberately left open in the "blending history missing for some roles"
-- fix, since ReadingHistoryDialog's own read-only visibility gate was the
-- actual bug there, not the RLS.
-- =============================================================================

DROP POLICY IF EXISTS "auth_delete_blending_events" ON public.blending_events;
DROP POLICY IF EXISTS "auth_update_blending_events" ON public.blending_events;

-- =============================================================================
-- PART 3 -- reading_edit_audit_log SELECT: include Data Analyst.
--
-- Was is_manager_or_admin(auth.uid()) (Admin/Manager only), excluding Data
-- Analyst despite Data Analyst having full access to the Data Corrections
-- page this audit trail belongs to. Swapped to the analyst-inclusive
-- helper, same one used everywhere else in this migration.
-- =============================================================================

DROP POLICY IF EXISTS "reading edit log readable by admin/manager" ON public.reading_edit_audit_log;

CREATE POLICY "reading edit log readable by admin/manager/analyst" ON public.reading_edit_audit_log
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260817000002_rls_gap_closure_pump_cip_incidents_blending_audit.sql <<<<<<<

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
﻿-- =============================================================================
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
﻿-- Performance indexes and cost trigger optimization identified during 2026-09-06 architecture review.
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

-- =============================================================================
-- END OF BASELINE
-- =============================================================================
