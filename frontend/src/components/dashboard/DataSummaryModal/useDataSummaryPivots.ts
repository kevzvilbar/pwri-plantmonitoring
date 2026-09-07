import { useMemo } from 'react';
import { format } from 'date-fns';
import { computePivotFromReadingsNoCache, pivotDayTotal } from './pivotUtils';
import { deltaCache, hydrateFromStoredDeltas } from '@/lib/deltaCache';

export type SummaryTab = 'both' | 'production' | 'consumption' | 'current';

export interface DataSummaryPivotsOptions {
  tab: SummaryTab;
  currentSide: 'consumption' | 'production';
  consReadings: any[];
  locators: any[];
  plantCodeById: Map<string, string>;
  fromStr: string;
  toStr: string;
  directLocatorIds: Set<string>;
  productMeters: any[];
  prodReadings: any[];
  productExcludedPlantIds: Set<string>;
  directMeterIds: Set<string>;
  roTrainsMeta: any[];
  roMeterReadings: any[];
  roCurrentReadings: any[] | undefined;
}

export interface DataSummaryPivotsResult {
  consPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  prodPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  roProdPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  combinedProdPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  consCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  prodCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  roCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  combinedProdCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  currentPivotData: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  colTotals: number[];
  rowTotals: number[];
  grandTotal: number;
  prodGrandTotal: number;
  consGrandTotal: number;
  hasRoEntities: boolean;
  hasMeterEntities: boolean;
  dates: string[];
  entities: any[];
  estimatedKeys: Set<string>;
}

