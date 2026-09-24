-- =============================================================================
-- E2E Test Data Seed
-- Seeds the local Supabase instance with test users and data for Playwright E2E tests
-- Run with: psql -h localhost -p 54322 -U postgres -d postgres -f e2e-seed.sql
-- =============================================================================

-- Run as the migration role (bypasses RLS)
SET search_path = public, extensions, auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create test plants and entities
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
    'raw'
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

  -- 5. Create a product meter (no meter_type column)
  INSERT INTO public.product_meters (
    id, plant_id, name, is_derived
  ) VALUES (
    v_product_meter_id,
    v_plant_id,
    'E2E Product Meter',
    false
  );

  -- 6. Store test user IDs for reference
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

  -- 7. Insert into auth.users and auth.identities
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  SELECT '00000000-0000-0000-0000-000000000000', t.user_id, 'authenticated', 'authenticated',
         t.email, extensions.crypt('testpassword123', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
         '', '', '', ''
  FROM _e2e_test_users t;

  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  SELECT gen_random_uuid(), t.user_id, t.user_id::text, 'email',
         jsonb_build_object('sub', t.user_id::text, 'email', t.email, 'email_verified', true),
         now(), now(), now()
  FROM _e2e_test_users t;

  -- 8. Create user_profiles
  INSERT INTO public.user_profiles (id, email, first_name, last_name, plant_assignments, status, profile_complete, confirmed)
  VALUES
    (v_operator_id, 'e2e-operator@test.local', 'E2E', 'Operator', ARRAY[v_plant_id], 'Active', true, true),
    (v_manager_id, 'e2e-manager@test.local', 'E2E', 'Manager', ARRAY[v_plant_id], 'Active', true, true),
    (v_admin_id, 'e2e-admin@test.local', 'E2E', 'Admin', ARRAY[v_plant_id], 'Active', true, true);

  -- 9. Assign roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES
    (v_operator_id, 'Operator'),
    (v_manager_id, 'Manager'),
    (v_admin_id, 'Admin');

  -- 10. Create sample well reading
  INSERT INTO public.well_readings (
    well_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, recorded_by
  ) VALUES (
    v_well_id, v_plant_id, now() - interval '1 day', 1000, 900, 100, v_operator_id
  );

  -- 11. Create sample locator reading
  INSERT INTO public.locator_readings (
    locator_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, recorded_by
  ) VALUES (
    v_locator_id, v_plant_id, now() - interval '1 day', 5000, 4900, 100, v_operator_id
  );

  -- 12. Create sample RO train reading (matching real schema columns)
  INSERT INTO public.ro_train_readings (
    train_id, plant_id, reading_datetime,
    feed_flow, permeate_flow, reject_flow,
    feed_pressure_psi, reject_pressure_psi,
    feed_tds, permeate_tds, reject_tds,
    feed_ph, permeate_ph, reject_ph,
    recorded_by
  ) VALUES (
    v_train_id, v_plant_id, now() - interval '1 hour',
    100, 80, 20,
    150, 140,
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
  v_well_reading_id uuid;
  v_correction_id uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_plant_id FROM public.plants WHERE name = 'E2E Test Plant' LIMIT 1;
  SELECT user_id INTO v_operator_id FROM _e2e_test_users WHERE role = 'Operator' LIMIT 1;
  SELECT id INTO v_well_reading_id FROM public.well_readings WHERE plant_id = v_plant_id LIMIT 1;
  
  IF v_plant_id IS NOT NULL AND v_operator_id IS NOT NULL AND v_well_reading_id IS NOT NULL THEN
    INSERT INTO public.correction_requests (
      id, plant_id, source_table, source_id,
      original_value, proposed_value, reason, status, submitted_by
    ) VALUES (
      v_correction_id, v_plant_id, 'well_readings', 
      v_well_reading_id,
      1000, 1050, 'E2E test correction', 'pending', v_operator_id
    );
    
    RAISE NOTICE 'Created test correction request: %', v_correction_id;
  END IF;
END $$;

-- Output summary
SELECT 'E2E test data seeding complete. Test users:' as info;
SELECT role, user_id, email FROM _e2e_test_users;