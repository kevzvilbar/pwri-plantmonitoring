// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This hook owns every derived value that sits between the
// raw chartData/trendRows pipeline (useTrendChartData.ts) and the render:
// the locator/well/RO-train drill-down entity lists and their pivoted rows,
// the RO train hour/day drilldown data, the Plant Health daily/weekly/
// monthly/hourly rollups, the drill breadcrumb + focus-range slicing, the
// legend isolate/toggle handlers, and the small tooltip components used
// only by this chart.
//
// Moved verbatim from TrendChart.tsx — no logic changes. Because this block
// sits at the busiest cross-section of the component (every metric branch
// reads from it), its parameter list is necessarily long; each parameter is
// exactly one thing TrendChart.tsx already owned before this split (a piece
// of view/drill UI state, or a value from useTrendChartQueries /
// useTrendChartData).
import { useMemo } from 'react';
import { format } from 'date-fns';
import { calc } from '@/lib/calculations';
import { C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_RECOVERY, C_TDS, C_GRID_PV } from '@/lib/chartColors';
import { reasonCategoryLabel, reasonEntityPrefix } from '@/lib/reasonCodes';
import { buildEntityPivot, fillDateRange } from './TrendChartPivotShared';
import { buildEntityPivotRows, getIsoWeekStart } from './TrendChartAggregate';
import { DRILL_COLORS } from './TrendChartLegend';
import {
  type DrillCrumb, makeDrillableBarShape, toggleIsolateEntity,
  focusToRange, nextFinerGranularity, type DrillFocus,
} from './TrendChartDrillKit';

