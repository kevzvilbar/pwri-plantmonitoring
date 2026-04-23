CREATE TABLE public.downtime_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  cause text NOT NULL,
  duration_hrs numeric NOT NULL DEFAULT 0,
  addressed boolean NOT NULL DEFAULT false,
  resolution text,
  notes text,
  recorded_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_downtime_events_plant_date ON public.downtime_events(plant_id, event_date DESC);

ALTER TABLE public.downtime_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "downtime_events_plant_access"
ON public.downtime_events FOR ALL
TO authenticated
USING (public.user_has_plant_access(plant_id))
WITH CHECK (public.user_has_plant_access(plant_id));

CREATE TRIGGER trg_downtime_events_updated
BEFORE UPDATE ON public.downtime_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();