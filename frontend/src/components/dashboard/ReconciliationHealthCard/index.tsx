import { useNavigate } from 'react-router-dom';
import { Scale, AlertTriangle, HelpCircle, CheckCircle2, ArrowRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmtNum } from '@/lib/calculations';
import { usePlantStore } from '@/store/plantStore';
import { useReconciliationHealthTotals } from './useReconciliationHealthTotals';
import { formatRangeLabel } from '../types';
import type { ReconciliationStatus } from '@/lib/waterBalanceReconciliation';

const STATUS_META: Record<ReconciliationStatus, { label: string; icon: LucideIcon; cls: string }> = {
  balanced: { label: 'Balanced', icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400' },
  marginal: { label: 'Marginal', icon: HelpCircle, cls: 'text-amber-600 dark:text-amber-400' },
  alert: { label: 'Alert', icon: AlertTriangle, cls: 'text-danger' },
};

export function ReconciliationHealthCard({ plantIds }: { plantIds: string[] }) {
  const navigate = useNavigate();
  const setSelectedPlantId = usePlantStore((s) => s.setSelectedPlantId);
  const {
    rows, isLoading, error, chartRange, chartFrom, chartTo, startKey, endKey,
  } = useReconciliationHealthTotals(plantIds);

  const alertCount = rows.filter((r) => r.result.status === 'alert').length;
  const marginalCount = rows.filter((r) => r.result.status === 'marginal').length;

  // Same range label the sibling Water balance card shows, so the two cards
  // paired in this row read as one system rather than two different ones.
  const rangeLabel = formatRangeLabel(chartRange, chartFrom, chartTo, startKey, endKey);

  const goToPlant = (plantId: string) => {
    setSelectedPlantId(plantId);
    navigate('/topology');
  };

  return (
    <Card
      className="rounded-2xl p-3.5 transition-all hover:border-border/90 h-full flex flex-col"
      data-testid="reconciliation-health-card"
    >
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Scale className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold truncate">Permeate vs Product Reconciliation</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-2xs text-muted-foreground">{rangeLabel}</span>
          {!isLoading && rows.length > 0 && (
            <span
              className={cn(
                'text-2xs font-semibold px-1.5 py-0.5 rounded',
                alertCount > 0
                  ? 'bg-danger/10 text-danger'
                  : marginalCount > 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              )}
            >
              {alertCount > 0
                ? `${alertCount} alert${alertCount > 1 ? 's' : ''}`
                : marginalCount > 0
                ? `${marginalCount} marginal`
                : 'All balanced'}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-[90px]">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-center text-xs text-danger px-4">
            Couldn&apos;t load reconciliation data.
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground px-4">
            No plant here has both a dedicated product meter and RO permeate readings in this range — nothing to reconcile yet.
          </div>
        ) : (
          // Centered rather than top-anchored: with as few as one row, this
          // stretches to match the taller Water balance card beside it, and
          // pinning a single row to the top would strand it above a wall of
          // empty space instead of using the height it was actually given.
          <div className="h-full flex flex-col justify-center gap-1.5">
            {rows.slice(0, 6).map(({ plantId, plantName, result }) => {
              const meta = STATUS_META[result.status];
              const Icon = meta.icon;
              return (
                <button
                  key={plantId}
                  onClick={() => goToPlant(plantId)}
                  title="Open this plant's full reconciliation ledger in Plant Topology"
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/40 px-2.5 py-1.5 text-left transition-colors cursor-pointer"
                >
                  <span className="text-xs font-medium truncate">{plantName}</span>
                  <span className="flex items-center gap-2.5 shrink-0">
                    <span className={cn('flex items-center gap-1 text-sm font-mono-num font-bold', meta.cls)}>
                      <Icon className="h-3.5 w-3.5" />
                      {result.variancePct != null ? `${fmtNum(result.variancePct, 1)}%` : '—'}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </span>
                </button>
              );
            })}
            {rows.length > 6 && (
              <div className="text-2xs text-muted-foreground text-center pt-0.5">
                +{rows.length - 6} more plant{rows.length - 6 > 1 ? 's' : ''} with a dedicated product meter
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
