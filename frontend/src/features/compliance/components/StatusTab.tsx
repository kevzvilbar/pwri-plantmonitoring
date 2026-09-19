import {
  ShieldCheck, ShieldAlert, AlertCircle, AlertTriangle, Beaker, Loader2,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
import { ScoreGauge } from './ScoreGauge';
import { ViolationsTable } from './ViolationsTable';
import {
  computeComplianceScore, buildSummary, scoreBgColor, scoreColor,
  fmtSummaryDate, computeTrend, METRIC_IMPROVING_DIRECTION, labelize,
} from '../types';
import type { EvalResult, DailyRow, ChemSupply, Trend } from '../types';

function TrendIndicator({ trend, improving }: { trend: Trend; improving: boolean }) {
  if (trend === 'flat') return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const isGood = (trend === 'up') === improving;
  if (trend === 'up') {
    return <TrendingUp className={cn('h-3.5 w-3.5', isGood ? 'text-accent' : 'text-danger')} />;
  }
  return <TrendingDown className={cn('h-3.5 w-3.5', isGood ? 'text-accent' : 'text-danger')} />;
}

interface StatusTabProps {
  result: EvalResult | null;
  evaluating: boolean;
  dailyRows: DailyRow[];
  previewMetrics: Record<string, number | undefined> | null;
  prevMetrics: Record<string, number | undefined>;
  chemSupply: ChemSupply[];
  days: number;
}

export function StatusTab({
  result,
  evaluating,
  dailyRows,
  previewMetrics,
  prevMetrics,
  chemSupply,
  days,
}: StatusTabProps) {
  if (!result) {
    return (
      <DataState
        loading={evaluating}
        isEmpty={!evaluating}
        emptyTitle="Evaluating facility compliance..."
        emptyDescription="Please wait while live telemetry and chemical stocks are evaluated against thresholds."
      />
    );
  }

  const summary = buildSummary(result.violations);
  const complianceScore = computeComplianceScore(result.violations);

  const latestDataDate = dailyRows.length ? dailyRows[0].summary_date : null;
  let dataDaysStale: number | null = null;
  if (latestDataDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, day] = latestDataDate.split('-').map(Number);
    dataDaysStale = Math.round((today.getTime() - new Date(y, m - 1, day).getTime()) / 86400000);
  }

  return (
    <div className="space-y-4">
      {/* Status banner + compliance score */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-stretch">
        <Card className={cn(
          'p-4 border-l-4 md:col-span-3 flex items-start gap-3.5',
          result.violations.length === 0
            ? 'border-accent bg-accent-soft/40'
            : result.violations.some((v) => v.severity === 'high')
              ? 'border-danger bg-danger-soft/40'
              : 'border-warn bg-warn-soft/40',
        )}>
          {result.violations.length === 0
            ? <ShieldCheck className="h-7 w-7 text-accent shrink-0 mt-0.5" />
            : <ShieldAlert className="h-7 w-7 text-danger shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground">{summary.headline}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {result.scope_label ?? result.scope} · Evaluated {new Date(result.evaluated_at).toLocaleTimeString()}
            </div>
            {latestDataDate && (
              <div className={cn(
                'text-xs mt-1 flex items-center gap-1 font-medium',
                dataDaysStale !== null && dataDaysStale > 1
                  ? 'text-warn'
                  : 'text-muted-foreground',
              )}>
                {dataDaysStale !== null && dataDaysStale > 1 && (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                Data as of {fmtSummaryDate(latestDataDate)}
                {dataDaysStale !== null && dataDaysStale > 1 &&
                  ` — (${dataDaysStale} days lag, verify daily aggregation cron)`}
              </div>
            )}
            {summary.details.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {summary.details.map((d, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/90 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warn" />
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Score Gauge Card */}
        <Card className={cn('p-4 flex flex-col items-center justify-center border', scoreBgColor(complianceScore))}>
          <div className="text-2xs text-muted-foreground mb-1 font-bold uppercase tracking-wider">
            Compliance Rating
          </div>
          <ScoreGauge score={complianceScore} />
        </Card>
      </div>

      {/* Period Averages with Trend indicators */}
      {previewMetrics && Object.keys(previewMetrics).length > 0 && (
        <Card className="p-3.5">
          <div className="text-xs font-bold text-foreground mb-2 flex items-center justify-between">
            <span>Monitored Parameter Averages ({days}d Rolling)</span>
            <span className="text-2xs font-normal text-muted-foreground">Arrow indicates trend direction vs previous period</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(previewMetrics).map(([k, v]) => {
              const prev = prevMetrics[k];
              const trend: Trend = (v !== undefined && prev !== undefined)
                ? computeTrend(v as number, prev)
                : 'flat';
              const improving = METRIC_IMPROVING_DIRECTION[k] ?? true;
              return (
                <div key={k} className="rounded-lg p-2.5 bg-muted/40 border border-border/60">
                  <div className="text-2xs font-semibold text-muted-foreground truncate">{labelize(k)}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-sm font-mono font-bold text-foreground">
                      {v !== undefined && !Number.isNaN(v as any)
                        ? Math.round((v as number) * 100) / 100
                        : '—'}
                    </span>
                    <TrendIndicator trend={trend} improving={improving} />
                    {prev !== undefined && (
                      <span className="text-3xs text-muted-foreground font-mono">
                        (prev: {Math.round((prev as number) * 100) / 100})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Chemical Stock Autonomy Warnings */}
      {chemSupply.length > 0 && (
        <Card className="p-3.5 border-border/70">
          <div className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
            <Beaker className="h-4 w-4 text-primary" />
            <span>Chemical Autonomy &amp; Projected Run-Out</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {chemSupply.map((chem) => {
              const isLow = chem.days < (result?.thresholds.chem_low_stock_days_min ?? 7);
              const isCritical = chem.days < (result?.thresholds.chem_low_stock_days_min ?? 7) / 2;
              return (
                <div
                  key={chem.name}
                  className={cn(
                    'p-2.5 rounded-lg border font-medium text-xs',
                    isCritical
                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-800 dark:text-rose-200'
                      : isLow
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-200'
                        : 'bg-muted/30 border-border/60 text-foreground',
                  )}
                >
                  <div className="text-2xs text-muted-foreground font-semibold">{chem.name}</div>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-sm font-bold font-mono">{chem.days.toFixed(1)}</span>
                    <span className="text-3xs text-muted-foreground">days of supply</span>
                  </div>
                  {isLow && (
                    <div className="text-3xs font-bold text-destructive mt-1 flex items-center gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" /> Reorder required
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Violations table with drill-down rows */}
      <ViolationsTable violations={result.violations} dailyRows={dailyRows} />
    </div>
  );
}
