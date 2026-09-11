


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgtap" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_role" AS ENUM (
    'Operator',
    'Technician',
    'Manager',
    'Admin',
    'Data Analyst'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."frequency_type" AS ENUM (
    'Daily',
    'Weekly',
    'Monthly',
    'Quarterly',
    'Yearly'
);


ALTER TYPE "public"."frequency_type" OWNER TO "postgres";


CREATE TYPE "public"."incident_status" AS ENUM (
    'Open',
    'InProgress',
    'Resolved',
    'Closed'
);


ALTER TYPE "public"."incident_status" OWNER TO "postgres";


CREATE TYPE "public"."plant_status" AS ENUM (
    'Active',
    'Inactive'
);


ALTER TYPE "public"."plant_status" OWNER TO "postgres";


CREATE TYPE "public"."profile_status" AS ENUM (
    'Pending',
    'Active',
    'Suspended'
);


ALTER TYPE "public"."profile_status" OWNER TO "postgres";


CREATE TYPE "public"."reading_norm_action" AS ENUM (
    'tag',
    'normalize',
    'retract'
);


ALTER TYPE "public"."reading_norm_action" OWNER TO "postgres";


CREATE TYPE "public"."severity_level" AS ENUM (
    'Low',
    'Medium',
    'High',
    'Critical'
);


ALTER TYPE "public"."severity_level" OWNER TO "postgres";


CREATE TYPE "public"."train_status" AS ENUM (
    'Running',
    'Offline',
    'Maintenance'
);


ALTER TYPE "public"."train_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_user_password"("_user_id" "uuid", "_new_password" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- Guard: only callers with the Admin role may proceed
  if not exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = 'Admin'
  ) then
    raise exception 'Permission denied: Admin role required';
  end if;

  -- Update the hashed password in Supabase's internal auth schema
  update auth.users
  set encrypted_password = crypt(_new_password, gen_salt('bf'))
  where id = _user_id;

  if not found then
    raise exception 'User not found: %', _user_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."admin_set_user_password"("_user_id" "uuid", "_new_password" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "username" "text",
    "first_name" "text",
    "middle_name" "text",
    "last_name" "text",
    "suffix" "text",
    "designation" "text",
    "immediate_head_id" "uuid",
    "plant_assignments" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "status" "public"."profile_status" DEFAULT 'Pending'::"public"."profile_status" NOT NULL,
    "profile_complete" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed" boolean DEFAULT false NOT NULL,
    "last_seen_at" timestamp with time zone,
    "email" "text"
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profiles"."confirmed" IS 'Admin approval flag. New signups land at FALSE; Admin must call approve_user() (or set the column directly) to unlock the app.';



CREATE OR REPLACE FUNCTION "public"."approve_user"("_user_id" "uuid", "_approve" boolean DEFAULT true) RETURNS "public"."user_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."approve_user"("_user_id" "uuid", "_approve" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_well_deltas"() RETURNS TABLE("well_id" "uuid", "rows_fixed" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  rec RECORD; prev_reading NUMERIC := NULL; cur_well UUID := NULL; fixed_count INT := 0; new_dv NUMERIC;
BEGIN
  FOR rec IN SELECT id, well_id AS wid, current_reading, previous_reading, daily_volume, is_meter_replacement, reading_datetime
    FROM public.well_readings ORDER BY well_id, reading_datetime ASC
  LOOP
    IF rec.wid IS DISTINCT FROM cur_well THEN cur_well := rec.wid; prev_reading := NULL; fixed_count := 0; END IF;
    IF rec.is_meter_replacement IS TRUE THEN prev_reading := NULL; CONTINUE; END IF;
    IF prev_reading IS NOT NULL THEN
      IF rec.daily_volume IS NULL THEN new_dv := GREATEST(0, rec.current_reading - prev_reading);
      ELSIF ABS(rec.daily_volume - GREATEST(0, rec.current_reading - COALESCE(rec.previous_reading, prev_reading))) < 0.01 THEN
        new_dv := GREATEST(0, rec.current_reading - prev_reading);
      ELSE new_dv := rec.daily_volume; END IF;
      UPDATE public.well_readings SET previous_reading = prev_reading, daily_volume = new_dv
       WHERE id = rec.id AND (previous_reading IS DISTINCT FROM prev_reading OR daily_volume IS DISTINCT FROM new_dv);
      IF FOUND THEN fixed_count := fixed_count + 1; END IF;
    END IF;
    IF rec.current_reading IS NOT NULL THEN prev_reading := rec.current_reading; END IF;
  END LOOP;
  FOR rec IN SELECT DISTINCT well_id AS wid FROM public.well_readings LOOP
    well_id := rec.wid; rows_fixed := fixed_count; RETURN NEXT;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."backfill_well_deltas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.chat_audit_log (sender_id, recipient_id, sent_at)
  values (NEW.sender_id, NEW.recipient_id, NEW.sent_at);
  return NEW;
end;
$$;


ALTER FUNCTION "public"."chat_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_onboarding"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text", "_plant_assignments" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."complete_onboarding"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text", "_plant_assignments" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auto_lock_on_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.norm_status = 'pending_review'
     AND NEW.norm_status IN ('normal', 'normalized')
     AND NEW.locked_at IS NULL
  THEN
    NEW.locked_at := NOW();
    NEW.locked_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_auto_lock_on_approval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_backfill_missing_readings"("p_date" "date" DEFAULT (("now"() AT TIME ZONE 'Asia/Manila'::"text"))::"date", "p_lookback_days" integer DEFAULT 7) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "TimeZone" TO 'Asia/Manila'
    AS $$
DECLARE
  v_lookback        integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end      date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start    date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count     integer := 0;
  v_skipped_count   integer := 0;
  v_retracted_count integer := 0;
  v_purged_count    integer := 0;
  v_purged_total    integer;

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

  -- Hardening (2026-09-02): per-module isolation. Each module — including the
  -- orphan-purge step — runs inside its own BEGIN/EXCEPTION block, which
  -- PL/pgSQL implements as an implicit SAVEPOINT. An unhandled error in one
  -- module rolls back only that module's own writes and its own
  -- module-scoped counters below, instead of the entire function call, so
  -- the other modules' work is preserved and committed. See v_module_errors
  -- in the return value for what failed and why.
  v_mod_swept       integer;
  v_mod_skipped     integer;
  v_mod_retracted   integer;
  v_module_errors   jsonb := '[]'::jsonb;
BEGIN

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 0: PURGE ORPHANED ESTIMATED ROWS
  -- ───────────────────────────────────────────────────────────────────────────
  -- Timezone fix (2026-09-02): reading_datetime::date truncates in the
  -- session's default timezone (UTC on Supabase), so an early-morning
  -- Asia/Manila reading (e.g. 07:22 AM PHT = 23:22 the PRIOR day in UTC)
  -- was bucketed onto the wrong calendar day. That made the sweep below
  -- believe a day had no reading at all when a real one already existed a
  -- few hours earlier in local time, producing a duplicate estimated row
  -- alongside the real one (and, since the estimate was interpolated from
  -- older data, sometimes a lower value than the real reading next to it —
  -- which is what produced the negative "Production" deltas in the UI).
  -- This module removes any pre-existing estimated row that shares an
  -- Asia/Manila calendar date with a real (is_estimated = false) row for
  -- the same entity, on every run, so historical orphans and any that slip
  -- through in the future both get cleaned up automatically.
  v_mod_retracted := 0;
  BEGIN
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.locator_readings r
        WHERE r.locator_id = e.locator_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_mod_retracted := v_mod_retracted + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.well_readings r
        WHERE r.well_id = e.well_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_mod_retracted := v_mod_retracted + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.product_meter_readings r
        WHERE r.meter_id = e.meter_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_mod_retracted := v_mod_retracted + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.blending_events r
        WHERE r.well_id = e.well_id
          AND COALESCE(r.is_estimated, false) = false
          AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_mod_retracted := v_mod_retracted + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.power_readings r
        WHERE r.plant_id = e.plant_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_mod_retracted := v_mod_retracted + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.ro_train_readings r
        WHERE r.train_id = e.train_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_mod_retracted := v_mod_retracted + v_purged_count;

  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'purge_orphans', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  -- ─── Gap-fill thresholds ─────────────────────────────────────────────────────
  --   SQL literal 5   ↔  EVEN_SPLIT_THRESHOLD_DAYS = 5
  --   SQL literal 14  ↔  MAX_GAP_BACKFILL_DAYS = 14
  -- ─────────────────────────────────────────────────────────────────────────────

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  v_mod_swept := 0; v_mod_skipped := 0; v_mod_retracted := 0;
  BEGIN
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
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
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
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

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_mod_retracted := v_mod_retracted + 1;
                  END IF;
                  v_mod_skipped := v_mod_skipped + 1;
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
                    v_mod_swept := v_mod_swept + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_mod_swept := v_mod_swept + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_swept_count := v_swept_count + v_mod_swept;
  v_skipped_count := v_skipped_count + v_mod_skipped;
  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'locators', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  v_mod_swept := 0; v_mod_skipped := 0; v_mod_retracted := 0;
  BEGIN
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
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

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_mod_retracted := v_mod_retracted + 1;
                  END IF;
                  v_mod_skipped := v_mod_skipped + 1;
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
                    v_mod_swept := v_mod_swept + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_mod_swept := v_mod_swept + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_swept_count := v_swept_count + v_mod_swept;
  v_skipped_count := v_skipped_count + v_mod_skipped;
  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'wells', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  v_mod_swept := 0; v_mod_skipped := 0; v_mod_retracted := 0;
  BEGIN
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
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

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_mod_retracted := v_mod_retracted + 1;
                  END IF;
                  v_mod_skipped := v_mod_skipped + 1;
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
                    v_mod_swept := v_mod_swept + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_mod_swept := v_mod_swept + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_swept_count := v_swept_count + v_mod_swept;
  v_skipped_count := v_skipped_count + v_mod_skipped;
  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'product_meters', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  v_mod_swept := 0; v_mod_skipped := 0; v_mod_retracted := 0;
  BEGIN
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
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

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_mod_retracted := v_mod_retracted + 1;
                  END IF;
                  v_mod_skipped := v_mod_skipped + 1;
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
                    v_mod_swept := v_mod_swept + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_mod_swept := v_mod_swept + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_swept_count := v_swept_count + v_mod_swept;
  v_skipped_count := v_skipped_count + v_mod_skipped;
  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'blending', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  v_mod_swept := 0; v_mod_skipped := 0; v_mod_retracted := 0;
  BEGIN
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
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

                SELECT id, is_estimated, meter_reading_kwh INTO v_existing_id, v_is_est, v_old_val
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.power_readings WHERE id = v_existing_id;
                    v_mod_retracted := v_mod_retracted + 1;
                  END IF;
                  v_mod_skipped := v_mod_skipped + 1;
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
                    v_mod_swept := v_mod_swept + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val, daily_consumption_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_mod_swept := v_mod_swept + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_swept_count := v_swept_count + v_mod_swept;
  v_skipped_count := v_skipped_count + v_mod_skipped;
  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'power', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  v_mod_swept := 0; v_mod_skipped := 0; v_mod_retracted := 0;
  BEGIN
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
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

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_mod_retracted := v_mod_retracted + 1;
                  END IF;
                  v_mod_skipped := v_mod_skipped + 1;
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
                    v_mod_swept := v_mod_swept + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_mod_swept := v_mod_swept + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  v_swept_count := v_swept_count + v_mod_swept;
  v_skipped_count := v_skipped_count + v_mod_skipped;
  v_retracted_count := v_retracted_count + v_mod_retracted;
  EXCEPTION WHEN OTHERS THEN
    v_module_errors := v_module_errors || jsonb_build_object('module', 'ro_trains', 'sqlstate', SQLSTATE, 'message', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count,
    'has_errors', jsonb_array_length(v_module_errors) > 0,
    'errors', v_module_errors
  );
END;
$$;


ALTER FUNCTION "public"."fn_backfill_missing_readings"("p_date" "date", "p_lookback_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_blending_set_reading"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_blending_set_reading"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_blending_upsert_reading"("p_well_id" "uuid", "p_plant_id" "uuid", "p_well_name" "text", "p_plant_name" "text", "p_event_date" "date", "p_reading_datetime" timestamp with time zone, "p_raw_meter_reading" numeric, "p_previous_reading" numeric DEFAULT NULL::numeric, "p_update_previous_reading" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_blending_upsert_reading"("p_well_id" "uuid", "p_plant_id" "uuid", "p_well_name" "text", "p_plant_name" "text", "p_event_date" "date", "p_reading_datetime" timestamp with time zone, "p_raw_meter_reading" numeric, "p_previous_reading" numeric, "p_update_previous_reading" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cascade_reading_correction"("p_table" "text", "p_row_id" "uuid", "p_new_current" numeric, "p_admin_id" "uuid", "p_reason" "text" DEFAULT 'Admin correction'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_entity_col  TEXT;
  v_entity_id   UUID;
  v_plant_id    UUID;
  v_read_dt     TIMESTAMPTZ;
  v_old_current NUMERIC;
  v_old_prev    NUMERIC;
  v_next_id     UUID;
  v_next_curr   NUMERIC;
BEGIN
  v_entity_col := CASE p_table
    WHEN 'locator_readings'       THEN 'locator_id'
    WHEN 'well_readings'          THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
    ELSE NULL
  END;
  IF v_entity_col IS NULL THEN
    RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  EXECUTE format(
    'SELECT %I, plant_id, reading_datetime, current_reading, previous_reading FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_entity_id, v_plant_id, v_read_dt, v_old_current, v_old_prev
  USING p_row_id;

  INSERT INTO raw_edit_log (source_table, source_id, column_name, old_value, new_value, edited_by, edited_role)
  VALUES (p_table, p_row_id, 'current_reading', v_old_current, p_new_current, p_admin_id, 'Admin');

  EXECUTE format(
    'UPDATE %I SET current_reading = $1, daily_volume = $1 - COALESCE(previous_reading,0), norm_status = ''normalized'' WHERE id = $2',
    p_table
  ) USING p_new_current, p_row_id;

  EXECUTE format(
    'SELECT id, current_reading FROM %I WHERE %I = $1 AND plant_id = $2 AND reading_datetime > $3 AND norm_status NOT IN (''retracted'') ORDER BY reading_datetime ASC LIMIT 1',
    p_table, v_entity_col
  ) INTO v_next_id, v_next_curr USING v_entity_id, v_plant_id, v_read_dt;

  IF v_next_id IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I SET previous_reading = $1, daily_volume = current_reading - $1 WHERE id = $2',
      p_table
    ) USING p_new_current, v_next_id;
  END IF;

  INSERT INTO reading_normalizations (source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role)
  VALUES (p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason, p_admin_id, 'Admin');

  RETURN jsonb_build_object('updated_id', p_row_id, 'old_value', v_old_current, 'new_value', p_new_current, 'cascade_id', v_next_id);
END;
$_$;


ALTER FUNCTION "public"."fn_cascade_reading_correction"("p_table" "text", "p_row_id" "uuid", "p_new_current" numeric, "p_admin_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.daily_plant_summary (plant_id, summary_date, blending_m3, source)
  SELECT
    p.id,
    p_date,
    COALESCE(be.total_m3, 0),
    'fn_compute_daily_plant_summary'
  FROM public.plants p
  LEFT JOIN (
    SELECT plant_id, SUM(volume_m3) AS total_m3
    FROM public.blending_events
    WHERE event_date = p_date
    GROUP BY plant_id
  ) be ON be.plant_id = p.id
  WHERE p.status = 'Active'
  ON CONFLICT (plant_id, summary_date)
  DO UPDATE SET
    blending_m3 = EXCLUDED.blending_m3;
  -- updated_at is set automatically by trg_dps_updated

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'plants_processed', v_count
  );
END;
$$;


ALTER FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") IS 'Nightly rollup called by .github/workflows/nightly-summary.yml. Currently populates daily_plant_summary.blending_m3 from blending_events only — see comments above for scope.';



CREATE OR REPLACE FUNCTION "public"."fn_filter_unit_price"("p_plant_id" "uuid", "p_housing_type" "text", "p_as_of" "date") RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  SELECT unit_price
  FROM filter_unit_prices
  WHERE plant_id = p_plant_id
    AND filter_housing_type = p_housing_type
    AND effective_from <= p_as_of
  ORDER BY effective_from DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."fn_filter_unit_price"("p_plant_id" "uuid", "p_housing_type" "text", "p_as_of" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_flag_derived_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_flag_derived_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_force_direct_mode_when_derived"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.is_derived THEN
    NEW.default_input_mode := 'direct';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_force_direct_mode_when_derived"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_force_direct_mode_when_derived"() IS 'BEFORE INSERT/UPDATE guard on locators: a derived (no-physical-meter) row can never be saved with default_input_mode = ''raw''. See Phase 6 header comment (20260730_hamas_phase6_default_input_mode_guard.sql) for the bug this closes. Deliberately one-directional — does not reset the mode back to ''raw'' when is_derived is turned off; the app layer handles that.';



CREATE OR REPLACE FUNCTION "public"."fn_guard_custom_role_override"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.module_key IN ('admin_users', 'admin_migrations') THEN
    RAISE EXCEPTION
      'admin_users and admin_migrations cannot be overridden by a custom role (Admin-only, to prevent accidental lockout)';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_guard_custom_role_override"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_locator_cooldown_minutes"("p_locator_id" "uuid", "p_plant_id" "uuid", "p_user_id" "uuid", "p_cooldown" integer DEFAULT 45) RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_last_dt TIMESTAMPTZ;
  v_elapsed INT;
BEGIN
  SELECT reading_datetime
  INTO   v_last_dt
  FROM   locator_readings
  WHERE  locator_id  = p_locator_id
    AND  plant_id    = p_plant_id
    AND  recorded_by = p_user_id
    AND  norm_status NOT IN ('retracted')
  ORDER  BY reading_datetime DESC
  LIMIT  1;
 
  IF v_last_dt IS NULL THEN RETURN 0; END IF;
 
  v_elapsed := EXTRACT(EPOCH FROM (NOW() - v_last_dt)) / 60;
  RETURN GREATEST(0, p_cooldown - v_elapsed);
END;
$$;


ALTER FUNCTION "public"."fn_locator_cooldown_minutes"("p_locator_id" "uuid", "p_plant_id" "uuid", "p_user_id" "uuid", "p_cooldown" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_locator_reading_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
  v_is_derived      BOOLEAN;
  v_reviewer_resolving BOOLEAN;
BEGIN
  v_reviewer_resolving := (
    TG_OP = 'UPDATE'
    AND OLD.norm_status = 'pending_review'
    AND NEW.norm_status = 'normal'
    AND OLD.current_reading = NEW.current_reading
  );

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

  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' AND NOT v_reviewer_resolving THEN
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
     AND NOT v_reviewer_resolving
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
         AND NOT v_reviewer_resolving
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_locator_reading_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") RETURNS TABLE("plant_id" "uuid", "plant_name" "text", "manager_ids" "uuid"[], "manager_names" "text"[], "wells_completeness_pct" numeric, "locators_completeness_pct" numeric, "trains_completeness_pct" numeric, "meters_completeness_pct" numeric, "power_completeness_pct" numeric, "chemicals_completeness_pct" numeric, "overall_completeness_pct" numeric, "readings_in_window" integer, "flagged_in_window" integer, "error_rate_pct" numeric, "unexplained_gaps_in_window" integer, "open_pending_review_count" integer, "open_pending_review_oldest_days" integer, "open_correction_count" integer, "open_correction_oldest_days" integer, "status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
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


ALTER FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") IS 'Per-plant data-quality oversight rollup (completeness, unexplained gaps, flagged/error rate, open corrections) attributed to each plant''s assigned Manager(s). Admin/Data Analyst see all plants; Manager sees only their own plant_assignments. Call via supabase.rpc(''fn_manager_plant_scorecard'', { p_from, p_to }).';



CREATE OR REPLACE FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text") IS 'Fans out a notification to every Active Admin/Manager/Data Analyst with access to a derived locator''s plant. Called from the Phase 3 staleness trigger (_kind=stale) and the Phase 2 sweep function (_kind=superseded).';



CREATE OR REPLACE FUNCTION "public"."fn_notify_operator_on_resolution"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_plant_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NEW.submitted_by IS NOT NULL THEN
    SELECT name INTO v_plant_name FROM plants WHERE id = NEW.plant_id;
    INSERT INTO notifications (
      user_id, title, message, link_path,
      alert_type, severity, read, plant_id
    ) VALUES (
      NEW.submitted_by,
      CASE NEW.status WHEN 'approved' THEN 'Correction approved' ELSE 'Correction rejected' END || ' — ' || v_plant_name,
      CASE NEW.status
        WHEN 'approved' THEN 'Your correction request was approved. The reading has been updated.'
        ELSE 'Your correction request was not approved. ' || COALESCE(NEW.resolution_note, 'No reason provided.')
      END,
      '/operations',
      'correction_resolved',
      CASE NEW.status WHEN 'approved' THEN 'info' ELSE 'warning' END,
      FALSE,
      NEW.plant_id
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_notify_operator_on_resolution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() IS 'Notifies the operator who submitted a correction_requests row when a supervisor rejects it, including resolution_note (the required rejection reason) in the notification body. Scoped narrowly to the pending→rejected transition so it cannot double-fire alongside whatever already handles the approved case.';



CREATE OR REPLACE FUNCTION "public"."fn_notify_supervisors_on_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_plant_name TEXT;
  v_submitter  TEXT;
  v_sup_id     UUID;
BEGIN
  SELECT name INTO v_plant_name FROM plants WHERE id = NEW.plant_id;
  SELECT COALESCE(first_name || ' ' || last_name, email, 'An operator')
  INTO   v_submitter
  FROM   user_profiles WHERE id = NEW.submitted_by;

  -- Notify every Manager/Admin who has this plant in their assignments
  FOR v_sup_id IN
    SELECT up.id
    FROM   user_profiles up
    JOIN   user_roles ur ON ur.user_id = up.id
    WHERE  ur.role IN ('Admin', 'Manager')
      AND  (up.plant_assignments @> ARRAY[NEW.plant_id::text] OR ur.role = 'Admin')
      AND  up.id IS DISTINCT FROM NEW.submitted_by
  LOOP
    INSERT INTO notifications (
      user_id, title, message, link_path,
      alert_type, severity, read, plant_id
    ) VALUES (
      v_sup_id,
      'Correction request — ' || v_plant_name,
      v_submitter || ' requested a correction on a ' ||
        REPLACE(NEW.source_table, '_readings', '') || ' reading. ' ||
        'Original: ' || NEW.original_value || ', Proposed: ' || NEW.proposed_value || '. ' ||
        'Reason: ' || NEW.reason,
      '/data-corrections',
      'correction_request',
      'warning',
      FALSE,
      NEW.plant_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_notify_supervisors_on_request"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_power_readings_after_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE v_successor_id uuid;
BEGIN
  IF COALESCE(current_setting('app.power_trigger_running', TRUE), 'false') = 'true' THEN RETURN OLD; END IF;
  PERFORM set_config('app.power_trigger_running', 'true', TRUE);
  BEGIN
    SELECT id INTO v_successor_id FROM public.power_readings
     WHERE plant_id = OLD.plant_id AND reading_datetime > OLD.reading_datetime
       AND NOT COALESCE(is_meter_replacement, FALSE)
     ORDER BY reading_datetime ASC LIMIT 1;
    IF FOUND THEN PERFORM public._recompute_power_row(v_successor_id); END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('app.power_trigger_running', 'false', TRUE);
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."fn_power_readings_after_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_power_readings_before_upsert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_multipliers numeric[];
  v_prev        record;
  v_total       numeric := 0;
  v_found_delta boolean := false;
  slot_key      text;
  slot_curr     numeric;
  slot_prev     numeric;
  slot_idx      int;
  slot_mult     numeric;
  v_delta       numeric;
begin
  if coalesce(new.is_meter_replacement, false) then
    new.daily_consumption_kwh := 0;
    new.daily_grid_kwh := 0;
    return new;
  end if;

  select coalesce(grid_meter_multipliers, array[1::numeric])
    into v_multipliers
  from public.plant_power_config
  where plant_id = new.plant_id;
  if v_multipliers is null then
    v_multipliers := array[1::numeric];
  end if;

  select meter_reading_kwh, grid_meter_readings
    into v_prev
  from public.power_readings
  where plant_id = new.plant_id
    and reading_datetime < new.reading_datetime
    and (TG_OP = 'INSERT' or id <> new.id)
  order by reading_datetime desc
  limit 1;

  if not found then
    return new;
  end if;

  if new.grid_meter_readings is not null and jsonb_typeof(new.grid_meter_readings) = 'object'
     and v_prev.grid_meter_readings is not null and jsonb_typeof(v_prev.grid_meter_readings) = 'object' then
    for slot_key in select jsonb_object_keys(new.grid_meter_readings) loop
      slot_curr := (new.grid_meter_readings ->> slot_key)::numeric;
      slot_prev := (v_prev.grid_meter_readings ->> slot_key)::numeric;
      if slot_curr is not null and slot_prev is not null and (slot_curr - slot_prev) >= 0 then
        slot_idx := slot_key::int + 1;
        slot_mult := coalesce(v_multipliers[slot_idx], v_multipliers[1], 1);
        v_total := v_total + (slot_curr - slot_prev) * slot_mult;
        v_found_delta := true;
      end if;
    end loop;
  elsif new.meter_reading_kwh is not null and v_prev.meter_reading_kwh is not null then
    v_delta := new.meter_reading_kwh - v_prev.meter_reading_kwh;
    if v_delta >= 0 then
      v_total := v_delta * coalesce(v_multipliers[1], 1);
      v_found_delta := true;
    end if;
  end if;

  if v_found_delta then
    new.daily_consumption_kwh := v_total;
    new.daily_grid_kwh := v_total;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_power_readings_before_upsert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_product_meter_reading_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_is_derived    BOOLEAN;
  v_reviewer_resolving BOOLEAN;
BEGIN
  v_reviewer_resolving := (
    TG_OP = 'UPDATE'
    AND OLD.norm_status = 'pending_review'
    AND NEW.norm_status = 'normal'
    AND OLD.current_reading = NEW.current_reading
  );

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
     AND NOT v_reviewer_resolving
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

        IF v_avg_flow_rate IS NOT NULL AND v_flow_rate > v_avg_flow_rate * 2.0 AND NEW.norm_status = 'normal' AND NOT v_reviewer_resolving THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_product_meter_reading_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_recalc_power_cache"("p_plant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_multipliers numeric[]; rec record;
  prev_meter_kwh numeric := NULL; prev_gmr jsonb := NULL; after_repl boolean := false;
  delta_raw numeric; total_kwh numeric; slot_key text;
  slot_curr numeric; slot_prev numeric; slot_mult numeric; slot_idx int;
BEGIN
  SELECT COALESCE(grid_meter_multipliers, ARRAY[1::numeric]) INTO v_multipliers
    FROM public.plant_power_config WHERE plant_id = p_plant_id;
  IF v_multipliers IS NULL THEN v_multipliers := ARRAY[1::numeric]; END IF;
  FOR rec IN SELECT id, reading_datetime, meter_reading_kwh, grid_meter_readings, is_meter_replacement
    FROM public.power_readings WHERE plant_id = p_plant_id ORDER BY reading_datetime ASC
  LOOP
    IF rec.is_meter_replacement THEN
      prev_meter_kwh := rec.meter_reading_kwh; prev_gmr := rec.grid_meter_readings; after_repl := true;
      UPDATE public.power_readings SET daily_grid_kwh = 0, daily_consumption_kwh = 0, cache_recalculated_at = NOW() WHERE id = rec.id;
      CONTINUE;
    END IF;
    total_kwh := NULL;
    IF NOT after_repl THEN
      IF rec.grid_meter_readings IS NOT NULL AND jsonb_typeof(rec.grid_meter_readings) = 'object'
         AND prev_gmr IS NOT NULL AND jsonb_typeof(prev_gmr) = 'object' THEN
        total_kwh := 0;
        FOR slot_key IN SELECT jsonb_object_keys(rec.grid_meter_readings) LOOP
          slot_curr := (rec.grid_meter_readings ->> slot_key)::numeric;
          slot_prev := (prev_gmr ->> slot_key)::numeric;
          IF slot_curr IS NOT NULL AND slot_prev IS NOT NULL AND (slot_curr - slot_prev) >= 0 THEN
            slot_idx := slot_key::int + 1;
            slot_mult := COALESCE(v_multipliers[slot_idx], v_multipliers[1], 1);
            total_kwh := total_kwh + (slot_curr - slot_prev) * slot_mult;
          ELSE total_kwh := NULL; EXIT; END IF;
        END LOOP;
      END IF;
      IF total_kwh IS NULL AND rec.meter_reading_kwh IS NOT NULL AND prev_meter_kwh IS NOT NULL
         AND (rec.meter_reading_kwh - prev_meter_kwh) >= 0 THEN
        delta_raw := rec.meter_reading_kwh - prev_meter_kwh;
        total_kwh := delta_raw * COALESCE(v_multipliers[1], 1);
      END IF;
    END IF;
    after_repl := false;
    IF total_kwh IS NOT NULL AND total_kwh >= 0 THEN
      UPDATE public.power_readings SET daily_grid_kwh = total_kwh, daily_consumption_kwh = total_kwh,
        cache_recalculated_at = NOW() WHERE id = rec.id;
    END IF;
    prev_meter_kwh := rec.meter_reading_kwh; prev_gmr := rec.grid_meter_readings;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_recalc_power_cache"("p_plant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_locator_daily_volume"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.daily_volume := CASE
    WHEN NEW.is_meter_rollover AND NEW.meter_rollover_max IS NOT NULL THEN
      GREATEST(0, (NEW.meter_rollover_max - COALESCE(NEW.previous_reading, 0)) + NEW.current_reading)
    ELSE
      GREATEST(0, NEW.current_reading - COALESCE(NEW.previous_reading, 0))
  END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_locator_daily_volume"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.product_meters
     SET derived_from_locator_id = p_derived_from_locator_id,
         is_derived              = TRUE
   WHERE id = p_meter_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_meters row % not found', p_meter_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") IS 'Sets a product meter as a mirror of a derived locator on another plant. SECURITY DEFINER because the target meter''s RLS policy (user_has_plant_access(plant_id)) may deny the caller — the whole point of cross-plant mirroring is that the admin configuring SRP''s locators doesn''t need separate access to Mambaling. Called from ProductMeters.tsx save().';



CREATE OR REPLACE FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date" DEFAULT NULL::"date", "p_lookback_days" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_end_date   date    := COALESCE(p_date, ((now() AT TIME ZONE 'Asia/Manila')::date - 1));
  v_lookback   integer := LEAST(GREATEST(COALESCE(p_lookback_days, 1), 1), 30); -- safety cap
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

  -- Plus: any date still carrying an OPEN "sibling/mother meter changed"
  -- flag, however old — e.g. a CSV import correcting a sibling reading from
  -- three weeks ago, outside the routine lookback window above.
  -- fn_sweep_derived_meters_for_date() only ever touches a (locator, date)
  -- pair that's either today or actually flagged for that locator (phase 7
  -- guard above), so sweeping these extra dates can't clobber an unrelated
  -- manual override sitting on some other untouched day. Capped at 90 dates
  -- per call as a safety valve against an unbounded loop.
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
$$;


ALTER FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date", "p_lookback_days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date", "p_lookback_days" integer) IS 'Recomputes residual volume (mother meter minus sibling locators) for every is_derived locator over a rolling lookback window, mirrors the result into any linked product_meters row, and notifies Admin/Manager/Data Analyst if a manual override gets superseded. Called on a schedule by .github/workflows/derived-meter-sweep.yml (service_role key as of 2026-08-17 -- see 20260817000000_sweep_function_revoke_anon.sql; anon was never actually restricted to the cron job, since the anon key ships in the public frontend bundle) and on demand by the "Recalculate now" button in Operations > Locator (authenticated session).';



CREATE OR REPLACE FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") IS 'Core single-date pass for the derived-locator residual sweep. Called by fn_sweep_derived_meters(); not normally invoked directly.';



CREATE OR REPLACE FUNCTION "public"."fn_sync_blending_reading_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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

  SELECT id, COALESCE(is_meter_replacement, FALSE), raw_meter_reading
    INTO v_successor_id, v_successor_repl, v_successor_raw
    FROM public.blending_events
   WHERE well_id = v_well_id
     AND (event_date > v_event_date
          OR (event_date = v_event_date AND reading_datetime IS NOT NULL
              AND v_reading_dt IS NOT NULL AND reading_datetime > v_reading_dt))
   ORDER BY event_date ASC, reading_datetime ASC NULLS LAST
   LIMIT 1;

  -- Skip legacy rows with no meter reading to diff against — leave their
  -- manually-set volume_m3 alone entirely.
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
$$;


ALTER FUNCTION "public"."fn_sync_blending_reading_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_derived_locator_mirror"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_sync_derived_locator_mirror"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_electric_bill_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
/*
  Called AFTER INSERT, UPDATE, or DELETE on electric_bills.

  On INSERT of bill B:
    • Set B.previous_reading from the predecessor bill's current_reading
      (predecessor = same plant, largest period_end < B.period_end).
    • Patch the successor bill's previous_reading = B.current_reading.

  On UPDATE (current_reading or period_end changed):
    • Re-derive B.previous_reading from its new predecessor.
    • Patch successor.

  On DELETE of bill B:
    • Heal successor: its new predecessor is B's predecessor.
      Successor.previous_reading := B.previous_reading.

  total_kwh (GENERATED column) recomputes automatically on each
  previous_reading change, so no explicit write is needed.
*/
DECLARE
  v_plant_id      UUID;
  v_period_end    DATE;
  v_pred_current  NUMERIC;
  v_succ_id       UUID;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_plant_id   := OLD.plant_id;
    v_period_end := OLD.period_end;
  ELSE
    v_plant_id   := NEW.plant_id;
    v_period_end := NEW.period_end;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): set previous_reading on the changed bill ────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT current_reading
      INTO v_pred_current
      FROM public.electric_bills
     WHERE plant_id   = v_plant_id
       AND period_end < v_period_end
     ORDER BY period_end DESC
     LIMIT 1;

    IF v_pred_current IS NOT NULL
       AND (NEW.previous_reading IS DISTINCT FROM v_pred_current) THEN
      UPDATE public.electric_bills
         SET previous_reading = v_pred_current
       WHERE id = NEW.id;
    END IF;

  END IF;

  -- ── Step 2: patch successor bill ──────────────────────────────────────────
  SELECT id
    INTO v_succ_id
    FROM public.electric_bills
   WHERE plant_id   = v_plant_id
     AND period_end > v_period_end
   ORDER BY period_end ASC
   LIMIT 1;

  IF v_succ_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      -- Successor's new predecessor is the bill before the deleted one.
      UPDATE public.electric_bills
         SET previous_reading = OLD.previous_reading
       WHERE id = v_succ_id;
    ELSE
      UPDATE public.electric_bills
         SET previous_reading = NEW.current_reading
       WHERE id = v_succ_id;
    END IF;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$$;


ALTER FUNCTION "public"."fn_sync_electric_bill_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_filter_cost_to_production_costs"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  k_plant uuid;
  k_date date;
BEGIN
  -- Recompute helper for a single (plant, date)
  -- implemented inline for simplicity
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    k_plant := NEW.plant_id;
    k_date := NEW.replacement_date;

    INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
    SELECT
      k_plant,
      k_date,
      COALESCE(SUM(fr.total_cost), 0)::numeric(14,2)
    FROM public.filter_replacements fr
    WHERE fr.plant_id = k_plant
      AND fr.replacement_date = k_date
    ON CONFLICT (plant_id, cost_date)
    DO UPDATE SET filter_cost = EXCLUDED.filter_cost;
  END IF;

  -- If UPDATE moved row to a different plant/date, recompute old bucket too
  IF TG_OP = 'UPDATE'
     AND (OLD.plant_id, OLD.replacement_date) IS DISTINCT FROM (NEW.plant_id, NEW.replacement_date) THEN
    k_plant := OLD.plant_id;
    k_date := OLD.replacement_date;

    INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
    SELECT
      k_plant,
      k_date,
      COALESCE(SUM(fr.total_cost), 0)::numeric(14,2)
    FROM public.filter_replacements fr
    WHERE fr.plant_id = k_plant
      AND fr.replacement_date = k_date
    ON CONFLICT (plant_id, cost_date)
    DO UPDATE SET filter_cost = EXCLUDED.filter_cost;
  END IF;

  -- DELETE must recompute old bucket
  IF TG_OP = 'DELETE' THEN
    k_plant := OLD.plant_id;
    k_date := OLD.replacement_date;

    INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
    SELECT
      k_plant,
      k_date,
      COALESCE(SUM(fr.total_cost), 0)::numeric(14,2)
    FROM public.filter_replacements fr
    WHERE fr.plant_id = k_plant
      AND fr.replacement_date = k_date
    ON CONFLICT (plant_id, cost_date)
    DO UPDATE SET filter_cost = EXCLUDED.filter_cost;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."fn_sync_filter_cost_to_production_costs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_filter_usage_cost"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  target_plant uuid := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  date := (COALESCE(NEW.reading_datetime, OLD.reading_datetime))::date;
  day_total    numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(
    CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
      WHEN 'Bag Filter' THEN
        r.bag_filters_changed * COALESCE(fn_filter_unit_price(p.id, 'Bag Filter', target_date), 0)
      ELSE
        r.cartridges_changed * COALESCE(fn_filter_unit_price(p.id, 'Cartridge Filter', target_date), 0)
    END
  ), 0)
  INTO day_total
  FROM ro_pretreatment_readings r
  JOIN plants p ON p.id = r.plant_id
  LEFT JOIN ro_trains rt ON rt.id = r.train_id
  WHERE r.plant_id = target_plant
    AND r.reading_datetime::date = target_date;

  INSERT INTO production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, day_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."fn_sync_filter_usage_cost"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_locator_reading_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_sync_locator_reading_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_permeate_is_production"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.permeate_is_production := COALESCE((NEW.config->>'permeate_is_production')::boolean, false);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_sync_permeate_is_production"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_product_meter_reading_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_sync_product_meter_reading_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_ro_train_reading_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
/*
  Called AFTER INSERT, UPDATE, or DELETE on ro_train_readings.

  Maintains permeate_meter_delta, feed_meter_delta, reject_meter_delta by
  computing (this row's meter) − (predecessor row's meter) for each gauge.

  NULL predecessor → delta = NULL (first reading; no baseline to subtract).
  Negative delta (meter rollover or replacement) → stored as-is; the
  frontend deltaCache.ts normalises negative values to 0 on display via
  `Math.max(0, delta)`.  Storing the raw signed value preserves the audit
  trail and allows rollover-detection logic later.
*/
DECLARE
  v_train_id     UUID;
  v_reading_dt   TIMESTAMPTZ;
  v_pred_perm    NUMERIC;
  v_pred_feed    NUMERIC;
  v_pred_rej     NUMERIC;
  v_succ_id      UUID;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_train_id   := OLD.train_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_train_id   := NEW.train_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): compute deltas for this row ─────────────────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT permeate_meter, feed_meter, reject_meter
      INTO v_pred_perm,    v_pred_feed, v_pred_rej
      FROM public.ro_train_readings
     WHERE train_id         = v_train_id
       AND reading_datetime < v_reading_dt
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.ro_train_readings
       SET permeate_meter_delta = CASE WHEN NEW.permeate_meter IS NOT NULL AND v_pred_perm IS NOT NULL
                                       THEN NEW.permeate_meter - v_pred_perm ELSE NULL END,
           feed_meter_delta     = CASE WHEN NEW.feed_meter     IS NOT NULL AND v_pred_feed IS NOT NULL
                                       THEN NEW.feed_meter     - v_pred_feed ELSE NULL END,
           reject_meter_delta   = CASE WHEN NEW.reject_meter   IS NOT NULL AND v_pred_rej  IS NOT NULL
                                       THEN NEW.reject_meter   - v_pred_rej  ELSE NULL END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch the successor row ───────────────────────────────────────
  SELECT id
    INTO v_succ_id
    FROM public.ro_train_readings
   WHERE train_id         = v_train_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_succ_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      -- Successor's new predecessor is OLD's predecessor.
      -- Re-query so we get the values for that predecessor cleanly.
      SELECT permeate_meter, feed_meter, reject_meter
        INTO v_pred_perm,    v_pred_feed, v_pred_rej
        FROM public.ro_train_readings
       WHERE train_id         = v_train_id
         AND reading_datetime < OLD.reading_datetime
       ORDER BY reading_datetime DESC
       LIMIT 1;
    ELSE
      v_pred_perm := NEW.permeate_meter;
      v_pred_feed := NEW.feed_meter;
      v_pred_rej  := NEW.reject_meter;
    END IF;

    UPDATE public.ro_train_readings AS rtr
       SET permeate_meter_delta = CASE WHEN rtr.permeate_meter IS NOT NULL AND v_pred_perm IS NOT NULL
                                       THEN rtr.permeate_meter - v_pred_perm ELSE NULL END,
           feed_meter_delta     = CASE WHEN rtr.feed_meter     IS NOT NULL AND v_pred_feed IS NOT NULL
                                       THEN rtr.feed_meter     - v_pred_feed ELSE NULL END,
           reject_meter_delta   = CASE WHEN rtr.reject_meter   IS NOT NULL AND v_pred_rej  IS NOT NULL
                                       THEN rtr.reject_meter   - v_pred_rej  ELSE NULL END
     WHERE rtr.id = v_succ_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$$;


ALTER FUNCTION "public"."fn_sync_ro_train_reading_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_well_power_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
/*
  Keeps daily_power_kwh (per-well kWh sub-meter delta) in sync.
  Mirrors the structure of fn_sync_power_reading_chain() but chains on
  well_id rather than plant_id.

  Only fires when power_meter_reading is non-NULL — wells without a power
  meter simply have NULL in daily_power_kwh and this function exits early.
*/
DECLARE
  v_well_id     UUID;
  v_reading_dt  TIMESTAMPTZ;
  v_pred_meter  NUMERIC;
  v_succ_id     UUID;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_reading_dt := NEW.reading_datetime;
    -- No power meter on this well — nothing to compute.
    IF NEW.power_meter_reading IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ── Step 1 (INSERT / UPDATE) ──────────────────────────────────────────────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT power_meter_reading
      INTO v_pred_meter
      FROM public.well_readings
     WHERE well_id           = v_well_id
       AND reading_datetime  < v_reading_dt
       AND power_meter_reading IS NOT NULL
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.well_readings
       SET daily_power_kwh = CASE
             WHEN v_pred_meter IS NOT NULL
             THEN NEW.power_meter_reading - v_pred_meter
             ELSE NEW.power_meter_reading   -- first metered reading on this well
           END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id
    INTO v_succ_id
    FROM public.well_readings
   WHERE well_id           = v_well_id
     AND reading_datetime  > v_reading_dt
     AND power_meter_reading IS NOT NULL
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_succ_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      SELECT power_meter_reading
        INTO v_pred_meter
        FROM public.well_readings
       WHERE well_id           = v_well_id
         AND reading_datetime  < OLD.reading_datetime
         AND power_meter_reading IS NOT NULL
       ORDER BY reading_datetime DESC
       LIMIT 1;
    ELSE
      v_pred_meter := NEW.power_meter_reading;
    END IF;

    UPDATE public.well_readings AS wr
       SET daily_power_kwh = CASE
             WHEN v_pred_meter IS NOT NULL
             THEN wr.power_meter_reading - v_pred_meter
             ELSE wr.power_meter_reading
           END
     WHERE wr.id = v_succ_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$$;


ALTER FUNCTION "public"."fn_sync_well_power_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_well_reading_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."fn_sync_well_reading_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_invalidate_power_cache"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'UPDATE' AND OLD.grid_meter_multipliers IS NOT DISTINCT FROM NEW.grid_meter_multipliers THEN RETURN NEW; END IF;
    PERFORM public.fn_recalc_power_cache(NEW.plant_id); RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.power_readings SET daily_grid_kwh = NULL, daily_consumption_kwh = NULL, cache_recalculated_at = NOW()
     WHERE plant_id = OLD.plant_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."fn_trg_invalidate_power_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_recalc_successor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_multipliers numeric[]; v_next record; total_kwh numeric := 0;
  slot_key text; slot_curr numeric; slot_prev numeric; slot_mult numeric; slot_idx int;
BEGIN
  SELECT COALESCE(grid_meter_multipliers, ARRAY[1::numeric]) INTO v_multipliers
    FROM public.plant_power_config WHERE plant_id = NEW.plant_id;
  IF v_multipliers IS NULL THEN v_multipliers := ARRAY[1::numeric]; END IF;
  SELECT id, meter_reading_kwh, grid_meter_readings, is_meter_replacement INTO v_next
    FROM public.power_readings
   WHERE plant_id = NEW.plant_id AND reading_datetime > NEW.reading_datetime AND NOT COALESCE(is_meter_replacement, false)
   ORDER BY reading_datetime ASC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  total_kwh := 0;
  IF v_next.grid_meter_readings IS NOT NULL AND jsonb_typeof(v_next.grid_meter_readings) = 'object'
     AND NEW.grid_meter_readings IS NOT NULL AND jsonb_typeof(NEW.grid_meter_readings::jsonb) = 'object' THEN
    FOR slot_key IN SELECT jsonb_object_keys(v_next.grid_meter_readings) LOOP
      slot_curr := (v_next.grid_meter_readings ->> slot_key)::numeric;
      slot_prev := (NEW.grid_meter_readings::jsonb ->> slot_key)::numeric;
      IF slot_curr IS NOT NULL AND slot_prev IS NOT NULL AND (slot_curr - slot_prev) >= 0 THEN
        slot_idx := slot_key::int + 1;
        slot_mult := COALESCE(v_multipliers[slot_idx], v_multipliers[1], 1);
        total_kwh := total_kwh + (slot_curr - slot_prev) * slot_mult;
      END IF;
    END LOOP;
  ELSIF v_next.meter_reading_kwh IS NOT NULL AND NEW.meter_reading_kwh IS NOT NULL
        AND (v_next.meter_reading_kwh - NEW.meter_reading_kwh) >= 0 THEN
    total_kwh := (v_next.meter_reading_kwh - NEW.meter_reading_kwh) * COALESCE(v_multipliers[1], 1);
  END IF;
  IF total_kwh > 0 THEN
    UPDATE public.power_readings SET daily_grid_kwh = total_kwh, daily_consumption_kwh = total_kwh,
      cache_recalculated_at = NOW() WHERE id = v_next.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_recalc_successor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_sync_operator_presence"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor_id UUID;
BEGIN
  v_actor_id := NEW.recorded_by;

  IF v_actor_id IS NOT NULL THEN
    UPDATE public.user_profiles
    SET last_seen_at = now()
    WHERE id = v_actor_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_sync_operator_presence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_validate_ro_train_feed_source"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_plant_id UUID;
  v_current  UUID;
  v_hops     INT := 0;
BEGIN
  IF NEW.feed_source_train_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT plant_id INTO v_plant_id FROM public.ro_trains WHERE id = NEW.feed_source_train_id;
  IF v_plant_id IS DISTINCT FROM NEW.plant_id THEN
    RAISE EXCEPTION 'feed_source_train_id must reference a train on the same plant';
  END IF;

  v_current := NEW.feed_source_train_id;
  WHILE v_current IS NOT NULL AND v_hops < 10 LOOP
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'feed_source_train_id would create a cycle';
    END IF;
    SELECT feed_source_train_id INTO v_current FROM public.ro_trains WHERE id = v_current;
    v_hops := v_hops + 1;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_validate_ro_train_feed_source"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_well_reading_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_reviewer_resolving BOOLEAN;
BEGIN
  v_reviewer_resolving := (
    TG_OP = 'UPDATE'
    AND OLD.norm_status = 'pending_review'
    AND NEW.norm_status = 'normal'
    AND OLD.current_reading = NEW.current_reading
  );

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   well_readings
  WHERE  well_id   = NEW.well_id
    AND  plant_id  = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_reviewer_resolving
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
          FROM   well_readings
          WHERE  well_id   = NEW.well_id
            AND  plant_id  = NEW.plant_id
            AND  norm_status = 'normal'
            AND  reading_datetime >= NOW() - INTERVAL '7 days'
            AND  reading_datetime < NEW.reading_datetime
            AND  previous_reading IS NOT NULL
            AND  current_reading  > previous_reading
        ) sub WHERE sub.fr > 0;

        IF v_avg_flow_rate IS NOT NULL
           AND v_flow_rate > v_avg_flow_rate * 2.0
           AND NEW.norm_status = 'normal'
           AND NOT v_reviewer_resolving
        THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_well_reading_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_incident_ref"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."generate_incident_ref"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_staff_profiles"() RETURNS SETOF "public"."user_profiles"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    id, username, first_name, middle_name, last_name, suffix, designation,
    immediate_head_id, plant_assignments, status, profile_complete,
    created_at, updated_at, confirmed, last_seen_at,
    CASE
      WHEN public.is_manager_or_admin(auth.uid()) OR id = auth.uid() THEN email
      ELSE NULL
    END AS email
  FROM public.user_profiles
  ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST;
$$;


ALTER FUNCTION "public"."get_all_staff_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_user_roles"() RETURNS TABLE("user_id" "uuid", "role" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT ur.user_id, ur.role::TEXT
  FROM public.user_roles ur;
$$;


ALTER FUNCTION "public"."get_all_user_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_permeate_delta"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Cap unrealistic single-hour permeate deltas.
  -- 50 000 m³/hour is physically impossible for a municipal RO plant.
  IF NEW.permeate_meter_delta IS NOT NULL AND NEW.permeate_meter_delta > 50000 THEN
    NEW.permeate_meter_delta := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_permeate_delta"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- your existing logic here

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'Admin');
$$;


ALTER FUNCTION "public"."is_admin"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager_or_admin"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('Admin','Manager'));
$$;


ALTER FUNCTION "public"."is_manager_or_admin"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('Admin','Manager','Data Analyst')
  );
$$;


ALTER FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") IS 'Admin, Manager, or Data Analyst. Used to gate who may override a derived (is_derived) locator''s value — deliberately separate from is_manager_or_admin(), which several unrelated RLS policies already rely on excluding Data Analyst.';



CREATE OR REPLACE FUNCTION "public"."permission_overridden_denied"("_user_id" "uuid", "_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_permission_overrides
    WHERE user_id = _user_id AND permission_key = _key AND allowed = false
  );
$$;


ALTER FUNCTION "public"."permission_overridden_denied"("_user_id" "uuid", "_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_expired_chat_messages"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  DELETE FROM public.chat_messages WHERE expires_at < now();
$$;


ALTER FUNCTION "public"."purge_expired_chat_messages"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_power_cache_for_plant"("p_plant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.fn_recalc_power_cache(p_plant_id);
  RETURN 'OK: cache recalculated for plant ' || p_plant_id::text;
END;
$$;


ALTER FUNCTION "public"."recalc_power_cache_for_plant"("p_plant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_all_deltas"("p_plant_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
/*
  Full recalculation pass for one plant (or all plants when p_plant_id IS NULL).
  Bypasses per-row trigger overhead by using window functions over the full set.

  Covers:
    water:  locator_readings, well_readings (daily_volume), ro_train_readings
    power:  power_readings, well_readings (daily_power_kwh), electric_bills
*/
BEGIN

  -- ── locator_readings: previous_reading (daily_volume is GENERATED) ─────────
  WITH o AS (
    SELECT id, plant_id,
           LAG(current_reading) OVER (PARTITION BY locator_id ORDER BY reading_datetime) AS lag_r
      FROM public.locator_readings
     WHERE p_plant_id IS NULL OR plant_id = p_plant_id
  )
  UPDATE public.locator_readings lr
     SET previous_reading = o.lag_r
    FROM o
   WHERE lr.id = o.id
     AND lr.previous_reading IS DISTINCT FROM o.lag_r;

  -- ── well_readings: daily_volume (water) ───────────────────────────────────
  WITH o AS (
    SELECT id, plant_id, current_reading,
           LAG(current_reading) OVER (PARTITION BY well_id ORDER BY reading_datetime) AS lag_r
      FROM public.well_readings
     WHERE (p_plant_id IS NULL OR plant_id = p_plant_id)
       AND current_reading IS NOT NULL
  )
  UPDATE public.well_readings wr
     SET previous_reading = o.lag_r,
         daily_volume = CASE
                          WHEN o.lag_r IS NOT NULL
                          THEN GREATEST(0, o.current_reading - o.lag_r)
                          ELSE o.current_reading
                        END
    FROM o
   WHERE wr.id = o.id;

  -- ── well_readings: daily_power_kwh (power sub-meter) ──────────────────────
  WITH o AS (
    SELECT id,
           power_meter_reading,
           LAG(power_meter_reading) OVER (PARTITION BY well_id ORDER BY reading_datetime) AS lag_m
      FROM public.well_readings
     WHERE (p_plant_id IS NULL OR plant_id = p_plant_id)
       AND power_meter_reading IS NOT NULL
  )
  UPDATE public.well_readings wr
     SET daily_power_kwh = CASE
                             WHEN o.lag_m IS NOT NULL THEN o.power_meter_reading - o.lag_m
                             ELSE o.power_meter_reading
                           END
    FROM o
   WHERE wr.id = o.id;

  -- ── ro_train_readings: permeate/feed/reject meter deltas ──────────────────
  WITH o AS (
    SELECT r.id, r.train_id,
           r.permeate_meter, r.feed_meter, r.reject_meter,
           LAG(r.permeate_meter) OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) AS lag_p,
           LAG(r.feed_meter)     OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) AS lag_f,
           LAG(r.reject_meter)   OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) AS lag_r
      FROM public.ro_train_readings r
      JOIN public.ro_trains t ON t.id = r.train_id
     WHERE p_plant_id IS NULL OR t.plant_id = p_plant_id
  )
  UPDATE public.ro_train_readings rtr
     SET permeate_meter_delta = CASE WHEN o.permeate_meter IS NOT NULL AND o.lag_p IS NOT NULL THEN o.permeate_meter - o.lag_p ELSE NULL END,
         feed_meter_delta     = CASE WHEN o.feed_meter     IS NOT NULL AND o.lag_f IS NOT NULL THEN o.feed_meter     - o.lag_f ELSE NULL END,
         reject_meter_delta   = CASE WHEN o.reject_meter   IS NOT NULL AND o.lag_r IS NOT NULL THEN o.reject_meter   - o.lag_r ELSE NULL END
    FROM o
   WHERE rtr.id = o.id;

  -- ── power_readings: daily_consumption_kwh ─────────────────────────────────
  WITH o AS (
    SELECT id, meter_reading_kwh,
           LAG(meter_reading_kwh) OVER (PARTITION BY plant_id ORDER BY reading_datetime) AS lag_m
      FROM public.power_readings
     WHERE p_plant_id IS NULL OR plant_id = p_plant_id
  )
  UPDATE public.power_readings pr
     SET daily_consumption_kwh = CASE
                                   WHEN o.lag_m IS NOT NULL THEN o.meter_reading_kwh - o.lag_m
                                   ELSE o.meter_reading_kwh
                                 END
    FROM o
   WHERE pr.id = o.id
     AND pr.daily_consumption_kwh IS DISTINCT FROM
         CASE WHEN o.lag_m IS NOT NULL THEN o.meter_reading_kwh - o.lag_m ELSE o.meter_reading_kwh END;

  -- ── electric_bills: previous_reading (total_kwh is GENERATED) ─────────────
  WITH o AS (
    SELECT id, plant_id,
           LAG(current_reading) OVER (PARTITION BY plant_id ORDER BY period_end) AS lag_r
      FROM public.electric_bills
     WHERE p_plant_id IS NULL OR plant_id = p_plant_id
  )
  UPDATE public.electric_bills eb
     SET previous_reading = o.lag_r
    FROM o
   WHERE eb.id = o.id
     AND o.lag_r IS NOT NULL
     AND eb.previous_reading IS DISTINCT FROM o.lag_r;

END;
$$;


ALTER FUNCTION "public"."recalculate_all_deltas"("p_plant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_costs_for_tariff_window"("_plant" "uuid", "_from" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_to date;
BEGIN
  IF _plant IS NULL OR _from IS NULL THEN RETURN; END IF;

  -- Upper bound: the next tariff's effective_date after _from (exclusive),
  -- or today+1 (i.e. "through today") if this is the latest tariff on file.
  SELECT MIN(effective_date) INTO v_to
  FROM public.power_tariffs
  WHERE plant_id = _plant AND effective_date > _from;

  IF v_to IS NULL THEN
    v_to := CURRENT_DATE + 1;
  END IF;

  PERFORM public.recompute_production_cost(pc.plant_id, pc.cost_date)
  FROM public.production_costs pc
  WHERE pc.plant_id = _plant AND pc.cost_date >= _from AND pc.cost_date < v_to;
END;
$$;


ALTER FUNCTION "public"."recompute_costs_for_tariff_window"("_plant" "uuid", "_from" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_production_cost"("_plant_id" "uuid", "_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."recompute_production_cost"("_plant_id" "uuid", "_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_solar_cost"("_plant_id" "uuid", "_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_solar_kwh  numeric := 0;
  v_rate       numeric := 0;
  v_mult       numeric := 1;
  v_solar_cost numeric := 0;
begin
  select coalesce(sum(daily_solar_kwh), 0)
    into v_solar_kwh
  from public.power_readings
  where plant_id = _plant_id
    and (reading_datetime at time zone 'Asia/Manila')::date = _date;

  select rate_per_kwh, multiplier
    into v_rate, v_mult
  from public.power_tariffs
  where plant_id = _plant_id
    and effective_date <= _date
  order by effective_date desc
  limit 1;

  v_solar_cost := v_solar_kwh * coalesce(v_rate, 0) * coalesce(v_mult, 1);

  insert into public.production_costs (plant_id, cost_date, solar_cost)
  values (_plant_id, _date, v_solar_cost)
  on conflict (plant_id, cost_date) do update
    set solar_cost = excluded.solar_cost;
end;
$$;


ALTER FUNCTION "public"."recompute_solar_cost"("_plant_id" "uuid", "_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_plant_multiplier_cache"("p_plant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_mults numeric[]; v_len int; v_idx int;
BEGIN
  SELECT grid_meter_multipliers INTO v_mults FROM public.plant_power_config WHERE plant_id = p_plant_id;
  IF v_mults IS NULL THEN v_mults := ARRAY[1::numeric]; END IF;
  v_len := array_length(v_mults, 1);
  DELETE FROM public.plant_multiplier_cache WHERE plant_id = p_plant_id;
  FOR v_idx IN 1 .. v_len LOOP
    INSERT INTO public.plant_multiplier_cache (plant_id, meter_index, effective_mult, cached_at, invalidated)
    VALUES (p_plant_id, v_idx, COALESCE(v_mults[v_idx], 1), now(), false);
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."refresh_plant_multiplier_cache"("p_plant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_production_costs"("p_plant_id" "uuid", "p_from" "date" DEFAULT ((CURRENT_DATE - '90 days'::interval))::"date", "p_to" "date" DEFAULT CURRENT_DATE) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE r_date date;
BEGIN
  r_date := p_from;
  WHILE r_date <= p_to LOOP
    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost)
    SELECT p_plant_id, r_date,
      COALESCE((SELECT ROUND(b.total_amount / GREATEST(1, (b.period_end - b.period_start + 1)), 2)
        FROM public.electric_bills b WHERE b.plant_id = p_plant_id AND b.period_start <= r_date AND b.period_end >= r_date
        ORDER BY b.billing_month DESC LIMIT 1), 0),
      COALESCE((SELECT ROUND(SUM(cu.quantity * cp.unit_price), 2)
        FROM public.chemical_usage cu
        JOIN public.chemical_prices cp ON cp.chemical_name = cu.chemical_name
          AND cp.effective_date = (SELECT MAX(cp2.effective_date) FROM public.chemical_prices cp2
            WHERE cp2.chemical_name = cu.chemical_name AND cp2.effective_date <= r_date)
        WHERE cu.plant_id = p_plant_id AND cu.usage_date = r_date), 0)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
      SET power_cost = EXCLUDED.power_cost, chem_cost = EXCLUDED.chem_cost, updated_at = now();
    r_date := r_date + INTERVAL '1 day';
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."refresh_production_costs"("p_plant_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_plant_multiplier"("p_plant_id" "uuid", "p_meter_index" integer) RETURNS numeric
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(
    (SELECT grid_meter_multipliers[p_meter_index] FROM public.plant_power_config
      WHERE plant_id = p_plant_id AND p_meter_index BETWEEN 1 AND array_length(grid_meter_multipliers, 1) LIMIT 1),
    1);
$$;


ALTER FUNCTION "public"."resolve_plant_multiplier"("p_plant_id" "uuid", "p_meter_index" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_daily_plant_summary_production"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.production_m3 IS NOT NULL AND NEW.product_water_m3 IS NULL THEN
    NEW.product_water_m3 := NEW.production_m3;
  ELSIF NEW.product_water_m3 IS NOT NULL AND NEW.production_m3 IS NULL THEN
    NEW.production_m3 := NEW.product_water_m3;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_daily_plant_summary_production"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_ro_train_reading_meter_replacement_flag"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.is_meter_replacement := (
    NEW.is_feed_meter_replacement
    OR NEW.is_permeate_meter_replacement
    OR NEW.is_reject_meter_replacement
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_ro_train_reading_meter_replacement_flag"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.user_profiles
    SET email = NEW.email
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_role_to_app_metadata"("_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."sync_user_role_to_app_metadata"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_last_seen"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  UPDATE public.user_profiles
  SET last_seen_at = now()
  WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."touch_last_seen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_user_presence"("p_user_id" "uuid" DEFAULT NULL::"uuid", "p_action" "text" DEFAULT NULL::"text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_target_id UUID;
  v_now TIMESTAMPTZ := now();
  v_allowed BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_target_id := COALESCE(p_user_id, auth.uid());

  SELECT
    v_target_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles caller
      JOIN public.user_profiles target ON target.id = v_target_id
      WHERE caller.id = auth.uid()
        AND caller.plant_assignments && target.plant_assignments
    )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Not authorized to update presence for this user';
  END IF;

  UPDATE public.user_profiles
  SET last_seen_at = v_now
  WHERE id = v_target_id;

  RETURN v_now;
END;
$$;


ALTER FUNCTION "public"."touch_user_presence"("p_user_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_invalidate_multiplier_cache"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE v_plant_id uuid := COALESCE(NEW.plant_id, OLD.plant_id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.plant_multiplier_cache WHERE plant_id = v_plant_id; RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.grid_meter_multipliers IS NOT DISTINCT FROM NEW.grid_meter_multipliers THEN RETURN NEW; END IF;
  UPDATE public.plant_multiplier_cache SET invalidated = true WHERE plant_id = v_plant_id;
  PERFORM public.refresh_plant_multiplier_cache(v_plant_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_invalidate_multiplier_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recompute_cost"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_plant uuid;
  v_date date;
  v_ts timestamptz;
begin
  if TG_OP = 'DELETE' then
    v_plant := OLD.plant_id;
    begin v_ts := OLD.log_datetime; exception when undefined_column then v_ts := null; end;
    if v_ts is null then
      begin v_ts := OLD.reading_datetime; exception when undefined_column then v_ts := null; end;
    end if;
  else
    v_plant := NEW.plant_id;
    begin v_ts := NEW.log_datetime; exception when undefined_column then v_ts := null; end;
    if v_ts is null then
      begin v_ts := NEW.reading_datetime; exception when undefined_column then v_ts := null; end;
    end if;
  end if;
  if v_ts is not null then
    v_date := (v_ts at time zone 'Asia/Manila')::date;
    perform public.recompute_production_cost(v_plant, v_date);
  end if;
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."trg_recompute_cost"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recompute_cost_on_tariff_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Recompute whatever window the OLD row used to govern (an UPDATE moved
  -- its date/rate, or a DELETE removed it outright) ...
  IF TG_OP IN ('UPDATE','DELETE') THEN
    PERFORM public.recompute_costs_for_tariff_window(OLD.plant_id, OLD.effective_date);
  END IF;
  -- ... and whatever window the NEW row now governs (INSERT, or UPDATE's
  -- resulting date/rate).
  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.recompute_costs_for_tariff_window(NEW.plant_id, NEW.effective_date);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."trg_recompute_cost_on_tariff_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recompute_solar_cost"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  perform public.recompute_solar_cost(
    coalesce(new.plant_id, old.plant_id),
    (coalesce(new.reading_datetime, old.reading_datetime) at time zone 'Asia/Manila')::date
  );
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_recompute_solar_cost"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_regression_results_outlier_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."trg_regression_results_outlier_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_stamp_reading_multiplier"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE v_index int := 1; v_mult numeric;
BEGIN
  SELECT effective_mult INTO v_mult FROM public.plant_multiplier_cache
   WHERE plant_id = NEW.plant_id AND meter_index = v_index AND invalidated = false;
  IF v_mult IS NULL THEN
    v_mult := public.resolve_plant_multiplier(NEW.plant_id, v_index);
    PERFORM public.refresh_plant_multiplier_cache(NEW.plant_id);
  END IF;
  NEW.meter_multiplier := COALESCE(v_mult, 1);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_stamp_reading_multiplier"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_user_role_to_app_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."trg_sync_user_role_to_app_metadata"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_own_profile"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."update_own_profile"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_plant_access"("_plant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND status = 'Active'
        AND _plant_id = ANY(plant_assignments)
    );
$$;


ALTER FUNCTION "public"."user_has_plant_access"("_plant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_ro_write_access"("_plant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.user_has_plant_access(_plant_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('Manager','Data Analyst')
    );
$$;


ALTER FUNCTION "public"."user_has_ro_write_access"("_plant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."well_readings_cascade_next"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE next_id UUID; next_dv NUMERIC; next_cr NUMERIC;
BEGIN
  IF NEW.current_reading IS NOT DISTINCT FROM OLD.current_reading THEN RETURN NULL; END IF;
  SELECT id, daily_volume, current_reading INTO next_id, next_dv, next_cr FROM public.well_readings
   WHERE well_id = NEW.well_id AND reading_datetime > NEW.reading_datetime
     AND (is_meter_replacement IS NULL OR is_meter_replacement = FALSE)
   ORDER BY reading_datetime ASC LIMIT 1;
  IF next_id IS NULL THEN RETURN NULL; END IF;
  IF next_dv IS NULL OR (OLD.current_reading IS NOT NULL AND ABS(next_dv - GREATEST(0, next_cr - OLD.current_reading)) < 0.01) THEN
    UPDATE public.well_readings SET previous_reading = NEW.current_reading,
      daily_volume = CASE WHEN next_cr IS NOT NULL THEN GREATEST(0, next_cr - NEW.current_reading) ELSE next_dv END
     WHERE id = next_id;
  ELSE
    UPDATE public.well_readings SET previous_reading = NEW.current_reading WHERE id = next_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."well_readings_cascade_next"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."well_readings_compute_daily_volume"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.current_reading IS NOT NULL AND NEW.previous_reading IS NOT NULL THEN
    NEW.daily_volume := GREATEST(0, NEW.current_reading - NEW.previous_reading);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."well_readings_compute_daily_volume"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."well_readings_compute_delta"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE actual_prev NUMERIC;
BEGIN
  IF NEW.is_meter_replacement IS TRUE THEN RETURN NEW; END IF;
  SELECT current_reading INTO actual_prev FROM public.well_readings
   WHERE well_id = NEW.well_id AND reading_datetime < NEW.reading_datetime
     AND (is_meter_replacement IS NULL OR is_meter_replacement = FALSE)
   ORDER BY reading_datetime DESC LIMIT 1;
  IF actual_prev IS NOT NULL THEN NEW.previous_reading := actual_prev; END IF;
  IF NEW.daily_volume IS NULL AND actual_prev IS NOT NULL AND NEW.current_reading IS NOT NULL THEN
    NEW.daily_volume := GREATEST(0, NEW.current_reading - actual_prev);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."well_readings_compute_delta"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."afm_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "afm_unit_number" integer NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "text" DEFAULT 'Running'::"text" NOT NULL,
    "inlet_pressure_psi" numeric,
    "outlet_pressure_psi" numeric,
    "dp_psi" numeric,
    "backwash_start" timestamp with time zone,
    "backwash_end" timestamp with time zone,
    "meter_initial" numeric,
    "meter_final" numeric,
    "backwash_volume" numeric,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "afm_readings_mode_check" CHECK (("mode" = ANY (ARRAY['Running'::"text", 'Backwash'::"text"])))
);


ALTER TABLE "public"."afm_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_chat_sessions" (
    "session_id" "text" NOT NULL,
    "user_id" "uuid",
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_chat_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."archived_plant_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "plant_name" "text",
    "source_table" "text" NOT NULL,
    "source_row_id" "uuid",
    "payload" "jsonb" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_by" "uuid",
    "reason" "text"
);


ALTER TABLE "public"."archived_plant_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backfill_sweep_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "entity_fk_col" "text",
    "entity_fk_val" "uuid",
    "plant_id" "uuid",
    "date_key" "date" NOT NULL,
    "method" "text" NOT NULL,
    "old_value" numeric,
    "new_value" numeric,
    "changed" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "backfill_sweep_log_method_check" CHECK (("method" = ANY (ARRAY['even_split'::"text", 'regression_flowrate'::"text"])))
);


ALTER TABLE "public"."backfill_sweep_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blending_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "well_id" "uuid" NOT NULL,
    "well_name" "text",
    "plant_name" "text",
    "event_date" "date" NOT NULL,
    "volume_m3" numeric DEFAULT 0 NOT NULL,
    "noted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_meter_reading" numeric,
    "is_meter_replacement" boolean DEFAULT false,
    "reading_datetime" timestamp with time zone,
    "previous_reading" numeric,
    "is_estimated" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."blending_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."blending_events"."raw_meter_reading" IS 'Cumulative meter reading at time of entry. volume_m3 is this minus the previous reading for the same well. Nullable only for legacy rows saved before the Direct-m³ input mode was removed — new rows should always populate this.';



COMMENT ON COLUMN "public"."blending_events"."is_meter_replacement" IS 'True when this reading immediately follows a physical meter swap. volume_m3 is treated as 0 for this row.';



COMMENT ON COLUMN "public"."blending_events"."previous_reading" IS 'Cumulative reading from this well''s prior blending_events row. Resolved server-side by trg_blending_set_reading on INSERT when not explicitly supplied — never trust a client-computed value for this. Left NULL means this row is this well''s baseline (no prior reading exists yet).';



CREATE TABLE IF NOT EXISTS "public"."blending_wells" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "well_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "well_name" "text",
    "plant_name" "text",
    "tagged_by" "uuid",
    "tagged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "public"."blending_wells" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cartridge_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "cartridge_number" integer NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inlet_pressure_psi" numeric,
    "outlet_pressure_psi" numeric,
    "dp_psi" numeric,
    "bag_replaced" boolean DEFAULT false NOT NULL,
    "pieces_replaced" integer,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cartridge_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chat_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '08:00:00'::interval) NOT NULL
);

ALTER TABLE ONLY "public"."chat_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "plant_id" "uuid",
    "execution_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "frequency" "public"."frequency_type",
    "completed" boolean DEFAULT false NOT NULL,
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "findings" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."checklist_executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_step_executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "execution_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "plant_id" "uuid",
    "step_index" integer NOT NULL,
    "step_text" "text" NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "value" "text",
    "notes" "text",
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."checklist_step_executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid",
    "category" "text" NOT NULL,
    "equipment_name" "text" NOT NULL,
    "frequency" "public"."frequency_type" NOT NULL,
    "checklist_steps" "text"[],
    "schedule_start_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."checklist_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chemical_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "chemical_name" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit" "text" DEFAULT 'kg'::"text" NOT NULL,
    "unit_cost" numeric,
    "supplier" "text",
    "delivery_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "remarks" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chemical_deliveries_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."chemical_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chemical_dosing_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "log_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chlorine_kg" numeric DEFAULT 0 NOT NULL,
    "smbs_kg" numeric DEFAULT 0 NOT NULL,
    "anti_scalant_l" numeric DEFAULT 0 NOT NULL,
    "soda_ash_kg" numeric DEFAULT 0 NOT NULL,
    "free_chlorine_reagent_pcs" integer DEFAULT 0 NOT NULL,
    "product_water_free_cl_ppm" numeric,
    "calculated_cost" numeric,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chemical_dosing_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chemical_inventory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "chemical_name" "text" NOT NULL,
    "unit" "text",
    "current_stock" numeric DEFAULT 0 NOT NULL,
    "low_stock_threshold" numeric DEFAULT 10 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "price_per_unit" numeric,
    "unit_type" "text"
);


ALTER TABLE "public"."chemical_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chemical_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chemical_name" "text" NOT NULL,
    "unit_price" numeric NOT NULL,
    "effective_date" "date" NOT NULL,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chemical_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chemical_residual_samples" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dosing_log_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "sample_index" integer NOT NULL,
    "sampling_point" "text",
    "residual_ppm" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chemical_residual_samples" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cip_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "start_datetime" timestamp with time zone,
    "end_datetime" timestamp with time zone,
    "sls_g" numeric,
    "hcl_l" numeric,
    "caustic_soda_kg" numeric,
    "conducted_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cip_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compliance_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid",
    "evaluated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "violations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "summary" "text"
);


ALTER TABLE "public"."compliance_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compliance_thresholds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" NOT NULL,
    "thresholds" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."compliance_thresholds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."correction_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "submitted_by" "uuid",
    "original_value" numeric NOT NULL,
    "proposed_value" numeric NOT NULL,
    "reason" "text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "resolution_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "correction_requests_source_table_check" CHECK (("source_table" = ANY (ARRAY['locator_readings'::"text", 'well_readings'::"text", 'product_meter_readings'::"text", 'ro_train_readings'::"text"]))),
    CONSTRAINT "correction_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."correction_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_role_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "custom_role_id" "uuid" NOT NULL,
    "module_key" "text" NOT NULL,
    "action" "text" NOT NULL,
    "allowed" boolean NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "custom_role_overrides_action_check" CHECK (("action" = ANY (ARRAY['view'::"text", 'edit'::"text", 'budget'::"text", 'delete'::"text"])))
);


ALTER TABLE "public"."custom_role_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "base_role" "public"."app_role" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."custom_roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."custom_roles" IS 'Named permission presets an Admin builds on top of a system role (base_role). Does not participate in RLS directly — see migration header.';



CREATE TABLE IF NOT EXISTS "public"."daily_plant_summary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "summary_date" "date" NOT NULL,
    "production_m3" numeric,
    "locator_consumption_m3" numeric,
    "blending_m3" numeric,
    "raw_water_consumption_m3" numeric,
    "power_kwh" numeric,
    "pv_ratio" numeric,
    "feed_tds" numeric,
    "permeate_tds" numeric,
    "reject_tds" numeric,
    "product_tds" numeric,
    "raw_turbidity_ntu" numeric,
    "recovery_pct" numeric,
    "rejection_pct" numeric,
    "downtime_hrs" numeric,
    "feed_pressure_psi" numeric,
    "reject_pressure_psi" numeric,
    "notes" "text",
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_water_m3" numeric
);


ALTER TABLE "public"."daily_plant_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deletion_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "entity_label" "text",
    "action" "text" NOT NULL,
    "actor_user_id" "uuid",
    "actor_label" "text",
    "reason" "text",
    "dependencies" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "deletion_audit_log_action_check" CHECK (("action" = ANY (ARRAY['soft'::"text", 'hard'::"text"]))),
    CONSTRAINT "deletion_audit_log_kind_check" CHECK (("kind" = ANY (ARRAY['user'::"text", 'plant'::"text", 'well'::"text"])))
);


ALTER TABLE "public"."deletion_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."derived_meter_sweep_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "swept_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locator_id" "uuid" NOT NULL,
    "date_key" "date" NOT NULL,
    "old_value" numeric,
    "new_value" numeric,
    "changed" boolean DEFAULT false NOT NULL,
    "mirror_meter_id" "uuid",
    "reading_id" "uuid",
    "mirror_reading_id" "uuid"
);


ALTER TABLE "public"."derived_meter_sweep_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."downtime_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid",
    "event_date" "date" NOT NULL,
    "duration_hrs" numeric DEFAULT 0 NOT NULL,
    "subsystem" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."downtime_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."electric_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "billing_month" "date" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "previous_reading" numeric NOT NULL,
    "current_reading" numeric NOT NULL,
    "multiplier" numeric DEFAULT 1 NOT NULL,
    "total_kwh" numeric GENERATED ALWAYS AS ((("current_reading" - "previous_reading") * "multiplier")) STORED,
    "total_amount" numeric NOT NULL,
    "generation_charge" numeric,
    "distribution_charge" numeric,
    "other_charges" numeric,
    "remarks" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."electric_bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entity_status_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "plant_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "entity_label" "text",
    "from_status" "text" NOT NULL,
    "to_status" "text" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason_category" "text",
    "reason_detail" "text",
    CONSTRAINT "entity_status_audit_log_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['Well'::"text", 'Locator'::"text", 'RO Train'::"text"]))),
    CONSTRAINT "entity_status_audit_log_reason_category_check" CHECK (("reason_category" = ANY (ARRAY['pump_problem'::"text", 'locked_meter'::"text", 'equipment_malfunction'::"text", 'maintenance'::"text", 'access_issue'::"text", 'other'::"text", 'unpaid_bill'::"text", 'tampering'::"text", 'vacant_property'::"text", 'safety_repair'::"text"])))
);


ALTER TABLE "public"."entity_status_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filter_replacements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "train_id" "uuid",
    "replacement_date" "date" NOT NULL,
    "filter_housing_type" "text" NOT NULL,
    "quantity_replaced" integer NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "total_cost" numeric(14,2) GENERATED ALWAYS AS ((("quantity_replaced")::numeric * "unit_price")) STORED,
    "avg_dp_psi" numeric(6,2),
    "supplier" "text",
    "remarks" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "filter_replacements_filter_housing_type_check" CHECK (("filter_housing_type" = ANY (ARRAY['Cartridge Filter'::"text", 'Bag Filter'::"text"]))),
    CONSTRAINT "filter_replacements_quantity_replaced_check" CHECK (("quantity_replaced" > 0)),
    CONSTRAINT "filter_replacements_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."filter_replacements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filter_unit_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "filter_housing_type" "text" NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "effective_from" "date" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "filter_unit_prices_filter_housing_type_check" CHECK (("filter_housing_type" = ANY (ARRAY['Cartridge Filter'::"text", 'Bag Filter'::"text"]))),
    CONSTRAINT "filter_unit_prices_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."filter_unit_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."plant_status" DEFAULT 'Active'::"public"."plant_status" NOT NULL,
    "design_capacity_m3" numeric,
    "num_ro_trains" integer DEFAULT 0 NOT NULL,
    "address" "text",
    "gps_lat" numeric,
    "gps_lng" numeric,
    "geofence_radius_m" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "backwash_mode" "text" DEFAULT 'independent'::"text" NOT NULL,
    "filter_media_type" "text" DEFAULT 'AFM'::"text" NOT NULL,
    "filter_housing_type" "text" DEFAULT 'Cartridge Filter'::"text" NOT NULL,
    "has_solar" boolean DEFAULT false NOT NULL,
    "has_grid" boolean DEFAULT true NOT NULL,
    "solar_capacity_kw" numeric(12,2),
    CONSTRAINT "plants_backwash_mode_check" CHECK (("backwash_mode" = ANY (ARRAY['independent'::"text", 'synchronized'::"text"]))),
    CONSTRAINT "plants_filter_housing_type_check" CHECK (("filter_housing_type" = ANY (ARRAY['Cartridge Filter'::"text", 'Bag Filter'::"text"]))),
    CONSTRAINT "plants_filter_media_type_check" CHECK (("filter_media_type" = ANY (ARRAY['AFM'::"text", 'MMF'::"text"])))
);


ALTER TABLE "public"."plants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."plants"."filter_media_type" IS 'Default filter media for this plant: AFM | MMF';



COMMENT ON COLUMN "public"."plants"."filter_housing_type" IS 'Default filter housing type: Cartridge Filter | Bag Filter';



COMMENT ON COLUMN "public"."plants"."has_solar" IS 'Plant has rooftop / hybrid solar generation';



COMMENT ON COLUMN "public"."plants"."has_grid" IS 'Plant draws power from utility grid';



CREATE TABLE IF NOT EXISTS "public"."ro_pretreatment_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "train_id" "uuid" NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "backwash_start" timestamp with time zone,
    "backwash_end" timestamp with time zone,
    "mmf_readings" "jsonb" DEFAULT '[]'::"jsonb",
    "booster_pumps" "jsonb" DEFAULT '[]'::"jsonb",
    "afm_units" "jsonb" DEFAULT '[]'::"jsonb",
    "hpp_target_pressure_psi" numeric,
    "filter_housings" "jsonb" DEFAULT '[]'::"jsonb",
    "bag_filters_changed" integer DEFAULT 0,
    "remarks" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cartridge_filter_housings" "jsonb" DEFAULT '[]'::"jsonb",
    "incomplete_reason" "text",
    "cartridges_changed" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "ro_pretreatment_readings_cartridges_changed_check" CHECK (("cartridges_changed" >= 0))
);


ALTER TABLE "public"."ro_pretreatment_readings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ro_pretreatment_readings"."incomplete_reason" IS 'Operator-supplied reason for leaving one or more required pre-treatment fields blank. NULL when the reading was fully complete.';



CREATE TABLE IF NOT EXISTS "public"."ro_trains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "train_number" integer NOT NULL,
    "name" "text",
    "status" "public"."train_status" DEFAULT 'Running'::"public"."train_status" NOT NULL,
    "num_afm" integer DEFAULT 0 NOT NULL,
    "num_booster_pumps" integer DEFAULT 0 NOT NULL,
    "num_hp_pumps" integer DEFAULT 0 NOT NULL,
    "num_cartridge_filters" integer DEFAULT 0 NOT NULL,
    "num_filter_housings" integer DEFAULT 0 NOT NULL,
    "num_controllers" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "filter_media_type" "text",
    "filter_housing_type" "text",
    "shared_power_meter_group" "text",
    "well_id" "uuid",
    "product_meter_id" "uuid",
    "feed_meter_brand" "text",
    "feed_meter_size" "text",
    "feed_meter_serial" "text",
    "feed_meter_installed_date" "date",
    "permeate_meter_brand" "text",
    "permeate_meter_size" "text",
    "permeate_meter_serial" "text",
    "permeate_meter_installed_date" "date",
    "reject_meter_brand" "text",
    "reject_meter_size" "text",
    "reject_meter_serial" "text",
    "reject_meter_installed_date" "date",
    "booster_pump_targets" "jsonb",
    "unit_type" "text" DEFAULT 'primary'::"text" NOT NULL,
    "feed_source_train_id" "uuid",
    "reject_routing" "text" DEFAULT 'discharge'::"text" NOT NULL,
    "hpp_target_pressure_psi" numeric,
    CONSTRAINT "ro_trains_filter_housing_type_check" CHECK (("filter_housing_type" = ANY (ARRAY['Cartridge Filter'::"text", 'Bag Filter'::"text"]))),
    CONSTRAINT "ro_trains_filter_media_type_check" CHECK (("filter_media_type" = ANY (ARRAY['AFM'::"text", 'MMF'::"text"]))),
    CONSTRAINT "ro_trains_no_self_feed" CHECK ((("feed_source_train_id" IS NULL) OR ("feed_source_train_id" <> "id"))),
    CONSTRAINT "ro_trains_reject_routing_check" CHECK (("reject_routing" = ANY (ARRAY['discharge'::"text", 'recirculate'::"text"]))),
    CONSTRAINT "ro_trains_secondary_needs_feed_source" CHECK (((("unit_type" = 'primary'::"text") AND ("feed_source_train_id" IS NULL)) OR (("unit_type" = 'secondary'::"text") AND ("feed_source_train_id" IS NOT NULL)))),
    CONSTRAINT "ro_trains_unit_type_check" CHECK (("unit_type" = ANY (ARRAY['primary'::"text", 'secondary'::"text"])))
);


ALTER TABLE "public"."ro_trains" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ro_trains"."filter_media_type" IS 'Per-train filter media override (null = inherit from plant)';



COMMENT ON COLUMN "public"."ro_trains"."filter_housing_type" IS 'Per-train filter housing override (null = inherit from plant)';



COMMENT ON COLUMN "public"."ro_trains"."shared_power_meter_group" IS 'Trains with the same non-null label share one physical power meter. NULL = dedicated meter (or no per-train meter). Example: set "colbox" on Umapad Colbox trains 1, 2 and 3.';



COMMENT ON COLUMN "public"."ro_trains"."well_id" IS 'FK → wells.id. Identifies the source well for this RO train. When set, Dashboard shows the well name instead of the train name in "Per Well Source" quality cards (Raw TDS, Raw NTU).';



COMMENT ON COLUMN "public"."ro_trains"."feed_meter_serial" IS 'Current feed-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''feed'').';



COMMENT ON COLUMN "public"."ro_trains"."permeate_meter_serial" IS 'Current permeate-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''permeate'').';



COMMENT ON COLUMN "public"."ro_trains"."reject_meter_serial" IS 'Current reject-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''reject'').';



COMMENT ON COLUMN "public"."ro_trains"."booster_pump_targets" IS 'Per-pump target setpoints for this train''s booster pumps, configured once in Train Settings. Shape: {"psi_mode": bool, "targets": {"<unit>": number}}. Auto-fills and locks the corresponding psi/Hz field on every pre-treatment/RO reading; amperage stays per-reading (a real measurement, not a setpoint). A unit missing from targets, or a null column, falls back to the fully-editable per-reading input.';



COMMENT ON COLUMN "public"."ro_trains"."unit_type" IS 'primary = fed by wells via the shared feed meter (every train, pre-migration). secondary = a polishing/2nd-pass RO fed by another train''s permeate (e.g. Potable-RO, Refilling-RO at Guizo).';



COMMENT ON COLUMN "public"."ro_trains"."feed_source_train_id" IS 'For unit_type=secondary only: the upstream train whose permeate feeds this unit. NULL for primary trains. Same-plant and no-cycle enforced by fn_validate_ro_train_feed_source below.';



COMMENT ON COLUMN "public"."ro_trains"."reject_routing" IS 'discharge = reject goes to waste/drain (default, today''s behaviour for every existing train). recirculate = reject is physically piped back into feed_source_train_id''s permeate stream. A recirculate reject volume was already measured once as part of feed_source_train_id''s own permeate meter and must never be added again anywhere in a production or loss total.';



COMMENT ON COLUMN "public"."ro_trains"."hpp_target_pressure_psi" IS 'High-Pressure Pump target operating pressure (psi), configured once per train in Train Settings. Auto-fills the HPP Target Pressure field on every pre-treatment/RO reading for this train until changed here.';



CREATE OR REPLACE VIEW "public"."filter_usage_daily" WITH ("security_invoker"='true') AS
 SELECT "r"."id",
    "r"."plant_id",
    "r"."train_id",
    ("r"."reading_datetime")::"date" AS "reading_date",
    COALESCE("rt"."filter_housing_type", "p"."filter_housing_type") AS "filter_housing_type",
        CASE COALESCE("rt"."filter_housing_type", "p"."filter_housing_type")
            WHEN 'Bag Filter'::"text" THEN "r"."bag_filters_changed"
            ELSE "r"."cartridges_changed"
        END AS "quantity_changed",
        CASE COALESCE("rt"."filter_housing_type", "p"."filter_housing_type")
            WHEN 'Bag Filter'::"text" THEN (("r"."bag_filters_changed")::numeric * COALESCE("public"."fn_filter_unit_price"("p"."id", 'Bag Filter'::"text", ("r"."reading_datetime")::"date"), (0)::numeric))
            ELSE (("r"."cartridges_changed")::numeric * COALESCE("public"."fn_filter_unit_price"("p"."id", 'Cartridge Filter'::"text", ("r"."reading_datetime")::"date"), (0)::numeric))
        END AS "cost"
   FROM (("public"."ro_pretreatment_readings" "r"
     JOIN "public"."plants" "p" ON (("p"."id" = "r"."plant_id")))
     LEFT JOIN "public"."ro_trains" "rt" ON (("rt"."id" = "r"."train_id")));


ALTER VIEW "public"."filter_usage_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_analysis" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid",
    "actor_label" "text",
    "plant_id" "uuid",
    "filename" "text" NOT NULL,
    "file_kind" "text",
    "file_size" integer,
    "ai_provider" "text",
    "ai_model" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "wellmeter_detected" boolean DEFAULT false NOT NULL,
    "tables" "jsonb" NOT NULL,
    "decisions" "jsonb",
    "reason" "text",
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "sync_summary" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_analysis_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'synced'::"text", 'rejected'::"text", 'partial'::"text"])))
);


