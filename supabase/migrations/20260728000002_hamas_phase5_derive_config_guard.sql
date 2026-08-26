-- =============================================================================
-- Migration: 20260728_hamas_phase5_derive_config_guard.sql
-- Phase 5 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   Phases 0-4 built the compute/override/notify engine assuming
--   is_derived=true always comes with a non-null derived_from_meter_id —
--   fn_sweep_derived_meters() (Phase 2) filters on exactly that pair, and a
--   row that violates it just gets silently skipped by the sweep with no
--   error surfaced anywhere.
--
--   Until now the only way to set these two columns was a direct Supabase
--   table edit, so a mismatched pair never actually happened in practice.
--   This phase adds the "Derived / Hamas-style" toggle + mother-meter picker
--   to the Locator dialogs (frontend/src/pages/plants/locators/LocatorDialogs.tsx),
--   which makes it a normal form a Manager/Admin can get wrong — the API
--   layer's own validation (form.is_derived && !form.derived_from_meter_id
--   blocks Save) is a UX convenience, not enforcement. This CHECK constraint
--   is the actual enforcement, matching the project's existing pattern of a
--   client-side check paired with a DB-level one (see e.g. the
--   default_input_mode CHECK from Phase 1).
--
-- NOTE: does not attempt to prevent a derived_from_meter_id that creates a
-- cycle (A derived from a meter that itself mirrors a locator derived from
-- A) — that would need a recursive check across two tables and hasn't come
-- up in practice. Worth a follow-up if this ever gets more than a couple of
-- hops deep.
-- =============================================================================

ALTER TABLE public.locators
  DROP CONSTRAINT IF EXISTS locators_derived_requires_mother_meter;

ALTER TABLE public.locators
  ADD CONSTRAINT locators_derived_requires_mother_meter
  CHECK (NOT is_derived OR derived_from_meter_id IS NOT NULL);

COMMENT ON CONSTRAINT locators_derived_requires_mother_meter ON public.locators IS
  'A derived locator with no mother meter is silently invisible to '
  'fn_sweep_derived_meters() (it filters on is_derived=true AND '
  'derived_from_meter_id IS NOT NULL) — this makes that state impossible '
  'to save instead of failing quietly. Added alongside the Locator-dialog '
  'derive toggle in 20260728 (LocatorDialogs.tsx).';

NOTIFY pgrst, 'reload schema';
