-- =============================================================================
-- Migration: 20260730_hamas_phase6_default_input_mode_guard.sql
-- Phase 6 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- BUG:
--   is_derived (20260722_derived_meter_support.sql) and default_input_mode
--   (20260727_hamas_phase1_default_input_mode.sql) are two independent
--   columns on `locators` with no link between them. default_input_mode is
--   NOT NULL DEFAULT 'raw', and nothing ever set it to 'direct' when a
--   locator became derived — not LocatorDialogs.tsx's own is_derived toggle
--   (it just hides the raw/direct <Select> once is_derived is checked, it
--   never touches the value underneath), and not ProductMeters.tsx's
--   locator-assignment save() (Section: assign/update/unassign loops all set
--   is_derived directly without ever including default_input_mode in the
--   update payload).
--
--   Net effect: a locator can be is_derived = true (no physical meter,
--   value computed by fn_sweep_derived_meters as mother meter − siblings)
--   while default_input_mode is still 'raw' — which sends every reader of
--   this locator (ReadingHistoryDialog, EntityHistoryChart) down the
--   cumulative-meter code path: showing a "Reading" column and computing
--   "Production" as a diff between consecutive rows, for a locator that has
--   no odometer to diff in the first place. This is exactly the state
--   Hamas (SRP) was found in.
--
-- FIX:
--   Same pattern as Phase 5's locators_derived_requires_mother_meter check
--   (client-side convenience + DB-level enforcement) — except a plain CHECK
--   can't self-correct an omitted field, it can only reject the whole write.
--   Since every existing caller already always includes is_derived in its
--   payload but not always default_input_mode, a CHECK constraint would
--   just start throwing on saves that used to succeed. A BEFORE trigger
--   instead auto-corrects default_input_mode to 'direct' whenever
--   is_derived is true, on both INSERT and UPDATE, regardless of which
--   screen (or future screen) is doing the writing.
--
--   The reverse direction (is_derived flips back to false) is intentionally
--   NOT handled by this trigger — a locator coming off derived status needs
--   an admin to actively choose raw vs. direct again (the <Select> reappears
--   in LocatorDialogs.tsx once !is_derived), so the app-code changes
--   accompanying this migration set default_input_mode back to 'raw'
--   explicitly on that transition instead of silently guessing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_force_direct_mode_when_derived()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_derived THEN
    NEW.default_input_mode := 'direct';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_force_direct_mode_when_derived() IS
  'BEFORE INSERT/UPDATE guard on locators: a derived (no-physical-meter) row '
  'can never be saved with default_input_mode = ''raw''. See Phase 6 header '
  'comment (20260730_hamas_phase6_default_input_mode_guard.sql) for the bug '
  'this closes. Deliberately one-directional — does not reset the mode back '
  'to ''raw'' when is_derived is turned off; the app layer handles that.';

DROP TRIGGER IF EXISTS trg_force_direct_mode ON public.locators;

CREATE TRIGGER trg_force_direct_mode
  BEFORE INSERT OR UPDATE ON public.locators
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_force_direct_mode_when_derived();

-- ── One-time backfill ────────────────────────────────────────────────────────
-- Fixes every already-derived locator caught by this bug today, Hamas (SRP)
-- included, without waiting for someone to re-open and re-save its config.
UPDATE public.locators
   SET default_input_mode = 'direct'
 WHERE is_derived = TRUE
   AND default_input_mode IS DISTINCT FROM 'direct';

NOTIFY pgrst, 'reload schema';