ALTER TABLE "public"."import_analysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "plant_id" "uuid",
    "module" "text",
    "file_name" "text",
    "row_count" integer,
    "schema_valid" boolean,
    "schema_errors" "jsonb",
    "timestamp" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."import_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "incident_ref" "text",
    "incident_type" "text",
    "severity" "public"."severity_level",
    "status" "public"."incident_status" DEFAULT 'Open'::"public"."incident_status" NOT NULL,
    "what_description" "text",
    "where_location" "text",
    "gps_lat" numeric,
    "gps_lng" numeric,
    "when_datetime" timestamp with time zone,
    "who_reporter" "uuid",
    "witness" "text",
    "weather" "text",
    "temperature_c" numeric,
    "immediate_action" "text",
    "photo_url" "text",
    "root_cause" "text",
    "corrective_action" "text",
    "preventive_measures" "text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "closed_by" "uuid",
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locator_derived_review_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "locator_id" "uuid" NOT NULL,
    "date_key" "date" NOT NULL,
    "flagged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone
);


ALTER TABLE "public"."locator_derived_review_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locator_meter_replacements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "locator_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "replacement_date" "date" NOT NULL,
    "old_meter_brand" "text",
    "old_meter_size" "text",
    "old_meter_serial" "text",
    "old_meter_final_reading" numeric,
    "new_meter_brand" "text",
    "new_meter_size" "text",
    "new_meter_serial" "text",
    "new_meter_initial_reading" numeric,
    "new_meter_installed_date" "date",
    "replaced_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reading_id" "uuid"
);


