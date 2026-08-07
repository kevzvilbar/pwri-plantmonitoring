/**
 * ManagerScorecard.tsx
 * ════════════════════
 * Per-plant data-quality oversight, attributed to whichever Manager(s) have
 * that plant in their plant_assignments. Answers "is the plant's data being
 * watched" (completeness, unexplained gaps, flagged/error rate, open
 * corrections) rather than "who typed what" — see the rationale in
 * fn_manager_plant_scorecard's own migration comment
 * (20260807_manager_plant_scorecard.sql) for why this stays at the
 * plant/Manager grain instead of scoring individual operators.
 *
 * All numbers come from one RPC call; this file is purely presentation +
 * the window (days) control.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
  RefreshCw, Loader2, CheckCircle2, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

// Worse-first ordering, so an Admin scanning the table sees the plants that
// need attention before the ones that don't.
const STATUS_RANK: Record<ScorecardStatus, number> = {
  unmonitored: 0, at_risk: 1, watch: 2, good: 3,
};

const STATUS_META: Record<ScorecardStatus, { label: string; tone: 'accent' | 'warn' | 'danger' | 'muted'; icon: any }> = {
  good:        { label: 'Good',        tone: 'accent', icon: CheckCircle2 },
  watch:       { label: 'Watch',       tone: 'warn',   icon: HelpCircle },
  at_risk:     { label: 'At risk',     tone: 'danger', icon: AlertTriangle },
  unmonitored: { label: 'Unmonitored', tone: 'muted',  icon: ShieldQuestion },
};

const WINDOW_OPTIONS = [7, 14, 30, 90] as const;

function pctColor(pct: number | null): string {
  if (pct === null) return 'bg-muted-foreground/30';
  if (pct >= 95) return 'bg-accent';
  if (pct >= 80) return 'bg-warn';
  return 'bg-destructive';
}

function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(1)}%`;
}

// ── Data ──────────────────────────────────────────────────────────────────────

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

// ── Page root ─────────────────────────────────────────────────────────────────

export default function ManagerScorecard() {
  const { isAdmin, isManager, isDataAnalyst } = useAuth();
  const [days, setDays] = useState<number>(30);
  const { data: rows = [], isLoading, error, refetch, isFetching } = useScorecard(days);

  // These two useMemo calls must run on every render, before the
  // isAdmin/isManager/isDataAnalyst early return below — React's Rules of
  // Hooks forbid calling a hook conditionally (caught by eslint's
  // react-hooks/rules-of-hooks, not by tsc, so worth calling out: this is
  // exactly the kind of bug a type check alone won't catch).
  const sorted = useMemo(
    () => [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.plant_name.localeCompare(b.plant_name)),
    [rows],
  );

  // Client-side rollups for the summary tiles — cheap over a handful of
  // plant rows, no need for a second round trip.
  const summary = useMemo(() => {
    const monitored = rows.filter((r) => r.status !== 'unmonitored').length;
    const withCompleteness = rows.filter((r) => r.overall_completeness_pct !== null);
    const avgCompleteness = withCompleteness.length
      ? withCompleteness.reduce((sum, r) => sum + (r.overall_completeness_pct ?? 0), 0) / withCompleteness.length
      : null;
    const openExceptions = rows.reduce(
      (sum, r) => sum + r.unexplained_gaps_in_window + r.open_pending_review_count + r.open_correction_count, 0,
    );
    const atRisk = rows.filter((r) => r.status === 'at_risk' || r.status === 'unmonitored').length;
    return { monitored, total: rows.length, avgCompleteness, openExceptions, atRisk };
  }, [rows]);

  if (!isAdmin && !isManager && !isDataAnalyst) {
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
        title="Manager Scorecard"
        titleIcon={<Award className="h-5 w-5 text-accent" />}
        subtitle="Data-quality oversight per plant — completeness, unexplained gaps, and open exceptions, rolled up to whoever's managing it."
      />

      {/* Controls */}
      <Card className="p-3">
        <div className="grid gap-2 grid-cols-[140px_auto] items-end">
          <div>
            <Label className="text-xs">Window</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d}d</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Refresh
          </Button>
        </div>
      </Card>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Building2} label="Plants monitored" value={`${summary.monitored} / ${summary.total || 0}`}
          tone={summary.monitored < summary.total ? 'warn' : undefined} />
        <StatCard icon={Percent} label="Avg completeness" value={fmtPct(summary.avgCompleteness)}
          tone={summary.avgCompleteness !== null && summary.avgCompleteness < 80 ? 'danger' : undefined} />
        <StatCard icon={AlertTriangle} label="Open exceptions" value={summary.openExceptions.toLocaleString()}
          tone={summary.openExceptions > 0 ? 'warn' : undefined} />
        <StatCard icon={ShieldAlert} label="Plants needing attention" value={summary.atRisk}
          tone={summary.atRisk > 0 ? 'danger' : undefined} />
      </div>

      {/* Per-plant table */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">
            Completeness/flagged-rate/gaps are scoped to the last {days} days. Open reviews and corrections are
            current backlog as of today, not the selected window — see the tooltip on each column.
          </p>
        </div>
        <DataState
          loading={isLoading}
          error={error}
          isEmpty={sorted.length === 0}
          emptyTitle="No plants to show"
          onRetry={refetch}
        >
          <div className="border rounded-lg overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-muted/40">
                <tr>
                  {['Plant', 'Manager(s)', 'Completeness', 'Open exceptions', 'Error rate', 'Status'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-2xs uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const meta = STATUS_META[r.status];
                  const StatusIcon = meta.icon;
                  const oldestOpenDays = Math.max(r.open_pending_review_oldest_days, r.open_correction_oldest_days);
                  const openCount = r.unexplained_gaps_in_window + r.open_pending_review_count + r.open_correction_count;
                  return (
                    <tr key={r.plant_id} className="border-t">
                      <td className="px-3 py-2.5 font-medium">{r.plant_name}</td>
                      <td className="px-3 py-2.5">
                        {r.manager_names.length
                          ? <span className="text-foreground/90">{r.manager_names.join(', ')}</span>
                          : <span className="text-destructive font-medium">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2.5 min-w-[120px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-1.5">
                            <div
                              className={cn('h-1.5 rounded-full', pctColor(r.overall_completeness_pct))}
                              style={{ width: `${Math.max(2, r.overall_completeness_pct ?? 0)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-muted-foreground shrink-0">{fmtPct(r.overall_completeness_pct)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {openCount > 0 ? (
                          <span title="Unexplained gaps + pending reviews + pending correction requests">
                            <span className="font-medium">{openCount}</span>
                            {oldestOpenDays > 0 && (
                              <span className="text-muted-foreground"> · oldest {oldestOpenDays}d</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('font-mono', (r.error_rate_pct ?? 0) >= 10 ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                          {r.error_rate_pct === null ? '—' : `${r.error_rate_pct.toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
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
          </div>
        </DataState>
      </Card>
    </div>
  );
}
