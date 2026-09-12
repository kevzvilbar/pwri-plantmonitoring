import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { calc } from '@/lib/calculations';
import {
  DSMTab, buildEntityPivot, fillDateRange, fmtDateKey,
  computeGridMeterBreakdown, buildKwhSummaryCsv, type GridPowerReadingRow,
  GRID_METER_OTHER_KEY,
} from '../TrendChartPivotShared';
import type { ChemicalDayBreakdown } from '../TrendChartTables';
import { calculateDataSummaryStats } from './summaryStatsCalculator';

export interface DataSummaryData {
  tab: DSMTab;
  setTab: (t: DSMTab) => void;
  activeTab: DSMTab;
  filterFrom: string;
  filterTo: string;
  setFilterFrom: (v: string) => void;
  setFilterTo: (v: string) => void;
  defaultFrom: string;
  defaultTo: string;
  parsedFrom: Date | null;
  parsedTo: Date | null;
  filteredChartData: any[];
  filteredLocReadings: any[];
  filteredProductReadings: any[];
  filteredWellReadings: any[];
  filteredRoReadings: any[];
  gridMeterMeta: any;
  gridBreakdown: ReturnType<typeof computeGridMeterBreakdown>;
  hasProdTab: boolean;
  hasConsTab: boolean;
  hasGridTab: boolean;
  hasChemBreakdownTab: boolean;
  chemicalBreakdown: Map<string, ChemicalDayBreakdown>;
  overviewLabel: string;
  prodTabLabel: string;
  roTrainEntities: { id: string; label: string }[];
  roTrainRecoveryByDate: Map<string, Record<string, number>>;
  roTrainTdsByDate: Map<string, Record<string, number>>;
  /** plantHealth metric — per-day per-train status map */
  phHealthByDate: Map<string, {
    trainOnline: Record<string, boolean>;   // trainId → online (had readings that day)
    trainHours: Record<string, number>;     // trainId → estimated hours with readings
    onlineCount: number;
    offlineCount: number;
    healthPct: number | null;
    totalTrains: number;
  }>;
  prodEntities: { id: string; label: string; kind: 'well' | 'meter' | 'ro_train' }[];
  prodPivotMap: Map<string, Map<string, number>>;
  prodDateKeys: string[];
  prodDates: string[];
  hasProductMeterData: boolean;
  hasPermeateData: boolean;
  consEntities: { id: string; label: string }[];
  consPivot: Map<string, Map<string, number>>;
  consDateKeys: string[];
  consDates: string[];
  overviewDates: string[];
  overviewChartRows: any[];
  tabDates: string[];
  summaryStats: {
    totalProd: number;
    totalCons: number;
    totalRaw: number;
    avgDailyProd: number;
    avgDailyCons: number;
    avgDailyRaw: number;
    peakProd: number;
    peakDate: string;
    peakRaw: number;
    nrwPct: number;
    totalSolar: number;
    totalGrid: number;
    totalKwh: number;
    solarPct: number;
    gridPvRatio: number | null;
    totalPvRatio: number | null;
    avgProdCost: number | null;
    avgPowerCost: number | null;
    avgChemCost: number | null;
    totalCostOutput: number;
    avgRecovery: number | null;
    minRecovery: number | null;
    maxRecovery: number | null;
    recoveryDays: number;
    avgTds: number | null;
    minTds: number | null;
    maxTds: number | null;
    tdsDays: number;
  };
}

export interface DataSummaryDataProps {
  open: boolean;
  metric: string;
  chartData: any[];
  locReadings: any[];
  productReadings: any[];
  wellReadings: any[];
  costReadings: any[];
  roReadings?: any[];
  powerReadings?: GridPowerReadingRow[];
  powerConfigMap?: Map<string, number[]>;
  billMultiplierMap?: Map<string, number>;
  permeateIsProductionPlants?: Set<string>;
  productExcludedPlants?: Set<string>;
  trainPlantMap?: Map<string, string>;
  locatorNames?: Map<string, string>;
  productMeterNames?: Map<string, string>;
  wellNames?: Map<string, string>;
  plantNames?: Map<string, string>;
  roTrainNames?: Map<string, string>;
  directLocatorIds?: Set<string>;
  directMeterIds?: Set<string>;
}