ALTER TABLE "public"."locator_meter_replacements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locator_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "locator_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "current_reading" numeric NOT NULL,
    "previous_reading" numeric,
    "daily_volume" numeric,
    "gps_lat" numeric,
    "gps_lng" numeric,
    "off_location_flag" boolean DEFAULT false NOT NULL,
    "recorded_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_meter_replacement" boolean DEFAULT false,
    "is_estimated" boolean DEFAULT false NOT NULL,
    "norm_status" "text" DEFAULT 'normal'::"text",
    "locked_at" timestamp with time zone,
    "locked_by" "uuid",
    "is_meter_rollover" boolean DEFAULT false NOT NULL,
    "meter_rollover_max" numeric,
    CONSTRAINT "locator_readings_norm_status_check" CHECK (("norm_status" = ANY (ARRAY['normal'::"text", 'pending_review'::"text", 'erroneous'::"text", 'normalized'::"text", 'retracted'::"text"])))
);


ALTER TABLE "public"."locator_readings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."locator_readings"."is_meter_replacement" IS 'Marks this reading as taken right after a physical meter swap, so its computed daily_volume (current_reading - previous_reading, which would otherwise span two different physical meters) is zeroed/ignored in production totals rather than showing a bogus spike or drop. Mirrors well_readings.is_meter_replacement and blending_events.is_meter_replacement.';



