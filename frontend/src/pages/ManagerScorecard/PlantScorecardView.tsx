import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { AppraisalBadge } from '@/components/AppraisalBadge';
import { cn } from '@/lib/utils';
import { fmtPct, pctColor, computeManagerOversightScore } from './useScorecardData';
import type { ScorecardRow, PlantCorrInfo } from './useScorecardData';

interface PlantScorecardViewProps {
  sorted: ScorecardRow[];
  plantCorrMap: Record<string, PlantCorrInfo>;
  navigate: (to: string) => void;
  days: number;
}

export function PlantScorecardView({ sorted, plantCorrMap, navigate, days }: PlantScorecardViewProps) {
  const STATUS_META: Record<ScorecardRow['status'], { label: string; tone: 'accent' | 'warn' | 'danger' | 'muted'; icon: any }> = {
    good:        { label: 'Good',        tone: 'accent', icon: CheckCircle2 },
    watch:       { label: 'Watch',       tone: 'warn',   icon: AlertTriangle },
    at_risk:     { label: 'At risk',     tone: 'danger', icon: AlertTriangle },
    unmonitored: { label: 'Unmonitored', tone: 'muted',  icon: AlertTriangle },
  };

  return (
    <>
      {/* Mobile / Tablet Card View (<768px) */}
      <div className="md:hidden p-3 space-y-3 font-sans">
        {sorted.map((r) => {
          const meta = STATUS_META[r.status];
          const StatusIcon = meta.icon;
          const corr = plantCorrMap[r.plant_id] ?? {
            pending: (r.open_pending_review_count ?? 0) + (r.open_correction_count ?? 0),
            pendingReviews: r.open_pending_review_count ?? 0,
            pendingReqs: r.open_correction_count ?? 0,
            approved: 0, rejected: 0, total: 0,
            oldestPendingHours: Math.max(r.open_pending_review_oldest_days ?? 0, r.open_correction_oldest_days ?? 0) * 24,
          };
          const openExceptions = (r.unexplained_gaps_in_window ?? 0) + corr.pending;
          const plantOversight = computeManagerOversightScore(r.overall_completeness_pct, r.error_rate_pct, openExceptions, corr.pending);
          const oldestDays = Math.round(corr.oldestPendingHours / 24);

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
                      <button
                        type="button"
                        onClick={() => navigate('/data-corrections')}
                        className="cursor-pointer hover:opacity-80 transition-opacity"
                        title="Click to review pending corrections in Data Corrections Hub"
                      >
                        <StatusPill tone="warn">{corr.pending} pending {oldestDays > 0 ? `(${oldestDays}d)` : ''}</StatusPill>
                      </button>
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
                    <span>Gaps: <strong className={(r.unexplained_gaps_in_window ?? 0) > 0 ? 'text-warn' : 'text-foreground'}>{r.unexplained_gaps_in_window ?? 0}</strong></span>
                    <span>Err: <strong className={(r.error_rate_pct ?? 0) >= 5 ? 'text-destructive' : 'text-foreground'}>{r.error_rate_pct === null ? '—' : `${r.error_rate_pct.toFixed(1)}%`}</strong></span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View (>=768px) */}
      <div className="hidden md:block overflow-x-auto">
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
              const corr = plantCorrMap[r.plant_id] ?? {
                pending: (r.open_pending_review_count ?? 0) + (r.open_correction_count ?? 0),
                pendingReviews: r.open_pending_review_count ?? 0,
                pendingReqs: r.open_correction_count ?? 0,
                approved: 0, rejected: 0, total: 0,
                oldestPendingHours: Math.max(r.open_pending_review_oldest_days ?? 0, r.open_correction_oldest_days ?? 0) * 24,
              };
              const openExceptions = (r.unexplained_gaps_in_window ?? 0) + corr.pending;
              const plantOversight = computeManagerOversightScore(r.overall_completeness_pct, r.error_rate_pct, openExceptions, corr.pending);
              const oldestDays = Math.round(corr.oldestPendingHours / 24);

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

                  <td className="py-2.5 px-3 border-x border-border/60 bg-muted/10 whitespace-nowrap">
                    <div className="flex flex-col items-center gap-1.5 min-w-[170px]">
                      <div className="flex items-center justify-between w-full gap-2">
                        <AppraisalBadge tier={plantOversight.tier} size="sm" showScore={false} />
                        <span className="text-xs font-bold text-foreground font-mono-num" title="Telemetry Completeness">
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

                  <td className="px-3 py-2.5 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1.5 text-2xs">
                      {corr.pending > 0 ? (
                        <button
                          type="button"
                          onClick={() => navigate('/data-corrections')}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          title="Click to review pending corrections in Data Corrections Hub"
                        >
                          <StatusPill tone="warn">
                            {corr.pending} pending {oldestDays > 0 ? `(${oldestDays}d old)` : ''}
                          </StatusPill>
                        </button>
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
                    {r.unexplained_gaps_in_window > 0 ? (
                      <span title="Unexplained gaps in telemetry readings" className="font-semibold text-warn font-mono-num">
                        {r.unexplained_gaps_in_window}
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
      </div>
    </>
  );
}
