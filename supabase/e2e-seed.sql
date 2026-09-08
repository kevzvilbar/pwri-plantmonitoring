-- =============================================================================
-- E2E Test Data Seed
-- Seeds the local Supabase instance with test users and data for Playwright E2E tests
-- Run with: psql -h localhost -p 54322 -U postgres -d postgres -f e2e-seed.sql
-- =============================================================================

-- Run as the migration role (bypasses RLS)
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create test plants
DO $$
DECLARE
  v_plant_id uuid := gen_random_uuid();
  v_well_id uuid := gen_random_uuid();
  v_locator_id uuid := gen_random_uuid();
  v_train_id uuid := gen_random_uuid();
  v_product_meter_id uuid := gen_random_uuid();
  v_operator_id uuid := gen_random_uuid();
  v_manager_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
BEGIN
  -- 1. Create a test plant
  INSERT INTO public.plants (
    id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid
  ) VALUES (
    v_plant_id,
    'E2E Test Plant',
    'Active',
    1,
    100,
    'independent',
    'AFM',
    'Cartridge Filter',
    false,
    true
  );

  -- 2. Create a well
  INSERT INTO public.wells (
    id, plant_id, name, status, has_power_meter
  ) VALUES (
    v_well_id,
    v_plant_id,
    'E2E Test Well',
    'Active',
    false
  );

  -- 3. Create a locator
  INSERT INTO public.locators (
    id, plant_id, name, status, default_input_mode
  ) VALUES (
    v_locator_id,
    v_plant_id,
    'E2E Test Locator',
    'Active',
    'cumulative'
  );

  -- 4. Create an RO train
  INSERT INTO public.ro_trains (
    id, plant_id, train_number, name, status,
    num_afm, num_booster_pumps, num_hp_pumps,
    num_cartridge_filters, num_filter_housings, num_controllers
  ) VALUES (
    v_train_id,
    v_plant_id,
    1,
    'Train 1',
    'Running',
    0, 1, 1, 1, 1, 1
  );

  -- 5. Create a product meter
  INSERT INTO public.product_meters (
    id, plant_id, name, meter_type, is_derived
  ) VALUES (
    v_product_meter_id,
    v_plant_id,
    'E2E Product Meter',
    'Product',
    false
  );

  -- 6. Create auth users (these will be linked to profiles)
  -- Note: auth.users is managed by Supabase Auth, but we can insert directly
  -- for local testing. The password is handled by Supabase Auth.
  -- We'll use the email/password auth flow in tests.
  
  -- Store test user IDs for reference
  CREATE TEMP TABLE IF NOT EXISTS _e2e_test_users (
    role text,
    user_id uuid,
    email text,
    plant_id uuid
  );
  
  INSERT INTO _e2e_test_users VALUES
    ('Operator', v_operator_id, 'e2e-operator@test.local', v_plant_id),
    ('Manager', v_manager_id, 'e2e-manager@test.local', v_plant_id),
    ('Admin', v_admin_id, 'e2e-admin@test.local', v_plant_id);

  -- 7. Create user_profiles (these are created by the trigger on auth.users insert,
  -- but we can pre-create them for local testing)
  INSERT INTO public.user_profiles (id, email, first_name, last_name, plant_assignments, status, profile_complete, confirmed)
  VALUES
    (v_operator_id, 'e2e-operator@test.local', 'E2E', 'Operator', ARRAY[v_plant_id], 'Active', true, true),
    (v_manager_id, 'e2e-manager@test.local', 'E2E', 'Manager', ARRAY[v_plant_id], 'Active', true, true),
    (v_admin_id, 'e2e-admin@test.local', 'E2E', 'Admin', ARRAY[v_plant_id], 'Active', true, true);

  -- 8. Assign roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES
    (v_operator_id, 'Operator'),
    (v_manager_id, 'Manager'),
    (v_admin_id, 'Admin');

  -- 9. Create sample well reading (for testing reading history)
  INSERT INTO public.well_readings (
    well_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, recorded_by
  ) VALUES (
    v_well_id, v_plant_id, now() - interval '1 day', 1000, 900, 100, v_operator_id
  );

  -- 10. Create sample locator reading
  INSERT INTO public.locator_readings (
    locator_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, recorded_by
  ) VALUES (
    v_locator_id, v_plant_id, now() - interval '1 day', 5000, 4900, 100, v_operator_id
  );

  -- 11. Create sample RO train reading
  INSERT INTO public.ro_train_readings (
    train_id, plant_id, reading_datetime,
    feed_flow_m3h, permeate_flow_m3h, reject_flow_m3h,
    feed_pressure_psi, permeate_pressure_psi, reject_pressure_psi,
    feed_conductivity, permeate_conductivity, reject_conductivity,
    feed_ph, permeate_ph, reject_ph,
    recorded_by
  ) VALUES (
    v_train_id, v_plant_id, now() - interval '1 hour',
    100, 80, 20,
    150, 20, 140,
    500, 50, 1000,
    7.5, 7.2, 7.8,
    v_operator_id
  );

  RAISE NOTICE 'E2E test data seeded successfully:';
  RAISE NOTICE '  Plant ID: %', v_plant_id;
  RAISE NOTICE '  Well ID: %', v_well_id;
  RAISE NOTICE '  Locator ID: %', v_locator_id;
  RAISE NOTICE '  Train ID: %', v_train_id;
  RAISE NOTICE '  Product Meter ID: %', v_product_meter_id;
  RAISE NOTICE '  Operator ID: %', v_operator_id;
  RAISE NOTICE '  Manager ID: %', v_manager_id;
  RAISE NOTICE '  Admin ID: %', v_admin_id;
END $$;

-- Create a correction request for testing data correction approval
DO $$
DECLARE
  v_plant_id uuid;
  v_operator_id uuid;
  v_correction_id uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_plant_id FROM public.plants WHERE name = 'E2E Test Plant' LIMIT 1;
  SELECT id INTO v_operator_id FROM _e2e_test_users WHERE role = 'Operator' LIMIT 1;
  
  IF v_plant_id IS NOT NULL AND v_operator_id IS NOT NULL THEN
    INSERT INTO public.correction_requests (
      id, plant_id, entity_type, entity_id, field_name,
      current_value, proposed_value, reason, status, requested_by
    ) VALUES (
      v_correction_id, v_plant_id, 'well_reading', 
      (SELECT id FROM public.well_readings WHERE plant_id = v_plant_id LIMIT 1),
      'current_reading', '1000', '1050', 'E2E test correction', 'pending', v_operator_id
    );
    
    RAISE NOTICE 'Created test correction request: %', v_correction_id;
  END IF;
END $$;

-- Output summary
SELECT 'E2E test data seeding complete. Test users:' as info;
SELECT role, user_id, email FROM _e2e_test_users;