COMMENT ON COLUMN "public"."locator_readings"."is_estimated" IS 'TRUE when this row was auto-generated by the poly-regression-fill Edge Function (runs at 14:00 PHT daily for locators with no reading that day). Replaced automatically when an operator enters an actual reading.';



CREATE OR REPLACE VIEW "public"."locator_readings_clean" WITH ("security_invoker"='true') AS
 SELECT "id",
    "locator_id",
    "plant_id",
    "reading_datetime",
    "current_reading",
    "previous_reading",
    "daily_volume",
    "gps_lat",
    "gps_lng",
    "off_location_flag",
    "recorded_by",
    "remarks",
    "created_at",
    "is_meter_replacement",
    "is_estimated",
    "norm_status",
    "locked_at",
    "locked_by",
    "is_meter_rollover",
    "meter_rollover_max"
   FROM "public"."locator_readings"
  WHERE ("off_location_flag" = false);


ALTER VIEW "public"."locator_readings_clean" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."locator_readings_latest" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("locator_id") "id",
    "locator_id",
    "plant_id",
    "reading_datetime",
    "current_reading",
    "previous_reading",
    "daily_volume",
    "gps_lat",
    "gps_lng",
    "off_location_flag",
    "recorded_by",
    "remarks",
    "created_at",
    "is_meter_replacement",
    "is_estimated",
    "norm_status",
    "locked_at",
    "locked_by",
    "is_meter_rollover",
    "meter_rollover_max"
   FROM "public"."locator_readings"
  WHERE (("norm_status" IS NULL) OR ("norm_status" <> ALL (ARRAY['retracted'::"text", 'pending_review'::"text"])))
  ORDER BY "locator_id", "reading_datetime" DESC;


ALTER VIEW "public"."locator_readings_latest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "location_desc" "text",
    "address" "text",
    "gps_lat" numeric,
    "gps_lng" numeric,
    "meter_brand" "text",
    "meter_size" "text",
    "meter_serial" "text",
    "meter_installed_date" "date",
    "status" "public"."plant_status" DEFAULT 'Active'::"public"."plant_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_meter_id" "uuid",
    "is_derived" boolean DEFAULT false NOT NULL,
    "derived_from_meter_id" "uuid",
    "default_input_mode" "text" DEFAULT 'raw'::"text" NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    CONSTRAINT "locators_default_input_mode_check" CHECK (("default_input_mode" = ANY (ARRAY['raw'::"text", 'direct'::"text"]))),
    CONSTRAINT "locators_derived_requires_mother_meter" CHECK (((NOT "is_derived") OR ("derived_from_meter_id" IS NOT NULL)))
);


ALTER TABLE "public"."locators" OWNER TO "postgres";


COMMENT ON COLUMN "public"."locators"."default_input_mode" IS 'raw = operator enters the cumulative meter reading (delta computed by the DB). direct = operator enters the day''s volume directly. Set once per locator by Manager/Admin in Plant config; Operations reads this instead of a per-device localStorage toggle.';



COMMENT ON COLUMN "public"."locators"."is_locked" IS 'Meter is padlocked/sealed or physically disconnected — independent of status (Active/Inactive). Unlike status=Inactive, this column is never filtered on when loading locators for reading entry — operators must keep being able to log readings against a locked meter so movement can be caught. See the 20260727 hamas migrations for the sibling review-flag pattern this feature follows.';



COMMENT ON CONSTRAINT "locators_derived_requires_mother_meter" ON "public"."locators" IS 'A derived locator with no mother meter is silently invisible to fn_sweep_derived_meters() (it filters on is_derived=true AND derived_from_meter_id IS NOT NULL) — this makes that state impossible to save instead of failing quietly. Added alongside the Locator-dialog derive toggle in 20260728 (LocatorDialogs.tsx).';



CREATE TABLE IF NOT EXISTS "public"."login_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "user_id" "uuid",
    "success" boolean NOT NULL,
    "error_reason" "text",
    "user_agent" "text",
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."login_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."migration_state" (
    "filename" "text" NOT NULL,
    "manual_override" "jsonb",
    "apply_history" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."migration_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plant_id" "uuid",
    "alert_type" "text" NOT NULL,
    "severity" "public"."severity_level" DEFAULT 'Medium'::"public"."severity_level" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text",
    "link_path" "text",
    "read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dismissed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."well_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "well_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "current_reading" numeric,
    "previous_reading" numeric,
    "daily_volume" numeric,
    "power_meter_reading" numeric,
    "gps_lat" numeric,
    "gps_lng" numeric,
    "off_location_flag" boolean DEFAULT false NOT NULL,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_meter_replacement" boolean DEFAULT false,
    "norm_status" "text" DEFAULT 'normal'::"text",
    "tds_ppm" numeric(10,2) DEFAULT NULL::numeric,
    "pressure_psi" numeric(10,2) DEFAULT NULL::numeric,
    "daily_power_kwh" numeric,
    "turbidity_ntu" numeric,
    "locked_at" timestamp with time zone,
    "locked_by" "uuid",
    "is_meter_rollover" boolean DEFAULT false NOT NULL,
    "meter_rollover_max" numeric,
    "is_estimated" boolean DEFAULT false NOT NULL,
    CONSTRAINT "well_readings_norm_status_check" CHECK (("norm_status" = ANY (ARRAY['normal'::"text", 'pending_review'::"text", 'erroneous'::"text", 'normalized'::"text", 'retracted'::"text"])))
);


ALTER TABLE "public"."well_readings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."well_readings"."is_meter_replacement" IS 'True when this reading immediately follows a physical meter swap. daily_volume is treated as 0 for this row.';



COMMENT ON COLUMN "public"."well_readings"."tds_ppm" IS 'Total dissolved solids in parts-per-million. Measured at point of well discharge.';



COMMENT ON COLUMN "public"."well_readings"."pressure_psi" IS 'Wellhead pressure in pounds per square inch.';



COMMENT ON COLUMN "public"."well_readings"."daily_power_kwh" IS 'kWh consumed since the previous well reading (power_meter_reading delta). NULL if this well has no power meter or if it is the first reading in the chain.';



COMMENT ON COLUMN "public"."well_readings"."turbidity_ntu" IS 'Water turbidity in Nephelometric Turbidity Units.';



CREATE OR REPLACE VIEW "public"."operator_error_rates_30d" WITH ("security_invoker"='true') AS
 SELECT "up"."id" AS "user_id",
    "up"."username",
    "count"("wr"."id") AS "error_count",
    "max"("wr"."reading_datetime") AS "last_error"
   FROM ("public"."user_profiles" "up"
     LEFT JOIN "public"."well_readings" "wr" ON ((("wr"."recorded_by" = "up"."id") AND ("wr"."reading_datetime" >= ("now"() - '30 days'::interval)) AND ("wr"."off_location_flag" = true))))
  GROUP BY "up"."id", "up"."username";


ALTER VIEW "public"."operator_error_rates_30d" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_switch_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid",
    "from_operator_id" "uuid",
    "to_operator_id" "uuid",
    "switched_by" "uuid",
    "switched_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."operator_switch_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."opex_budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "budget_month" "date" NOT NULL,
    "power_budget" numeric DEFAULT 0 NOT NULL,
    "chem_budget" numeric DEFAULT 0 NOT NULL,
    "total_budget" numeric GENERATED ALWAYS AS (("power_budget" + "chem_budget")) STORED,
    "notes" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "opex_budgets_month_is_first_of_month" CHECK (("budget_month" = ("date_trunc"('month'::"text", ("budget_month")::timestamp with time zone))::"date")),
    CONSTRAINT "opex_budgets_non_negative" CHECK ((("power_budget" >= (0)::numeric) AND ("chem_budget" >= (0)::numeric)))
);


ALTER TABLE "public"."opex_budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plant_assignment_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "admin_id" "uuid",
    "new_plant_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "justification" "text",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."plant_assignment_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plant_edit_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "field_changed" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."plant_edit_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plant_meter_config" (
    "plant_id" "uuid" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "permeate_is_production" boolean DEFAULT false NOT NULL,
    CONSTRAINT "plant_meter_config_ro_production_source_check" CHECK (((("config" ->> 'ro_production_source'::"text") IS NULL) OR (("config" ->> 'ro_production_source'::"text") = ANY (ARRAY['product'::"text", 'permeate'::"text", 'both'::"text"]))))
);


ALTER TABLE "public"."plant_meter_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."plant_meter_config" IS 'One row per plant. `config` is the full PlantMeterConfig JSON blob (frontend/src/pages/plants/shared.tsx) — the source of truth a Manager/Admin edits via Plant Config settings. `permeate_is_production` is a generated-on-write mirror of config->>''permeate_is_production'' (see the trg_sync_permeate_is_production trigger below) kept as a real column purely so dashboard queries can filter/select it without unpacking JSON.';



CREATE TABLE IF NOT EXISTS "public"."plant_multiplier_cache" (
    "plant_id" "uuid" NOT NULL,
    "meter_index" integer DEFAULT 1 NOT NULL,
    "effective_mult" numeric DEFAULT 1 NOT NULL,
    "cached_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invalidated" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."plant_multiplier_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plant_power_config" (
    "plant_id" "uuid" NOT NULL,
    "solar_meter_count" integer DEFAULT 1 NOT NULL,
    "solar_meter_names" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "grid_meter_count" integer DEFAULT 1 NOT NULL,
    "grid_meter_names" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "grid_meter_multipliers" numeric[] DEFAULT '{}'::numeric[] NOT NULL
);


ALTER TABLE "public"."plant_power_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."plant_power_config"."grid_meter_multipliers" IS 'Per-meter CT multiplier. Index matches grid_meter_names. Consumption = (current_reading - previous_reading) × multiplier[i]. Empty array or missing index defaults to 1.';



CREATE TABLE IF NOT EXISTS "public"."plant_topology_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "from_id" "text" NOT NULL,
    "to_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."plant_topology_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."power_meter_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "meter_index" integer DEFAULT 0 NOT NULL,
    "change_date" "date" NOT NULL,
    "old_multiplier" numeric DEFAULT 1 NOT NULL,
    "new_multiplier" numeric DEFAULT 1 NOT NULL,
    "notes" "text",
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "old_meter_final_reading" numeric,
    "new_meter_initial_reading" numeric,
    "reading_id" "uuid"
);


ALTER TABLE "public"."power_meter_changes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."power_meter_changes"."old_meter_final_reading" IS 'Cumulative kWh the OLD physical meter last read before it was swapped out. Required in the UI.';



COMMENT ON COLUMN "public"."power_meter_changes"."new_meter_initial_reading" IS 'Cumulative kWh the NEW physical meter read at install. Required in the UI; becomes meter_reading_kwh on the swap-point power_readings row.';



COMMENT ON COLUMN "public"."power_meter_changes"."reading_id" IS 'The power_readings row this change produced (live swap) or was retroactively flagged against (history edit).';



CREATE TABLE IF NOT EXISTS "public"."power_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "meter_reading_kwh" numeric,
    "daily_consumption_kwh" numeric,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "daily_solar_kwh" numeric(14,2) DEFAULT 0,
    "daily_grid_kwh" numeric(14,2) DEFAULT 0,
    "multiplier" numeric(10,4) DEFAULT 1,
    "is_meter_replacement" boolean DEFAULT false,
    "solar_meter_reading" numeric,
    "meter_multiplier" numeric DEFAULT 1,
    "grid_meter_readings" "jsonb" DEFAULT '{}'::"jsonb",
    "cache_recalculated_at" timestamp with time zone,
    "is_estimated" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."power_readings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."power_readings"."meter_reading_kwh" IS 'Legacy meter-0 cumulative kWh, kept for backward compatibility with dashboards, the CSV importer, and anything else not yet migrated to grid_meter_readings. Nullable since a multi-meter plant''s backfilled row may not include meter 0''s reading at all (e.g. only meters 2/3 entered) — grid_meter_readings is the source of truth. Every trigger reading this column already null-guards it (fn_power_readings_before_upsert, fn_trg_recalc_successor); this just aligns the column constraint with that existing design.';



COMMENT ON COLUMN "public"."power_readings"."daily_solar_kwh" IS 'kWh produced from solar on this reading''s day (0 if plant has no solar)';



COMMENT ON COLUMN "public"."power_readings"."daily_grid_kwh" IS 'kWh drawn from grid on this reading''s day (0 if plant is off-grid)';



COMMENT ON COLUMN "public"."power_readings"."meter_multiplier" IS 'CT multiplier that was active for this reading''s grid meter at save time. Consumption = (current - previous) × meter_multiplier.';



COMMENT ON COLUMN "public"."power_readings"."grid_meter_readings" IS 'Per-meter cumulative kWh readings keyed by zero-based meter index, e.g. {"0": 12345.6, "1": 98765.4}.  meter_reading_kwh mirrors key "0" for backward compatibility with dashboards and the CSV importer.';



CREATE TABLE IF NOT EXISTS "public"."power_tariffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "effective_date" "date" NOT NULL,
    "rate_per_kwh" numeric NOT NULL,
    "multiplier" numeric DEFAULT 1 NOT NULL,
    "provider" "text",
    "remarks" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."power_tariffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_meter_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid",
    "meter_id" "text",
    "meter_name" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "user_id" "uuid",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_meter_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_meter_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "current_reading" numeric(14,4),
    "previous_reading" numeric(14,4),
    "production_volume" numeric(14,4) GENERATED ALWAYS AS (
CASE
    WHEN ("previous_reading" IS NOT NULL) THEN ("current_reading" - "previous_reading")
    ELSE NULL::numeric
END) STORED,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "daily_volume" numeric,
    "is_meter_replacement" boolean DEFAULT false,
    "norm_status" "text" DEFAULT 'normal'::"text",
    "locked_at" timestamp with time zone,
    "locked_by" "uuid",
    "is_meter_rollover" boolean DEFAULT false NOT NULL,
    "meter_rollover_max" numeric,
    "is_estimated" boolean DEFAULT false NOT NULL,
    CONSTRAINT "product_meter_readings_norm_status_check" CHECK (("norm_status" = ANY (ARRAY['normal'::"text", 'pending_review'::"text", 'erroneous'::"text", 'normalized'::"text", 'retracted'::"text"])))
);


ALTER TABLE "public"."product_meter_readings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."product_meter_readings"."is_meter_replacement" IS 'True when this reading immediately follows a physical meter swap. daily_volume is treated as 0 for this row.';



CREATE OR REPLACE VIEW "public"."product_meter_readings_clean" WITH ("security_invoker"='true') AS
 SELECT "id",
    "meter_id",
    "plant_id",
    "current_reading",
    "previous_reading",
    "production_volume",
    "reading_datetime",
    "recorded_by",
    "created_at",
    "daily_volume",
    "is_meter_replacement",
    "norm_status",
    "locked_at",
    "locked_by",
    "is_meter_rollover",
    "meter_rollover_max"
   FROM "public"."product_meter_readings";


ALTER VIEW "public"."product_meter_readings_clean" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."product_meter_readings_latest" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("meter_id") "id",
    "meter_id",
    "plant_id",
    "current_reading",
    "previous_reading",
    "production_volume",
    "reading_datetime",
    "recorded_by",
    "created_at",
    "daily_volume",
    "is_meter_replacement",
    "norm_status",
    "locked_at",
    "locked_by",
    "is_meter_rollover",
    "meter_rollover_max",
    "is_estimated"
   FROM "public"."product_meter_readings"
  WHERE (("norm_status" IS NULL) OR ("norm_status" <> ALL (ARRAY['retracted'::"text", 'pending_review'::"text"])))
  ORDER BY "meter_id", "reading_datetime" DESC;


ALTER VIEW "public"."product_meter_readings_latest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_meter_replacements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "reading_id" "uuid",
    "replacement_date" "date" NOT NULL,
    "old_meter_brand" "text",
    "old_meter_size" "text",
    "old_meter_serial" "text",
    "old_meter_final_reading" numeric,
    "new_meter_brand" "text",
    "new_meter_size" "text",
    "new_meter_serial" "text",
    "new_meter_initial_reading" numeric,
    "new_meter_installed_date" "date",
    "replaced_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_meter_replacements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_meters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "is_derived" boolean DEFAULT false NOT NULL,
    "derived_from_locator_id" "uuid",
    "meter_serial" character varying(100),
    CONSTRAINT "product_meters_derived_consistency" CHECK ((("derived_from_locator_id" IS NULL) OR ("is_derived" = true))),
    CONSTRAINT "product_meters_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Inactive'::"text"])))
);


ALTER TABLE "public"."product_meters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."production_calc_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid",
    "meter_id" "text",
    "meter_name" "text",
    "entry_name" "text",
    "production_volume" numeric(14,4) NOT NULL,
    "user_id" "uuid",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."production_calc_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."production_costs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "cost_date" "date" NOT NULL,
    "chem_cost" numeric DEFAULT 0 NOT NULL,
    "power_cost" numeric DEFAULT 0 NOT NULL,
    "production_m3" numeric DEFAULT 0 NOT NULL,
    "cost_per_m3" numeric,
    "driver_notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "filter_cost" numeric(14,2) DEFAULT 0 NOT NULL,
    "solar_cost" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_cost" numeric(14,2) GENERATED ALWAYS AS ((("chem_cost" + "power_cost") + "filter_cost")) STORED
);


ALTER TABLE "public"."production_costs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."production_costs"."solar_cost" IS 'Notional cost of solar kWh generated this day, priced at the same php/kWh grid tariff. Solar is not actually billed — deliberately NOT included in total_cost.';



CREATE TABLE IF NOT EXISTS "public"."pump_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "pump_type" "text" NOT NULL,
    "pump_number" integer NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_pressure_psi" numeric,
    "l1_amp" numeric,
    "l2_amp" numeric,
    "l3_amp" numeric,
    "voltage" numeric,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pump_readings_pump_type_check" CHECK (("pump_type" = ANY (ARRAY['Booster'::"text", 'HighPressure'::"text"])))
);


ALTER TABLE "public"."pump_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."raw_edit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "column_name" "text" NOT NULL,
    "old_value" numeric,
    "new_value" numeric,
    "edited_by" "uuid",
    "edited_role" "text" NOT NULL,
    "edited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "public"."raw_edit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_anomaly_remarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "meter_kind" "text",
    "plant_id" "uuid" NOT NULL,
    "tier" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "deviation_pct" numeric NOT NULL,
    "flow_rate" numeric,
    "avg_flow_rate" numeric,
    "rate_unit" "text" DEFAULT 'm3/hr'::"text" NOT NULL,
    "remark_text" "text" NOT NULL,
    "logged_by" "uuid",
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reading_anomaly_remarks_direction_check" CHECK (("direction" = ANY (ARRAY['high'::"text", 'low'::"text"]))),
    CONSTRAINT "reading_anomaly_remarks_meter_kind_check" CHECK (("meter_kind" = ANY (ARRAY['feed'::"text", 'permeate'::"text", 'reject'::"text"]))),
    CONSTRAINT "reading_anomaly_remarks_rate_unit_check" CHECK (("rate_unit" = ANY (ARRAY['m3/hr'::"text", 'm3/day'::"text", 'kwh/hr'::"text"]))),
    CONSTRAINT "reading_anomaly_remarks_remark_text_check" CHECK (("char_length"("btrim"("remark_text")) > 0)),
    CONSTRAINT "reading_anomaly_remarks_table_name_check" CHECK (("table_name" = ANY (ARRAY['locator_readings'::"text", 'well_readings'::"text", 'product_meter_readings'::"text", 'blending_events'::"text", 'power_readings'::"text", 'ro_train_readings'::"text"]))),
    CONSTRAINT "reading_anomaly_remarks_tier_check" CHECK (("tier" = ANY (ARRAY['needs_remark'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."reading_anomaly_remarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_edit_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid",
    "plant_id" "uuid",
    "train_id" "uuid",
    "action" "text" DEFAULT 'update'::"text" NOT NULL,
    "actor_user_id" "uuid",
    "actor_label" "text",
    "changes" "jsonb",
    "edited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text",
    CONSTRAINT "reading_edit_audit_log_action_check" CHECK (("action" = ANY (ARRAY['update'::"text", 'delete'::"text", 'import'::"text"]))),
    CONSTRAINT "reading_edit_audit_log_record_id_required" CHECK ((("action" = 'import'::"text") OR ("record_id" IS NOT NULL))),
    CONSTRAINT "reading_edit_audit_log_table_name_check" CHECK (("table_name" = ANY (ARRAY['ro_train_readings'::"text", 'ro_pretreatment_readings'::"text", 'chemical_dosing_logs'::"text", 'cip_logs'::"text", 'locator_readings'::"text", 'power_readings'::"text", 'blending_events'::"text", 'well_readings'::"text"])))
);


ALTER TABLE "public"."reading_edit_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_gap_reasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "gap_date" "date" NOT NULL,
    "reason_category" "text" NOT NULL,
    "reason_detail" "text",
    "logged_by" "uuid",
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reading_gap_reasons_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['well'::"text", 'locator'::"text", 'ro_train'::"text", 'blending'::"text", 'product'::"text", 'power'::"text"]))),
    CONSTRAINT "reading_gap_reasons_reason_category_check" CHECK (("reason_category" = ANY (ARRAY['pump_problem'::"text", 'locked_meter'::"text", 'disconnected_meter'::"text", 'equipment_malfunction'::"text", 'maintenance'::"text", 'access_issue'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."reading_gap_reasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_normalizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "action" "public"."reading_norm_action" NOT NULL,
    "original_value" numeric,
    "adjusted_value" numeric,
    "note" "text",
    "performed_by" "uuid",
    "performed_role" "text" NOT NULL,
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retractable" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."reading_normalizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regression_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text" NOT NULL,
    "column_name" "text" NOT NULL,
    "plant_id" "uuid",
    "date_from" "date",
    "date_to" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "created_role" "text" DEFAULT 'Data Analyst'::"text" NOT NULL,
    "row_count" integer DEFAULT 0 NOT NULL,
    "r_squared" numeric,
    "slope" numeric,
    "intercept" numeric,
    "corrections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "truncated" boolean DEFAULT false NOT NULL,
    "outlier_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "regression_results_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'applied'::"text", 'retracted'::"text"])))
);


ALTER TABLE "public"."regression_results" OWNER TO "postgres";


COMMENT ON COLUMN "public"."regression_results"."truncated" IS 'True when the source date range had more rows than the regression row cap (see ROW_LIMIT in regression_service.py) — the fitted line only reflects the first ROW_LIMIT rows in chronological order.';



