/**
 * compliance/types.ts — Shared types, constants, utility functions, and
 * Supabase data-fetching for the Compliance page.
 *
 * ALL items that are imported by external files (Dashboard, ComplianceRadarCard,
 * NRWGaugeCard, TrendChartCanvas, ROTrains/Overview, ROTrains/index,
 * PlantHeroBanner, and Compliance.test.ts) MUST be exported from here AND
 * re-exported from the parent Compliance.tsx so that `@/pages/Compliance`
 * still resolves all public imports without breaking existing callers.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CHEM_DOSING_COLUMN } from '@/lib/chemicals';

// -----------------------------------------------------------------------
// Shared types — exported (imported by tests + dashboard cards)
// -----------------------------------------------------------------------

export type Thresholds = {
  nrw_pct_max: number;
  downtime_hrs_per_day_max: number;
  permeate_tds_max: number;
  permeate_ph_min: number;
  permeate_ph_max: number;
  product_turbidity_max: number;
  raw_turbidity_max?: number;
  dp_psi_max: number;
  recovery_pct_min: number;
  pv_ratio_max: number;
  chem_low_stock_days_min: number;
};

export type Violation = {
  code: string;
  severity: 'low' | 'medium' | 'high' | string;
  metric: string;
  value: number | null;
  threshold: number;
  comparator: string;
  message: string;
};

export type ChemSupply = {
  name: string;
  days: number;
  unit: string | null;
};

// Internal type for daily Supabase row
export type DailyRow = Record<string, any> & { summary_date: string };

// Multi-plant fleet compliance summary
export type PlantComplianceSummary = {
  plantId: string;
  plantName: string;
  score: number;
  violations: Violation[];
  metrics: Record<string, number | undefined>;
  chemSupply: ChemSupply[];
  latestDate: string | null;
  dataDaysStale: number | null;
};

// Eval result from a full compliance evaluation
export type EvalResult = {
  scope: string;
  scope_label?: string;
  evaluated_at: string;
  violations: Violation[];
  thresholds: Thresholds;
};

// -----------------------------------------------------------------------
// Default thresholds
// -----------------------------------------------------------------------

export const DEFAULT_THRESHOLDS: Thresholds = {
  nrw_pct_max:              20,
  downtime_hrs_per_day_max:  2,
  permeate_tds_max:        500,
  permeate_ph_min:         6.5,
  permeate_ph_max:         8.5,
  product_turbidity_max:     5,
  raw_turbidity_max:         5,
  dp_psi_max:               15,
  recovery_pct_min:         70,
  pv_ratio_max:            1.2,
  chem_low_stock_days_min:   7,
};

// -----------------------------------------------------------------------
// localStorage helpers
// -----------------------------------------------------------------------

const LS_KEY = (scope: string) => `compliance_thresholds:${scope}`;

export function lsLoadThresholds(scope: string): Thresholds | null {
  try {
    const raw = localStorage.getItem(LS_KEY(scope));
    return raw ? (JSON.parse(raw) as Thresholds) : null;
  } catch {
    return null;
  }
}

export function lsSaveThresholds(scope: string, t: Thresholds) {
  try {
    localStorage.setItem(LS_KEY(scope), JSON.stringify(t));
  } catch {
    // quota exceeded — silently ignore
  }
}

// -----------------------------------------------------------------------
// Violation copy
// -----------------------------------------------------------------------

export const VIOLATION_COPY: Record<string, string> = {
  NRW_HIGH:       'Non-revenue water is above the acceptable threshold — inspect for leaks or meter inaccuracies.',
  DOWNTIME_HIGH:  'Average daily downtime exceeds the limit — review maintenance schedules and equipment logs.',
  TDS_HIGH:       'Permeate TDS is elevated, which may indicate membrane degradation or bypass.',
  PH_LOW:         'Permeate pH is below the safe minimum — check chemical dosing.',
  PH_HIGH:        'Permeate pH is above the safe maximum — check chemical dosing.',
  TURBIDITY_HIGH: 'Product turbidity exceeds the threshold (≤ 5 NTU) — inspect membrane integrity and filtration stages.',
  DP_HIGH:        'Differential pressure is too high — membranes may require cleaning or replacement.',
  RECOVERY_LOW:   'Recovery rate is below the minimum — review operational settings and feed conditions.',
  PV_RATIO_HIGH:  'Pressure-vessel ratio is outside range — inspect vessel loading balance.',
  CHEM_LOW:       'Chemical stock is projected to run out soon — initiate a procurement order.',
};

// -----------------------------------------------------------------------
// Score helpers
// -----------------------------------------------------------------------

export const SEVERITY_WEIGHTS: Record<string, number> = { high: 30, medium: 15, low: 5 };
const MAX_SCORE_DEDUCTION = 100;

export function computeComplianceScore(violations: Violation[]): number {
  const deduction = violations.reduce(
    (acc, v) => acc + (SEVERITY_WEIGHTS[v.severity] ?? 5), 0
  );
  return Math.max(0, 100 - Math.min(deduction, MAX_SCORE_DEDUCTION));
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'text-accent';
  if (score >= 50) return 'text-warn';
  return 'text-danger';
}

export function scoreBgColor(score: number): string {
  if (score >= 80) return 'bg-accent-soft border-accent';
  if (score >= 50) return 'bg-warn-soft border-warn';
  return 'bg-danger-soft border-danger';
}

export function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 25) return 'Poor';
  return 'Critical';
}

export function labelize(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// -----------------------------------------------------------------------
// Summary builder
// -----------------------------------------------------------------------

export function buildSummary(violations: Violation[]): { headline: string; details: string[] } {
  if (violations.length === 0) {
    return { headline: 'All compliance checks passed for this period.', details: [] };
  }
  const high   = violations.filter((v) => v.severity === 'high');
  const medium = violations.filter((v) => v.severity === 'medium');
  const low    = violations.filter((v) => v.severity === 'low');

  const parts: string[] = [];
  if (high.length)   parts.push(`${high.length} critical`);
  if (medium.length) parts.push(`${medium.length} medium`);
  if (low.length)    parts.push(`${low.length} low`);

  const headline = `${violations.length} violation${violations.length > 1 ? 's' : ''} detected — ${parts.join(', ')}.`;
  const details  = violations.map((v) => VIOLATION_COPY[v.code] ?? v.message);

  return { headline, details };
}

// -----------------------------------------------------------------------
// Violation computation engine — exported (used in tests + dashboard cards)
// -----------------------------------------------------------------------

export function computeViolations(
  metrics: Record<string, number | undefined>,
  t: Thresholds,
  chemSupply: ChemSupply[] = [],
): Violation[] {
  const violations: Violation[] = [];

  const check = (
    code: string,
    metric: string,
    value: number | undefined,
    threshold: number,
    comparator: '>' | '<',
    severity: 'low' | 'medium' | 'high',
  ) => {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    const breached = comparator === '>' ? value > threshold : value < threshold;
    if (!breached) return;
    violations.push({
      code,
      severity,
      metric,
      value: Math.round(value * 1000) / 1000,
      threshold,
      comparator,
      message: VIOLATION_COPY[code] ?? `${metric} is out of range.`,
    });
  };

  check('NRW_HIGH',       'nrw_pct',           metrics.nrw_pct,           t.nrw_pct_max,                                     '>', 'high');
  check('DOWNTIME_HIGH',  'downtime_hrs',      metrics.downtime_hrs,      t.downtime_hrs_per_day_max,                         '>', 'medium');
  check('TDS_HIGH',       'permeate_tds',      metrics.permeate_tds,      t.permeate_tds_max,                                 '>', 'high');
  check('PH_LOW',         'permeate_ph',       metrics.permeate_ph,       t.permeate_ph_min,                                  '<', 'medium');
  check('PH_HIGH',        'permeate_ph',       metrics.permeate_ph,       t.permeate_ph_max,                                  '>', 'medium');
  const turbMax = t.product_turbidity_max ?? t.raw_turbidity_max ?? 5;
  check('TURBIDITY_HIGH', 'product_turbidity', metrics.product_turbidity ?? metrics.raw_turbidity, turbMax,                  '>', 'medium');
  check('DP_HIGH',        'dp_psi',            metrics.dp_psi,            t.dp_psi_max,                                       '>', 'high');
  check('RECOVERY_LOW',   'recovery_pct',      metrics.recovery_pct,      t.recovery_pct_min,                                 '<', 'medium');
  check('PV_RATIO_HIGH',  'pv_ratio',          metrics.pv_ratio,          t.pv_ratio_max,                                     '>', 'low');

  for (const chem of chemSupply) {
    if (chem.days === undefined || chem.days === null || Number.isNaN(chem.days)) continue;
    if (chem.days >= t.chem_low_stock_days_min) continue;
    const severity: 'medium' | 'high' = chem.days >= t.chem_low_stock_days_min / 2 ? 'medium' : 'high';
    violations.push({
      code: 'CHEM_LOW',
      severity,
      metric: chem.name,
      value: Math.round(chem.days * 10) / 10,
      threshold: t.chem_low_stock_days_min,
      comparator: '<',
      message: `${chem.name} has ${chem.days.toFixed(1)} days of supply left (< ${t.chem_low_stock_days_min}d) — initiate a procurement order.`,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  violations.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

  return violations;
}

// -----------------------------------------------------------------------
// Date formatting helper
// -----------------------------------------------------------------------

export function fmtSummaryDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// -----------------------------------------------------------------------
// Supabase data-fetching — exported (used by dashboard cards)
// -----------------------------------------------------------------------

export async function fetchPlantMetrics(
  plantId: string,
  days = 7,
  from?: string,
  to?: string,
): Promise<{ metrics: Record<string, number | undefined>; rows: DailyRow[] }> {
  let sinceIso: string;
  if (from) {
    sinceIso = from;
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    sinceIso = since.toISOString().slice(0, 10);
  }

  let query = supabase
    .from('daily_plant_summary')
    .select('*')
    .eq('plant_id', plantId)
    .gte('summary_date', sinceIso);

  if (to) query = query.lte('summary_date', to);

  const { data } = await query
    .order('summary_date', { ascending: false })
    .limit(Math.min(days, 14));

  const rows = (data ?? []) as DailyRow[];
  const avg  = (k: string) => {
    const vals = rows.map((r) => r?.[k]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };
  const sum  = (k: string) =>
    rows.map((r) => r?.[k] ?? 0).reduce((a, b) => a + Number(b || 0), 0);

  return {
    rows,
    metrics: {
      nrw_pct:           avg('nrw_pct') ?? avg('nrw_percentage'),
      downtime_hrs:      rows.length ? sum('downtime_hrs') / rows.length : undefined,
      permeate_tds:      avg('permeate_tds'),
      permeate_ph:       avg('permeate_ph'),
      product_turbidity: avg('turbidity_ntu') ?? avg('product_turbidity_ntu') ?? avg('raw_turbidity_ntu') ?? avg('raw_turbidity'),
      raw_turbidity:     avg('raw_turbidity_ntu') ?? avg('raw_turbidity') ?? avg('turbidity_ntu'),
      dp_psi:            avg('dp_psi'),
      recovery_pct:      avg('recovery_pct'),
      pv_ratio:          avg('pv_ratio'),
    },
  };
}

export async function fetchChemDaysOfSupply(
  plantId: string,
  lookbackDays = 30,
): Promise<ChemSupply[]> {
  const [{ data: deliveries }, { data: dosing }, { data: inventory }] = await Promise.all([
    supabase.from('chemical_deliveries').select('chemical_name, quantity').eq('plant_id', plantId),
    supabase.from('chemical_dosing_logs')
      .select('chlorine_kg, smbs_kg, anti_scalant_l, soda_ash_kg, log_datetime')
      .eq('plant_id', plantId),
    supabase.from('chemical_inventory').select('chemical_name, unit').eq('plant_id', plantId),
  ]);

  const unitByName = new Map<string, string | null>();
  (inventory ?? []).forEach((r: any) => unitByName.set(r.chemical_name, r.unit ?? null));

  const received = new Map<string, number>();
  (deliveries ?? []).forEach((d: any) => {
    received.set(d.chemical_name, (received.get(d.chemical_name) ?? 0) + (+d.quantity || 0));
  });

  const dosingRows = (dosing ?? []) as Array<Record<string, any>>;
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const recentRows = dosingRows.filter((r) => new Date(r.log_datetime).getTime() >= sinceMs);

  const result: ChemSupply[] = [];
  for (const [name, column] of Object.entries(CHEM_DOSING_COLUMN)) {
    const usedAllTime  = dosingRows.reduce((s, r) => s + (+r[column] || 0), 0);
    const currentStock = (received.get(name) ?? 0) - usedAllTime;

    const recentUsed = recentRows.reduce((s, r) => s + (+r[column] || 0), 0);
    const avgDaily   = recentRows.length ? recentUsed / recentRows.length : 0;
    if (avgDaily <= 0) continue;

    result.push({ name, days: currentStock / avgDaily, unit: unitByName.get(name) ?? null });
  }
  return result;
}

export async function fetchPreviousPeriodMetrics(
  plantId: string,
  days: number,
): Promise<Record<string, number | undefined>> {
  const end = new Date();
  end.setDate(end.getDate() - days);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const { data } = await supabase
    .from('daily_plant_summary')
    .select('*')
    .eq('plant_id', plantId)
    .gte('summary_date', start.toISOString().slice(0, 10))
    .lte('summary_date', end.toISOString().slice(0, 10))
    .order('summary_date', { ascending: false })
    .limit(Math.min(days, 14));

  const rows = (data ?? []) as DailyRow[];
  const avg  = (k: string) => {
    const vals = rows.map((r) => r?.[k]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };
  const sum  = (k: string) =>
    rows.map((r) => r?.[k] ?? 0).reduce((a, b) => a + Number(b || 0), 0);

  return {
    nrw_pct:           avg('nrw_pct') ?? avg('nrw_percentage'),
    downtime_hrs:      rows.length ? sum('downtime_hrs') / rows.length : undefined,
    permeate_tds:      avg('permeate_tds'),
    permeate_ph:       avg('permeate_ph'),
    product_turbidity: avg('turbidity_ntu') ?? avg('product_turbidity_ntu') ?? avg('raw_turbidity_ntu') ?? avg('raw_turbidity'),
    raw_turbidity:     avg('raw_turbidity_ntu') ?? avg('raw_turbidity') ?? avg('turbidity_ntu'),
    dp_psi:            avg('dp_psi'),
    recovery_pct:      avg('recovery_pct'),
    pv_ratio:          avg('pv_ratio'),
  };
}

export async function loadThresholds(scope: string): Promise<Thresholds> {
  try {
    const { data, error } = await supabase
      .from('compliance_thresholds')
      .select('thresholds')
      .eq('scope', scope)
      .maybeSingle();

    if (!error && data?.thresholds) {
      lsSaveThresholds(scope, data.thresholds as Thresholds);
      return data.thresholds as Thresholds;
    }
  } catch {
    // fall through
  }

  const cached = lsLoadThresholds(scope);
  if (cached) return cached;

  if (scope !== 'global') {
    try {
      const { data, error } = await supabase
        .from('compliance_thresholds')
        .select('thresholds')
        .eq('scope', 'global')
        .maybeSingle();

      if (!error && data?.thresholds) {
        lsSaveThresholds('global', data.thresholds as Thresholds);
        return data.thresholds as Thresholds;
      }
    } catch {
      // fall through
    }
    const globalCached = lsLoadThresholds('global');
    if (globalCached) return globalCached;
  }

  return { ...DEFAULT_THRESHOLDS };
}

export async function persistThresholds(scope: string, thresholds: Thresholds): Promise<void> {
  const { error } = await supabase
    .from('compliance_thresholds')
    .upsert({ scope, thresholds, updated_at: new Date().toISOString() }, { onConflict: 'scope' });
  if (error) {
    throw error;
  }
  lsSaveThresholds(scope, thresholds);
}

// -----------------------------------------------------------------------
// Fleet compliance hook
// -----------------------------------------------------------------------

export function useFleetCompliance(plants: Array<{ id: string; name: string }> | undefined, days: number) {
  return useQuery({
    queryKey: ['fleet-compliance-summary', (plants ?? []).map((p) => p.id).join(','), days],
    queryFn: async (): Promise<PlantComplianceSummary[]> => {
      if (!plants || plants.length === 0) return [];
      const summaries = await Promise.all(
        plants.map(async (plant) => {
          try {
            const [{ metrics, rows }, chemSupply, thresholds] = await Promise.all([
              fetchPlantMetrics(plant.id, days),
              fetchChemDaysOfSupply(plant.id),
              loadThresholds(plant.id),
            ]);
            const violations = computeViolations(metrics, thresholds, chemSupply);
            const score = computeComplianceScore(violations);
            const latestDate = rows.length ? rows[0].summary_date : null;
            let dataDaysStale: number | null = null;
            if (latestDate) {
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const [y, m, day] = latestDate.split('-').map(Number);
              dataDaysStale = Math.round((today.getTime() - new Date(y, m - 1, day).getTime()) / 86400000);
            }
            return {
              plantId: plant.id,
              plantName: plant.name,
              score,
              violations,
              metrics,
              chemSupply,
              latestDate,
              dataDaysStale,
            };
          } catch {
            return {
              plantId: plant.id,
              plantName: plant.name,
              score: 100,
              violations: [],
              metrics: {},
              chemSupply: [],
              latestDate: null,
              dataDaysStale: null,
            };
          }
        }),
      );
      return summaries.sort((a, b) => b.score - a.score);
    },
    staleTime: 60_000,
  });
}

// -----------------------------------------------------------------------
// Trend helpers
// -----------------------------------------------------------------------

export type Trend = 'up' | 'down' | 'flat';

export function computeTrend(current: number, previous: number, pctThreshold = 2): Trend {
  if (previous === 0) return 'flat';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < pctThreshold) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

export const METRIC_IMPROVING_DIRECTION: Record<string, boolean> = {
  nrw_pct:           false, // lower is better
  downtime_hrs:      false,
  permeate_tds:      false,
  permeate_ph:       true,  // neutral/mid — show trend
  product_turbidity: false,
  raw_turbidity:     false,
  dp_psi:            false,
  recovery_pct:      true,  // higher is better
  pv_ratio:          false,
};
