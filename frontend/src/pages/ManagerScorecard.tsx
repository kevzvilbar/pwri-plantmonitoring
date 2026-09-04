/**
 * ManagerScorecard.tsx
 * ════════════════════
 * Per-plant & per-manager data-quality oversight:
 * - Operator input completeness and error rates
 * - Requested correction approvals, review speed, and SLA compliance
 * - Comprehensive Manager Oversight & Annual Appraisal Score
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, differenceInHours } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { usePermission } from '@/hooks/usePermission';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { DataState } from '@/components/DataState';
import { StatusPill } from '@/components/StatusPill';
import { StatCard } from '@/components/dashboard/StatCard';
import {
  Award, Percent, Building2, AlertTriangle, ShieldAlert, ShieldQuestion,
  RefreshCw, Loader2, CheckCircle2, HelpCircle, FileDown, UserCheck,
  Clock, CheckSquare, XCircle, Users, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AppraisalBadge } from '@/components/AppraisalBadge';
import {
  type AppraisalTier,
  APPRAISAL_TIERS,
  getAppraisalTier,
} from '@/lib/appraisal';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScorecardStatus = 'good' | 'watch' | 'at_risk' | 'unmonitored';

interface ScorecardRow {
  plant_id: string;
  plant_name: string;
  manager_ids: string[];
  manager_names: string[];
  wells_completeness_pct: number | null;
  locators_completeness_pct: number | null;
  trains_completeness_pct: number | null;
  meters_completeness_pct: number | null;
  power_completeness_pct: number | null;
  chemicals_completeness_pct: number | null;
  overall_completeness_pct: number | null;
  readings_in_window: number;
  flagged_in_window: number;
  error_rate_pct: number | null;
  unexplained_gaps_in_window: number;
  open_pending_review_count: number;
  open_pending_review_oldest_days: number;
  open_correction_count: number;
  open_correction_oldest_days: number;
  status: ScorecardStatus;
}

interface CorrectionRequestRow {
  id: string;
  plant_id: string;
  status: string;
  submitted_by: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export type ManagerAppraisalTier = AppraisalTier;
export const MANAGER_APPRAISAL_TIERS = APPRAISAL_TIERS;
export const getManagerAppraisalTier = getAppraisalTier;

// Computes manager oversight score directly matching the appraisal scale
export function computeManagerOversightScore(
  completenessPct: number | null,
  _errorRatePct?: number | null,
  _openExceptions?: number,
  _pendingCorrections?: number,
): { score: number; tier: AppraisalTier } {
  if (completenessPct === null) {
    return { score: 0, tier: APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1] };
  }

  const score = Math.min(100, Math.max(0, Math.round(completenessPct)));
  return {
    score,
    tier: getManagerAppraisalTier(score),
  };
}

const STATUS_RANK: Record<ScorecardStatus, number> = {
  unmonitored: 0, at_risk: 1, watch: 2, good: 3,
};

const STATUS_META: Record<ScorecardStatus, { label: string; tone: 'accent' | 'warn' | 'danger' | 'muted'; icon: any }> = {
  good:        { label: 'Good',        tone: 'accent', icon: CheckCircle2 },
  watch:       { label: 'Watch',       tone: 'warn',   icon: HelpCircle },
  at_risk:     { label: 'At risk',     tone: 'danger', icon: AlertTriangle },
  unmonitored: { label: 'Unmonitored', tone: 'muted',  icon: ShieldQuestion },
};

const WINDOW_OPTIONS: { label: string; value: number }[] = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d (Qtr)', value: 90 },
  { label: '365d (Annual YTD)', value: 365 },
];

function pctColor(pct: number | null): string {
  if (pct === null) return 'bg-muted-foreground/30';
  return getAppraisalTier(pct).dot;
}

function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(1)}%`;
}

// ── Data Hooks ────────────────────────────────────────────────────────────────

function useScorecard(days: number) {
  const to = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const from = useMemo(() => format(subDays(new Date(), days - 1), 'yyyy-MM-dd'), [days]);

  return useQuery({
    queryKey: ['manager-scorecard', from, to],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc('fn_manager_plant_scorecard', {
        p_from: from,
        p_to: to,
      }) as any);
      if (error) throw error;
      return (data ?? []) as ScorecardRow[];
    },
    staleTime: 2 * 60_000,
  });
}

function useCorrectionApprovals(days: number) {
  const from = useMemo(() => format(subDays(new Date(), days - 1), 'yyyy-MM-dd'), [days]);

  return useQuery({
    queryKey: ['manager-scorecard-corr-reqs', from],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('correction_requests' as any) as any)
        .select('id, plant_id, status, submitted_by, resolved_by, created_at, resolved_at')
        .gte('created_at', from);
      if (error) return [];
      return (data ?? []) as CorrectionRequestRow[];
    },
    staleTime: 2 * 60_000,
  });
}

// ── Page Root ─────────────────────────────────────────────────────────────────

export default function ManagerScorecard() {
  const canView = usePermission('manager_scorecard', 'view');
  const [days, setDays] = useState<number>(30);
  const [viewBy, setViewBy] = useState<'plant' | 'manager'>('plant');

  const { data: rows = [], isLoading, error, refetch, isFetching } = useScorecard(days);
  const { data: corrReqs = [], refetch: refetchCorr } = useCorrectionApprovals(days);

  // Group correction requests by plant
  const plantCorrMap = useMemo(() => {
    const map: Record<string, { pending: number; approved: number; rejected: number; total: number; avgHours: number | null; oldestPendingHours: number }> = {};
    const now = new Date();

    corrReqs.forEach((r) => {
      if (!map[r.plant_id]) {
        map[r.plant_id] = { pending: 0, approved: 0, rejected: 0, total: 0, avgHours: null, oldestPendingHours: 0 };
      }
      const entry = map[r.plant_id];
      entry.total++;

      if (r.status === 'pending') {
        entry.pending++;
        const hoursWaiting = differenceInHours(now, new Date(r.created_at));
        if (hoursWaiting > entry.oldestPendingHours) {
          entry.oldestPendingHours = hoursWaiting;
        }
      } else if (r.status === 'approved') {
        entry.approved++;
      } else if (r.status === 'rejected') {
        entry.rejected++;
      }
    });

    return map;
  }, [corrReqs]);

  // Manager-centric aggregation rollup
  const managerRollup = useMemo(() => {
    const managers: Record<string, {
      id?: string;
      name: string;
      plants: string[];
      plantIds: string[];
      totalReadings: number;
      completenessSum: number;
      completenessCount: number;
      errorRateSum: number;
      openExceptions: number;
      pendingCorrections: number;
      approvedCorrections: number;
      rejectedCorrections: number;
      coveredCorrections: number;
      statusCounts: Record<ScorecardStatus, number>;
    }> = {};

    rows.forEach((r) => {
      const plantNames = r.manager_names.length ? r.manager_names : ['Unassigned'];
      plantNames.forEach((name, idx) => {
        const mgrId = r.manager_ids?.[idx];
        const key = mgrId || name;

        if (!managers[key]) {
          managers[key] = {
            id: mgrId,
            name,
            plants: [],
            plantIds: [],
            totalReadings: 0,
            completenessSum: 0,
            completenessCount: 0,
            errorRateSum: 0,
            openExceptions: 0,
            pendingCorrections: 0,
            approvedCorrections: 0,
            rejectedCorrections: 0,
            coveredCorrections: 0,
            statusCounts: { good: 0, watch: 0, at_risk: 0, unmonitored: 0 },
          };
        }
        const m = managers[key];
        m.plants.push(r.plant_name);
        m.plantIds.push(r.plant_id);
        m.totalReadings += r.readings_in_window;
        if (r.overall_completeness_pct !== null) {
          m.completenessSum += r.overall_completeness_pct;
          m.completenessCount++;
        }
        m.errorRateSum += (r.error_rate_pct ?? 0);
        m.openExceptions += r.unexplained_gaps_in_window + r.open_pending_review_count;
        m.statusCounts[r.status] = (m.statusCounts[r.status] ?? 0) + 1;

        const corr = plantCorrMap[r.plant_id];
        if (corr) {
          m.pendingCorrections += corr.pending;
        }
      });
    });

    // Attribute correction resolutions personally to the designated manager:
    // Only counted as the manager's accomplishment if they personally resolved it (r.resolved_by === m.id).
    // If resolved at their assigned plant by someone else (e.g. Admin or peer), track as covered.
    Object.values(managers).forEach((m) => {
      const assignedPlantSet = new Set(m.plantIds);
      corrReqs.forEach((r) => {
        if (!assignedPlantSet.has(r.plant_id)) return;
        if (m.id && r.resolved_by === m.id) {
          if (r.status === 'approved') m.approvedCorrections++;
          else if (r.status === 'rejected') m.rejectedCorrections++;
        } else if (r.status === 'approved' || r.status === 'rejected') {
          m.coveredCorrections++;
        }
      });
    });

    return Object.values(managers).map((m) => {
      const avgCompleteness = m.completenessCount > 0 ? m.completenessSum / m.completenessCount : null;
      const avgErrorRate = m.plants.length > 0 ? m.errorRateSum / m.plants.length : 0;
      const oversight = computeManagerOversightScore(avgCompleteness, avgErrorRate, m.openExceptions, m.pendingCorrections);

      return {
        ...m,
        avgCompleteness,
        avgErrorRate,
        oversightScore: oversight.score,
        tier: oversight.tier,
      };
    }).sort((a, b) => b.oversightScore - a.oversightScore);
  }, [rows, plantCorrMap, corrReqs]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.plant_name.localeCompare(b.plant_name)),
    [rows],
  );

  const summary = useMemo(() => {
    const monitored = rows.filter((r) => r.status !== 'unmonitored').length;
    const withCompleteness = rows.filter((r) => r.overall_completeness_pct !== null);
    const avgCompleteness = withCompleteness.length
      ? withCompleteness.reduce((sum, r) => sum + (r.overall_completeness_pct ?? 0), 0) / withCompleteness.length
      : null;
    const openExceptions = rows.reduce(
      (sum, r) => sum + r.unexplained_gaps_in_window + r.open_pending_review_count + r.open_correction_count, 0,
    );
    const totalPendingCorrections = Object.values(plantCorrMap).reduce((sum, c) => sum + c.pending, 0);
    const atRisk = rows.filter((r) => r.status === 'at_risk' || r.status === 'unmonitored').length;

    const fleetOversight = computeManagerOversightScore(avgCompleteness, null, openExceptions, totalPendingCorrections);

    return {
      monitored,
      total: rows.length,
      avgCompleteness,
      openExceptions,
      totalPendingCorrections,
      atRisk,
      fleetOversightScore: fleetOversight.score,
      fleetTier: fleetOversight.tier,
    };
  }, [rows, plantCorrMap]);

  // CSV Export for Annual & Management Appraisals
  const exportManagerScorecardCsv = () => {
    const headers = [
      'Manager Name',
      'Assigned Plants',
      'Monitored Operator Readings',
      'Data Completeness %',
      'Open Exceptions / Gaps',
      'Pending Correction Approvals',
      'Approved Corrections',
      'Rejected Corrections',
      'Manager Oversight Score %',
      'Appraisal Rating Tier',
      'Evaluation Window',
    ];

    const rowsData = managerRollup.map((m) => [
      `"${m.name}"`,
      `"${m.plants.join(', ')}"`,
      `"${m.totalReadings}"`,
      `"${m.avgCompleteness ? m.avgCompleteness.toFixed(1) + '%' : 'N/A'}"`,
      `"${m.openExceptions}"`,
      `"${m.pendingCorrections}"`,
      `"${m.approvedCorrections}"`,
      `"${m.rejectedCorrections}"`,
      `"${m.oversightScore}%"`,
      `"${m.tier.tier}"`,
      `"${days} Days"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rowsData.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `manager_oversight_scorecard_${days}d_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Manager Scorecard exported successfully.');
  };

  const handleRefresh = () => {
    refetch();
    refetchCorr();
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="p-8 text-center space-y-2 max-w-sm">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h2 className="font-semibold">Access restricted</h2>
          <p className="text-sm text-muted-foreground">Manager Scorecard requires Admin, Manager, or Data Analyst access.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Manager Scorecard & Oversight"
        titleIcon={<Award className="h-5 w-5 text-accent" />}
        subtitle="Data-quality oversight per manager & plant — monitor operator input diligence, correction approval speed, and annual management ratings."
      />

      {/* ── Executive Oversight & Appraisal Strip ── */}
      <div className="p-4 rounded-xl border border-border/80 bg-card shadow-xs space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 shadow-2xs">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-sm font-bold text-foreground tracking-tight">Management Oversight Index</h2>
                <AppraisalBadge
                  score={summary.fleetOversightScore}
                  tier={summary.fleetTier}
                  size="md"
                  label="Fleet Rating"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evaluates telemetry completeness, operator error rates, and correction approval velocity across all facilities.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs gap-1.5 font-semibold bg-background border-border/80 hover:bg-muted"
              onClick={exportManagerScorecardCsv}
              title="Download full manager oversight evaluation matrix in CSV"
            >
              <FileDown className="h-3.5 w-3.5 text-primary" />
              <span>Export CSV</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isFetching}
              className="h-8 px-3 text-xs gap-1.5 bg-background border-border/80 hover:bg-muted font-medium"
              onClick={handleRefresh}
            >
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* Oversight breakdown pills */}
        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border/40 text-xs font-sans">
          <span className="text-2xs uppercase font-bold text-muted-foreground tracking-wider mr-1">Appraisal Scale:</span>
          {MANAGER_APPRAISAL_TIERS.map((tier) => (
            <span
              key={tier.id}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold select-none',
                tier.badge
              )}
              title={`${tier.tier} (≥${tier.minScore}%) — ${tier.description}`}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
              <span>{tier.shortLabel}</span>
              <span className="text-2xs opacity-75 font-mono-num font-normal">(≥{tier.minScore}%)</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Controls (Period & View Mode) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-muted/40 border border-border/60 font-sans">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time range selector */}
          <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
            {WINDOW_OPTIONS.map(({ label, value }) => (
              <button
                key={String(value)}
                className={cn(
                  'px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                  days === value
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                onClick={() => setDays(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* View Mode */}
          <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
            <button
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                viewBy === 'plant'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewBy('plant')}
            >
              <Building2 className="h-3.5 w-3.5" /> View by Plant
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                viewBy === 'manager'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewBy('manager')}
            >
              <Users className="h-3.5 w-3.5" /> View by Manager
            </button>
          </div>
        </div>

        <div className="text-2xs text-muted-foreground flex items-center gap-2">
          <span><strong className="text-foreground">{managerRollup.length}</strong> managers</span>
          <span>·</span>
          <span><strong className="text-foreground">{rows.length}</strong> plants</span>
          <span>·</span>
          <span className={cn('font-bold', (summary.avgCompleteness ?? 0) >= 80 ? 'text-accent' : 'text-warn')}>
            {fmtPct(summary.avgCompleteness)} Avg Completeness
          </span>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Building2}
          label="Plants Monitored"
          value={`${summary.monitored} / ${summary.total || 0}`}
          tone={summary.monitored < summary.total ? 'warn' : undefined}
        />
        <StatCard
          icon={Percent}
          label="Avg Completeness"
          value={fmtPct(summary.avgCompleteness)}
          tone={summary.avgCompleteness !== null && summary.avgCompleteness < 80 ? 'danger' : undefined}
        />
        <StatCard
          icon={CheckSquare}
          label="Pending Correction Approvals"
          value={summary.totalPendingCorrections.toLocaleString()}
          tone={summary.totalPendingCorrections > 0 ? 'warn' : undefined}
        />
        <StatCard
          icon={ShieldAlert}
          label="Open Gaps & Exceptions"
          value={summary.openExceptions.toLocaleString()}
          tone={summary.openExceptions > 0 ? 'danger' : undefined}
        />
      </div>

      {/* ── Main Scorecard Table ── */}
      <Card className="p-0 border border-border/70 overflow-hidden shadow-2xs">
        <div className="p-3 border-b bg-muted/20 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {viewBy === 'plant'
              ? `Plant-level view: Evaluates data completeness, error rate, open exceptions, and requested correction approval backlog over the last ${days} days.`
              : `Manager-level view: Evaluates each manager's direct oversight across all assigned plant facilities, operator inputs, and correction approval velocity.`}
          </p>
        </div>

        <DataState
          loading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          emptyTitle="No plants or managers to show"
          onRetry={handleRefresh}
        >
          {/* ── Mobile / Tablet Card View (<768px) ── */}
          <div className="md:hidden p-3 space-y-3 font-sans">
            {viewBy === 'plant' ? (
              sorted.map((r) => {
                const meta = STATUS_META[r.status];
                const StatusIcon = meta.icon;
                const oldestOpenDays = Math.max(r.open_pending_review_oldest_days, r.open_correction_oldest_days);
                const openCount = r.unexplained_gaps_in_window + r.open_pending_review_count + r.open_correction_count;
                const corr = plantCorrMap[r.plant_id] ?? { pending: 0, approved: 0, rejected: 0, total: 0, oldestPendingHours: 0 };
                const plantOversight = computeManagerOversightScore(r.overall_completeness_pct, r.error_rate_pct, openCount, corr.pending);

                return (
                  <div key={r.plant_id} className="p-3.5 rounded-xl border border-border/70 bg-card shadow-2xs space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-sm text-foreground leading-snug">{r.plant_name}</h3>
                        <p className="text-2xs text-muted-foreground mt-0.5">
                          Manager: {r.manager_names.length ? r.manager_names.join(', ') : <span className="text-destructive font-semibold">Unassigned</span>}
                        </p>
                      </div>
                      <StatusPill tone={meta.tone}>
                        <StatusIcon className="h-3 w-3" />
                        {meta.label}
                      </StatusPill>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-muted-foreground font-semibold">Rating:</span>
                        <AppraisalBadge tier={plantOversight.tier} size="sm" showScore={false} />
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm text-foreground font-mono-num">{fmtPct(r.overall_completeness_pct)}</span>
                        <span className="text-3xs text-muted-foreground block">Completeness</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-border/40 text-xs">
                      <div className="p-2 rounded-lg bg-muted/40 border border-border/40 space-y-0.5">
                        <span className="text-3xs text-muted-foreground uppercase font-bold tracking-wide">Corrections</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {corr.pending > 0 ? (
                            <StatusPill tone="warn">{corr.pending} pending ({corr.oldestPendingHours}h)</StatusPill>
                          ) : (
                            <span className="text-2xs text-muted-foreground">0 pending</span>
                          )}
                          <span className="text-2xs text-accent font-semibold inline-flex items-center gap-0.5">
                            <CheckCircle2 className="h-3 w-3" /> {corr.approved}
                          </span>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-muted/40 border border-border/40 space-y-0.5">
                        <span className="text-3xs text-muted-foreground uppercase font-bold tracking-wide">Exceptions &amp; Error</span>
                        <div className="flex items-center justify-between text-2xs">
                          <span>Gaps: <strong className={openCount > 0 ? 'text-warn' : 'text-foreground'}>{openCount}</strong></span>
                          <span>Err: <strong className={(r.error_rate_pct ?? 0) >= 5 ? 'text-destructive' : 'text-foreground'}>{r.error_rate_pct === null ? '—' : `${r.error_rate_pct.toFixed(1)}%`}</strong></span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              managerRollup.map((m) => (
                <div key={m.name} className="p-3.5 rounded-xl border border-border/70 bg-card shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
                        <UserCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-foreground">{m.name}</h3>
                        <p className="text-2xs text-muted-foreground">{m.plants.join(', ') || 'No facility assigned'}</p>
                      </div>
                    </div>
                    <AppraisalBadge tier={m.tier} size="sm" showScore={false} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40 text-center">
                    <div className="p-1.5 rounded-lg bg-muted/40">
                      <div className="font-mono-num font-bold text-xs text-foreground">{fmtPct(m.avgCompleteness)}</div>
                      <div className="text-3xs text-muted-foreground">Completeness</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-muted/40">
                      <div className="font-mono-num font-bold text-xs text-foreground">
                        {m.pendingCorrections > 0 ? (
                          <span className="text-warn">{m.pendingCorrections} pend</span>
                        ) : (
                          <span className="text-accent">✓ {m.approvedCorrections}</span>
                        )}
                      </div>
                      <div className="text-3xs text-muted-foreground" title={m.coveredCorrections > 0 ? `${m.coveredCorrections} covered by others` : undefined}>
                        Approvals {m.approvedCorrections > 0 && m.pendingCorrections > 0 ? `(✓${m.approvedCorrections})` : ''}
                      </div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-muted/40">
                      <div className="font-mono-num font-bold text-xs text-foreground">{m.openExceptions}</div>
                      <div className="text-3xs text-muted-foreground">Exceptions</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Desktop Table View (>=768px) ── */}
          <div className="hidden md:block overflow-x-auto">
            {viewBy === 'plant' ? (
              <table className="w-full min-w-[700px] text-xs font-sans">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-bold text-xs">Plant Facility</th>
                    <th className="text-left px-3 py-2.5 font-bold text-xs">Manager(s)</th>
                    <th className="text-center px-3.5 py-2.5 font-bold text-xs bg-muted/80 border-x border-border/60">
                      Oversight &amp; Completeness
                    </th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Correction Approvals</th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Open Gaps</th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Error Rate</th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const meta = STATUS_META[r.status];
                    const StatusIcon = meta.icon;
                    const oldestOpenDays = Math.max(r.open_pending_review_oldest_days, r.open_correction_oldest_days);
                    const openCount = r.unexplained_gaps_in_window + r.open_pending_review_count + r.open_correction_count;
                    const corr = plantCorrMap[r.plant_id] ?? { pending: 0, approved: 0, rejected: 0, total: 0, oldestPendingHours: 0 };
                    const plantOversight = computeManagerOversightScore(r.overall_completeness_pct, r.error_rate_pct, openCount, corr.pending);

                    return (
                      <tr key={r.plant_id} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-foreground whitespace-nowrap">{r.plant_name}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.manager_names.length ? (
                            <span className="font-medium text-foreground/90">{r.manager_names.join(', ')}</span>
                          ) : (
                            <span className="text-destructive font-semibold">Unassigned</span>
                          )}
                        </td>

                        {/* Combined Oversight & Completeness */}
                        <td className="py-2.5 px-3 border-x border-border/60 bg-muted/10 whitespace-nowrap">
                          <div className="flex flex-col items-center gap-1.5 min-w-[170px]">
                            <div className="flex items-center justify-between w-full gap-2">
                              <AppraisalBadge tier={plantOversight.tier} size="sm" showScore={false} />
                              <span className="text-xs font-bold text-foreground font-mono-num shrink-0" title="Telemetry Completeness">
                                {fmtPct(r.overall_completeness_pct)}
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full rounded-full transition-all', pctColor(r.overall_completeness_pct))}
                                style={{ width: `${Math.max(2, r.overall_completeness_pct ?? 0)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Correction Approvals Monitoring */}
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5 text-2xs">
                            {corr.pending > 0 ? (
                              <StatusPill tone="warn">
                                {corr.pending} pending ({corr.oldestPendingHours}h)
                              </StatusPill>
                            ) : (
                              <span className="text-muted-foreground font-medium">0 pending</span>
                            )}
                            <span className="text-muted-foreground/60">·</span>
                            <span className="text-accent font-semibold inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> {corr.approved} app
                            </span>
                          </div>
                        </td>

                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {openCount > 0 ? (
                            <span title="Unexplained gaps + pending reviews" className="font-semibold text-warn font-mono-num">
                              {openCount}
                              {oldestOpenDays > 0 && (
                                <span className="text-muted-foreground font-normal text-3xs"> ({oldestOpenDays}d old)</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-mono-num">0</span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <span className={cn('font-mono-num font-medium', (r.error_rate_pct ?? 0) >= 5 ? 'text-destructive font-bold' : 'text-muted-foreground')}>
                            {r.error_rate_pct === null ? '—' : `${r.error_rate_pct.toFixed(1)}%`}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <StatusPill tone={meta.tone}>
                            <StatusIcon className="h-3 w-3" />
                            {meta.label}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* View by Manager Profile */
              <table className="w-full min-w-[700px] text-xs font-sans">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-bold text-xs">Manager Name</th>
                    <th className="text-left px-3 py-2.5 font-bold text-xs">Assigned Facilities</th>
                    <th className="text-center px-3.5 py-2.5 font-bold text-xs bg-muted/80 border-x border-border/60">
                      Oversight &amp; Completeness
                    </th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Correction Approval Status</th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Total Monitored Logs</th>
                    <th className="text-center px-3 py-2.5 font-bold text-xs">Open Exceptions</th>
                  </tr>
                </thead>
                <tbody>
                  {managerRollup.map((m) => (
                    <tr key={m.name} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap font-bold text-foreground">
                        <div className="flex items-center gap-2">
                          <UserCheck className="h-4 w-4 text-primary shrink-0" />
                          <span>{m.name}</span>
                        </div>
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {m.plants.map((p) => (
                            <span key={p} className="px-1.5 py-0.5 rounded bg-muted text-2xs font-semibold text-foreground border border-border/60">
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Combined Manager Oversight & Completeness */}
                      <td className="py-2.5 px-3 border-x border-border/60 bg-muted/10 whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1.5 min-w-[170px]">
                          <div className="flex items-center justify-between w-full gap-2">
                            <AppraisalBadge tier={m.tier} size="sm" showScore={false} />
                            <span className="text-xs font-bold text-foreground font-mono-num shrink-0" title="Average Completeness">
                              {fmtPct(m.avgCompleteness)}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                            <div
                              className={cn('h-full rounded-full transition-all', pctColor(m.avgCompleteness))}
                              style={{ width: `${Math.max(2, m.avgCompleteness ?? 0)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Manager's Correction Approvals */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center justify-center gap-0.5 text-2xs">
                          <div className="flex items-center justify-center gap-1.5">
                            {m.pendingCorrections > 0 ? (
                              <StatusPill tone="warn">
                                {m.pendingCorrections} pending
                              </StatusPill>
                            ) : (
                              <span className="text-accent font-semibold inline-flex items-center gap-0.5">
                                <CheckCircle2 className="h-3 w-3" /> 0 pending
                              </span>
                            )}
                            <span className="text-muted-foreground/60">·</span>
                            <span className="text-foreground font-mono-num font-medium" title="Personally approved / rejected by this manager">
                              ✓ {m.approvedCorrections} / ✗ {m.rejectedCorrections}
                            </span>
                          </div>
                          {m.coveredCorrections > 0 && (
                            <span className="text-3xs text-muted-foreground" title="Corrections at assigned facilities approved/rejected by Admin or covering peer">
                              ({m.coveredCorrections} covered by others)
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-2.5 text-center whitespace-nowrap font-mono-num font-medium text-foreground">
                        {m.totalReadings.toLocaleString()}
                      </td>

                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <span className={cn('font-semibold font-mono-num', m.openExceptions > 0 ? 'text-warn' : 'text-muted-foreground')}>
                          {m.openExceptions}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DataState>
      </Card>
    </div>
  );
}