CREATE TABLE IF NOT EXISTS "public"."ro_plant_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'operator'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ro_plant_users_role_check" CHECK (("role" = ANY (ARRAY['operator'::"text", 'manager'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."ro_plant_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ro_plants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "location" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ro_plants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ro_train_data_gaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "source_table" "text" NOT NULL,
    "gap_start_at" timestamp with time zone NOT NULL,
    "gap_end_at" timestamp with time zone NOT NULL,
    "missed_hours" integer NOT NULL,
    "reason_category" "text" NOT NULL,
    "reason_detail" "text",
    "logged_by" "uuid",
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ro_train_data_gaps_missed_hours_check" CHECK (("missed_hours" > 0)),
    CONSTRAINT "ro_train_data_gaps_reason_category_check" CHECK (("reason_category" = ANY (ARRAY['pump_problem'::"text", 'locked_meter'::"text", 'equipment_malfunction'::"text", 'maintenance'::"text", 'access_issue'::"text", 'other'::"text"]))),
    CONSTRAINT "ro_train_data_gaps_source_table_check" CHECK (("source_table" = ANY (ARRAY['ro_train_readings'::"text", 'ro_pretreatment_readings'::"text"])))
);


ALTER TABLE "public"."ro_train_data_gaps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ro_train_meter_replacements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "reading_id" "uuid",
    "meter_type" "text" NOT NULL,
    "replacement_date" "date" NOT NULL,
    "old_meter_serial" "text",
    "old_meter_final_reading" numeric,
    "new_meter_brand" "text",
    "new_meter_size" "text",
    "new_meter_serial" "text",
    "new_meter_initial_reading" numeric,
    "new_meter_installed_date" "date",
    "replaced_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ro_train_meter_replacements_meter_type_check" CHECK (("meter_type" = ANY (ARRAY['feed'::"text", 'permeate'::"text", 'reject'::"text"])))
);


ALTER TABLE "public"."ro_train_meter_replacements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ro_train_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "reading_datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "feed_meter" numeric,
    "permeate_meter" numeric,
    "reject_meter" numeric,
    "feed_flow" numeric,
    "permeate_flow" numeric,
    "reject_flow" numeric,
    "suction_pressure_psi" numeric,
    "feed_pressure_psi" numeric,
    "reject_pressure_psi" numeric,
    "dp_psi" numeric,
    "recovery_pct" numeric,
    "rejection_pct" numeric,
    "salt_passage_pct" numeric,
    "feed_tds" numeric,
    "permeate_tds" numeric,
    "reject_tds" numeric,
    "feed_ph" numeric,
    "permeate_ph" numeric,
    "reject_ph" numeric,
    "turbidity_ntu" numeric,
    "temperature_c" numeric,
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "power_meter_reading_kwh" numeric(12,3) DEFAULT NULL::numeric,
    "power_delta_kwh" numeric(12,3) DEFAULT NULL::numeric,
    "power_avg_kw" numeric(10,3) DEFAULT NULL::numeric,
    "specific_energy_kwh_m3" numeric(10,4) DEFAULT NULL::numeric,
    "shared_power_meter_group" "text",
    "permeate_meter_prev" numeric,
    "permeate_meter_delta" numeric,
    "permeate_production_date" "date",
    "is_meter_replacement" boolean DEFAULT false,
    "norm_status" "text" DEFAULT 'normal'::"text",
    "reject_meter_prev" numeric,
    "reject_meter_delta" numeric,
    "feed_meter_delta" numeric,
    "chlorine_residual_mg_l" numeric(6,3),
    "feed_meter_prev" numeric,
    "remarks" "text",
    "incomplete_reason" "text",
    "is_feed_meter_replacement" boolean DEFAULT false NOT NULL,
    "is_permeate_meter_replacement" boolean DEFAULT false NOT NULL,
    "is_reject_meter_replacement" boolean DEFAULT false NOT NULL,
    "is_estimated" boolean DEFAULT false NOT NULL,
    CONSTRAINT "ro_train_readings_norm_status_check" CHECK (("norm_status" = ANY (ARRAY['normal'::"text", 'pending_review'::"text", 'erroneous'::"text", 'normalized'::"text", 'retracted'::"text"])))
);


ALTER TABLE "public"."ro_train_readings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ro_train_readings"."feed_meter" IS 'Cumulative feed water odometer reading (m³) at time of entry';



COMMENT ON COLUMN "public"."ro_train_readings"."permeate_meter" IS 'Cumulative permeate odometer reading (m³) at time of entry';



COMMENT ON COLUMN "public"."ro_train_readings"."reject_meter" IS 'Cumulative reject odometer reading (m³) at time of entry';



COMMENT ON COLUMN "public"."ro_train_readings"."power_meter_reading_kwh" IS 'Raw odometer reading from the kWh meter at the time of this log entry. Stored so the next entry can auto-fill "previous reading".';



COMMENT ON COLUMN "public"."ro_train_readings"."power_delta_kwh" IS 'kWh consumed since the previous reading (curr - prev). For shared meters this is the FULL meter delta, not the allocated share.';



COMMENT ON COLUMN "public"."ro_train_readings"."specific_energy_kwh_m3" IS 'Estimated kWh/m³ = power_delta_kwh / permeate_volume_m3. For shared meters this is an over-estimate (full meter ÷ one train permeate). Use the view v_ro_train_power_allocated for the volume-weighted true value.';



COMMENT ON COLUMN "public"."ro_train_readings"."shared_power_meter_group" IS 'Snapshot of ro_trains.shared_power_meter_group at insert time. NULL = this train has a dedicated meter.';



COMMENT ON COLUMN "public"."ro_train_readings"."permeate_meter_prev" IS 'Previous session odometer snapshot — auto-filled by the app';



COMMENT ON COLUMN "public"."ro_train_readings"."permeate_meter_delta" IS 'Volume produced since last reading = permeate_meter − permeate_meter_prev (m³)';



COMMENT ON COLUMN "public"."ro_train_readings"."reject_meter_prev" IS 'Previous session odometer snapshot — auto-filled by the app';



COMMENT ON COLUMN "public"."ro_train_readings"."reject_meter_delta" IS 'Volume produced since last reading = reject_meter − reject_meter_prev (m³)';



COMMENT ON COLUMN "public"."ro_train_readings"."feed_meter_delta" IS 'Volume produced since last reading = feed_meter − feed_meter_prev (m³)';



COMMENT ON COLUMN "public"."ro_train_readings"."chlorine_residual_mg_l" IS 'Product (permeate) chlorine residual measured in mg/L (ppm). Typical acceptable range for potable water: 0.2–5.0 mg/L.';



COMMENT ON COLUMN "public"."ro_train_readings"."feed_meter_prev" IS 'Previous session odometer snapshot — auto-filled by the app';



COMMENT ON COLUMN "public"."ro_train_readings"."incomplete_reason" IS 'Operator-supplied reason for leaving one or more required RO Vessel fields blank. NULL when the reading was fully complete. Does not apply to the EM flow trio or water-meter trio, which intentionally allow one blank stream for auto-inference.';



COMMENT ON COLUMN "public"."ro_train_readings"."is_feed_meter_replacement" IS 'True when this reading immediately follows a feed-meter swap.';



COMMENT ON COLUMN "public"."ro_train_readings"."is_permeate_meter_replacement" IS 'True when this reading immediately follows a permeate-meter swap. permeate_meter_delta is treated as 0 for this row.';



COMMENT ON COLUMN "public"."ro_train_readings"."is_reject_meter_replacement" IS 'True when this reading immediately follows a reject-meter swap.';



CREATE OR REPLACE VIEW "public"."ro_train_readings_clean" WITH ("security_invoker"='true') AS
 SELECT "id",
    "train_id",
    "plant_id",
    "reading_datetime",
    "feed_meter",
    "permeate_meter",
    "reject_meter",
    "feed_flow",
    "permeate_flow",
    "reject_flow",
    "suction_pressure_psi",
    "feed_pressure_psi",
    "reject_pressure_psi",
    "dp_psi",
    "recovery_pct",
    "rejection_pct",
    "salt_passage_pct",
    "feed_tds",
    "permeate_tds",
    "reject_tds",
    "feed_ph",
    "permeate_ph",
    "reject_ph",
    "turbidity_ntu",
    "temperature_c",
    "recorded_by",
    "created_at",
    "power_meter_reading_kwh",
    "power_delta_kwh",
    "power_avg_kw",
    "specific_energy_kwh_m3",
    "shared_power_meter_group",
    "permeate_meter_prev",
    "permeate_meter_delta",
    "permeate_production_date",
    "is_meter_replacement",
    "norm_status",
    "reject_meter_prev",
    "reject_meter_delta",
    "feed_meter_delta",
    "chlorine_residual_mg_l",
    "feed_meter_prev",
    "remarks"
   FROM "public"."ro_train_readings";


ALTER VIEW "public"."ro_train_readings_clean" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ro_train_readings_latest" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("train_id") "id",
    "train_id",
    "plant_id",
    "reading_datetime",
    "feed_meter",
    "permeate_meter",
    "reject_meter",
    "feed_flow",
    "permeate_flow",
    "reject_flow",
    "suction_pressure_psi",
    "feed_pressure_psi",
    "reject_pressure_psi",
    "dp_psi",
    "recovery_pct",
    "rejection_pct",
    "salt_passage_pct",
    "feed_tds",
    "permeate_tds",
    "reject_tds",
    "feed_ph",
    "permeate_ph",
    "reject_ph",
    "turbidity_ntu",
    "temperature_c",
    "recorded_by",
    "created_at",
    "power_meter_reading_kwh",
    "power_delta_kwh",
    "power_avg_kw",
    "specific_energy_kwh_m3",
    "shared_power_meter_group",
    "permeate_meter_prev",
    "permeate_meter_delta",
    "permeate_production_date",
    "is_meter_replacement",
    "norm_status",
    "reject_meter_prev",
    "reject_meter_delta",
    "feed_meter_delta",
    "chlorine_residual_mg_l",
    "feed_meter_prev",
    "remarks",
    "incomplete_reason"
   FROM "public"."ro_train_readings"
  ORDER BY "train_id", "reading_datetime" DESC;


ALTER VIEW "public"."ro_train_readings_latest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signup_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "designation" "text",
    "operator_count" integer,
    "plant_ids" "uuid"[],
    "device_id" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signup_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."status_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."status_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."train_status_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "train_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "reason" "text",
    "confirmed_by" "uuid",
    "confirmed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."train_status_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permission_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "allowed" boolean DEFAULT false NOT NULL,
    "reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_permission_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "custom_role_id" "uuid"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_power_readings_resolved" WITH ("security_invoker"='true') AS
 SELECT "pr"."id",
    "pr"."plant_id",
    "pr"."reading_datetime",
    "pr"."meter_reading_kwh",
    "pr"."daily_consumption_kwh",
    "pr"."recorded_by",
    "pr"."created_at",
    "pr"."daily_solar_kwh",
    "pr"."daily_grid_kwh",
    "pr"."multiplier",
    "pr"."is_meter_replacement",
    "pr"."solar_meter_reading",
    "pr"."meter_multiplier",
    "pr"."grid_meter_readings",
    "pr"."cache_recalculated_at",
    COALESCE("pmc"."effective_mult", "pr"."meter_multiplier", (1)::numeric) AS "resolved_mult",
    ("pr"."daily_grid_kwh" * COALESCE("pmc"."effective_mult", "pr"."meter_multiplier", (1)::numeric)) AS "grid_kwh_final",
    ("pr"."daily_solar_kwh" * COALESCE("pmc"."effective_mult", "pr"."meter_multiplier", (1)::numeric)) AS "solar_kwh_final",
    "pmc"."cached_at",
    "pmc"."invalidated" AS "cache_stale"
   FROM ("public"."power_readings" "pr"
     LEFT JOIN "public"."plant_multiplier_cache" "pmc" ON ((("pmc"."plant_id" = "pr"."plant_id") AND ("pmc"."meter_index" = 1))));


ALTER VIEW "public"."v_power_readings_resolved" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ro_train_power_allocated" WITH ("security_invoker"='true') AS
 WITH "grouped" AS (
         SELECT "r"."id",
            "r"."train_id",
            "r"."plant_id",
            "r"."reading_datetime",
            "r"."shared_power_meter_group",
            "r"."power_delta_kwh",
            "r"."permeate_flow",
            "sum"("r"."permeate_flow") OVER (PARTITION BY "r"."plant_id", "r"."shared_power_meter_group", "r"."reading_datetime") AS "group_permeate_total",
            "max"("r"."power_delta_kwh") OVER (PARTITION BY "r"."plant_id", "r"."shared_power_meter_group", "r"."reading_datetime") AS "group_power_delta_kwh"
           FROM "public"."ro_train_readings" "r"
        )
 SELECT "id",
    "train_id",
    "plant_id",
    "reading_datetime",
    "shared_power_meter_group",
    "power_delta_kwh" AS "raw_power_delta_kwh",
        CASE
            WHEN (("shared_power_meter_group" IS NOT NULL) AND ("group_permeate_total" > (0)::numeric)) THEN "round"(("group_power_delta_kwh" * ("permeate_flow" / "group_permeate_total")), 3)
            ELSE "power_delta_kwh"
        END AS "allocated_power_delta_kwh",
    "permeate_flow",
    "group_permeate_total",
    "group_power_delta_kwh"
   FROM "grouped" "g";


ALTER VIEW "public"."v_ro_train_power_allocated" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_ro_train_power_allocated" IS 'Per-train kWh with volume-weighted allocation for shared power meters. Use allocated_power_delta_kwh instead of raw power_delta_kwh for per-train energy KPIs.';



CREATE TABLE IF NOT EXISTS "public"."well_blending" (
    "well_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "tagged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tagged_by" "uuid"
);


ALTER TABLE "public"."well_blending" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."well_meter_replacements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "well_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "replacement_date" "date" NOT NULL,
    "old_serial" "text",
    "old_final_reading" numeric,
    "new_brand" "text",
    "new_size" "text",
    "new_serial" "text",
    "new_initial_reading" numeric,
    "new_installed_date" "date",
    "replaced_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reading_id" "uuid"
);


ALTER TABLE "public"."well_meter_replacements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."well_pms_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "well_id" "uuid" NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "record_type" "text" DEFAULT 'PMS'::"text" NOT NULL,
    "date_gathered" "date" NOT NULL,
    "static_water_level_m" numeric,
    "pumping_water_level_m" numeric,
    "pump_setting" "text",
    "pump_installed" "text",
    "motor_hp" numeric,
    "tds_ppm" numeric,
    "turbidity_ntu" numeric,
    "recorded_by" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "drilling_depth_m" numeric,
    CONSTRAINT "well_pms_records_record_type_check" CHECK (("record_type" = ANY (ARRAY['PMS'::"text", 'Pump Replacement'::"text", 'Monthly PWL'::"text"])))
);


ALTER TABLE "public"."well_pms_records" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."well_readings_clean" WITH ("security_invoker"='true') AS
 SELECT "id",
    "well_id",
    "plant_id",
    "reading_datetime",
    "current_reading",
    "previous_reading",
    "daily_volume",
    "power_meter_reading",
    "gps_lat",
    "gps_lng",
    "off_location_flag",
    "recorded_by",
    "created_at",
    "is_meter_replacement",
    "norm_status",
    "tds_ppm",
    "pressure_psi",
    "daily_power_kwh",
    "turbidity_ntu",
    "locked_at",
    "locked_by",
    "is_meter_rollover",
    "meter_rollover_max"
   FROM "public"."well_readings"
  WHERE ("off_location_flag" = false);


ALTER VIEW "public"."well_readings_clean" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."well_readings_latest" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("well_id") "id",
    "well_id",
    "plant_id",
    "reading_datetime",
    "current_reading",
    "previous_reading",
    "daily_volume",
    "power_meter_reading",
    "gps_lat",
    "gps_lng",
    "off_location_flag",
    "recorded_by",
    "created_at",
    "is_meter_replacement",
    "norm_status",
    "tds_ppm",
    "pressure_psi",
    "daily_power_kwh",
    "turbidity_ntu",
    "locked_at",
    "locked_by",
    "is_meter_rollover",
    "meter_rollover_max"
   FROM "public"."well_readings"
  WHERE (("norm_status" IS NULL) OR ("norm_status" <> ALL (ARRAY['retracted'::"text", 'pending_review'::"text"])))
  ORDER BY "well_id", "reading_datetime" DESC;


ALTER VIEW "public"."well_readings_latest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wells" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "size" "text",
    "status" "public"."plant_status" DEFAULT 'Active'::"public"."plant_status" NOT NULL,
    "diameter" "text",
    "drilling_depth_m" numeric,
    "has_power_meter" boolean DEFAULT false NOT NULL,
    "meter_brand" "text",
    "meter_size" "text",
    "meter_serial" "text",
    "meter_installed_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_blending_well" boolean DEFAULT false NOT NULL,
    "electric_meter_brand" "text",
    "electric_meter_size" "text",
    "electric_meter_serial" "text",
    "electric_meter_installed_date" "date",
    "gps_lat" numeric,
    "gps_lng" numeric
);


ALTER TABLE "public"."wells" OWNER TO "postgres";


COMMENT ON COLUMN "public"."wells"."is_blending_well" IS 'True if this well injects directly into the Product Water line (bypasses RO). Volumes are still recorded but flagged in audit.';



COMMENT ON COLUMN "public"."wells"."electric_meter_brand" IS 'Brand of the dedicated kWh meter on this well (separate from water meter)';



ALTER TABLE ONLY "public"."afm_readings"
    ADD CONSTRAINT "afm_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_chat_sessions"
    ADD CONSTRAINT "ai_chat_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."archived_plant_data"
    ADD CONSTRAINT "archived_plant_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backfill_sweep_log"
    ADD CONSTRAINT "backfill_sweep_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blending_events"
    ADD CONSTRAINT "blending_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blending_events"
    ADD CONSTRAINT "blending_events_well_date_uniq" UNIQUE ("well_id", "event_date");



ALTER TABLE ONLY "public"."blending_wells"
    ADD CONSTRAINT "blending_wells_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blending_wells"
    ADD CONSTRAINT "blending_wells_well_id_key" UNIQUE ("well_id");



ALTER TABLE ONLY "public"."cartridge_readings"
    ADD CONSTRAINT "cartridge_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_audit_log"
    ADD CONSTRAINT "chat_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_executions"
    ADD CONSTRAINT "checklist_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_step_executions"
    ADD CONSTRAINT "checklist_step_executions_execution_id_step_index_key" UNIQUE ("execution_id", "step_index");



ALTER TABLE ONLY "public"."checklist_step_executions"
    ADD CONSTRAINT "checklist_step_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_templates"
    ADD CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chemical_deliveries"
    ADD CONSTRAINT "chemical_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chemical_dosing_logs"
    ADD CONSTRAINT "chemical_dosing_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chemical_inventory"
    ADD CONSTRAINT "chemical_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chemical_inventory"
    ADD CONSTRAINT "chemical_inventory_plant_id_chemical_name_key" UNIQUE ("plant_id", "chemical_name");



ALTER TABLE ONLY "public"."chemical_prices"
    ADD CONSTRAINT "chemical_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chemical_residual_samples"
    ADD CONSTRAINT "chemical_residual_samples_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cip_logs"
    ADD CONSTRAINT "cip_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_snapshots"
    ADD CONSTRAINT "compliance_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_thresholds"
    ADD CONSTRAINT "compliance_thresholds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_thresholds"
    ADD CONSTRAINT "compliance_thresholds_scope_key" UNIQUE ("scope");



ALTER TABLE ONLY "public"."correction_requests"
    ADD CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_role_overrides"
    ADD CONSTRAINT "custom_role_overrides_custom_role_id_module_key_action_key" UNIQUE ("custom_role_id", "module_key", "action");



ALTER TABLE ONLY "public"."custom_role_overrides"
    ADD CONSTRAINT "custom_role_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_roles"
    ADD CONSTRAINT "custom_roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."custom_roles"
    ADD CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_plant_summary"
    ADD CONSTRAINT "daily_plant_summary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_plant_summary"
    ADD CONSTRAINT "daily_plant_summary_plant_id_summary_date_key" UNIQUE ("plant_id", "summary_date");



ALTER TABLE ONLY "public"."deletion_audit_log"
    ADD CONSTRAINT "deletion_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."derived_meter_sweep_log"
    ADD CONSTRAINT "derived_meter_sweep_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."downtime_events"
    ADD CONSTRAINT "downtime_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."electric_bills"
    ADD CONSTRAINT "electric_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_status_audit_log"
    ADD CONSTRAINT "entity_status_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filter_replacements"
    ADD CONSTRAINT "filter_replacements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filter_unit_prices"
    ADD CONSTRAINT "filter_unit_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filter_unit_prices"
    ADD CONSTRAINT "filter_unit_prices_plant_id_filter_housing_type_effective_f_key" UNIQUE ("plant_id", "filter_housing_type", "effective_from");



ALTER TABLE ONLY "public"."import_analysis"
    ADD CONSTRAINT "import_analysis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_audit_log"
    ADD CONSTRAINT "import_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_incident_ref_key" UNIQUE ("incident_ref");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locator_derived_review_flags"
    ADD CONSTRAINT "locator_derived_review_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locator_meter_replacements"
    ADD CONSTRAINT "locator_meter_replacements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locator_readings"
    ADD CONSTRAINT "locator_readings_locator_datetime_uniq" UNIQUE ("locator_id", "reading_datetime");



ALTER TABLE ONLY "public"."locator_readings"
    ADD CONSTRAINT "locator_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locators"
    ADD CONSTRAINT "locators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_attempts"
    ADD CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."migration_state"
    ADD CONSTRAINT "migration_state_pkey" PRIMARY KEY ("filename");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operator_switch_log"
    ADD CONSTRAINT "operator_switch_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opex_budgets"
    ADD CONSTRAINT "opex_budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opex_budgets"
    ADD CONSTRAINT "opex_budgets_plant_id_budget_month_key" UNIQUE ("plant_id", "budget_month");



ALTER TABLE ONLY "public"."plant_assignment_audit"
    ADD CONSTRAINT "plant_assignment_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plant_edit_audit_log"
    ADD CONSTRAINT "plant_edit_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plant_meter_config"
    ADD CONSTRAINT "plant_meter_config_pkey" PRIMARY KEY ("plant_id");



ALTER TABLE ONLY "public"."plant_multiplier_cache"
    ADD CONSTRAINT "plant_multiplier_cache_pkey" PRIMARY KEY ("plant_id", "meter_index");



ALTER TABLE ONLY "public"."plant_power_config"
    ADD CONSTRAINT "plant_power_config_pkey" PRIMARY KEY ("plant_id");



ALTER TABLE ONLY "public"."plant_topology_links"
    ADD CONSTRAINT "plant_topology_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plant_topology_links"
    ADD CONSTRAINT "plant_topology_links_plant_id_from_id_to_id_key" UNIQUE ("plant_id", "from_id", "to_id");



ALTER TABLE ONLY "public"."plants"
    ADD CONSTRAINT "plants_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."plants"
    ADD CONSTRAINT "plants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."power_meter_changes"
    ADD CONSTRAINT "power_meter_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."power_readings"
    ADD CONSTRAINT "power_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."power_tariffs"
    ADD CONSTRAINT "power_tariffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_meter_audit_log"
    ADD CONSTRAINT "product_meter_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_meter_readings"
    ADD CONSTRAINT "product_meter_readings_meter_datetime_uniq" UNIQUE ("meter_id", "reading_datetime");



ALTER TABLE ONLY "public"."product_meter_readings"
    ADD CONSTRAINT "product_meter_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_meter_replacements"
    ADD CONSTRAINT "product_meter_replacements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_meters"
    ADD CONSTRAINT "product_meters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_calc_log"
    ADD CONSTRAINT "production_calc_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_costs"
    ADD CONSTRAINT "production_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_costs"
    ADD CONSTRAINT "production_costs_plant_id_cost_date_key" UNIQUE ("plant_id", "cost_date");



ALTER TABLE ONLY "public"."pump_readings"
    ADD CONSTRAINT "pump_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_edit_log"
    ADD CONSTRAINT "raw_edit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reading_anomaly_remarks"
    ADD CONSTRAINT "reading_anomaly_remarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reading_edit_audit_log"
    ADD CONSTRAINT "reading_edit_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reading_gap_reasons"
    ADD CONSTRAINT "reading_gap_reasons_entity_type_entity_id_gap_date_key" UNIQUE ("entity_type", "entity_id", "gap_date");



ALTER TABLE ONLY "public"."reading_gap_reasons"
    ADD CONSTRAINT "reading_gap_reasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reading_normalizations"
    ADD CONSTRAINT "reading_normalizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regression_results"
    ADD CONSTRAINT "regression_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_plant_users"
    ADD CONSTRAINT "ro_plant_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_plant_users"
    ADD CONSTRAINT "ro_plant_users_plant_id_user_id_key" UNIQUE ("plant_id", "user_id");



ALTER TABLE ONLY "public"."ro_plants"
    ADD CONSTRAINT "ro_plants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_pretreatment_readings"
    ADD CONSTRAINT "ro_pretreatment_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_train_data_gaps"
    ADD CONSTRAINT "ro_train_data_gaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_train_data_gaps"
    ADD CONSTRAINT "ro_train_data_gaps_train_id_source_table_gap_start_at_key" UNIQUE ("train_id", "source_table", "gap_start_at");



ALTER TABLE ONLY "public"."ro_train_meter_replacements"
    ADD CONSTRAINT "ro_train_meter_replacements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_train_readings"
    ADD CONSTRAINT "ro_train_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_plant_id_train_number_key" UNIQUE ("plant_id", "train_number");



ALTER TABLE ONLY "public"."signup_audit"
    ADD CONSTRAINT "signup_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."status_checks"
    ADD CONSTRAINT "status_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."train_status_log"
    ADD CONSTRAINT "train_status_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_user_id_permission_key_key" UNIQUE ("user_id", "permission_key");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."well_blending"
    ADD CONSTRAINT "well_blending_pkey" PRIMARY KEY ("well_id");



ALTER TABLE ONLY "public"."well_meter_replacements"
    ADD CONSTRAINT "well_meter_replacements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."well_pms_records"
    ADD CONSTRAINT "well_pms_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."well_readings"
    ADD CONSTRAINT "well_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."well_readings"
    ADD CONSTRAINT "well_readings_well_datetime_uniq" UNIQUE ("well_id", "reading_datetime");



ALTER TABLE ONLY "public"."wells"
    ADD CONSTRAINT "wells_pkey" PRIMARY KEY ("id");



CREATE INDEX "chat_audit_log_recipient_idx" ON "public"."chat_audit_log" USING "btree" ("recipient_id", "sent_at" DESC);



CREATE INDEX "chat_audit_log_sender_idx" ON "public"."chat_audit_log" USING "btree" ("sender_id", "sent_at" DESC);



CREATE INDEX "chat_messages_expires_idx" ON "public"."chat_messages" USING "btree" ("expires_at");



CREATE INDEX "idx_backfill_sweep_log_table_date" ON "public"."backfill_sweep_log" USING "btree" ("table_name", "date_key" DESC);



CREATE INDEX "idx_blending_events_plant_date" ON "public"."blending_events" USING "btree" ("plant_id", "event_date" DESC);



CREATE INDEX "idx_cdl_plant_dt" ON "public"."chemical_dosing_logs" USING "btree" ("plant_id", "log_datetime" DESC);



CREATE INDEX "idx_chem_deliveries_plant_chem" ON "public"."chemical_deliveries" USING "btree" ("plant_id", "chemical_name", "delivery_date" DESC);



CREATE INDEX "idx_chemical_dosing_logs_recorded_by" ON "public"."chemical_dosing_logs" USING "btree" ("recorded_by");



CREATE INDEX "idx_chemical_residual_samples_plant_id" ON "public"."chemical_residual_samples" USING "btree" ("plant_id");



CREATE INDEX "idx_cp_chem_date" ON "public"."chemical_prices" USING "btree" ("chemical_name", "effective_date" DESC);



CREATE INDEX "idx_custom_role_overrides_role" ON "public"."custom_role_overrides" USING "btree" ("custom_role_id");



CREATE INDEX "idx_deletion_audit_log_actor_user_id" ON "public"."deletion_audit_log" USING "btree" ("actor_user_id");



CREATE INDEX "idx_dms_log_locator_date" ON "public"."derived_meter_sweep_log" USING "btree" ("locator_id", "date_key");



CREATE INDEX "idx_dps_plant_date" ON "public"."daily_plant_summary" USING "btree" ("plant_id", "summary_date" DESC);



CREATE INDEX "idx_electric_bills_plant_month" ON "public"."electric_bills" USING "btree" ("plant_id", "billing_month" DESC);



CREATE INDEX "idx_entity_status_audit_entity" ON "public"."entity_status_audit_log" USING "btree" ("entity_type", "entity_id", "timestamp" DESC);



CREATE INDEX "idx_entity_status_audit_log_plant_id" ON "public"."entity_status_audit_log" USING "btree" ("plant_id");



CREATE INDEX "idx_entity_status_audit_log_user_id" ON "public"."entity_status_audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_entity_status_audit_plant" ON "public"."entity_status_audit_log" USING "btree" ("plant_id", "timestamp" DESC);



CREATE INDEX "idx_filter_replacements_plant_date" ON "public"."filter_replacements" USING "btree" ("plant_id", "replacement_date" DESC);



CREATE INDEX "idx_filter_replacements_train" ON "public"."filter_replacements" USING "btree" ("train_id") WHERE ("train_id" IS NOT NULL);



CREATE INDEX "idx_filter_unit_prices_lookup" ON "public"."filter_unit_prices" USING "btree" ("plant_id", "filter_housing_type", "effective_from" DESC);



CREATE INDEX "idx_import_analysis_plant_id" ON "public"."import_analysis" USING "btree" ("plant_id");



CREATE INDEX "idx_incidents_closed_by" ON "public"."incidents" USING "btree" ("closed_by");



CREATE INDEX "idx_incidents_plant_id" ON "public"."incidents" USING "btree" ("plant_id");



CREATE INDEX "idx_incidents_resolved_by" ON "public"."incidents" USING "btree" ("resolved_by");



CREATE INDEX "idx_incidents_who_reporter" ON "public"."incidents" USING "btree" ("who_reporter");



CREATE INDEX "idx_lmr_locator" ON "public"."locator_meter_replacements" USING "btree" ("locator_id");



CREATE INDEX "idx_lmr_reading" ON "public"."locator_meter_replacements" USING "btree" ("reading_id");



CREATE INDEX "idx_locator_meter_replacements_locator_id" ON "public"."locator_meter_replacements" USING "btree" ("locator_id");



CREATE INDEX "idx_locator_meter_replacements_plant_id" ON "public"."locator_meter_replacements" USING "btree" ("plant_id");



CREATE INDEX "idx_locator_readings_norm_status" ON "public"."locator_readings" USING "btree" ("plant_id", "norm_status") WHERE ("norm_status" <> 'normal'::"text");



CREATE INDEX "idx_locator_readings_pending" ON "public"."locator_readings" USING "btree" ("plant_id", "reading_datetime" DESC) WHERE ("norm_status" = 'pending_review'::"text");



CREATE INDEX "idx_locator_readings_recorded_by" ON "public"."locator_readings" USING "btree" ("recorded_by");



CREATE INDEX "idx_locators_is_locked" ON "public"."locators" USING "btree" ("is_locked") WHERE ("is_locked" = true);



