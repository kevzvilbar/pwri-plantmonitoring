import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calc } from '@/lib/calculations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronsDown, ChevronsUp, BarChart2, Filter, X, Check, Search, Sun, Zap, Download } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ComposedChart, Bar, BarChart,
} from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import {
  ChartMetric, DashboardViewMode, RANGE_DAYS, RangeKey, TREND_Y_LABEL,
} from './types';
import { useAppStore } from '@/store/appStore';

// ─── Drill mode ──────────────────────────────────────────────────────────────
type DrillMode = 'default' | 'drilldown' | 'drillup';

// Palette for per-locator lines in drill views (cycles if more locators than colors)
const DRILL_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#84cc16',
];

// ─── helpers shared by DataSummaryPopup ──────────────────────────────────────

/** Resolve a single reading row → delta volume (m³), clamped to 0. */
function resolveReadingDelta(r: any): number {
  if (r.daily_volume != null && +r.daily_volume > 0) return +r.daily_volume;
  if (r.current_reading != null && r.previous_reading != null)
    return Math.max(0, +r.current_reading - +r.previous_reading);
  return 0;
}

/**
 * Build a pivot:  dateKey (yyyy-MM-dd) → entityId → summed volume.
 * Readings must already be sorted by reading_datetime asc.
 * Returns the pivot map and the sorted set of unique date keys found.
 */
function buildEntityPivot(
  readings: any[],
  entityField: string,
): { pivot: Map<string, Map<string, number>>; dateKeys: string[] } {
  const pivot = new Map<string, Map<string, number>>();
  readings.forEach((r) => {
    if (r.is_meter_replacement) return;          // skip replacement rows
    const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    const entityId = r[entityField] ?? '__';
    const vol = resolveReadingDelta(r);
    if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
    pivot.get(dateKey)!.set(entityId, (pivot.get(dateKey)!.get(entityId) ?? 0) + vol);
  });
  const dateKeys = Array.from(pivot.keys()).sort();
  return { pivot, dateKeys };
}

