import React from 'react';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import {
  Waves,
  Droplets,
  Scale,
  ArrowRight,
  TrendingDown,
  Info,
  Calendar,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import type { PlantWaterBalanceSummary } from '@/lib/waterBalanceReconciliation';
import type { RangeKey } from '@/components/dashboard/types';

export interface WaterBalanceHudProps {
  summary: PlantWaterBalanceSummary | null;
  isLoading: boolean;
  rangeKey: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  onOpenLedger: () => void;
  className?: string;
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7D', label: '7D' },
  { key: '30D', label: '30D' },
  { key: 'MONTHLY', label: 'This Month' },
];

export function WaterBalanceHud({
  summary,
  isLoading,
  rangeKey,
  onRangeChange,
  onOpenLedger,
  className,
}: WaterBalanceHudProps) {
  const rec = summary?.reconciliation;
  const variancePct = rec?.variancePct;
  const status = rec?.status ?? 'balanced';

  return (
    <div
      className={cn(
        'rounded-xl border border-border/50 bg-card p-2 sm:p-2.5 space-y-2 shadow-xs',
        className
      )}
    >
      {/* Top Header Row: Section Label + Date Range Segmented Controls + Audit Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-1.5">
        <div className="flex items-center gap-2">
          <Scale className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
            Water Balance & Permeate Reconciliation
          </span>
          {isLoading && (
            <span className="text-3xs font-mono text-muted-foreground animate-pulse">
              Syncing telemetry…
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Range Controls */}
          <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-lg border border-border/40">
            {RANGES.map(({ key, label }) => {
              const isActive = rangeKey === key;
              return (
                <button
                  key={key}
                  onClick={() => onRangeChange(key)}
                  className={cn(
                    'px-2 py-0.5 rounded text-3xs font-medium transition-all cursor-pointer',
                    isActive
                      ? 'bg-background text-foreground shadow-2xs border border-border/50 font-bold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Audit Ledger Trigger */}
          <button
            onClick={onOpenLedger}
            title="Inspect train-by-train permeate and product meter reconciliation ledger"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-3xs font-semibold bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 transition-all cursor-pointer"
          >
            <span>Reconciliation Ledger</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Main SCADA Telemetry Strip: Horizontal Pipeline Flow */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {/* 1. Raw Water In */}
        <div className="rounded-lg bg-muted/20 border border-border/30 p-2 space-y-0.5">
          <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            <span>Raw Water In</span>
            <Droplets className="h-3 w-3 text-sky-500" />
          </div>
          <div className="text-sm font-bold font-mono-num text-foreground">
            {summary && summary.rawWaterIn > 0 ? `${fmtNum(summary.rawWaterIn, 0)} m³` : '—'}
          </div>
          <div className="text-3xs text-muted-foreground">Deep well extraction</div>
        </div>

        {/* 2. RO Permeate Produced */}
        <div className="rounded-lg bg-muted/20 border border-border/30 p-2 space-y-0.5">
          <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            <span>RO Permeate</span>
            <Waves className="h-3 w-3 text-cyan-500" />
          </div>
          <div className="text-sm font-bold font-mono-num text-cyan-500">
            {summary && summary.roPermeate > 0 ? `${fmtNum(summary.roPermeate, 0)} m³` : '—'}
          </div>
          <div className="text-3xs text-muted-foreground">Σ Train permeate meters</div>
        </div>

        {/* 3. Bulk Product Metered */}
        <div className="rounded-lg bg-muted/20 border border-border/30 p-2 space-y-0.5">
          <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            <span>Product Metered</span>
            <Droplets className="h-3 w-3 text-blue-500" />
          </div>
          <div className="text-sm font-bold font-mono-num text-blue-500">
            {summary && summary.productMetered > 0 ? `${fmtNum(summary.productMetered, 0)} m³` : '—'}
          </div>
          <div className="text-3xs text-muted-foreground">Σ Bulk product meters</div>
        </div>

        {/* 4. Permeate Reconciliation Discrepancy */}
        <div
          onClick={onOpenLedger}
          className={cn(
            'rounded-lg border p-2 space-y-0.5 cursor-pointer transition-all',
            status === 'alert'
              ? 'bg-danger/10 border-danger/40 hover:bg-danger/15'
              : status === 'marginal'
              ? 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15'
              : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
          )}
        >
          <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-bold">
            <span
              className={
                status === 'alert'
                  ? 'text-danger'
                  : status === 'marginal'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }
            >
              Reconciliation
            </span>
            {status === 'alert' ? (
              <AlertTriangle className="h-3 w-3 text-danger" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            )}
          </div>
          <div className="text-sm font-bold font-mono-num flex items-baseline gap-1">
            <span
              className={
                status === 'alert'
                  ? 'text-danger'
                  : status === 'marginal'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }
            >
              {variancePct != null ? `${fmtNum(variancePct, 1)}%` : '0.0%'}
            </span>
            <span className="text-3xs font-mono opacity-80 text-muted-foreground">
              {rec && rec.deltaVariance !== 0
                ? `(${rec.deltaVariance > 0 ? '+' : ''}${fmtNum(rec.deltaVariance, 0)} m³)`
                : ''}
            </span>
          </div>
          <div className="text-3xs text-muted-foreground truncate">
            {status === 'alert'
              ? 'Variance > 5% (Check)'
              : status === 'marginal'
              ? 'Marginal (2–5%)'
              : 'In tolerance (≤2%)'}
          </div>
        </div>

        {/* 5. Locator Consumption */}
        <div className="rounded-lg bg-muted/20 border border-border/30 p-2 space-y-0.5">
          <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            <span>Locators</span>
            <Droplets className="h-3 w-3 text-indigo-500" />
          </div>
          <div className="text-sm font-bold font-mono-num text-foreground">
            {summary && summary.locatorConsumption > 0
              ? `${fmtNum(summary.locatorConsumption, 0)} m³`
              : '—'}
          </div>
          <div className="text-3xs text-muted-foreground">Billed consumption</div>
        </div>

        {/* 6. Non-Revenue Water / Loss */}
        <div className="rounded-lg bg-muted/20 border border-border/30 p-2 space-y-0.5">
          <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
            <span>Distribution NRW</span>
            <TrendingDown className="h-3 w-3 text-rose-500" />
          </div>
          <div className="text-sm font-bold font-mono-num text-rose-500 flex items-baseline gap-1">
            <span>
              {summary && summary.nrwVolume > 0 ? `${fmtNum(summary.nrwVolume, 0)} m³` : '0 m³'}
            </span>
            {summary?.nrwPct != null && (
              <span className="text-3xs font-mono opacity-80">
                ({fmtNum(summary.nrwPct, 1)}%)
              </span>
            )}
          </div>
          <div className="text-3xs text-muted-foreground">Apparent & real loss</div>
        </div>
      </div>
    </div>
  );
}