CREATE INDEX "idx_locators_plant" ON "public"."locators" USING "btree" ("plant_id");



CREATE INDEX "idx_locators_product_meter_id" ON "public"."locators" USING "btree" ("product_meter_id");



CREATE INDEX "idx_login_attempts_user_id" ON "public"."login_attempts" USING "btree" ("user_id");



CREATE INDEX "idx_lr_locator_dt" ON "public"."locator_readings" USING "btree" ("locator_id", "reading_datetime" DESC);



CREATE INDEX "idx_lr_plant_dt" ON "public"."locator_readings" USING "btree" ("plant_id", "reading_datetime" DESC);



CREATE INDEX "idx_notif_user_dismissed" ON "public"."notifications" USING "btree" ("user_id", "dismissed", "created_at" DESC);



CREATE INDEX "idx_notif_user_read" ON "public"."notifications" USING "btree" ("user_id", "read", "created_at" DESC);



CREATE INDEX "idx_notifications_plant_id" ON "public"."notifications" USING "btree" ("plant_id");



CREATE INDEX "idx_opex_budgets_plant_month" ON "public"."opex_budgets" USING "btree" ("plant_id", "budget_month" DESC);



CREATE INDEX "idx_pm_audit_plant" ON "public"."product_meter_audit_log" USING "btree" ("plant_id", "timestamp" DESC);



CREATE INDEX "idx_pmc_plant" ON "public"."plant_multiplier_cache" USING "btree" ("plant_id");



CREATE INDEX "idx_pmr_meter_dt" ON "public"."product_meter_readings" USING "btree" ("meter_id", "reading_datetime" DESC);



CREATE INDEX "idx_pmr_norm_status" ON "public"."product_meter_readings" USING "btree" ("plant_id", "norm_status") WHERE ("norm_status" <> 'normal'::"text");



CREATE INDEX "idx_pmr_plant_dt" ON "public"."product_meter_readings" USING "btree" ("plant_id", "reading_datetime" DESC);



CREATE INDEX "idx_pmr_repl_meter" ON "public"."product_meter_replacements" USING "btree" ("meter_id");



CREATE INDEX "idx_pmr_repl_reading" ON "public"."product_meter_replacements" USING "btree" ("reading_id");



CREATE INDEX "idx_power_meter_changes_reading_id" ON "public"."power_meter_changes" USING "btree" ("reading_id");



CREATE INDEX "idx_power_readings_plant_dt" ON "public"."power_readings" USING "btree" ("plant_id", "reading_datetime");



CREATE INDEX "idx_power_readings_recorded_by" ON "public"."power_readings" USING "btree" ("recorded_by");



CREATE INDEX "idx_power_tariffs_plant_date" ON "public"."power_tariffs" USING "btree" ("plant_id", "effective_date" DESC);



CREATE INDEX "idx_pr_plant_dt" ON "public"."power_readings" USING "btree" ("plant_id", "reading_datetime" DESC);



CREATE INDEX "idx_pretreatment_train_dt" ON "public"."ro_pretreatment_readings" USING "btree" ("train_id", "reading_datetime" DESC);



CREATE INDEX "idx_product_meter_audit_log_user_id" ON "public"."product_meter_audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_product_meter_readings_recorded_by" ON "public"."product_meter_readings" USING "btree" ("recorded_by");



CREATE INDEX "idx_product_meters_derived_locator" ON "public"."product_meters" USING "btree" ("derived_from_locator_id") WHERE ("derived_from_locator_id" IS NOT NULL);



CREATE INDEX "idx_product_meters_plant" ON "public"."product_meters" USING "btree" ("plant_id", "status");



CREATE INDEX "idx_production_costs_plant_date" ON "public"."production_costs" USING "btree" ("plant_id", "cost_date" DESC);



CREATE INDEX "idx_raw_edit_source" ON "public"."raw_edit_log" USING "btree" ("source_table", "source_id");



CREATE INDEX "idx_reading_anomaly_remarks_plant" ON "public"."reading_anomaly_remarks" USING "btree" ("plant_id", "logged_at" DESC);



CREATE INDEX "idx_reading_anomaly_remarks_record" ON "public"."reading_anomaly_remarks" USING "btree" ("table_name", "record_id");



CREATE INDEX "idx_reading_gap_reasons_lookup" ON "public"."reading_gap_reasons" USING "btree" ("entity_type", "entity_id", "gap_date");



CREATE INDEX "idx_reading_gap_reasons_plant" ON "public"."reading_gap_reasons" USING "btree" ("plant_id", "gap_date" DESC);



CREATE INDEX "idx_reading_norm_performed_at" ON "public"."reading_normalizations" USING "btree" ("performed_at" DESC);



CREATE INDEX "idx_regression_plant" ON "public"."regression_results" USING "btree" ("plant_id", "created_at" DESC);



CREATE INDEX "idx_regression_results_created_by" ON "public"."regression_results" USING "btree" ("created_by");



CREATE INDEX "idx_regression_table_col" ON "public"."regression_results" USING "btree" ("source_table", "column_name");



CREATE INDEX "idx_review_flags_locator_date" ON "public"."locator_derived_review_flags" USING "btree" ("locator_id", "date_key");



CREATE INDEX "idx_ro_pretreatment_readings_plant_id" ON "public"."ro_pretreatment_readings" USING "btree" ("plant_id");



CREATE INDEX "idx_ro_pretreatment_readings_train_id" ON "public"."ro_pretreatment_readings" USING "btree" ("train_id");



CREATE INDEX "idx_ro_train_data_gaps_lookup" ON "public"."ro_train_data_gaps" USING "btree" ("train_id", "source_table", "gap_start_at");



CREATE INDEX "idx_ro_train_data_gaps_plant" ON "public"."ro_train_data_gaps" USING "btree" ("plant_id", "gap_start_at" DESC);



CREATE INDEX "idx_ro_train_readings_recorded_by" ON "public"."ro_train_readings" USING "btree" ("recorded_by");



CREATE INDEX "idx_ro_train_readings_train_id_reading_datetime" ON "public"."ro_train_readings" USING "btree" ("train_id", "reading_datetime" DESC);



CREATE INDEX "idx_ro_trains_feed_source" ON "public"."ro_trains" USING "btree" ("feed_source_train_id") WHERE ("feed_source_train_id" IS NOT NULL);



CREATE INDEX "idx_ro_trains_well_id" ON "public"."ro_trains" USING "btree" ("well_id");



CREATE INDEX "idx_rtmr_reading" ON "public"."ro_train_meter_replacements" USING "btree" ("reading_id");



CREATE INDEX "idx_rtmr_train" ON "public"."ro_train_meter_replacements" USING "btree" ("train_id", "meter_type");



CREATE INDEX "idx_rtr_norm_status" ON "public"."ro_train_readings" USING "btree" ("norm_status") WHERE ("norm_status" = 'pending_review'::"text");



CREATE INDEX "idx_rtr_plant_dt" ON "public"."ro_train_readings" USING "btree" ("plant_id", "reading_datetime" DESC);



CREATE INDEX "idx_rtr_train_dt" ON "public"."ro_train_readings" USING "btree" ("train_id", "reading_datetime" DESC);



CREATE INDEX "idx_rtr_train_dt_covering" ON "public"."ro_train_readings" USING "btree" ("train_id", "reading_datetime") INCLUDE ("permeate_meter", "feed_meter", "reject_meter");



CREATE INDEX "idx_topology_links_plant" ON "public"."plant_topology_links" USING "btree" ("plant_id");



CREATE INDEX "idx_train_status_log_plant_id" ON "public"."train_status_log" USING "btree" ("plant_id");



CREATE INDEX "idx_train_status_log_train" ON "public"."train_status_log" USING "btree" ("train_id", "confirmed_at" DESC);



CREATE INDEX "idx_user_profiles_immediate_head_id" ON "public"."user_profiles" USING "btree" ("immediate_head_id");



CREATE INDEX "idx_user_roles_custom_role" ON "public"."user_roles" USING "btree" ("custom_role_id") WHERE ("custom_role_id" IS NOT NULL);



CREATE INDEX "idx_well_blending_plant_id" ON "public"."well_blending" USING "btree" ("plant_id");



CREATE INDEX "idx_well_meter_replacements_plant_id" ON "public"."well_meter_replacements" USING "btree" ("plant_id");



CREATE INDEX "idx_well_meter_replacements_well_id" ON "public"."well_meter_replacements" USING "btree" ("well_id");



CREATE INDEX "idx_well_readings_norm_status" ON "public"."well_readings" USING "btree" ("plant_id", "norm_status") WHERE ("norm_status" <> 'normal'::"text");



CREATE INDEX "idx_well_readings_pending" ON "public"."well_readings" USING "btree" ("plant_id", "reading_datetime" DESC) WHERE ("norm_status" = 'pending_review'::"text");



CREATE INDEX "idx_well_readings_recorded_by" ON "public"."well_readings" USING "btree" ("recorded_by");



CREATE INDEX "idx_well_readings_water_quality" ON "public"."well_readings" USING "btree" ("well_id", "reading_datetime" DESC) WHERE (("tds_ppm" IS NOT NULL) OR ("turbidity_ntu" IS NOT NULL));



CREATE INDEX "idx_well_readings_well_dt" ON "public"."well_readings" USING "btree" ("well_id", "reading_datetime" DESC);



CREATE INDEX "idx_well_readings_well_id" ON "public"."well_readings" USING "btree" ("well_id");



CREATE INDEX "idx_wells_plant" ON "public"."wells" USING "btree" ("plant_id");



CREATE INDEX "idx_wells_plant_id" ON "public"."wells" USING "btree" ("plant_id");



CREATE INDEX "idx_wmr_reading" ON "public"."well_meter_replacements" USING "btree" ("reading_id");



CREATE INDEX "idx_wpms_well" ON "public"."well_pms_records" USING "btree" ("well_id");



CREATE INDEX "idx_wr_plant_dt" ON "public"."well_readings" USING "btree" ("plant_id", "reading_datetime" DESC);



CREATE INDEX "import_analysis_actor_idx" ON "public"."import_analysis" USING "btree" ("actor_user_id");



CREATE UNIQUE INDEX "locators_plant_name_uq" ON "public"."locators" USING "btree" ("plant_id", "lower"("name"));



CREATE INDEX "plant_meter_config_plant_id_idx" ON "public"."plant_meter_config" USING "btree" ("plant_id");



CREATE INDEX "product_meter_readings_meter_idx" ON "public"."product_meter_readings" USING "btree" ("meter_id");



CREATE INDEX "product_meter_readings_plant_dt_idx" ON "public"."product_meter_readings" USING "btree" ("plant_id", "reading_datetime" DESC);



CREATE INDEX "product_meters_plant_idx" ON "public"."product_meters" USING "btree" ("plant_id");



CREATE INDEX "reading_edit_audit_log_plant_idx" ON "public"."reading_edit_audit_log" USING "btree" ("plant_id", "edited_at" DESC);



CREATE INDEX "reading_edit_audit_log_record_idx" ON "public"."reading_edit_audit_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "ro_pretreatment_readings_plant_id_idx" ON "public"."ro_pretreatment_readings" USING "btree" ("plant_id");



CREATE INDEX "ro_pretreatment_readings_train_id_dt_idx" ON "public"."ro_pretreatment_readings" USING "btree" ("train_id", "reading_datetime" DESC);



CREATE UNIQUE INDEX "ro_trains_plant_name_uq" ON "public"."ro_trains" USING "btree" ("plant_id", "lower"("name"));



CREATE UNIQUE INDEX "uix_locator_one_per_user_per_hour" ON "public"."locator_readings" USING "btree" ("locator_id", "plant_id", "recorded_by", "date_trunc"('hour'::"text", ("reading_datetime" AT TIME ZONE 'Asia/Manila'::"text"))) WHERE ("norm_status" <> 'retracted'::"text");



CREATE UNIQUE INDEX "uix_well_one_per_user_per_hour" ON "public"."well_readings" USING "btree" ("well_id", "plant_id", "recorded_by", "date_trunc"('hour'::"text", ("reading_datetime" AT TIME ZONE 'Asia/Manila'::"text"))) WHERE ("norm_status" <> 'retracted'::"text");



CREATE UNIQUE INDEX "uq_one_derived_locator_per_meter" ON "public"."locators" USING "btree" ("derived_from_meter_id") WHERE (("is_derived" = true) AND ("derived_from_meter_id" IS NOT NULL));



CREATE UNIQUE INDEX "uq_open_review_flag" ON "public"."locator_derived_review_flags" USING "btree" ("locator_id", "date_key") WHERE ("resolved_at" IS NULL);



CREATE UNIQUE INDEX "wells_plant_name_uq" ON "public"."wells" USING "btree" ("plant_id", "lower"("name"));



CREATE OR REPLACE TRIGGER "chat_audit_trigger" AFTER INSERT ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."chat_after_insert"();



CREATE OR REPLACE TRIGGER "plant_meter_config_updated_at" BEFORE UPDATE ON "public"."plant_meter_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "plant_power_config_updated_at" BEFORE UPDATE ON "public"."plant_power_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "product_meters_updated_at" BEFORE UPDATE ON "public"."product_meters" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_auto_lock_locator" BEFORE UPDATE ON "public"."locator_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_lock_on_approval"();



CREATE OR REPLACE TRIGGER "trg_auto_lock_product" BEFORE UPDATE ON "public"."product_meter_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_lock_on_approval"();



CREATE OR REPLACE TRIGGER "trg_auto_lock_well" BEFORE UPDATE ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_lock_on_approval"();



CREATE OR REPLACE TRIGGER "trg_blending_readings_chain" AFTER INSERT OR DELETE OR UPDATE OF "raw_meter_reading" ON "public"."blending_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_blending_reading_chain"();



CREATE OR REPLACE TRIGGER "trg_blending_set_reading" BEFORE INSERT OR UPDATE OF "raw_meter_reading", "previous_reading", "is_meter_replacement" ON "public"."blending_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_blending_set_reading"();



CREATE OR REPLACE TRIGGER "trg_chem_cost" AFTER INSERT OR DELETE OR UPDATE ON "public"."chemical_dosing_logs" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_cost"();



CREATE OR REPLACE TRIGGER "trg_chem_inv_updated" BEFORE UPDATE ON "public"."chemical_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_custom_roles_updated" BEFORE UPDATE ON "public"."custom_roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_dps_updated" BEFORE UPDATE ON "public"."daily_plant_summary" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_electric_bills_chain" AFTER INSERT OR DELETE OR UPDATE OF "current_reading", "period_end" ON "public"."electric_bills" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_electric_bill_chain"();



CREATE OR REPLACE TRIGGER "trg_electric_bills_updated" BEFORE UPDATE ON "public"."electric_bills" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_filter_replacements_sync_cost" AFTER INSERT OR DELETE OR UPDATE ON "public"."filter_replacements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_filter_cost_to_production_costs"();



CREATE OR REPLACE TRIGGER "trg_flag_derived_review_locator" AFTER INSERT OR DELETE OR UPDATE ON "public"."locator_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_flag_derived_review"();



CREATE OR REPLACE TRIGGER "trg_flag_derived_review_meter" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_meter_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_flag_derived_review"();



CREATE OR REPLACE TRIGGER "trg_force_direct_mode" BEFORE INSERT OR UPDATE ON "public"."locators" FOR EACH ROW EXECUTE FUNCTION "public"."fn_force_direct_mode_when_derived"();



CREATE OR REPLACE TRIGGER "trg_guard_custom_role_override" BEFORE INSERT OR UPDATE ON "public"."custom_role_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."fn_guard_custom_role_override"();



CREATE OR REPLACE TRIGGER "trg_guard_permeate_delta" BEFORE INSERT OR UPDATE ON "public"."ro_train_readings" FOR EACH ROW EXECUTE FUNCTION "public"."guard_permeate_delta"();



CREATE OR REPLACE TRIGGER "trg_incident_ref" BEFORE INSERT ON "public"."incidents" FOR EACH ROW EXECUTE FUNCTION "public"."generate_incident_ref"();



CREATE OR REPLACE TRIGGER "trg_incidents_updated" BEFORE UPDATE ON "public"."incidents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_invalidate_power_cache" AFTER INSERT OR DELETE OR UPDATE OF "grid_meter_multipliers" ON "public"."plant_power_config" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trg_invalidate_power_cache"();



CREATE OR REPLACE TRIGGER "trg_locator_reading_integrity" BEFORE INSERT OR UPDATE ON "public"."locator_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_locator_reading_integrity"();



CREATE OR REPLACE TRIGGER "trg_locator_readings_delta" AFTER INSERT OR DELETE OR UPDATE OF "current_reading" ON "public"."locator_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_locator_reading_chain"();



CREATE OR REPLACE TRIGGER "trg_locator_readings_set_daily_volume" BEFORE INSERT OR UPDATE ON "public"."locator_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_locator_daily_volume"();



CREATE OR REPLACE TRIGGER "trg_locators_updated" BEFORE UPDATE ON "public"."locators" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_migration_state_updated" BEFORE UPDATE ON "public"."migration_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_notify_operator_on_resolution" AFTER UPDATE ON "public"."correction_requests" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notify_operator_on_resolution"();



CREATE OR REPLACE TRIGGER "trg_notify_submitter_on_correction_rejection" AFTER UPDATE ON "public"."correction_requests" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notify_submitter_on_correction_rejection"();



CREATE OR REPLACE TRIGGER "trg_notify_supervisors_on_request" AFTER INSERT ON "public"."correction_requests" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notify_supervisors_on_request"();



CREATE OR REPLACE TRIGGER "trg_plants_updated" BEFORE UPDATE ON "public"."plants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_power_after_delete" AFTER DELETE ON "public"."power_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_power_readings_after_delete"();



CREATE OR REPLACE TRIGGER "trg_power_before_upsert" BEFORE INSERT OR UPDATE OF "meter_reading_kwh", "reading_datetime", "is_meter_replacement" ON "public"."power_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_power_readings_before_upsert"();



CREATE OR REPLACE TRIGGER "trg_power_cost" AFTER INSERT OR DELETE OR UPDATE ON "public"."power_readings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_cost"();



CREATE OR REPLACE TRIGGER "trg_power_readings_solar_cost" AFTER INSERT OR DELETE OR UPDATE ON "public"."power_readings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_solar_cost"();



CREATE OR REPLACE TRIGGER "trg_power_tariff_cost" AFTER INSERT OR DELETE OR UPDATE ON "public"."power_tariffs" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_cost_on_tariff_change"();



CREATE OR REPLACE TRIGGER "trg_ppc_multiplier_cache" AFTER INSERT OR DELETE OR UPDATE OF "grid_meter_multipliers" ON "public"."plant_power_config" FOR EACH ROW EXECUTE FUNCTION "public"."trg_invalidate_multiplier_cache"();



CREATE OR REPLACE TRIGGER "trg_pretreatment_sync_filter_cost" AFTER INSERT OR DELETE OR UPDATE OF "cartridges_changed", "bag_filters_changed", "train_id", "reading_datetime" ON "public"."ro_pretreatment_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_filter_usage_cost"();



CREATE OR REPLACE TRIGGER "trg_product_meter_reading_integrity" BEFORE INSERT OR UPDATE ON "public"."product_meter_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_product_meter_reading_integrity"();



CREATE OR REPLACE TRIGGER "trg_product_meter_readings_delta" AFTER INSERT OR DELETE OR UPDATE OF "current_reading" ON "public"."product_meter_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_product_meter_reading_chain"();



CREATE OR REPLACE TRIGGER "trg_production_costs_updated" BEFORE UPDATE ON "public"."production_costs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_readings_stamp_multiplier" BEFORE INSERT OR UPDATE ON "public"."power_readings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_stamp_reading_multiplier"();



CREATE OR REPLACE TRIGGER "trg_recalc_successor" AFTER INSERT OR UPDATE OF "meter_reading_kwh", "grid_meter_readings" ON "public"."power_readings" FOR EACH ROW WHEN (("new"."is_meter_replacement" IS NOT TRUE)) EXECUTE FUNCTION "public"."fn_trg_recalc_successor"();



CREATE OR REPLACE TRIGGER "trg_regression_results_outlier_count" BEFORE INSERT OR UPDATE OF "corrections" ON "public"."regression_results" FOR EACH ROW EXECUTE FUNCTION "public"."trg_regression_results_outlier_count"();



CREATE OR REPLACE TRIGGER "trg_ro_train_readings_delta" AFTER INSERT OR DELETE OR UPDATE OF "permeate_meter", "feed_meter", "reject_meter" ON "public"."ro_train_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_ro_train_reading_chain"();



CREATE OR REPLACE TRIGGER "trg_ro_trains_updated" BEFORE UPDATE ON "public"."ro_trains" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_sync_derived_locator_mirror" AFTER INSERT OR DELETE OR UPDATE ON "public"."locator_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_derived_locator_mirror"();



CREATE OR REPLACE TRIGGER "trg_sync_dps_production" BEFORE INSERT OR UPDATE ON "public"."daily_plant_summary" FOR EACH ROW EXECUTE FUNCTION "public"."sync_daily_plant_summary_production"();



CREATE OR REPLACE TRIGGER "trg_sync_permeate_is_production" BEFORE INSERT OR UPDATE OF "config" ON "public"."plant_meter_config" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_permeate_is_production"();



CREATE OR REPLACE TRIGGER "trg_sync_ro_train_reading_meter_replacement" BEFORE INSERT OR UPDATE ON "public"."ro_train_readings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_ro_train_reading_meter_replacement_flag"();



CREATE OR REPLACE TRIGGER "trg_user_profiles_updated" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_user_roles_sync_app_metadata" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_user_role_to_app_metadata"();



CREATE OR REPLACE TRIGGER "trg_validate_ro_train_feed_source" BEFORE INSERT OR UPDATE OF "feed_source_train_id", "plant_id" ON "public"."ro_trains" FOR EACH ROW EXECUTE FUNCTION "public"."fn_validate_ro_train_feed_source"();



CREATE OR REPLACE TRIGGER "trg_well_cost" AFTER INSERT OR DELETE OR UPDATE ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_cost"();



CREATE OR REPLACE TRIGGER "trg_well_reading_integrity" BEFORE INSERT OR UPDATE ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_well_reading_integrity"();



CREATE OR REPLACE TRIGGER "trg_well_readings_cascade_next" AFTER UPDATE OF "current_reading" ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."well_readings_cascade_next"();



CREATE OR REPLACE TRIGGER "trg_well_readings_compute_delta" BEFORE INSERT OR UPDATE OF "current_reading", "previous_reading", "daily_volume", "reading_datetime" ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."well_readings_compute_delta"();



CREATE OR REPLACE TRIGGER "trg_well_readings_daily_volume" BEFORE INSERT OR UPDATE ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."well_readings_compute_daily_volume"();



CREATE OR REPLACE TRIGGER "trg_well_readings_delta" AFTER INSERT OR DELETE OR UPDATE OF "current_reading" ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_well_reading_chain"();



CREATE OR REPLACE TRIGGER "trg_well_readings_power" AFTER INSERT OR DELETE OR UPDATE OF "power_meter_reading" ON "public"."well_readings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_well_power_chain"();



