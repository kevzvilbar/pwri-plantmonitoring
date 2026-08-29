import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery } from '@tanstack/react-query';
import { DataState } from '@/components/DataState';
import { PageHeader } from '@/components/PageHeader';
import {
  ShieldCheck, ShieldAlert, AlertCircle, AlertTriangle, Loader2, RefreshCw,
  Save, Settings2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight,
  Eye, Zap, FileDown, Building2, Droplets, Gauge, Beaker, CheckCircle2, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { usePermission } from '@/hooks/usePermission';
import { CHEM_DOSING_COLUMN } from '@/lib/chemicals';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/dashboard/StatCard';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// Shared types
// -----------------------------------------------------------------------

export type Thresholds = {
  nrw_pct_max: number;
  downtime_hrs_per_day_max: number;
  permeate_tds_max: number;
  permeate_ph_min: number;
  permeate_ph_max: number;
  raw_turbidity_max: number;
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

type EvalResult = {
  scope: string;
  scope_label?: string;
  evaluated_at: string;
  violations: Violation[];
  thresholds: Thresholds;
};

// Projected days-of-supply remaining for a single tracked chemical
// (current_stock ÷ recent average daily consumption). See fetchChemDaysOfSupply.
export type ChemSupply = {
  name: string;
  days: number;
  unit: string | null;
};

// NEW: daily row returned from Supabase for sparkline / trend data
type DailyRow = Record<string, any> & { summary_date: string };

// -----------------------------------------------------------------------
// Default thresholds — used when no saved value exists
// -----------------------------------------------------------------------

export const DEFAULT_THRESHOLDS: Thresholds = {
  nrw_pct_max:              20,
  downtime_hrs_per_day_max:  2,
  permeate_tds_max:        500,
  permeate_ph_min:         6.5,
  permeate_ph_max:         8.5,
  raw_turbidity_max:         5,
  dp_psi_max:               15,
  recovery_pct_min:         70,
  pv_ratio_max:            1.2,
  chem_low_stock_days_min:   7,
};

// -----------------------------------------------------------------------
// localStorage helpers for threshold persistence
// -----------------------------------------------------------------------

const LS_KEY = (scope: string) => `compliance_thresholds:${scope}`;

function lsLoadThresholds(scope: string): Thresholds | null {
  try {
    const raw = localStorage.getItem(LS_KEY(scope));
    return raw ? (JSON.parse(raw) as Thresholds) : null;
  } catch {
    return null;
  }
}

function lsSaveThresholds(scope: string, t: Thresholds) {
  try {
    localStorage.setItem(LS_KEY(scope), JSON.stringify(t));
  } catch {
    // quota exceeded — silently ignore
  }
}

// -----------------------------------------------------------------------
// Violation copy
// -----------------------------------------------------------------------

const VIOLATION_COPY: Record<string, string> = {
  NRW_HIGH:       'Non-revenue water is above the acceptable threshold — inspect for leaks or meter inaccuracies.',
  DOWNTIME_HIGH:  'Average daily downtime exceeds the limit — review maintenance schedules and equipment logs.',
  TDS_HIGH:       'Permeate TDS is elevated, which may indicate membrane degradation or bypass.',
  PH_LOW:         'Permeate pH is below the safe minimum — check chemical dosing.',
  PH_HIGH:        'Permeate pH is above the safe maximum — check chemical dosing.',
  TURBIDITY_HIGH: 'Raw turbidity exceeds the threshold — inspect pre-treatment and coagulation stages.',
  DP_HIGH:        'Differential pressure is too high — membranes may require cleaning or replacement.',
  RECOVERY_LOW:   'Recovery rate is below the minimum — review operational settings and feed conditions.',
  PV_RATIO_HIGH:  'Pressure-vessel ratio is outside range — inspect vessel loading balance.',
  CHEM_LOW:       'Chemical stock is projected to run out soon — initiate a procurement order.',
};

// -----------------------------------------------------------------------
// NEW: Compliance score — 0–100 based on weighted violations
// -----------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<string, number> = { high: 30, medium: 15, low: 5 };
const MAX_SCORE_DEDUCTION = 100;

function computeComplianceScore(violations: Violation[]): number {
  const deduction = violations.reduce(
    (acc, v) => acc + (SEVERITY_WEIGHTS[v.severity] ?? 5), 0
  );
  return Math.max(0, 100 - Math.min(deduction, MAX_SCORE_DEDUCTION));
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-accent';
  if (score >= 50) return 'text-warn';
  return 'text-danger';
}

function scoreBgColor(score: number): string {
  if (score >= 80) return 'bg-accent-soft border-accent';
  if (score >= 50) return 'bg-warn-soft border-warn';
  return 'bg-danger-soft border-danger';
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 25) return 'Poor';
  return 'Critical';
}

// -----------------------------------------------------------------------
// NEW: ScoreGauge component
// -----------------------------------------------------------------------

function ScoreGauge({ score }: { score: number }) {
  const radius = 28;
  const circumference = Math.PI * radius; // half-circle
  const offset = circumference - (score / 100) * circumference;

  const strokeColor =
    score >= 80 ? 'hsl(var(--accent))' : score >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="76" height="44" viewBox="0 0 76 44">
        {/* Background arc */}
        <path
          d="M 6 42 A 32 32 0 0 1 70 42"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Score arc */}
        <path
          d="M 6 42 A 32 32 0 0 1 70 42"
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${offset}`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="38" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill={strokeColor}>
          {score}
        </text>
      </svg>
      <span className={cn('text-2xs font-semibold uppercase tracking-wide', scoreColor(score))}>
        {scoreLabel(score)}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------
// NEW: Sparkline chart for violation drill-down
// -----------------------------------------------------------------------

function Sparkline({
  data,
  metricKey,
  threshold,
  comparator,
}: {
  data: DailyRow[];
  metricKey: string;
  threshold: number;
  comparator: string;
}) {
  const values = data
    .slice()
    .reverse()
    .map((r) => ({ date: r.summary_date, val: r[metricKey] ?? null }));

  const nums = values.map((v) => v.val).filter((v) => v !== null) as number[];
  if (nums.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No daily data available.</p>;
  }

  const W = 280;
  const H = 60;
  const PAD = 8;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const minVal = Math.min(...nums, comparator === '<' ? threshold : threshold * 0.8);
  const maxVal = Math.max(...nums, comparator === '>' ? threshold : threshold * 1.2);
  const range = maxVal - minVal || 1;

  const toX = (i: number) => PAD + (i / Math.max(values.length - 1, 1)) * innerW;
  const toY = (v: number) => PAD + innerH - ((v - minVal) / range) * innerH;
  const thY = toY(threshold);

  const pts = values
    .map((v, i) => (v.val !== null ? `${toX(i)},${toY(v.val)}` : null))
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mt-2">
      <svg width={W} height={H} className="overflow-visible">
        {/* Threshold line */}
        <line
          x1={PAD} y1={thY} x2={W - PAD} y2={thY}
          stroke="hsl(var(--danger))" strokeWidth="1" strokeDasharray="4 2" opacity="0.7"
        />
        {/* Sparkline */}
        <polyline
          points={pts}
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dots — red if breaching */}
        {values.map((v, i) => {
          if (v.val === null) return null;
          const breached = comparator === '>' ? v.val > threshold : v.val < threshold;
          return (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(v.val)}
              r="2.5"
              fill={breached ? 'hsl(var(--danger))' : 'hsl(var(--muted-foreground))'}
            />
          );
        })}
        {/* Threshold label */}
        <text x={W - PAD + 2} y={thY + 3} fontSize="8" fill="hsl(var(--danger))">
          {threshold}
        </text>
      </svg>
      <div className="flex justify-between text-2xs text-muted-foreground mt-0.5 px-[8px]">
        <span>{values[0]?.date?.slice(5)}</span>
        <span>{values[values.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// NEW: Trend indicator
// -----------------------------------------------------------------------

type Trend = 'up' | 'down' | 'flat';

function TrendIndicator({ trend, improving }: { trend: Trend; improving: boolean }) {
  if (trend === 'flat') return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;

  // "improving" depends on the metric: lower NRW is good, higher recovery is good, etc.
  const isGood = (trend === 'up') === improving;

  if (trend === 'up') {
    return <TrendingUp className={cn('h-3.5 w-3.5', isGood ? 'text-accent' : 'text-danger')} />;
  }
  return <TrendingDown className={cn('h-3.5 w-3.5', isGood ? 'text-accent' : 'text-danger')} />;
}

/** Which direction is "improving" for each metric */
const METRIC_IMPROVING_DIRECTION: Record<string, boolean> = {
  nrw_pct:       false, // lower is better
  downtime_hrs:  false,
  permeate_tds:  false,
  permeate_ph:   true,  // neutral/mid — we just show trend
  raw_turbidity: false,
  dp_psi:        false,
  recovery_pct:  true,  // higher is better
  pv_ratio:      false,
};

function computeTrend(current: number, previous: number, pctThreshold = 2): Trend {
  if (previous === 0) return 'flat';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < pctThreshold) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

// -----------------------------------------------------------------------
// NEW: Inline metric preview component
// -----------------------------------------------------------------------

function MetricPreview({
  metrics,
  loading,
}: {
  metrics: Record<string, number | undefined> | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Fetching metric preview…
        </div>
      </Card>
    );
  }
  if (!metrics) return null;

  const entries = Object.entries(metrics);
  const hasGaps = entries.some(([, v]) => v === undefined || v === null || Number.isNaN(v));

  return (
    <Card className="p-3 border-info bg-info-soft/40">
      <div className="flex items-center gap-1.5 mb-2">
        <Eye className="h-3.5 w-3.5 text-info" />
        <span className="text-xs font-medium text-info">Metric Preview</span>
        {hasGaps && (
          <Badge variant="outline" className="text-2xs border-warn text-warn bg-warn-soft ml-auto">
            Data gaps detected
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className={cn(
            'rounded px-2 py-1.5',
            v === undefined || v === null || Number.isNaN(v as any)
              ? 'bg-warn-soft/60'
              : 'bg-white/80',
          )}>
            <div className="text-2xs text-muted-foreground truncate">{labelize(k)}</div>
            <div className={cn(
              'text-sm font-mono font-medium',
              v === undefined || v === null || Number.isNaN(v as any) ? 'text-warn' : '',
            )}>
              {v !== undefined && v !== null && !Number.isNaN(v as any)
                ? (Math.round((v as number) * 100) / 100)
                : '—'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Deterministic violation-check engine
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

  check('NRW_HIGH',       'nrw_pct',       metrics.nrw_pct,       t.nrw_pct_max,              '>', 'high');
  check('DOWNTIME_HIGH',  'downtime_hrs',  metrics.downtime_hrs,  t.downtime_hrs_per_day_max,  '>', 'medium');
  check('TDS_HIGH',       'permeate_tds',  metrics.permeate_tds,  t.permeate_tds_max,          '>', 'high');
  check('PH_LOW',         'permeate_ph',   metrics.permeate_ph,   t.permeate_ph_min,           '<', 'medium');
  check('PH_HIGH',        'permeate_ph',   metrics.permeate_ph,   t.permeate_ph_max,           '>', 'medium');
  check('TURBIDITY_HIGH', 'raw_turbidity', metrics.raw_turbidity, t.raw_turbidity_max,         '>', 'medium');
  check('DP_HIGH',        'dp_psi',        metrics.dp_psi,        t.dp_psi_max,                '>', 'high');
  check('RECOVERY_LOW',   'recovery_pct',  metrics.recovery_pct,  t.recovery_pct_min,          '<', 'medium');
  check('PV_RATIO_HIGH',  'pv_ratio',      metrics.pv_ratio,      t.pv_ratio_max,              '>', 'low');

  // Chemical low-stock check — one violation per chemical projected to run
  // out inside the configured window. `days` is current_stock ÷ recent avg
  // daily consumption (see fetchChemDaysOfSupply); chemicals with no usable
  // consumption estimate are simply omitted from `chemSupply`, not flagged.
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

// Formats a plain `date` column value (e.g. "2026-08-03") using its
// calendar components directly, rather than `new Date(str)` (which parses
// as UTC midnight and can display as the previous day in timezones behind
// UTC).
function fmtSummaryDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// -----------------------------------------------------------------------
// Deterministic summary
// -----------------------------------------------------------------------

function buildSummary(violations: Violation[]): { headline: string; details: string[] } {
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
// Metric aggregation from Supabase
// -----------------------------------------------------------------------

export async function fetchPlantMetrics(
  plantId: string,
  days = 7,
  from?: string, // yyyy-MM-dd — explicit range start; overrides `days` when given
  to?: string,   // yyyy-MM-dd — explicit range end; bounds the query when given
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

  // There was previously no upper bound at all — fine as long as the window
  // is always "N days back from today", since ordering desc + limit lands on
  // the most recent rows regardless. A real historical `to` needs an actual
  // upper bound, or it'll pull rows up through *today* instead of stopping
  // at `to` — same class of bug as the Cost Composition donut.
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
      nrw_pct:       avg('nrw_pct') ?? avg('nrw_percentage'),
      downtime_hrs:  rows.length ? sum('downtime_hrs') / rows.length : undefined,
      permeate_tds:  avg('permeate_tds'),
      permeate_ph:   avg('permeate_ph'),
      raw_turbidity: avg('raw_turbidity'),
      dp_psi:        avg('dp_psi'),
      recovery_pct:  avg('recovery_pct'),
      pv_ratio:      avg('pv_ratio'),
    },
  };
}

// CHEM_DOSING_COLUMN (name -> chemical_dosing_logs column) is imported from
// @/lib/chemicals — the same canonical mapping ChemInventory.tsx uses.

/**
 * Projects days-of-supply remaining for each tracked chemical.
 *
 * IMPORTANT: `chemical_inventory.current_stock` is set once at creation
 * (AddStockDialog) and never updated again — it is not a reliable current
 * value. The rest of the app (ChemInventory.tsx) already treats
 * "current stock" as deliveries-to-date minus dosing usage-to-date; this
 * follows the same convention so the compliance check agrees with what's
 * shown on the Chem Inventory page.
 *
 * The depletion rate is the average daily usage over `lookbackDays`. A
 * chemical with no recorded usage in that window is omitted rather than
 * flagged — there's no basis to project a run-out date.
 */
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

/** Fetch metrics for the PREVIOUS period for trend comparison */
async function fetchPreviousPeriodMetrics(
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
    nrw_pct:       avg('nrw_pct') ?? avg('nrw_percentage'),
    downtime_hrs:  rows.length ? sum('downtime_hrs') / rows.length : undefined,
    permeate_tds:  avg('permeate_tds'),
    permeate_ph:   avg('permeate_ph'),
    raw_turbidity: avg('raw_turbidity'),
    dp_psi:        avg('dp_psi'),
    recovery_pct:  avg('recovery_pct'),
    pv_ratio:      avg('pv_ratio'),
  };
}

// -----------------------------------------------------------------------
// Threshold persistence via Supabase (with localStorage fallback)
// -----------------------------------------------------------------------

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
  return { ...DEFAULT_THRESHOLDS };
}

async function persistThresholds(scope: string, thresholds: Thresholds): Promise<void> {
  const { error } = await supabase
    .from('compliance_thresholds')
    .upsert({ scope, thresholds, updated_at: new Date().toISOString() }, { onConflict: 'scope' });
  if (error) {
    // Was previously swallowed here (just a console.warn) — the caller's
    // try/catch never saw it, so saveThresholds() always showed
    // "Thresholds saved" even when RLS denied the write (Manager/Technician
    // per compliance_thresholds' admin_write_thresholds policy). Rethrow so
    // the actual failure reaches the user instead of only the local cache.
    throw error;
  }
  // Only cache locally once the write actually succeeds — previously this
  // ran unconditionally before the upsert, so a denied write still left the
  // browser showing the unsaved value until the next successful reload.
  lsSaveThresholds(scope, thresholds);
}

// -----------------------------------------------------------------------
// Multi-Plant Fleet Compliance Hook
// -----------------------------------------------------------------------

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

function useFleetCompliance(plants: Array<{ id: string; name: string }> | undefined, days: number) {
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
// Page
// -----------------------------------------------------------------------

export default function Compliance() {
  const { data: plants }    = usePlants();
  const { selectedPlantId, setSelectedPlantId } = useAppStore();
  const [plantId, setPlantId]   = useState<string>(selectedPlantId ?? (plants?.[0]?.id ?? 'global'));
  const [days, setDays]         = useState<number>(7);
  const [scope, setScope]       = useState<'global' | 'plant'>(selectedPlantId ? 'plant' : 'plant');
  const [editing, setEditing]   = useState(false);
  const canEditThresholds = usePermission('compliance', 'edit');
  const [local, setLocal]       = useState<Thresholds | null>(null);
  const [saving, setSaving]     = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult]     = useState<EvalResult | null>(null);
  const [overrideMetrics, setOverrideMetrics] = useState<Record<string, string>>({});
  const [complianceTab, setComplianceTab] = useTabPersist<'status' | 'fleet' | 'thresholds' | 'whatif'>(
    'tab:compliance', 'status',
  );

  // Daily rows & previous metrics state
  const [dailyRows, setDailyRows]           = useState<DailyRow[]>([]);
  const [prevMetrics, setPrevMetrics]       = useState<Record<string, number | undefined>>({});
  const [expandedViolation, setExpandedViolation] = useState<string | null>(null);
  const [previewMetrics, setPreviewMetrics] = useState<Record<string, number | undefined> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [whatIfViolations, setWhatIfViolations] = useState<Violation[] | null>(null);
  const [chemSupply, setChemSupply]         = useState<ChemSupply[]>([]);

  // Fleet wide queries
  const { data: fleetSummaries = [], isLoading: fleetLoading, refetch: refetchFleet } = useFleetCompliance(plants, days);

  useEffect(() => {
    if (selectedPlantId) {
      setPlantId(selectedPlantId);
      setScope('plant');
    } else if (plants && plants.length > 0 && (!plantId || plantId === 'global')) {
      setPlantId(plants[0].id);
      setScope('plant');
    }
  }, [selectedPlantId, plants]);

  const thresholdScope = scope === 'plant' ? plantId : 'global';

  const { data: thData, refetch: refetchThresholds } = useQuery({
    queryKey: ['thresholds', thresholdScope],
    queryFn:  async () => {
      const thresholds = await loadThresholds(thresholdScope);
      return { scope: thresholdScope, thresholds };
    },
    retry: false,
  });

  useEffect(() => {
    if (thData?.thresholds && !editing) setLocal(thData.thresholds);
  }, [thData, editing]);

  // Auto-preview metrics
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (scope !== 'plant' || !plantId || plantId === 'global') {
      setPreviewMetrics(null);
      setChemSupply([]);
      return;
    }
    const controller = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = controller;

    setPreviewLoading(true);
    Promise.all([
      fetchPlantMetrics(plantId, days),
      fetchChemDaysOfSupply(plantId),
    ])
      .then(([{ metrics }, chem]) => {
        if (!controller.signal.aborted) {
          setPreviewMetrics(metrics);
          setChemSupply(chem);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });

    return () => controller.abort();
  }, [scope, plantId, days]);

  // Real-time what-if simulations
  useEffect(() => {
    if (!local) return;
    const hasAnyOverride = Object.values(overrideMetrics).some((v) => v !== '');
    if (!hasAnyOverride) { setWhatIfViolations(null); return; }

    const merged: Record<string, number | undefined> = { ...(previewMetrics ?? {}) };
    for (const [k, v] of Object.entries(overrideMetrics)) {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) merged[k] = n;
    }
    setWhatIfViolations(computeViolations(merged, local, chemSupply));
  }, [overrideMetrics, previewMetrics, local, chemSupply]);

  // Evaluate single / current plant
  const runEvaluate = useCallback(async () => {
    if (!plantId || plantId === 'global') return;
    setEvaluating(true);
    try {
      const scope_label =
        scope === 'plant'
          ? (plants ?? []).find((p) => p.id === plantId)?.name
          : 'All plants';

      const [fetched, chemFetched] = await Promise.all([
        fetchPlantMetrics(plantId, days),
        fetchChemDaysOfSupply(plantId),
      ]);
      const metrics = { ...fetched.metrics };
      const rows    = fetched.rows;
      const chem    = chemFetched;

      // Also fetch previous period for trend indicators
      const prev = await fetchPreviousPeriodMetrics(plantId, days);
      setPrevMetrics(prev);

      setDailyRows(rows);
      setPreviewMetrics(metrics);
      setChemSupply(chem);

      // Apply manual overrides if any
      for (const [k, v] of Object.entries(overrideMetrics)) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) metrics[k] = n;
      }

      const thresholds = await loadThresholds(thresholdScope);
      const violations = computeViolations(metrics, thresholds, chem);

      const evalResult: EvalResult = {
        scope:        thresholdScope,
        scope_label,
        evaluated_at: new Date().toISOString(),
        violations,
        thresholds,
      };

      setResult(evalResult);
      setLocal(thresholds);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setEvaluating(false);
    }
  }, [plantId, scope, days, plants, overrideMetrics, thresholdScope]);

  // Auto-run evaluate on mount and whenever plantId or days change
  useEffect(() => {
    if (plantId && plantId !== 'global') {
      runEvaluate();
    }
  }, [plantId, days, scope, runEvaluate]);

  // Save thresholds
  const saveThresholds = useCallback(async () => {
    if (!local) return;
    setSaving(true);
    try {
      await persistThresholds(thresholdScope, local);
      toast.success('Thresholds saved successfully.');
      setEditing(false);
      refetchThresholds();
      runEvaluate();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }, [local, thresholdScope, refetchThresholds, runEvaluate]);

  const summary = result ? buildSummary(result.violations) : null;
  const complianceScore = result ? computeComplianceScore(result.violations) : null;

  const latestDataDate = dailyRows.length ? dailyRows[0].summary_date : null;
  let dataDaysStale: number | null = null;
  if (latestDataDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, day] = latestDataDate.split('-').map(Number);
    dataDaysStale = Math.round((today.getTime() - new Date(y, m - 1, day).getTime()) / 86400000);
  }

  // Fleet wide aggregation metrics
  const avgFleetScore = fleetSummaries.length
    ? Math.round(fleetSummaries.reduce((sum, p) => sum + p.score, 0) / fleetSummaries.length)
    : null;
  const totalCriticalViolations = fleetSummaries.reduce(
    (sum, p) => sum + p.violations.filter((v) => v.severity === 'high').length, 0,
  );
  const totalChemWarnings = fleetSummaries.reduce(
    (sum, p) => sum + p.violations.filter((v) => v.code === 'CHEM_LOW').length, 0,
  );

  // CSV Audit Exporter
  const exportComplianceCsv = () => {
    const headers = [
      'Facility Name',
      'Compliance Score %',
      'Rating Tier',
      'Total Violations',
      'Critical (High)',
      'Medium Violations',
      'Low Violations',
      'NRW %',
      'Permeate TDS (ppm)',
      'Permeate pH',
      'Raw Turbidity (NTU)',
      'Differential Pressure (psi)',
      'Recovery %',
      'Downtime (hrs/day)',
      'Chemical Supply Alert',
      'Audit Date',
    ];

    const rowsData = fleetSummaries.map((p) => {
      const highCount = p.violations.filter((v) => v.severity === 'high').length;
      const medCount = p.violations.filter((v) => v.severity === 'medium').length;
      const lowCount = p.violations.filter((v) => v.severity === 'low').length;
      const chemLow = p.violations.filter((v) => v.code === 'CHEM_LOW').map((v) => `${v.metric} (${v.value}d)`).join('; ') || 'Normal';

      return [
        `"${p.plantName}"`,
        `"${p.score}%"`,
        `"${scoreLabel(p.score)}"`,
        `"${p.violations.length}"`,
        `"${highCount}"`,
        `"${medCount}"`,
        `"${lowCount}"`,
        `"${p.metrics.nrw_pct !== undefined ? p.metrics.nrw_pct.toFixed(1) + '%' : '—'}"`,
        `"${p.metrics.permeate_tds !== undefined ? p.metrics.permeate_tds.toFixed(1) : '—'}"`,
        `"${p.metrics.permeate_ph !== undefined ? p.metrics.permeate_ph.toFixed(2) : '—'}"`,
        `"${p.metrics.raw_turbidity !== undefined ? p.metrics.raw_turbidity.toFixed(2) : '—'}"`,
        `"${p.metrics.dp_psi !== undefined ? p.metrics.dp_psi.toFixed(1) : '—'}"`,
        `"${p.metrics.recovery_pct !== undefined ? p.metrics.recovery_pct.toFixed(1) + '%' : '—'}"`,
        `"${p.metrics.downtime_hrs !== undefined ? p.metrics.downtime_hrs.toFixed(1) : '—'}"`,
        `"${chemLow}"`,
        `"${new Date().toISOString().slice(0, 10)}"`,
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rowsData.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `compliance_audit_matrix_${days}d_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Compliance audit matrix exported successfully.');
  };

  const handleSelectPlant = (id: string) => {
    setPlantId(id);
    setScope('plant');
    setSelectedPlantId(id);
    setComplianceTab('status');
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader
          title="Compliance & Regulatory Radar"
          titleIcon={<ShieldCheck className="h-5 w-5 text-accent" />}
          subtitle="Real-time threshold surveillance for water quality parameters, plant hydraulic efficiency, NRW, downtime, and chemical autonomy."
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
            onClick={exportComplianceCsv}
            title="Download complete compliance evaluation audit across all plants"
          >
            <FileDown className="h-3.5 w-3.5 text-primary" />
            <span>Export Compliance Audit (.csv)</span>
          </Button>
        </div>
      </div>

      {/* ── Executive Compliance Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={ShieldCheck}
          label="Fleet Compliance Index"
          value={avgFleetScore !== null ? `${avgFleetScore}% · ${scoreLabel(avgFleetScore)}` : '—'}
          tone={avgFleetScore !== null && avgFleetScore < 75 ? 'danger' : avgFleetScore !== null && avgFleetScore < 85 ? 'warn' : 'accent'}
        />
        <StatCard
          icon={ShieldAlert}
          label="Critical Violations Active"
          value={totalCriticalViolations.toLocaleString()}
          tone={totalCriticalViolations > 0 ? 'danger' : undefined}
        />
        <StatCard
          icon={Beaker}
          label="Chemical Supply Alerts"
          value={totalChemWarnings.toLocaleString()}
          tone={totalChemWarnings > 0 ? 'warn' : undefined}
        />
        <StatCard
          icon={Building2}
          label="Monitored Facilities"
          value={`${plants?.length ?? 0} Plants`}
        />
      </div>

      {/* Controls Card */}
      <Card className="p-3 bg-muted/20 border-border/70">
        <div className="grid gap-2.5 md:grid-cols-[140px_1fr_140px_auto] items-end">
          <div>
            <Label htmlFor="compliance-scope" className="text-xs font-semibold">Surveillance Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as 'global' | 'plant')}>
              <SelectTrigger className="mt-1 bg-background" id="compliance-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plant">Facility Specific</SelectItem>
                <SelectItem value="global">Global Standard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="compliance-plant" className="text-xs font-semibold">Active Facility</Label>
            <Select value={plantId} onValueChange={(v) => { setPlantId(v); setSelectedPlantId(v); }} disabled={scope === 'global'}>
              <SelectTrigger className="mt-1 bg-background" id="compliance-plant"><SelectValue placeholder="Pick plant…" /></SelectTrigger>
              <SelectContent>
                {(plants ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="compliance-window-days" className="text-xs font-semibold">Audit Window</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="mt-1 bg-background" id="compliance-window-days"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 7, 14, 30, 90].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d === 90 ? '90d (Quarterly)' : `${d}d`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9 font-semibold bg-background" disabled={evaluating} onClick={runEvaluate}>
              {evaluating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Re-Evaluate
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs value={complianceTab} onValueChange={(v) => setComplianceTab(v as typeof complianceTab)}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 gap-1 h-auto sm:h-10 w-full">
          <TabsTrigger value="status" className="gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Facility Radar &amp; Drill-down
          </TabsTrigger>
          <TabsTrigger value="fleet" className="gap-1.5 text-xs">
            <Layers className="h-3.5 w-3.5" />
            Fleet Comparative Matrix
            {totalCriticalViolations > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-2xs bg-destructive text-destructive-foreground">
                {totalCriticalViolations}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="thresholds" className="gap-1.5 text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            Threshold Limits
          </TabsTrigger>
          <TabsTrigger value="whatif" className="gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" />
            What-If Simulator
            {whatIfViolations !== null && (
              <Badge className="ml-1 text-2xs h-4 px-1 bg-warn">
                {whatIfViolations.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Facility Radar & Drill-down ── */}
        <TabsContent value="status" className="mt-4 space-y-4">
          {!result ? (
            <DataState
              loading={evaluating}
              isEmpty={!evaluating}
              emptyTitle="Evaluating facility compliance..."
              emptyDescription="Please wait while live telemetry and chemical stocks are evaluated against thresholds."
            />
          ) : (
            <>
              {/* Status banner + compliance score */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-stretch">
                <Card className={cn(
                  'p-4 border-l-4 md:col-span-3 flex items-start gap-3.5',
                  result.violations.length === 0
                    ? 'border-accent bg-accent-soft/40'
                    : result.violations.some((v) => v.severity === 'high')
                      ? 'border-danger bg-danger-soft/40'
                      : 'border-warn bg-warn-soft/40',
                )}>
                  {result.violations.length === 0
                    ? <ShieldCheck className="h-7 w-7 text-accent shrink-0 mt-0.5" />
                    : <ShieldAlert className="h-7 w-7 text-danger shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground">{summary?.headline}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {result.scope_label ?? result.scope} · Evaluated {new Date(result.evaluated_at).toLocaleTimeString()}
                    </div>
                    {latestDataDate && (
                      <div className={cn(
                        'text-xs mt-1 flex items-center gap-1 font-medium',
                        dataDaysStale !== null && dataDaysStale > 1
                          ? 'text-warn'
                          : 'text-muted-foreground',
                      )}>
                        {dataDaysStale !== null && dataDaysStale > 1 && (
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        Data as of {fmtSummaryDate(latestDataDate)}
                        {dataDaysStale !== null && dataDaysStale > 1 &&
                          ` — (${dataDaysStale} days lag, verify daily aggregation cron)`}
                      </div>
                    )}
                    {summary && summary.details.length > 0 && (
                      <ul className="mt-2.5 space-y-1.5">
                        {summary.details.map((d, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/90 font-medium">
                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warn" />
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                {/* Score Gauge Card */}
                {complianceScore !== null && (
                  <Card className={cn('p-4 flex flex-col items-center justify-center border', scoreBgColor(complianceScore))}>
                    <div className="text-2xs text-muted-foreground mb-1 font-bold uppercase tracking-wider">
                      Compliance Rating
                    </div>
                    <ScoreGauge score={complianceScore} />
                  </Card>
                )}
              </div>

              {/* Period Averages with Trend indicators */}
              {previewMetrics && Object.keys(previewMetrics).length > 0 && (
                <Card className="p-3.5">
                  <div className="text-xs font-bold text-foreground mb-2 flex items-center justify-between">
                    <span>Monitored Parameter Averages ({days}d Rolling)</span>
                    <span className="text-2xs font-normal text-muted-foreground">Arrow indicates trend direction vs previous period</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Object.entries(previewMetrics).map(([k, v]) => {
                      const prev = prevMetrics[k];
                      const trend: Trend = (v !== undefined && prev !== undefined)
                        ? computeTrend(v as number, prev)
                        : 'flat';
                      const improving = METRIC_IMPROVING_DIRECTION[k] ?? true;
                      return (
                        <div key={k} className="rounded-lg p-2.5 bg-muted/40 border border-border/60">
                          <div className="text-2xs font-semibold text-muted-foreground truncate">{labelize(k)}</div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-sm font-mono font-bold text-foreground">
                              {v !== undefined && !Number.isNaN(v as any)
                                ? Math.round((v as number) * 100) / 100
                                : '—'}
                            </span>
                            <TrendIndicator trend={trend} improving={improving} />
                            {prev !== undefined && (
                              <span className="text-3xs text-muted-foreground font-mono">
                                (prev: {Math.round((prev as number) * 100) / 100})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Chemical Stock Autonomy Warnings */}
              {chemSupply.length > 0 && (
                <Card className="p-3.5 border-border/70">
                  <div className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                    <Beaker className="h-4 w-4 text-primary" />
                    <span>Chemical Autonomy &amp; Projected Run-Out</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {chemSupply.map((chem) => {
                      const isLow = chem.days < (result?.thresholds.chem_low_stock_days_min ?? 7);
                      const isCritical = chem.days < (result?.thresholds.chem_low_stock_days_min ?? 7) / 2;
                      return (
                        <div
                          key={chem.name}
                          className={cn(
                            'p-2.5 rounded-lg border font-medium text-xs',
                            isCritical
                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-800 dark:text-rose-200'
                              : isLow
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-200'
                                : 'bg-muted/30 border-border/60 text-foreground',
                          )}
                        >
                          <div className="text-2xs text-muted-foreground font-semibold">{chem.name}</div>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-sm font-bold font-mono">{chem.days.toFixed(1)}</span>
                            <span className="text-3xs text-muted-foreground">days of supply</span>
                          </div>
                          {isLow && (
                            <div className="text-3xs font-bold text-destructive mt-1 flex items-center gap-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" /> Reorder required
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Violations table with drill-down rows */}
              {result.violations.length > 0 ? (
                <Card className="p-0 overflow-hidden border border-border/70 shadow-2xs">
                  <div className="p-3 border-b bg-muted/20 flex items-center justify-between">
                    <div className="text-xs font-bold text-foreground">
                      Active Parameter Violations ({result.violations.length})
                    </div>
                    <span className="text-2xs text-muted-foreground">Click row to expand historical 14-day sparkline</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left w-6"></th>
                          <th className="px-3 py-2 text-left whitespace-nowrap">Severity</th>
                          <th className="px-3 py-2 text-left whitespace-nowrap">Metric / Chemical</th>
                          <th className="px-3 py-2 text-right whitespace-nowrap">Measured Value</th>
                          <th className="px-3 py-2 text-right whitespace-nowrap">Threshold Limit</th>
                          <th className="px-3 py-2 text-left">Recommended Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.violations.map((v) => {
                          const rowKey = v.code + v.metric;
                          const isExpanded = expandedViolation === rowKey;
                          const rowData = dailyRows.filter(
                            (r) => r[v.metric] !== undefined && r[v.metric] !== null,
                          );
                          return (
                            <Fragment key={rowKey}>
                              <tr
                                className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                                onClick={() => setExpandedViolation(isExpanded ? null : rowKey)}
                              >
                                <td className="px-3 py-2 text-muted-foreground">
                                  {isExpanded
                                    ? <ChevronDown className="h-3.5 w-3.5 text-foreground" />
                                    : <ChevronRight className="h-3.5 w-3.5" />}
                                </td>
                                <td className="px-3 py-2"><SeverityBadge sev={v.severity} /></td>
                                <td className="px-3 py-2 font-mono text-xs font-bold whitespace-nowrap text-foreground">{v.metric}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs font-bold whitespace-nowrap text-destructive">{v.value ?? '—'}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                                  {v.threshold}{' '}
                                  <span className="text-foreground font-semibold">{v.comparator}</span>
                                </td>
                                <td className="px-3 py-2 text-xs font-medium text-foreground/90">{v.message}</td>
                              </tr>
                              {/* Drill-down sparkline row */}
                              {isExpanded && (
                                <tr className="bg-muted/20 border-t border-dashed">
                                  <td colSpan={6} className="px-5 py-3">
                                    <div className="text-xs font-medium text-muted-foreground mb-1">
                                      Daily telemetry history — <span className="font-mono font-bold text-foreground">{v.metric}</span>
                                      <span className="ml-2 text-danger font-semibold">
                                        (Red markers indicate threshold breach)
                                      </span>
                                    </div>
                                    {rowData.length > 0 ? (
                                      <Sparkline
                                        data={rowData}
                                        metricKey={v.metric}
                                        threshold={v.threshold}
                                        comparator={v.comparator}
                                      />
                                    ) : (
                                      <p className="text-xs text-muted-foreground italic">
                                        No daily rows available for this parameter.
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : (
                <Card className="p-6 text-center space-y-1 bg-emerald-500/10 border-emerald-500/30">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                  <div className="font-bold text-foreground">100% Parameter Compliance</div>
                  <p className="text-xs text-muted-foreground">All tracked water quality, hydraulic, NRW, and chemical parameters are strictly within normal regulatory limits.</p>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Tab 2: Fleet Comparative Matrix ── */}
        <TabsContent value="fleet" className="mt-4">
          <Card className="p-0 overflow-hidden border border-border/70 shadow-2xs">
            <div className="p-3 border-b bg-muted/20 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-foreground">Fleet-Wide Compliance Matrix</h3>
                <p className="text-2xs text-muted-foreground">Comparative overview of regulatory compliance across all plants in the selected {days}d window.</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={fleetLoading}
                className="h-7 px-2 text-2xs gap-1"
                onClick={() => refetchFleet()}
              >
                {fleetLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Refresh Fleet
              </Button>
            </div>

            <DataState
              loading={fleetLoading}
              isEmpty={fleetSummaries.length === 0}
              emptyTitle="No plant facilities configured."
              onRetry={() => refetchFleet()}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-bold text-xs">Plant Facility</th>
                      <th className="text-center px-3 py-2.5 font-bold text-xs">Compliance Score</th>
                      <th className="text-center px-3 py-2.5 font-bold text-xs">Status</th>
                      <th className="text-center px-3 py-2.5 font-bold text-xs">Violations</th>
                      <th className="text-right px-3 py-2.5 font-bold text-xs">NRW %</th>
                      <th className="text-right px-3 py-2.5 font-bold text-xs">Perm TDS</th>
                      <th className="text-right px-3 py-2.5 font-bold text-xs">Perm pH</th>
                      <th className="text-right px-3 py-2.5 font-bold text-xs">Recovery %</th>
                      <th className="text-center px-3 py-2.5 font-bold text-xs">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fleetSummaries.map((p) => {
                      const highViolations = p.violations.filter((v) => v.severity === 'high').length;
                      const medViolations = p.violations.filter((v) => v.severity === 'medium').length;

                      return (
                        <tr key={p.plantId} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2.5 font-bold text-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span>{p.plantName}</span>
                            </div>
                          </td>

                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <span className={cn('font-mono font-extrabold text-xs', scoreColor(p.score))}>
                              {p.score}%
                            </span>
                          </td>

                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <Badge variant="outline" className={cn('text-3xs font-bold px-2 py-0.5', scoreBgColor(p.score), scoreColor(p.score))}>
                              {scoreLabel(p.score)}
                            </Badge>
                          </td>

                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {p.violations.length === 0 ? (
                              <span className="text-emerald-600 font-bold text-2xs">0 issues</span>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                {highViolations > 0 && (
                                  <Badge className="h-4 px-1 text-3xs bg-destructive text-destructive-foreground">
                                    {highViolations} High
                                  </Badge>
                                )}
                                {medViolations > 0 && (
                                  <Badge className="h-4 px-1 text-3xs bg-warn text-warn-foreground">
                                    {medViolations} Med
                                  </Badge>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                            {p.metrics.nrw_pct !== undefined ? `${p.metrics.nrw_pct.toFixed(1)}%` : '—'}
                          </td>

                          <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                            {p.metrics.permeate_tds !== undefined ? p.metrics.permeate_tds.toFixed(1) : '—'}
                          </td>

                          <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                            {p.metrics.permeate_ph !== undefined ? p.metrics.permeate_ph.toFixed(2) : '—'}
                          </td>

                          <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                            {p.metrics.recovery_pct !== undefined ? `${p.metrics.recovery_pct.toFixed(1)}%` : '—'}
                          </td>

                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-2xs font-semibold hover:bg-primary hover:text-white"
                              onClick={() => handleSelectPlant(p.plantId)}
                            >
                              Inspect Radar &rarr;
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DataState>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Thresholds Editor ── */}
        <TabsContent value="thresholds" className="mt-4">
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-sm font-bold text-foreground">
                  Surveillance Limits:{' '}
                  {thresholdScope === 'global'
                    ? 'Global Fleet Standard'
                    : (plants ?? []).find((p) => p.id === plantId)?.name ?? thresholdScope}
                </div>
                <div className="text-xs text-muted-foreground">
                  Plant-specific thresholds override global defaults for this facility.
                </div>
              </div>
              <div className="flex gap-2">
                {!canEditThresholds ? null : !editing ? (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Settings2 className="h-3.5 w-3.5 mr-1" />
                    Configure Thresholds
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditing(false); if (thData) setLocal(thData.thresholds); }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" disabled={saving} onClick={saveThresholds}>
                      {saving
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        : <Save className="h-3.5 w-3.5 mr-1" />}
                      Save Thresholds
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Categorized Parameter Groups */}
            <div className="space-y-4">
              {/* Group 1: Water Quality */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
                <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-foreground">
                  <Droplets className="h-4 w-4 text-sky-500" />
                  <span>Water Quality &amp; Permeate Regulatory Limits</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label htmlFor="permeate_tds_max" className="text-2xs font-semibold text-muted-foreground">Permeate TDS Max (ppm)</Label>
                    <Input
                      id="permeate_tds_max"
                      type="number"
                      value={local?.permeate_tds_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, permeate_tds_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="permeate_ph_min" className="text-2xs font-semibold text-muted-foreground">Permeate pH Min</Label>
                    <Input
                      id="permeate_ph_min"
                      type="number"
                      step="0.1"
                      value={local?.permeate_ph_min ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, permeate_ph_min: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="permeate_ph_max" className="text-2xs font-semibold text-muted-foreground">Permeate pH Max</Label>
                    <Input
                      id="permeate_ph_max"
                      type="number"
                      step="0.1"
                      value={local?.permeate_ph_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, permeate_ph_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="raw_turbidity_max" className="text-2xs font-semibold text-muted-foreground">Raw Turbidity Max (NTU)</Label>
                    <Input
                      id="raw_turbidity_max"
                      type="number"
                      step="0.1"
                      value={local?.raw_turbidity_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, raw_turbidity_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Group 2: Hydraulic & Operations */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
                <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-foreground">
                  <Gauge className="h-4 w-4 text-emerald-500" />
                  <span>Hydraulic &amp; Plant Efficiency Limits</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <Label htmlFor="nrw_pct_max" className="text-2xs font-semibold text-muted-foreground">NRW % Max</Label>
                    <Input
                      id="nrw_pct_max"
                      type="number"
                      value={local?.nrw_pct_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, nrw_pct_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="recovery_pct_min" className="text-2xs font-semibold text-muted-foreground">Recovery % Min</Label>
                    <Input
                      id="recovery_pct_min"
                      type="number"
                      value={local?.recovery_pct_min ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, recovery_pct_min: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="downtime_hrs_per_day_max" className="text-2xs font-semibold text-muted-foreground">Downtime Max (hrs/day)</Label>
                    <Input
                      id="downtime_hrs_per_day_max"
                      type="number"
                      step="0.5"
                      value={local?.downtime_hrs_per_day_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, downtime_hrs_per_day_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dp_psi_max" className="text-2xs font-semibold text-muted-foreground">Differential Pressure Max (psi)</Label>
                    <Input
                      id="dp_psi_max"
                      type="number"
                      value={local?.dp_psi_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, dp_psi_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pv_ratio_max" className="text-2xs font-semibold text-muted-foreground">PV Ratio Max</Label>
                    <Input
                      id="pv_ratio_max"
                      type="number"
                      step="0.1"
                      value={local?.pv_ratio_max ?? ''}
                      disabled={!editing}
                      onChange={(e) => setLocal((l) => l ? ({ ...l, pv_ratio_max: parseFloat(e.target.value) || 0 }) : l)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Group 3: Chemical Autonomy */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
                <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-foreground">
                  <Beaker className="h-4 w-4 text-amber-500" />
                  <span>Chemical Autonomy &amp; Inventory Alarm Limit</span>
                </div>
                <div className="max-w-xs">
                  <Label htmlFor="chem_low_stock_days_min" className="text-2xs font-semibold text-muted-foreground">Chemical Low-Stock Warning (Days of Supply)</Label>
                  <Input
                    id="chem_low_stock_days_min"
                    type="number"
                    value={local?.chem_low_stock_days_min ?? ''}
                    disabled={!editing}
                    onChange={(e) => setLocal((l) => l ? ({ ...l, chem_low_stock_days_min: parseFloat(e.target.value) || 0 }) : l)}
                    className="mt-1 font-mono text-xs"
                  />
                  <p className="text-3xs text-muted-foreground mt-1">Raises warning alert if projected run-out is under this duration.</p>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── Tab 4: What-if Simulation ── */}
        <TabsContent value="whatif" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-warn" />
              <span className="text-sm font-bold text-foreground">Real-Time What-If Simulation Sandbox</span>
              <Badge variant="outline" className="text-2xs ml-auto border-warn text-warn bg-warn-soft font-bold">
                Live Sandbox
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              Tweak values below to stress-test your compliance score and preview alerts without altering production readings.
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                'nrw_pct', 'downtime_hrs', 'permeate_tds', 'permeate_ph',
                'raw_turbidity', 'dp_psi', 'recovery_pct', 'pv_ratio',
              ].map((k) => {
                const fetched = previewMetrics?.[k];
                return (
                  <div key={k}>
                    <Label htmlFor={`whatif-${k}`} className="text-xs font-semibold">{labelize(k)}</Label>
                    {fetched !== undefined && overrideMetrics[k] === undefined && (
                      <div className="text-2xs text-muted-foreground font-mono">
                        Live value: {Math.round((fetched as number) * 100) / 100}
                      </div>
                    )}
                    <Input
                      id={`whatif-${k}`}
                      type="number"
                      step="0.01"
                      placeholder={fetched !== undefined ? String(Math.round((fetched as number) * 100) / 100) : '—'}
                      className="mt-1 font-mono text-xs"
                      value={overrideMetrics[k] ?? ''}
                      onChange={(e) => setOverrideMetrics((m) => ({ ...m, [k]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => { setOverrideMetrics({}); setWhatIfViolations(null); }}
              >
                Clear Sandbox Overrides
              </Button>
            </div>
          </Card>

          {/* What-if violations live preview */}
          {whatIfViolations !== null && (
            <Card className={cn(
              'p-3 border-l-4',
              whatIfViolations.length === 0
                ? 'border-accent bg-accent-soft/50'
                : whatIfViolations.some((v) => v.severity === 'high')
                  ? 'border-danger bg-danger-soft/50'
                  : 'border-warn bg-warn-soft/50',
            )}>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-warn" />
                <span className="text-xs font-bold text-foreground">
                  Simulated Compliance Score: {computeComplianceScore(whatIfViolations)}/100 ({scoreLabel(computeComplianceScore(whatIfViolations))})
                </span>
                {whatIfViolations.length === 0
                  ? <Badge className="text-2xs bg-accent ml-auto">No violations</Badge>
                  : <Badge className="text-2xs bg-danger ml-auto">{whatIfViolations.length} violation{whatIfViolations.length > 1 ? 's' : ''}</Badge>}
              </div>
              {whatIfViolations.length > 0 && (
                <div className="space-y-1 mt-2">
                  {whatIfViolations.map((v) => (
                    <div key={v.code} className="flex items-center gap-2 text-xs">
                      <SeverityBadge sev={v.severity} />
                      <span className="font-mono font-bold text-foreground">{v.metric}</span>
                      <span className="font-bold text-destructive">{v.value}</span>
                      <span className="text-muted-foreground">
                        {v.comparator} {v.threshold}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -----------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------

function SeverityBadge({ sev }: { sev: string }) {
  const m: Record<string, string> = {
    high:   'bg-danger-soft text-danger border-danger font-bold',
    medium: 'bg-warn-soft text-warn border-warn font-semibold',
    low:    'bg-info-soft text-info border-info font-normal',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-3xs', m[sev] ?? '')}>
      {sev}
    </Badge>
  );
}

function labelize(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

