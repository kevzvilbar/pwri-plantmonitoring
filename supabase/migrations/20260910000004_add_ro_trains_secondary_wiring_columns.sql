-- Migration: 20260910000004_add_ro_trains_secondary_wiring_columns.sql
-- Ensure secondary RO train wiring columns exist on ro_trains if not already present

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS unit_type text,
  ADD COLUMN IF NOT EXISTS feed_source_train_id uuid REFERENCES public.ro_trains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reject_routing text;

COMMENT ON COLUMN public.ro_trains.unit_type IS 'Unit type: primary or secondary (2nd pass / potable / refilling)';
COMMENT ON COLUMN public.ro_trains.feed_source_train_id IS 'Upstream primary train ID if this train is a secondary RO unit';
COMMENT ON COLUMN public.ro_trains.reject_routing IS 'Where reject is routed (e.g., recirculate to primary permeate)';

NOTIFY pgrst, 'reload schema';