CREATE OR REPLACE TRIGGER "trg_wells_updated" BEFORE UPDATE ON "public"."wells" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."afm_readings"
    ADD CONSTRAINT "afm_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."afm_readings"
    ADD CONSTRAINT "afm_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."afm_readings"
    ADD CONSTRAINT "afm_readings_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_chat_sessions"
    ADD CONSTRAINT "ai_chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."backfill_sweep_log"
    ADD CONSTRAINT "backfill_sweep_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."blending_wells"
    ADD CONSTRAINT "blending_wells_tagged_by_fkey" FOREIGN KEY ("tagged_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cartridge_readings"
    ADD CONSTRAINT "cartridge_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."cartridge_readings"
    ADD CONSTRAINT "cartridge_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."cartridge_readings"
    ADD CONSTRAINT "cartridge_readings_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_audit_log"
    ADD CONSTRAINT "chat_audit_log_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_audit_log"
    ADD CONSTRAINT "chat_audit_log_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_executions"
    ADD CONSTRAINT "checklist_executions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."checklist_executions"
    ADD CONSTRAINT "checklist_executions_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."checklist_executions"
    ADD CONSTRAINT "checklist_executions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_step_executions"
    ADD CONSTRAINT "checklist_step_executions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."checklist_step_executions"
    ADD CONSTRAINT "checklist_step_executions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "public"."checklist_executions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_step_executions"
    ADD CONSTRAINT "checklist_step_executions_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_step_executions"
    ADD CONSTRAINT "checklist_step_executions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_templates"
    ADD CONSTRAINT "checklist_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."checklist_templates"
    ADD CONSTRAINT "checklist_templates_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chemical_deliveries"
    ADD CONSTRAINT "chemical_deliveries_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chemical_dosing_logs"
    ADD CONSTRAINT "chemical_dosing_logs_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chemical_dosing_logs"
    ADD CONSTRAINT "chemical_dosing_logs_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."chemical_inventory"
    ADD CONSTRAINT "chemical_inventory_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chemical_prices"
    ADD CONSTRAINT "chemical_prices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."chemical_residual_samples"
    ADD CONSTRAINT "chemical_residual_samples_dosing_log_id_fkey" FOREIGN KEY ("dosing_log_id") REFERENCES "public"."chemical_dosing_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chemical_residual_samples"
    ADD CONSTRAINT "chemical_residual_samples_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cip_logs"
    ADD CONSTRAINT "cip_logs_conducted_by_fkey" FOREIGN KEY ("conducted_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."cip_logs"
    ADD CONSTRAINT "cip_logs_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."cip_logs"
    ADD CONSTRAINT "cip_logs_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compliance_snapshots"
    ADD CONSTRAINT "compliance_snapshots_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."correction_requests"
    ADD CONSTRAINT "correction_requests_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."correction_requests"
    ADD CONSTRAINT "correction_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."correction_requests"
    ADD CONSTRAINT "correction_requests_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_role_overrides"
    ADD CONSTRAINT "custom_role_overrides_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_roles"
    ADD CONSTRAINT "custom_roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."daily_plant_summary"
    ADD CONSTRAINT "daily_plant_summary_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deletion_audit_log"
    ADD CONSTRAINT "deletion_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."derived_meter_sweep_log"
    ADD CONSTRAINT "derived_meter_sweep_log_locator_id_fkey" FOREIGN KEY ("locator_id") REFERENCES "public"."locators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."derived_meter_sweep_log"
    ADD CONSTRAINT "derived_meter_sweep_log_mirror_meter_id_fkey" FOREIGN KEY ("mirror_meter_id") REFERENCES "public"."product_meters"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."derived_meter_sweep_log"
    ADD CONSTRAINT "derived_meter_sweep_log_mirror_reading_id_fkey" FOREIGN KEY ("mirror_reading_id") REFERENCES "public"."product_meter_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."derived_meter_sweep_log"
    ADD CONSTRAINT "derived_meter_sweep_log_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."locator_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."downtime_events"
    ADD CONSTRAINT "downtime_events_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."electric_bills"
    ADD CONSTRAINT "electric_bills_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entity_status_audit_log"
    ADD CONSTRAINT "entity_status_audit_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entity_status_audit_log"
    ADD CONSTRAINT "entity_status_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filter_replacements"
    ADD CONSTRAINT "filter_replacements_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filter_replacements"
    ADD CONSTRAINT "filter_replacements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."filter_replacements"
    ADD CONSTRAINT "filter_replacements_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filter_unit_prices"
    ADD CONSTRAINT "filter_unit_prices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."filter_unit_prices"
    ADD CONSTRAINT "filter_unit_prices_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_analysis"
    ADD CONSTRAINT "import_analysis_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_analysis"
    ADD CONSTRAINT "import_analysis_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_analysis"
    ADD CONSTRAINT "import_analysis_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_audit_log"
    ADD CONSTRAINT "import_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_who_reporter_fkey" FOREIGN KEY ("who_reporter") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."locator_derived_review_flags"
    ADD CONSTRAINT "locator_derived_review_flags_locator_id_fkey" FOREIGN KEY ("locator_id") REFERENCES "public"."locators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locator_meter_replacements"
    ADD CONSTRAINT "locator_meter_replacements_locator_id_fkey" FOREIGN KEY ("locator_id") REFERENCES "public"."locators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locator_meter_replacements"
    ADD CONSTRAINT "locator_meter_replacements_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."locator_meter_replacements"
    ADD CONSTRAINT "locator_meter_replacements_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."locator_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."locator_meter_replacements"
    ADD CONSTRAINT "locator_meter_replacements_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."locator_readings"
    ADD CONSTRAINT "locator_readings_locator_id_fkey" FOREIGN KEY ("locator_id") REFERENCES "public"."locators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locator_readings"
    ADD CONSTRAINT "locator_readings_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."locator_readings"
    ADD CONSTRAINT "locator_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."locator_readings"
    ADD CONSTRAINT "locator_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."locators"
    ADD CONSTRAINT "locators_derived_from_meter_id_fkey" FOREIGN KEY ("derived_from_meter_id") REFERENCES "public"."product_meters"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."locators"
    ADD CONSTRAINT "locators_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locators"
    ADD CONSTRAINT "locators_product_meter_id_fkey" FOREIGN KEY ("product_meter_id") REFERENCES "public"."product_meters"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."login_attempts"
    ADD CONSTRAINT "login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operator_switch_log"
    ADD CONSTRAINT "operator_switch_log_from_operator_id_fkey" FOREIGN KEY ("from_operator_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_switch_log"
    ADD CONSTRAINT "operator_switch_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_switch_log"
    ADD CONSTRAINT "operator_switch_log_switched_by_fkey" FOREIGN KEY ("switched_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operator_switch_log"
    ADD CONSTRAINT "operator_switch_log_to_operator_id_fkey" FOREIGN KEY ("to_operator_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."opex_budgets"
    ADD CONSTRAINT "opex_budgets_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_assignment_audit"
    ADD CONSTRAINT "plant_assignment_audit_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plant_assignment_audit"
    ADD CONSTRAINT "plant_assignment_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_edit_audit_log"
    ADD CONSTRAINT "plant_edit_audit_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_edit_audit_log"
    ADD CONSTRAINT "plant_edit_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plant_meter_config"
    ADD CONSTRAINT "plant_meter_config_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_multiplier_cache"
    ADD CONSTRAINT "plant_multiplier_cache_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plant_power_config"("plant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_power_config"
    ADD CONSTRAINT "plant_power_config_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_topology_links"
    ADD CONSTRAINT "plant_topology_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."plant_topology_links"
    ADD CONSTRAINT "plant_topology_links_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."power_meter_changes"
    ADD CONSTRAINT "power_meter_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."power_meter_changes"
    ADD CONSTRAINT "power_meter_changes_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."power_meter_changes"
    ADD CONSTRAINT "power_meter_changes_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."power_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."power_readings"
    ADD CONSTRAINT "power_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."power_readings"
    ADD CONSTRAINT "power_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."power_tariffs"
    ADD CONSTRAINT "power_tariffs_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_meter_audit_log"
    ADD CONSTRAINT "product_meter_audit_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_meter_audit_log"
    ADD CONSTRAINT "product_meter_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_meter_readings"
    ADD CONSTRAINT "product_meter_readings_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_meter_readings"
    ADD CONSTRAINT "product_meter_readings_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."product_meters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_meter_readings"
    ADD CONSTRAINT "product_meter_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_meter_readings"
    ADD CONSTRAINT "product_meter_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_meter_replacements"
    ADD CONSTRAINT "product_meter_replacements_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."product_meters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_meter_replacements"
    ADD CONSTRAINT "product_meter_replacements_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."product_meter_replacements"
    ADD CONSTRAINT "product_meter_replacements_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."product_meter_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_meter_replacements"
    ADD CONSTRAINT "product_meter_replacements_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."product_meters"
    ADD CONSTRAINT "product_meters_derived_from_locator_id_fkey" FOREIGN KEY ("derived_from_locator_id") REFERENCES "public"."locators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_meters"
    ADD CONSTRAINT "product_meters_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."production_calc_log"
    ADD CONSTRAINT "production_calc_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."production_calc_log"
    ADD CONSTRAINT "production_calc_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."production_costs"
    ADD CONSTRAINT "production_costs_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pump_readings"
    ADD CONSTRAINT "pump_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."pump_readings"
    ADD CONSTRAINT "pump_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."pump_readings"
    ADD CONSTRAINT "pump_readings_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."raw_edit_log"
    ADD CONSTRAINT "raw_edit_log_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reading_anomaly_remarks"
    ADD CONSTRAINT "reading_anomaly_remarks_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reading_anomaly_remarks"
    ADD CONSTRAINT "reading_anomaly_remarks_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_edit_audit_log"
    ADD CONSTRAINT "reading_edit_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reading_edit_audit_log"
    ADD CONSTRAINT "reading_edit_audit_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reading_gap_reasons"
    ADD CONSTRAINT "reading_gap_reasons_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reading_gap_reasons"
    ADD CONSTRAINT "reading_gap_reasons_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_normalizations"
    ADD CONSTRAINT "reading_normalizations_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."regression_results"
    ADD CONSTRAINT "regression_results_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."regression_results"
    ADD CONSTRAINT "regression_results_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_plant_users"
    ADD CONSTRAINT "ro_plant_users_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."ro_plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_plant_users"
    ADD CONSTRAINT "ro_plant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_pretreatment_readings"
    ADD CONSTRAINT "ro_pretreatment_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_pretreatment_readings"
    ADD CONSTRAINT "ro_pretreatment_readings_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_train_data_gaps"
    ADD CONSTRAINT "ro_train_data_gaps_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ro_train_data_gaps"
    ADD CONSTRAINT "ro_train_data_gaps_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_train_data_gaps"
    ADD CONSTRAINT "ro_train_data_gaps_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_train_meter_replacements"
    ADD CONSTRAINT "ro_train_meter_replacements_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."ro_train_meter_replacements"
    ADD CONSTRAINT "ro_train_meter_replacements_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."ro_train_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ro_train_meter_replacements"
    ADD CONSTRAINT "ro_train_meter_replacements_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."ro_train_meter_replacements"
    ADD CONSTRAINT "ro_train_meter_replacements_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_train_readings"
    ADD CONSTRAINT "ro_train_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."ro_train_readings"
    ADD CONSTRAINT "ro_train_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."ro_train_readings"
    ADD CONSTRAINT "ro_train_readings_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_feed_source_train_id_fkey" FOREIGN KEY ("feed_source_train_id") REFERENCES "public"."ro_trains"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_product_meter_id_fkey" FOREIGN KEY ("product_meter_id") REFERENCES "public"."product_meters"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_well_id_fkey" FOREIGN KEY ("well_id") REFERENCES "public"."wells"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."train_status_log"
    ADD CONSTRAINT "train_status_log_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."train_status_log"
    ADD CONSTRAINT "train_status_log_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "public"."ro_trains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_immediate_head_id_fkey" FOREIGN KEY ("immediate_head_id") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."well_blending"
    ADD CONSTRAINT "well_blending_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."well_blending"
    ADD CONSTRAINT "well_blending_tagged_by_fkey" FOREIGN KEY ("tagged_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."well_blending"
    ADD CONSTRAINT "well_blending_well_id_fkey" FOREIGN KEY ("well_id") REFERENCES "public"."wells"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."well_meter_replacements"
    ADD CONSTRAINT "well_meter_replacements_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."well_meter_replacements"
    ADD CONSTRAINT "well_meter_replacements_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."well_readings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."well_meter_replacements"
    ADD CONSTRAINT "well_meter_replacements_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."well_meter_replacements"
    ADD CONSTRAINT "well_meter_replacements_well_id_fkey" FOREIGN KEY ("well_id") REFERENCES "public"."wells"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."well_pms_records"
    ADD CONSTRAINT "well_pms_records_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."well_pms_records"
    ADD CONSTRAINT "well_pms_records_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."well_pms_records"
    ADD CONSTRAINT "well_pms_records_well_id_fkey" FOREIGN KEY ("well_id") REFERENCES "public"."wells"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."well_readings"
    ADD CONSTRAINT "well_readings_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."well_readings"
    ADD CONSTRAINT "well_readings_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id");



ALTER TABLE ONLY "public"."well_readings"
    ADD CONSTRAINT "well_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."well_readings"
    ADD CONSTRAINT "well_readings_well_id_fkey" FOREIGN KEY ("well_id") REFERENCES "public"."wells"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wells"
    ADD CONSTRAINT "wells_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can read entity status audit log" ON "public"."entity_status_audit_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'Admin'::"public"."app_role")))));



CREATE POLICY "Admins can read product meter audit log" ON "public"."product_meter_audit_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'Admin'::"public"."app_role")))));



CREATE POLICY "Allow authenticated select on chemical_prices" ON "public"."chemical_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can insert entity status audit log" ON "public"."entity_status_audit_log" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can insert product meter audit log" ON "public"."product_meter_audit_log" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Operators can view same-plant operators" ON "public"."user_profiles" FOR SELECT USING ((("designation" = 'Operator'::"text") AND ("status" = 'Active'::"public"."profile_status")));



CREATE POLICY "Plants are publicly readable" ON "public"."plants" FOR SELECT USING (true);



CREATE POLICY "Users can view own profile" ON "public"."user_profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "admin_read_sessions" ON "public"."ai_chat_sessions" FOR SELECT USING ("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role"));



CREATE POLICY "admin_read_switch_log" ON "public"."operator_switch_log" FOR SELECT USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role")));



CREATE POLICY "admin_write_thresholds" ON "public"."compliance_thresholds" USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



ALTER TABLE "public"."afm_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "afm_readings_plant_access" ON "public"."afm_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."ai_chat_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analyst_delete_regression" ON "public"."regression_results" FOR DELETE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "analyst_insert_normalizations" ON "public"."reading_normalizations" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Data Analyst'::"public"."app_role"]))))) AND ("performed_by" = "auth"."uid"())));



CREATE POLICY "analyst_insert_raw_edit_log" ON "public"."raw_edit_log" FOR INSERT WITH CHECK (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "analyst_insert_regression" ON "public"."regression_results" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role"))));



CREATE POLICY "analyst_read_normalizations" ON "public"."reading_normalizations" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Data Analyst'::"public"."app_role"])))))));



CREATE POLICY "analyst_read_raw_edit_log" ON "public"."raw_edit_log" FOR SELECT USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role")));



CREATE POLICY "analyst_read_regression" ON "public"."regression_results" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role"))));



CREATE POLICY "analyst_update_norm_status_locator" ON "public"."locator_readings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Data Analyst'::"public"."app_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Data Analyst'::"public"."app_role"]))))));



CREATE POLICY "analyst_update_norm_status_well" ON "public"."well_readings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Data Analyst'::"public"."app_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Data Analyst'::"public"."app_role"]))))));



CREATE POLICY "analyst_update_regression" ON "public"."regression_results" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "analyst_write_blending_wells" ON "public"."blending_wells" USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "analyst_write_downtime" ON "public"."downtime_events" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role"))));



ALTER TABLE "public"."archived_plant_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "archived_plant_data_insert" ON "public"."archived_plant_data" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'Admin'::"public"."app_role")))));



CREATE POLICY "archived_plant_data_read" ON "public"."archived_plant_data" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"]))))));



CREATE POLICY "audit log insertable by admin/manager" ON "public"."deletion_audit_log" FOR INSERT WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "audit log readable by admin/manager" ON "public"."deletion_audit_log" FOR SELECT USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "auth_read_blending_events" ON "public"."blending_events" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth_read_blending_wells" ON "public"."blending_wells" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth_read_downtime" ON "public"."downtime_events" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth_read_snapshots" ON "public"."compliance_snapshots" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth_read_thresholds" ON "public"."compliance_thresholds" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "auth_write_switch_log" ON "public"."operator_switch_log" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "authenticated read" ON "public"."ro_plants" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."backfill_sweep_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "backfill_sweep_log_insert_auth" ON "public"."backfill_sweep_log" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "backfill_sweep_log_select_auth" ON "public"."backfill_sweep_log" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."blending_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blending_events_delete" ON "public"."blending_events" FOR DELETE TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "blending_events_insert" ON "public"."blending_events" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "blending_events_update" ON "public"."blending_events" FOR UPDATE TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."blending_wells" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cartridge_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cartridge_readings_plant_access" ON "public"."cartridge_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."chat_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_audit_select" ON "public"."chat_audit_log" FOR SELECT USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "recipient_id") OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"])))))));



CREATE POLICY "chat_delete_own" ON "public"."chat_messages" FOR DELETE TO "authenticated" USING (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "chat_insert" ON "public"."chat_messages" FOR INSERT TO "authenticated" WITH CHECK (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_insert" ON "public"."chat_messages" FOR INSERT TO "authenticated" WITH CHECK (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "chat_messages_select" ON "public"."chat_messages" FOR SELECT TO "authenticated" USING ((("sender_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("recipient_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "chat_select" ON "public"."chat_messages" FOR SELECT TO "authenticated" USING ((("sender_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("recipient_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."checklist_executions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checklist_executions_plant_access" ON "public"."checklist_executions" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."checklist_step_executions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checklist_step_executions_plant_access" ON "public"."checklist_step_executions" TO "authenticated" USING ((("plant_id" IS NULL) OR "public"."user_has_plant_access"("plant_id"))) WITH CHECK ((("plant_id" IS NULL) OR "public"."user_has_plant_access"("plant_id")));



ALTER TABLE "public"."checklist_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checklist_templates_read" ON "public"."checklist_templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "checklist_templates_write" ON "public"."checklist_templates" TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"())) WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "chem_deliveries_read" ON "public"."chemical_deliveries" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "chem_deliveries_write" ON "public"."chemical_deliveries" TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



CREATE POLICY "chem_prices_read" ON "public"."chemical_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "chem_prices_write" ON "public"."chemical_prices" TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"())) WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



ALTER TABLE "public"."chemical_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chemical_dosing_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chemical_dosing_logs_plant_access" ON "public"."chemical_dosing_logs" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."chemical_inventory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chemical_inventory_plant_access" ON "public"."chemical_inventory" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."chemical_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chemical_residual_samples" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cip_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cip_logs_analyst_select_bypass" ON "public"."cip_logs" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



CREATE POLICY "cip_logs_plant_access" ON "public"."cip_logs" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."compliance_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compliance_snapshots_insert" ON "public"."compliance_snapshots" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



ALTER TABLE "public"."compliance_thresholds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."correction_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "correction_requests_insert_own" ON "public"."correction_requests" FOR INSERT TO "authenticated" WITH CHECK (("public"."user_has_plant_access"("plant_id") AND ("submitted_by" = "auth"."uid"())));



CREATE POLICY "correction_requests_resolve_approvers" ON "public"."correction_requests" FOR UPDATE TO "authenticated" USING (("public"."is_manager_or_analyst_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_analyst_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



CREATE POLICY "correction_requests_select_plant" ON "public"."correction_requests" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "cr_manager_all" ON "public"."correction_requests" USING ("public"."is_manager_or_admin"("auth"."uid"())) WITH CHECK (true);



CREATE POLICY "cr_operator_insert" ON "public"."correction_requests" FOR INSERT WITH CHECK (("auth"."uid"() = "submitted_by"));



CREATE POLICY "cr_operator_select" ON "public"."correction_requests" FOR SELECT USING ((("auth"."uid"() = "submitted_by") OR "public"."is_manager_or_admin"("auth"."uid"())));



ALTER TABLE "public"."custom_role_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_role_overrides_admin_write" ON "public"."custom_role_overrides" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "custom_role_overrides_select" ON "public"."custom_role_overrides" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."custom_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_roles_admin_write" ON "public"."custom_roles" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "custom_roles_select" ON "public"."custom_roles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."daily_plant_summary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deletion_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "derived_locator_readings_delete_gate" ON "public"."locator_readings" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (((NOT (EXISTS ( SELECT 1
   FROM "public"."locators" "l"
  WHERE (("l"."id" = "locator_readings"."locator_id") AND "l"."is_derived")))) OR "public"."is_manager_or_analyst_or_admin"("auth"."uid"())));



CREATE POLICY "derived_locator_readings_insert_gate" ON "public"."locator_readings" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (((NOT (EXISTS ( SELECT 1
   FROM "public"."locators" "l"
  WHERE (("l"."id" = "locator_readings"."locator_id") AND "l"."is_derived")))) OR "public"."is_manager_or_analyst_or_admin"("auth"."uid"())));



CREATE POLICY "derived_locator_readings_update_gate" ON "public"."locator_readings" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (((NOT (EXISTS ( SELECT 1
   FROM "public"."locators" "l"
  WHERE (("l"."id" = "locator_readings"."locator_id") AND "l"."is_derived")))) OR "public"."is_manager_or_analyst_or_admin"("auth"."uid"()))) WITH CHECK (((NOT (EXISTS ( SELECT 1
   FROM "public"."locators" "l"
  WHERE (("l"."id" = "locator_readings"."locator_id") AND "l"."is_derived")))) OR "public"."is_manager_or_analyst_or_admin"("auth"."uid"())));



ALTER TABLE "public"."derived_meter_sweep_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "derived_meter_sweep_log_service_only" ON "public"."derived_meter_sweep_log" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."downtime_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dps_access" ON "public"."daily_plant_summary" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."electric_bills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "electric_bills_access" ON "public"."electric_bills" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."entity_status_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entity_status_audit_read" ON "public"."entity_status_audit_log" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "entity_status_audit_write" ON "public"."entity_status_audit_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



ALTER TABLE "public"."filter_replacements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filter_replacements_read" ON "public"."filter_replacements" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "filter_replacements_write" ON "public"."filter_replacements" TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



ALTER TABLE "public"."filter_unit_prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filter_unit_prices_select" ON "public"."filter_unit_prices" FOR SELECT USING (true);



CREATE POLICY "filter_unit_prices_write" ON "public"."filter_unit_prices" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



ALTER TABLE "public"."import_analysis" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "import_analysis insertable by admin/manager" ON "public"."import_analysis" FOR INSERT WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "import_analysis readable by admin/manager" ON "public"."import_analysis" FOR SELECT USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "import_analysis updatable by admin" ON "public"."import_analysis" FOR UPDATE USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."import_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "import_audit_log_insert_authenticated" ON "public"."import_audit_log" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "import_audit_log_read_admin" ON "public"."import_audit_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"]))))));



ALTER TABLE "public"."incidents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "incidents_analyst_select_bypass" ON "public"."incidents" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



CREATE POLICY "incidents_plant_access" ON "public"."incidents" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."locator_derived_review_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locator_meter_replacements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locator_meter_replacements_plant_access" ON "public"."locator_meter_replacements" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."locator_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locator_readings_analyst_read" ON "public"."locator_readings" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



CREATE POLICY "locator_readings_plant_access" ON "public"."locator_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "locator_replacements_insert" ON "public"."locator_meter_replacements" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("locator_meter_replacements"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "locator_replacements_select" ON "public"."locator_meter_replacements" FOR SELECT TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("locator_meter_replacements"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



ALTER TABLE "public"."locators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locators_delete" ON "public"."locators" FOR DELETE TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "locators_insert" ON "public"."locators" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("locators"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "locators_read" ON "public"."locators" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "locators_select" ON "public"."locators" FOR SELECT TO "authenticated" USING (("public"."is_admin"("auth"."uid"()) OR "public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("locators"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "locators_update" ON "public"."locators" FOR UPDATE TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("locators"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "locators_write" ON "public"."locators" TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



ALTER TABLE "public"."login_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "login_attempts insertable by anyone" ON "public"."login_attempts" FOR INSERT WITH CHECK (true);



CREATE POLICY "login_attempts readable by admin" ON "public"."login_attempts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'Admin'::"public"."app_role")))));



CREATE POLICY "manage well_blending" ON "public"."well_blending" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Manager'::"public"."app_role", 'Admin'::"public"."app_role"]))))));



ALTER TABLE "public"."migration_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "migration_state_admin_all" ON "public"."migration_state" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_insert_self" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_own_delete" ON "public"."notifications" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "notifications_own_select" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notifications_own_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."operator_switch_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."opex_budgets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "opex_budgets_all" ON "public"."opex_budgets" TO "authenticated" USING (("public"."user_has_plant_access"("plant_id") AND "public"."is_manager_or_admin"("auth"."uid"()))) WITH CHECK (("public"."user_has_plant_access"("plant_id") AND "public"."is_manager_or_admin"("auth"."uid"())));



CREATE POLICY "overrides_admin_write" ON "public"."user_permission_overrides" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "overrides_self_read" ON "public"."user_permission_overrides" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."plant_assignment_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plant_assignment_audit_admin" ON "public"."plant_assignment_audit" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."plant_edit_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plant_edit_audit_manager_insert" ON "public"."plant_edit_audit_log" FOR INSERT WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "plant_edit_audit_manager_read" ON "public"."plant_edit_audit_log" FOR SELECT USING ("public"."is_manager_or_admin"("auth"."uid"()));



ALTER TABLE "public"."plant_meter_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plant_meter_config: authenticated read" ON "public"."plant_meter_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "plant_meter_config_admin_write" ON "public"."plant_meter_config" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"]))))));



CREATE POLICY "plant_meter_config_read" ON "public"."plant_meter_config" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "plant_meter_config_write" ON "public"."plant_meter_config" TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



ALTER TABLE "public"."plant_multiplier_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plant_multiplier_cache_read_authenticated" ON "public"."plant_multiplier_cache" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



ALTER TABLE "public"."plant_power_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plant_power_config: authenticated read" ON "public"."plant_power_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "plant_power_config_access" ON "public"."plant_power_config" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."plant_topology_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plants_write_admin_manager" ON "public"."plants" TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"())) WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



ALTER TABLE "public"."power_meter_changes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "power_meter_changes_manager_all" ON "public"."power_meter_changes" USING ("public"."is_manager_or_admin"("auth"."uid"())) WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "power_meter_changes_plant_access" ON "public"."power_meter_changes" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "power_meter_changes_plant_read" ON "public"."power_meter_changes" FOR SELECT USING ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."power_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "power_readings_analyst_correction_write" ON "public"."power_readings" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role"))) WITH CHECK (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "power_readings_analyst_read" ON "public"."power_readings" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



CREATE POLICY "power_readings_plant_access" ON "public"."power_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."power_tariffs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "power_tariffs_read" ON "public"."power_tariffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "power_tariffs_write" ON "public"."power_tariffs" TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"())) WITH CHECK ("public"."is_manager_or_admin"("auth"."uid"()));



ALTER TABLE "public"."product_meter_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_meter_audit_log: admin read" ON "public"."product_meter_audit_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."designation" = 'Admin'::"text")))));



CREATE POLICY "product_meter_audit_read" ON "public"."product_meter_audit_log" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "product_meter_audit_write" ON "public"."product_meter_audit_log" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."product_meter_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_meter_readings: authenticated insert" ON "public"."product_meter_readings" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "product_meter_readings: authenticated read" ON "public"."product_meter_readings" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "product_meter_readings_manager_delete" ON "public"."product_meter_readings" FOR DELETE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role")));



CREATE POLICY "product_meter_readings_manager_update" ON "public"."product_meter_readings" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role"))) WITH CHECK (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "product_meter_readings_plant_access" ON "public"."product_meter_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."product_meter_replacements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_meter_replacements_plant_access" ON "public"."product_meter_replacements" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."product_meters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_meters: authenticated read" ON "public"."product_meters" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "product_meters: manager/admin write" ON "public"."product_meters" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."designation" = ANY (ARRAY['Manager'::"text", 'Admin'::"text"]))))));



CREATE POLICY "product_meters_plant_access" ON "public"."product_meters" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."production_calc_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "production_calc_log: manager/admin read" ON "public"."production_calc_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."designation" = ANY (ARRAY['Manager'::"text", 'Admin'::"text"]))))));



ALTER TABLE "public"."production_costs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "production_costs_access" ON "public"."production_costs" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "production_costs_read" ON "public"."production_costs" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "production_costs_write" ON "public"."production_costs" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "profiles_admin_all" ON "public"."user_profiles" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "profiles_insert_self" ON "public"."user_profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "profiles_select_manager" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "profiles_select_self" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."pump_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pump_readings_analyst_select_bypass" ON "public"."pump_readings" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



CREATE POLICY "pump_readings_plant_access" ON "public"."pump_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."raw_edit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read well_blending" ON "public"."well_blending" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "reading edit log insertable by plant users" ON "public"."reading_edit_audit_log" FOR INSERT WITH CHECK ((("plant_id" IS NULL) OR "public"."user_has_plant_access"("plant_id")));



CREATE POLICY "reading edit log readable by admin/manager/analyst" ON "public"."reading_edit_audit_log" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



ALTER TABLE "public"."reading_anomaly_remarks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reading_anomaly_remarks_insert" ON "public"."reading_anomaly_remarks" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "reading_anomaly_remarks_read" ON "public"."reading_anomaly_remarks" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."reading_edit_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reading_gap_reasons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reading_gap_reasons_plant_access" ON "public"."reading_gap_reasons" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."reading_normalizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regression_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "residual_samples_access" ON "public"."chemical_residual_samples" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "review_flags_read" ON "public"."locator_derived_review_flags" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locators" "l"
  WHERE (("l"."id" = "locator_derived_review_flags"."locator_id") AND "public"."user_has_plant_access"("l"."plant_id")))));



ALTER TABLE "public"."ro_plant_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_plant_users: select own" ON "public"."ro_plant_users" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."ro_plants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_pretreatment_access" ON "public"."ro_pretreatment_readings" TO "authenticated" USING ("public"."user_has_ro_write_access"("plant_id")) WITH CHECK ("public"."user_has_ro_write_access"("plant_id"));



ALTER TABLE "public"."ro_pretreatment_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_pretreatment_readings: delete manager" ON "public"."ro_pretreatment_readings" FOR DELETE USING (("plant_id" IN ( SELECT "ro_plant_users"."plant_id"
   FROM "public"."ro_plant_users"
  WHERE (("ro_plant_users"."user_id" = "auth"."uid"()) AND ("ro_plant_users"."role" = ANY (ARRAY['manager'::"text", 'admin'::"text"]))))));



CREATE POLICY "ro_pretreatment_readings: delete own record" ON "public"."ro_pretreatment_readings" FOR DELETE USING (("recorded_by" = "auth"."uid"()));



CREATE POLICY "ro_pretreatment_readings: insert own plant" ON "public"."ro_pretreatment_readings" FOR INSERT WITH CHECK (("plant_id" IN ( SELECT "ro_plant_users"."plant_id"
   FROM "public"."ro_plant_users"
  WHERE ("ro_plant_users"."user_id" = "auth"."uid"()))));



CREATE POLICY "ro_pretreatment_readings: select own plant" ON "public"."ro_pretreatment_readings" FOR SELECT USING (("plant_id" IN ( SELECT "ro_plant_users"."plant_id"
   FROM "public"."ro_plant_users"
  WHERE ("ro_plant_users"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."ro_train_data_gaps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_train_data_gaps_plant_access" ON "public"."ro_train_data_gaps" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."ro_train_meter_replacements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_train_meter_replacements_plant_access" ON "public"."ro_train_meter_replacements" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



ALTER TABLE "public"."ro_train_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_train_readings_authenticated_read" ON "public"."ro_train_readings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "ro_train_readings_plant_access" ON "public"."ro_train_readings" TO "authenticated" USING ("public"."user_has_ro_write_access"("plant_id")) WITH CHECK ("public"."user_has_ro_write_access"("plant_id"));



ALTER TABLE "public"."ro_trains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ro_trains_delete" ON "public"."ro_trains" FOR DELETE TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "ro_trains_insert" ON "public"."ro_trains" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("ro_trains"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "ro_trains_read" ON "public"."ro_trains" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "ro_trains_select" ON "public"."ro_trains" FOR SELECT TO "authenticated" USING (("public"."is_admin"("auth"."uid"()) OR "public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("ro_trains"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "ro_trains_update" ON "public"."ro_trains" FOR UPDATE TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("ro_trains"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "ro_trains_write" ON "public"."ro_trains" TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));



CREATE POLICY "roles_admin_all" ON "public"."user_roles" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "roles_select_manager" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "roles_select_self" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."signup_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signup_audit_admin_read" ON "public"."signup_audit" FOR SELECT USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "signup_audit_anon_insert" ON "public"."signup_audit" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."status_checks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "status_checks_authenticated_all" ON "public"."status_checks" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL)) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "supervisor_approve_locator" ON "public"."locator_readings" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role"))) WITH CHECK (true);



CREATE POLICY "supervisor_approve_well" ON "public"."well_readings" FOR UPDATE USING (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role"))) WITH CHECK (("public"."has_role"("auth"."uid"(), 'Admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Manager'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'Data Analyst'::"public"."app_role")));



CREATE POLICY "topology_links_delete" ON "public"."plant_topology_links" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"]))))));



CREATE POLICY "topology_links_insert" ON "public"."plant_topology_links" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['Admin'::"public"."app_role", 'Manager'::"public"."app_role"]))))));



CREATE POLICY "topology_links_select" ON "public"."plant_topology_links" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."train_status_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "train_status_log_access" ON "public"."train_status_log" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "user_own_sessions" ON "public"."ai_chat_sessions" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."user_permission_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profiles admin full update" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users see assigned plants" ON "public"."locators" FOR SELECT USING ((("plant_id" IN ( SELECT "unnest"("user_profiles"."plant_assignments") AS "unnest"
   FROM "public"."user_profiles"
  WHERE ("user_profiles"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'Admin'::"public"."app_role"))))));



