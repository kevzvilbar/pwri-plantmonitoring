-- Migration: 20260523232110_perf_fix_duplicate_and_unused_indexes.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- PERFORMANCE FIX 1: Drop duplicate index on chat_messages
-- (idx_chat_messages_expires is an exact copy of chat_messages_expires_idx)
-- ============================================================
DROP INDEX IF EXISTS public.idx_chat_messages_expires;

-- ============================================================
-- PERFORMANCE FIX 2: Drop confirmed unused indexes
-- (Supabase reports zero scans on all of these since last stats reset)
-- ============================================================
DROP INDEX IF EXISTS public.archived_plant_data_table_idx;
DROP INDEX IF EXISTS public.archived_plant_data_archived_at_idx;
DROP INDEX IF EXISTS public.archived_plant_data_plant_idx;
DROP INDEX IF EXISTS public.production_calc_log_plant_idx;
DROP INDEX IF EXISTS public.production_calc_log_ts_idx;
DROP INDEX IF EXISTS public.product_meters_plant_sort_idx;
DROP INDEX IF EXISTS public.product_meter_audit_plant_idx;
DROP INDEX IF EXISTS public.idx_chat_messages_pair;
DROP INDEX IF EXISTS public.idx_locator_readings_estimated;
DROP INDEX IF EXISTS public.idx_ce_template;
DROP INDEX IF EXISTS public.deletion_audit_log_kind_entity_idx;
DROP INDEX IF EXISTS public.deletion_audit_log_created_idx;
DROP INDEX IF EXISTS public.idx_residual_dosing;
DROP INDEX IF EXISTS public.idx_cse_execution;
DROP INDEX IF EXISTS public.idx_cse_template;
DROP INDEX IF EXISTS public.idx_cse_plant;
DROP INDEX IF EXISTS public.wells_is_blending_idx;
DROP INDEX IF EXISTS public.import_analysis_status_idx;
DROP INDEX IF EXISTS public.import_analysis_created_idx;
DROP INDEX IF EXISTS public.login_attempts_email_idx;
DROP INDEX IF EXISTS public.login_attempts_attempted_idx;
DROP INDEX IF EXISTS public.chat_messages_pair_idx;
DROP INDEX IF EXISTS public.idx_blending_wells_plant;
DROP INDEX IF EXISTS public.ro_trains_shared_power_group_idx;
DROP INDEX IF EXISTS public.idx_downtime_plant_date;
DROP INDEX IF EXISTS public.idx_compliance_snap_plant;
DROP INDEX IF EXISTS public.idx_ai_sessions_user;
DROP INDEX IF EXISTS public.idx_reading_norm_source;
;
