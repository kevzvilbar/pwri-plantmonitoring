import { useEffect, useState, useCallback, useRef } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, Loader2, RefreshCcw,
  Save, Settings2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight,
  Eye, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------
// Empty / loading state
// -----------------------------------------------------------------------

function DataState({ isEmpty, emptyTitle, emptyDescription }: {
  isEmpty?: boolean; emptyTitle?: string; emptyDescription?: string;
}) {
  if (!isEmpty) return null;
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      <ShieldCheck className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">{emptyTitle}</p>
      {emptyDescription && (
        <p className="text-xs text-muted-foreground/70">{emptyDescription}</p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Shared types
// -----------------------------------------------------------------------

type Thresholds = {
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

type Violation = {
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

// NEW: daily row returned from Supabase for sparkline / trend data
type DailyRow = Record<string, any> & { summary_date: string };

// -----------------------------------------------------------------------
// Default thresholds — used when no saved value exists
// -----------------------------------------------------------------------

const DEFAULT_THRESHOLDS: Thresholds = {
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
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-rose-600';
}

function scoreBgColor(score: number): string {
  if (score >= 80) return 'bg-emerald-50 border-emerald-200';
  if (score >= 50) return 'bg-amber-50 border-amber-200';
  return 'bg-rose-50 border-rose-200';
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
    score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#f43f5e';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="76" height="44" viewBox="0 0 76 44">
        {/* Background arc */}
        <path
          d="M 6 42 A 32 32 0 0 1 70 42"
          fill="none"
          stroke="#e5e7eb"
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
      <span className={cn('text-[10px] font-semibold uppercase tracking-wide', scoreColor(score))}>
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
          stroke="#f43f5e" strokeWidth="1" strokeDasharray="4 2" opacity="0.7"
        />
        {/* Sparkline */}
        <polyline
          points={pts}
          fill="none"
          stroke="#6366f1"
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
              fill={breached ? '#f43f5e' : '#6366f1'}
            />
          );
        })}
        {/* Threshold label */}
        <text x={W - PAD + 2} y={thY + 3} fontSize="8" fill="#f43f5e">
          {threshold}
        </text>
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5 px-[8px]">
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
    return <TrendingUp className={cn('h-3.5 w-3.5', isGood ? 'text-emerald-600' : 'text-rose-500')} />;
  }
  return <TrendingDown className={cn('h-3.5 w-3.5', isGood ? 'text-emerald-600' : 'text-rose-500')} />;
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
    <Card className="p-3 border-blue-200 bg-blue-50/40">
      <div className="flex items-center gap-1.5 mb-2">
        <Eye className="h-3.5 w-3.5 text-blue-600" />
        <span className="text-xs font-medium text-blue-800">Metric Preview</span>
        {hasGaps && (
          <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50 ml-auto">
            Data gaps detected
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className={cn(
            'rounded px-2 py-1.5',
            v === undefined || v === null || Number.isNaN(v as any)
              ? 'bg-amber-100/60'
              : 'bg-white/80',
          )}>
            <div className="text-[10px] text-muted-foreground truncate">{labelize(k)}</div>
            <div className={cn(
              'text-sm font-mono font-medium',
              v === undefined || v === null || Number.isNaN(v as any) ? 'text-amber-600' : '',
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

function computeViolations(
  metrics: Record<string, number | undefined>,
  t: Thresholds,
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

  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  violations.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

  return violations;
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
): Promise<{ metrics: Record<string, number | undefined>; rows: DailyRow[] }> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data } = await supabase
    .from('daily_plant_summary')
    .select('*')
    .eq('plant_id', plantId)
    .gte('summary_date', sinceIso)
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

async function loadThresholds(scope: string): Promise<Thresholds> {
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
  lsSaveThresholds(scope, thresholds);
  const { error } = await supabase
    .from('compliance_thresholds')
    .upsert({ scope, thresholds, updated_at: new Date().toISOString() }, { onConflict: 'scope' });
  if (error) {
    console.warn('[Compliance] Supabase upsert failed:', error.message);
  }
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function Compliance() {
  const { data: plants }    = usePlants();
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId]   = useState<string>(selectedPlantId ?? 'global');
  const [days, setDays]         = useState<number>(7);
  const [scope, setScope]       = useState<'global' | 'plant'>(selectedPlantId ? 'plant' : 'global');
  const [editing, setEditing]   = useState(false);
  const [local, setLocal]       = useState<Thresholds | null>(null);
  const [saving, setSaving]     = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult]     = useState<EvalResult | null>(null);
  const [overrideMetrics, setOverrideMetrics] = useState<Record<string, string>>({});
  const [complianceTab, setComplianceTab] = useTabPersist<'status' | 'thresholds' | 'override'>(
    'tab:compliance', 'status',
  );

  // NEW state
  const [dailyRows, setDailyRows]           = useState<DailyRow[]>([]);
  const [prevMetrics, setPrevMetrics]       = useState<Record<string, number | undefined>>({});
  const [expandedViolation, setExpandedViolation] = useState<string | null>(null);
  const [previewMetrics, setPreviewMetrics] = useState<Record<string, number | undefined> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [whatIfViolations, setWhatIfViolations] = useState<Violation[] | null>(null);

  useEffect(() => {
    if (selectedPlantId) { setPlantId(selectedPlantId); setScope('plant'); }
  }, [selectedPlantId]);

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

  // ---- NEW: auto-preview when plant + window change ----
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (scope !== 'plant' || !plantId || plantId === 'global') {
      setPreviewMetrics(null);
      return;
    }
    const controller = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = controller;

    setPreviewLoading(true);
    fetchPlantMetrics(plantId, days)
      .then(({ metrics }) => {
        if (!controller.signal.aborted) setPreviewMetrics(metrics);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });

    return () => controller.abort();
  }, [scope, plantId, days]);

  // ---- NEW: what-if real-time violations from override tab ----
  useEffect(() => {
    if (!local) return;
    const hasAnyOverride = Object.values(overrideMetrics).some((v) => v !== '');
    if (!hasAnyOverride) { setWhatIfViolations(null); return; }

    const merged: Record<string, number | undefined> = { ...(previewMetrics ?? {}) };
    for (const [k, v] of Object.entries(overrideMetrics)) {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) merged[k] = n;
    }
    setWhatIfViolations(computeViolations(merged, local));
  }, [overrideMetrics, previewMetrics, local]);

  // ---- Evaluate ----
  const runEvaluate = useCallback(async () => {
    setEvaluating(true);
    setResult(null);
    try {
      const scope_label =
        scope === 'plant'
          ? (plants ?? []).find((p) => p.id === plantId)?.name
          : 'All plants';

      let metrics: Record<string, number | undefined> = {};
      let rows: DailyRow[] = [];

      if (scope === 'plant' && plantId && plantId !== 'global') {
        const fetched = await fetchPlantMetrics(plantId, days);
        metrics = fetched.metrics;
        rows    = fetched.rows;

        // Also fetch previous period for trend indicators
        const prev = await fetchPreviousPeriodMetrics(plantId, days);
        setPrevMetrics(prev);
      }

      setDailyRows(rows);
      setPreviewMetrics(metrics);

      // Apply manual overrides
      for (const [k, v] of Object.entries(overrideMetrics)) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) metrics[k] = n;
      }

      const thresholds = await loadThresholds(thresholdScope);
      const violations = computeViolations(metrics, thresholds);

      const evalResult: EvalResult = {
        scope:        thresholdScope,
        scope_label,
        evaluated_at: new Date().toISOString(),
        violations,
        thresholds,
      };

      setResult(evalResult);
      setLocal(thresholds);
    } catch (e: any) {
      toast.error(`Evaluation failed: ${e.message}`);
    } finally {
      setEvaluating(false);
    }
  }, [plantId, scope, days, plants, overrideMetrics, thresholdScope]);

  // ---- Save thresholds ----
  const saveThresholds = useCallback(async () => {
    if (!local) return;
    setSaving(true);
    try {
      await persistThresholds(thresholdScope, local);
      toast.success('Thresholds saved');
      setEditing(false);
      refetchThresholds();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }, [local, thresholdScope, refetchThresholds]);

  const summary = result ? buildSummary(result.violations) : null;

  // NEW: compliance score
  const complianceScore = result ? computeComplianceScore(result.violations) : null;

  // -----------------------------------------------------------------------
  return (
    <div className="space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> Compliance
          </h1>
          <p className="text-xs text-muted-foreground">
            Threshold-based alerts for NRW, downtime, water quality &amp; chemicals.
          </p>
        </div>
      </div>

      {/* Controls */}
      <Card className="p-3">
        <div className="grid gap-2 md:grid-cols-[140px_1fr_140px_auto] items-end">
          <div>
            <Label className="text-xs">Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as 'global' | 'plant')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="plant">Specific plant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Plant</Label>
            <Select value={plantId} onValueChange={setPlantId} disabled={scope === 'global'}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick plant…" /></SelectTrigger>
              <SelectContent>
                {(plants ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Window (days)</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 7, 14, 30].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d}d</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={evaluating} onClick={runEvaluate}>
              {evaluating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <RefreshCcw className="h-3.5 w-3.5 mr-1" />}
              Evaluate
            </Button>
          </div>
        </div>
      </Card>

      {/* NEW: Inline metric preview (shown before evaluation when plant is selected) */}
      {scope === 'plant' && plantId && plantId !== 'global' && !result && (
        <MetricPreview metrics={previewMetrics} loading={previewLoading} />
      )}

      <Tabs value={complianceTab} onValueChange={(v) => setComplianceTab(v as typeof complianceTab)}>
        <TabsList>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="thresholds">
            <Settings2 className="h-3.5 w-3.5 mr-1" />Thresholds
          </TabsTrigger>
          <TabsTrigger value="override">
            <Zap className="h-3.5 w-3.5 mr-1" />
            What-if
            {whatIfViolations !== null && (
              <Badge className="ml-1.5 text-[10px] h-4 px-1 bg-amber-500">
                {whatIfViolations.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* -------- Status -------- */}
        <TabsContent value="status" className="mt-3 space-y-3">
          {!result ? (
            <DataState
              isEmpty
              emptyTitle="Run an evaluation to see status"
              emptyDescription='Pick a scope and click "Evaluate" above.'
            />
          ) : (
            <>
              {/* Status banner + compliance score */}
              <div className="flex gap-3 items-stretch">
                <Card className={cn(
                  'p-3 border-l-4 flex-1',
                  result.violations.length === 0
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : result.violations.some((v) => v.severity === 'high')
                      ? 'border-rose-500 bg-rose-50/50'
                      : 'border-amber-500 bg-amber-50/50',
                )}>
                  <div className="flex items-start gap-3">
                    {result.violations.length === 0
                      ? <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0" />
                      : <ShieldAlert className="h-6 w-6 text-rose-600 shrink-0" />}
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{summary?.headline}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {result.scope_label ?? result.scope} · evaluated{' '}
                        {new Date(result.evaluated_at).toLocaleTimeString()}
                      </div>
                      {summary && summary.details.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {summary.details.map((d, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                              {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </Card>

                {/* NEW: Compliance Score gauge */}
                {complianceScore !== null && (
                  <Card className={cn('p-3 flex flex-col items-center justify-center border', scoreBgColor(complianceScore))}>
                    <div className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                      Score
                    </div>
                    <ScoreGauge score={complianceScore} />
                  </Card>
                )}
              </div>

              {/* NEW: Metric values with trend indicators (post-eval) */}
              {previewMetrics && Object.keys(previewMetrics).length > 0 && (
                <Card className="p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Period Averages — with trend vs previous {days}d
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {Object.entries(previewMetrics).map(([k, v]) => {
                      const prev = prevMetrics[k];
                      const trend: Trend = (v !== undefined && prev !== undefined)
                        ? computeTrend(v as number, prev)
                        : 'flat';
                      const improving = METRIC_IMPROVING_DIRECTION[k] ?? true;
                      return (
                        <div key={k} className="rounded px-2 py-1.5 bg-muted/30">
                          <div className="text-[10px] text-muted-foreground truncate">{labelize(k)}</div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-mono font-medium">
                              {v !== undefined && !Number.isNaN(v as any)
                                ? Math.round((v as number) * 100) / 100
                                : '—'}
                            </span>
                            <TrendIndicator trend={trend} improving={improving} />
                            {prev !== undefined && (
                              <span className="text-[10px] text-muted-foreground">
                                ({prev >= 0 ? '' : ''}{Math.round((prev as number) * 100) / 100} prev)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* NEW: Violations table with drill-down rows */}
              {result.violations.length > 0 && (
                <Card className="p-0 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left w-6"></th>
                        <th className="px-3 py-2 text-left">Severity</th>
                        <th className="px-3 py-2 text-left">Metric</th>
                        <th className="px-3 py-2 text-right">Value</th>
                        <th className="px-3 py-2 text-right">Limit</th>
                        <th className="px-3 py-2 text-left">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.violations.map((v) => {
                        const rowKey = v.code + v.metric;
                        const isExpanded = expandedViolation === rowKey;
                        const rowData = dailyRows.filter(
                          (r) => r[v.metric] !== undefined && r[v.metric] !== null
                        );
                        return (
                          <>
                            <tr
                              key={rowKey}
                              className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                              onClick={() => setExpandedViolation(isExpanded ? null : rowKey)}
                            >
                              <td className="px-3 py-2 text-muted-foreground">
                                {isExpanded
                                  ? <ChevronDown className="h-3.5 w-3.5" />
                                  : <ChevronRight className="h-3.5 w-3.5" />}
                              </td>
                              <td className="px-3 py-2"><SeverityBadge sev={v.severity} /></td>
                              <td className="px-3 py-2 font-mono text-xs">{v.metric}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{v.value ?? '—'}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {v.threshold}{' '}
                                <span className="text-muted-foreground">{v.comparator}</span>
                              </td>
                              <td className="px-3 py-2 text-xs">{v.message}</td>
                            </tr>
                            {/* NEW: Drill-down sparkline row */}
                            {isExpanded && (
                              <tr key={rowKey + '-drill'} className="bg-muted/20 border-t border-dashed">
                                <td colSpan={6} className="px-5 py-3">
                                  <div className="text-[11px] font-medium text-muted-foreground mb-1">
                                    Daily breakdown — <span className="font-mono">{v.metric}</span>
                                    <span className="ml-2 text-rose-500">
                                      Red dots = threshold breached
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
                                      No daily data available for this metric.
                                    </p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* -------- Thresholds editor -------- */}
        <TabsContent value="thresholds" className="mt-3">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium">
                  Editing:{' '}
                  {thresholdScope === 'global'
                    ? 'Global defaults'
                    : (plants ?? []).find((p) => p.id === plantId)?.name ?? thresholdScope}
                </div>
                <div className="text-xs text-muted-foreground">
                  Plant-scoped thresholds override global when a plant is selected.
                </div>
              </div>
              <div className="flex gap-2">
                {!editing ? (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
                ) : (
                  <>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => { setEditing(false); if (thData) setLocal(thData.thresholds); }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" disabled={saving} onClick={saveThresholds}>
                      {saving
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        : <Save className="h-3.5 w-3.5 mr-1" />}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(local ? Object.entries(local) : []).map(([k, v]) => (
                <div key={k}>
                  <Label className="text-xs">{labelize(k)}</Label>
                  <Input
                    type="number"
                    value={String(v)}
                    disabled={!editing}
                    onChange={(e) =>
                      setLocal((l) =>
                        l ? ({ ...l, [k]: parseFloat(e.target.value) || 0 }) as Thresholds : l,
                      )
                    }
                    className="mt-1 font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* -------- What-if / Manual metric override -------- */}
        <TabsContent value="override" className="mt-3 space-y-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">What-if Mode</span>
              <Badge variant="outline" className="text-[10px] ml-auto border-amber-300 text-amber-700 bg-amber-50">
                Live preview
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              Tweak metric values below and watch violations update in real time — without
              committing to an evaluation. Leave a field blank to use the fetched value.
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                'nrw_pct', 'downtime_hrs', 'permeate_tds', 'permeate_ph',
                'raw_turbidity', 'dp_psi', 'recovery_pct', 'pv_ratio',
              ].map((k) => {
                const fetched = previewMetrics?.[k];
                return (
                  <div key={k}>
                    <Label className="text-xs">{labelize(k)}</Label>
                    {fetched !== undefined && overrideMetrics[k] === undefined && (
                      <div className="text-[10px] text-muted-foreground">
                        Fetched: {Math.round((fetched as number) * 100) / 100}
                      </div>
                    )}
                    <Input
                      type="number" step="0.01"
                      placeholder={fetched !== undefined ? String(Math.round((fetched as number) * 100) / 100) : '—'}
                      className="mt-1 font-mono text-xs"
                      value={overrideMetrics[k] ?? ''}
                      onChange={(e) =>
                        setOverrideMetrics((m) => ({ ...m, [k]: e.target.value }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant="ghost" size="sm"
                className="text-xs"
                onClick={() => { setOverrideMetrics({}); setWhatIfViolations(null); }}
              >
                Clear all overrides
              </Button>
            </div>
          </Card>

          {/* What-if violations live preview */}
          {whatIfViolations !== null && (
            <Card className={cn(
              'p-3 border-l-4',
              whatIfViolations.length === 0
                ? 'border-emerald-500 bg-emerald-50/50'
                : whatIfViolations.some((v) => v.severity === 'high')
                  ? 'border-rose-500 bg-rose-50/50'
                  : 'border-amber-500 bg-amber-50/50',
            )}>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-semibold">
                  What-if Result — Score: {computeComplianceScore(whatIfViolations)}/100
                </span>
                {whatIfViolations.length === 0
                  ? <Badge className="text-[10px] bg-emerald-600 ml-auto">No violations</Badge>
                  : <Badge className="text-[10px] bg-rose-600 ml-auto">{whatIfViolations.length} violation{whatIfViolations.length > 1 ? 's' : ''}</Badge>}
              </div>
              {whatIfViolations.length > 0 && (
                <div className="space-y-1">
                  {whatIfViolations.map((v) => (
                    <div key={v.code} className="flex items-center gap-2 text-xs">
                      <SeverityBadge sev={v.severity} />
                      <span className="font-mono text-muted-foreground">{v.metric}</span>
                      <span className="font-semibold">{v.value}</span>
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
    high:   'bg-rose-100 text-rose-700 border-rose-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low:    'bg-sky-100 text-sky-700 border-sky-200',
  };
  return (
    <Badge variant="outline" className={cn('capitalize font-normal', m[sev] ?? '')}>
      {sev}
    </Badge>
  );
}

function labelize(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