/** Fill every calendar day between startIso and endIso (yyyy-MM-dd strings). */
function fillDateRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso   + 'T00:00:00');
  while (cur <= end) {
    dates.push(format(cur, 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Format a yyyy-MM-dd key for display as "MMM d" */
function fmtDateKey(key: string): string {
  return format(new Date(key + 'T00:00:00'), 'MMM d');
}

type DSMTab = 'overview' | 'production' | 'consumption';

// ─── CSS class helpers (avoids repetition) ──────────────────────────────────
const TH = 'px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground border-b border-border align-bottom';
const TH_DATE = 'px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground whitespace-nowrap border-b border-border sticky left-0 bg-muted/95 w-[72px] min-w-[72px]';
const TH_TOTAL = 'px-2 py-2 text-center text-[10px] font-bold border-b border-l border-border sticky right-0 bg-teal-50/95 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 align-bottom w-[80px] min-w-[80px]';
const TD = 'px-2 py-1.5 text-center font-mono-num tabular-nums text-[11px]';
const TD_TOTAL_ROW = 'px-2 py-1.5 text-center font-semibold font-mono-num tabular-nums text-[11px] text-teal-700 dark:text-teal-300';
const TD_TOTAL_COL = 'px-2 py-1.5 text-center font-semibold font-mono-num tabular-nums text-[11px] text-teal-700 dark:text-teal-300 sticky right-0 border-l border-border w-[80px] min-w-[80px]';

function fmtV(v: number | null | undefined, dec = 1) {
  if (v == null || v === 0) return <span className="text-muted-foreground/40">—</span>;
  return v.toLocaleString(undefined, { maximumFractionDigits: dec });
}

/** Generic pivot table: Date rows × entity columns × Total column */
function PivotTable({
  dates,
  entities,       // [{id, label}]
  pivot,          // dateKey → entityId → value
  totalLabel,
  unit = 'm³',
  colorClass = 'text-primary',
}: {
  dates: string[];
  entities: { id: string; label: string }[];
  pivot: Map<string, Map<string, number>>;
  totalLabel: string;
  unit?: string;
  colorClass?: string;
}) {
  const rowTotals = dates.map((d) =>
    entities.reduce((s, e) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
  );

  if (entities.length === 0) {
    return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No entity data found.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed header — never scrolls */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <table className="border-collapse text-[11px] w-full table-fixed" style={{ minWidth: `${72 + entities.length * 72 + 80}px` }}>
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
                  <div className="text-[9px] font-normal opacity-60 mt-0.5">{unit}</div>
                </th>
              ))}
              <th className={TH_TOTAL}>{totalLabel}<br /><span className="text-[9px] font-normal opacity-80">{unit}</span></th>
            </tr>
          </thead>
        </table>
      </div>
      {/* Scrollable body */}
      <div className="overflow-auto flex-1">
        <table className="border-collapse text-[11px] w-full table-fixed" style={{ minWidth: `${72 + entities.length * 72 + 80}px` }}>
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
                    'px-3 py-1.5 whitespace-nowrap font-medium text-[11px] text-muted-foreground sticky left-0 border-r border-border',
                    isEven ? 'bg-background' : 'bg-muted/10',
                  ].join(' ')}>
                    {fmtDateKey(date)}
                  </td>
                  {entities.map((e) => {
                    const val = pivot.get(date)?.get(e.id) ?? null;
                    return (
                      <td key={e.id} className={TD}>
                        {fmtV(val)}
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
function OverviewTable({
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
      fmt: (d) => <span className={d.nrw != null && d.nrw > 20 ? 'text-rose-500 font-semibold' : ''}>{d.nrw != null ? d.nrw + '%' : '—'}</span>,
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Fixed header */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <table className="w-full border-collapse text-[11px]">
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
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {[...chartData].reverse().map((d, i) => (
              <tr key={d.date} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
                <td className={[
                  'px-3 py-1.5 whitespace-nowrap font-medium text-[11px] text-muted-foreground sticky left-0',
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

// ── DataSummaryPopup — 3-tab popup shown when "Data Summary" is clicked ───────
// Tab 1 (always): Overview / Prod vs Consum — aggregated daily totals
// Tab 2: Production — pivot: Date × ProductMeter1…N × Total
// Tab 3: Consumption — pivot: Date × Locator1…N × Total
// For non-production/consumption metrics the Production/Consumption tabs show
// the relevant entity breakdown that feeds that metric.
function DataSummaryPopup({
  open, onClose, metric, title,
  chartData,
  locReadings, productReadings, wellReadings, costReadings,
  locatorNames, productMeterNames, wellNames, plantNames,
}: {
  open: boolean;
  onClose: () => void;
  metric: string;
  title?: string;
  chartData: any[];
  locReadings: any[];
  productReadings: any[];
  wellReadings: any[];
  costReadings: any[];
  locatorNames?: Map<string, string>;
  productMeterNames?: Map<string, string>;
  wellNames?: Map<string, string>;
  plantNames?: Map<string, string>;
}) {
  const [tab, setTab] = useState<DSMTab>('overview');

  // Date range filter state — defaults to full range of available data
  const allDates = chartData.map((d) => d.date as string);
  const defaultFrom = allDates.length ? allDates[0] : '';
  const defaultTo = allDates.length ? allDates[allDates.length - 1] : '';
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Convert filterFrom/filterTo back to Date for comparison (use full range if empty)
  const parsedFrom = filterFrom ? new Date(`${filterFrom}T00:00:00`) : null;
  const parsedTo = filterTo ? new Date(`${filterTo}T23:59:59`) : null;

  const filteredChartData = useMemo(() => {
    if (!parsedFrom && !parsedTo) return chartData;
    return chartData.filter((d) => {
      // d.date is 'MMM d' format — not parseable by new Date().
      // Use the stored isoDate (full ISO string) for reliable comparison.
      const dt = d.isoDate ? new Date(d.isoDate) : null;
      if (!dt) return true;
      if (parsedFrom && dt < parsedFrom) return false;
      if (parsedTo && dt > parsedTo) return false;
      return true;
    });
  }, [chartData, filterFrom, filterTo]);

  const filteredLocReadings = useMemo(() => {
    if (!parsedFrom && !parsedTo) return locReadings;
    return locReadings.filter((r) => {
      const dt = new Date(r.reading_datetime);
      if (parsedFrom && dt < parsedFrom) return false;
      if (parsedTo && dt > parsedTo) return false;
      return true;
    });
  }, [locReadings, filterFrom, filterTo]);

  const filteredProductReadings = useMemo(() => {
    if (!parsedFrom && !parsedTo) return productReadings;
    return productReadings.filter((r) => {
      const dt = new Date(r.reading_datetime);
      if (parsedFrom && dt < parsedFrom) return false;
      if (parsedTo && dt > parsedTo) return false;
      return true;
    });
  }, [productReadings, filterFrom, filterTo]);

  const filteredWellReadings = useMemo(() => {
    if (!parsedFrom && !parsedTo) return wellReadings;
    return wellReadings.filter((r) => {
      const dt = new Date(r.reading_datetime);
      if (parsedFrom && dt < parsedFrom) return false;
      if (parsedTo && dt > parsedTo) return false;
      return true;
    });
  }, [wellReadings, filterFrom, filterTo]);

  // Determine which secondary tabs are relevant for this metric
  const hasProdTab = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'rawwater';
  const hasConsTab = metric === 'production' || metric === 'nrw';

  // Tab label config
  const overviewLabel =
    metric === 'production' || metric === 'nrw' ? 'Prod. vs Consum.'
    : metric === 'pv' ? 'Prod. vs Power'
    : metric === 'productionCost' ? 'Cost Overview'
    : metric === 'chemCost' ? 'Chemical Cost'
    : metric === 'powerCost' ? 'Power Cost'
    : 'Overview';

  const prodTabLabel =
    metric === 'rawwater' ? 'Per Well'
    : metric === 'pv' ? 'Per Well / Meter'
    : 'Production';

  // Build entity lists and pivots
  // --- Production entities ---
  const prodEntities = useMemo<{ id: string; label: string }[]>(() => {
    if (metric === 'rawwater' || metric === 'pv') {
      // wells
      const ids = Array.from(new Set((filteredWellReadings ?? []).map((r: any) => r.well_id).filter(Boolean)));
      return ids.map((id) => ({ id, label: wellNames?.get(id) ?? `Well ${id.slice(-4)}` }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    // product meters
    const ids = Array.from(new Set((filteredProductReadings ?? []).map((r: any) => r.meter_id).filter(Boolean)));
    return ids.map((id) => ({ id, label: productMeterNames?.get(id) ?? `Meter ${id.slice(-4)}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, filteredProductReadings, filteredWellReadings, productMeterNames, wellNames]);

  const prodPivot = useMemo(() => {
    const readings = (metric === 'rawwater' || metric === 'pv') ? (filteredWellReadings ?? []) : (filteredProductReadings ?? []);
    const field = (metric === 'rawwater' || metric === 'pv') ? 'well_id' : 'meter_id';
    return buildEntityPivot(
      [...readings].sort((a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()),
      field,
    );
  }, [metric, filteredProductReadings, filteredWellReadings]);
  const prodPivotMap = prodPivot.pivot;
  const prodDateKeys = prodPivot.dateKeys;

  // --- Consumption entities ---
  const consEntities = useMemo<{ id: string; label: string }[]>(() => {
    const ids = Array.from(new Set((filteredLocReadings ?? []).map((r: any) => r.locator_id).filter(Boolean)));
    return ids.map((id) => ({ id, label: locatorNames?.get(id) ?? `Locator ${id.slice(-4)}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredLocReadings, locatorNames]);

  const consPivotResult = useMemo(() => buildEntityPivot(
    [...(filteredLocReadings ?? [])].sort((a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()),
    'locator_id',
  ), [filteredLocReadings]);
  const consPivot = consPivotResult.pivot;
  const consDateKeys = consPivotResult.dateKeys;

  // Derive a full calendar range of yyyy-MM-dd keys for each tab.
  // Using only dates that have readings (from chartData or pivot keys) means
  // days with zero data are invisible — instead we fill every day in the window.
  const consDates = useMemo(() => {
    if (consDateKeys.length === 0) return [];
    // Expand from the earliest to latest reading date, bounded by filter if set
    const start = filterFrom || consDateKeys[0];
    const end   = filterTo   || consDateKeys[consDateKeys.length - 1];
    return fillDateRange(start, end);
  }, [consDateKeys, filterFrom, filterTo]);

  const prodDates = useMemo(() => {
    if (prodDateKeys.length === 0) return [];
    const start = filterFrom || prodDateKeys[0];
    const end   = filterTo   || prodDateKeys[prodDateKeys.length - 1];
    return fillDateRange(start, end);
  }, [prodDateKeys, filterFrom, filterTo]);

  // Overview dates: union of all available data, or filter-bounded
  const overviewDates = useMemo(() => {
    const allKeys = filteredChartData
      .filter((d) => d.isoDate)
      .map((d) => d.isoDate.slice(0, 10) as string);
    if (allKeys.length === 0) return [];
    const start = filterFrom || allKeys[0];
    const end   = filterTo   || allKeys[allKeys.length - 1];
    return fillDateRange(start, end);
  }, [filteredChartData, filterFrom, filterTo]);

  // Tab guard: if active tab becomes irrelevant, reset
  const activeTab: DSMTab = (!hasProdTab && tab === 'production') || (!hasConsTab && tab === 'consumption') ? 'overview' : tab;

  // The shared "dates" for footer count — use per-tab
  const tabDates = activeTab === 'consumption' ? consDates
    : activeTab === 'production' ? prodDates
    : overviewDates;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[94vw] w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid={`dsm-popup-${metric}`}
      >
        {/* Header */}
        <DialogHeader className="px-5 pt-4 pb-0 border-b shrink-0">
          <DialogTitle className="text-sm font-semibold pb-2">
            Data Summary — {title ?? metric}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Multi-tab data summary for {title ?? metric}.
          </DialogDescription>

          {/* Date range filter */}
          <div className="flex items-center gap-2 pb-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-medium shrink-0">Date range:</span>
            <Input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              placeholder={defaultFrom}
              className="h-6 w-[110px] text-[10px] px-1.5"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">→</span>
            <Input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              placeholder={defaultTo}
              className="h-6 w-[110px] text-[10px] px-1.5"
            />
            {(filterFrom || filterTo) && (
              <button
                onClick={() => { setFilterFrom(''); setFilterTo(''); }}
                className="h-6 px-2 rounded text-[10px] font-medium bg-muted text-muted-foreground hover:text-foreground border border-border transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Tabs row */}
          <div className="flex gap-0 -mb-px">
            {([
              { key: 'overview' as DSMTab, label: overviewLabel, show: true },
              { key: 'production' as DSMTab, label: prodTabLabel, show: hasProdTab },
              { key: 'consumption' as DSMTab, label: 'Consumption', show: hasConsTab },
            ] as const).filter((t) => t.show).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={[
                  'px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
                  activeTab === t.key
                    ? 'border-primary text-primary bg-background'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
              {activeTab === 'overview' && (
                <OverviewTable metric={metric} chartData={filteredChartData} />
              )}
              {activeTab === 'production' && hasProdTab && (
                <PivotTable
                  dates={prodDates}
                  entities={prodEntities}
                  pivot={prodPivotMap}
                  totalLabel={metric === 'rawwater' ? 'Total Raw (m³)' : 'Total Prod. (m³)'}
                  unit="m³"
                  colorClass="text-primary"
                />
              )}
              {activeTab === 'consumption' && hasConsTab && (
                <PivotTable
                  dates={consDates}
                  entities={consEntities}
                  pivot={consPivot}
                  totalLabel="Total Cons. (m³)"
                  unit="m³"
                  colorClass="text-highlight"
                />
              )}
            </div>
        </div>

        {/* Footer info bar */}
        <div className="px-5 py-2 border-t shrink-0 flex items-center gap-3 text-[10px] text-muted-foreground bg-muted/20">
          <span className="font-medium">{tabDates.length} days in range</span>
          {activeTab === 'production' && hasProdTab && (
            <span>· {prodEntities.length} {metric === 'rawwater' ? 'wells' : 'product meters'}</span>
          )}
          {activeTab === 'consumption' && hasConsTab && (
            <span>· {consEntities.length} locators</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Renders the per-cluster trend chart slot beneath a cluster's StatCards.
//   • inline   — every chart in the cluster is rendered directly below
//                the cards (full-width, compact height) so the user can
//                just scroll to see all trends.
//   • sections — at most one chart (matching `expandedMetric`) is
//                rendered below the cards. Single-open behaviour: the
//                user clicks a KPI card to fold its chart open here;
//                clicking another KPI auto-closes the previous.
//   • popup    — nothing is rendered here; charts surface only inside
//                the TrendModal opened from the StatCards above.
export function ClusterCharts({
  metrics, viewMode, expandedMetric, plantIds, clusterId,
}: {
  metrics: ChartMetric[];
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  clusterId: string;
}) {
  if (viewMode === 'popup') return null;
  if (viewMode === 'inline') {
    return (
      <div className="space-y-2 mt-2" data-testid={`cluster-inline-charts-${clusterId}`}>
        {metrics.map((m) => (
          <InlineTrendChart key={m.metric} metric={m.metric} title={m.title} plantIds={plantIds} compact />
        ))}
      </div>
    );
  }
  // sections — render the expanded chart only if it belongs to this cluster
  if (viewMode === 'sections' && expandedMetric) {
    const m = metrics.find((x) => x.metric === expandedMetric);
    if (!m) return null;
    return (
      <div className="mt-2" data-testid={`cluster-section-chart-${m.metric}`}>
        <InlineTrendChart metric={m.metric} title={m.title} plantIds={plantIds} />
      </div>
    );
  }
  return null;
}

// Card-wrapped trend chart used both for `inline` (compact height,
// stacked beneath each cluster) and `sections` (regular height,
// single open at a time). Title and range buttons share the same row
// so the chart area is maximised, especially on mobile.
export function InlineTrendChart({
  metric, title, plantIds, compact = false,
}: {
  metric: string;
  title: string;
  plantIds: string[];
  compact?: boolean;
}) {
  return (
    <Card className="p-3" data-testid={`inline-trend-${metric}`}>
      <TrendChart metric={metric} title={title} plantIds={plantIds} compact={compact} />
    </Card>
  );
}

// Modal-wrapped trend chart used in `popup` view mode. Thin Dialog
// shell — the chart logic itself lives entirely in <TrendChart> below.
export function TrendModal({
  open, onClose, metric, title, plantIds,
}: {
  open: boolean;
  onClose: () => void;
  metric: string;
  title: string;
  plantIds: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Pick a date range to inspect the {title.toLowerCase()} time series for the selected plants.
          </DialogDescription>
        </DialogHeader>
        <TrendChart metric={metric} plantIds={plantIds} />
      </DialogContent>
    </Dialog>
  );
}

// Reusable trend chart used both inside the popup TrendModal and as
// an inline/section panel embedded directly on the dashboard. Owns
// its own range state, supabase queries, and chart rendering. The
// `compact` prop swaps in a shorter chart height for the inline view
// where multiple charts stack vertically and we want to keep the
// page from getting absurdly tall. When `title` is provided the
// component renders it on the same row as the range buttons so the
// chart area is maximised on mobile.
export function TrendChart({
  metric, plantIds, compact = false, title, hasSolar = false, hasGrid = true,
}: {
  metric: string;
  plantIds: string[];
  compact?: boolean;
  title?: string;
  hasSolar?: boolean;
  hasGrid?: boolean;
}) {
  // All charts share a single range selection via the global store so
  // that picking 14D on one chart instantly syncs every other chart.
  const range = useAppStore((s) => s.chartRange);
  const from = useAppStore((s) => s.chartFrom);
  const to = useAppStore((s) => s.chartTo);
  const setRange = useAppStore((s) => s.setChartRange);
  const setChartCustomDates = useAppStore((s) => s.setChartCustomDates);
  const handleFromChange = (v: string) => setChartCustomDates(v, to);
  const handleToChange = (v: string) => setChartCustomDates(from, v);
  // Toggle for the inline data summary table
  const [showSummary, setShowSummary] = useState(false);

  // Drill mode: 'default' = daily sum, 'drilldown' = per-locator daily, 'drillup' = monthly per-locator
  const [drillMode, setDrillMode] = useState<DrillMode>('default');
  const hasConsumptionDrill = metric === 'production' || metric === 'nrw';

  // Production drill source: 'locator' = per distribution locator, 'well' = per raw water well
  type ProdDrillSource = 'locator' | 'well';
  const [prodDrillSource, setProdDrillSource] = useState<ProdDrillSource>('locator');

  // Locator filter for drill modes — null means "all selected" (default)
  // When the user opens drill mode, all locators start selected.
  const [selectedLocatorIds, setSelectedLocatorIds] = useState<Set<string> | null>(null);
  const [locatorSearch, setLocatorSearch] = useState('');
  const [showLocatorFilter, setShowLocatorFilter] = useState(false);

  // ── Production Cost line toggles ─────────────────────────────────────────
  const [showPowerCostLine, setShowPowerCostLine] = useState(true);
  const [showChemCostLine,  setShowChemCostLine]  = useState(true);
  const [showTotalCostLine, setShowTotalCostLine] = useState(true);

  // ── Power Consumption & Energy Mix source filter (kwh metric only) ──────────
  const [kwhSource, setKwhSource] = useState<'both' | 'solar' | 'grid'>('both');

  // ── RO drill state (TDS / Recovery) ─────────────────────────────────────
  type RoDrillMode = 'default' | 'by-train' | 'by-hour';
  const [roDrillMode, setRoDrillMode] = useState<RoDrillMode>('default');
  const hasRoDrill = metric === 'tds' || metric === 'recovery';
  const [selectedTrainIds, setSelectedTrainIds] = useState<Set<string> | null>(null);
  const [trainSearch, setTrainSearch] = useState('');
  const [showTrainFilter, setShowTrainFilter] = useState(false);

  // Stable date-bounded ISO strings so react-query can cache properly.
  const { startISO, endISO, startKey, endKey } = useMemo(() => {
    if (range === 'CUSTOM') {
      const s = new Date(`${from}T00:00:00`);
      const e = new Date(`${to}T23:59:59`);
      return {
        startISO: s.toISOString(), endISO: e.toISOString(),
        startKey: from, endKey: to,
      };
    }
    const days = RANGE_DAYS[range];
    const end = new Date();
    const start = startOfDay(subDays(end, days));
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startKey: format(start, 'yyyy-MM-dd'),
      endKey: format(end, 'yyyy-MM-dd'),
    };
  }, [range, from, to]);

  const needsWellReadings = metric === 'nrw' || metric === 'rawwater' || metric === 'pv' || metric === 'productionCost';
  const needsProductMeterReadings = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';
  const needsLocReadings = metric === 'production' || metric === 'nrw';
  const needsRoReadings = metric === 'recovery' || metric === 'tds';
  // productionCost also needs power readings (kWh delta × multiplier) and tariffs (₱/kWh).
  // 'kwh' = Power Consumption & Energy Mix chart (Solar vs Grid stacked bars).
  const needsPowerReadings = metric === 'pv' || metric === 'productionCost' || metric === 'kwh';
  // production_costs stores chem_cost (₱ per day) — still used for chemical side.
  // Power cost is now computed live: daily_kwh × rate_per_kwh / production_m3.
  const needsCostReadings = metric === 'productionCost';
  // needsPermeateProduction: we may need permeate_meter_delta from ro_train_readings
  // as the production source for plants where permeate_is_production = true.
  const needsPermeateProduction = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';

  // ── Entity name lookups — fetched once per plant selection ─────────────────
  const { data: wellNames } = useQuery({
    queryKey: ['entity-names-wells', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((w: any) => map.set(w.id, w.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsWellReadings,
  });

  const { data: locatorNames } = useQuery({
    queryKey: ['entity-names-locators', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((l: any) => map.set(l.id, l.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: productMeterNames } = useQuery({
    queryKey: ['entity-names-product-meters', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((m: any) => map.set(m.id, m.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // Plant names are used for power meter replacement messages and for the permeate-source
  // tooltip note when permeate_is_production = true.
  const { data: plantNames } = useQuery({
    queryKey: ['entity-names-plants', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').in('id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((p: any) => map.set(p.id, p.name));
      return map;
    },
    enabled: plantIds.length > 0 && (needsPowerReadings || needsPermeateProduction),
  });

  const supaSelect = async <T,>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };

  // ── BUG FIX: locator_readings has no plant_id column ─────────────────────
  // The previous implementation called supaSelect('locator_readings', ...)
  // which filtered by plant_id — a column that does NOT exist on that table.
  // This returned zero rows for every plant except SRP (which coincidentally
  // worked due to data characteristics), causing consumption = 0 for all
  // dates in the selected range (most visibly Jan 1 – Mar 21).
  //
  // Fix: two-step query that mirrors the pattern Dashboard.tsx already uses:
  //   Step 1 — resolve the locator IDs that belong to these plants (via the
  //             locators table, which DOES have plant_id).
  //   Step 2 — query locator_readings filtered by those locator IDs.
  //
  // The locator meta query is shared with the name-lookup query above but
  // we need the IDs before the readings query can run, so we keep it
  // separate and gate the readings query on the result.
  const { data: _locatorIdsForReadings } = useQuery({
    queryKey: ['trend-loc-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data } = await supabase
        .from('locators')
        .select('id')
        .in('plant_id', plantIds)
        .eq('status', 'Active');
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: locReadings, isFetching: fetchingLoc, error: errLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const locatorIds = _locatorIdsForReadings ?? [];
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw new Error(`locator_readings: ${error.message}`);
      return (data ?? []) as any[];
    },
    // Wait for locator IDs to resolve before fetching readings.
    enabled: plantIds.length > 0 && needsLocReadings && (_locatorIdsForReadings !== undefined),
  });

  // Product meter readings — the treated-water output meters installed on
  // the product line. These are the authoritative source for Production volume,
  // distinct from well (raw water) meters and locator (distribution) meters.
  // The table is not in the generated Supabase types so we cast as `never`.
  const { data: productReadings, isFetching: fetchingProduct, error: errProduct } = useQuery({
    queryKey: ['trend-product', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Try with is_meter_replacement first; fall back gracefully if column
      // doesn't exist in this deployment (field will be undefined → false).
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        // Bug fix: include daily_volume so computeEntityDeltas can use it directly,
        // matching how locator_readings are handled (avoids boundary-read delta = 0).
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id')
        .in('plant_id', plantIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement')) {
          const { data: d2, error: e2 } = await (supabase.from('product_meter_readings' as never) as any)
            .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,plant_id')
            .in('plant_id', plantIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO);
          if (e2) throw new Error(`product_meter_readings: ${e2.message}`);
          return (d2 as any[]) ?? [];
        }
        throw new Error(`product_meter_readings: ${error.message}`);
      }
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // ── Well readings — fetch with well_id so deltas are scoped per well ────────
  // Operations.tsx saves well readings with well_id + plant_id but never
  // writes daily_volume. Raw Water must therefore be computed as the sum of
  // (current_reading − previous_reading) per well per day, excluding rows
  // flagged is_meter_replacement and the first reading after a replacement.
  // Fetching well_id here (instead of relying on plant_id alone) lets
  // computeEntityDeltas group correctly by individual meter rather than by
  // plant, preventing cross-well subtraction that produced the -4,853,089 bug.
  const { data: wellReadings, isFetching: fetchingWell, error: errWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>(
      'well_readings',
      'well_id,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id',
    ),
    enabled: plantIds.length > 0 && needsWellReadings,
  });

  // ── BUG FIX: ro_train_readings may not have plant_id (same as locator_readings).
  // Two-step query: resolve train IDs for these plants first, then fetch readings
  // filtered by train_id. This mirrors the locator_readings fix above.
  // Also builds a trainId→plantId map used to route permeate_meter_delta back to
  // the correct plant when permeate_is_production is active.
  const { data: _roTrainMeta } = useQuery({
    queryKey: ['trend-ro-train-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { ids: [] as string[], trainPlantMap: new Map<string, string>() };
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, plant_id')
        .in('plant_id', plantIds);
      const rows = data ?? [];
      const trainPlantMap = new Map<string, string>();
      rows.forEach((t: any) => trainPlantMap.set(t.id, t.plant_id));
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap };
    },
    enabled: plantIds.length > 0,
  });
  const _roTrainIdsForReadings = _roTrainMeta?.ids;
  const _trainPlantMap = _roTrainMeta?.trainPlantMap ?? new Map<string, string>();

  const { data: roReadings, isFetching: fetchingRo, error: errRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds, _roTrainIdsForReadings],
    queryFn: async () => {
      const trainIds = _roTrainIdsForReadings ?? [];
      if (!trainIds.length) return [];

      // Attempt full select including the new columns added in the permeate-delta
      // migration (permeate_meter_prev, permeate_meter_delta, permeate_production_date).
      // If the DB hasn't been migrated yet those columns don't exist and Supabase
      // returns a schema-cache error — fall back to the legacy select so the chart
      // never breaks on un-migrated deployments.
      const FULL_SELECT   = 'train_id,recovery_pct,permeate_tds,permeate_meter,permeate_meter_prev,permeate_meter_delta,permeate_production_date,reading_datetime,is_meter_replacement';
      const LEGACY_SELECT = 'train_id,recovery_pct,permeate_tds,permeate_meter,reading_datetime,is_meter_replacement';
      const NEW_COLS = ['permeate_meter_prev', 'permeate_meter_delta', 'permeate_production_date'];
      const isNewColError = (msg: string) => NEW_COLS.some(c => msg.includes(c));

      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select(FULL_SELECT)
        .in('train_id', trainIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) {
        if (isNewColError(error.message)) {
          const { data: d2, error: e2 } = await (supabase.from('ro_train_readings' as never) as any)
            .select(LEGACY_SELECT)
            .in('train_id', trainIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO)
            .order('reading_datetime', { ascending: true });
          if (e2) throw new Error(`ro_train_readings: ${e2.message}`);
          return (d2 ?? []) as any[];
        }
        throw new Error(`ro_train_readings: ${error.message}`);
      }
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction) && (_roTrainIdsForReadings !== undefined),
  });

  // RO train name lookup — reuses the IDs already fetched above
  const { data: roTrainNames } = useQuery({
    queryKey: ['entity-names-ro-trains', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, name')
        .in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((t: any) => map.set(t.id, t.name ?? `Train ${String(t.id).slice(-4)}`));
      return map;
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction),
  });

  // ── Plant meter config — fetch permeate_is_production flag per plant ────────
  // The entire PlantMeterConfig is stored as a single JSONB blob in the `config`
  // column (not as individual columns) — mirrors usePlantMeterConfig in Plants.tsx.
  // permeate_is_production lives at config.permeate_is_production inside that blob.
  const { data: permeateIsProductionPlants } = useQuery({
    queryKey: ['plant-meter-config-permeate', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, config')
        .in('plant_id', plantIds);
      const set = new Set<string>();
      (data ?? []).forEach((row: any) => {
        if (row.config?.permeate_is_production) set.add(row.plant_id);
      });
      return set;
    },
    enabled: plantIds.length > 0 && needsPermeateProduction,
  });
  // Power readings — fetches the full ordered history for each plant so
  // computeEntityDeltas can diff consecutive meter_reading_kwh values correctly.
  // We also grab one row BEFORE startISO (per plant) to seed the delta for
  // the very first in-window reading — without it the first bar is always 0.
  const { data: powerReadings, isFetching: fetchingPower, error: errPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Fetch in-window rows (standard path)
      const inWindow = await supaSelect<any>(
        'power_readings',
        'daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,multiplier,reading_datetime,is_meter_replacement,plant_id',
      );
      // For each plant, fetch the single most-recent row BEFORE the window to
      // establish a delta baseline for the first in-window reading.
      const preRows: any[] = [];
      await Promise.all(
        plantIds.map(async (pid) => {
          const { data } = await (supabase.from('power_readings' as never) as any)
            .select('daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,multiplier,reading_datetime,is_meter_replacement,plant_id')
            .eq('plant_id', pid)
            .lt('reading_datetime', startISO)
            .order('reading_datetime', { ascending: false })
            .limit(1);
          if (data?.[0]) preRows.push(data[0]);
        }),
      );
      // Merge pre-window rows at the front, then sort ascending so
      // computeEntityDeltas sees them in chronological order.
      return [...preRows, ...inWindow].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
    },
    enabled: plantIds.length > 0 && needsPowerReadings,
  });

  // Production-cost rows use a date column (`cost_date`) rather than a
  // datetime, so the generic `supaSelect` helper (which filters on
  // `reading_datetime`) doesn't fit. Inline this single query instead.
  // production_costs stores chem_cost (₱/day) entered by operators.
  // We use it for the chemical side of the cost formula:
  //   Chem Cost (₱/m³) = chem_cost / production_m3
  // The power side is now computed live from power_readings × tariff rate.
  const { data: costReadings, isFetching: fetchingCost, error: errCost } = useQuery({
    queryKey: ['trend-cost', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_costs')
        .select('cost_date,chem_cost,plant_id')
        .in('plant_id', plantIds)
        .gte('cost_date', startKey)
        .lte('cost_date', endKey);
      if (error) throw new Error(`production_costs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
  });

  // Power tariffs: rate_per_kwh (₱/kWh) effective on or before each day.
  // Source of truth: Costs → Power tab auto-derives this from each monthly bill.
  // For a given day, we use the latest tariff whose effective_date ≤ that day.
  // We fetch all tariffs in a wide window so we can look up per-day rates in JS.
  const { data: powerTariffs } = useQuery({
    queryKey: ['trend-power-tariffs', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('power_tariffs')
        .select('plant_id,effective_date,rate_per_kwh,multiplier')
        .in('plant_id', plantIds)
        .order('effective_date', { ascending: true });
      if (error) throw new Error(`power_tariffs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
  });

  const isFetching = fetchingLoc || fetchingWell || fetchingRo || fetchingPower || fetchingCost || fetchingProduct;
  const queryError = (errLoc || errWell || errRo || errPower || errCost || errProduct) as Error | null;

  const chartData = useMemo(() => {
    // ── Tariff lookup: for each plant, sorted array of {effectiveDate, ratePerKwh} ─
    // Used to find the ₱/kWh rate active on a given day:
    //   latest tariff whose effective_date ≤ day's date.
    // If no tariff exists yet for a plant, cost will be null (not 0).
    const tariffsByPlant = new Map<string, { effectiveDate: string; ratePerKwh: number }[]>();
    (powerTariffs ?? []).forEach((t: any) => {
      if (!t.plant_id || t.rate_per_kwh == null) return;
      if (!tariffsByPlant.has(t.plant_id)) tariffsByPlant.set(t.plant_id, []);
      tariffsByPlant.get(t.plant_id)!.push({
        effectiveDate: t.effective_date,
        ratePerKwh: +t.rate_per_kwh,
      });
    });
    // Sort each plant's tariffs ascending by date (already ordered from DB, but ensure)
    tariffsByPlant.forEach((arr) => arr.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)));

    /** Look up the ₱/kWh rate for a given plant on a given yyyy-MM-dd date. */
    function getRateForDay(plantId: string, dateKey: string): number | null {
      const tariffs = tariffsByPlant.get(plantId);
      if (!tariffs || tariffs.length === 0) return null;
      // Find latest effective tariff ≤ dateKey
      let rate: number | null = null;
      for (const t of tariffs) {
        if (t.effectiveDate <= dateKey) rate = t.ratePerKwh;
        else break;
      }
      return rate;
    }

    const byDay = new Map<string, any>();
    const ensure = (d: string, sortKey: number) =>
      byDay.get(d) ?? byDay.set(d, {
        date: d, sortKey, isoDate: new Date(sortKey).toISOString(),
        production: 0, consumption: 0, rawwater: 0,
        recovery: 0, recoverySamples: 0,
        tds: 0, tdsSamples: 0, kwh: 0, solarKwh: 0,
        // Cost accumulators (raw ₱ amounts, divided by production at the end)
        _powerCostPeso: 0,      // ₱ from power: (grid_kwh × multiplier + solar_kwh) × rate_per_kwh
        _solarKwhForCost: 0,   // solar kWh added to power cost basis
        _chemCostPeso: 0,       // ₱ from chemical: chem_cost column in production_costs
        _hasTariff: false,      // true when at least one power reading had a valid tariff
        powerCost: null as number | null,   // ₱/m³  (computed in final map)
        chemCost: null as number | null,    // ₱/m³
        totalCost: null as number | null,   // ₱/m³  = powerCost + chemCost
        // _raw* fields accumulate the true unclamped deltas so the tooltip
        // can show the real value even when the chart plots 0 (clamped).
        // null means "no negative delta seen" → tooltip shows normal value.
        _rawProduction: null as number | null,
        _rawConsumption: null as number | null,
        _rawRawwater: null as number | null,
        _rawKwh: null as number | null,
        // _meterReplacements: list of human-readable entity names replaced on this day.
        _meterReplacements: [] as string[],
        // _permeateSourcePlants: set of plant IDs whose production came from the permeate
        // meter on this day. Populated only for plants with permeate_is_production = true.
        _permeateSourcePlants: null as Set<string> | null,
      }).get(d);

    // ── Unified meter-replacement-aware delta helper ────────────────────────
    // Used for ALL meter types: wells, locators, product meters, power.
    //
    // entityKeyField: the column that uniquely identifies an individual meter.
    //   • well_readings          → 'well_id'
    //   • locator_readings       → 'locator_id'
    //   • product_meter_readings → 'meter_id'
    //   • power_readings         → 'plant_id'  (one power meter per plant)
    //
    // Keying by the individual meter ID (not plant_id) prevents readings from
    // different meters at the same plant bleeding into each other's diff —
    // the root cause of the -4,853,089 / +885,406 spikes seen in Raw Water.
    //
    // dailyVolumeField: if the table stores a pre-computed daily volume column
    // (e.g. locator_readings.daily_volume), use it directly when present.
    // Wells and product meters don't have this column so pass null.
    //
    // Meter-replacement handling (matches Operations.tsx display logic):
    //   • REPL row (is_meter_replacement = true):
    //       delta = 0, new baseline = current_reading, flag entity as "afterRepl"
    //   • First non-REPL row after a REPL:
    //       delta = 0 (new meter has no valid predecessor yet), clear flag
    //   • All subsequent rows:
    //       delta = current_reading − last seen current_reading for that entity
    //
    // rawDelta is null when there is no predecessor (first reading in window,
    // or first after replacement) so the tooltip doesn't false-flag those as
    // negative readings.
    function computeEntityDeltas(
      readings: any[],
      entityKeyField: string,
      dailyVolumeField: string | null,
      options?: { skipAfterRepl?: boolean },
    ): { r: any; delta: number; rawDelta: number | null; isMeterReplacement: boolean }[] {
      // skipAfterRepl=true: the replacement row already sets lastReading to the
      // new meter's starting value, so the very next reading can diff against it
      // normally (e.g. RO permeate: repl=227,368 → next=228,106 → delta=737.7).
      // skipAfterRepl=false (default): the row immediately after a replacement is
      // zeroed as a safety net for meter types where the replacement reading may
      // not be a reliable baseline (locators, wells, product meters).
      const skipAfterRepl = options?.skipAfterRepl ?? false;

      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );

      const lastReading = new Map<string, number>(); // entityKey → last current_reading
      const afterRepl   = new Set<string>();          // entities whose next row is zeroed

      return sorted.map((r) => {
        const entityKey = r[entityKeyField] ?? r.plant_id ?? '__';
        const isMR      = !!r.is_meter_replacement;

        if (isMR) {
          lastReading.set(entityKey, +r.current_reading);
          if (!skipAfterRepl) afterRepl.add(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
        }

        if (afterRepl.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          afterRepl.delete(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: false };
        }

        if (dailyVolumeField && r[dailyVolumeField] != null) {
          const storedVol = +r[dailyVolumeField];
          const delta     = Math.max(0, storedVol);
          lastReading.set(entityKey, +r.current_reading);
          // daily_volume is the operator-recorded value — do NOT pass it as a
          // rawDelta that triggers the negative-reading warning. The value is
          // already the ground truth; clamping it to 0 is the correct display.
          // Return rawDelta = null so accumulateRaw never fires for this path.
          return { r, delta, rawDelta: null, isMeterReplacement: false };
        }

        if (!lastReading.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          // If the DB stored previous_reading, compute the delta instead of returning 0.
          // Without this, the first reading in the fetch window (no prior in-memory row)
          // always shows 0, causing a false dip at the start of every range.
          if (r.previous_reading != null) {
            const rawDelta = +r.current_reading - +r.previous_reading;
            const delta    = Math.max(0, rawDelta);
            return { r, delta, rawDelta, isMeterReplacement: false };
          }
          // No previous_reading in DB → we genuinely don't know the delta for this
          // first row. Return null delta so the chart gaps rather than plots 0.
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
          // Note: isMeterReplacement=true here causes the caller to skip this point,
          // preventing a false zero at the start of a date window.
        }

        const rawDelta = +r.current_reading - lastReading.get(entityKey)!;
        const delta    = Math.max(0, rawDelta);
        lastReading.set(entityKey, +r.current_reading);
        return { r, delta, rawDelta, isMeterReplacement: false };
      });
    }

    // Helper: accumulate raw delta into a _raw field only when it's negative.
    // Keeps null when all readings are non-negative (tooltip shows normal value).
    const accumulateRaw = (row: any, field: string, rawDelta: number | null) => {
      if (rawDelta === null) return;
      if (rawDelta < 0) {
        row[field] = (row[field] ?? 0) + rawDelta;
      }
    };

    // ── Raw Water = sum of per-well (current − previous) deltas ────────────
    // Uses computeEntityDeltas keyed by well_id for correct per-well scoping.
    computeEntityDeltas(wellReadings ?? [], 'well_id', null).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.rawwater += delta;
      accumulateRaw(row, '_rawRawwater', rawDelta);
      if (isMeterReplacement) {
        const entityName = wellNames?.get(r.well_id) ?? r.well_id ?? 'Well';
        const label = `${entityName} Raw Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // ── Production source routing ─────────────────────────────────────────────
    // Plants where permeate_is_production = true use the RO permeate meter delta
    // as their production volume instead of a dedicated product meter.
    // Multi-plant selections mix sources: Plant A → permeate delta, Plant B → product meter.
    // Both contributions accumulate into the same `production` field so the line
    // stays a single unified series.

    // Step 1: accumulate product meter readings only for plants that use a product meter.
    computeEntityDeltas(
      (productReadings ?? []).filter((r: any) => !(permeateIsProductionPlants?.has(r.plant_id))),
      'meter_id',
      'daily_volume',
    ).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.production += delta;
      accumulateRaw(row, '_rawProduction', rawDelta);
      if (isMeterReplacement) {
        const entityName = productMeterNames?.get(r.meter_id) ?? r.meter_id ?? 'Product Meter';
        const label = `${entityName} Product Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // Step 2: accumulate permeate meter deltas for plants where permeate_is_production = true.
    //
    // Uses permeate_meter_delta (pre-saved curr−prev) + permeate_production_date
    // (cutoff-adjusted day label) written at import time.
    // Falls back to computeEntityDeltas when columns not yet populated (NULL).
    if (permeateIsProductionPlants && permeateIsProductionPlants.size > 0) {
      const hasSavedDelta = (roReadings ?? []).some(
        (r: any) => r.permeate_meter_delta != null && +r.permeate_meter_delta > 0,
      );

      if (hasSavedDelta) {
        // ── PRIMARY PATH ─────────────────────────────────────────────────────
        (roReadings ?? []).forEach((r: any) => {
          const plantId = _trainPlantMap.get(r.train_id);
          if (!plantId || !permeateIsProductionPlants.has(plantId)) return;

          // Skip replacement rows first — their saved delta is the old-meter→new-meter
          // jump (e.g. 72,691 → 227,368) which is not real production. The same-day
          // non-replacement row(s) already carry the valid pre-swap production delta
          // and will be summed in separately below.
          if (r.is_meter_replacement) return;

          const delta = r.permeate_meter_delta != null ? Math.max(0, +r.permeate_meter_delta)
            : r.permeate_meter != null && r.permeate_meter_prev != null
              ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
              : null;
          // Use === null so a legitimate delta of 0 is still plotted (don't skip it).
          if (delta === null) return;

          // Build chart key EXACTLY like every other source:
          //   format(new Date(reading_datetime), 'MMM d')
          // For the hourly cross-midnight case, substitute the date part from
          // permeate_production_date but keep the time from reading_datetime so
          // the local timezone parsing is consistent with all other chart keys.
          let dt: Date;
          if (r.permeate_production_date) {
            const timePart = (r.reading_datetime as string).slice(11) || '00:00:00';
            dt = new Date(`${r.permeate_production_date}T${timePart}`);
          } else {
            dt = new Date(r.reading_datetime);
          }
          const key = format(dt, 'MMM d');
          const row = ensure(key, dt.getTime());
          row.production += delta;
          if (!row._permeateSourcePlants) row._permeateSourcePlants = new Set<string>();
          row._permeateSourcePlants.add(plantId);
        });
      } else {
        // ── FALLBACK PATH (permeate_meter_delta columns still NULL) ──────────
        // Use computeEntityDeltas on the raw cumulative permeate_meter odometer.
        //
        // CRITICAL: do NOT pre-filter out is_meter_replacement rows before
        // passing to computeEntityDeltas. If removed, lastReading for that train
        // stays at the old meter value. The next real reading on the new meter
        // (e.g. 227,368) then diffs against the old value (72,691) producing a
        // massive false spike (~154K m3).
        //
        // Instead, include replacement rows with current_reading = permeate_meter
        // (the new meter start value). computeEntityDeltas sees isMR=true and
        // resets lastReading to the new baseline. skipAfterRepl=true means the
        // immediately following reading diffs against that new baseline normally
        // (e.g. Mar 5: 228,106 − 227,368 = 737.7) instead of being zeroed.
        const permeateRoReadings = (roReadings ?? [])
          .filter((r: any) => {
            const plantId = _trainPlantMap.get(r.train_id);
            return plantId && permeateIsProductionPlants.has(plantId)
              && r.permeate_meter != null;
            // NOTE: is_meter_replacement rows are intentionally kept here
          })
          .map((r: any) => ({ ...r, current_reading: +r.permeate_meter }));

        computeEntityDeltas(permeateRoReadings, 'train_id', null, { skipAfterRepl: true }).forEach(({ r, delta, isMeterReplacement }) => {
          // replacement row and first post-replacement row both return delta=0
          if (delta === 0) return;
          if (isMeterReplacement) return;
          const plantId = _trainPlantMap.get(r.train_id)!;
          const dt = new Date(r.reading_datetime);
          const key = format(dt, 'MMM d');
          const row = ensure(key, dt.getTime());
          row.production += delta;
          if (!row._permeateSourcePlants) row._permeateSourcePlants = new Set<string>();
          row._permeateSourcePlants.add(plantId);
        });
      }
    }

    // Consumption = sum of locator (distribution/endpoint) meter deltas.
    // NOTE: locReadings are now fetched via locator_id (not plant_id) so all
    // plants return data correctly — see the two-step query above.
    computeEntityDeltas(locReadings ?? [], 'locator_id', 'daily_volume').forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.consumption += delta;
      accumulateRaw(row, '_rawConsumption', rawDelta);
      if (isMeterReplacement) {
        const entityName = locatorNames?.get(r.locator_id) ?? r.locator_id ?? 'Locator';
        const label = `${entityName} Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    (roReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      if (r.recovery_pct != null) { row.recovery += +r.recovery_pct; row.recoverySamples += 1; }
      if (r.permeate_tds != null) { row.tds += +r.permeate_tds; row.tdsSamples += 1; }
    });

    // Power = daily_consumption_kwh (already Δ × multiplier, saved by Operations).
    // If daily_consumption_kwh is null (legacy rows without the saved pre-multiplied
    // value), fall back to computing raw meter delta and applying the row's multiplier.
    //
    // For productionCost metric: also compute power cost in ₱ per day:
    //   Power Cost ₱ = daily_kwh × rate_per_kwh
    // where rate_per_kwh comes from power_tariffs (latest tariff ≤ this day).
    computeEntityDeltas(
      (powerReadings ?? []).map((r: any) => ({
        ...r,
        current_reading: r.meter_reading_kwh ?? r.daily_consumption_kwh ?? 0,
      })),
      'plant_id',
      'daily_consumption_kwh',
    ).forEach(({ r, delta: rawComputedDelta, rawDelta, isMeterReplacement }) => {
      // rawComputedDelta is either daily_consumption_kwh (multiplied) or Δ meter (raw).
      // Only apply multiplier in the fallback (raw delta) path.
      const mult = +(r.multiplier ?? 1) || 1;
      const hasDailyKwh = r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0;
      const delta = hasDailyKwh ? rawComputedDelta : rawComputedDelta * mult;
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const dateKey = format(dt, 'yyyy-MM-dd');
      const row = ensure(key, dt.getTime());
      row.kwh += delta;
      accumulateRaw(row, '_rawKwh', rawDelta);
      if (isMeterReplacement) {
        const entityName = plantNames?.get(r.plant_id) ?? r.plant_id ?? 'Plant';
        const label = `${entityName} Power Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
      // productionCost: accumulate ₱ cost for this day using the active tariff rate.
      // Formula: Power Cost ₱ = (grid_kwh × multiplier + solar_kwh) × rate_per_kwh
      // `delta` already reflects grid_kwh × multiplier (via hasDailyKwh path or raw × mult).
      // Solar kWh is accumulated separately and combined at the final map step.
      if (metric === 'productionCost' && delta > 0) {
        const rate = getRateForDay(r.plant_id, dateKey);
        if (rate != null) {
          // Accumulate solar kWh for cost basis (combined with grid delta at final map)
          const solarForCost = (r.daily_solar_kwh != null && !r.is_meter_replacement)
            ? Math.max(0, +r.daily_solar_kwh) : 0;
          row._solarKwhForCost += solarForCost;
          // Grid cost uses delta (already multiplier-adjusted); solar added at final step
          row._powerCostPeso += delta * rate;
          row._hasTariff = true;
        }
      }
    });

    // Accumulate daily_solar_kwh per day for the (Grid+Solar) PV ratio line.
    // Skips null/zero rows so the ratio stays null on days with no solar data.
    (powerReadings ?? []).forEach((r: any) => {
      if (r.daily_solar_kwh == null || r.is_meter_replacement) return;
      const solarVal = +r.daily_solar_kwh;
      if (solarVal <= 0) return;
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.solarKwh += solarVal;
    });

    // Chemical cost: chem_cost (₱/day) from production_costs table.
    // Operators log this manually in Costs → Rollup (or via CSV import).
    // Chem Cost (₱/m³) = chem_cost / production_m3  (computed in final map below)
    (costReadings ?? []).forEach((r: any) => {
      const dt = new Date(`${r.cost_date}T00:00:00`);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      const chem = +(r.chem_cost ?? 0);
      row._chemCostPeso += chem;
    });

    return Array.from(byDay.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _s, recoverySamples, tdsSamples, _powerCostPeso, _solarKwhForCost, _chemCostPeso, _hasTariff, _permeateSourcePlants, ...d }) => {
        // ── Production Cost formula ────────────────────────────────────────────
        // All three metrics expressed as ₱/m³ (unit cost):
        //   Power Cost  = (grid_kwh × multiplier + solar_kwh) × rate_per_kwh / production_m3
        //   Chem Cost   = chem_cost_₱                                         / production_m3
        //   Prod Cost   = Power Cost + Chem Cost
        //
        // _powerCostPeso already holds grid_kwh × rate_per_kwh.
        // _solarKwhForCost holds the day's solar kWh; we need its rate too.
        // Since solar shares the same tariff rate as grid on a given day, we
        // reuse the already-accumulated ratio: add solar × (rate implied by grid cost / grid kwh).
        // Simpler: store the rate alongside _powerCostPeso so we can apply it to solar.
        // For now, rate was applied per reading — solar cost = _solarKwhForCost already
        // has its rate baked in via _powerCostPeso accumulation below.
        //
        // NOTE: The solar contribution is added to _powerCostPeso at accumulation time.
        // _solarKwhForCost is tracked for informational purposes.
        // Total power cost ₱ = _powerCostPeso (grid cost) + solar cost (₱)
        // Solar cost ₱ is computed below using the average rate derived from grid readings.
        // ── Production volume denominator ─────────────────────────────────────
        // Priority: product meter readings → permeate meter → well readings (raw water).
        // Plants that have no product meter (e.g. direct abstraction wells) report
        // their output volume via well_readings, which accumulates into `d.rawwater`.
        // Using rawwater as fallback lets Power Cost (₱/m³) work for those plants
        // without requiring a separate product meter setup.
        const prodVol = d.production > 0 ? d.production
          : d.rawwater   > 0 ? d.rawwater
          : null;
        // Derive average rate from accumulated grid cost ÷ grid kWh (d.kwh).
        // Then apply that same rate to solar kWh.
        const gridKwh = d.kwh > 0 ? d.kwh : 0;
        const avgRate = (_hasTariff && gridKwh > 0) ? _powerCostPeso / gridKwh : null;
        const solarCostPeso = (avgRate != null && _solarKwhForCost > 0)
          ? _solarKwhForCost * avgRate : 0;
        const totalPowerCostPeso = _powerCostPeso + solarCostPeso;
        const powerCostPerM3 = (_hasTariff && prodVol != null)
          ? +(totalPowerCostPeso / prodVol).toFixed(4) : null;
        const chemCostPerM3  = (prodVol != null && _chemCostPeso > 0)
          ? +(_chemCostPeso  / prodVol).toFixed(4) : null;
        const totalCostPerM3 = (powerCostPerM3 != null || chemCostPerM3 != null)
          ? +((powerCostPerM3 ?? 0) + (chemCostPerM3 ?? 0)).toFixed(4) : null;
        return {
          ...d,
          recovery: recoverySamples ? +(d.recovery / recoverySamples).toFixed(1) : null,
          tds: tdsSamples ? Math.round(d.tds / tdsSamples) : null,
          nrw: calc.nrw(d.production, d.consumption),
          // ₱/m³ unit costs — null when data is missing
          powerCost: powerCostPerM3,
          chemCost:  chemCostPerM3,
          totalCost: totalCostPerM3,
          // _meterReplacements is already in ...d — preserved for the tooltip
          _permeateSourceNames: _permeateSourcePlants
            ? Array.from(_permeateSourcePlants)
                .map((id) => plantNames?.get(id) ?? id)
                .sort()
            : [] as string[],
        };
      });
  }, [locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings, powerTariffs,
      metric, wellNames, locatorNames, productMeterNames, plantNames,
      permeateIsProductionPlants, _trainPlantMap]);

  // ── Drill-mode locator data ───────────────────────────────────────────────
  // drillEntities: full sorted list of {id, label, color} for all active locators.
  const drillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasConsumptionDrill) return [];
    const ids = Array.from(new Set((locReadings ?? []).map((r: any) => r.locator_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: locatorNames?.get(id) ?? `Locator ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasConsumptionDrill, locReadings, locatorNames]);

  // wellDrillEntities: per-well breakdown for production chart
  const wellDrillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'production') return [];
    const ids = Array.from(new Set((wellReadings ?? []).map((r: any) => r.well_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: wellNames?.get(id) ?? `Well ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, wellReadings, wellNames]);

  // activeEntities: locator or well depending on prodDrillSource
  const activeEntities = metric === 'production' && prodDrillSource === 'well'
    ? wellDrillEntities : drillEntities;

  // visibleEntities: subset of activeEntities that pass the current locator selection.
  // null selectedLocatorIds = all visible.
  const visibleEntities = useMemo(
    () => selectedLocatorIds === null
      ? activeEntities
      : activeEntities.filter((e) => selectedLocatorIds.has(e.id)),
    [activeEntities, selectedLocatorIds],
  );

  // filteredLocatorList: activeEntities filtered by search string (for the picker UI)
  const filteredLocatorList = useMemo(
    () => locatorSearch.trim() === ''
      ? activeEntities
      : activeEntities.filter((e) =>
          e.label.toLowerCase().includes(locatorSearch.trim().toLowerCase()),
        ),
    [activeEntities, locatorSearch],
  );

  // Helpers for the locator selector
  const allSelected = selectedLocatorIds === null || selectedLocatorIds.size === activeEntities.length;
  const noneSelected = selectedLocatorIds !== null && selectedLocatorIds.size === 0;

  function toggleLocator(id: string) {
    setSelectedLocatorIds((prev) => {
      const current = prev ?? new Set(activeEntities.map((e) => e.id));
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next.size === activeEntities.length ? null : next;
    });
  }

  function selectAllLocators() { setSelectedLocatorIds(null); }
  function clearAllLocators() { setSelectedLocatorIds(new Set()); }

  // drilldownData: one row per day, each VISIBLE entity (locator or well) gets its own key
  const drilldownData = useMemo(() => {
    if (!hasConsumptionDrill || drillMode !== 'drilldown') return [];
    const isWell = metric === 'production' && prodDrillSource === 'well';
    const sourceReadings = isWell ? (wellReadings ?? []) : (locReadings ?? []);
    const entityField   = isWell ? 'well_id' : 'locator_id';
    const sorted = [...sourceReadings].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot, dateKeys } = buildEntityPivot(sorted, entityField);
    if (dateKeys.length === 0) return [];
    const allDates = fillDateRange(dateKeys[0], dateKeys[dateKeys.length - 1]);
    return allDates.map((dateKey) => {
      const row: any = { date: fmtDateKey(dateKey), isoDate: dateKey };
      visibleEntities.forEach(({ id }) => {
        row[id] = pivot.get(dateKey)?.get(id) ?? null;
      });
      row._total = visibleEntities.reduce((s, { id }) => s + (pivot.get(dateKey)?.get(id) ?? 0), 0);
      return row;
    });
  }, [hasConsumptionDrill, drillMode, prodDrillSource, metric, locReadings, wellReadings, visibleEntities]);

  // drillupData: one row per month — grouped bars (not stacked) per entity
  const drillupData = useMemo(() => {
    if (!hasConsumptionDrill || drillMode !== 'drillup') return [];
    const isWell = metric === 'production' && prodDrillSource === 'well';
    const sourceReadings = isWell ? (wellReadings ?? []) : (locReadings ?? []);
    const entityField   = isWell ? 'well_id' : 'locator_id';
    const sorted = [...sourceReadings].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot, dateKeys } = buildEntityPivot(sorted, entityField);
    const byMonth = new Map<string, Map<string, number>>();
    dateKeys.forEach((dk) => {
      const monthKey = dk.slice(0, 7);
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map());
      visibleEntities.forEach(({ id }) => {
        const v = pivot.get(dk)?.get(id) ?? 0;
        byMonth.get(monthKey)!.set(id, (byMonth.get(monthKey)!.get(id) ?? 0) + v);
      });
    });
    const monthKeys = Array.from(byMonth.keys()).sort();
    return monthKeys.map((mk) => {
      const row: any = {
        date: format(new Date(`${mk}-01T00:00:00`), 'MMM yyyy'),
        isoDate: `${mk}-01`,
      };
      visibleEntities.forEach(({ id }) => {
        row[id] = byMonth.get(mk)!.get(id) ?? null;
      });
      row._total = visibleEntities.reduce((s, { id }) => s + (byMonth.get(mk)!.get(id) ?? 0), 0);
      return row;
    });
  }, [hasConsumptionDrill, drillMode, prodDrillSource, metric, locReadings, wellReadings, visibleEntities]);

  // ── RO drill helpers ─────────────────────────────────────────────────────
  // Full list of trains found in the fetched roReadings
  const roTrainEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasRoDrill) return [];
    const ids = Array.from(new Set((roReadings ?? []).map((r: any) => r.train_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasRoDrill, roReadings, roTrainNames]);

  const visibleTrainEntities = useMemo(
    () => selectedTrainIds === null
      ? roTrainEntities
      : roTrainEntities.filter((e) => selectedTrainIds.has(e.id)),
    [roTrainEntities, selectedTrainIds],
  );

  const filteredTrainList = useMemo(
    () => trainSearch.trim() === ''
      ? roTrainEntities
      : roTrainEntities.filter((e) =>
          e.label.toLowerCase().includes(trainSearch.trim().toLowerCase()),
        ),
    [roTrainEntities, trainSearch],
  );

  const allTrainsSelected = selectedTrainIds === null || selectedTrainIds.size === roTrainEntities.length;
  const noTrainsSelected  = selectedTrainIds !== null && selectedTrainIds.size === 0;

  function toggleTrain(id: string) {
    setSelectedTrainIds((prev) => {
      const current = prev ?? new Set(roTrainEntities.map((e) => e.id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next.size === roTrainEntities.length ? null : next;
    });
  }
  function selectAllTrains() { setSelectedTrainIds(null); }
  function clearAllTrains()  { setSelectedTrainIds(new Set()); }

  const valueKey = metric === 'tds' ? 'permeate_tds' : 'recovery_pct';
  const roUnit   = metric === 'tds' ? 'ppm' : '%';

  /** Build per-train daily-average drill data */
  const roTrainDrillData = useMemo(() => {
    if (!hasRoDrill || roDrillMode !== 'by-train') return [];
    const readings = (roReadings ?? []).filter((r: any) => {
      if (!r.train_id) return false;
      return selectedTrainIds === null || selectedTrainIds.has(r.train_id);
    });
    // dateKey → trainId → { sum, count }
    const acc = new Map<string, Map<string, { sum: number; count: number }>>();
    readings.forEach((r: any) => {
      const val = r[valueKey];
      if (val == null) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!acc.has(dk)) acc.set(dk, new Map());
      const trainAcc = acc.get(dk)!;
      const tid = r.train_id;
      const prev = trainAcc.get(tid) ?? { sum: 0, count: 0 };
      trainAcc.set(tid, { sum: prev.sum + +val, count: prev.count + 1 });
    });
    const dateKeys = Array.from(acc.keys()).sort();
    if (dateKeys.length === 0) return [];
    const allDates = fillDateRange(dateKeys[0], dateKeys[dateKeys.length - 1]);
    return allDates.map((dk) => {
      const row: any = { date: fmtDateKey(dk), isoDate: dk };
      visibleTrainEntities.forEach(({ id }) => {
        const a = acc.get(dk)?.get(id);
        row[id] = a ? +(a.sum / a.count).toFixed(metric === 'tds' ? 0 : 1) : null;
      });
      return row;
    });
  }, [hasRoDrill, roDrillMode, roReadings, visibleTrainEntities, selectedTrainIds, valueKey, metric]);

  /** Build hourly drill data — one row per actual datetime slot, in chronological
   *  order. Each slot label is "MMM d, ha" (e.g. "May 3, 1pm"). The value is the
   *  average across all visible trains that have a reading in that exact hour.
   *  Filtering by train selector controls which trains contribute to the average. */
  const roHourDrillData = useMemo(() => {
    if (!hasRoDrill || roDrillMode !== 'by-hour') return [];

    const readings = (roReadings ?? []).filter((r: any) => {
      if (selectedTrainIds !== null && r.train_id && !selectedTrainIds.has(r.train_id)) return false;
      return r[valueKey] != null;
    });

    // slotKey: "yyyy-MM-dd HH" — one bucket per calendar hour
    // ts is computed without mutating dt (dt.setMinutes mutates and returns ms)
    const acc = new Map<string, { sum: number; count: number; ts: number }>();
    readings.forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const slotKey = format(dt, 'yyyy-MM-dd HH');
      // Build a clean on-the-hour timestamp without mutating dt
      const slotTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), 0, 0, 0).getTime();
      const prev = acc.get(slotKey) ?? { sum: 0, count: 0, ts: slotTs };
      acc.set(slotKey, { sum: prev.sum + +r[valueKey], count: prev.count + 1, ts: prev.ts });
    });

    const dec = metric === 'tds' ? 0 : 1;

    return Array.from(acc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([, { sum, count, ts }]) => {
        const dt = new Date(ts);
        return {
          // X-axis label: "May 3, 1pm"
          label: format(dt, 'MMM d, haaa').replace('am', 'am').replace('pm', 'pm'),
          value: +(sum / count).toFixed(dec),
        };
      });
  }, [hasRoDrill, roDrillMode, roReadings, selectedTrainIds, valueKey, metric]);

  // ── Per-day negative-value index ────────────────────────────────────────
  // Built from the _raw* fields stored in chartData. Each entry lists only
  // the fields that are actually plotted for this metric and had a negative
  // raw delta on that date. The tooltip uses this to show the true value
  // (e.g. -900.3) even though the chart bar/line shows 0 (clamped).
  const negativeByDate = useMemo<Map<string, { label: string; rawValue: number; chartValue: number }[]>>(() => {
    const map = new Map<string, { label: string; rawValue: number; chartValue: number }[]>();

    // Mapping: metric → which _raw field to check, its display label, and the
    // corresponding plotted (clamped) field name.
    const checks: Record<string, Array<{ rawField: string; chartField: string; label: string }>> = {
      production:     [
        { rawField: '_rawProduction',  chartField: 'production',  label: 'Production (m³)' },
        { rawField: '_rawConsumption', chartField: 'consumption', label: 'Consumption (m³)' },
      ],
      nrw:            [
        { rawField: '_rawProduction',  chartField: 'production',  label: 'Production (m³)' },
        { rawField: '_rawConsumption', chartField: 'consumption', label: 'Consumption (m³)' },
        // nrw is derived — flag it when the computed value is negative
        { rawField: 'nrw',             chartField: 'nrw',         label: 'NRW %' },
      ],
      rawwater:       [{ rawField: '_rawRawwater', chartField: 'rawwater', label: 'Raw Water (m³)' }],
      pv:             [
        { rawField: '_rawProduction', chartField: 'production', label: 'Production (m³)' },
        { rawField: '_rawKwh',        chartField: 'kwh',        label: 'Power (kWh)' },
      ],
      kwh:            [{ rawField: '_rawKwh', chartField: 'kwh', label: 'Grid (kWh)' }],
      // recovery, tds, productionCost values come straight from the DB —
      // no clamping — so rawField === chartField (negative = truly negative).
      recovery:       [{ rawField: 'recovery',  chartField: 'recovery',  label: 'Recovery (%)' }],
      tds:            [{ rawField: 'tds',        chartField: 'tds',       label: 'Permeate TDS (ppm)' }],
      productionCost: [
        { rawField: 'powerCost', chartField: 'powerCost', label: 'Power (₱)' },
        { rawField: 'chemCost',  chartField: 'chemCost',  label: 'Chemical (₱)' },
        { rawField: 'totalCost', chartField: 'totalCost', label: 'Total (₱)' },
      ],
      chemCost: [
        { rawField: 'chemCost', chartField: 'chemCost', label: 'Chemical Cost (₱)' },
      ],
      powerCost: [
        { rawField: 'powerCost', chartField: 'powerCost', label: 'Power Cost (₱)' },
      ],
    };

    const fields = checks[metric] ?? [];

    for (const row of chartData) {
      for (const { rawField, chartField, label } of fields) {
        const raw = row[rawField];
        // For _raw* fields: null means no negative delta → skip.
        // For direct fields (recovery, tds, costs, nrw): check if < 0.
        const isNegative = rawField.startsWith('_raw')
          ? raw !== null && raw < 0
          : raw != null && +raw < 0;

        if (!isNegative) continue;

        const entry = { label, rawValue: +raw, chartValue: +(row[chartField] ?? 0) };
        const existing = map.get(row.date);
        if (existing) existing.push(entry);
        else map.set(row.date, [entry]);
      }
    }

    return map;
  }, [chartData, metric]);

  // Custom tooltip — same look as Recharts default but:
  //  • Shows the true raw (unclamped) value for any field that was clamped to 0
  //  • When the zero was caused by a meter replacement, shows "🔧 [Name] was Replaced"
  //    instead of the generic "⚠️ Negative reading" warning
  //  • If both a replacement AND a genuine negative exist on the same day, shows both
  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const warnings = negativeByDate.get(label as string) ?? [];

    // Meter replacements and permeate source info — from chartData row
    const chartRow = chartData.find((d) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];
    const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];

    // Warnings that are NOT covered by a meter replacement (genuine negatives).
    // A warning is "covered" if there are replacements on this day — the zero
    // was caused by the replacement, not a true data anomaly.
    const genuineNegatives = replacements.length > 0
      ? warnings.filter((w) => {
          const entry = payload.find((p: any) => p.name === w.label);
          const chartVal = entry?.value ?? 0;
          // If the chart shows 0, the replacement explains it — not a genuine negative
          return chartVal !== 0;
        })
      : warnings;

    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        fontSize: 11,
        padding: '8px 10px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
        {payload.map((entry: any) => {
          // Always display the actual chart value (already clamped to ≥ 0 at
          // the data layer). Never replace it with a raw negative partial delta
          // from a single locator — entry.value is the correct aggregated total.
          const displayValue = entry.value;
          return (
            <p key={entry.dataKey} style={{
              margin: '1px 0',
              color: entry.color ?? entry.stroke,
            }}>
              {entry.name}:{' '}
              <span>
                {displayValue != null ? displayValue.toLocaleString() : '—'}
              </span>
            </p>
          );
        })}

        {/* ── Meter replacement notice — replaces negative-reading warning ── */}
        {replacements.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
          }}>
            {replacements.map((name) => (
              <div key={name} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 5,
                color: '#92400e',
                marginBottom: 2,
              }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                  {' '}
                  <span style={{ opacity: 0.75 }}>(value adjusted to 0)</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Genuine negative readings (not explained by a replacement) ── */}
        {genuineNegatives.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            color: '#92400e',
          }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>⚠️</span>
            <span style={{ fontSize: 10, lineHeight: 1.4 }}>
              <strong>Negative reading:</strong>{' '}
              {genuineNegatives.map((w) => w.label).join(', ')}
            </span>
          </div>
        )}

        {/* ── Permeate-source note — shown when ≥1 plant uses permeate_is_production ── */}
        {permeateSourceNames.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            color: 'hsl(var(--muted-foreground))',
          }}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
            <span style={{ fontSize: 10, lineHeight: 1.4 }}>
              <span style={{ opacity: 0.85 }}>
                Source: Permeate meter ({permeateSourceNames.join(', ')})
              </span>
            </span>
          </div>
        )}
      </div>
    );
  };

  const chartHeight = compact ? 'h-[200px]' : 'h-[340px]';

  // Format large numbers as 1.2K / 3.4M on the Y-axis so the axis
  // label doesn't eat into the chart area on narrow mobile screens.
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(value);
  };

  // PV tooltip — defined here (not inside JSX) so esbuild can parse it.
  // Shows Grid PV and (Grid+Solar) PV ratios plus the underlying Volume and
  // Power values so operators can see what is driving each day's ratio.
  const PvTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = chartData.find((d) => d.date === label);
    if (!row) return null;
    const gridPv  = row.production > 0 ? +(row.kwh / row.production).toFixed(2) : null;
    const totalPv = row.production > 0 && (row.kwh + row.solarKwh) > 0
      ? +((row.kwh + row.solarKwh) / row.production).toFixed(2) : null;
    const hasSolar = row.solarKwh > 0;
    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8, fontSize: 11, padding: '8px 10px',
        minWidth: 200, boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
        <p style={{ margin: '1px 0', color: '#f59e0b' }}>
          Grid PV: <strong>{gridPv != null ? `${gridPv} kWh/m³` : '0 kWh/m³'}</strong>
        </p>
        {hasSolar && (
          <p style={{ margin: '1px 0', color: '#22c55e' }}>
            (Grid+Solar) PV: <strong>{totalPv != null ? `${totalPv} kWh/m³` : '—'}</strong>
          </p>
        )}
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '1px 0', color: 'hsl(var(--chart-1))' }}>
            Volume: <span>{row.production > 0 ? row.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m³' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: '#f59e0b' }}>
            Grid Power: <span>{row.kwh > 0 ? row.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: '#22c55e' }}>
            Solar: <span>{row.solarKwh > 0 ? row.solarKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Title, range buttons, and Data Summary tab on one compact row */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {title && (
          <span className="text-sm font-semibold mr-1 shrink-0">{title}</span>
        )}
        {/* Range pills — compact size */}
        <div className="flex flex-wrap items-center gap-0.5">
          {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
            <button key={r}
              onClick={() => setRange(r)}
              data-testid={`trend-range-${metric}-${r}`}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none',
                range === r
                  ? 'bg-teal-700 text-white'
                  : 'bg-muted text-muted-foreground hover:text-foreground border border-border',
              ].join(' ')}
            >{r}</button>
          ))}
          <button
            onClick={() => setRange('CUSTOM')}
            data-testid={`trend-range-${metric}-CUSTOM`}
            className={[
              'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none',
              range === 'CUSTOM'
                ? 'bg-teal-700 text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground border border-border',
            ].join(' ')}
          >Custom</button>
          {range === 'CUSTOM' && (
            <div className="flex items-center gap-1 mt-1 w-full sm:w-auto sm:mt-0">
              <Input
                type="date"
                value={from}
                onChange={(e) => handleFromChange(e.target.value)}
                className="h-6 w-[110px] text-[10px] px-1.5"
                data-testid={`trend-from-${metric}`}
              />
              <span className="text-[10px] text-muted-foreground shrink-0">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                className="h-6 w-[110px] text-[10px] px-1.5"
                data-testid={`trend-to-${metric}`}
              />
            </div>
          )}
          {isFetching && (
            <span className="text-[10px] text-muted-foreground ml-1">Loading…</span>
          )}
        </div>

        {/* Data Summary — opens a popup dialog (non-retractable) */}
        <button
          onClick={() => setShowSummary(true)}
          className="ml-auto h-5 px-2 rounded text-[10px] font-medium transition-colors leading-none shrink-0 border bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 border-border"
          title="Open data summary table"
        >
          Data Summary
        </button>

        {/* Production Cost line toggles — Prod Cost / Power / Chem */}
        {metric === 'productionCost' && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <span className="text-[9px] text-muted-foreground mr-0.5 hidden sm:inline">Show:</span>
            <button
              onClick={() => setShowTotalCostLine((v) => !v)}
              title="Toggle Production Cost (Power + Chem) line"
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none border',
                showTotalCostLine
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Prod</button>
            <button
              onClick={() => setShowPowerCostLine((v) => !v)}
              title="Toggle Power Cost (₱/m³) line"
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none border',
                showPowerCostLine
                  ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Power</button>
            <button
              onClick={() => setShowChemCostLine((v) => !v)}
              title="Toggle Chemical Cost (₱/m³) line"
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none border',
                showChemCostLine
                  ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Chem</button>
          </div>
        )}

        {/* Production source toggle — Per Locator vs Per Well — only for production metric in drill mode */}
        {metric === 'production' && drillMode !== 'default' && (
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-[9px] text-muted-foreground mr-0.5 hidden sm:inline">View:</span>
            <button
              onClick={() => { setProdDrillSource('locator'); setSelectedLocatorIds(null); }}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none border',
                prodDrillSource === 'locator'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Breakdown by distribution locator"
            >Per Locator</button>
            <button
              onClick={() => { setProdDrillSource('well'); setSelectedLocatorIds(null); }}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none border',
                prodDrillSource === 'well'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Breakdown by raw water well"
            >Per Well</button>
          </div>
        )}

        {/* Drill controls — only for charts that have consumption data */}
        {hasConsumptionDrill && (
          <div className="flex items-center gap-0.5 shrink-0" title="Drill into Consumption data">
            {metric !== 'production' && <span className="text-[9px] text-muted-foreground mr-0.5 hidden sm:inline">Cons.:</span>}
            <button
              onClick={() => setDrillMode(drillMode === 'drillup' ? 'default' : 'drillup')}
              data-testid={`drill-up-${metric}`}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                drillMode === 'drillup'
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Drill Up — monthly consumption per locator"
            >
              <ChevronsUp className="h-3 w-3" />
              Monthly
            </button>
            <button
              data-testid={`drill-default-${metric}`}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                drillMode === 'default'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Default — daily total consumption"
              onClick={() => { setDrillMode('default'); setShowLocatorFilter(false); }}
            >
              <BarChart2 className="h-3 w-3" />
              Daily
            </button>
            <button
              onClick={() => setDrillMode(drillMode === 'drilldown' ? 'default' : 'drilldown')}
              data-testid={`drill-down-${metric}`}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                drillMode === 'drilldown'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Drill Down — daily consumption per locator"
            >
              <ChevronsDown className="h-3 w-3" />
              Per Locator
            </button>

            {/* Locator filter button — only visible in drill modes */}
            {drillMode !== 'default' && (
              <button
                onClick={() => setShowLocatorFilter((v) => !v)}
                data-testid={`drill-filter-${metric}`}
                className={[
                  'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                  showLocatorFilter
                    ? 'bg-amber-500 text-white border-amber-500'
                    : !allSelected
                      ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                      : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
                title="Filter locators"
              >
                <Filter className="h-3 w-3" />
                {!allSelected && (
                  <span className="font-semibold">
                    {selectedLocatorIds?.size ?? drillEntities.length}/{drillEntities.length}
                  </span>
                )}
              </button>
            )}
          </div>
        )}
        {/* RO Drill controls — TDS / Recovery */}
        {hasRoDrill && (
          <div className="flex items-center gap-0.5 shrink-0" title="Drill into RO train data">
            <span className="text-[9px] text-muted-foreground mr-0.5 hidden sm:inline">RO:</span>
            <button
              onClick={() => { setRoDrillMode('default'); setShowTrainFilter(false); }}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                roDrillMode === 'default'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Default — daily average"
            >
              <BarChart2 className="h-3 w-3" />
              Daily
            </button>
            <button
              onClick={() => { setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train'); }}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                roDrillMode === 'by-train'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Per Train — daily average per RO train"
            >
              <ChevronsDown className="h-3 w-3" />
              Per Train
            </button>
            <button
              onClick={() => setRoDrillMode(roDrillMode === 'by-hour' ? 'default' : 'by-hour')}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                roDrillMode === 'by-hour'
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="By Hour — hourly average across date range"
            >
              <ChevronsUp className="h-3 w-3" />
              Hourly
            </button>
            {/* Train filter — visible in by-train or by-hour mode */}
            {roDrillMode !== 'default' && (
              <button
                onClick={() => setShowTrainFilter((v) => !v)}
                className={[
                  'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border',
                  showTrainFilter
                    ? 'bg-amber-500 text-white border-amber-500'
                    : !allTrainsSelected
                      ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                      : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
                title="Filter trains"
              >
                <Filter className="h-3 w-3" />
                {!allTrainsSelected && (
                  <span className="font-semibold">
                    {selectedTrainIds?.size ?? roTrainEntities.length}/{roTrainEntities.length}
                  </span>
                )}
              </button>
            )}
          </div>
        )}
        {/* ── kwh: Source filter (Both / Solar / Grid) + CSV export ──────────── */}
        {metric === 'kwh' && (hasSolar || hasGrid) && (
          <div className="flex items-center gap-1 shrink-0">
            {hasSolar && hasGrid && (
              <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                {(['both', 'solar', 'grid'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setKwhSource(s)}
                    className={[
                      'h-5 px-2 rounded text-[10px] font-medium capitalize transition-colors leading-none border',
                      kwhSource === s
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-transparent text-muted-foreground hover:text-foreground border-transparent',
                    ].join(' ')}
                  >
                    {s === 'both' ? 'Both' : s === 'solar' ? '☀ Solar' : '⚡ Grid'}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                if (!chartData.length) return;
                const rows = chartData.map((d: any) =>
                  `${d.date},${+(d.solarKwh ?? 0).toFixed(2)},${+(d.kwh ?? 0).toFixed(2)},${+((d.solarKwh ?? 0) + (d.kwh ?? 0)).toFixed(2)}`
                );
                const csv = ['date,solar_kwh,grid_kwh,total_kwh', ...rows].join('\n');
                const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url; a.download = `power_energy_mix.csv`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none flex items-center gap-0.5 border bg-muted text-muted-foreground hover:text-foreground border-border"
              title="Export CSV"
            >
              <Download className="h-3 w-3" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        )}
      </div>
      {hasRoDrill && roDrillMode !== 'default' && showTrainFilter && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-foreground shrink-0">Filter Trains</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={selectAllTrains}
                className={[
                  'h-5 px-2 rounded text-[10px] font-medium border transition-colors leading-none',
                  allTrainsSelected
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >All</button>
              <button
                onClick={clearAllTrains}
                className={[
                  'h-5 px-2 rounded text-[10px] font-medium border transition-colors leading-none',
                  noTrainsSelected
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >None</button>
              <button
                onClick={() => setShowTrainFilter(false)}
                className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {roTrainEntities.length > 6 && (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={trainSearch}
                onChange={(e) => setTrainSearch(e.target.value)}
                placeholder="Search trains…"
                className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {trainSearch && (
                <button onClick={() => setTrainSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
            {filteredTrainList.length === 0 && (
              <span className="text-[11px] text-muted-foreground py-1">No trains match search.</span>
            )}
            {filteredTrainList.map((entity) => {
              const isActive = selectedTrainIds === null || selectedTrainIds.has(entity.id);
              return (
                <button
                  key={entity.id}
                  onClick={() => toggleTrain(entity.id)}
                  title={entity.label}
                  className={[
                    'flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border transition-all leading-none max-w-[180px]',
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
                >
                  {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{entity.label}</span>
                </button>
              );
            })}
          </div>

          <div className="text-[10px] text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
            <span>
              {allTrainsSelected
                ? `All ${roTrainEntities.length} trains shown`
                : noTrainsSelected
                  ? 'No trains selected — chart will be empty'
                  : `${selectedTrainIds!.size} of ${roTrainEntities.length} trains shown`}
            </span>
            {!allTrainsSelected && !noTrainsSelected && (
              <button onClick={selectAllTrains} className="ml-auto text-[10px] text-primary hover:underline">Reset</button>
            )}
          </div>
        </div>
      )}
      {hasConsumptionDrill && drillMode !== 'default' && showLocatorFilter && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5" data-testid={`locator-filter-panel-${metric}`}>
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-foreground shrink-0">Filter Locators</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={selectAllLocators}
                className={[
                  'h-5 px-2 rounded text-[10px] font-medium border transition-colors leading-none',
                  allSelected
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                All
              </button>
              <button
                onClick={clearAllLocators}
                className={[
                  'h-5 px-2 rounded text-[10px] font-medium border transition-colors leading-none',
                  noneSelected
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                None
              </button>
              <button
                onClick={() => setShowLocatorFilter(false)}
                className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Search box */}
          {drillEntities.length > 6 && (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={locatorSearch}
                onChange={(e) => setLocatorSearch(e.target.value)}
                placeholder="Search locators…"
                className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {locatorSearch && (
                <button
                  onClick={() => setLocatorSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          {/* Locator chip grid */}
          <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
            {filteredLocatorList.length === 0 && (
              <span className="text-[11px] text-muted-foreground py-1">No locators match search.</span>
            )}
            {filteredLocatorList.map((entity) => {
              const isActive = selectedLocatorIds === null || selectedLocatorIds.has(entity.id);
              return (
                <button
                  key={entity.id}
                  onClick={() => toggleLocator(entity.id)}
                  title={entity.label}
                  className={[
                    'flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border transition-all leading-none max-w-[180px]',
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
                >
                  {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{entity.label}</span>
                </button>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="text-[10px] text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
            <span>
              {allSelected
                ? `All ${drillEntities.length} locators shown`
                : noneSelected
                  ? 'No locators selected — chart will be empty'
                  : `${selectedLocatorIds!.size} of ${drillEntities.length} locators shown`}
            </span>
            {!allSelected && !noneSelected && (
              <button
                onClick={selectAllLocators}
                className="ml-auto text-[10px] text-primary hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Data Summary Popup Dialog — 3-tab pivot table ───────────────── */}
      {showSummary && (
        <DataSummaryPopup
          open={showSummary}
          onClose={() => setShowSummary(false)}
          metric={metric}
          title={title}
          chartData={chartData}
          locReadings={locReadings ?? []}
          productReadings={productReadings ?? []}
          wellReadings={wellReadings ?? []}
          costReadings={costReadings ?? []}
          locatorNames={locatorNames}
          productMeterNames={productMeterNames}
          wellNames={wellNames}
          plantNames={plantNames}
        />
      )}

      {/* ── kwh: Today Solar / Grid / Total stat cards ───────────────────────── */}
      {metric === 'kwh' && chartData.length > 0 && (() => {
        const today     = chartData[chartData.length - 1];
        const yesterday = chartData.length > 1 ? chartData[chartData.length - 2] : null;
        const todaySolar = +(today?.solarKwh ?? 0);
        const todayGrid  = +(today?.kwh      ?? 0);
        const todayTotal = +(todaySolar + todayGrid).toFixed(1);
        const solarPct   = todayTotal > 0 ? +((todaySolar / todayTotal) * 100).toFixed(1) : 0;
        const solarDelta = yesterday && (yesterday.solarKwh ?? 0) > 0
          ? +(((todaySolar - yesterday.solarKwh) / yesterday.solarKwh) * 100).toFixed(1) : null;
        const gridDelta  = yesterday && (yesterday.kwh ?? 0) > 0
          ? +(((todayGrid  - yesterday.kwh)       / yesterday.kwh)       * 100).toFixed(1) : null;
        return (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {/* Today Solar */}
            {hasSolar && (
              <div className="rounded-lg border border-yellow-200/70 bg-yellow-50/40 dark:border-yellow-800/30 dark:bg-yellow-950/10 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Sun className="h-3 w-3 text-yellow-500" />
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">Today Solar</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-semibold tabular-nums">{todaySolar.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  <span className="text-[10px] text-muted-foreground">kWh</span>
                </div>
                {solarDelta !== null && (
                  <div className={`text-[10px] mt-0.5 font-medium ${solarDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                    {solarDelta >= 0 ? '↑' : '↓'} {Math.abs(solarDelta)}% vs yesterday
                  </div>
                )}
              </div>
            )}
            {/* Today Grid */}
            {hasGrid && (
              <div className="rounded-lg border border-blue-200/70 bg-blue-50/40 dark:border-blue-800/30 dark:bg-blue-950/10 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap className="h-3 w-3 text-blue-500" />
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Today Grid</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-semibold tabular-nums">{todayGrid.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  <span className="text-[10px] text-muted-foreground">kWh</span>
                </div>
                {gridDelta !== null && (
                  <div className={`text-[10px] mt-0.5 font-medium ${gridDelta <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                    {gridDelta >= 0 ? '↑' : '↓'} {Math.abs(gridDelta)}% vs yesterday
                  </div>
                )}
              </div>
            )}
            {/* Today Total */}
            <div className={`rounded-lg border border-teal-200/70 bg-teal-50/40 dark:border-teal-800/30 dark:bg-teal-950/10 px-3 py-2.5 ${!hasSolar || !hasGrid ? 'col-span-2' : ''}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="h-3 w-3 text-teal-600" />
                <span className="text-[9px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">Today Total</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold tabular-nums">{todayTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                <span className="text-[10px] text-muted-foreground">kWh</span>
              </div>
              {hasSolar && todaySolar > 0 && (
                <div className="text-[10px] mt-0.5 text-muted-foreground">
                  Solar: <span className="font-medium text-yellow-600 dark:text-yellow-400">{solarPct}%</span> of mix
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div className={`${chartHeight} w-full relative`} data-testid={`trend-chart-${metric}`}>
        {queryError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-rose-300 bg-rose-50/95 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/80 dark:border-rose-900 dark:text-rose-300 shadow-sm pointer-events-auto max-w-md text-center">
              <div className="font-semibold mb-0.5">Couldn't load trend data</div>
              <div className="text-[11px] opacity-80">{queryError.message}</div>
            </div>
          </div>
        )}
        {!queryError && !isFetching && chartData.length === 0 && drilldownData.length === 0 && drillupData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2 text-xs text-muted-foreground text-center pointer-events-auto max-w-md shadow-sm">
              <div className="font-medium text-foreground">No data in selected range</div>
              <div className="text-[11px] mt-0.5">
                Try a wider range, switch plant, or log readings for {metric === 'nrw' ? 'wells & locators' : metric === 'pv' ? 'wells & power' : metric === 'tds' || metric === 'recovery' ? 'RO trains' : metric === 'productionCost' ? 'power readings (Operations) + tariff rate (Costs → Power tab) + production volume (product meter readings)' : 'wells'}.
              </div>
            </div>
          </div>
        )}
        {/* productionCost-specific: data exists but all cost values are null (missing tariff or production) */}
        {!queryError && !isFetching && metric === 'productionCost' && chartData.length > 0
          && chartData.every((d) => d.totalCost == null) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-amber-300 bg-amber-50/95 dark:bg-amber-950/80 dark:border-amber-800 px-4 py-3 text-xs text-amber-800 dark:text-amber-200 text-left pointer-events-auto max-w-sm shadow-sm">
              <div className="font-semibold mb-1">Cost data incomplete</div>
              <div className="text-[11px] space-y-1 opacity-90">
                <p>Power cost requires all three of the following in this date range:</p>
                <ul className="list-disc list-inside space-y-0.5 mt-1">
                  <li><strong>Power readings</strong> — log kWh in Operations</li>
                  <li><strong>Tariff rate</strong> — add a bill in Costs → Power tab</li>
                  <li><strong>Production volume</strong> — log product meter readings</li>
                </ul>
                <p className="mt-1 opacity-75">Check: <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">SELECT * FROM power_tariffs WHERE plant_id = '…'</code></p>
              </div>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {(hasRoDrill && roDrillMode === 'by-train') ? (
            <LineChart data={roTrainDrillData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={36} label={{ value: roUnit, angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {visibleTrainEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : (hasRoDrill && roDrillMode === 'by-hour') ? (
            <LineChart data={roHourDrillData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9 }}
                stroke="hsl(var(--muted-foreground))"
                interval={Math.max(0, Math.floor(roHourDrillData.length / 12) - 1)}
                angle={-35}
                textAnchor="end"
                height={48}
              />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={36} label={{ value: roUnit, angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any) => [v != null ? `${v} ${roUnit}` : '—', metric === 'tds' ? 'Avg TDS' : 'Avg Recovery']}
                labelFormatter={(label) => label}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={metric === 'tds' ? 'Avg TDS (ppm)' : 'Avg Recovery (%)'}
                stroke={metric === 'tds' ? 'hsl(var(--accent))' : 'hsl(var(--chart-6))'}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          ) : (hasConsumptionDrill && drillMode === 'drilldown') ? (
            <ComposedChart data={drilldownData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={36} label={{ value: 'm³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {visibleEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          ) : (hasConsumptionDrill && drillMode === 'drillup') ? (
            // Monthly view — grouped bars (one bar per entity per month, not stacked)
            // This makes it easy to compare entities month-over-month.
            <ComposedChart data={drillupData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={36} label={{ value: 'm³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {visibleEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={32}
                />
              ))}
            </ComposedChart>
          ) : metric === 'nrw' ? (
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis yAxisId="vol" tick={{ fontSize: 10 }} stroke="hsl(var(--chart-1))" tickFormatter={formatYAxis} width={36} label={{ value: 'm³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} stroke="#16a34a" width={28} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="vol" dataKey="production" fill="hsl(var(--chart-1))" name="Production (m³)" />
              <Bar yAxisId="vol" dataKey="consumption" fill="hsl(var(--chart-2))" name="Consumption (m³)" />
              <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3, fill: "#16a34a" }} name="NRW %" />
            </ComposedChart>
          ) : metric === 'chemCost' ? (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--highlight))" tickFormatter={formatYAxis} width={44} label={{ value: '₱', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2.5} dot={{ r: 2, fill: 'hsl(var(--highlight))' }} name="Chemical Cost (₱)" connectNulls />
            </LineChart>
          ) : metric === 'powerCost' ? (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--chart-6))" tickFormatter={formatYAxis} width={44} label={{ value: '₱', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2.5} dot={{ r: 2, fill: 'hsl(var(--chart-6))' }} name="Power Cost (₱)" connectNulls />
            </LineChart>
          ) : metric === 'productionCost' ? (
            // Production Cost — all lines as ₱/m³ (unit cost per cubic metre):
            //   Prod Cost  = Power Cost + Chem Cost          (teal, always visible)
            //   Power Cost = daily_kwh × rate_per_kwh / m³  (blue, toggle: Power ₱)
            //   Chem Cost  = chem_cost_₱ / m³               (orange, toggle: Chem ₱)
            // Single ₱/m³ Y-axis — all lines share the same scale.
            // Points gap (null) when production = 0 or no tariff is configured.
            // ─ Where does rate_per_kwh come from? ────────────────────────────────
            //   Costs → Power tab: each monthly bill entry auto-derives a tariff row
            //   (total_amount ÷ kWh). That rate is stored in power_tariffs and looked
            //   up here using the latest effective_date ≤ each reading's date.
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--accent))"
                tickFormatter={(v) => `₱${formatYAxis(v)}`}
                width={44}
                label={{ value: '₱/m³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, name: string) => [
                  v != null ? `₱${(+v).toFixed(4)}/m³` : '—',
                  name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {showTotalCostLine && (
                <Line type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2 }} name="Prod Cost (₱/m³)" connectNulls />
              )}
              {showPowerCostLine && (
                <Line type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (₱/m³)" connectNulls />
              )}
              {showChemCostLine && (
                <Line type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2} dot={false} name="Chem (₱/m³)" connectNulls />
              )}
            </LineChart>
          ) : metric === 'pv' ? (
            // PV Ratio — two lines: Grid-only PV and (Grid+Solar) PV.
            // PvTooltip and domain are defined/hoisted above the return().
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="#f59e0b"
                width={44}
                domain={[
                  0,
                  (dataMax: number) => {
                    // For small PV ratios (e.g. 0.4–1.5 kWh/m³), 'auto' may give
                    // a too-large max. Round up to the nearest sensible tick.
                    if (dataMax <= 0) return 2;
                    if (dataMax < 1)  return Math.ceil(dataMax * 10) / 10 + 0.1;
                    if (dataMax < 4)  return Math.ceil(dataMax * 4)  / 4;
                    return Math.ceil(dataMax);
                  },
                ]}
                tickCount={6}
                tickFormatter={(v) => +v.toFixed(2) === 0 ? '0' : v.toFixed(v < 1 ? 2 : 1)}
                label={{ value: 'kWh/m³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }}
              />
              <Tooltip content={<PvTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey={(d: any) => d.production > 0 ? +(d.kwh / d.production).toFixed(2) : null}
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ r: 2, fill: '#f59e0b' }}
                name="Grid PV (kWh/m³)"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey={(d: any) => d.production > 0 && (d.kwh + d.solarKwh) > 0
                  ? +((d.kwh + d.solarKwh) / d.production).toFixed(2)
                  : null}
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 2, fill: '#22c55e' }}
                name="(Grid+Solar) PV (kWh/m³)"
                connectNulls
              />
            </LineChart>
          ) : metric === 'kwh' ? (
            // ── Power Consumption & Energy Mix ────────────────────────────────────
            // Stacked bar chart matching Plants.tsx PowerConsumptionEnergyMix exactly.
            // Solar (yellow) stacks at base; Grid (blue) on top with rounded corners.
            // kwhSource state ('both'|'solar'|'grid') filters which bars are rendered.
            // barSize is dynamic: wider bars for short ranges, narrower for long ones.
            <ComposedChart
              data={chartData}
              margin={{ top: 4, right: 8, left: 0, bottom: 20 }}
              barSize={Math.max(3, Math.min(14, 400 / Math.max(chartData.length, 1)))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                angle={-30}
                textAnchor="end"
                height={36}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={formatYAxis}
                width={42}
                label={{ value: 'kWh', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, name: string) => [
                  v != null && +v > 0
                    ? `${(+v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`
                    : '—',
                  name,
                ]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* Solar renders first — sits at base of stack; hidden when source = grid */}
              {hasSolar && kwhSource !== 'grid' && (
                <Bar dataKey="solarKwh" name="☀ Solar (kWh)" fill="hsl(48, 96%, 53%)"  stackId="kwh" radius={[0, 0, 0, 0]} />
              )}
              {/* Grid on top with rounded upper corners; hidden when source = solar */}
              {hasGrid && kwhSource !== 'solar' && (
                <Bar dataKey="kwh" name="⚡ Grid (kWh)" fill="hsl(213, 94%, 68%)" stackId="kwh" radius={[2, 2, 0, 0]} />
              )}
            </ComposedChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={36} label={{ value: TREND_Y_LABEL[metric] ?? '', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {metric === 'production' && (<>
                <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                <Line type="monotone" dataKey="consumption" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Consumption (m³)" />
              </>)}
              {metric === 'rawwater' && (
                <Line type="monotone" dataKey="rawwater" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Raw Water (m³)" />
              )}
              {metric === 'recovery' && roDrillMode === 'default' && (
                <Line type="monotone" dataKey="recovery" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={{ r: 2 }} name="Recovery (%)" />
              )}
              {metric === 'tds' && roDrillMode === 'default' && (
                <Line type="monotone" dataKey="tds" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Permeate TDS (ppm)" />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
