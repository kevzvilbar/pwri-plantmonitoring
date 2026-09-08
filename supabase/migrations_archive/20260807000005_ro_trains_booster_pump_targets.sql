-- Booster pump targets have the same "retyped every reading" problem
-- hpp_target_pressure_psi had (20260807_ro_trains_hpp_target_pressure_
-- setpoint.sql) -- confirmed while building that fix and flagged as a
-- separate follow-up rather than folded in, since a train can have multiple
-- booster pumps and each pump's target is entered in one of two mutually
-- exclusive modes (psi or Hz, toggled per train, not per pump -- the reading
-- form's "Target psi/Hz" toggle already applies to every pump on the train
-- at once via setGlobalMode, so the config shape below matches that: one
-- mode for the whole train, one target value per pump).
--
-- Amperage is NOT part of this -- that's a genuine per-reading measurement
-- (the pump's actual current draw, which varies with load/wear), not a
-- setpoint. Only target/Hz move to config; amp stays exactly as it was,
-- entered fresh on every reading.
--
-- JSONB rather than fixed columns because num_booster_pumps varies per
-- train (0 to N) -- a fixed set of booster_pump_1_target/2_target/... columns
-- would need a schema change every time a train configuration needs more
-- pumps than any train has needed so far. Shape:
--   { "psi_mode": true, "targets": { "1": 45, "2": 50 } }
-- targets is keyed by pump unit number as a string (JSONB object keys are
-- always strings); a unit with no entry (or the whole column null) falls
-- back to the reading form's current fully-editable behavior for that pump,
-- same graceful-degradation approach as the HPP fix -- no train breaks for
-- not having this configured.

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS booster_pump_targets JSONB;

COMMENT ON COLUMN public.ro_trains.booster_pump_targets IS
  'Per-pump target setpoints for this train''s booster pumps, configured once in Train Settings. Shape: {"psi_mode": bool, "targets": {"<unit>": number}}. Auto-fills and locks the corresponding psi/Hz field on every pre-treatment/RO reading; amperage stays per-reading (a real measurement, not a setpoint). A unit missing from targets, or a null column, falls back to the fully-editable per-reading input.';

NOTIFY pgrst, 'reload schema';
