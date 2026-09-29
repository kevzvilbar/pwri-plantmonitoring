import { supabase } from '@/integrations/supabase/client';
import type { AnomalyTier, AnomalyDirection, RateUnit } from './flowRateGuards';

// ─── Anomaly remarks (reading_anomaly_remarks) ──────────────────────────────
// Best-effort, same convention as logReadingEdit() in pages/ro-trains/helpers.tsx:
// a failed insert here never blocks or rolls back the reading itself, which
// has already saved successfully by the time this is called.

// Every caller previously gated its Save button on `!remark.trim()` — any
// non-empty string, including "0", "-", or a single stray keystroke, counted
// as a complete remark. That let operators clear the "required" warning
// without actually explaining the anomaly. Centralized here (rather than
// re-declared per page) so the bar for "explained" is identical everywhere
// this banner is used, and only needs tuning in one place.
export const MIN_ANOMALY_REMARK_LENGTH = 5;

export type AnomalyReasonCode =
  | 'mechanical_glitch'
  | 'power_transient'
  | 'flushing_blowdown'
  | 'line_leak'
  | 'meter_recalibration'
  | 'meter_replaced'
  | 'operational_adjustment'
  | 'other';

export interface AnomalyReasonOption {
  code: AnomalyReasonCode;
  label: string;
  description: string;
}

export const ANOMALY_REASON_OPTIONS: AnomalyReasonOption[] = [
  { code: 'mechanical_glitch', label: 'Mechanical Glitch', description: 'Sticking impellers, valve rattle, mechanical vibration' },
  { code: 'power_transient', label: 'Power Transient / Surge', description: 'Brownout, generator switchover, voltage dip' },
  { code: 'flushing_blowdown', label: 'Flushing / Line Blowdown', description: 'Scheduled line flush, pre-treatment filter backwash' },
  { code: 'line_leak', label: 'Pipe / Line Leak', description: 'Physical pipe burst, flange seepage, bypass open' },
  { code: 'meter_recalibration', label: 'Meter Recalibration / Zeroing', description: 'Sensor zero calibration or sensor cleaning' },
  { code: 'meter_replaced', label: 'Meter Replaced', description: 'Physical replacement or register swap' },
  { code: 'operational_adjustment', label: 'Operational Throttling', description: 'Intentional rate adjustment, valve throttling' },
  { code: 'other', label: 'Other (Specify in text)', description: 'Custom operational event' },
];

export function isAnomalyRemarkValid(remark: string, reasonCode?: AnomalyReasonCode | null): boolean {
  if (reasonCode && reasonCode !== 'other') return true;
  return (remark ?? '').trim().length >= MIN_ANOMALY_REMARK_LENGTH;
}

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
  reason_code?: AnomalyReasonCode | null;
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
      reason_code:   entry.reason_code ?? null,
      logged_by:     user?.id ?? null,
    }]);
  } catch { /* silently ignore if table missing or column not yet added */ }
}
