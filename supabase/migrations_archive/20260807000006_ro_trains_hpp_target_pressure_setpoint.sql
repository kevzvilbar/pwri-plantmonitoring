-- Roadmap §5: HPP target pressure was only ever a per-reading field
-- (ro_pretreatment_readings.hpp_target_pressure_psi), meaning an operator
-- retyped the exact same number on every single log entry -- the target
-- pressure a High-Pressure Pump is set to is a slow-changing equipment
-- setpoint, not something that varies reading to reading. A typo on any one
-- entry looked like a real target change in historical data when it was
-- just repeated manual entry.
--
-- Adds it to ro_trains as a per-train config value, configured once in
-- Train Settings (EditTrainDialog in TrainDetail.tsx) alongside num_hp_pumps
-- and the other train-level fields already there. Nullable, no default --
-- existing trains simply have it unset until a Manager/Admin fills it in;
-- the reading-entry form (PretreatmentAndROLog.tsx) falls back to its old
-- fully-editable-input behavior for any train where this is still null, so
-- nothing breaks for trains that haven't been configured yet.
--
-- ro_pretreatment_readings.hpp_target_pressure_psi is kept as-is, not
-- dropped -- once a train has this configured, the reading form auto-fills
-- and submits the train's value on every reading, so the readings table
-- still carries a per-reading historical record of what the target was at
-- that time (useful if the target itself is later changed), it's just no
-- longer manually retyped.

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS hpp_target_pressure_psi NUMERIC;

COMMENT ON COLUMN public.ro_trains.hpp_target_pressure_psi IS
  'High-Pressure Pump target operating pressure (psi), configured once per train in Train Settings. Auto-fills the HPP Target Pressure field on every pre-treatment/RO reading for this train until changed here.';

NOTIFY pgrst, 'reload schema';
