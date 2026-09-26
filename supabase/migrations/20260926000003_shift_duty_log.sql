-- ============================================================================
-- Migration: 20260926000003_shift_duty_log.sql
-- Description: Create shift_duty_log table for pair-duty attribution and shift tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shift_duty_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_operator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_dual_duty BOOLEAN NOT NULL DEFAULT false,
  cycle_key TEXT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shift_duty_log_plant_date ON public.shift_duty_log (plant_id, declared_at);
CREATE INDEX IF NOT EXISTS idx_shift_duty_log_operator ON public.shift_duty_log (operator_id);
CREATE INDEX IF NOT EXISTS idx_shift_duty_log_partner ON public.shift_duty_log (partner_operator_id);
CREATE INDEX IF NOT EXISTS idx_shift_duty_log_cycle ON public.shift_duty_log (cycle_key);

ALTER TABLE public.shift_duty_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_duty_log_select_authenticated"
  ON public.shift_duty_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "shift_duty_log_insert_authenticated"
  ON public.shift_duty_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = operator_id OR auth.uid() = partner_operator_id OR auth.uid() = confirmed_by);

CREATE POLICY "shift_duty_log_update_authenticated"
  ON public.shift_duty_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = operator_id OR auth.uid() = partner_operator_id OR auth.uid() = ended_by);

COMMENT ON TABLE public.shift_duty_log IS 'Shift duty records and partner pairings for pair-duty KPI attribution and auditability.';
