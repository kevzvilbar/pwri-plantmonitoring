import { useEffect, useState, useCallback } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, Loader2, RefreshCcw,
  Save, Settings2,
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
// (primary: Supabase compliance_thresholds; fallback: localStorage)
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
// Deterministic violation-check engine — runs 100 % in the browser
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

/**
 * Pure function: given a metrics map and thresholds, returns a Violation array.
 * No network calls. No side-effects.
 */
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

  // Sort: high → medium → low
  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  violations.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

  return violations;
}

// -----------------------------------------------------------------------
// Deterministic summary — no AI required
// -----------------------------------------------------------------------

function buildSummary(violations: Violation[]): { headline: string; details: string[] } {
  if (violations.length === 0) {
    return {
      headline: 'All compliance checks passed for this period.',
      details: [],
    };
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
// Metric aggregation from Supabase (unchanged)
// -----------------------------------------------------------------------

export async function fetchPlantMetrics(plantId: string, days = 7): Promise<Record<string, any>> {
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

  const rows = (data ?? []) as any[];
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

/**
 * Loads thresholds for a given scope.
 * Priority: Supabase row → localStorage snapshot → hardcoded defaults.
 */
async function loadThresholds(scope: string): Promise<Thresholds> {
  try {
    const { data, error } = await supabase
      .from('compliance_thresholds')
      .select('thresholds')
      .eq('scope', scope)
      .maybeSingle();

    if (!error && data?.thresholds) {
      // Keep localStorage in sync so the fallback stays fresh
      lsSaveThresholds(scope, data.thresholds as Thresholds);
      return data.thresholds as Thresholds;
    }
  } catch {
    // Supabase unavailable — fall through
  }

  // localStorage fallback
  const cached = lsLoadThresholds(scope);
  if (cached) return cached;

  // Ultimate fallback — use defaults
  return { ...DEFAULT_THRESHOLDS };
}

/**
 * Persists thresholds for a given scope.
 * Tries Supabase upsert first; always writes localStorage as backup.
 */
async function persistThresholds(scope: string, thresholds: Thresholds): Promise<void> {
  lsSaveThresholds(scope, thresholds);

  const { error } = await supabase
    .from('compliance_thresholds')
    .upsert({ scope, thresholds, updated_at: new Date().toISOString() }, { onConflict: 'scope' });

  if (error) {
    // Not fatal — localStorage already has the data
    console.warn('[Compliance] Supabase upsert failed, thresholds stored in localStorage only:', error.message);
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

  useEffect(() => {
    if (selectedPlantId) { setPlantId(selectedPlantId); setScope('plant'); }
  }, [selectedPlantId]);

  // ---- Thresholds — loaded entirely from Supabase / localStorage ----
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

  // ---- Evaluate — 100 % frontend, no backend call ----
  const runEvaluate = useCallback(async () => {
    setEvaluating(true);
    setResult(null);
    try {
      const scope_label =
        scope === 'plant'
          ? (plants ?? []).find((p) => p.id === plantId)?.name
          : 'All plants';

      // 1. Fetch raw metrics from Supabase
      let metrics: Record<string, any> = {};
      if (scope === 'plant' && plantId && plantId !== 'global') {
        metrics = await fetchPlantMetrics(plantId, days);
      }

      // 2. Apply manual overrides
      for (const [k, v] of Object.entries(overrideMetrics)) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) metrics[k] = n;
      }

      // 3. Load thresholds (Supabase → localStorage → defaults)
      const thresholds = await loadThresholds(thresholdScope);

      // 4. Run violation checks entirely in the browser
      const violations = computeViolations(metrics, thresholds);

      // 5. Build result — same shape the old API used to return
      const evalResult: EvalResult = {
        scope:        thresholdScope,
        scope_label,
        evaluated_at: new Date().toISOString(),
        violations,
        thresholds,
      };

      setResult(evalResult);
      setLocal(thresholds); // keep threshold editor in sync
    } catch (e: any) {
      toast.error(`Evaluation failed: ${e.message}`);
    } finally {
      setEvaluating(false);
    }
  }, [plantId, scope, days, plants, overrideMetrics, thresholdScope]);

  // ---- Save thresholds — write to Supabase (+ localStorage fallback) ----
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

  // ---- Derived summary ----
  const summary = result ? buildSummary(result.violations) : null;

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

      <Tabs value={complianceTab} onValueChange={(v) => setComplianceTab(v as typeof complianceTab)}>
        <TabsList>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="thresholds">
            <Settings2 className="h-3.5 w-3.5 mr-1" />Thresholds
          </TabsTrigger>
          <TabsTrigger value="override">Manual metrics</TabsTrigger>
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
              {/* Status banner */}
              <Card className={cn(
                'p-3 border-l-4',
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

              {/* Violations table */}
              {result.violations.length > 0 && (
                <Card className="p-0 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Severity</th>
                        <th className="px-3 py-2 text-left">Metric</th>
                        <th className="px-3 py-2 text-right">Value</th>
                        <th className="px-3 py-2 text-right">Limit</th>
                        <th className="px-3 py-2 text-left">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.violations.map((v) => (
                        <tr key={v.code + v.metric} className="border-t">
                          <td className="px-3 py-2"><SeverityBadge sev={v.severity} /></td>
                          <td className="px-3 py-2 font-mono-num">{v.metric}</td>
                          <td className="px-3 py-2 text-right font-mono-num">{v.value ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-mono-num">
                            {v.threshold}{' '}
                            <span className="text-muted-foreground">{v.comparator}</span>
                          </td>
                          <td className="px-3 py-2">{v.message}</td>
                        </tr>
                      ))}
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
                    className="mt-1 font-mono-num"
                  />
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* -------- Manual metric override -------- */}
        <TabsContent value="override" className="mt-3">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground mb-2">
              Leave blank to use fetched values from Supabase. Overrides apply to the next
              evaluation only.
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                'nrw_pct', 'downtime_hrs', 'permeate_tds', 'permeate_ph',
                'raw_turbidity', 'dp_psi', 'recovery_pct', 'pv_ratio',
              ].map((k) => (
                <div key={k}>
                  <Label className="text-xs">{labelize(k)}</Label>
                  <Input
                    type="number" step="0.01"
                    className="mt-1 font-mono-num"
                    value={overrideMetrics[k] ?? ''}
                    onChange={(e) =>
                      setOverrideMetrics((m) => ({ ...m, [k]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
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
