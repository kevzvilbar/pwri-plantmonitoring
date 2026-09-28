-- 20260928000005_reagent_pack_events.sql
-- Reagent pack / bottle finished events and yield tracking

CREATE TABLE IF NOT EXISTS public.reagent_pack_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  catalog_id uuid NOT NULL REFERENCES public.chemical_catalog(id),
  event_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.user_profiles(id),
  tests_since_prev int,
  rated_tests int,
  yield_pct numeric
);

ALTER TABLE public.reagent_pack_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reagent_pack_events_read_plant_access" ON public.reagent_pack_events;
DROP POLICY IF EXISTS "reagent_pack_events_write_plant_access" ON public.reagent_pack_events;
DROP POLICY IF EXISTS "reagent_pack_events_plant_access" ON public.reagent_pack_events;
CREATE POLICY "reagent_pack_events_plant_access" ON public.reagent_pack_events
  FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));
