import { CheckCircle2, UserCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { AppraisalBadge } from '@/components/AppraisalBadge';
import { cn } from '@/lib/utils';
import { fmtPct, pctColor } from './useScorecardData';
import type { ManagerRollupRow } from './useScorecardData';

interface ManagerScorecardViewProps {
  managerRollup: ManagerRollupRow[];
  navigate: (to: string) => void;
}

export function ManagerScorecardView({ managerRollup, navigate }: ManagerScorecardViewProps) {
  return (
    <>
      {/* Mobile / Tablet Card View (<768px) */}
      <div className="md:hidden p-3 space-y-3 font-sans">
        {managerRollup.map((m) => (
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
                    <button
                      type="button"
                      onClick={() => navigate('/data-corrections')}
                      className="cursor-pointer text-warn hover:underline"
                      title="Click to review pending corrections in Data Corrections Hub"
                    >
                      {m.pendingCorrections} pend
                    </button>
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
        ))}
      </div>

      {/* Desktop Table View (>=768px) */}
      <div className="hidden md:block overflow-x-auto">
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

                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                  <div className="flex flex-col items-center justify-center gap-0.5 text-2xs">
                    <div className="flex items-center justify-center gap-1.5">
                      {m.pendingCorrections > 0 ? (
                        <button
                          type="button"
                          onClick={() => navigate('/data-corrections')}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          title="Click to review pending corrections in Data Corrections Hub"
                        >
                          <StatusPill tone="warn">
                            {m.pendingCorrections} pending
                          </StatusPill>
                        </button>
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
      </div>
    </>
  );
}