ALTER TABLE "public"."well_blending" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."well_meter_replacements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "well_meter_replacements_plant_access" ON "public"."well_meter_replacements" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "well_pms_insert" ON "public"."well_pms_records" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."user_profiles"
     JOIN "public"."wells" ON (("wells"."id" = "well_pms_records"."well_id")))
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("wells"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



ALTER TABLE "public"."well_pms_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "well_pms_records_plant_access" ON "public"."well_pms_records" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "well_pms_select" ON "public"."well_pms_records" FOR SELECT TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."user_profiles"
     JOIN "public"."wells" ON (("wells"."id" = "well_pms_records"."well_id")))
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("wells"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



ALTER TABLE "public"."well_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "well_readings_analyst_read" ON "public"."well_readings" FOR SELECT USING ("public"."is_manager_or_analyst_or_admin"("auth"."uid"()));



CREATE POLICY "well_readings_plant_access" ON "public"."well_readings" TO "authenticated" USING ("public"."user_has_plant_access"("plant_id")) WITH CHECK ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "well_replacements_insert" ON "public"."well_meter_replacements" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("well_meter_replacements"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "well_replacements_select" ON "public"."well_meter_replacements" FOR SELECT TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("well_meter_replacements"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



ALTER TABLE "public"."wells" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wells_delete" ON "public"."wells" FOR DELETE TO "authenticated" USING ("public"."is_manager_or_admin"("auth"."uid"()));



CREATE POLICY "wells_insert" ON "public"."wells" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("wells"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "wells_read" ON "public"."wells" FOR SELECT TO "authenticated" USING ("public"."user_has_plant_access"("plant_id"));



CREATE POLICY "wells_select" ON "public"."wells" FOR SELECT TO "authenticated" USING (("public"."is_admin"("auth"."uid"()) OR "public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("wells"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "wells_update" ON "public"."wells" FOR UPDATE TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."status" = 'Active'::"public"."profile_status") AND ("wells"."plant_id" = ANY ("user_profiles"."plant_assignments")))))));



CREATE POLICY "wells_write" ON "public"."wells" TO "authenticated" USING (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id"))) WITH CHECK (("public"."is_manager_or_admin"("auth"."uid"()) AND "public"."user_has_plant_access"("plant_id")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "public"."admin_set_user_password"("_user_id" "uuid", "_new_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_user_password"("_user_id" "uuid", "_new_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_user_password"("_user_id" "uuid", "_new_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_user_password"("_user_id" "uuid", "_new_password" "text") TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_user"("_user_id" "uuid", "_approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_user"("_user_id" "uuid", "_approve" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."approve_user"("_user_id" "uuid", "_approve" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_user"("_user_id" "uuid", "_approve" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."backfill_well_deltas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_well_deltas"() TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_well_deltas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_well_deltas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chat_after_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chat_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."chat_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_after_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_onboarding"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text", "_plant_assignments" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_onboarding"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text", "_plant_assignments" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_onboarding"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text", "_plant_assignments" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_onboarding"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text", "_plant_assignments" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_auto_lock_on_approval"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auto_lock_on_approval"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auto_lock_on_approval"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_backfill_missing_readings"("p_date" "date", "p_lookback_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_backfill_missing_readings"("p_date" "date", "p_lookback_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_backfill_missing_readings"("p_date" "date", "p_lookback_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_backfill_missing_readings"("p_date" "date", "p_lookback_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_blending_set_reading"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_blending_set_reading"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_blending_set_reading"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_blending_upsert_reading"("p_well_id" "uuid", "p_plant_id" "uuid", "p_well_name" "text", "p_plant_name" "text", "p_event_date" "date", "p_reading_datetime" timestamp with time zone, "p_raw_meter_reading" numeric, "p_previous_reading" numeric, "p_update_previous_reading" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_blending_upsert_reading"("p_well_id" "uuid", "p_plant_id" "uuid", "p_well_name" "text", "p_plant_name" "text", "p_event_date" "date", "p_reading_datetime" timestamp with time zone, "p_raw_meter_reading" numeric, "p_previous_reading" numeric, "p_update_previous_reading" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_blending_upsert_reading"("p_well_id" "uuid", "p_plant_id" "uuid", "p_well_name" "text", "p_plant_name" "text", "p_event_date" "date", "p_reading_datetime" timestamp with time zone, "p_raw_meter_reading" numeric, "p_previous_reading" numeric, "p_update_previous_reading" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cascade_reading_correction"("p_table" "text", "p_row_id" "uuid", "p_new_current" numeric, "p_admin_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cascade_reading_correction"("p_table" "text", "p_row_id" "uuid", "p_new_current" numeric, "p_admin_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cascade_reading_correction"("p_table" "text", "p_row_id" "uuid", "p_new_current" numeric, "p_admin_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cascade_reading_correction"("p_table" "text", "p_row_id" "uuid", "p_new_current" numeric, "p_admin_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_compute_daily_plant_summary"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_filter_unit_price"("p_plant_id" "uuid", "p_housing_type" "text", "p_as_of" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_filter_unit_price"("p_plant_id" "uuid", "p_housing_type" "text", "p_as_of" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_filter_unit_price"("p_plant_id" "uuid", "p_housing_type" "text", "p_as_of" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_flag_derived_review"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_flag_derived_review"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_flag_derived_review"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_flag_derived_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_force_direct_mode_when_derived"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_force_direct_mode_when_derived"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_force_direct_mode_when_derived"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_guard_custom_role_override"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_guard_custom_role_override"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_guard_custom_role_override"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_locator_cooldown_minutes"("p_locator_id" "uuid", "p_plant_id" "uuid", "p_user_id" "uuid", "p_cooldown" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_locator_cooldown_minutes"("p_locator_id" "uuid", "p_plant_id" "uuid", "p_user_id" "uuid", "p_cooldown" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_locator_cooldown_minutes"("p_locator_id" "uuid", "p_plant_id" "uuid", "p_user_id" "uuid", "p_cooldown" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_locator_reading_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_locator_reading_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_locator_reading_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_manager_plant_scorecard"("p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notify_derived_review"("_locator_id" "uuid", "_date" "date", "_kind" "text", "_detail" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notify_operator_on_resolution"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notify_operator_on_resolution"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_notify_operator_on_resolution"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notify_operator_on_resolution"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notify_submitter_on_correction_rejection"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notify_supervisors_on_request"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notify_supervisors_on_request"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_notify_supervisors_on_request"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notify_supervisors_on_request"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_power_readings_after_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_power_readings_after_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_power_readings_after_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_power_readings_before_upsert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_power_readings_before_upsert"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_power_readings_before_upsert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_power_readings_before_upsert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_product_meter_reading_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_product_meter_reading_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_product_meter_reading_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_recalc_power_cache"("p_plant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_recalc_power_cache"("p_plant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_recalc_power_cache"("p_plant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_recalc_power_cache"("p_plant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_locator_daily_volume"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_locator_daily_volume"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_locator_daily_volume"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_product_meter_mirror"("p_meter_id" "uuid", "p_derived_from_locator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date", "p_lookback_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date", "p_lookback_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date", "p_lookback_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sweep_derived_meters"("p_date" "date", "p_lookback_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sweep_derived_meters_for_date"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_blending_reading_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_blending_reading_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_blending_reading_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_blending_reading_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_derived_locator_mirror"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_derived_locator_mirror"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_derived_locator_mirror"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_derived_locator_mirror"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_electric_bill_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_electric_bill_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_electric_bill_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_electric_bill_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_filter_cost_to_production_costs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_filter_cost_to_production_costs"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_filter_cost_to_production_costs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_filter_cost_to_production_costs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_filter_usage_cost"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_filter_usage_cost"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_filter_usage_cost"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_filter_usage_cost"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_locator_reading_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_locator_reading_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_locator_reading_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_locator_reading_chain"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_sync_permeate_is_production"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_permeate_is_production"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_permeate_is_production"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_product_meter_reading_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_product_meter_reading_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_product_meter_reading_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_product_meter_reading_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_ro_train_reading_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_ro_train_reading_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_ro_train_reading_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_ro_train_reading_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_well_power_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_well_power_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_well_power_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_well_power_chain"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_sync_well_reading_chain"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_sync_well_reading_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_well_reading_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_well_reading_chain"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_invalidate_power_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_invalidate_power_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_invalidate_power_cache"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_recalc_successor"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_recalc_successor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_recalc_successor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_trg_sync_operator_presence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_trg_sync_operator_presence"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_sync_operator_presence"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_sync_operator_presence"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_validate_ro_train_feed_source"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_validate_ro_train_feed_source"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_validate_ro_train_feed_source"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_well_reading_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_well_reading_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_well_reading_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_incident_ref"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_incident_ref"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_incident_ref"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_all_staff_profiles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_all_staff_profiles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_staff_profiles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_staff_profiles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_all_user_roles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_all_user_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_user_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_user_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_permeate_delta"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_permeate_delta"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_permeate_delta"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_manager_or_admin"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_manager_or_admin"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_manager_or_admin"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager_or_admin"("_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager_or_analyst_or_admin"("_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."permission_overridden_denied"("_user_id" "uuid", "_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."permission_overridden_denied"("_user_id" "uuid", "_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."permission_overridden_denied"("_user_id" "uuid", "_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."permission_overridden_denied"("_user_id" "uuid", "_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_expired_chat_messages"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_expired_chat_messages"() TO "anon";
GRANT ALL ON FUNCTION "public"."purge_expired_chat_messages"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_expired_chat_messages"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalc_power_cache_for_plant"("p_plant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalc_power_cache_for_plant"("p_plant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_power_cache_for_plant"("p_plant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_power_cache_for_plant"("p_plant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalculate_all_deltas"("p_plant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_all_deltas"("p_plant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_all_deltas"("p_plant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_all_deltas"("p_plant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_costs_for_tariff_window"("_plant" "uuid", "_from" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_costs_for_tariff_window"("_plant" "uuid", "_from" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_costs_for_tariff_window"("_plant" "uuid", "_from" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_costs_for_tariff_window"("_plant" "uuid", "_from" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_production_cost"("_plant_id" "uuid", "_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_production_cost"("_plant_id" "uuid", "_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_production_cost"("_plant_id" "uuid", "_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_production_cost"("_plant_id" "uuid", "_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_solar_cost"("_plant_id" "uuid", "_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_solar_cost"("_plant_id" "uuid", "_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_solar_cost"("_plant_id" "uuid", "_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_solar_cost"("_plant_id" "uuid", "_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_plant_multiplier_cache"("p_plant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_plant_multiplier_cache"("p_plant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_plant_multiplier_cache"("p_plant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_plant_multiplier_cache"("p_plant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_production_costs"("p_plant_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_production_costs"("p_plant_id" "uuid", "p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_production_costs"("p_plant_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_production_costs"("p_plant_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_plant_multiplier"("p_plant_id" "uuid", "p_meter_index" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_plant_multiplier"("p_plant_id" "uuid", "p_meter_index" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_plant_multiplier"("p_plant_id" "uuid", "p_meter_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_plant_multiplier"("p_plant_id" "uuid", "p_meter_index" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_daily_plant_summary_production"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_daily_plant_summary_production"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_daily_plant_summary_production"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_ro_train_reading_meter_replacement_flag"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_ro_train_reading_meter_replacement_flag"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_ro_train_reading_meter_replacement_flag"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_user_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_user_role_to_app_metadata"("_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_user_role_to_app_metadata"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_role_to_app_metadata"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_role_to_app_metadata"("_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_last_seen"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_last_seen"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_last_seen"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_last_seen"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_user_presence"("p_user_id" "uuid", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_user_presence"("p_user_id" "uuid", "p_action" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."touch_user_presence"("p_user_id" "uuid", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_user_presence"("p_user_id" "uuid", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_invalidate_multiplier_cache"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_invalidate_multiplier_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_invalidate_multiplier_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_invalidate_multiplier_cache"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_recompute_cost"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_recompute_cost"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recompute_cost"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recompute_cost"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_recompute_cost_on_tariff_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_recompute_cost_on_tariff_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recompute_cost_on_tariff_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recompute_cost_on_tariff_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_recompute_solar_cost"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_recompute_solar_cost"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recompute_solar_cost"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recompute_solar_cost"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_regression_results_outlier_count"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_regression_results_outlier_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_regression_results_outlier_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_regression_results_outlier_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_stamp_reading_multiplier"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_stamp_reading_multiplier"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_stamp_reading_multiplier"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_stamp_reading_multiplier"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_sync_user_role_to_app_metadata"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_sync_user_role_to_app_metadata"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sync_user_role_to_app_metadata"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sync_user_role_to_app_metadata"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_own_profile"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_own_profile"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_own_profile"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_own_profile"("_username" "text", "_first_name" "text", "_middle_name" "text", "_last_name" "text", "_suffix" "text", "_designation" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_has_plant_access"("_plant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_plant_access"("_plant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_plant_access"("_plant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_plant_access"("_plant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_has_ro_write_access"("_plant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_has_ro_write_access"("_plant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_ro_write_access"("_plant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_ro_write_access"("_plant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."well_readings_cascade_next"() TO "anon";
GRANT ALL ON FUNCTION "public"."well_readings_cascade_next"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."well_readings_cascade_next"() TO "service_role";



GRANT ALL ON FUNCTION "public"."well_readings_compute_daily_volume"() TO "anon";
GRANT ALL ON FUNCTION "public"."well_readings_compute_daily_volume"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."well_readings_compute_daily_volume"() TO "service_role";



GRANT ALL ON FUNCTION "public"."well_readings_compute_delta"() TO "anon";
GRANT ALL ON FUNCTION "public"."well_readings_compute_delta"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."well_readings_compute_delta"() TO "service_role";
























GRANT ALL ON TABLE "public"."afm_readings" TO "anon";
GRANT ALL ON TABLE "public"."afm_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."afm_readings" TO "service_role";



GRANT ALL ON TABLE "public"."ai_chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."ai_chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_chat_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."archived_plant_data" TO "anon";
GRANT ALL ON TABLE "public"."archived_plant_data" TO "authenticated";
GRANT ALL ON TABLE "public"."archived_plant_data" TO "service_role";



GRANT ALL ON TABLE "public"."backfill_sweep_log" TO "anon";
GRANT ALL ON TABLE "public"."backfill_sweep_log" TO "authenticated";
GRANT ALL ON TABLE "public"."backfill_sweep_log" TO "service_role";



GRANT ALL ON TABLE "public"."blending_events" TO "anon";
GRANT ALL ON TABLE "public"."blending_events" TO "authenticated";
GRANT ALL ON TABLE "public"."blending_events" TO "service_role";



GRANT ALL ON TABLE "public"."blending_wells" TO "anon";
GRANT ALL ON TABLE "public"."blending_wells" TO "authenticated";
GRANT ALL ON TABLE "public"."blending_wells" TO "service_role";



GRANT ALL ON TABLE "public"."cartridge_readings" TO "anon";
GRANT ALL ON TABLE "public"."cartridge_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."cartridge_readings" TO "service_role";



GRANT ALL ON TABLE "public"."chat_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."chat_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_executions" TO "anon";
GRANT ALL ON TABLE "public"."checklist_executions" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_executions" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_step_executions" TO "anon";
GRANT ALL ON TABLE "public"."checklist_step_executions" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_step_executions" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_templates" TO "anon";
GRANT ALL ON TABLE "public"."checklist_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_templates" TO "service_role";



GRANT ALL ON TABLE "public"."chemical_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."chemical_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."chemical_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."chemical_dosing_logs" TO "anon";
GRANT ALL ON TABLE "public"."chemical_dosing_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."chemical_dosing_logs" TO "service_role";



GRANT ALL ON TABLE "public"."chemical_inventory" TO "anon";
GRANT ALL ON TABLE "public"."chemical_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."chemical_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."chemical_prices" TO "anon";
GRANT ALL ON TABLE "public"."chemical_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."chemical_prices" TO "service_role";



GRANT ALL ON TABLE "public"."chemical_residual_samples" TO "anon";
GRANT ALL ON TABLE "public"."chemical_residual_samples" TO "authenticated";
GRANT ALL ON TABLE "public"."chemical_residual_samples" TO "service_role";



GRANT ALL ON TABLE "public"."cip_logs" TO "anon";
GRANT ALL ON TABLE "public"."cip_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."cip_logs" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."compliance_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."compliance_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_thresholds" TO "anon";
GRANT ALL ON TABLE "public"."compliance_thresholds" TO "authenticated";
GRANT ALL ON TABLE "public"."compliance_thresholds" TO "service_role";



GRANT ALL ON TABLE "public"."correction_requests" TO "anon";
GRANT ALL ON TABLE "public"."correction_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."correction_requests" TO "service_role";



GRANT ALL ON TABLE "public"."custom_role_overrides" TO "anon";
GRANT ALL ON TABLE "public"."custom_role_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_role_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."custom_roles" TO "anon";
GRANT ALL ON TABLE "public"."custom_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_roles" TO "service_role";



GRANT ALL ON TABLE "public"."daily_plant_summary" TO "anon";
GRANT ALL ON TABLE "public"."daily_plant_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_plant_summary" TO "service_role";



GRANT ALL ON TABLE "public"."deletion_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."deletion_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."deletion_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."derived_meter_sweep_log" TO "anon";
GRANT ALL ON TABLE "public"."derived_meter_sweep_log" TO "authenticated";
GRANT ALL ON TABLE "public"."derived_meter_sweep_log" TO "service_role";



GRANT ALL ON TABLE "public"."downtime_events" TO "anon";
GRANT ALL ON TABLE "public"."downtime_events" TO "authenticated";
GRANT ALL ON TABLE "public"."downtime_events" TO "service_role";



GRANT ALL ON TABLE "public"."electric_bills" TO "anon";
GRANT ALL ON TABLE "public"."electric_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."electric_bills" TO "service_role";



GRANT ALL ON TABLE "public"."entity_status_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."entity_status_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_status_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."filter_replacements" TO "anon";
GRANT ALL ON TABLE "public"."filter_replacements" TO "authenticated";
GRANT ALL ON TABLE "public"."filter_replacements" TO "service_role";



GRANT ALL ON TABLE "public"."filter_unit_prices" TO "anon";
GRANT ALL ON TABLE "public"."filter_unit_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."filter_unit_prices" TO "service_role";



GRANT ALL ON TABLE "public"."plants" TO "anon";
GRANT ALL ON TABLE "public"."plants" TO "authenticated";
GRANT ALL ON TABLE "public"."plants" TO "service_role";



GRANT ALL ON TABLE "public"."ro_pretreatment_readings" TO "anon";
GRANT ALL ON TABLE "public"."ro_pretreatment_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_pretreatment_readings" TO "service_role";



GRANT ALL ON TABLE "public"."ro_trains" TO "anon";
GRANT ALL ON TABLE "public"."ro_trains" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_trains" TO "service_role";



GRANT ALL ON TABLE "public"."filter_usage_daily" TO "anon";
GRANT ALL ON TABLE "public"."filter_usage_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."filter_usage_daily" TO "service_role";



GRANT ALL ON TABLE "public"."import_analysis" TO "anon";
GRANT ALL ON TABLE "public"."import_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."import_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."import_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."import_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."import_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."incidents" TO "anon";
GRANT ALL ON TABLE "public"."incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."incidents" TO "service_role";



GRANT ALL ON TABLE "public"."locator_derived_review_flags" TO "anon";
GRANT ALL ON TABLE "public"."locator_derived_review_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."locator_derived_review_flags" TO "service_role";



GRANT ALL ON TABLE "public"."locator_meter_replacements" TO "anon";
GRANT ALL ON TABLE "public"."locator_meter_replacements" TO "authenticated";
GRANT ALL ON TABLE "public"."locator_meter_replacements" TO "service_role";



GRANT ALL ON TABLE "public"."locator_readings" TO "anon";
GRANT ALL ON TABLE "public"."locator_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."locator_readings" TO "service_role";



GRANT ALL ON TABLE "public"."locator_readings_clean" TO "anon";
GRANT ALL ON TABLE "public"."locator_readings_clean" TO "authenticated";
GRANT ALL ON TABLE "public"."locator_readings_clean" TO "service_role";



GRANT ALL ON TABLE "public"."locator_readings_latest" TO "anon";
GRANT ALL ON TABLE "public"."locator_readings_latest" TO "authenticated";
GRANT ALL ON TABLE "public"."locator_readings_latest" TO "service_role";



GRANT ALL ON TABLE "public"."locators" TO "anon";
GRANT ALL ON TABLE "public"."locators" TO "authenticated";
GRANT ALL ON TABLE "public"."locators" TO "service_role";



GRANT ALL ON TABLE "public"."login_attempts" TO "anon";
GRANT ALL ON TABLE "public"."login_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."login_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."migration_state" TO "anon";
GRANT ALL ON TABLE "public"."migration_state" TO "authenticated";
GRANT ALL ON TABLE "public"."migration_state" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."well_readings" TO "anon";
GRANT ALL ON TABLE "public"."well_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."well_readings" TO "service_role";



GRANT ALL ON TABLE "public"."operator_error_rates_30d" TO "anon";
GRANT ALL ON TABLE "public"."operator_error_rates_30d" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_error_rates_30d" TO "service_role";



GRANT ALL ON TABLE "public"."operator_switch_log" TO "anon";
GRANT ALL ON TABLE "public"."operator_switch_log" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_switch_log" TO "service_role";



GRANT ALL ON TABLE "public"."opex_budgets" TO "anon";
GRANT ALL ON TABLE "public"."opex_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."opex_budgets" TO "service_role";



GRANT ALL ON TABLE "public"."plant_assignment_audit" TO "anon";
GRANT ALL ON TABLE "public"."plant_assignment_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_assignment_audit" TO "service_role";



GRANT ALL ON TABLE "public"."plant_edit_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."plant_edit_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_edit_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."plant_meter_config" TO "anon";
GRANT ALL ON TABLE "public"."plant_meter_config" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_meter_config" TO "service_role";



GRANT ALL ON TABLE "public"."plant_multiplier_cache" TO "anon";
GRANT ALL ON TABLE "public"."plant_multiplier_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_multiplier_cache" TO "service_role";



GRANT ALL ON TABLE "public"."plant_power_config" TO "anon";
GRANT ALL ON TABLE "public"."plant_power_config" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_power_config" TO "service_role";



GRANT ALL ON TABLE "public"."plant_topology_links" TO "anon";
GRANT ALL ON TABLE "public"."plant_topology_links" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_topology_links" TO "service_role";



GRANT ALL ON TABLE "public"."power_meter_changes" TO "anon";
GRANT ALL ON TABLE "public"."power_meter_changes" TO "authenticated";
GRANT ALL ON TABLE "public"."power_meter_changes" TO "service_role";



GRANT ALL ON TABLE "public"."power_readings" TO "anon";
GRANT ALL ON TABLE "public"."power_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."power_readings" TO "service_role";



GRANT ALL ON TABLE "public"."power_tariffs" TO "anon";
GRANT ALL ON TABLE "public"."power_tariffs" TO "authenticated";
GRANT ALL ON TABLE "public"."power_tariffs" TO "service_role";



GRANT ALL ON TABLE "public"."product_meter_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."product_meter_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."product_meter_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."product_meter_readings" TO "anon";
GRANT ALL ON TABLE "public"."product_meter_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."product_meter_readings" TO "service_role";



GRANT ALL ON TABLE "public"."product_meter_readings_clean" TO "anon";
GRANT ALL ON TABLE "public"."product_meter_readings_clean" TO "authenticated";
GRANT ALL ON TABLE "public"."product_meter_readings_clean" TO "service_role";



GRANT ALL ON TABLE "public"."product_meter_readings_latest" TO "anon";
GRANT ALL ON TABLE "public"."product_meter_readings_latest" TO "authenticated";
GRANT ALL ON TABLE "public"."product_meter_readings_latest" TO "service_role";



GRANT ALL ON TABLE "public"."product_meter_replacements" TO "anon";
GRANT ALL ON TABLE "public"."product_meter_replacements" TO "authenticated";
GRANT ALL ON TABLE "public"."product_meter_replacements" TO "service_role";



GRANT ALL ON TABLE "public"."product_meters" TO "anon";
GRANT ALL ON TABLE "public"."product_meters" TO "authenticated";
GRANT ALL ON TABLE "public"."product_meters" TO "service_role";



GRANT ALL ON TABLE "public"."production_calc_log" TO "anon";
GRANT ALL ON TABLE "public"."production_calc_log" TO "authenticated";
GRANT ALL ON TABLE "public"."production_calc_log" TO "service_role";



GRANT ALL ON TABLE "public"."production_costs" TO "anon";
GRANT ALL ON TABLE "public"."production_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."production_costs" TO "service_role";



GRANT ALL ON TABLE "public"."pump_readings" TO "anon";
GRANT ALL ON TABLE "public"."pump_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."pump_readings" TO "service_role";



GRANT ALL ON TABLE "public"."raw_edit_log" TO "anon";
GRANT ALL ON TABLE "public"."raw_edit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_edit_log" TO "service_role";



GRANT ALL ON TABLE "public"."reading_anomaly_remarks" TO "anon";
GRANT ALL ON TABLE "public"."reading_anomaly_remarks" TO "authenticated";
GRANT ALL ON TABLE "public"."reading_anomaly_remarks" TO "service_role";



GRANT ALL ON TABLE "public"."reading_edit_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."reading_edit_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."reading_edit_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."reading_gap_reasons" TO "anon";
GRANT ALL ON TABLE "public"."reading_gap_reasons" TO "authenticated";
GRANT ALL ON TABLE "public"."reading_gap_reasons" TO "service_role";



GRANT ALL ON TABLE "public"."reading_normalizations" TO "anon";
GRANT ALL ON TABLE "public"."reading_normalizations" TO "authenticated";
GRANT ALL ON TABLE "public"."reading_normalizations" TO "service_role";



GRANT ALL ON TABLE "public"."regression_results" TO "anon";
GRANT ALL ON TABLE "public"."regression_results" TO "authenticated";
GRANT ALL ON TABLE "public"."regression_results" TO "service_role";



GRANT ALL ON TABLE "public"."ro_plant_users" TO "anon";
GRANT ALL ON TABLE "public"."ro_plant_users" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_plant_users" TO "service_role";



GRANT ALL ON TABLE "public"."ro_plants" TO "anon";
GRANT ALL ON TABLE "public"."ro_plants" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_plants" TO "service_role";



GRANT ALL ON TABLE "public"."ro_train_data_gaps" TO "anon";
GRANT ALL ON TABLE "public"."ro_train_data_gaps" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_train_data_gaps" TO "service_role";



GRANT ALL ON TABLE "public"."ro_train_meter_replacements" TO "anon";
GRANT ALL ON TABLE "public"."ro_train_meter_replacements" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_train_meter_replacements" TO "service_role";



GRANT ALL ON TABLE "public"."ro_train_readings" TO "anon";
GRANT ALL ON TABLE "public"."ro_train_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_train_readings" TO "service_role";



GRANT ALL ON TABLE "public"."ro_train_readings_clean" TO "anon";
GRANT ALL ON TABLE "public"."ro_train_readings_clean" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_train_readings_clean" TO "service_role";



GRANT ALL ON TABLE "public"."ro_train_readings_latest" TO "anon";
GRANT ALL ON TABLE "public"."ro_train_readings_latest" TO "authenticated";
GRANT ALL ON TABLE "public"."ro_train_readings_latest" TO "service_role";



GRANT ALL ON TABLE "public"."signup_audit" TO "anon";
GRANT ALL ON TABLE "public"."signup_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."signup_audit" TO "service_role";



GRANT ALL ON TABLE "public"."status_checks" TO "anon";
GRANT ALL ON TABLE "public"."status_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."status_checks" TO "service_role";



GRANT ALL ON TABLE "public"."train_status_log" TO "anon";
GRANT ALL ON TABLE "public"."train_status_log" TO "authenticated";
GRANT ALL ON TABLE "public"."train_status_log" TO "service_role";



GRANT ALL ON TABLE "public"."user_permission_overrides" TO "anon";
GRANT ALL ON TABLE "public"."user_permission_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permission_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."v_power_readings_resolved" TO "anon";
GRANT ALL ON TABLE "public"."v_power_readings_resolved" TO "authenticated";
GRANT ALL ON TABLE "public"."v_power_readings_resolved" TO "service_role";



GRANT ALL ON TABLE "public"."v_ro_train_power_allocated" TO "anon";
GRANT ALL ON TABLE "public"."v_ro_train_power_allocated" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ro_train_power_allocated" TO "service_role";



GRANT ALL ON TABLE "public"."well_blending" TO "anon";
GRANT ALL ON TABLE "public"."well_blending" TO "authenticated";
GRANT ALL ON TABLE "public"."well_blending" TO "service_role";



GRANT ALL ON TABLE "public"."well_meter_replacements" TO "anon";
GRANT ALL ON TABLE "public"."well_meter_replacements" TO "authenticated";
GRANT ALL ON TABLE "public"."well_meter_replacements" TO "service_role";



GRANT ALL ON TABLE "public"."well_pms_records" TO "anon";
GRANT ALL ON TABLE "public"."well_pms_records" TO "authenticated";
GRANT ALL ON TABLE "public"."well_pms_records" TO "service_role";



GRANT ALL ON TABLE "public"."well_readings_clean" TO "anon";
GRANT ALL ON TABLE "public"."well_readings_clean" TO "authenticated";
GRANT ALL ON TABLE "public"."well_readings_clean" TO "service_role";



GRANT ALL ON TABLE "public"."well_readings_latest" TO "anon";
GRANT ALL ON TABLE "public"."well_readings_latest" TO "authenticated";
GRANT ALL ON TABLE "public"."well_readings_latest" TO "service_role";



GRANT ALL ON TABLE "public"."wells" TO "anon";
GRANT ALL ON TABLE "public"."wells" TO "authenticated";
GRANT ALL ON TABLE "public"."wells" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE OR REPLACE TRIGGER "on_auth_user_email_updated" AFTER UPDATE ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."sync_user_email"();



