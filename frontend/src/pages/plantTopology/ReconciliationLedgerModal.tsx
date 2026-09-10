import React from 'react';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import {
  X,
  Scale,
  Waves,
  Droplets,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  TrendingDown,
  ArrowRight,
} from 'lucide-react';
import type { PlantWaterBalanceSummary } from '@/lib/waterBalanceReconciliation';

export interface ReconciliationLedgerModalProps {
  open: boolean;
  onClose: () => void;
  plantName: string;
  summary: PlantWaterBalanceSummary | null;
  dateRangeLabel: string;
}

export function ReconciliationLedgerModal({
  open,
  onClose,
  plantName,
  summary,
  dateRangeLabel,
}: ReconciliationLedgerModalProps) {
  if (!open || !summary) return null;

  const rec = summary.reconciliation;
  const variancePct = rec.variancePct;
  const status = rec.status;
  const delta = rec.deltaVariance;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in"
    >
      <div className="relative w-full max-w-4xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">
                Permeate Reconciliation & Mass Balance Ledger
              </h2>
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider',
                  status === 'alert'
                    ? 'bg-danger/20 text-danger border border-danger/40'
                    : status === 'marginal'
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                )}
              >
                {status === 'alert'
                  ? 'Variance Alert'
                  : status === 'marginal'
                  ? 'Marginal'
                  : 'Balanced'}
              </span>
            </div>
            <p className="text-2xs text-muted-foreground font-mono">
              {plantName} · Period: {dateRangeLabel}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Diagnostic Banner */}
          <div
            className={cn(
              'rounded-lg border p-3 flex items-start gap-3 text-xs',
              status === 'alert'
                ? 'bg-danger/10 border-danger/30 text-foreground'
                : status === 'marginal'
                ? 'bg-amber-500/10 border-amber-500/30 text-foreground'
                : 'bg-emerald-500/10 border-emerald-500/20 text-foreground'
            )}
          >
            {status === 'alert' ? (
              <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            ) : status === 'marginal' ? (
              <HelpCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-bold flex items-center gap-2">
                <span>
                  Reconciliation Variance:{' '}
                  <span className="font-mono-num font-extrabold">
                    {variancePct != null ? `${fmtNum(variancePct, 2)}%` : '0.00%'}
                  </span>{' '}
                  ({delta >= 0 ? '+' : ''}
                  {fmtNum(delta, 1)} m³)
                </span>
              </div>
              <p className="text-3xs text-muted-foreground leading-relaxed">
                {delta > 0
                  ? 'RO trains recorded more permeate than bulk product meters registered. This typically indicates unmetered membrane backwash/CIP flushes, product manifold leakage, or bulk meter under-registration.'
                  : delta < 0
                  ? 'Bulk product meters measured more volume than individual RO trains registered. This occurs when blend water enters upstream of the product meter or train permeate flow meters are under-registering.'
                  : 'Total RO train permeate and bulk product meter readings reconcile with zero variance.'}
              </p>
            </div>
          </div>

          {/* Reconciliation Audit Tables: Train Permeate vs Product Meters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: RO Train Permeate */}
            <div className="rounded-lg border border-border/50 bg-card p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-500 flex items-center gap-1.5">
                  <Waves className="h-3.5 w-3.5" />
                  <span>RO Train Permeate Meters</span>
                </span>
                <span className="text-xs font-mono font-bold text-foreground">
                  {fmtNum(rec.totalTrainPermeate, 0)} m³
                </span>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {rec.trainDetails.length > 0 ? (
                  rec.trainDetails.map((t) => {
                    const pct =
                      rec.totalTrainPermeate > 0
                        ? (t.volume / rec.totalTrainPermeate) * 100
                        : 0;
                    return (
                      <div
                        key={t.trainId}
                        className="flex items-center justify-between text-2xs p-1.5 rounded bg-muted/20 border border-border/30"
                      >
                        <div>
                          <span className="font-semibold text-foreground">
                            Train {t.trainNumber}
                          </span>
                          {t.name && (
                            <span className="text-3xs text-muted-foreground ml-1">
                              ({t.name})
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="font-mono-num font-bold text-foreground">
                            {fmtNum(t.volume, 1)} m³
                          </span>
                          <span className="text-3xs font-mono text-muted-foreground ml-1.5">
                            ({fmtNum(pct, 1)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-2xs text-muted-foreground text-center py-4">
                    No RO train readings in this date window.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Bulk Product Meters */}
            <div className="rounded-lg border border-border/50 bg-card p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-500 flex items-center gap-1.5">
                  <Droplets className="h-3.5 w-3.5" />
                  <span>Bulk Product Meters</span>
                </span>
                <span className="text-xs font-mono font-bold text-foreground">
                  {fmtNum(rec.totalProductMeter, 0)} m³
                </span>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {rec.meterDetails.length > 0 ? (
                  rec.meterDetails.map((m) => {
                    const pct =
                      rec.totalProductMeter > 0
                        ? (m.volume / rec.totalProductMeter) * 100
                        : 0;
                    return (
                      <div
                        key={m.meterId}
                        className="flex items-center justify-between text-2xs p-1.5 rounded bg-muted/20 border border-border/30"
                      >
                        <span className="font-semibold text-foreground truncate max-w-[180px]">
                          {m.name}
                        </span>
                        <div className="text-right">
                          <span className="font-mono-num font-bold text-foreground">
                            {fmtNum(m.volume, 1)} m³
                          </span>
                          <span className="text-3xs font-mono text-muted-foreground ml-1.5">
                            ({fmtNum(pct, 1)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-2xs text-muted-foreground text-center py-4">
                    No product meter readings in this date window.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Plant Mass Balance Waterfall Ledger */}
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
              Plant-Wide Water Mass Balance Conservation
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs">
              <div className="p-2 rounded bg-card border border-border/40 space-y-0.5">
                <div className="text-3xs text-muted-foreground">Raw In (Wells)</div>
                <div className="text-xs font-bold font-mono-num text-foreground">
                  {fmtNum(summary.rawWaterIn, 0)} m³
                </div>
              </div>

              <div className="p-2 rounded bg-card border border-border/40 space-y-0.5">
                <div className="text-3xs text-muted-foreground">Reconciled Production</div>
                <div className="text-xs font-bold font-mono-num text-cyan-500">
                  {fmtNum(summary.reconciledProduction, 0)} m³
                </div>
              </div>

              <div className="p-2 rounded bg-card border border-border/40 space-y-0.5">
                <div className="text-3xs text-muted-foreground">Blending Addition</div>
                <div className="text-xs font-bold font-mono-num text-amber-500">
                  {fmtNum(summary.blending, 0)} m³
                </div>
              </div>

              <div className="p-2 rounded bg-card border border-border/40 space-y-0.5">
                <div className="text-3xs text-muted-foreground">Billed Consumption</div>
                <div className="text-xs font-bold font-mono-num text-indigo-500">
                  {fmtNum(summary.locatorConsumption, 0)} m³
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-border bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Close Ledger
          </button>
        </div>
      </div>
    </div>
  );
}
