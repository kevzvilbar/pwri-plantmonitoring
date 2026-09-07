import React, { useState, useMemo } from 'react';
import {
  TH, TH_DATE, TD,
} from '../TrendChartPivotShared';

/** Overview tab — aggregated columns only (matches original single-column layout) */
export function OverviewTable({
  metric,
  chartData,
  roTrainEntities,
}: {
  metric: string;
  chartData: any[];
  roTrainEntities?: { id: string; label: string }[];
}) {
  if (chartData.length === 0) {
    return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No data in selected range.</div>;
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
        <thead className="bg-muted/95">
          <tr>
            <th className={TH_DATE}>Date</th>
            {cols.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...chartData].reverse().map((d, i) => (
            <tr key={d.date} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
              <td className={[
                'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10',
                i % 2 === 0 ? 'bg-background' : 'bg-muted/10',
              ].join(' ')}>{d.date}</td>
              {cols.map((c) => <td key={c.key} className={TD}>{c.fmt(d)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
