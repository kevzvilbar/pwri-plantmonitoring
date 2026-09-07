import React, { useMemo } from 'react';
import {
  TH, TH_DATE, TD, fmtDateKey,
  GRID_METER_OTHER_KEY, type GridMeterBreakdown, type GridMeterColumn,
} from '../TrendChartPivotShared';

// ── Grid-by-meter breakdown table (kWh Data Summary side table) ──────────────
// Sits next to the Solar vs Grid OverviewTable for metric === 'kwh'. Rows are
// date-for-date aligned with the left table via `dates` (the popup's
// overviewDates, yyyy-MM-dd keys) — days without per-meter data render as
// dashes. The Total column always equals the Solar vs Grid table's Grid (kWh)
// value for the same day (guaranteed by computeGridMeterBreakdown's parity
// with the chart's grid-kWh walk).
export function GridMeterBreakdownTable({
  dates,
  breakdown,
}: {
  dates: string[];
  breakdown: GridMeterBreakdown;
}) {
  const { columns, byDate, hasUnattributed } = breakdown;
  const cols: GridMeterColumn[] = hasUnattributed
    ? [...columns, {
        key: GRID_METER_OTHER_KEY,
        label: 'Other',
        title: 'Days recorded as a stored daily total without per-meter readings — cannot be attributed to a specific meter.',
      }]
    : columns;

  const colTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const c of cols) {
      let sum = 0;
      let hasAny = false;
      for (const dk of dates) {
        const v = byDate.get(dk)?.values[c.key];
        if (v != null) {
          sum += v;
          hasAny = true;
        }
      }
      totals[c.key] = hasAny ? sum : 0;
    }
    return totals;
  }, [cols, dates, byDate]);

  const grandTotal = useMemo(() => {
    return dates.reduce((s, dk) => s + (byDate.get(dk)?.total ?? 0), 0);
  }, [dates, byDate]);

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/95">
          <tr>
            <th className={TH_DATE}>Date</th>
            {cols.map((c) => <th key={c.key} className={TH} title={c.title}>{c.label}</th>)}
            <th className={TH}>Total (kWh)</th>
          </tr>
        </thead>
        <tbody>
          {[...dates].reverse().map((dk, i) => {
            const row = byDate.get(dk);
            return (
              <tr key={dk} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
                <td className={[
                  'px-3.5 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10',
                  i % 2 === 0 ? 'bg-background' : 'bg-muted/10',
                ].join(' ')}>
                  {fmtDateKey(dk)}
                </td>
                {cols.map((c) => {
                  const v = row?.values[c.key];
                  return (
                    <td key={c.key} className={TD}>
                      {v != null
                        ? <span className={v < 0 ? 'text-destructive font-semibold' : ''}>{v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  );
                })}
                <td className={TD}>
                  {row && row.total > 0
                    ? <span className="font-semibold text-primary">{row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t-2 border-border shadow-xs">
          <tr>
            <td className="px-3.5 py-2 text-left text-2xs font-bold text-foreground uppercase tracking-wider whitespace-nowrap sticky left-0 bottom-0 z-30 bg-card/95 backdrop-blur-sm border-t border-border">
              Total ({dates.length}d)
            </td>
            {cols.map((c) => {
              const colSum = colTotals[c.key] ?? 0;
              return (
                <td key={c.key} className="px-3 py-2 text-right font-bold font-mono tabular-nums text-xs text-foreground sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
                  {colSum > 0
                    ? colSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right font-bold font-mono tabular-nums text-xs text-primary sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              {grandTotal > 0
                ? grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : <span className="text-muted-foreground/40">—</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
