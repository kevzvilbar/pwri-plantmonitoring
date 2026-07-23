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
