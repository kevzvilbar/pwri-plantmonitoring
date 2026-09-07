import { Sun, Zap } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';

export function TrendChartKwhStatCards({ chartData }: { chartData: any[] }) {
  const dataRows = chartData.filter((d: any) => (d.kwh ?? 0) > 0 || (d.solarKwh ?? 0) > 0);
  if (!dataRows.length) return null;

  const latest    = dataRows[dataRows.length - 1] as any;
  const prevRow   = dataRows.length > 1 ? dataRows[dataRows.length - 2] as any : null;

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

  const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
  const hasGridData  = chartData.some((d: any) => (d.kwh      ?? 0) > 0);

  if (latestSolar === 0 && latestGrid === 0) return null;

  const fmtKwh = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div className="grid grid-cols-3 gap-2 mb-3 mt-1" data-testid="kwh-stat-cards">
      {hasSolarData && (
        <div
          className="rounded-xl border border-warn/70 bg-warn-soft/50 px-3 py-3"
          data-testid="kwh-stat-solar"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sun className="h-3 w-3 text-warn shrink-0" />
            <span className="text-3xs font-bold uppercase tracking-[0.08em] text-warn">
              Solar · {latest.date}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums tracking-tight">{fmtKwh(latestSolar)}</span>
            <span className="text-xs font-medium text-muted-foreground">kWh</span>
          </div>
          {solarDelta !== null && (
            <p className={[
              'text-2xs mt-0.5 font-semibold',
              solarDelta >= 0 ? 'text-accent' : 'text-danger',
            ].join(' ')}>
              {solarDelta >= 0 ? '↑' : '↓'} {Math.abs(solarDelta)}% vs prev day
            </p>
          )}
        </div>
      )}

      {hasGridData && (
        <div
          className="rounded-xl border border-info/70 bg-info-soft/50 px-3 py-3"
          data-testid="kwh-stat-grid"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <GridPylonIcon className="h-3.5 w-3.5 text-info shrink-0" />
            <span className="text-3xs font-bold uppercase tracking-[0.08em] text-info">
              Grid · {latest.date}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums tracking-tight">{fmtKwh(latestGrid)}</span>
            <span className="text-xs font-medium text-muted-foreground">kWh</span>
          </div>
          {gridDelta !== null && (
            <p className={[
              'text-2xs mt-0.5 font-semibold',
              gridDelta <= 0 ? 'text-accent' : 'text-danger',
            ].join(' ')}>
              {gridDelta >= 0 ? '↑' : '↓'} {Math.abs(gridDelta)}% vs prev day
            </p>
          )}
        </div>
      )}

      <div
        className={[
          'rounded-xl border border-primary/70 bg-primary-soft/50 px-3 py-3',
          !hasSolarData || !hasGridData ? 'col-span-2' : '',
        ].join(' ')}
        data-testid="kwh-stat-total"
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <Zap className="h-3 w-3 text-primary shrink-0" />
          <span className="text-3xs font-bold uppercase tracking-[0.08em] text-primary">
            Total · {latest.date}
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold tabular-nums tracking-tight">{fmtKwh(latestTotal)}</span>
          <span className="text-xs font-medium text-muted-foreground">kWh</span>
        </div>
        {hasSolarData && latestSolar > 0 && (
          <p className="text-2xs mt-0.5 text-muted-foreground font-medium">
            Solar:{' '}
            <span className="font-bold text-warn">{solarPct}%</span>
            {' '}of mix
          </p>
        )}
      </div>
    </div>
  );
}
