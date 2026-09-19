import { useState } from 'react';
import { AlertTriangle, HelpCircle, CheckCircle2, Scale, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum } from '@/lib/calculations';
import { useWaterBalanceReconciliation } from '@/data/hooks/useWaterBalanceReconciliation';
import { ReconciliationLedgerModal } from '@/pages/plantTopology/ReconciliationLedgerModal';
import type { ReconciliationStatus } from '@/lib/waterBalanceReconciliation';

const STATUS_META: Record<ReconciliationStatus, { label: string; icon: LucideIcon; cls: string; bg: string }> = {
  balanced: { label: 'Balanced', icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  marginal: { label: 'Marginal', icon: HelpCircle, cls: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  alert: { label: 'Variance alert', icon: AlertTriangle, cls: 'text-danger', bg: 'bg-danger/10 border-danger/30' },
};

/**
 * Live permeate-vs-product-meter check, embedded directly in Plant Config
 * next to the "Production volume source" picker. Reuses the exact same
 * reconciliation engine and ledger already shipped on the Plant Topology
 * page (waterBalanceReconciliation.ts / useWaterBalanceReconciliation /
 * ReconciliationLedgerModal) — this is just a second, more discoverable
 * entry point to it, right where a manager decides whether permeate and
 * product are meant to be the same water or two separate meters.
 */
export function PermeateProductCheck({ plantId, plantName }: { plantId?: string; plantName?: string }) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const { summary, isLoading } = useWaterBalanceReconciliation({ plantId: plantId ?? null, rangeKey: '30D' });

  if (!plantId) return null;

  const rec = summary?.reconciliation;
  const hasComparableData = !!rec && rec.hasTrainData && rec.hasProductData;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Scale className="h-3 w-3" />
        <span>Permeate vs product meter — last 30 days</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Checking meter readings…</p>
      ) : !hasComparableData ? (
        <p className="text-xs text-muted-foreground">
          Not enough overlapping data yet to compare RO train permeate against a product meter for this plant
          in the last 30 days — this fills in once both have readings in the same window.
        </p>
      ) : (
        (() => {
          const meta = STATUS_META[rec.status];
          const Icon = meta.icon;
          return (
            <div className={cn('flex items-center justify-between gap-3 rounded-md border p-2', meta.bg)}>
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={cn('h-4 w-4 shrink-0', meta.cls)} />
                <div className="min-w-0">
                  <div className={cn('text-xs font-bold', meta.cls)}>{meta.label}</div>
                  <div className="text-2xs text-muted-foreground truncate">
                    {fmtNum(rec.totalTrainPermeate, 0)} m³ permeate vs {fmtNum(rec.totalProductMeter, 0)} m³ product
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={cn('text-sm font-bold font-mono-num', meta.cls)}>
                  {rec.variancePct != null ? `${fmtNum(rec.variancePct, 1)}%` : '—'}
                </div>
                <button
                  onClick={() => setLedgerOpen(true)}
                  className="text-2xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  View ledger
                </button>
              </div>
            </div>
          );
        })()
      )}

      <ReconciliationLedgerModal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        plantName={plantName ?? 'This plant'}
        summary={summary}
        dateRangeLabel="Last 30 days"
      />
    </div>
  );
}
