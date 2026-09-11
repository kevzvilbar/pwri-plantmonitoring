import { Sun, Zap } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { TrendBadge } from '../StatCard';

export interface KwhStatDataRow {
  date?: string;
  kwh?: number | null;
  solarKwh?: number | null;
  [key: string]: unknown;
}

export function TrendChartKwhStatCards({ chartData }: { chartData: KwhStatDataRow[] }) {
  const dataRows = chartData.filter((d) => (d.kwh ?? 0) > 0 || (d.solarKwh ?? 0) > 0);
  if (!dataRows.length) return null;

  const latest    = dataRows[dataRows.length - 1];
  const prevRow   = dataRows.length > 1 ? dataRows[dataRows.length - 2] : null;

  const latestSolar = +(latest.solarKwh ?? 0);
  const latestGrid  = +(latest.kwh      ?? 0);
  const latestTotal = +(latestSolar + latestGrid).toFixed(1);
  const solarPct    = latestTotal > 0 ? +((latestSolar / latestTotal) * 100).toFixed(1) : 0;

  const solarDelta  = prevRow && (prevRow.solarKwh ?? 0) > 0
    ? +(((latestSolar - (prevRow.solarKwh ?? 0)) / (prevRow.solarKwh ?? 0)) * 100).toFixed(1)
    : null;
  const gridDelta   = prevRow && (prevRow.kwh ?? 0) > 0
    ? +(((latestGrid - (prevRow.kwh ?? 0)) / (prevRow.kwh ?? 0)) * 100).toFixed(1)
    : null;

  const hasSolarData = chartData.some((d) => (d.solarKwh ?? 0) > 0);
  const hasGridData  = chartData.some((d) => (d.kwh      ?? 0) > 0);

  if (latestSolar === 0 && latestGrid === 0) return null;

  const fmtKwh = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div className="grid grid-cols-3 gap-2 mb-3 mt-1" data-testid="kwh-stat-cards">
      {hasSolarData && (
        <div
          className="rounded-[12px] border border-warn/40 bg-warn-soft/25 dark:bg-warn-soft/10 px-3 py-2.5 transition-all shadow-2xs"
          data-testid="kwh-stat-solar"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Sun className="h-3 w-3 text-warn shrink-0" />
            <span className="text-3xs font-bold uppercase tracking-wider text-warn font-mono">
              Solar · {latest.date}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono tabular-nums tracking-tight">{fmtKwh(latestSolar)}</span>
            <span className="text-xs font-medium text-muted-foreground">kWh</span>
          </div>
          {solarDelta !== null && (
            <div className="mt-1">
              <TrendBadge delta={solarDelta} />
            </div>
          )}
        </div>
      )}

      {hasGridData && (
        <div
          className="rounded-[12px] border border-info/40 bg-info-soft/25 dark:bg-info-soft/10 px-3 py-2.5 transition-all shadow-2xs"
          data-testid="kwh-stat-grid"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <GridPylonIcon className="h-3.5 w-3.5 text-info shrink-0" />
            <span className="text-3xs font-bold uppercase tracking-wider text-info font-mono">
              Grid · {latest.date}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono tabular-nums tracking-tight">{fmtKwh(latestGrid)}</span>
            <span className="text-xs font-medium text-muted-foreground">kWh</span>
          </div>
          {gridDelta !== null && (
            <div className="mt-1">
              <TrendBadge delta={gridDelta} invert />
            </div>
          )}
        </div>
      )}

      <div
        className={[
          'rounded-[12px] border border-primary/40 bg-primary-soft/25 dark:bg-primary-soft/10 px-3 py-2.5 transition-all shadow-2xs',
          !hasSolarData || !hasGridData ? 'col-span-2' : '',
        ].join(' ')}
        data-testid="kwh-stat-total"
      >
        <div className="flex items-center gap-1.5 mb-1">
          <Zap className="h-3 w-3 text-primary shrink-0" />
          <span className="text-3xs font-bold uppercase tracking-wider text-primary font-mono">
            Total · {latest.date}
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold font-mono tabular-nums tracking-tight">{fmtKwh(latestTotal)}</span>
          <span className="text-xs font-medium text-muted-foreground">kWh</span>
        </div>
        {hasSolarData && latestSolar > 0 && (
          <p className="text-2xs mt-1 text-muted-foreground font-medium font-mono">
            Solar:{' '}
            <span className="font-bold text-warn">{solarPct}%</span>
            {' '}of mix
          </p>
        )}
      </div>
    </div>
  );
}
