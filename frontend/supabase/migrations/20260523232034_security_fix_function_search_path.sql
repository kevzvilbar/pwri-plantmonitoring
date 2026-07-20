-- Migration: 20260523232034_security_fix_function_search_path.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- SECURITY FIX 2: Pin search_path on all functions that have
-- a mutable search_path (prevents search-path injection attacks).
-- ============================================================
ALTER FUNCTION public.chat_after_insert()                                          SET search_path = '';
ALTER FUNCTION public.set_updated_at()                                             SET search_path = '';
ALTER FUNCTION public.refresh_production_costs(uuid, date, date)                   SET search_path = '';
ALTER FUNCTION public.well_readings_compute_daily_volume()                         SET search_path = '';
ALTER FUNCTION public.product_meter_readings_compute_daily_volume()                SET search_path = '';
ALTER FUNCTION public.guard_permeate_delta()                                       SET search_path = '';
ALTER FUNCTION public.well_readings_compute_delta()                                SET search_path = '';
ALTER FUNCTION public.backfill_well_deltas()                                       SET search_path = '';
ALTER FUNCTION public.well_readings_cascade_next()                                 SET search_path = '';
ALTER FUNCTION public._get_power_multiplier(uuid)                                  SET search_path = '';
ALTER FUNCTION public._recompute_power_row(uuid)                                   SET search_path = '';
ALTER FUNCTION public.fn_power_readings_before_upsert()                            SET search_path = '';
ALTER FUNCTION public.fn_power_readings_after_upsert()                             SET search_path = '';
ALTER FUNCTION public.fn_power_readings_after_delete()                             SET search_path = '';
ALTER FUNCTION public.fn_recalc_power_cache(uuid)                                  SET search_path = '';
ALTER FUNCTION public.fn_trg_invalidate_power_cache()                              SET search_path = '';
ALTER FUNCTION public.fn_trg_recalc_successor()                                    SET search_path = '';
ALTER FUNCTION public.recalc_power_cache_for_plant(uuid)                           SET search_path = '';
ALTER FUNCTION public.resolve_plant_multiplier(uuid, integer)                      SET search_path = '';
ALTER FUNCTION public.refresh_plant_multiplier_cache(uuid)                         SET search_path = '';
ALTER FUNCTION public.trg_invalidate_multiplier_cache()                            SET search_path = '';
ALTER FUNCTION public.trg_stamp_reading_multiplier()                               SET search_path = '';
;