export function useDataSummaryData({
  open, metric, chartData,
  locReadings, productReadings, wellReadings, costReadings,
  roReadings, powerReadings, powerConfigMap, billMultiplierMap,
  permeateIsProductionPlants, productExcludedPlants, trainPlantMap,
  locatorNames, productMeterNames, wellNames, plantNames, roTrainNames,
  directLocatorIds, directMeterIds,
}: DataSummaryDataProps): DataSummaryData {
  const [tab, setTab] = useState<DSMTab>('overview');

  const allDates = useMemo(() => {
    const datesFromChart = chartData
      .map((d) => (d.isoDate ? format(new Date(d.isoDate as string), 'yyyy-MM-dd') : undefined))
      .filter((d): d is string => !!d);
    if (datesFromChart.length > 0) return datesFromChart;

    const datesFromReadings = new Set<string>();
    const addDate = (r: any) => {
      if (r?.reading_datetime) {
        try {
          datesFromReadings.add(format(new Date(r.reading_datetime), 'yyyy-MM-dd'));
        } catch { /* ignore */ }
      }
    };
    locReadings?.forEach(addDate);
    productReadings?.forEach(addDate);
    wellReadings?.forEach(addDate);
    roReadings?.forEach(addDate);
    return Array.from(datesFromReadings).sort();
  }, [chartData, locReadings, productReadings, wellReadings, roReadings]);

  const defaultFrom = allDates.length ? allDates[0] : '';
  const defaultTo = allDates.length ? allDates[allDates.length - 1] : '';
  const [filterFrom, setFilterFrom] = useState(defaultFrom);
  const [filterTo, setFilterTo] = useState(defaultTo);

  useEffect(() => {
    if (!filterFrom && defaultFrom) setFilterFrom(defaultFrom);
    if (!filterTo && defaultTo) setFilterTo(defaultTo);
  }, [defaultFrom, defaultTo]);

  const parsedFrom = filterFrom ? new Date(`${filterFrom}T00:00:00`) : null;
  const parsedTo = filterTo ? new Date(`${filterTo}T23:59:59`) : null;

  const filteredChartData = useMemo(() => {
    if (!parsedFrom && !parsedTo) return chartData;
    return chartData.filter((d) => {
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

  const plantIdsForPower = useMemo(() => {
    const ids = new Set<string>();
    (powerReadings ?? []).forEach((r) => { if (r.plant_id) ids.add(r.plant_id); });
    return [...ids];
  }, [powerReadings]);

  const { data: gridMeterMeta } = useQuery({
    queryKey: ['dsm-grid-meter-meta', plantIdsForPower],
    queryFn: async () => {
      const map = new Map<string, { names: string[]; count: number }>();
      if (!plantIdsForPower.length) return map;
      const { data, error } = await supabase
        .from('plant_power_config')
        .select('plant_id, grid_meter_names, grid_meter_count')
        .in('plant_id', plantIdsForPower);
      if (!error) {
        for (const cfg of data ?? []) {
          map.set(cfg.plant_id, {
            names: Array.isArray(cfg.grid_meter_names) ? cfg.grid_meter_names.map(String) : [],
            count: Math.max(1, Number(cfg.grid_meter_count) || 1),
          });
        }
      }
      return map;
    },
    enabled: open && metric === 'kwh' && plantIdsForPower.length > 0,
    staleTime: 10 * 60_000,
  });

  const gridBreakdown = useMemo(() => {
    const fMs = filterFrom ? new Date(`${filterFrom}T00:00:00`).getTime() : null;
    const tMs = filterTo ? new Date(`${filterTo}T23:59:59`).getTime() : null;
    return computeGridMeterBreakdown(powerReadings ?? [], {
      powerConfigMap, billMultiplierMap, plantNames, gridMeterMeta,
      fromMs: fMs, toMs: tMs,
    });
  }, [powerReadings, powerConfigMap, billMultiplierMap, plantNames, gridMeterMeta, filterFrom, filterTo]);

  const hasProdTab = metric === 'production' || metric === 'nrw' || metric === 'pv';
  const hasConsTab = metric === 'production' || metric === 'nrw';
  const hasGridTab = metric === 'kwh';
  const hasChemBreakdownTab = metric === 'productionCost' || metric === 'chemCost';

  const overviewLabel =
    metric === 'production' || metric === 'nrw' ? 'Prod. vs Consum.'
    : metric === 'pv' ? 'Prod. vs Power'
    : metric === 'productionCost' ? 'Cost Overview'
    : metric === 'chemCost' ? 'Chemical Cost'
    : metric === 'powerCost' ? 'Power Cost'
    : metric === 'kwh' ? 'Solar vs Grid'
    : 'Overview';

  const prodTabLabel =
    metric === 'rawwater' ? 'Per Well'
    : metric === 'pv' ? 'Per Well / Meter'
    : 'Production';

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

  const roTrainEntities = useMemo<{ id: string; label: string }[]>(() => {
    const idsFromReadings = (filteredRoReadings ?? []).map((r: any) => r.train_id).filter(Boolean);
    const idsFromNames = roTrainNames ? Array.from(roTrainNames.keys()) : [];
    const allIds = Array.from(new Set([...idsFromReadings, ...idsFromNames]));
    return allIds.map((id) => ({
      id,
      label: roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`,
    })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [filteredRoReadings, roTrainNames]);

  const { roTrainRecoveryByDate, roTrainTdsByDate } = useMemo(() => {
    const recoveryAcc = new Map<string, Map<string, { sum: number; count: number }>>();
    const tdsAcc = new Map<string, Map<string, { sum: number; count: number }>>();

    (filteredRoReadings ?? []).forEach((r: any) => {
      if (!r.train_id || !r.reading_datetime) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');

      if (r.recovery_pct != null && !isNaN(+r.recovery_pct)) {
        if (!recoveryAcc.has(dk)) recoveryAcc.set(dk, new Map());
        const tMap = recoveryAcc.get(dk)!;
        const cur = tMap.get(r.train_id) ?? { sum: 0, count: 0 };
        tMap.set(r.train_id, { sum: cur.sum + (+r.recovery_pct), count: cur.count + 1 });
      }

      if (r.permeate_tds != null && !isNaN(+r.permeate_tds)) {
        if (!tdsAcc.has(dk)) tdsAcc.set(dk, new Map());
        const tMap = tdsAcc.get(dk)!;
        const cur = tMap.get(r.train_id) ?? { sum: 0, count: 0 };
        tMap.set(r.train_id, { sum: cur.sum + (+r.permeate_tds), count: cur.count + 1 });
      }
    });

    const recoveryByDate = new Map<string, Record<string, number>>();
    recoveryAcc.forEach((tMap, dk) => {
      const rec: Record<string, number> = {};
      tMap.forEach((v, tid) => {
        if (v.count > 0) rec[tid] = +(v.sum / v.count).toFixed(1);
      });
      recoveryByDate.set(dk, rec);
    });

    const tdsByDate = new Map<string, Record<string, number>>();
    tdsAcc.forEach((tMap, dk) => {
      const rec: Record<string, number> = {};
      tMap.forEach((v, tid) => {
        if (v.count > 0) rec[tid] = Math.round(v.sum / v.count);
      });
      tdsByDate.set(dk, rec);
    });

    return { roTrainRecoveryByDate: recoveryByDate, roTrainTdsByDate: tdsByDate };
  }, [filteredRoReadings]);

  /** Per-day per-train plant health data (used by OverviewTable for plantHealth metric) */
  const phHealthByDate = useMemo(() => {
    const result = new Map<string, {
      trainOnline: Record<string, boolean>;
      trainHours: Record<string, number>;
      onlineCount: number;
      offlineCount: number;
      healthPct: number | null;
      totalTrains: number;
    }>();
    if (metric !== 'plantHealth' || !filteredRoReadings.length) return result;

    // Group readings by date → train → unique hours (to estimate run hours)
    const dateTrainHours = new Map<string, Map<string, Set<string>>>();
    filteredRoReadings.forEach((r: any) => {
      if (!r.train_id || !r.reading_datetime) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const hk = format(new Date(r.reading_datetime), 'yyyy-MM-dd HH');
      if (!dateTrainHours.has(dk)) dateTrainHours.set(dk, new Map());
      const trainMap = dateTrainHours.get(dk)!;
      if (!trainMap.has(r.train_id)) trainMap.set(r.train_id, new Set());
      trainMap.get(r.train_id)!.add(hk);
    });

    const allTrainIds = roTrainEntities.map((e) => e.id);
    const totalTrains = allTrainIds.length;

    dateTrainHours.forEach((trainMap, dk) => {
      const trainOnline: Record<string, boolean> = {};
      const trainHours: Record<string, number> = {};
      let onlineCount = 0;
      allTrainIds.forEach((tid) => {
        const hours = trainMap.get(tid)?.size ?? 0;
        const online = hours > 0;
        trainOnline[tid] = online;
        trainHours[tid] = hours;
        if (online) onlineCount++;
      });
      const offlineCount = Math.max(0, totalTrains - onlineCount);
      const healthPct = totalTrains > 0 ? Math.round((onlineCount / totalTrains) * 100) : null;
      result.set(dk, { trainOnline, trainHours, onlineCount, offlineCount, healthPct, totalTrains });
    });

    return result;
  }, [metric, filteredRoReadings, roTrainEntities]);

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
  const hasPermeateData = (metric === 'production' || metric === 'nrw' || metric === 'pv') && permeateReadingsForPivot.length > 0;
  const usePermeate = hasPermeateData && !hasProductMeterData;

  const prodEntities = useMemo<{ id: string; label: string; kind: 'well' | 'meter' | 'ro_train' }[]>(() => {
    if (metric === 'rawwater' || metric === 'pv') {
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
        label: hasProductMeterData
          ? `${roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`} (Permeate)`
          : roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`,
        kind: 'ro_train' as const,
      })));
    }
    return entities.sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, filteredWellReadings, wellNames, hasProductMeterData, hasPermeateData,
      prodMeterReadingsForPivot, permeateReadingsForPivot, productMeterNames, roTrainNames]);

  const prodPivot = useMemo(() => {
    if (metric === 'rawwater' || metric === 'pv') {
      // Pass ALL wellReadings (including pre-window baseline rows fetched by the query)
      // sorted ascending so buildEntityPivot can seed lastSeen/afterRepl from pre-window
      // meter-replacement rows before skipping them via minDateKey.
      return buildEntityPivot(
        [...(wellReadings ?? [])].sort((a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()),
        'well_id',
        undefined,
        filterFrom || undefined, // minDateKey: pre-window rows seed state but are not emitted
      );
    }

    const pivot = new Map<string, Map<string, number>>();
    const dateKeySet = new Set<string>();

    if (hasProductMeterData) {
      const { pivot: meterPivot, dateKeys: meterDateKeys } = buildEntityPivot(
        [...prodMeterReadingsForPivot].sort((a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()),
        'meter_id',
        directMeterIds,
      );
      meterDateKeys.forEach((dk) => {
        dateKeySet.add(dk);
        if (!pivot.has(dk)) pivot.set(dk, new Map());
        meterPivot.get(dk)?.forEach((v, k) => pivot.get(dk)!.set(k, (pivot.get(dk)!.get(k) ?? 0) + v));
      });
    }

    if (hasPermeateData) {
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
  }, [metric, wellReadings, filterFrom, hasProductMeterData, hasPermeateData,
      prodMeterReadingsForPivot, permeateReadingsForPivot, directMeterIds]);

  const prodPivotMap = prodPivot.pivot;
  const prodDateKeys = prodPivot.dateKeys;

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

  const consDates = useMemo(() => {
    if (consDateKeys.length === 0) return [];
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

  const overviewDates = useMemo(() => {
    if (filterFrom && filterTo) {
      return fillDateRange(filterFrom, filterTo);
    }
    const allKeys = filteredChartData
      .filter((d) => d.isoDate)
      .map((d) => format(new Date(d.isoDate as string), 'yyyy-MM-dd'));
    if (allKeys.length > 0) {
      const start = filterFrom || allKeys[0];
      const end   = filterTo   || allKeys[allKeys.length - 1];
      return fillDateRange(start, end);
    }
    if (prodDates.length > 0) return prodDates;
    if (consDates.length > 0) return consDates;
    return [];
  }, [filteredChartData, filterFrom, filterTo, prodDates, consDates]);

  const overviewByDate = useMemo(() => {
    const map = new Map<string, any>();
    filteredChartData.forEach((d) => {
      if (d.isoDate) map.set(format(new Date(d.isoDate as string), 'yyyy-MM-dd'), d);
    });
    return map;
  }, [filteredChartData]);

  const overviewChartRows = useMemo(() => {
    const dates = metric === 'rawwater' ? prodDates : overviewDates;

    return dates.map((dk) => {
      const existing = overviewByDate.get(dk);
      const trainRecoveries = roTrainRecoveryByDate.get(dk);
      const trainTds = roTrainTdsByDate.get(dk);

      const pivotProdTotal = prodEntities.reduce(
        (s, e) => s + (prodPivotMap.get(dk)?.get(e.id) ?? 0), 0,
      );
      const pivotConsTotal = consEntities.reduce(
        (s, e) => s + (consPivot.get(dk)?.get(e.id) ?? 0), 0,
      );

      const production = existing?.production != null
        ? existing.production
        : (pivotProdTotal > 0 ? pivotProdTotal : null);

      const consumption = existing?.consumption != null
        ? existing.consumption
        : (pivotConsTotal > 0 ? pivotConsTotal : null);

      const rawwater = existing?.rawwater != null
        ? existing.rawwater
        : (metric === 'rawwater' && pivotProdTotal > 0 ? pivotProdTotal : null);

      const nrw = existing?.nrw != null
        ? existing.nrw
        : (production != null && consumption != null ? calc.nrw(production, consumption) : null);

      const base = existing ?? {
        date: format(new Date(dk + 'T00:00:00'), 'MMM d'),
        isoDate: dk + 'T00:00:00.000Z',
        recovery: null, tds: null, kwh: null, solarKwh: null,
        powerCost: null, chemCost: null, totalCost: null,
      };

      return {
        ...base,
        production,
        consumption,
        rawwater,
        nrw,
        trainRecoveries,
        trainTds,
      };
    });
  }, [overviewDates, overviewByDate, metric, prodDates, prodEntities, prodPivotMap,
      consEntities, consPivot, roTrainRecoveryByDate, roTrainTdsByDate]);

  const filteredCostReadings = useMemo(() => {
    if (!costReadings) return [];
    if (!filterFrom && !filterTo) return costReadings;
    return costReadings.filter((r) => {
      const dt = r.cost_date;
      if (filterFrom && dt < filterFrom) return false;
      if (filterTo && dt > filterTo) return false;
      return true;
    });
  }, [costReadings, filterFrom, filterTo]);

  const chemicalBreakdown = useMemo(() => {
    const map = new Map<string, ChemicalDayBreakdown>();
    if (!hasChemBreakdownTab) return map;

    const prodVolMap = new Map<string, number>();
    overviewChartRows.forEach((r) => {
      if (r.isoDate) {
        const dk = format(new Date(r.isoDate), 'yyyy-MM-dd');
        if (r.production != null && r.production > 0) {
          prodVolMap.set(dk, r.production);
        } else if (r.rawwater != null && r.rawwater > 0) {
          prodVolMap.set(dk, r.rawwater);
        }
      }
    });

    (filteredCostReadings ?? []).forEach((r: any) => {
      const dk = r.cost_date;
      if (!dk) return;
      let entry = map.get(dk);
      if (!entry) {
        const prodVol = prodVolMap.get(dk) ?? null;
        entry = {
          chlorineKg: 0,
          chlorineCost: 0,
          smbsKg: 0,
          smbsCost: 0,
          antiScalantL: 0,
          antiScalantCost: 0,
          sodaAshKg: 0,
          sodaAshCost: 0,
          freeClPcs: 0,
          freeClCost: 0,
          otherCost: 0,
          totalCost: 0,
          prodVol,
          chemCostPerM3: null,
        };
        map.set(dk, entry);
      }
      entry.chlorineKg += +(r.chlorine_kg ?? 0);
      entry.chlorineCost += +(r.chlorine_cost ?? 0);
      entry.smbsKg += +(r.smbs_kg ?? 0);
      entry.smbsCost += +(r.smbs_cost ?? 0);
      entry.antiScalantL += +(r.anti_scalant_l ?? 0);
      entry.antiScalantCost += +(r.anti_scalant_cost ?? 0);
      entry.sodaAshKg += +(r.soda_ash_kg ?? 0);
      entry.sodaAshCost += +(r.soda_ash_cost ?? 0);
      entry.freeClPcs += +(r.free_cl_pcs ?? 0);
      entry.freeClCost += +(r.free_cl_cost ?? 0);
      entry.otherCost += +(r.other_cost ?? 0);
      entry.totalCost += +(r.chem_cost ?? 0);
    });

    map.forEach((entry, dk) => {
      const prodVol = prodVolMap.get(dk) ?? null;
      entry.prodVol = prodVol;
      entry.chemCostPerM3 = (prodVol != null && prodVol > 0 && entry.totalCost > 0)
        ? +(entry.totalCost / prodVol).toFixed(4)
        : null;
    });

    return map;
  }, [hasChemBreakdownTab, filteredCostReadings, overviewChartRows]);

  const activeTab: DSMTab =
    (!hasProdTab && tab === 'production') ||
    (!hasConsTab && tab === 'consumption') ||
    (!hasGridTab && tab === 'grid-by-meter') ||
    (!hasChemBreakdownTab && tab === 'chemical-breakdown')
      ? 'overview' : tab;

  const tabDates = activeTab === 'consumption' ? consDates
    : activeTab === 'production' ? prodDates
    : activeTab === 'grid-by-meter' ? overviewDates
    : activeTab === 'chemical-breakdown' ? overviewDates
    : metric === 'rawwater' ? prodDates
    : overviewDates;

  const summaryStats = useMemo(() => {
    return calculateDataSummaryStats(overviewChartRows, tabDates);
  }, [overviewChartRows, tabDates]);

  return {
    tab, setTab, activeTab,
    filterFrom, filterTo, setFilterFrom, setFilterTo,
    defaultFrom, defaultTo, parsedFrom, parsedTo,
    filteredChartData, filteredLocReadings, filteredProductReadings,
    filteredWellReadings, filteredRoReadings,
    gridMeterMeta, gridBreakdown,
    hasProdTab, hasConsTab, hasGridTab, hasChemBreakdownTab,
    overviewLabel, prodTabLabel,
    roTrainEntities, roTrainRecoveryByDate, roTrainTdsByDate, phHealthByDate,
    prodEntities, prodPivotMap, prodDateKeys, prodDates,
    hasProductMeterData, hasPermeateData,
    consEntities, consPivot, consDateKeys, consDates,
    overviewDates, overviewChartRows, tabDates,
    chemicalBreakdown,
    summaryStats,
  };
}
