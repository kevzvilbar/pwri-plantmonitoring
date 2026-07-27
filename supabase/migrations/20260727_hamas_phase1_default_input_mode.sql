-- =============================================================================
-- Migration: 20260727_hamas_phase1_default_input_mode.sql
-- Phase 1 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   The "Direct m³ / Raw Meter" toggle in Operations > Locator was never
--   persisted server-side — LocatorSection.tsx read/wrote it to
--   localStorage.getItem('loc-mode-' + locatorId) (see BlendingSection.tsx /
--   PowerSection.tsx for the equivalent pattern in those two tabs, which are
--   NOT touched by this migration — they write to different tables and are
--   out of scope here). That meant two operators on two different devices
--   could see two different modes for the same locator, with no record of
--   which one is actually correct for that meter.
--
--   This column makes the mode a real, plant-config-owned setting: something
--   a Manager/Admin sets once for the locator (mirroring the existing
--   canEdit = isManager || isAdmin convention in ProductMeters.tsx), which
--   Operations then just reads. No new RLS policy is needed — the existing
--   "locators_write" policy (Admin/Manager + plant access) already covers
--   UPDATEs to this new column since it's just another column on `locators`.
-- =============================================================================

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS default_input_mode TEXT NOT NULL DEFAULT 'raw'
    CHECK (default_input_mode IN ('raw', 'direct'));

COMMENT ON COLUMN public.locators.default_input_mode IS
  'raw = operator enters the cumulative meter reading (delta computed by the '
  'DB). direct = operator enters the day''s volume directly. Set once per '
  'locator by Manager/Admin in Plant config; Operations reads this instead '
  'of a per-device localStorage toggle.';

-- Per this project's own convention (see 20260722_z_pgrst_schema_reload.sql):
-- new columns need this or PostgREST can reject requests referencing them
-- with a misleading error until its next periodic cache reload.
NOTIFY pgrst, 'reload schema';
