-- =============================================================================
-- Migration: 20260908000001_001_core_schema.sql
-- Baseline 001: Core Schema & Roles (April 2026)
-- Partition of baseline schema covering archived migrations #1 to #18
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

