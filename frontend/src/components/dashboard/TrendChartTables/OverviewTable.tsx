import React, { useState, useMemo } from 'react';
import {
  TH, TH_DATE, TD,
} from '../TrendChartPivotShared';

/** Overview tab — aggregated columns only (matches original single-column layout) */
export function OverviewTable({
  metric,
  chartData,
  roTrainEntities,
  phHealthByDate,
}: {
  metric: string;
  chartData: any[];
  roTrainEntities?: { id: string; label: string }[];
  phHealthByDate?: Map<string, {
    trainOnline: Record<string, boolean>;
    trainHours: Record<string, number>;
    onlineCount: number;
    offlineCount: number;
    healthPct: number | null;
    totalTrains: number;
  }>;
}) {
  if (chartData.length === 0) {
  if (chartData.length === 0 && metric !== 'plantHealth') {
    return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No data in selected range.</div>;
  }

  // For plantHealth, we drive the table from phHealthByDate directly
  if (metric === 'plantHealth') {
    if (!phHealthByDate || phHealthByDate.size === 0) {
      return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No RO readings in selected range.</div>;
    }
    const trains = roTrainEntities ?? [];
    // Build sorted date list from the map
    const sortedDates = Array.from(phHealthByDate.keys()).sort().reverse();

    // RO1..RO7 hold status text of very different lengths ("Offline" vs.
    // "Online (19h)"). Right-aligning that like a numeric column made every
    // column a different auto-width and made the text start position jump
    // from row to row. These columns are categorical, not magnitudes, so
    // give every train column the same fixed width and center the content
    // instead — that's what actually lines the grid up.
    const TH_STATUS = 'px-2 py-2 text-center text-2xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/80 align-bottom sticky top-0 z-20 bg-card w-[108px] min-w-[108px]';
    const TD_STATUS = 'px-2 py-2 text-center text-xs text-foreground/90 w-[108px] min-w-[108px]';
    const TH_SUMMARY = 'px-3 py-2 text-center text-2xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/80 align-bottom sticky top-0 z-20 bg-card w-[90px] min-w-[90px]';
    const TD_SUMMARY = 'px-3 py-2 text-center font-mono tabular-nums text-xs text-foreground/90 w-[90px] min-w-[90px]';

    return (
      <div className="h-full overflow-auto">
        <table className="w-full border-collapse text-xs table-fixed">
          <thead className="bg-card">
            <tr>
              <th className={TH_DATE}>Date</th>
              {trains.map((t) => (
                <th key={t.id} className={TH_STATUS}>{t.label}</th>
              ))}
              <th className={TH_SUMMARY}>Online</th>
              <th className={TH_SUMMARY}>Health %</th>
            </tr>
          </thead>
          <tbody>
            {sortedDates.map((dk, i) => {
              const day = phHealthByDate.get(dk)!;
              const label = (() => {
                const d = new Date(dk + 'T00:00:00');
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              })();
              return (
                <tr key={dk} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
                  <td className={[
                    'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10 border-r border-border shadow-[4px_0_6px_-2px_rgba(0,0,0,0.06)]',
                    i % 2 === 0 ? 'bg-card' : 'bg-muted',
                  ].join(' ')}>{label}</td>
                  {trains.map((t) => {
                    const online = day.trainOnline[t.id] ?? false;
                    const hours = day.trainHours[t.id] ?? 0;
                    return (
                      <td key={t.id} className={TD_STATUS}>
                        {online ? (
                          <span className="inline-flex items-center justify-center gap-1 w-full">
                            <span className="text-green-600 font-semibold">Online</span>
                            {hours < 24 && (
                              // Zero-padded so every value is 2 digits (00–23h) —
                              // keeps the "(Xh)" suffix a constant width down the column.
                              <span className="text-muted-foreground font-mono tabular-nums">
                                ({String(hours).padStart(2, '0')}h)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-destructive font-semibold">Offline</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={TD_SUMMARY}>
                    <span className="font-semibold">
                      {day.onlineCount}/{day.totalTrains}
                    </span>
                  </td>
                  <td className={TD_SUMMARY}>
                    {day.healthPct != null ? (
                      <span className={day.healthPct < 50 ? 'text-destructive font-semibold' : day.healthPct < 100 ? 'text-amber-600 font-semibold' : 'text-green-600 font-semibold'}>
                        {day.healthPct}%
                      </span>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Determine columns for this metric
  type ColDef = { key: string; label: string; fmt: (d: any) => React.ReactNode };

  const cols: ColDef[] = [];

  if (metric === 'production' || metric === 'nrw') {
    cols.push({
      key: 'production', label: 'Production (m³)',
      fmt: (d) => d.production != null ? <span className={d.production < 0 ? 'text-destructive font-semibold' : ''}>{d.production.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
    });
    cols.push({
      key: 'consumption', label: 'Consumption (m³)',
      fmt: (d) => d.consumption != null ? <span className={d.consumption < 0 ? 'text-destructive font-semibold' : ''}>{d.consumption.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
    });
  }
  if (metric === 'nrw') {
    cols.push({
      key: 'nrw', label: 'NRW (%)',
      fmt: (d) => <span className={d.nrw != null && d.nrw > 20 ? 'text-danger font-semibold' : ''}>{d.nrw != null ? d.nrw + '%' : '—'}</span>,
    });
  }
  if (metric === 'rawwater') {
    cols.push({
      key: 'rawwater', label: 'Raw Water (m³)',
      fmt: (d) => d.rawwater != null ? <span className={d.rawwater < 0 ? 'text-destructive font-semibold' : ''}>{d.rawwater.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
    });
  }
  if (metric === 'recovery') {
    if (roTrainEntities && roTrainEntities.length > 0) {
      roTrainEntities.forEach((e) => {
        cols.push({
          key: `train_recovery_${e.id}`,
          label: `${e.label} (%)`,
          fmt: (d) => d.trainRecoveries?.[e.id] != null
            ? <span className={d.trainRecoveries[e.id] < 0 ? 'text-destructive font-semibold' : ''}>{d.trainRecoveries[e.id]}%</span>
            : <span className="text-muted-foreground/40">—</span>,
        });
      });
    }
    cols.push({
      key: 'recovery',
      label: roTrainEntities && roTrainEntities.length > 1 ? 'Avg Recovery (%)' : 'Overall Recovery (%)',
      fmt: (d) => d.recovery != null ? d.recovery + '%' : <span className="text-muted-foreground/40">—</span>,
    });
  }
  if (metric === 'tds') {
    if (roTrainEntities && roTrainEntities.length > 0) {
      roTrainEntities.forEach((e) => {
        cols.push({
          key: `train_tds_${e.id}`,
          label: `${e.label} (ppm)`,
          fmt: (d) => d.trainTds?.[e.id] != null
            ? <span className={d.trainTds[e.id] < 0 ? 'text-destructive font-semibold' : ''}>{d.trainTds[e.id]} ppm</span>
            : <span className="text-muted-foreground/40">—</span>,
        });
      });
    }
    cols.push({
      key: 'tds',
      label: roTrainEntities && roTrainEntities.length > 1 ? 'Avg Permeate TDS (ppm)' : 'Permeate TDS (ppm)',
      fmt: (d) => d.tds != null ? d.tds + ' ppm' : <span className="text-muted-foreground/40">—</span>,
    });
  }
  if (metric === 'pv') {
    cols.push(
      { key: 'production', label: 'Production (m³)', fmt: (d) => d.production != null ? <span className={d.production < 0 ? 'text-destructive font-semibold' : ''}>{d.production.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—' },
      { key: 'kwh', label: 'Grid (kWh)', fmt: (d) => d.kwh != null ? <span className={d.kwh < 0 ? 'text-destructive font-semibold' : ''}>{d.kwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—' },
      { key: 'solarKwh', label: 'Solar (kWh)', fmt: (d) => (d.solarKwh ?? 0) !== 0 ? <span className={d.solarKwh < 0 ? 'text-destructive font-semibold' : ''}>{d.solarKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—' },
      { key: 'pvGrid', label: 'Grid PV (kWh/m³)', fmt: (d) => d.production > 0 ? (d.kwh / d.production).toFixed(2) : '—' },
      { key: 'pvTotal', label: '(Grid+Solar) PV (kWh/m³)', fmt: (d) => d.production > 0 && (d.kwh + d.solarKwh) > 0 ? ((d.kwh + d.solarKwh) / d.production).toFixed(2) : '—' },
    );
  }
  if (metric === 'productionCost') {
    cols.push(
      { key: 'powerCost', label: 'Power (₱/m³)', fmt: (d) => d.powerCost != null ? `₱${(+d.powerCost).toFixed(4)}/m³` : '—' },
      { key: 'chemCost',  label: 'Chem (₱/m³)',  fmt: (d) => d.chemCost  != null ? `₱${(+d.chemCost).toFixed(4)}/m³`  : '—' },
      { key: 'totalCost', label: 'Prod Cost (₱/m³)', fmt: (d) => d.totalCost != null ? `₱${(+d.totalCost).toFixed(4)}/m³` : '—' },
    );
  }
  // chemCost and powerCost are now part of productionCost (₱/m³ toggles)
  if (metric === 'kwh') {
    cols.push(
      {
        key: 'solarKwh',
        label: '☀ Solar (kWh)',
        fmt: (d) => (d.solarKwh ?? 0) !== 0
          ? <span className={+d.solarKwh < 0 ? 'text-destructive font-semibold' : ''}>{(+d.solarKwh).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          : <span className="text-muted-foreground/40">—</span>,
      },
      {
        key: 'kwh',
        label: '⚡ Grid (kWh)',
        fmt: (d) => (d.kwh ?? 0) !== 0
          ? <span className={+d.kwh < 0 ? 'text-destructive font-semibold' : ''}>{(+d.kwh).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          : <span className="text-muted-foreground/40">—</span>,
      },
      {
        key: 'totalKwh',
        label: 'Total (kWh)',
        fmt: (d) => {
          const t = (d.solarKwh ?? 0) + (d.kwh ?? 0);
          return t > 0
            ? <span className="font-semibold text-primary">{t.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            : <span className="text-muted-foreground/40">—</span>;
        },
      },
      {
        key: 'solarPct',
        label: 'Solar %',
        fmt: (d) => {
          const t = (d.solarKwh ?? 0) + (d.kwh ?? 0);
          return t > 0 && (d.solarKwh ?? 0) > 0
            ? <span className="text-warn font-medium">{(((d.solarKwh ?? 0) / t) * 100).toFixed(1)}%</span>
            : <span className="text-muted-foreground/40">—</span>;
        },
      },
    );
  }

  return (
    // Same fix as PivotTable above: one table, one scroll container, sticky
    // header instead of a second independently-scrolling header div.
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-card">
          <tr>
            <th className={TH_DATE}>Date</th>
            {cols.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...chartData].reverse().map((d, i) => (
            <tr key={d.date} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
              <td className={[
                'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10 border-r border-border shadow-[4px_0_6px_-2px_rgba(0,0,0,0.06)]',
                i % 2 === 0 ? 'bg-card' : 'bg-muted',
              ].join(' ')}>{d.date}</td>
              {cols.map((c) => <td key={c.key} className={TD}>{c.fmt(d)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
