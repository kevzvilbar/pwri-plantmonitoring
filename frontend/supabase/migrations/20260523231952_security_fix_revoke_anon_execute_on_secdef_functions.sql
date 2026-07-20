-- Migration: 20260523231952_security_fix_revoke_anon_execute_on_secdef_functions.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- SECURITY FIX 1: Revoke anon/public EXECUTE on SECURITY DEFINER
-- functions that should never be callable without authentication.
-- ============================================================

-- Admin-only functions (no one but authenticated admins should call these)
REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_user(uuid, boolean) FROM PUBLIC;

-- Trigger-only functions (called by triggers, not REST API)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_after_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_invalidate_multiplier_cache() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_stamp_reading_multiplier() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_cost() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_electric_bill_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_locator_reading_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_power_reading_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_ro_train_reading_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_well_power_chain() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_well_reading_chain() FROM PUBLIC;

-- Internal helpers (called inside other functions, not via REST API)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_manager_or_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_plant_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_plant_multiplier(uuid, integer) FROM PUBLIC;

-- Admin/service operations (should only be callable by authenticated admin users)
REVOKE EXECUTE ON FUNCTION public.recalc_power_cache_for_plant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_all_deltas(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_production_cost(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_plant_multiplier_cache(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_chat_messages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_all_staff_profiles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_all_user_roles() FROM PUBLIC;

-- Authenticated-user-only functions (revoke anon, keep authenticated)
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(text, text, text, text, text, text, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_own_profile(text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.touch_last_seen() FROM anon;

-- Re-grant the authenticated-user functions back to authenticated role explicitly
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, text, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;
;
