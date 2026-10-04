-- =============================================================================
-- Migration: 20261004000003_advisor_followups.sql
--
-- Items from the 2026-10-04 Security/Performance Advisor review that are NOT already
-- covered by the unapplied hardening migrations 20260923000001, 20260930000001..3.
-- (20261003000001_harden_security_definer_search_paths.sql is an EMPTY file in the repo;
--  the search_path fix below is what it was meant to contain.)
-- Idempotent; safe to re-run.
-- =============================================================================

-- 1. Function Search Path Mutable (8 warnings) -----------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fn_filter_unit_price', 'fn_force_direct_mode_when_derived',
        'fn_guard_custom_role_override', 'fn_set_locator_daily_volume',
        'fn_sync_permeate_is_production', 'fn_validate_ro_train_feed_source',
        'sync_daily_plant_summary_production', 'sync_ro_train_reading_meter_replacement_flag')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 2. Trigger functions must not be RPC-callable ----------------------------------
-- Triggers do not need EXECUTE at fire time (only the trigger creator does), so this
-- cannot break existing triggers. Removes 4 anon + 4 authenticated advisor warnings.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 3. Identical duplicate indexes (keep the one with scan history) ----------------
-- Only plain, non-unique, non-constraint indexes (verified live). The ro_train_data_gaps
-- pair is left alone: one of the two backs a unique constraint.
drop index if exists public.idx_lmr_locator;
drop index if exists public.product_meter_readings_plant_dt_idx;
drop index if exists public.idx_ro_pretreatment_readings_plant_id;
drop index if exists public.idx_pretreatment_train_dt;
drop index if exists public.idx_rtr_train_dt;
drop index if exists public.idx_wells_plant;
