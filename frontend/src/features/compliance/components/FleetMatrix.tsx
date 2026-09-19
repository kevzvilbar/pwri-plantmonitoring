import { Loader2, RefreshCw, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataState } from '@/components/DataState';
import { SeverityBadge } from './SeverityBadge';
import { scoreColor, scoreBgColor, scoreLabel } from '../types';
import type { PlantComplianceSummary } from '../types';

interface FleetMatrixProps {
  fleetSummaries: PlantComplianceSummary[];
  fleetLoading: boolean;
  days: number;
  onRefetch: () => void;
  onSelectPlant: (id: string) => void;
}

export function FleetMatrix({
  fleetSummaries,
  fleetLoading,
  days,
  onRefetch,
  onSelectPlant,
}: FleetMatrixProps) {
  return (
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
          onClick={onRefetch}
        >
          {fleetLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh Fleet
        </Button>
      </div>

      <DataState
        loading={fleetLoading}
        isEmpty={fleetSummaries.length === 0}
        emptyTitle="No plant facilities configured."
        onRetry={onRefetch}
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
                        onClick={() => onSelectPlant(p.plantId)}
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
  );
}
