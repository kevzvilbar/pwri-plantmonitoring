import { Sun, Zap, BarChart2 } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import type { PowerHistoryRow } from '../hooks/usePowerHistoryQuery';

interface PowerKpiStripProps {
  hasSolar: boolean;
  hasGrid: boolean;
  rows: PowerHistoryRow[];
  rangeLabel: string;
}

export function PowerKpiStrip({ hasSolar, hasGrid, rows, rangeLabel }: PowerKpiStripProps) {
  const today     = rows.length ? rows[rows.length - 1] : null;
  const yesterday = rows.length > 1 ? rows[rows.length - 2] : null;

  const todaySolar = today?.solar ?? 0;
  const todayGrid  = today?.grid  ?? 0;
  const todayTotal = +(todaySolar + todayGrid).toFixed(2);
  const solarPct  = todayTotal > 0 ? +((todaySolar / todayTotal) * 100).toFixed(1) : 0;

  const solarDelta = yesterday && yesterday.solar > 0
    ? +(((todaySolar - yesterday.solar) / yesterday.solar) * 100).toFixed(1)
    : null;
  const gridDelta = yesterday && yesterday.grid > 0
    ? +(((todayGrid - yesterday.grid) / yesterday.grid) * 100).toFixed(1)
    : null;

  const rangeAggregates = (() => {
    let solarSum = 0, gridSum = 0;
    for (const r of rows) { solarSum += r.solar; gridSum += r.grid; }
    const totalKwh = +(solarSum + gridSum).toFixed(2);
    const avgDaily = rows.length ? +(totalKwh / rows.length).toFixed(1) : 0;
    const sp = totalKwh > 0 ? +((solarSum / totalKwh) * 100).toFixed(1) : 0;
    return { solarSum: +solarSum.toFixed(2), gridSum: +gridSum.toFixed(2), totalKwh, avgDaily, solarPct: sp };
  })();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {hasSolar && (
        <div className="rounded-xl border border-warn/70 bg-warn-soft/50 p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <div className="flex items-center gap-1.5">
              <Sun className="h-3.5 w-3.5 text-warn" />
              <span className="text-3xs font-bold uppercase tracking-wide text-warn">Today Solar</span>
            </div>
            {solarDelta !== null && (
              <span className={`text-2xs font-bold px-1.5 py-0.2 rounded-full ${solarDelta >= 0 ? 'bg-accent-soft text-accent' : 'bg-destructive/15 text-destructive'}`}>
                {solarDelta >= 0 ? '↑' : '↓'} {Math.abs(solarDelta)}%
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-numeral tabular-nums text-foreground">{fmtNum(todaySolar)}</span>
            <span className="text-2xs text-muted-foreground font-semibold">kWh</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-1">Solar PV Generation</p>
        </div>
      )}

      {hasGrid && (
        <div className="rounded-xl border border-info/70 bg-info-soft/50 p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <div className="flex items-center gap-1.5">
              <GridPylonIcon className="h-3.5 w-3.5 text-info" />
              <span className="text-3xs font-bold uppercase tracking-wide text-info">Today Grid</span>
            </div>
            {gridDelta !== null && (
              <span className={`text-2xs font-bold px-1.5 py-0.2 rounded-full ${gridDelta <= 0 ? 'bg-accent-soft text-accent' : 'bg-destructive/15 text-destructive'}`}>
                {gridDelta >= 0 ? '↑' : '↓'} {Math.abs(gridDelta)}%
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-numeral tabular-nums text-foreground">{fmtNum(todayGrid)}</span>
            <span className="text-2xs text-muted-foreground font-semibold">kWh</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-1">Utility Grid Infeed</p>
        </div>
      )}

      <div className="rounded-xl border border-primary/70 bg-primary-soft/50 p-3 shadow-2xs">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-3xs font-bold uppercase tracking-wide text-primary">Today Total</span>
          </div>
          {hasSolar && todayTotal > 0 && (
            <span className="text-2xs font-bold px-1.5 py-0.2 rounded-full bg-warn-soft text-warn border border-warn/40">
              {solarPct}% Solar
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold font-numeral tabular-nums text-foreground">{fmtNum(todayTotal)}</span>
          <span className="text-2xs text-muted-foreground font-semibold">kWh</span>
        </div>
        <p className="text-2xs text-muted-foreground mt-1">Plant Daily Power</p>
      </div>

      <div className="rounded-xl border border-border/80 bg-card p-3 shadow-2xs">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5">
            <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-3xs font-bold uppercase tracking-wide text-muted-foreground">Period Total</span>
          </div>
          <span className="text-2xs text-muted-foreground font-mono">{rangeLabel}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold font-numeral tabular-nums text-foreground">{fmtNum(rangeAggregates.totalKwh)}</span>
          <span className="text-2xs text-muted-foreground font-semibold">kWh</span>
        </div>
        <p className="text-2xs text-muted-foreground mt-1">
          Avg <strong className="text-foreground">{fmtNum(rangeAggregates.avgDaily)}</strong> kWh/day · {rangeAggregates.solarPct}% solar
        </p>
      </div>
    </div>
  );
}
