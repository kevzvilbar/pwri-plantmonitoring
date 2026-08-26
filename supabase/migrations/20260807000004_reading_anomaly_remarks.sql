-- =============================================================================
-- Migration: 20260807_reading_anomaly_remarks.sql
-- Run this in: Supabase Dashboard -> SQL Editor
--
-- Part of the flow-rate-based anomaly detection unification (see
-- frontend/src/lib/flowRateGuards.ts for the shared classification logic
-- this table supports).
--
-- Every odometer input (locator/well/product/blending, power, RO train
-- feed/permeate/reject) is now classified against its own rolling-average
-- FLOW RATE (volume or kWh per hour/day), not the raw delta -- a raw delta
-- has a direct relationship with the elapsed time between readings, so it
-- was never a fair "is this normal" comparison whenever a date had no
-- reading. See roReadingGuards.ts / readingGuards.ts for the classification
-- callers.
--
-- Two tiers, both computed from the same rolling average:
--   - "needs_remark": outside the +-50% band around the average rate.
--     Save is blocked client-side until the operator types a remark
--     explaining the reading (own field knowledge -- pump down, meter
--     replaced, unusually high demand, etc.). This is new; nothing in the
--     app previously required an explanation for an out-of-band reading.
--   - "critical": beyond the stricter per-meter-type spike multiplier that
--     already existed (ALERTS.avg_multiplier_warn / power_spike_multiplier /
--     ro_meter_spike_multiplier -- deliberately NOT unified to one number,
--     since different meter types have different natural variance; only the
--     methodology, message format, and remark requirement are unified).
--     Same remark requirement, PLUS the existing pending_review /
--     supervisor-alert behaviour still fires exactly as before.
--
-- This table captures the "needs_remark" / "critical" remark itself, mirroring
-- the table_name + record_id pattern already used by reading_edit_audit_log
-- (NOT the entity_type + entity_id + gap_date pattern used by
-- reading_gap_reasons, which is about missing readings, not the anomaly on a
-- reading that *was* taken).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reading_anomaly_remarks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which saved reading this remark explains. table_name mirrors the
  -- constraint list already used by reading_edit_audit_log, extended with
  -- product_meter_readings (the one reading table that audit log doesn't
  -- cover yet).
  table_name      TEXT        NOT NULL CHECK (table_name IN (
                                'locator_readings',
                                'well_readings',
                                'product_meter_readings',
                                'blending_events',
                                'power_readings',
                                'ro_train_readings'
                              )),
  record_id       UUID        NOT NULL,

  -- ro_train_readings carries three independent meters (feed/permeate/
  -- reject) per row, any subset of which can individually be out-of-band --
  -- NULL for every other table_name, where one row = one meter.
  meter_kind      TEXT        CHECK (meter_kind IN ('feed', 'permeate', 'reject')),

  plant_id        UUID        NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,

  tier            TEXT        NOT NULL CHECK (tier IN ('needs_remark', 'critical')),
  direction       TEXT        NOT NULL CHECK (direction IN ('high', 'low')),
  deviation_pct   NUMERIC     NOT NULL,

  -- Snapshot of the numbers the operator actually saw, so a later audit
  -- doesn't have to reconstruct "what was the average at the time" from a
  -- rolling window that has since moved on.
  flow_rate       NUMERIC,
  avg_flow_rate   NUMERIC,
  rate_unit       TEXT        NOT NULL DEFAULT 'm3/hr' CHECK (rate_unit IN ('m3/hr', 'm3/day', 'kwh/hr')),

  remark_text     TEXT        NOT NULL CHECK (char_length(btrim(remark_text)) > 0),

  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reading_anomaly_remarks_record
  ON public.reading_anomaly_remarks (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_reading_anomaly_remarks_plant
  ON public.reading_anomaly_remarks (plant_id, logged_at DESC);

ALTER TABLE public.reading_anomaly_remarks ENABLE ROW LEVEL SECURITY;

-- Any authenticated user with access to the plant may read -- these are
-- meant to surface on the Dashboard / reading history alongside the reading
-- itself, not just to managers.
DROP POLICY IF EXISTS "reading_anomaly_remarks_read" ON public.reading_anomaly_remarks;
CREATE POLICY "reading_anomaly_remarks_read" ON public.reading_anomaly_remarks
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

-- Operators write their own remarks at save time -- not manager-gated,
-- since it's the field operator who has the explanation, exactly like
-- reading_gap_reasons.
DROP POLICY IF EXISTS "reading_anomaly_remarks_insert" ON public.reading_anomaly_remarks;
CREATE POLICY "reading_anomaly_remarks_insert" ON public.reading_anomaly_remarks
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- Immutable audit-style record: no UPDATE/DELETE policy -> denied by default.

NOTIFY pgrst, 'reload schema';