export function useDataSummaryPivots({
  tab,
  currentSide,
  consReadings,
  locators,
  plantCodeById,
  fromStr,
  toStr,
  directLocatorIds,
  productMeters,
  prodReadings,
  productExcludedPlantIds,
  directMeterIds,
  roTrainsMeta,
  roMeterReadings,
  roCurrentReadings,
}: DataSummaryPivotsOptions): DataSummaryPivotsResult {
  const consPivot = useMemo(() => {
    const sortedLocs = [...(locators ?? [])].sort((a, b) => {
      const pa = plantCodeById.get(a.plant_id) ?? '';
      const pb = plantCodeById.get(b.plant_id) ?? '';
      return pa.localeCompare(pb) || (a.name ?? '').localeCompare(b.name ?? '');
    });
    const pivot = computePivotFromReadingsNoCache(consReadings ?? [], 'locator_id', 'daily_volume', directLocatorIds);

    const estimatedKeys = new Set<string>();
    (consReadings ?? []).forEach((r: any) => {
      if (r.is_estimated) {
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        estimatedKeys.add(`${dk}__${r.locator_id}`);
      }
    });

    const allDates: string[] = [];
    const cur = new Date(fromStr + 'T00:00:00');
    const end = new Date(toStr   + 'T00:00:00');
    while (cur <= end) {
      allDates.push(format(cur, 'yyyy-MM-dd'));
      cur.setDate(cur.getDate() + 1);
    }
    return { dates: allDates, entities: sortedLocs, pivot, estimatedKeys };
  }, [locators, consReadings, plantCodeById, fromStr, toStr, directLocatorIds]);

  const prodPivot = useMemo(() => {
    const includedMeters = (productMeters ?? []).filter(
      (m: any) => !productExcludedPlantIds.has(m.plant_id),
    );
    const includedMeterIds = new Set(includedMeters.map((m: any) => m.id));
    const sortedMeters = [...includedMeters]
      .map((m: any) => ({ ...m, _source: 'meter' as const }))
      .sort((a, b) => {
        const pa = plantCodeById.get(a.plant_id) ?? '';
        const pb = plantCodeById.get(b.plant_id) ?? '';
        return pa.localeCompare(pb) || (a.name ?? '').localeCompare(b.name ?? '');
      });
    const includedReadings = (prodReadings ?? []).filter((r: any) => includedMeterIds.has(r.meter_id));
    const pivot = computePivotFromReadingsNoCache(includedReadings, 'meter_id', 'daily_volume', directMeterIds);

    const estimatedKeys = new Set<string>();
    includedReadings.forEach((r: any) => {
      if (r.is_estimated) {
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        estimatedKeys.add(`${dk}__${r.meter_id}`);
      }
    });

    const allDates2: string[] = [];
    const cur2 = new Date(fromStr + 'T00:00:00');
    const end2 = new Date(toStr   + 'T00:00:00');
    while (cur2 <= end2) {
      allDates2.push(format(cur2, 'yyyy-MM-dd'));
      cur2.setDate(cur2.getDate() + 1);
    }
    return { dates: allDates2, entities: sortedMeters, pivot, estimatedKeys };
  }, [productMeters, prodReadings, plantCodeById, fromStr, toStr, productExcludedPlantIds, directMeterIds]);

  const roProdPivot = useMemo(() => {
    const sortedTrains = [...(roTrainsMeta ?? [])]
      .map((t: any) => ({ ...t, _source: 'ro' as const }))
      .sort((a, b) => {
        const pa = plantCodeById.get(a.plant_id) ?? '';
        const pb = plantCodeById.get(b.plant_id) ?? '';
        return pa.localeCompare(pb) || (a.train_number ?? 0) - (b.train_number ?? 0);
      });

    const pivot = new Map<string, Map<string, number>>();

    const allDates: string[] = [];
    const cur = new Date(fromStr + 'T00:00:00');
    const end = new Date(toStr   + 'T00:00:00');
    while (cur <= end) {
      const dk = format(cur, 'yyyy-MM-dd');
      allDates.push(dk);
      pivot.set(dk, new Map());
      cur.setDate(cur.getDate() + 1);
    }

    hydrateFromStoredDeltas(
      roMeterReadings ?? [],
      'train_id',
      'permeate_meter_delta',
      'reading_datetime',
    );

    const estimatedKeys = new Set<string>();
    (roMeterReadings ?? []).forEach((r: any) => {
      const dateKey  = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      const trainKey = r.train_id as string;
      if (r.is_estimated) {
        estimatedKeys.add(`${dateKey}__${trainKey}`);
      }
      const cached = deltaCache.get(trainKey, dateKey);
      const delta  = cached !== null ? cached : +(r.permeate_meter_delta ?? 0);
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      pivot.get(dateKey)!.set(trainKey, (pivot.get(dateKey)!.get(trainKey) ?? 0) + delta);
    });

    return { dates: allDates, entities: sortedTrains, pivot, estimatedKeys };
  }, [roTrainsMeta, roMeterReadings, plantCodeById, fromStr, toStr]);

  const combinedProdPivot = useMemo(() => {
    const entities = [...prodPivot.entities, ...roProdPivot.entities];
    const dates = prodPivot.dates;
    const pivot = new Map<string, Map<string, number>>();
    dates.forEach((d) => {
      const merged = new Map<string, number>();
      prodPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      roProdPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      pivot.set(d, merged);
    });
    const mergedEstimated = new Set<string>([...prodPivot.estimatedKeys, ...roProdPivot.estimatedKeys]);
    return { dates, entities, pivot, estimatedKeys: mergedEstimated };
  }, [prodPivot, roProdPivot]);

  const hasRoEntities    = combinedProdPivot.entities.some((e: any) => e._source === 'ro');
  const hasMeterEntities = combinedProdPivot.entities.some((e: any) => e._source === 'meter');

  const consCurrentPivot = useMemo(() => {
    const latestTime = new Map<string, number>();
    const pivot = new Map<string, Map<string, number>>();
    (consReadings ?? []).forEach((r: any) => {
      if (r.current_reading == null) return;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const key     = `${dateKey}__${r.locator_id}`;
      const t       = new Date(r.reading_datetime).getTime();
      if (!latestTime.has(key) || t > latestTime.get(key)!) {
        latestTime.set(key, t);
        if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
        pivot.get(dateKey)!.set(r.locator_id, +r.current_reading);
      }
    });
    return { dates: consPivot.dates, entities: consPivot.entities, pivot };
  }, [consReadings, consPivot.dates, consPivot.entities]);

  const prodCurrentPivot = useMemo(() => {
    const latestTime = new Map<string, number>();
    const pivot = new Map<string, Map<string, number>>();
    (prodReadings ?? []).forEach((r: any) => {
      if (r.current_reading == null) return;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const key     = `${dateKey}__${r.meter_id}`;
      const t       = new Date(r.reading_datetime).getTime();
      if (!latestTime.has(key) || t > latestTime.get(key)!) {
        latestTime.set(key, t);
        if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
        pivot.get(dateKey)!.set(r.meter_id, +r.current_reading);
      }
    });
    return { dates: prodPivot.dates, entities: prodPivot.entities, pivot };
  }, [prodReadings, prodPivot.dates, prodPivot.entities]);

  const roCurrentPivot = useMemo(() => {
    const latestTime = new Map<string, number>();
    const pivot = new Map<string, Map<string, number>>();
    (roCurrentReadings ?? []).forEach((r: any) => {
      if (r.permeate_meter == null) return;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const key     = `${dateKey}__${r.train_id}`;
      const t       = new Date(r.reading_datetime).getTime();
      if (!latestTime.has(key) || t > latestTime.get(key)!) {
        latestTime.set(key, t);
        if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
        pivot.get(dateKey)!.set(r.train_id, +r.permeate_meter);
      }
    });
    return { dates: roProdPivot.dates, entities: roProdPivot.entities, pivot };
  }, [roCurrentReadings, roProdPivot.dates, roProdPivot.entities]);

  const combinedProdCurrentPivot = useMemo(() => {
    const entities = [...prodCurrentPivot.entities, ...roCurrentPivot.entities];
    const dates = prodCurrentPivot.dates;
    const pivot = new Map<string, Map<string, number>>();
    dates.forEach((d) => {
      const merged = new Map<string, number>();
      prodCurrentPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      roCurrentPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      pivot.set(d, merged);
    });
    return { dates, entities, pivot };
  }, [prodCurrentPivot, roCurrentPivot]);

  const currentPivotData = currentSide === 'production'
    ? combinedProdCurrentPivot
    : consCurrentPivot;

  const activePivot = tab === 'consumption' ? consPivot : combinedProdPivot;
  const { dates, entities, pivot, estimatedKeys } = activePivot;

  const colTotals = useMemo(() =>
    entities.map((e) =>
      dates.reduce((s, d) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
    ),
  [entities, dates, pivot]);

  const rowTotals = useMemo(() =>
    dates.map((d) =>
      entities.reduce((s, e) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
    ),
  [entities, dates, pivot]);

  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  const prodGrandTotal = useMemo(() => {
    return combinedProdPivot.entities.reduce(
      (s: number, e: any) =>
        s + combinedProdPivot.dates.reduce((ds: number, d: string) => ds + (combinedProdPivot.pivot.get(d)?.get(e.id) ?? 0), 0),
      0,
    );
  }, [combinedProdPivot]);

  const consGrandTotal = useMemo(
    () =>
      consPivot.entities.reduce(
        (s: number, e: any) =>
          s + consPivot.dates.reduce((ds: number, d: string) => ds + (consPivot.pivot.get(d)?.get(e.id) ?? 0), 0),
        0,
      ),
    [consPivot],
  );

  return {
    consPivot, prodPivot, roProdPivot, combinedProdPivot,
    consCurrentPivot, prodCurrentPivot, roCurrentPivot, combinedProdCurrentPivot, currentPivotData,
    colTotals, rowTotals, grandTotal, prodGrandTotal, consGrandTotal,
    hasRoEntities, hasMeterEntities,
    dates, entities, estimatedKeys,
  };
}
