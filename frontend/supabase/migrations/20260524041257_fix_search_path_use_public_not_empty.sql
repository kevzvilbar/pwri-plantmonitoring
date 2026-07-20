-- Migration: 20260524041257_fix_search_path_use_public_not_empty.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- FIX: Change search_path from '' to 'public' on all functions.
-- Empty search_path breaks unqualified table references (e.g.
-- FROM well_readings → fails, needs FROM public.well_readings).
-- Setting 'public' keeps the path FIXED (same security benefit)
-- while letting existing unqualified names resolve correctly.
-- ============================================================

ALTER FUNCTION public.chat_after_insert()                                       SET search_path = public;
ALTER FUNCTION public.set_updated_at()                                          SET search_path = public;
ALTER FUNCTION public.well_readings_compute_daily_volume()                      SET search_path = public;
ALTER FUNCTION public.product_meter_readings_compute_daily_volume()             SET search_path = public;
ALTER FUNCTION public.guard_permeate_delta()                                    SET search_path = public;
ALTER FUNCTION public.well_readings_compute_delta()                             SET search_path = public;
ALTER FUNCTION public.backfill_well_deltas()                                    SET search_path = public;
ALTER FUNCTION public.well_readings_cascade_next()                              SET search_path = public;
ALTER FUNCTION public._get_power_multiplier(p_plant_id uuid)                   SET search_path = public;
ALTER FUNCTION public._recompute_power_row(p_id uuid)                          SET search_path = public;
ALTER FUNCTION public.fn_power_readings_before_upsert()                        SET search_path = public;
ALTER FUNCTION public.fn_power_readings_after_upsert()                         SET search_path = public;
ALTER FUNCTION public.fn_power_readings_after_delete()                         SET search_path = public;
ALTER FUNCTION public.fn_recalc_power_cache(p_plant_id uuid)                   SET search_path = public;
ALTER FUNCTION public.fn_trg_invalidate_power_cache()                          SET search_path = public;
ALTER FUNCTION public.fn_trg_recalc_successor()                                SET search_path = public;
ALTER FUNCTION public.recalc_power_cache_for_plant(p_plant_id uuid)            SET search_path = public;
ALTER FUNCTION public.resolve_plant_multiplier(p_plant_id uuid, p_meter_index integer)  SET search_path = public;
ALTER FUNCTION public.refresh_plant_multiplier_cache(p_plant_id uuid)          SET search_path = public;
ALTER FUNCTION public.trg_invalidate_multiplier_cache()                        SET search_path = public;
ALTER FUNCTION public.trg_stamp_reading_multiplier()                           SET search_path = public;
ALTER FUNCTION public.refresh_production_costs(p_plant_id uuid, p_from date, p_to date) SET search_path = public;
;