export function useTrendChartDerived(p: Record<string, any>) {
  const {
    metric, compact, drillFocus, setDrillFocus, drillMode, range,
    selectedLocatorIds, setSelectedLocatorIds, locatorSearch,
    selectedTrainIds, setSelectedTrainIds, trainSearch,
    selectedWellIds, setSelectedWellIds,
    prodDrillSource, roDrillMode, phDrillMode, setPhDrillMode, phDayFocus, setPhDayFocus,
    viewGran, setViewGran, viewBreakdown, setViewBreakdown, rawwaterBreakdown,
    hasConsumptionDrill, hasRoDrill, hasPlantHealth,
    startKey, endKey,
    trendRows, chartData,
    wellNames, locatorNames, productMeterNames, plantNames, roTrainNames,
    wellReadings, locReadings, productReadings, roReadings,
    _directLocatorIds, _directProductMeterIds, _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
  } = p;
  // ── Drill-mode locator data ───────────────────────────────────────────────
  // drillEntities: full sorted list of {id, label, color} for all active locators.
  const drillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasConsumptionDrill) return [];
    const ids = Array.from(new Set((locReadings ?? []).map((r: any) => r.locator_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: locatorNames?.get(id) ?? `Locator ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasConsumptionDrill, locReadings, locatorNames]);

  // sourceDrillEntities: per production-source breakdown for production chart.
  // Uses RO Train permeate IDs when the plant has permeate_is_production=true,
  // otherwise uses dedicated product meter IDs — mirroring the main chart's
  // production accumulation logic exactly.
  const usePermeateForSource = (metric === 'production')
    && (productReadings ?? []).length === 0
    && (roReadings ?? []).length > 0;

  const sourceDrillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'production') return [];
    if (usePermeateForSource) {
      // RO train permeate source. Secondary (2nd-pass) units excluded — see
      // _trainUnitTypeMap above; they're not an independent production
      // source, their volume is already inside their upstream train's line.
      const ids = Array.from(new Set(
        (roReadings ?? [])
          .map((r: any) => r.train_id)
          .filter((id: any) => id && _trainUnitTypeMap.get(id) !== 'secondary'),
      ));
      return ids
        .map((id: string, i) => ({
          id,
          label: roTrainNames?.get(id) ?? `RO Train ${String(id).slice(-4)}`,
          color: DRILL_COLORS[i % DRILL_COLORS.length],
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    // Product meter source
    const ids = Array.from(new Set((productReadings ?? []).map((r: any) => r.meter_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: productMeterNames?.get(id) ?? `Meter ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, usePermeateForSource, productReadings, roReadings, productMeterNames, roTrainNames]);

  // activeEntities: locator or production source depending on prodDrillSource
  const activeEntities = metric === 'production' && prodDrillSource === 'source'
    ? sourceDrillEntities : drillEntities;

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

  // ── Raw Water — well entities + per-well pivot rows ─────────────────────
  // Same computeEntityDeltas/buildEntityPivot strategy chartData already
  // uses for the well-summed Total series (see the "Raw Water = sum of
  // per-well deltas" comment above) — this is the SAME data, just kept
  // per-well instead of summed, then run through the same
  // buildEntityPivotRows the Production/NRW breakdown uses for its
  // daily/weekly/monthly bucketing. No new fetch, no new delta logic.
  const wellEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'rawwater') return [];
    const ids = Array.from(new Set((wellReadings ?? []).map((r: any) => r.well_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: wellNames?.get(id) ?? `Well ${String(id).slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, wellReadings, wellNames]);

  const visibleWellEntities = useMemo(
    () => selectedWellIds === null ? wellEntities : wellEntities.filter((e) => selectedWellIds.has(e.id)),
    [wellEntities, selectedWellIds],
  );

  const wellEntityRows = useMemo(() => {
    if (metric !== 'rawwater' || rawwaterBreakdown !== 'by-well') return [];
    const sorted = [...(wellReadings ?? [])].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot, dateKeys } = buildEntityPivot(sorted, 'well_id');
    return buildEntityPivotRows(pivot, dateKeys, visibleWellEntities, viewGran, startKey, endKey);
  }, [metric, rawwaterBreakdown, wellReadings, visibleWellEntities, viewGran, startKey, endKey]);

  const handleWellLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedWellIds((prev) => toggleIsolateEntity(prev, id, wellEntities.map((x) => x.id)));
  };

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

  // entityRows: unified per-entity breakdown (Foundation) — replaces the
  // old drilldownData (daily-only, rendered as Lines) + drillupData
  // (monthly-only, rendered as Bars) pair. That split was exactly the
  // inconsistency the plan called out: "the by-locator/by-source breakdown
  // renders as lines at daily granularity but grouped bars at monthly."
  // One buildEntityPivotRows call now serves daily/weekly/monthly; the
  // chart-type choice (Line vs Bar) is made once at render time from
  // viewGran, not baked into which memo happened to run. The per-source
  // pivot-building logic (permeate delta rule, direct-mode locators,
  // product-meter IDs) is untouched — only the "how do these dateKeys
  // become chart rows" tail end was duplicated, and that's what moved into
  // the shared buildEntityPivotRows helper.
  const entityRows = useMemo(() => {
    if (!hasConsumptionDrill || drillMode !== 'drilldown') return [];
    const isSource = metric === 'production' && prodDrillSource === 'source';

    let pivot: Map<string, Map<string, number>>;
    let dateKeys: string[];

    if (isSource && usePermeateForSource) {
      // RO permeate pivot has its own delta rule (permeate_meter_delta, or
      // a manual current/prev diff) — doesn't fit buildEntityPivot as-is.
      const roSorted = [...(roReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const p = new Map<string, Map<string, number>>();
      roSorted.forEach((r: any) => {
        if (r.is_meter_replacement) return;
        if (_trainUnitTypeMap.get(r.train_id) === 'secondary') return;
        const delta = r.permeate_meter_delta != null
          ? Math.max(0, +r.permeate_meter_delta)
          : r.permeate_meter != null && r.permeate_meter_prev != null
            ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
            : null;
        if (delta === null || delta === 0) return;
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        const tid = r.train_id ?? '__';
        if (!p.has(dk)) p.set(dk, new Map());
        p.get(dk)!.set(tid, (p.get(dk)!.get(tid) ?? 0) + delta);
      });
      pivot = p;
      dateKeys = Array.from(p.keys()).sort();
    } else if (isSource) {
      const sorted = [...(productReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const built = buildEntityPivot(sorted, 'meter_id', _directProductMeterIds);
      pivot = built.pivot; dateKeys = built.dateKeys;
    } else {
      const sorted = [...(locReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const built = buildEntityPivot(sorted, 'locator_id', _directLocatorIds);
      pivot = built.pivot; dateKeys = built.dateKeys;
    }

    return buildEntityPivotRows(pivot, dateKeys, visibleEntities, viewGran, startKey, endKey);
  }, [hasConsumptionDrill, drillMode, prodDrillSource, metric, locReadings, productReadings, roReadings,
      usePermeateForSource, visibleEntities, _directLocatorIds, _directProductMeterIds, viewGran, startKey, endKey]);

  // ── RO drill helpers ─────────────────────────────────────────────────────
  // Full list of trains found in the fetched roReadings
  const roTrainEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasRoDrill) return [];
    const ids = Array.from(new Set((roReadings ?? []).map((r: any) => r.train_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
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
  // RO by-train breakdown — now Daily/Weekly/Monthly (M4's deferred item).
  // Each entity's daily figure is already a per-train AVERAGE (sum/count of
  // that train's readings that day), not a volume — summing daily averages
  // into a week would be meaningless. buildEntityPivotRows' 'weighted-avg'
  // mode instead takes Σ(value×sampleCount)/Σ(sampleCount), using a
  // companion weightPivot of each day's per-train sample count, so a week
  // with one noisy low-sample day doesn't skew the average as much as a
  // day with plenty of readings. _total comes back as a genuine fleet-wide
  // weighted average across all visible trains, for free.
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

    // Daily average per train (unchanged math) — weightPivot carries each
    // day's sample count so weekly/monthly can weight correctly.
    const avgPivot = new Map<string, Map<string, number>>();
    const weightPivot = new Map<string, Map<string, number>>();
    acc.forEach((trainAcc, dk) => {
      const avgRow = new Map<string, number>();
      const wRow = new Map<string, number>();
      trainAcc.forEach(({ sum, count }, tid) => {
        avgRow.set(tid, +(sum / count).toFixed(metric === 'tds' ? 0 : 1));
        wRow.set(tid, count);
      });
      avgPivot.set(dk, avgRow);
      weightPivot.set(dk, wRow);
    });

    return buildEntityPivotRows(
      avgPivot, dateKeys, visibleTrainEntities, viewGran, startKey, endKey,
      { mode: 'weighted-avg', weightPivot },
    );
  }, [hasRoDrill, roDrillMode, roReadings, visibleTrainEntities, selectedTrainIds, valueKey, metric,
      viewGran, startKey, endKey]);

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

  // ── Plant Health data ────────────────────────────────────────────────────
  // Derived from ro_train_readings: for each time slot, count how many
  // distinct trains had ≥1 reading, divide by total trains for the plant(s).
  // totalTrains = _roTrainIdsForReadings.length (same scope as the readings query).

  const phTotalTrains = (_roTrainIdsForReadings ?? []).length;

  /** Build one health row per time slot from ro_train_readings.
   *  slotKeyFn: Date → grouping bucket key
   *  labelFn:   Date → X-axis display label */
  function buildPhHealthRows(
    readings: any[],
    slotKeyFn: (d: Date) => string,
    labelFn:   (d: Date) => string,
  ) {
    if (!phTotalTrains) return [] as {
      date: string; healthPct: number | null;
      onlineCount: number | null; offlineCount: number | null;
      totalTrains: number; offlineTrains: string[];
    }[];
    const acc = new Map<string, { trains: Set<string>; ts: number }>();
    readings.forEach((r: any) => {
      if (!r.train_id) return;
      const dt  = new Date(r.reading_datetime);
      const key = slotKeyFn(dt);
      if (!acc.has(key)) acc.set(key, { trains: new Set(), ts: dt.getTime() });
      acc.get(key)!.trains.add(r.train_id);
    });
    const allTrainIds  = new Set<string>(_roTrainIdsForReadings ?? []);
    const trainLabel   = (id: string) =>
      roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`;

    return Array.from(acc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([key, { trains, ts }]) => {
        const onlineCount  = trains.size;
        const totalTrains  = phTotalTrains;
        const offlineCount = Math.max(0, totalTrains - onlineCount);
        const healthPct    = totalTrains > 0
          ? Math.round((onlineCount / totalTrains) * 100) : null;
        const offlineTrains = Array.from<string>(allTrainIds)
          .filter(id => !trains.has(id))
          .map(trainLabel);
        const dt = new Date(ts);
        return {
          date: labelFn(dt),
          healthPct,
          onlineCount,
          offlineCount,
          totalTrains,
          offlineTrains,
          _slotKey: key,
        };
      });
  }

  const phDailyData = useMemo(() => {
    if (!hasPlantHealth) return [];
    return buildPhHealthRows(
      roReadings ?? [],
      (d) => format(d, 'yyyy-MM-dd'),
      (d) => format(d, 'MMM d'),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames, phTotalTrains]);

  const phHourlyData = useMemo(() => {
    if (!hasPlantHealth) return [];
    return buildPhHealthRows(
      roReadings ?? [],
      (d) => format(d, 'yyyy-MM-dd HH'),
      (d) => format(d, 'MMM d, haaa'),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames, phTotalTrains]);

  const phMonthlyData = useMemo(() => {
    if (!hasPlantHealth || !phTotalTrains) return [];
    // Aggregate daily health % per calendar month → average
    const dayAcc = new Map<string, Set<string>>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r.train_id) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!dayAcc.has(dk)) dayAcc.set(dk, new Set());
      dayAcc.get(dk)!.add(r.train_id);
    });
    const monthAcc = new Map<string, { sumPct: number; count: number; ts: number }>();
    dayAcc.forEach((trains, dk) => {
      const mk  = dk.slice(0, 7);
      const pct = (trains.size / phTotalTrains) * 100;
      const ts  = new Date(dk + 'T00:00:00').getTime();
      const prev = monthAcc.get(mk) ?? { sumPct: 0, count: 0, ts };
      monthAcc.set(mk, { sumPct: prev.sumPct + pct, count: prev.count + 1, ts: prev.ts });
    });
    return Array.from(monthAcc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([, { sumPct, count, ts }]) => ({
        date:         format(new Date(ts), 'MMM yyyy'),
        healthPct:    Math.round(sumPct / count),
        onlineCount:  null as number | null,
        offlineCount: null as number | null,
        totalTrains:  phTotalTrains,
        offlineTrains: [] as string[],
        _slotKey:     '',
      }));
  }, [hasPlantHealth, roReadings, phTotalTrains]);

  // Weekly (M4) — same daily-health%-then-average pattern as phMonthlyData,
  // just bucketed by ISO Monday-start week (getIsoWeekStart) instead of
  // calendar month, so it agrees with every other weekly bucket on the
  // dashboard. Averaging each day's (trains-online / totalTrains) % across
  // the days in a week is mathematically identical to (sum of trains-online
  // that week) / (totalTrains × dayCount) — no separate weight needed since
  // the denominator (totalTrains) doesn't change day to day.
  const phWeeklyData = useMemo(() => {
    if (!hasPlantHealth || !phTotalTrains) return [];
    const dayAcc = new Map<string, Set<string>>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r.train_id) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!dayAcc.has(dk)) dayAcc.set(dk, new Set());
      dayAcc.get(dk)!.add(r.train_id);
    });
    const weekAcc = new Map<string, { sumPct: number; count: number; ts: number; label: string }>();
    dayAcc.forEach((trains, dk) => {
      const dayDate = new Date(dk + 'T00:00:00');
      const weekStart = getIsoWeekStart(dayDate);
      const wk = format(weekStart, 'yyyy-MM-dd');
      const pct = (trains.size / phTotalTrains) * 100;
      const prev = weekAcc.get(wk) ?? { sumPct: 0, count: 0, ts: weekStart.getTime(), label: `Wk of ${format(weekStart, 'MMM d')}` };
      weekAcc.set(wk, { sumPct: prev.sumPct + pct, count: prev.count + 1, ts: prev.ts, label: prev.label });
    });
    return Array.from(weekAcc.values())
      .sort((a, b) => a.ts - b.ts)
      .map(({ sumPct, count, label }) => ({
        date:         label,
        healthPct:    Math.round(sumPct / count),
        onlineCount:  null as number | null,
        offlineCount: null as number | null,
        totalTrains:  phTotalTrains,
        offlineTrains: [] as string[],
        _slotKey:     '',
      }));
  }, [hasPlantHealth, roReadings, phTotalTrains]);

  // Hourly rows narrowed to the clicked day, when a day→hour drill is active.
  // buildPhHealthRows' inferred return type unions its early-return (no
  // phTotalTrains yet) and normal-return (has _slotKey) shapes, so this
  // reads through `any` rather than fighting that union — same convention
  // the rest of this file's Recharts/row-shaped callbacks already use.
  const phFocusedHourlyData = phDayFocus
    ? phHourlyData.filter((r: any) => typeof r._slotKey === 'string' && r._slotKey.startsWith(phDayFocus))
    : phHourlyData;

  const phActiveData = hasPlantHealth
    ? phDrillMode === 'hourly'  ? phFocusedHourlyData
    : phDrillMode === 'weekly' ? phWeeklyData
    : phDrillMode === 'monthly' ? phMonthlyData
    : phDailyData
    : [];

  // Bar click (well, dot click — Plant Health is a Line, not bars) → jump
  // into that day's Hourly view. Mirrors handleDrillBarActivate's shape
  // (payload → next state) but Plant Health keeps its own drill state
  // machine on purpose (see the plan: merging the three drill systems was
  // ruled out as more risk than this round needs).
  const handlePhDayDotActivate = (payload: Record<string, unknown> | undefined) => {
    const key = payload?._slotKey as string | undefined;
    if (!key) return;
    setPhDayFocus(key);
    setPhDrillMode('hourly');
  };



  // Custom tooltip — same look as Recharts default but:
  //  • Shows the true raw (unclamped) value for any field that was clamped to 0
  //  • When the zero was caused by a meter replacement, shows "🔧 [Name] was Replaced"
  //    instead of the generic "⚠️ Negative reading" warning
  //  • If both a replacement AND a genuine negative exist on the same day, shows both
  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    // Looks up from trendRows (not chartData) so this still resolves once
    // the chart is bucketed to Weekly/Monthly, where `label` is a bucket
    // label ("Wk of Aug 4" / "Aug 2026") rather than a daily one. union'd
    // _meterReplacements/_permeateSourceNames (see TREND_FIELD_AGG) mean a
    // mid-week replacement still surfaces on the bucket that contains it.
    const chartRow: any = trendRows.find((d: any) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];
    const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];
    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 10,
        fontSize: 11,
        padding: '9px 12px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: 'var(--shadow-elev)',
        backdropFilter: 'blur(8px)',
      }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 12, letterSpacing: '-0.01em' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ margin: '2px 0', color: entry.color ?? entry.stroke, fontWeight: 500 }}>
            {entry.name}:{' '}
            <span style={{ fontWeight: 700 }}>{entry.value != null ? entry.value.toLocaleString() : '—'}</span>
          </p>
        ))}
        {replacements.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
            {replacements.map((name) => (
              <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--warn))', marginBottom: 2 }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        {permeateSourceNames.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--muted-foreground))' }}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
            <span style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.85 }}>
              Source: Permeate meter ({permeateSourceNames.join(', ')})
            </span>
          </div>
        )}
      </div>
    );
  };

  const chartHeight = compact ? 'h-[200px]' : 'h-[340px]';

  // ── M3: click-to-drill handler — shared between NRW's default (Total)
  // bars and the entity-breakdown bars. Bar click → time-drills into that
  // bucket at the next-finer granularity (a month's bar → that month's
  // weeks; a week's bar → that week's days); clicking a DAILY bar in the
  // Total view instead opens the by-locator breakdown, matching "a day's
  // bar in NRW → that day's by-locator breakdown" from the plan. Wired
  // into Production/NRW first (the flagship case); TDS/Recovery and Plant
  // Health can reuse the same makeDrillableBarShape + this pattern.
  const handleDrillBarActivate = (payload: Record<string, unknown>) => {
    if (viewGran === 'daily') {
      if (drillMode === 'default') setViewBreakdown('by-locator');
      return;
    }
    const bucketIsoDate = payload.isoDate as string | undefined;
    if (!bucketIsoDate) return;
    setDrillFocus({
      bucketIsoDate,
      label: payload.date as string,
      fromGranularity: viewGran as 'monthly' | 'weekly',
    });
    setViewGran(nextFinerGranularity(viewGran as 'monthly' | 'weekly'));
  };

  const drillFocusRange = drillFocus ? focusToRange(drillFocus) : null;
  // Rows for whichever chart is currently drilled into a specific
  // week/month, narrowed to that bucket's calendar span. Both the
  // entity-breakdown bars and NRW's own Total bars read from this so a
  // drill click visibly narrows the x-axis instead of just relabeling it.
  const focusedTrendRows = drillFocusRange
    ? trendRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : trendRows;
  const focusedEntityRows = drillFocusRange
    ? entityRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : entityRows;

  const drillCrumbs: DrillCrumb[] = drillFocus
    ? [
        { label: range === 'CUSTOM' ? 'Custom range' : range, onSelect: () => setDrillFocus(null) },
        { label: drillFocus.label },
      ]
    : phDayFocus
    ? [
        { label: range === 'CUSTOM' ? 'Custom range' : range, onSelect: () => { setPhDrillMode('daily'); setPhDayFocus(null); } },
        { label: format(new Date(phDayFocus + 'T00:00:00'), 'MMM d') },
      ]
    : [];

  // Legend click → isolate a single entity; click it again to restore all.
  const handleLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedLocatorIds((prev) => toggleIsolateEntity(prev, id, activeEntities.map((x) => x.id)));
  };
  // TDS/Recovery by-train's analogue of handleLegendIsolate above — trains
  // aren't locators, so isolating one has to update selectedTrainIds (what
  // visibleTrainEntities actually filters on), not selectedLocatorIds.
  const handleTrainLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedTrainIds((prev) => toggleIsolateEntity(prev, id, roTrainEntities.map((x) => x.id)));
  };

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
    // trendRows (not chartData) so this resolves once bucketed to
    // Weekly/Monthly — production/kwh/solarKwh are bucket sums, so the
    // ratio shown here is the bucket's true (kWh total)/(m³ total), not an
    // average of daily ratios.
    const row: any = trendRows.find((d: any) => d.date === label);
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
        minWidth: 200, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
      }}>
        <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
        <p style={{ margin: '1px 0', color: C_GRID_PV }}>
          Grid PV: <strong>{gridPv != null ? `${gridPv} kWh/m³` : '0 kWh/m³'}</strong>
        </p>
        {hasSolar && (
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            (Grid+Solar) PV: <strong>{totalPv != null ? `${totalPv} kWh/m³` : '—'}</strong>
          </p>
        )}
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            Volume: <span>{row.production > 0 ? row.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m³' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: C_GRID_PV }}>
            Grid Power: <span>{row.kwh > 0 ? row.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            Solar: <span>{row.solarKwh > 0 ? row.solarKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
        </div>
      </div>
    );
  };

  return {
    drillEntities, usePermeateForSource, sourceDrillEntities, activeEntities, visibleEntities,
    filteredLocatorList, wellEntities, visibleWellEntities, wellEntityRows, handleWellLegendIsolate,
    allSelected, noneSelected, toggleLocator, selectAllLocators, clearAllLocators,
    entityRows, roTrainEntities, visibleTrainEntities, filteredTrainList, allTrainsSelected, noTrainsSelected,
    toggleTrain, selectAllTrains, clearAllTrains, valueKey, roUnit,
    roTrainDrillData, roHourDrillData, phTotalTrains, phDailyData, phHourlyData, phMonthlyData, phWeeklyData,
    phFocusedHourlyData, phActiveData, handlePhDayDotActivate, NegativeAwareTooltip, chartHeight,
    handleDrillBarActivate, drillFocusRange, focusedTrendRows, focusedEntityRows, drillCrumbs,
    handleLegendIsolate, handleTrainLegendIsolate, formatYAxis, PvTooltip,
  };
}
