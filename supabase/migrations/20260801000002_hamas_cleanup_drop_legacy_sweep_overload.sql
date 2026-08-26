-- =============================================================================
-- Migration: hamas_cleanup_drop_legacy_sweep_overload
-- Applied 2026-08-01.
--
-- fn_sweep_derived_meters(p_lookback_days integer DEFAULT 90) was a legacy
-- overload built directly on production (never committed to git, discovered
-- via pg_get_functiondef during the HAMAS all-zero-history investigation).
-- It predates fn_sweep_derived_meters(p_date, p_lookback_days) — the version
-- actually called by LocatorSection.tsx's "Recalculate now" button and by
-- derived-meter-sweep.yml — and used a different, less careful strategy
-- (a naive SUM(daily_volume) sibling calc with no direct-input-mode
-- awareness). Nothing in the frontend, backend, or GitHub workflows calls
-- this specific single-arg signature — confirmed by grepping the full repo.
-- Dropping it removes a second, confusing implementation of "sweep HAMAS"
-- that could be invoked by accident (e.g. from the SQL editor) and produce
-- results inconsistent with the real dispatcher.
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_sweep_derived_meters(integer);
