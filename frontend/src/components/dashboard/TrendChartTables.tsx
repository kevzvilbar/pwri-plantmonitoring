// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md).
// PivotTable and OverviewTable are only used by DataSummaryPopup — the main
// TrendChart component doesn't reference either directly (verified before
// this extraction).

import React from 'react';
import { MessageCircleOff } from 'lucide-react';
import { reasonCategoryLabel, reasonEntityPrefix } from '@/lib/reasonCodes';
import {
  TH, TH_DATE, TH_TOTAL, TD, TD_TOTAL_COL,
  fmtV, fmtDateKey, useGapReasonLookup,
} from './TrendChartPivotShared';

/** Generic pivot table: Date rows × entity columns × Total column */
export function PivotTable({
  dates,
  entities,       // [{id, label}]
  pivot,          // dateKey → entityId → value
  totalLabel,
  unit = 'm³',
  colorClass = 'text-primary',
  entityType,
}: {
  dates: string[];
  entities: { id: string; label: string }[];
  pivot: Map<string, Map<string, number>>;
  totalLabel: string;
  unit?: string;
  colorClass?: string;
  /** Enables "why is this blank" reason lookups for blank cells. Omit (e.g. for
   *  product meters) to keep today's plain "—" behavior. */
  entityType?: 'well' | 'locator' | 'ro_train';
}) {
  const rowTotals = dates.map((d) =>
    entities.reduce((s, e) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
  );

  const getReason = useGapReasonLookup(entityType, entities, dates);

  if (entities.length === 0) {
    return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No entity data found.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed header — never scrolls */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <table className="border-collapse text-xs w-full table-fixed" style={{ minWidth: `${72 + entities.length * 72 + 80}px` }}>
          <colgroup>
            <col style={{ width: '72px', minWidth: '72px' }} />
            {entities.map((e) => <col key={e.id} style={{ minWidth: '72px' }} />)}
            <col style={{ width: '80px', minWidth: '80px' }} />
          </colgroup>
          <thead>
            <tr className="bg-muted/95">
              <th className={TH_DATE}>Date</th>
              {entities.map((e) => (
                <th key={e.id} className={TH} title={e.label}>
                  <div className="text-center leading-tight break-words hyphens-auto" style={{ wordBreak: 'break-word' }}>{e.label}</div>
                  <div className="text-3xs font-normal opacity-60 mt-0.5">{unit}</div>
                </th>
              ))}
              <th className={TH_TOTAL}>{totalLabel}<br /><span className="text-3xs font-normal opacity-80">{unit}</span></th>
            </tr>
          </thead>
        </table>
      </div>
      {/* Scrollable body */}
      <div className="overflow-auto flex-1">
        <table className="border-collapse text-xs w-full table-fixed" style={{ minWidth: `${72 + entities.length * 72 + 80}px` }}>
          <colgroup>
            <col style={{ width: '72px', minWidth: '72px' }} />
            {entities.map((e) => <col key={e.id} style={{ minWidth: '72px' }} />)}
            <col style={{ width: '80px', minWidth: '80px' }} />
          </colgroup>
          <tbody>
            {[...dates].reverse().map((date, di) => {
              const isEven = di % 2 === 0;
              const rowIdx = dates.length - 1 - di;
              const rowTotal = rowTotals[rowIdx];
              return (
                <tr key={date} className={isEven ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
                  <td className={[
                    'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 border-r border-border',
                    isEven ? 'bg-background' : 'bg-muted/10',
                  ].join(' ')}>
                    {fmtDateKey(date)}
                  </td>
                  {entities.map((e) => {
                    const val = pivot.get(date)?.get(e.id) ?? null;
                    const reason = val == null ? getReason(e.id, date) : null;
                    return (
                      <td key={e.id} className={TD}>
                        {reason ? (
                          <span
                            title={`${reasonEntityPrefix(entityType!, reason.source === 'status')}: ${reasonCategoryLabel(reason.category)}${reason.detail ? ' — ' + reason.detail : ''}`}
                            className="inline-flex items-center justify-center text-warn cursor-help"
                          >
                            <MessageCircleOff className="h-3 w-3" />
                          </span>
                        ) : fmtV(val)}
                      </td>
                    );
                  })}
                  <td className={[
                    TD_TOTAL_COL,
                    colorClass,
                    isEven ? 'bg-background' : 'bg-muted/10',
                  ].join(' ')}>
                    {rowTotal > 0 ? rowTotal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Overview tab — aggregated columns only (matches original single-column layout) */
export function OverviewTable({
  metric,
  chartData,
}: {
  metric: string;
  chartData: any[];
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
      fmt: (d) => d.production != null ? d.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—',
    });
    cols.push({
      key: 'consumption', label: 'Consumption (m³)',
      fmt: (d) => d.consumption != null ? d.consumption.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—',
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
      fmt: (d) => d.rawwater != null ? d.rawwater.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—',
    });
  }
  if (metric === 'recovery') {
    cols.push({
      key: 'recovery', label: 'Recovery (%)',
      fmt: (d) => d.recovery != null ? d.recovery + '%' : '—',
    });
  }
  if (metric === 'tds') {
    cols.push({
      key: 'tds', label: 'Permeate TDS (ppm)',
      fmt: (d) => d.tds != null ? d.tds + ' ppm' : '—',
    });
  }
  if (metric === 'pv') {
    cols.push(
      { key: 'production', label: 'Production (m³)', fmt: (d) => d.production?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—' },
      { key: 'kwh', label: 'Grid (kWh)', fmt: (d) => d.kwh?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—' },
      { key: 'solarKwh', label: 'Solar (kWh)', fmt: (d) => d.solarKwh > 0 ? d.solarKwh?.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—' },
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
        fmt: (d) => (d.solarKwh ?? 0) > 0
          ? (+d.solarKwh).toLocaleString(undefined, { maximumFractionDigits: 1 })
          : <span className="text-muted-foreground/40">—</span>,
      },
      {
        key: 'kwh',
        label: '⚡ Grid (kWh)',
        fmt: (d) => (d.kwh ?? 0) > 0
          ? (+d.kwh).toLocaleString(undefined, { maximumFractionDigits: 1 })
          : <span className="text-muted-foreground/40">—</span>,
      },
      {
        key: 'totalKwh',
        label: 'Total (kWh)',
        fmt: (d) => {
          const t = (d.solarKwh ?? 0) + (d.kwh ?? 0);
          return t > 0
            ? <span className="font-semibold text-primary">{t.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed header */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/95">
            <tr>
              <th className={TH_DATE}>Date</th>
              {cols.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}
            </tr>
          </thead>
        </table>
      </div>
      {/* Scrollable body */}
      <div className="overflow-auto flex-1">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {[...chartData].reverse().map((d, i) => (
              <tr key={d.date} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
                <td className={[
                  'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0',
                  i % 2 === 0 ? 'bg-background' : 'bg-muted/10',
                ].join(' ')}>{d.date}</td>
                {cols.map((c) => <td key={c.key} className={TD}>{c.fmt(d)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
