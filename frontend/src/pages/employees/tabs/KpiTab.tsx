import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { FileDown, RefreshCw, Building2, User, Info } from 'lucide-react';
import { PLANT_COLUMN_ACCENTS } from '../types';

import React, { useState, useMemo } from 'react';
import { LayoutGrid, List, ChevronLeft, ChevronRight, Award, Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import { StaffMember, avatarColor, initials, fullName, ReadingRecord, ChecklistExecution } from '../types';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { fmtIsoDate } from '@/lib/format';

type KpiRange2 = 'today' | 7 | 14 | 30 | 90 | 365;
type KpiViewMode = 'team' | 'individual';

// ── Appraisal Rating System (for Annual & Quarterly Performance Reviews) ──
export type AppraisalTier = {
  tier: string;
  badge: string;
  dot: string;
  icon: string;
  minScore: number;
  description: string;
};

export const APPRAISAL_TIERS: AppraisalTier[] = [
  { tier: 'Outstanding', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-500', icon: '🏆', minScore: 90, description: 'Exemplary operational logging compliance' },
  { tier: 'Exceeds Expectations', badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40', dot: 'bg-teal-500', icon: '⭐', minScore: 80, description: 'Consistently surpasses standard logging targets' },
  { tier: 'Meets Target', badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40', dot: 'bg-sky-500', icon: '✓', minScore: 70, description: 'Meets operational logging expectations' },
  { tier: 'Needs Improvement', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40', dot: 'bg-amber-500', icon: '⚠️', minScore: 50, description: 'Below standard compliance targets' },
  { tier: 'Unsatisfactory', badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40', dot: 'bg-rose-500', icon: '❌', minScore: 0, description: 'Critical gaps in operational logs' },
];

export function getAppraisalTier(scorePct: number): AppraisalTier {
  for (const t of APPRAISAL_TIERS) {
    if (scorePct >= t.minScore) return t;
  }
  return APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1];
}

// Each input type column definition — same 7-category taxonomy as the
// app's kpi-* dashboard tokens (Wells/Locator/RO/Meter/Solar/Grid/Chem),
// classified into shared facility duties and individual shift duties.
export const INPUT_COLS = [
  { key: 'wells',         label: 'Wells',       full: 'Wells Reading',    color: 'hsl(var(--kpi-wells))',   type: 'shared' },
  { key: 'locator',       label: 'Locator',     full: 'Locator Reading',  color: 'hsl(var(--kpi-locator))', type: 'shared' },
  { key: 'ro_train',      label: 'RO Train',    full: 'RO Train (hourly)',color: 'hsl(var(--kpi-ro))',      type: 'individual' },
  { key: 'product_meter', label: 'Prod. Meter', full: 'Product Meter',    color: 'hsl(var(--kpi-meter))',   type: 'shared' },
  { key: 'solar',         label: 'Solar',       full: 'Solar Reading',    color: 'hsl(var(--kpi-solar))',   type: 'shared' },
  { key: 'grid',          label: 'Grid',        full: 'Grid Reading',     color: 'hsl(var(--kpi-grid))',    type: 'shared' },
  { key: 'chemicals',     label: 'Chemicals',   full: 'Chemical Dosing',  color: 'hsl(var(--kpi-chem))',    type: 'shared' },
] as const;

export type InputColKey = typeof INPUT_COLS[number]['key'];

// Compliance 0–1 (null = N/A for this plant/type combination)
export type DayScore2 = number | null;
export type ScoreMap2 = Record<string, DayScore2>;                       // dayStr → score
export type EntityTypeScore = Partial<Record<InputColKey, ScoreMap2>>;   // inputKey → ScoreMap
export type ScoreMatrix = Record<string, EntityTypeScore>;               // key → scores

export const SHARED_COLS: InputColKey[] = ['wells', 'locator', 'product_meter', 'solar', 'grid', 'chemicals'];

// Computes overall weighted KPI score:
// 60% Individual (RO Train diligence) + 40% Shared (average of the 6 facility-shared categories).
// - If both exist: 0.6 * roAvg + 0.4 * sharedAvg
// - If only one exists: 100% weight on whichever exists (e.g. facility with 0 RO trains)
// - If both null: returns N/A (totalValid: 0, scorePct: 0) to be excluded from rollups
export function computeEntityOverallScore(ts: EntityTypeScore, days: string[], todayStr: string): {
  scorePct: number;
  totalValid: number;
  totalComplete: number;
  tier: AppraisalTier;
  sharedAvg: number | null;
  roAvg: number | null;
} {
  const catAvgs: number[] = [];
  let totalComplete = 0;
  let totalValid = 0;

  for (const colKey of SHARED_COLS) {
    const dayMap = ts[colKey];
    if (!dayMap) continue;
    const validVals: number[] = [];
    for (const day of days) {
      const s = dayMap[day];
      if (typeof s === 'number') {
        totalValid++;
        const val = Math.min(1, Math.max(0, s));
        validVals.push(val);
        if (val >= 1.0) totalComplete++;
      }
    }
    if (validVals.length > 0) {
      catAvgs.push(validVals.reduce((a, b) => a + b, 0) / validVals.length);
    }
  }

  const roDayMap = ts.ro_train;
  const roVals: number[] = [];
  if (roDayMap) {
    for (const day of days) {
      const s = roDayMap[day];
      if (typeof s === 'number') {
        totalValid++;
        const val = Math.min(1, Math.max(0, s));
        roVals.push(val);
        if (val >= 1.0) totalComplete++;
      }
    }
  }

  const sharedAvg = catAvgs.length > 0 ? catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length : null;
  const roAvg = roVals.length > 0 ? roVals.reduce((a, b) => a + b, 0) / roVals.length : null;

  let finalScore: number | null = null;
  if (roAvg !== null && sharedAvg !== null) {
    finalScore = 0.6 * roAvg + 0.4 * sharedAvg;
  } else if (roAvg !== null) {
    finalScore = roAvg;
  } else if (sharedAvg !== null) {
    finalScore = sharedAvg;
  }

  const scorePct = finalScore !== null ? Math.round(finalScore * 100) : 0;
  return {
    scorePct,
    totalValid,
    totalComplete,
    tier: getAppraisalTier(scorePct),
    sharedAvg,
    roAvg,
  };
}

// Plant-level target: 24 readings/train/day (full 3 shifts)
const DEFAULT_RO_HOURLY_TARGET = 24;
// Individual operator shift target: ~8 readings/train per 8-hour shift
const DEFAULT_RO_OPERATOR_SHIFT_TARGET = 8;

function roTargetForPlant(plant: { ro_hourly_target?: number | string | null } | null | undefined): number {
  const v = Number(plant?.ro_hourly_target);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RO_HOURLY_TARGET;
}

const KPI_STATUS = {
  complete: { color: 'hsl(var(--reading-status-complete))', label: 'Complete' },
  partial:  { color: 'hsl(var(--reading-status-partial))',  label: 'Partial'  },
  minimal:  { color: 'hsl(var(--reading-status-minimal))',  label: 'Minimal'  },
  missed:   { color: 'hsl(var(--reading-status-missed))',   label: 'Missed'   },
  pending:  { color: 'hsl(var(--reading-status-pending))',  label: 'Pending (today)' },
  na:       { color: 'hsl(var(--reading-status-na))',       label: 'N/A'      },
} as const;

// A cell for the CURRENT day with a score of exactly 0 reads as "Pending",
// not "Missed" — the day isn't over yet, so we genuinely can't call it a
// miss. Past days keep the original complete/partial/minimal/missed logic.
function scoreStatus(s: DayScore2, isToday = false): keyof typeof KPI_STATUS {
  if (s === null) return 'na';
  if (isToday && s === 0) return 'pending';
  if (s >= 1.0)  return 'complete';
  if (s >= 0.5)  return 'partial';
  if (s > 0)     return 'minimal';
  return 'missed';
}
function scoreColor(s: DayScore2, isToday = false) { return KPI_STATUS[scoreStatus(s, isToday)].color; }

function generateDays2(range: KpiRange2): string[] {
  if (range === 'today') {
    return [fmtIsoDate(new Date())];
  }
  const count = typeof range === 'number' ? range : 30;
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(fmtIsoDate(d));
  }
  return days;
}

// ── Mini heatmap cell ────────────────────────────────────────────────────────

function MiniHeatmap({ scores, days, label, todayStr, onHover }: {
  scores: ScoreMap2;
  days: string[];
  label: string;
  todayStr: string;
  onHover: (text: string | null, e?: React.MouseEvent) => void;
}) {
  const isSingleDay = days.length === 1;

  if (isSingleDay) {
    const day = days[0];
    const raw = scores[day];
    const score: DayScore2 = raw === undefined ? null : raw;
    const isToday = day === todayStr;
    const status = scoreStatus(score, isToday);
    const pct = score === null ? null : Math.round((score as number) * 100);
    const color = scoreColor(score, isToday);

    return (
      <div className="flex items-center justify-center py-1">
        <div
          className="flex items-center justify-center rounded-md font-bold text-2xs text-white cursor-default select-none transition-transform hover:scale-105"
          style={{ background: color, width: 44, height: 22, opacity: status === 'na' ? 0.5 : 1 }}
          onMouseEnter={(e) => onHover(
            status === 'na' ? `${label}\nOff duty / Not applicable`
              : status === 'pending' ? `${label} — ${day}\n⏳ Pending — day in progress`
              : `${label} — ${day}\n${pct === 100 ? '✓ Complete' : pct === 0 ? '✗ Missed' : pct + '% done'}`,
            e
          )}
          onMouseLeave={() => onHover(null)}
        >
          {status === 'na' ? '—' : status === 'pending' ? '…' : pct === 100 ? '✓' : pct === 0 ? '✗' : `${pct}%`}
        </div>
      </div>
    );
  }

  const sqSize = days.length <= 7 ? 14 : days.length <= 14 ? 10 : 8;

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1.5">
      {days.map((day) => {
        const raw = scores[day];
        const score: DayScore2 = raw === undefined ? null : raw;
        const isToday = day === todayStr;
        const status = scoreStatus(score, isToday);
        const pct = score === null ? null : Math.round((score as number) * 100);
        const tooltipText = `${label} — ${day}\n${status === 'na' ? 'Off duty / N/A' : status === 'pending' ? 'Pending — day in progress' : pct + '% complete'}`;
        return (
          <div
            key={day}
            style={{ width: sqSize, height: sqSize, background: scoreColor(score, isToday), borderRadius: 2, flexShrink: 0, opacity: status === 'na' ? 0.25 : 0.88 }}
            onMouseEnter={(e) => onHover(tooltipText, e)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => onHover(tooltipText, e)}
            className="cursor-pointer transition-transform hover:scale-125"
          />
        );
      })}
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function KpiLegend2() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-2xs text-muted-foreground font-semibold">Legend:</span>
      {Object.entries(KPI_STATUS).map(([key, cfg]) => (
        <div key={key} className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm" style={{ background: cfg.color }} />
          <span className="text-2xs text-muted-foreground">{cfg.label}</span>
        </div>
      ))}
      <span className="text-muted-foreground/40 hidden sm:inline">·</span>
      <span className="text-2xs text-muted-foreground">
        Individual weighting: <strong className="text-foreground">60% RO Train</strong> (~8/shift) + <strong className="text-foreground">40% Shared Duties</strong> (facility compliance on active shift days)
      </span>
    </div>
  );
}

function KpiTab({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState<KpiRange2>('today');
  const [viewMode, setViewMode] = useState<KpiViewMode>(
    () => (searchParams.get('view') === 'individual' ? 'individual' : 'team'),
  );
  // Deep-link support: /employees?tab=kpi&view=individual&plant=<id> lands
  // straight on that plant's operator breakdown, pre-expanded — used by the
  // Data Completeness Radar's "see who's logging" link on the Dashboard.
  const [expandedPlants, setExpandedPlants] = useState<Set<string>>(() => {
    const plantId = searchParams.get('plant');
    return plantId ? new Set([plantId]) : new Set();
  });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const days = useMemo(() => generateDays2(range), [range, refreshKey]);
  // days[0] is a Manila calendar date (e.g. "2026-08-15"); Manila midnight of
  // that date is 16:00 UTC the *previous* UTC day (Asia/Manila = UTC+8), so
  // anchor the query with an explicit +08:00 offset rather than 'Z' — using
  // 'Z' here would silently drop the first 8 hours of that Manila day.
  const since = useMemo(() => days[0] + 'T00:00:00+08:00', [days]);
  // Every reading is now bucketed into an Asia/Manila calendar day (see
  // fmtIsoDate usage below and in EntityHistoryChart.tsx), so "today" and
  // the elapsed-hours proration here use Manila time too, to match those
  // buckets. These have to stay in sync with the bucketing logic below ��
  // not just here.
  // Cheap to compute, so no useMemo — they naturally refresh on every
  // render (including a manual "Refresh" click) without needing a
  // refreshKey-only dependency array.
  const todayStr = fmtIsoDate(new Date());
  const now = new Date();
  const nowManila = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const elapsedFraction = Math.min(1, Math.max(0, (nowManila.getHours() + nowManila.getMinutes() / 60) / 24));

  // ── Operators only ─────────────────────────────────────────────────────────
  const operators = useMemo(() => {
    const opIds = new Set(
      (roles as any[]).filter((r) => r.role === 'Operator').map((r) => r.user_id)
    );
    return staff.filter((s) => opIds.has(s.id) && s.status === 'Active');
  }, [staff, roles]);

  const plantsWithOps = useMemo(() =>
    plants.filter((p) => operators.some((op) => op.plant_assignments?.includes(p.id))),
    [plants, operators]
  );

  const plantFlags = useMemo(() => {
    const m: Record<string, { has_solar: boolean; has_grid: boolean }> = {};
    plants.forEach((p) => {
      m[p.id] = { has_solar: (p as any).has_solar ?? false, has_grid: (p as any).has_grid ?? true };
    });
    return m;
  }, [plants]);

  const plantById = useMemo(() => {
    const m: Record<string, { ro_hourly_target?: number | string | null }> = {};
    plants.forEach((p) => { m[p.id] = p; });
    return m;
  }, [plants]);

  // ── Plant config queries ───────────────────────────────────────────────────
  // Wells & Product Meters now match the filtering already used for
  // Locators/RO Trains below: decommissioned/inactive assets are excluded
  // from the denominator, so a plant with retired equipment can still reach
  // 100% instead of being capped below it forever.

  const { data: wellsCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-wells'],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: locatorsCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-locators'],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: trainsCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-trains'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ro_trains').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: metersCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-meters'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('product_meters').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const wellsPerPlant    = useMemo(() => { const m: Record<string,number> = {}; wellsCfg.filter(w => w.status === 'Active').forEach(w => { m[w.plant_id] = (m[w.plant_id] ?? 0) + 1; }); return m; }, [wellsCfg]);
  const locatorsPerPlant = useMemo(() => { const m: Record<string,number> = {}; locatorsCfg.filter(l => l.status === 'Active').forEach(l => { m[l.plant_id] = (m[l.plant_id] ?? 0) + 1; }); return m; }, [locatorsCfg]);
  const trainsPerPlant   = useMemo(() => { const m: Record<string,string[]> = {}; trainsCfg.filter(t => t.status !== 'Offline').forEach(t => { (m[t.plant_id] = m[t.plant_id] ?? []).push(t.id); }); return m; }, [trainsCfg]);
  const metersPerPlant   = useMemo(() => { const m: Record<string,number> = {}; metersCfg.filter(x => x.status === 'Active').forEach(x => { m[x.plant_id] = (m[x.plant_id] ?? 0) + 1; }); return m; }, [metersCfg]);

  // ── Reading queries ────────────────────────────────────────────────────────

  const { data: wellReadings = [], isLoading: l1, error: e1, refetch: r1 } = useQuery({
    queryKey: ['kpi-r-wells', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('well_readings')
        .select('plant_id, well_id, reading_datetime, recorded_by, is_estimated').gte('reading_datetime', since);
      return ((data ?? []) as any[])
        .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; well_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: locReadings = [], isLoading: l2, error: e2, refetch: r2 } = useQuery({
    queryKey: ['kpi-r-loc', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('locator_readings')
        .select('plant_id, locator_id, reading_datetime, recorded_by, is_estimated').gte('reading_datetime', since);
      return ((data ?? []) as any[])
        .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; locator_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: roReadings = [], isLoading: l3, error: e3, refetch: r3 } = useQuery({
    queryKey: ['kpi-r-ro', since, refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ro_train_readings')
        .select('plant_id, train_id, reading_datetime, recorded_by, is_estimated').gte('reading_datetime', since);
      return ((data ?? []) as any[])
        .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; train_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: meterReadings = [], isLoading: l4, error: e4, refetch: r4 } = useQuery({
    queryKey: ['kpi-r-meter', since, refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any).from('product_meter_readings')
        .select('plant_id, meter_id, reading_datetime, recorded_by, is_estimated').gte('reading_datetime', since);
      return ((data ?? []) as any[])
        .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; meter_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: powerReadings = [], isLoading: l5, error: e5, refetch: r5 } = useQuery({
    queryKey: ['kpi-r-power', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('power_readings')
        .select('plant_id, reading_datetime, recorded_by, daily_solar_kwh, daily_grid_kwh, is_estimated')
        .gte('reading_datetime', since);
      return ((data ?? []) as any[])
        .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; reading_datetime: string; recorded_by: string | null; daily_solar_kwh: number | null; daily_grid_kwh: number | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: chemReadings = [], isLoading: l6, error: e6, refetch: r6 } = useQuery({
    queryKey: ['kpi-r-chem', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('chemical_dosing_logs')
        .select('plant_id, log_datetime, recorded_by').gte('log_datetime', since);
      return ((data ?? []) as any[])
        .filter(r => r.recorded_by != null) as { plant_id: string; log_datetime: string; recorded_by: string }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: blendingReadings = [], isLoading: l7, error: e7, refetch: r7 } = useQuery({
    queryKey: ['kpi-r-blending', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('blending_events')
        .select('plant_id, well_id, event_date, recorded_by, is_estimated')
        .gte('event_date', since.slice(0, 10));
      return ((data ?? []) as any[])
        .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; well_id: string; event_date: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const isLoading = l1 || l2 || l3 || l4 || l5 || l6 || l7;
  const kpiError = e1 || e2 || e3 || e4 || e5 || e6 || e7;
  const retryKpiQueries = () => { r1(); r2(); r3(); r4(); r5(); r6(); r7(); };

  // ── Matrices ────────────────────────────────────────────────────────────────
  // Built in a single pass over each reading array: `individual` keeps the
  // v2 per-operator behaviour (now with status-filtered denominators plus
  // today-pending/RO-proration) and `teamCoverage` is new — attribution-
  // agnostic, so telemetry/system rows with no recorded_by still count
  // toward "was this asset read today" instead of being silently dropped.

  const { individual, teamCoverage } = useMemo(() => {
    const indiv: ScoreMatrix = {};
    const team: ScoreMatrix = {};
    const daySet = new Set(days);

    // Track active days per operator at plant: `${opId}:${plantId}:${day}` (Attendance proxy)
    const opDutySet = new Set<string>();

    // op:plant:day:train -> count (individual RO train readings)
    const roMap: Record<string, number> = {};

    // plant:day → Set/count   (team coverage — attribution-agnostic)
    const twellMap:  Record<string, Set<string>> = {};
    const tlocMap:   Record<string, Set<string>> = {};
    const troMap:    Record<string, number>       = {};
    const tmeterMap: Record<string, Set<string>> = {};
    const tsolarMap: Record<string, number>       = {};
    const tgridMap:  Record<string, number>       = {};
    const tchemMap:  Record<string, number>       = {};

    wellReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (twellMap[tk] = twellMap[tk] ?? new Set()).add(r.well_id);
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      }
    });

    locReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (tlocMap[tk] = tlocMap[tk] ?? new Set()).add(r.locator_id);
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      }
    });

    roReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}:${r.train_id}`;
      troMap[tk] = (troMap[tk] ?? 0) + 1;
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
        const k = `${r.recorded_by}:${r.plant_id}:${day}:${r.train_id}`;
        roMap[k] = (roMap[k] ?? 0) + 1;
      }
    });

    meterReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (tmeterMap[tk] = tmeterMap[tk] ?? new Set()).add(r.meter_id);
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      }
    });

    powerReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      if (r.daily_solar_kwh !== null) tsolarMap[tk] = (tsolarMap[tk] ?? 0) + 1;
      if (r.daily_grid_kwh  !== null) tgridMap[tk]  = (tgridMap[tk]  ?? 0) + 1;
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      }
    });

    chemReadings.forEach((r) => {
      const day = r.log_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      tchemMap[tk] = (tchemMap[tk] ?? 0) + 1;
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      }
    });

    blendingReadings.forEach((r) => {
      const day = r.event_date;
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (twellMap[tk] = twellMap[tk] ?? new Set()).add(r.well_id);
      if (r.recorded_by) {
        opDutySet.add(`${r.recorded_by}:${r.plant_id}:${day}`);
      }
    });

    // ── Team coverage: one entry per plant ──
    plantsWithOps.forEach((plant) => {
      const plantId = plant.id;
      const numWells  = wellsPerPlant[plantId]    ?? 0;
      const numLocs   = locatorsPerPlant[plantId] ?? 0;
      const trainIds  = trainsPerPlant[plantId]   ?? [];
      const numMeters = metersPerPlant[plantId]   ?? 0;
      const hasSolar  = plantFlags[plantId]?.has_solar ?? false;
      const hasGrid   = plantFlags[plantId]?.has_grid  ?? true;
      const roTarget  = roTargetForPlant(plant);

      const ts: EntityTypeScore = { wells: {}, locator: {}, ro_train: {}, product_meter: {}, solar: {}, grid: {}, chemicals: {} };

      days.forEach((day) => {
        const isToday = day === todayStr;
        const tk = `${plantId}:${day}`;

        ts.wells![day]   = numWells  === 0 ? null : Math.min(1, (twellMap[tk]?.size  ?? 0) / numWells);
        ts.locator![day] = numLocs   === 0 ? null : Math.min(1, (tlocMap[tk]?.size   ?? 0) / numLocs);

        if (trainIds.length === 0) {
          ts.ro_train![day] = null;
        } else {
          const target = isToday ? Math.max(1, Math.ceil(roTarget * elapsedFraction)) : roTarget;
          const perTrain = trainIds.map((tid) => Math.min(1, (troMap[`${tk}:${tid}`] ?? 0) / target));
          ts.ro_train![day] = perTrain.reduce((a, b) => a + b, 0) / perTrain.length;
        }

        ts.product_meter![day] = numMeters === 0 ? null : Math.min(1, (tmeterMap[tk]?.size ?? 0) / numMeters);
        ts.solar![day] = !hasSolar ? null : (tsolarMap[tk] ?? 0) >= 1 ? 1 : 0;
        ts.grid![day]  = !hasGrid  ? null : (tgridMap[tk]  ?? 0) >= 1 ? 1 : 0;
        ts.chemicals![day] = (tchemMap[tk] ?? 0) >= 1 ? 1 : 0;
      });

      team[plantId] = ts;
    });

    // ── Individual activity: one entry per operator × plant ──
    // Phase 1 Redesign:
    // 1. Shared categories (wells, locator, product_meter, solar, grid, chemicals)
    //    inherit team coverage for that plant on days the operator was on duty.
    // 2. Individual category (ro_train) measures the operator's own diligence
    //    against an 8-reading shift target.
    // 3. Attendance proxy: on days with no recorded activity by this operator at
    //    this plant, all categories are null (excluded from denominator / off-duty),
    //    preventing rest days from dragging down appraisal KPI.
    operators.forEach((op) => {
      (op.plant_assignments ?? []).forEach((plantId) => {
        const matKey = `${op.id}:${plantId}`;
        const trainIds  = trainsPerPlant[plantId]   ?? [];
        const plantTeam = team[plantId];

        const ts: EntityTypeScore = {
          wells: {}, locator: {}, ro_train: {}, product_meter: {}, solar: {}, grid: {}, chemicals: {},
        };

        days.forEach((day) => {
          const isToday = day === todayStr;
          const dutyKey = `${op.id}:${plantId}:${day}`;
          const isOnDuty = opDutySet.has(dutyKey);

          if (!isOnDuty) {
            // Off-duty / rest day: exclude from denominators
            SHARED_COLS.forEach((col) => {
              ts[col]![day] = null;
            });
            ts.ro_train![day] = null;
            return;
          }

          // Operator was on duty: credit plant-wide shared monitoring
          SHARED_COLS.forEach((col) => {
            ts[col]![day] = plantTeam?.[col]?.[day] ?? null;
          });

          // RO Train: measure personal diligence against shift target (8 readings/shift)
          if (trainIds.length === 0) {
            ts.ro_train![day] = null;
          } else {
            const shiftTarget = isToday
              ? Math.max(1, Math.ceil(DEFAULT_RO_OPERATOR_SHIFT_TARGET * elapsedFraction))
              : DEFAULT_RO_OPERATOR_SHIFT_TARGET;
            const perTrain = trainIds.map((tid) => {
              const count = roMap[`${dutyKey}:${tid}`] ?? 0;
              return Math.min(1, count / shiftTarget);
            });
            ts.ro_train![day] = perTrain.reduce((a, b) => a + b, 0) / perTrain.length;
          }
        });

        indiv[matKey] = ts;
      });
    });

    return { individual: indiv, teamCoverage: team };
  }, [operators, plantsWithOps, days, todayStr, elapsedFraction, wellsPerPlant, locatorsPerPlant, trainsPerPlant, metersPerPlant, plantFlags, plantById,
      wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings]);

  const activeMatrix = viewMode === 'team' ? teamCoverage : individual;

  // ── Summary ────────────────────────────────────────────────────────────────
  // "Pending" cells (today, score 0) count toward neither complete nor
  // missed — the day isn't over, so it's genuinely unknown yet — but are
  // reported separately so they're not just invisible.

  const summary = useMemo(() => {
    let total = 0, complete = 0, missed = 0, pending = 0;
    Object.values(activeMatrix).forEach((ts) =>
      Object.values(ts).forEach((dm) =>
        Object.entries(dm as ScoreMap2).forEach(([day, s]) => {
          if (s === null) return;
          const isToday = day === todayStr;
          if (isToday && s === 0) { pending++; return; }
          total++;
          if ((s as number) >= 1) complete++;
          if ((s as number) === 0) missed++;
        })
      )
    );
    return { pct: total > 0 ? Math.round((complete / total) * 100) : 0, complete, total, missed, pending };
  }, [activeMatrix, todayStr]);

  const togglePlant = useCallback((id: string) => {
    setExpandedPlants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onHover = useCallback((text: string | null, e?: React.MouseEvent) => {
    setTooltip(text && e ? { x: e.clientX, y: e.clientY, text } : null);
  }, []);

  const RANGES: { label: string; value: KpiRange2 }[] = [
    { label: 'Today', value: 'today' },
    { label: '7D',    value: 7 },
    { label: '14D',   value: 14 },
    { label: '30D',   value: 30 },
    { label: '90D (Qtr)', value: 90 },
    { label: 'Annual (YTD)', value: 365 },
  ];

  // Appraisal CSV export generator for HR / Annual Review
  const exportAppraisalCsv = () => {
    const headers = [
      'Operator Name', 'Username', 'Plant',
      'Wells %', 'Locator %', 'RO Train %', 'Prod Meter %', 'Solar %', 'Grid %', 'Chemicals %',
      'Overall KPI Score %', 'Appraisal Rating Tier', 'Period Range',
    ];
    const rows: string[][] = [];

    plantsWithOps.forEach((plant) => {
      const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
      plantOps.forEach((op) => {
        const matKey = `${op.id}:${plant.id}`;
        const ts = individual[matKey] ?? {};
        const overall = computeEntityOverallScore(ts, days, todayStr);

        const catScores = INPUT_COLS.map((col) => {
          const dayMap = ts[col.key] ?? {};
          const validDays = days.map((d) => dayMap[d]).filter((s): s is number => typeof s === 'number');
          if (!validDays.length) return 'N/A';
          const avg = Math.round((validDays.reduce((a, b) => a + b, 0) / validDays.length) * 100);
          return `${avg}%`;
        });

        rows.push([
          `"${fullName(op)}"`,
          `"${op.username ?? ''}"`,
          `"${plant.name}"`,
          ...catScores.map((s) => `"${s}"`),
          `"${overall.totalValid > 0 ? `${overall.scorePct}%` : 'N/A'}"`,
          `"${overall.totalValid > 0 ? overall.tier.tier : 'N/A'}"`,
          `"${range === 'today' ? 'Today' : `${range} Days`}"`,
        ]);
      });
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `operator_annual_appraisal_kpi_${range}_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Annual appraisal KPI report exported successfully.');
  };

  // Pre-calculate appraisal breakdown for summary
  const appraisalStats = useMemo(() => {
    let outstanding = 0, exceeds = 0, meets = 0, needsImp = 0, unsat = 0;
    const operatorScores: { op: StaffMember; plantName: string; scorePct: number; tier: AppraisalTier }[] = [];

    plantsWithOps.forEach((plant) => {
      const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
      plantOps.forEach((op) => {
        const matKey = `${op.id}:${plant.id}`;
        const ts = individual[matKey] ?? {};
        const overall = computeEntityOverallScore(ts, days, todayStr);
        if (overall.totalValid === 0) return; // Exclude N/A off-duty operators from rollups
        operatorScores.push({ op, plantName: plant.name, scorePct: overall.scorePct, tier: overall.tier });

        if (overall.scorePct >= 90) outstanding++;
        else if (overall.scorePct >= 80) exceeds++;
        else if (overall.scorePct >= 70) meets++;
        else if (overall.scorePct >= 50) needsImp++;
        else unsat++;
      });
    });

    const avgScore = operatorScores.length > 0
      ? Math.round(operatorScores.reduce((a, b) => a + b.scorePct, 0) / operatorScores.length)
      : 0;

    return { outstanding, exceeds, meets, needsImp, unsat, avgScore, totalEvaluated: operatorScores.length };
  }, [plantsWithOps, operators, individual, days, todayStr]);

  return (
    <div className="space-y-3.5">
      {/* ── Annual Appraisal Overview Strip ── */}
      <div className="p-3.5 rounded-xl border border-border/70 bg-card/80 backdrop-blur-sm space-y-2.5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-foreground">Operational KPI & Appraisal Index</h3>
                <span className={cn('text-3xs font-bold px-2 py-0.5 rounded-full border', getAppraisalTier(appraisalStats.avgScore).badge)}>
                  {getAppraisalTier(appraisalStats.avgScore).icon} Fleet Avg: {appraisalStats.avgScore}%
                </span>
              </div>
              <p className="text-3xs text-muted-foreground">Comprehensive weighted logging compliance for operator evaluations</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
              onClick={exportAppraisalCsv}
              title="Download full operator appraisal matrix in CSV"
            >
              <FileDown className="h-3.5 w-3.5 text-primary" />
              <span>Export Appraisal CSV</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setRefreshKey((k) => k + 1)}
              title="Refresh matrix"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Appraisal tier breakdown bar */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/40 text-2xs">
          <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Appraisal Tiers:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
            🏆 Outstanding (≥90%): {appraisalStats.outstanding}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/30 font-bold">
            ⭐ Exceeds (80-89%): {appraisalStats.exceeds}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 font-bold">
            ✓ Meets (70-79%): {appraisalStats.meets}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold">
            ⚠️ Needs Imp (&lt;70%): {appraisalStats.needsImp + appraisalStats.unsat}
          </span>
        </div>
      </div>

      {/* ── Controls (Period & View Mode) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-muted/40 border border-border/60">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Time range selector */}
          <div className="flex rounded-lg border bg-background overflow-hidden p-0.5 shadow-2xs">
            {RANGES.map(({ label, value }) => (
              <button
                key={String(value)}
                className={cn(
                  'px-2.5 py-1 text-2xs font-bold rounded-md transition-all',
                  range === value
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                onClick={() => setRange(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mode switch */}
          <div className="flex rounded-lg border bg-background overflow-hidden p-0.5 shadow-2xs">
            <button
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                viewMode === 'team'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewMode('team')}
            >
              <Building2 className="h-3.5 w-3.5" /> Team Coverage
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                viewMode === 'individual'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewMode('individual')}
            >
              <User className="h-3.5 w-3.5" /> Individual Activity
            </button>
          </div>
        </div>

        <div className="text-2xs text-muted-foreground flex items-center gap-2">
          {viewMode === 'team' ? (
            <span><strong className="text-foreground">{plantsWithOps.length}</strong> plants</span>
          ) : (
            <span><strong className="text-foreground">{operators.length}</strong> evaluated operators</span>
          )}
          <span>·</span>
          <span className={cn('font-bold', summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger')}>
            {summary.pct}% Overall Logging Rate
          </span>
        </div>
      </div>

      {/* Legend */}
      <KpiLegend2 />

      {/* Info banner */}
      <div className="flex items-start gap-2 bg-info-soft border border-info/40 rounded-xl px-3.5 py-2.5 text-xs text-info shadow-2xs">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="leading-relaxed">
          {viewMode === 'team' ? (
            <><strong>Team Coverage Lens:</strong> Verifies if each asset was logged by anyone on schedule (operator shift or automated feed). This evaluates overall plant compliance.</>
          ) : (
            <><strong>Individual Activity Lens (Annual Appraisal Metric):</strong> Evaluates individual operator performance with a <strong>60% Individual (RO Train diligence, ~8/shift) + 40% Shared Duties (facility monitoring on active shift days)</strong> weighted score. Rest days and off-duty periods are excluded via attendance proxy.</>
          )}
          {' '}Targets: Shared facility duties ≥1/day (Wells, Locators, Meters, Power, Chemicals) · RO Train ~{DEFAULT_RO_OPERATOR_SHIFT_TARGET}/shift (hourly per train).
        </span>
      </div>

      {/* ── Matrix Table with Overall Score Column ── */}
      <Card className="overflow-hidden border border-border/70 shadow-2xs">
        <DataState
          loading={isLoading}
          error={kpiError}
          isEmpty={plantsWithOps.length === 0}
          emptyTitle="No operators assigned to any plant."
          onRetry={retryKpiQueries}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              {/* Column headers */}
              <thead>
                <tr className="border-b bg-muted/60">
                  <th className="text-left px-3 py-2.5 font-bold text-xs sticky left-0 bg-muted/60 z-10 min-w-[170px]">
                    {viewMode === 'team' ? 'Plant Facility' : 'Operator / Facility'}
                  </th>
                  {/* Overall KPI Column */}
                  <th className="py-2.5 px-3 font-bold text-center bg-muted/80 border-x border-border/60 min-w-[150px]">
                    <div className="flex flex-col items-center">
                      <span className="text-2xs font-extrabold uppercase tracking-wide text-foreground">Overall KPI Score</span>
                      <span className="text-3xs text-muted-foreground font-normal">
                        {viewMode === 'individual' ? '60% Indiv · 40% Shared' : 'Facility Appraisal'}
                      </span>
                    </div>
                  </th>
                  {INPUT_COLS.map((col) => (
                    <th key={col.key} className="py-2 px-1 font-semibold text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-white text-3xs font-bold whitespace-nowrap shadow-2xs"
                          style={{ background: col.color }}
                        >
                          {col.label}
                        </span>
                        {viewMode === 'individual' && (
                          <span
                            className={cn(
                              'text-3xs font-semibold px-1 rounded',
                              col.key === 'ro_train'
                                ? 'bg-primary-soft text-primary font-bold border border-primary/30'
                                : 'text-muted-foreground'
                            )}
                          >
                            {col.key === 'ro_train' ? 'Indiv 60%' : 'Shared'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {viewMode === 'team' ? (
                  plantsWithOps.map((plant, pi) => {
                    const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                    const ts = teamCoverage[plant.id] ?? {};
                    const overall = computeEntityOverallScore(ts, days, todayStr);

                    return (
                      <tr key={`team:${plant.id}`} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 sticky left-0 z-10 bg-background"
                          style={{ borderLeft: `3px solid ${accent.line}` }}>
                          <div className="flex items-center gap-2">
                            <Building2 className={cn('h-3.5 w-3.5 shrink-0', accent.text)} />
                            <span className={cn('font-bold text-xs', accent.text)}>{plant.name}</span>
                          </div>
                        </td>

                        {/* Plant Overall Score */}
                        <td className="py-2 px-3 border-x border-border/60 bg-muted/10 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-foreground">{overall.scorePct}%</span>
                              <span className={cn('text-3xs px-1.5 py-0.2 rounded-full border font-bold', overall.tier.badge)}>
                                {overall.tier.icon} {overall.tier.tier}
                              </span>
                            </div>
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full transition-all', overall.tier.dot)}
                                style={{ width: `${overall.scorePct}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {INPUT_COLS.map((col) => (
                          <td key={col.key} className="py-0 px-0 align-middle">
                            <MiniHeatmap
                              scores={(ts[col.key] ?? {}) as ScoreMap2}
                              days={days}
                              todayStr={todayStr}
                              label={`${plant.name} · ${col.full}`}
                              onHover={onHover}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })
                ) : (
                  plantsWithOps.flatMap((plant, pi) => {
                    const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                    const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
                    const isExpanded = expandedPlants.has(plant.id);
                    const rows: React.ReactNode[] = [];

                    // Compute plant aggregate score across active operators
                    const plantOpScores = plantOps
                      .map((op) => {
                        const matKey = `${op.id}:${plant.id}`;
                        return computeEntityOverallScore(individual[matKey] ?? {}, days, todayStr);
                      })
                      .filter((res) => res.totalValid > 0)
                      .map((res) => res.scorePct);
                    const plantAvgScore = plantOpScores.length > 0
                      ? Math.round(plantOpScores.reduce((a, b) => a + b, 0) / plantOpScores.length)
                      : 0;
                    const plantTier = getAppraisalTier(plantAvgScore);

                    // Plant header row
                    rows.push(
                      <tr
                        key={`ph:${plant.id}`}
                        className="border-b cursor-pointer select-none bg-muted/20 hover:bg-muted/40 transition-colors"
                        onClick={() => togglePlant(plant.id)}
                      >
                        <td
                          className="px-3 py-2.5 sticky left-0 z-10 bg-background"
                          style={{ borderLeft: `3px solid ${accent.line}` }}
                        >
                          <div className="flex items-center gap-2">
                            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0', accent.text, isExpanded && 'rotate-90')} />
                            <Building2 className={cn('h-3.5 w-3.5 shrink-0', accent.text)} />
                            <span className={cn('font-bold text-xs', accent.text)}>{plant.name}</span>
                            <span className="text-3xs px-1.5 py-0.2 rounded-full bg-muted font-bold text-muted-foreground border border-border/60">
                              {plantOps.length} staff
                            </span>
                          </div>
                        </td>

                        {/* Plant aggregate KPI score */}
                        <td className="py-2 px-3 border-x border-border/60 bg-muted/30 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-foreground">{plantAvgScore}%</span>
                              <span className={cn('text-3xs px-1.5 py-0.2 rounded-full border font-bold', plantTier.badge)}>
                                {plantTier.icon} {plantTier.tier}
                              </span>
                            </div>
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full transition-all', plantTier.dot)}
                                style={{ width: `${plantAvgScore}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Plant aggregate summary dots */}
                        {INPUT_COLS.map((col) => {
                          const allDayScores = plantOps.flatMap((op) =>
                            days.map((d) => {
                              const s = individual[`${op.id}:${plant.id}`]?.[col.key]?.[d];
                              return (s !== undefined && s !== null) ? s : null;
                            })
                          ).filter((s): s is number => s !== null);
                          const avg = allDayScores.length > 0
                            ? allDayScores.reduce((a, b) => a + b, 0) / allDayScores.length
                            : null;
                          return (
                            <td key={col.key} className={cn('py-2 px-1 text-center', accent.bg)}>
                              <div className="flex items-center justify-center">
                                <div
                                  className="h-2.5 w-2.5 rounded-sm shadow-2xs"
                                  style={{ background: scoreColor(avg), opacity: 0.9 }}
                                  title={avg !== null ? `${Math.round(avg * 100)}% on active shifts` : 'Off duty / N/A'}
                                />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );

                    // Operator rows (when expanded)
                    if (isExpanded) {
                      plantOps.forEach((op) => {
                        const matKey = `${op.id}:${plant.id}`;
                        const ts = individual[matKey] ?? {};
                        const opOverall = computeEntityOverallScore(ts, days, todayStr);

                        rows.push(
                          <tr key={`op:${matKey}`} className="border-b hover:bg-muted/30 transition-colors">
                            <td
                              className="px-3 py-2 sticky left-0 z-10 bg-background pl-8"
                              style={{ borderLeft: `3px solid ${accent.line}` }}
                            >
                              <div className="flex items-center gap-2">
                                <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center text-3xs font-bold text-white shrink-0 shadow-2xs', avatarColor(op.id))}>
                                  {initials(op)}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-foreground truncate max-w-[120px] leading-tight">
                                    {fullName(op)}
                                  </div>
                                  {op.username && (
                                    <div className="text-3xs text-muted-foreground font-mono truncate">@{op.username}</div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Operator Overall KPI score */}
                            <td className="py-1.5 px-3 border-x border-border/60 bg-muted/15 text-center">
                              {opOverall.totalValid > 0 ? (
                                <div
                                  className="flex flex-col items-center gap-0.5"
                                  title={`Overall: ${opOverall.scorePct}% (60% RO Train: ${opOverall.roAvg !== null ? Math.round(opOverall.roAvg * 100) + '%' : 'N/A'} + 40% Shared: ${opOverall.sharedAvg !== null ? Math.round(opOverall.sharedAvg * 100) + '%' : 'N/A'})`}
                                >
                                  <div className="flex items-center gap-1">
                                    <span className="font-extrabold text-xs text-foreground">{opOverall.scorePct}%</span>
                                    <span className={cn('text-3xs px-1.5 py-0.2 rounded-md border font-semibold truncate max-w-[100px]', opOverall.tier.badge)}>
                                      {opOverall.tier.icon} {opOverall.tier.tier}
                                    </span>
                                  </div>
                                  <div className="w-24 h-1.5 rounded-full bg-muted/80 overflow-hidden border border-border/40">
                                    <div
                                      className={cn('h-full transition-all', opOverall.tier.dot)}
                                      style={{ width: `${opOverall.scorePct}%` }}
                                    />
                                  </div>
                                  <span className="text-3xs text-muted-foreground/80 font-mono-num">
                                    RO {opOverall.roAvg !== null ? Math.round(opOverall.roAvg * 100) + '%' : '—'} · Sh {opOverall.sharedAvg !== null ? Math.round(opOverall.sharedAvg * 100) + '%' : '—'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-3xs text-muted-foreground italic">N/A (Off duty)</span>
                              )}
                            </td>

                            {INPUT_COLS.map((col) => (
                              <td key={col.key} className="py-0 px-0 align-middle">
                                <MiniHeatmap
                                  scores={(ts[col.key] ?? {}) as ScoreMap2}
                                  days={days}
                                  todayStr={todayStr}
                                  label={`${fullName(op)} · ${col.full}`}
                                  onHover={onHover}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      });
                    }

                    return rows;
                  })
                )}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: viewMode === 'team' ? 'Coverage Rate' : 'Overall Logging Rate', value: `${summary.pct}%`, color: summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger' },
          { label: viewMode === 'team' ? 'Asset-Days Logged' : 'Cells Completed', value: `${summary.complete}/${summary.total}`, color: 'text-info' },
          { label: viewMode === 'team' ? 'Assets Missed' : 'Cells Missed', value: `${summary.missed}`, color: summary.missed === 0 ? 'text-accent' : 'text-danger' },
          { label: 'Pending Today', value: `${summary.pending}`, color: summary.pending === 0 ? 'text-muted-foreground' : 'text-info' },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-card rounded-xl border border-border/70 py-3 px-2 text-center gap-0.5 shadow-2xs">
            <span className={cn('text-xl font-bold leading-none', s.color)}>{s.value}</span>
            <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed z-50 bg-popover text-popover-foreground border text-2xs rounded-lg px-2.5 py-2 shadow-[var(--shadow-elev)] pointer-events-none whitespace-pre leading-relaxed"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}


export { KpiTab };
