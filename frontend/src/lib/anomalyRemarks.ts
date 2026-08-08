import { supabase } from '@/integrations/supabase/client';
import type { AnomalyTier, AnomalyDirection, RateUnit } from './flowRateGuards';

// ─── Anomaly remarks (reading_anomaly_remarks) ──────────────────────────────
// Best-effort, same convention as logReadingEdit() in pages/ro-trains/helpers.tsx:
// a failed insert here never blocks or rolls back the reading itself, which
// has already saved successfully by the time this is called.

export type AnomalyRemarkTable =
  | 'locator_readings'
  | 'well_readings'
  | 'product_meter_readings'
  | 'blending_events'
  | 'power_readings'
  | 'ro_train_readings';

export async function submitAnomalyRemark(entry: {
  table_name: AnomalyRemarkTable;
  record_id: string;
  /** Only meaningful for ro_train_readings, which carries three meters per row. */
  meter_kind?: 'feed' | 'permeate' | 'reject' | null;
  plant_id: string;
  tier: Exclude<AnomalyTier, 'ok'>;
  direction: NonNullable<AnomalyDirection>;
  deviation_pct: number;
  flow_rate: number | null;
  avg_flow_rate: number | null;
  rate_unit: RateUnit;
  remark_text: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase.from('reading_anomaly_remarks' as any) as any).insert([{
      table_name:    entry.table_name,
      record_id:     entry.record_id,
      meter_kind:    entry.meter_kind ?? null,
      plant_id:      entry.plant_id,
      tier:          entry.tier,
      direction:     entry.direction,
      deviation_pct: entry.deviation_pct,
      flow_rate:     entry.flow_rate,
      avg_flow_rate: entry.avg_flow_rate,
      rate_unit:     entry.rate_unit,
      remark_text:   entry.remark_text.trim(),
      logged_by:     user?.id ?? null,
    }]);
  } catch { /* silently ignore if table missing — migration not yet run */ }
}
