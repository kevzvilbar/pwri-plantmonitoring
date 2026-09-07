import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, startOfDay, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { computeEntityDeltas } from '@/lib/entityDeltas';
import { useAppStore } from '@/store/appStore';
import { RANGE_DAYS, rangeKeyToDays, type RangeKey } from '../types';
import type { WaterBalanceTotals } from './types';

export function resolveDateWindow(range: RangeKey, from: string, to: string) {
  if (range === 'CUSTOM' || range === 'MONTHLY') {
    const s = new Date(`${from}T00:00:00`);
    const e = new Date(`${to}T23:59:59`);
    return { startISO: s.toISOString(), endISO: e.toISOString(), startKey: from, endKey: to };
  }
  const days = RANGE_DAYS[range];
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const start = startOfDay(subDays(today, days));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startKey: format(start, 'yyyy-MM-dd'),
    endKey: format(today, 'yyyy-MM-dd'),
  };
}

function useWaterBalancePeriodTotals(plantIds: string[]) {
  const hasPlants = plantIds.length > 0;
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);

  const { startISO, endISO, startKey, endKey } = useMemo(
    () => resolveDateWindow(chartRange, chartFrom, chartTo),
    [chartRange, chartFrom, chartTo],
  );

  const { data: permeateConfig } = useQuery({
    queryKey: ['wb-plant-meter-config', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      const permeateCounts = new Set<string>();
      const productExcluded = new Set<string>();
      (data ?? []).forEach((row: any) => {
        const permeateOn = row.permeate_is_production === true || row.config?.permeate_is_production === true;
        if (permeateOn) permeateCounts.add(row.plant_id);
        if (row.config?.ro_production_source === 'permeate' && permeateOn) productExcluded.add(row.plant_id);
      });
      return { permeateCounts, productExcluded };
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  const permeateIsProductionPlants = useMemo(
    () => permeateConfig?.permeateCounts ?? new Set<string>(),
    [permeateConfig],
  );
  const productExcludedPlants = useMemo(
    () => permeateConfig?.productExcluded ?? new Set<string>(),
    [permeateConfig],
  );

  const { data: roTrainMeta } = useQuery({
    queryKey: ['wb-ro-train-ids', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, plant_id, unit_type')
        .in('plant_id', plantIds);
      const rows = data ?? [];
      const trainPlantMap = new Map<string, string>();
      const trainUnitTypeMap = new Map<string, string>();
      rows.forEach((t: any) => {
        trainPlantMap.set(t.id, t.plant_id);
        trainUnitTypeMap.set(t.id, t.unit_type ?? 'primary');
      });
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap, trainUnitTypeMap };
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });
  const trainIds = roTrainMeta?.ids ?? [];
  const trainPlantMap = useMemo(
    () => roTrainMeta?.trainPlantMap ?? new Map<string, string>(),
    [roTrainMeta],
  );
  const trainUnitTypeMap = useMemo(
    () => roTrainMeta?.trainUnitTypeMap ?? new Map<string, string>(),
    [roTrainMeta],
  );

  const { data: directProductMeterIds } = useQuery({
    queryKey: ['wb-product-meter-direct-ids', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id,is_derived')
        .in('plant_id', plantIds);
      return new Set<string>((data ?? []).filter((m: any) => m.is_derived === true).map((m: any) => m.id as string));
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  const { data: locatorMeta } = useQuery({
    queryKey: ['wb-locator-meta', plantIds],
    queryFn: async () => {
      const { data } = await supabase
        .from('locators').select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      const rows = data ?? [];
      return {
        ids: rows.map((l) => l.id as string),
        directIds: new Set<string>(
          rows.filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true).map((l) => l.id as string),
        ),
      };
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });
  const locatorIds = locatorMeta?.ids ?? [];
  const directLocatorIds = useMemo(
    () => locatorMeta?.directIds ?? new Set<string>(),
    [locatorMeta],
  );

  const { data: wellReadings, isFetching: fWell, error: eWell } = useQuery({
    queryKey: ['wb-well-readings', plantIds, startKey, endKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('well_readings')
        .select('well_id,current_reading,previous_reading,daily_volume,reading_datetime,is_meter_replacement,plant_id,norm_status')
        .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 5 * 60_000,
  });

  const { data: productReadings, isFetching: fProduct, error: eProduct } = useQuery({
    queryKey: ['wb-product-readings', plantIds, startKey, endKey],
    queryFn: async () => {
      const FULL = 'meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id,norm_status';
      const LEGACY = 'meter_id,daily_volume,current_reading,previous_reading,reading_datetime,plant_id,norm_status';
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        .select(FULL).in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement')) {
          const { data: d2, error: e2 } = await (supabase.from('product_meter_readings' as never) as any)
            .select(LEGACY).in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
          if (e2) throw e2;
          return d2 ?? [];
        }
        throw error;
      }
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 5 * 60_000,
  });

  const { data: roReadings, isFetching: fRo, error: eRo } = useQuery({
    queryKey: ['wb-ro-readings', plantIds, startKey, endKey, trainIds],
    queryFn: async () => {
      if (!trainIds.length) return [];
      const FULL = 'train_id,permeate_meter,permeate_meter_prev,permeate_meter_delta,reading_datetime,is_meter_replacement,norm_status';
      const LEGACY = 'train_id,permeate_meter,reading_datetime,is_meter_replacement,norm_status';
      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select(FULL).in('train_id', trainIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) {
        const { data: d2, error: e2 } = await (supabase.from('ro_train_readings' as never) as any)
          .select(LEGACY).in('train_id', trainIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
        if (e2) throw e2;
        return d2 ?? [];
      }
      return data ?? [];
    },
    enabled: hasPlants && roTrainMeta !== undefined,
    staleTime: 5 * 60_000,
  });

  const { data: locReadings, isFetching: fLoc, error: eLoc } = useQuery({
    queryKey: ['wb-loc-readings', plantIds, startKey, endKey, locatorIds],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,norm_status')
        .in('locator_id', locatorIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants && locatorMeta !== undefined,
    staleTime: 5 * 60_000,
  });

  const { data: blendRows, isFetching: fBlend, error: eBlend } = useQuery({
    queryKey: ['wb-blending-events', plantIds, startKey, endKey],
    queryFn: async () => {
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('volume_m3')
        .in('plant_id', plantIds).gte('event_date', startKey).lte('event_date', endKey);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 5 * 60_000,
  });

  const metaLoaded = permeateConfig !== undefined && roTrainMeta !== undefined
    && directProductMeterIds !== undefined && locatorMeta !== undefined;
  const isLoading = hasPlants && (!metaLoaded || fWell || fProduct || fRo || fLoc || fBlend);
  const error = eWell || eProduct || eRo || eLoc || eBlend;

  const totals = useMemo<WaterBalanceTotals | null>(() => {
    if (!hasPlants || isLoading || error) return null;

    const rawWater = computeEntityDeltas(wellReadings ?? [], 'well_id', null)
      .reduce((s, { delta }) => s + delta, 0);

    let production = computeEntityDeltas(
      (productReadings ?? []).filter((r: any) => !productExcludedPlants.has(r.plant_id)),
      'meter_id', 'daily_volume', { directModeIds: directProductMeterIds ?? new Set() },
    ).reduce((s, { delta }) => s + delta, 0);

    if (permeateIsProductionPlants.size > 0) {
      const hasSavedDelta = (roReadings ?? []).some(
        (r: any) => r.permeate_meter_delta != null && +r.permeate_meter_delta > 0,
      );
      if (hasSavedDelta) {
        (roReadings ?? []).forEach((r: any) => {
          const plantId = trainPlantMap.get(r.train_id);
          if (!plantId || !permeateIsProductionPlants.has(plantId)) return;
          if (trainUnitTypeMap.get(r.train_id) === 'secondary') return;
          if (r.is_meter_replacement) return;
          const delta = r.permeate_meter_delta != null ? Math.max(0, +r.permeate_meter_delta)
            : r.permeate_meter != null && r.permeate_meter_prev != null
              ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
              : null;
          if (delta === null) return;
          production += delta;
        });
      } else {
        const permeateRoReadings = (roReadings ?? [])
          .filter((r: any) => {
            const plantId = trainPlantMap.get(r.train_id);
            return plantId && permeateIsProductionPlants.has(plantId)
              && trainUnitTypeMap.get(r.train_id) !== 'secondary'
              && r.permeate_meter != null;
          })
          .map((r: any) => ({ ...r, current_reading: +r.permeate_meter }));
        computeEntityDeltas(permeateRoReadings, 'train_id', null, { skipAfterRepl: true })
          .forEach(({ delta, isMeterReplacement }) => {
            if (delta === 0 || isMeterReplacement) return;
            production += delta;
          });
      }
    }

    const locatorConsumption = computeEntityDeltas(
      locReadings ?? [], 'locator_id', 'daily_volume', { directModeIds: directLocatorIds },
    ).reduce((s, { delta }) => s + delta, 0);

    const blending = (blendRows ?? []).reduce((s: number, r: any) => s + (Number(r.volume_m3) || 0), 0);

    const hasAnyData = (wellReadings?.length ?? 0) > 0 || (productReadings?.length ?? 0) > 0
      || (locReadings?.length ?? 0) > 0 || (roReadings?.length ?? 0) > 0 || (blendRows?.length ?? 0) > 0;

    return { hasAnyData, rawWater, production, locatorConsumption, blending };
  }, [
    hasPlants, isLoading, error, wellReadings, productReadings, roReadings, locReadings, blendRows,
    productExcludedPlants, directProductMeterIds, permeateIsProductionPlants, trainPlantMap,
    trainUnitTypeMap, directLocatorIds,
  ]);

  return {
    totals, isLoading, error, chartRange, chartFrom, chartTo, startKey, endKey,
  };
}

export { useWaterBalancePeriodTotals };
