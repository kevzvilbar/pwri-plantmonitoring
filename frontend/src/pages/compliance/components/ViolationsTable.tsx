import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';
import { SeverityBadge } from './SeverityBadge';
import { Sparkline } from './Sparkline';
import type { Violation, DailyRow } from '../types';

interface ViolationsTableProps {
  violations: Violation[];
  dailyRows: DailyRow[];
}

export function ViolationsTable({ violations, dailyRows }: ViolationsTableProps) {
  const [expandedViolation, setExpandedViolation] = useState<string | null>(null);

  if (violations.length === 0) {
    return (
      <Card className="p-6 text-center space-y-1 bg-emerald-500/10 border-emerald-500/30">
        <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
        <div className="font-bold text-foreground">100% Parameter Compliance</div>
        <p className="text-xs text-muted-foreground">All tracked water quality, hydraulic, NRW, and chemical parameters are strictly within normal regulatory limits.</p>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden border border-border/70 shadow-2xs">
      <div className="p-3 border-b bg-muted/20 flex items-center justify-between">
        <div className="text-xs font-bold text-foreground">
          Active Parameter Violations ({violations.length})
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
            {violations.map((v) => {
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
  );
}
