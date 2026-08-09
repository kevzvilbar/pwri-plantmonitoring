// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md).
// Invoked once from the main TrendChart component (see TrendChart.tsx) when
// a KPI's "Data Summary" action is clicked.

import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { DSMTab, buildEntityPivot, fillDateRange } from './TrendChartPivotShared';
import { PivotTable, OverviewTable } from './TrendChartTables';

// ── DataSummaryPopup — 3-tab popup shown when "Data Summary" is clicked ───────
// Tab 1 (always): Overview / Prod vs Consum — aggregated daily totals
// Tab 2: Production — pivot: Date × ProductMeter1…N × Total
// Tab 3: Consumption — pivot: Date × Locator1…N × Total
// For non-production/consumption metrics the Production/Consumption tabs show
// the relevant entity breakdown that feeds that metric.
export function DataSummaryPopup({
  open, onClose, metric, title,
  chartData,
  locReadings, productReadings, wellReadings, costReadings,
  roReadings,
  permeateIsProductionPlants,
  productExcludedPlants,
  trainPlantMap,
  locatorNames, productMeterNames, wellNames, plantNames, roTrainNames,
  directLocatorIds,
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
  roReadings?: any[];
  // Plants with permeate switched on — covers BOTH exclusive 'permeate' mode
  // and 'both' mode (product meter + permeate summed). See chartData Step 2.
  permeateIsProductionPlants?: Set<string>;
  // Plants in EXCLUSIVE 'permeate' mode only — their product-meter readings
  // must be dropped to avoid double-counting the same water. 'both'-mode
  // plants are NOT in this set. See chartData Step 1.
  productExcludedPlants?: Set<string>;
  // train_id → plant_id, needed to know which plant an ro_train_readings row
  // belongs to (that table doesn't carry plant_id directly).
  trainPlantMap?: Map<string, string>;
  locatorNames?: Map<string, string>;
  productMeterNames?: Map<string, string>;
  wellNames?: Map<string, string>;
  plantNames?: Map<string, string>;
  roTrainNames?: Map<string, string>;
  // Locators to treat as direct-volume — default_input_mode='direct' or
  // is_derived (e.g. SRP↔Mambaling HAMAS). See buildEntityPivot.
  directLocatorIds?: Set<string>;
}) {
  const [tab, setTab] = useState<DSMTab>('overview');

  // Date range filter state — defaults to full range of available data.
  // NOTE: use isoDate (yyyy-MM-dd), not the display-only 'MMM d' date field —
  // native <input type="date"> only accepts ISO format and silently renders
  // blank ("mm/dd/yyyy") for anything else.
  const allDates = chartData
    .map((d) => (d.isoDate as string | undefined)?.slice(0, 10))
    .filter((d): d is string => !!d);
  const defaultFrom = allDates.length ? allDates[0] : '';
  const defaultTo = allDates.length ? allDates[allDates.length - 1] : '';
  const [filterFrom, setFilterFrom] = useState(defaultFrom);
  const [filterTo, setFilterTo] = useState(defaultTo);

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
    : metric === 'kwh' ? 'Solar vs Grid (kWh)'
    : 'Overview';

  const prodTabLabel =
    metric === 'rawwater' ? 'Per Well'
    : metric === 'pv' ? 'Per Well / Meter'
    : 'Production';

  // Build entity lists and pivots
  // --- Production entities ---
  // Production can come from a dedicated product meter, from the RO permeate
  // meter (ro_production_source = 'permeate'), or from BOTH summed together
  // (ro_production_source = 'both' — e.g. Mambaling: HAMAS product meter +
  // RO permeate, "two independent sources, totals are added together").
  // This mirrors chartData's Step 1 / Step 2 accumulation above so the
  // Overview tab and this Production tab always agree with each other:
  //   - productExcludedPlants: plants in EXCLUSIVE 'permeate' mode — their
  //     product-meter readings are dropped (same water the permeate meter
  //     already counts). 'both'-mode plants are NOT in this set, so their
  //     product meter is kept.
  //   - permeateIsProductionPlants: every plant with permeate switched on
  //     ('permeate' AND 'both' modes) — their permeate deltas are added in.
  const filteredRoReadings = useMemo(() => {
    if (!roReadings) return [];
    if (!parsedFrom && !parsedTo) return roReadings;
    return roReadings.filter((r) => {
      const dt = new Date(r.reading_datetime);
      if (parsedFrom && dt < parsedFrom) return false;
      if (parsedTo && dt > parsedTo) return false;
      return true;
    });
  }, [roReadings, filterFrom, filterTo]);

  const prodMeterReadingsForPivot = useMemo(
    () => (filteredProductReadings ?? []).filter((r: any) => !(productExcludedPlants?.has(r.plant_id))),
    [filteredProductReadings, productExcludedPlants],
  );

  const permeateReadingsForPivot = useMemo(() => {
    if (!permeateIsProductionPlants || permeateIsProductionPlants.size === 0) return [];
    return filteredRoReadings.filter((r: any) => {
      const plantId = trainPlantMap?.get(r.train_id);
      return plantId ? permeateIsProductionPlants.has(plantId) : false;
    });
  }, [filteredRoReadings, permeateIsProductionPlants, trainPlantMap]);

  const hasProductMeterData = (metric === 'production' || metric === 'nrw') && prodMeterReadingsForPivot.length > 0;
  const hasPermeateData     = (metric === 'production' || metric === 'nrw' || metric === 'pv') && permeateReadingsForPivot.length > 0;

  // "Permeate is the sole production source" — still drives the footer label
  // and gap-reason entityType for the common single-source case. False when
  // both sources are present (prodEntities/prodPivot below then include both
  // kinds of columns, correctly summed into Total Prod.).
  const usePermeate = hasPermeateData && !hasProductMeterData;

  const prodEntities = useMemo<{ id: string; label: string; kind: 'well' | 'meter' | 'ro_train' }[]>(() => {
    if (metric === 'rawwater' || metric === 'pv') {
      // wells
      const ids = Array.from(new Set((filteredWellReadings ?? []).map((r: any) => r.well_id).filter(Boolean)));
      return ids.map((id) => ({ id, label: wellNames?.get(id) ?? `Well ${id.slice(-4)}`, kind: 'well' as const }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    const entities: { id: string; label: string; kind: 'meter' | 'ro_train' }[] = [];
    if (hasProductMeterData) {
      const ids = Array.from(new Set(prodMeterReadingsForPivot.map((r: any) => r.meter_id).filter(Boolean)));
      entities.push(...ids.map((id) => ({
        id, label: productMeterNames?.get(id) ?? `Meter ${id.slice(-4)}`, kind: 'meter' as const,
      })));
    }
    if (hasPermeateData) {
      const ids = Array.from(new Set(permeateReadingsForPivot.map((r: any) => r.train_id).filter(Boolean)));
      entities.push(...ids.map((id) => ({
        id,
        // Disambiguate from the product-meter column when both are shown together.
        label: hasProductMeterData
          ? `${roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`} (Permeate)`
          : roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`,
        kind: 'ro_train' as const,
      })));
    }
    return entities.sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, filteredWellReadings, wellNames, hasProductMeterData, hasPermeateData, prodMeterReadingsForPivot, permeateReadingsForPivot, productMeterNames, roTrainNames]);

  const prodPivot = useMemo(() => {
    if (metric === 'rawwater' || metric === 'pv') {
      return buildEntityPivot(
        [...(filteredWellReadings ?? [])].sort((a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()),
        'well_id',
      );
    }

    const pivot = new Map<string, Map<string, number>>();
    const dateKeySet = new Set<string>();

    if (hasProductMeterData) {
      const { pivot: meterPivot, dateKeys: meterDateKeys } = buildEntityPivot(
        [...prodMeterReadingsForPivot].sort((a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()),
        'meter_id',
      );
      meterDateKeys.forEach((dk) => {
        dateKeySet.add(dk);
        if (!pivot.has(dk)) pivot.set(dk, new Map());
        meterPivot.get(dk)?.forEach((v, k) => pivot.get(dk)!.set(k, (pivot.get(dk)!.get(k) ?? 0) + v));
      });
    }

    if (hasPermeateData) {
      // Build pivot from permeate_meter_delta stored in roReadings. Mirrors
      // the primary path in TrendChart.chartData Step 2: use
      // permeate_meter_delta when available, fall back to current − previous.
      const roSorted = [...permeateReadingsForPivot].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      roSorted.forEach((r: any) => {
        if (r.is_meter_replacement) return;
        const delta = r.permeate_meter_delta != null
          ? Math.max(0, +r.permeate_meter_delta)
          : r.permeate_meter != null && r.permeate_meter_prev != null
            ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
            : null;
        if (delta === null || delta === 0) return;
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        dateKeySet.add(dk);
        if (!pivot.has(dk)) pivot.set(dk, new Map());
        const tid = r.train_id ?? '__';
        pivot.get(dk)!.set(tid, (pivot.get(dk)!.get(tid) ?? 0) + delta);
      });
    }

    return { pivot, dateKeys: Array.from(dateKeySet).sort() };
  }, [metric, filteredWellReadings, hasProductMeterData, hasPermeateData, prodMeterReadingsForPivot, permeateReadingsForPivot]);
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
    directLocatorIds,
  ), [filteredLocReadings, directLocatorIds]);
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

  // Overview dates: union of all available data, or filter-bounded.
  // fillDateRange fills EVERY calendar day so months with no readings
  // (e.g. April when data jumps Mar → May) are still shown as rows.
  const overviewDates = useMemo(() => {
    const allKeys = filteredChartData
      .filter((d) => d.isoDate)
      .map((d) => (d.isoDate as string).slice(0, 10));
    if (allKeys.length === 0) return [];
    const start = filterFrom || allKeys[0];
    const end   = filterTo   || allKeys[allKeys.length - 1];
    return fillDateRange(start, end);
  }, [filteredChartData, filterFrom, filterTo]);

  // Build a lookup map dateKey (yyyy-MM-dd) → chartData row so OverviewTable
  // can display all calendar days even when some days have no readings.
  const overviewByDate = useMemo(() => {
    const map = new Map<string, any>();
    filteredChartData.forEach((d) => {
      if (d.isoDate) map.set((d.isoDate as string).slice(0, 10), d);
    });
    return map;
  }, [filteredChartData]);

  // Full-coverage chart rows for the Overview tab: one entry per calendar day,
  // null-filled for days with no readings.  Passed to OverviewTable so it can
  // iterate overviewDates instead of the sparse filteredChartData array.
  //
  // rawwater SPECIAL CASE — Overview "Raw Water (m³)" must equal Per Well
  // "Total Raw (m³)" for the same date. The two previously diverged because
  // Overview used computeEntityDeltas (sequential lastReading tracking across
  // all data) while Per Well used buildEntityPivot / resolveReadingDelta
  // (current − previous_reading per row). When previous_reading in the DB
  // doesn't precisely match the actual last reading on record the two
  // algorithms produce different values.
  //
  // Fix: for rawwater, derive the Overview value directly from the same
  // prodPivotMap that populates the Per Well tab — guaranteed identical.
  // If prodPivot has dates not covered by overviewDates (e.g. chartData
  // yielded no rawwater rows), fall back to prodDates so the table isn't blank.
  const overviewChartRows = useMemo(() => {
    // For rawwater: always use prodDates (the same date list as Per Well tab)
    // so Overview rows are date-for-date identical to Per Well rows.
    // For all other metrics: keep the existing overviewDates behaviour.
    const dates = metric === 'rawwater' ? prodDates : overviewDates;

    return dates.map((dk) => {
      const existing = overviewByDate.get(dk);

      if (metric === 'rawwater') {
        // Sum across every well entity — mirrors PivotTable rowTotals formula.
        const pivotTotal = prodEntities.reduce(
          (s, e) => s + (prodPivotMap.get(dk)?.get(e.id) ?? 0), 0,
        );
        const rawwater = pivotTotal > 0 ? pivotTotal : null;
        return existing
          ? { ...existing, rawwater }
          : {
              date: format(new Date(dk + 'T00:00:00'), 'MMM d'),
              isoDate: dk + 'T00:00:00.000Z',
              production: null, consumption: null, rawwater,
              recovery: null, tds: null, kwh: null, solarKwh: null,
              nrw: null, powerCost: null, chemCost: null, totalCost: null,
            };
      }

      if (existing) return existing;
      // Stub row for a day with no readings — all metrics null / 0
      return {
        date: format(new Date(dk + 'T00:00:00'), 'MMM d'),
        isoDate: dk + 'T00:00:00.000Z',
        production: null, consumption: null, rawwater: null,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: null, powerCost: null, chemCost: null, totalCost: null,
      };
    });
  }, [overviewDates, overviewByDate, metric, prodDates, prodEntities, prodPivotMap]);

  // Tab guard: if active tab becomes irrelevant, reset
  const activeTab: DSMTab = (!hasProdTab && tab === 'production') || (!hasConsTab && tab === 'consumption') ? 'overview' : tab;

  // The shared "dates" for footer count — use per-tab.
  // For rawwater overview: use prodDates so the footer count matches Per Well.
  const tabDates = activeTab === 'consumption' ? consDates
    : activeTab === 'production' ? prodDates
    : metric === 'rawwater' ? prodDates
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
            <span className="text-2xs text-muted-foreground font-medium shrink-0">Date range:</span>
            <Input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              placeholder={defaultFrom}
              className="h-6 w-[110px] text-2xs px-1.5"
            />
            <span className="text-2xs text-muted-foreground shrink-0">→</span>
            <Input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              placeholder={defaultTo}
              className="h-6 w-[110px] text-2xs px-1.5"
            />
            {(filterFrom !== defaultFrom || filterTo !== defaultTo) && (
              <button
                onClick={() => { setFilterFrom(defaultFrom); setFilterTo(defaultTo); }}
                className="h-6 px-2 rounded text-2xs font-medium bg-muted text-muted-foreground hover:text-foreground border border-border transition-colors"
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
                <OverviewTable metric={metric} chartData={overviewChartRows} />
              )}
              {activeTab === 'production' && hasProdTab && (
                <PivotTable
                  dates={prodDates}
                  entities={prodEntities}
                  pivot={prodPivotMap}
                  totalLabel={metric === 'rawwater' ? 'Total Raw (m³)' : 'Total Prod. (m³)'}
                  unit="m³"
                  colorClass="text-primary"
                  entityType={metric === 'rawwater' || metric === 'pv' ? 'well' : hasPermeateData ? 'ro_train' : undefined}
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
                  entityType="locator"
                />
              )}
            </div>
        </div>

        {/* Footer info bar */}
        <div className="px-5 py-2 border-t shrink-0 flex items-center gap-3 text-2xs text-muted-foreground bg-muted/20">
          <span className="font-medium">{tabDates.length} days in range</span>
          {activeTab === 'production' && hasProdTab && (
            <span>· {
              metric === 'rawwater' || metric === 'pv'
                ? `${prodEntities.length} wells`
                : (() => {
                    const meterCount = prodEntities.filter((e) => e.kind === 'meter').length;
                    const roCount    = prodEntities.filter((e) => e.kind === 'ro_train').length;
                    if (meterCount > 0 && roCount > 0) {
                      return `${meterCount} product meter${meterCount === 1 ? '' : 's'} + ${roCount} RO train${roCount === 1 ? '' : 's'} (permeate)`;
                    }
                    if (roCount > 0) return `${roCount} RO train${roCount === 1 ? '' : 's'}`;
                    return `${meterCount} product meter${meterCount === 1 ? '' : 's'}`;
                  })()
            }</span>
          )}
          {activeTab === 'consumption' && hasConsTab && (
            <span>· {consEntities.length} locators</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
