import type { StaffMember, ReadingRecord, ChecklistExecution } from '../../types';

export type KpiRange2 = 'today' | 7 | 14 | 30 | 90 | 365;
export type KpiViewMode = 'team' | 'individual';

export type AppraisalTier = {
  tier: string;
  badge: string;
  dot: string;
  icon: string;
  minScore: number;
  description: string;
};

export const APPRAISAL_TIERS: AppraisalTier[] = [
  { tier: 'Outstanding',        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-500', icon: '🏆', minScore: 90, description: 'Exemplary operational logging compliance' },
  { tier: 'Exceeds Expectations', badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40',   dot: 'bg-teal-500',    icon: '⭐', minScore: 80, description: 'Consistently surpasses standard logging targets' },
  { tier: 'Meets Target',      badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40',         dot: 'bg-sky-500',     icon: '✓',  minScore: 70, description: 'Meets operational logging expectations' },
  { tier: 'Needs Improvement', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40', dot: 'bg-amber-500',  icon: '⚠️', minScore: 50, description: 'Below standard compliance targets' },
  { tier: 'Unsatisfactory',    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',    dot: 'bg-rose-500',   icon: '❌', minScore: 0,  description: 'Critical gaps in operational logs' },
];

export function getAppraisalTier(scorePct: number): AppraisalTier {
  for (const t of APPRAISAL_TIERS) {
    if (scorePct >= t.minScore) return t;
  }
  return APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1];
}

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

export type DayScore2 = number | null;
export type ScoreMap2 = Record<string, DayScore2>;
export type EntityTypeScore = Partial<Record<InputColKey, ScoreMap2>>;
export type ScoreMatrix = Record<string, EntityTypeScore>;

export const SHARED_COLS: InputColKey[] = ['wells', 'locator', 'product_meter', 'solar', 'grid', 'chemicals'];

export const DEFAULT_RO_HOURLY_TARGET = 24;
export const DEFAULT_RO_OPERATOR_SHIFT_TARGET = 8;

export function roTargetForPlant(plant: { ro_hourly_target?: number | string | null } | null | undefined): number {
  const v = Number(plant?.ro_hourly_target);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RO_HOURLY_TARGET;
}

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

export const KPI_STATUS = {
  complete: { color: 'hsl(var(--reading-status-complete))', label: 'Complete' },
  partial:  { color: 'hsl(var(--reading-status-partial))',  label: 'Partial'  },
  minimal:  { color: 'hsl(var(--reading-status-minimal))',  label: 'Minimal'  },
  missed:   { color: 'hsl(var(--reading-status-missed))',   label: 'Missed'   },
  pending:  { color: 'hsl(var(--reading-status-pending))',  label: 'Pending (today)' },
  na:       { color: 'hsl(var(--reading-status-na))',       label: 'N/A'      },
} as const;

export function scoreStatus(s: DayScore2, isToday = false): keyof typeof KPI_STATUS {
  if (s === null) return 'na';
  if (isToday && s === 0) return 'pending';
  if (s >= 1.0)  return 'complete';
  if (s >= 0.5)  return 'partial';
  if (s > 0)     return 'minimal';
  return 'missed';
}

export function scoreColor(s: DayScore2, isToday = false) {
  return KPI_STATUS[scoreStatus(s, isToday)].color;
}

export function generateDays2(range: KpiRange2): string[] {
  if (range === 'today') {
    return [fmtIsoDate(new Date())];
  }
  const count = typeof range === 'number' ? range : 30;
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(fmtIsoDate(d));
  }
  return days;
}

function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
