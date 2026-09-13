-- Power gap reasons must be logged per physical meter (solar-0, grid-0,
-- grid-1, ...) instead of once per plant. Power "meters" are virtual —
-- plain indices into plant_power_config, not rows in a meters table — so
-- the old (entity_type, entity_id, gap_date) unique key could only hold one
-- power gap per plant per day.
--
-- This adds a meter_key column (default '' so every other entity type keeps
-- its existing one-row-per-entity-per-date semantics) and widens the unique
-- constraint to include it. Power inserts use meter_key = 'grid-N' / 'solar-N'.

ALTER TABLE public.reading_gap_reasons
  ADD COLUMN IF NOT EXISTS meter_key text NOT NULL DEFAULT '';

ALTER TABLE public.reading_gap_reasons
  DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_entity_id_gap_date_key;

ALTER TABLE public.reading_gap_reasons
  ADD CONSTRAINT reading_gap_reasons_entity_type_entity_id_gap_date_meter_key_key
  UNIQUE (entity_type, entity_id, gap_date, meter_key);
