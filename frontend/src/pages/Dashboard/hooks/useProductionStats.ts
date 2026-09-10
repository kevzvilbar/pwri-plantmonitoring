import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { computePivotFromReadingsNoCache, pivotDayTotal } from '@/components/dashboard/DataSummaryModal';
import { pctDelta } from '@/components/dashboard/types';
import { calc } from '@/lib/calculations';

export interface UseProductionStatsParams {
  plantIds: string[];
  today: string;
  yesterday: string;
  _localDateStr: string;
  _yesterdayKey: string;
  qualityTrainMeta?: Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>;
  qualityTrainIds?: string[];
}

export function useProductionStats({
  plantIds,
  today,
  yesterday,
  _localDateStr,
  _yesterdayKey,
  qualityTrainMeta,
  qualityTrainIds = [],
}: UseProductionStatsParams) {
  const { data: locatorIds = [] } = useQuery({
    queryKey: ['dash-locator-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data, error } = await supabase
        .from('locators')
        .select('id')
        .in('plant_id', plantIds)
        .eq('status', 'Active');
      if (error) throw error;
      return (data ?? []).map((l) => l.id);
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const { data: directLocatorIds = new Set<string>() } = useQuery({
    queryKey: ['dash-locator-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data, error } = await supabase
        .from('locators')
        .select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds)
        .eq('status', 'Active');
      if (error) throw error;
      return new Set(
        (data ?? [])
          .filter((l) => l.default_input_mode === 'direct' || l.is_derived === true)
          .map((l) => l.id),
      );
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const { data: directProductMeterIds = new Set<string>() } = useQuery({
    queryKey: ['dash-meter-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data, error } = await supabase
        .from('product_meters')
        .select('id,is_derived')
        .in('plant_id', plantIds);
      if (error) throw error;
      return new Set<string>(
        (data ?? []).filter((m) => m.is_derived === true).map((m) => m.id),
      );
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const { data: wellIds = [] } = useQuery({
    queryKey: ['dash-well-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data, error } = await supabase.from('wells').select('id').in('plant_id', plantIds);
      if (error) throw error;
      return (data ?? []).map((w) => w.id);
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const { data: todayLocators = [] } = useQuery({
    queryKey: ['dash-loc-today', locatorIds, today],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('locator_readings_clean')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: locatorIds.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: todayWells = [] } = useQuery({
    queryKey: ['dash-wells-today', wellIds, today],
    queryFn: async () => {
      if (!wellIds.length) return [];
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('well_readings_clean')
        .select('well_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,tds_ppm,turbidity_ntu')
        .in('well_id', wellIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (!error) return data ?? [];

      const { data: fallback, error: fallbackErr } = await supabase
        .from('well_readings_clean')
        .select('well_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', wellIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (fallbackErr) throw fallbackErr;
      return fallback ?? [];
    },
    enabled: wellIds.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: todayProductMeters = [] } = useQuery({
    queryKey: ['dash-product-meters-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters, error: metersErr } = await supabase
        .from('product_meters')
        .select('id')
        .in('plant_id', plantIds);
      if (metersErr) throw metersErr;
      const meterIds = (meters ?? []).map((m) => m.id);
      if (!meterIds.length) return [];
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('product_meter_readings')
        .select('meter_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: plantMeterConfigs = [] } = useQuery({
    queryKey: ['dash-plant-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data, error } = await supabase
        .from('plant_meter_config')
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const permeateProductionPlantIds = useMemo(() => {
    return (plantMeterConfigs ?? [])
      .filter((row: any) => row.permeate_is_production === true || row.config?.permeate_is_production === true)
      .map((row) => row.plant_id);
  }, [plantMeterConfigs]);

  const productExcludedPlantIds = useMemo(() => new Set<string>(
    (plantMeterConfigs ?? [])
      .filter((row: any) =>
        row.config?.ro_production_source === 'permeate' &&
        (row.permeate_is_production === true || row.config?.permeate_is_production === true))
      .map((row) => row.plant_id),
  ), [plantMeterConfigs]);

  const { data: _permeateTrainMeta } = useQuery({
    queryKey: ['dash-permeate-train-ids', permeateProductionPlantIds],
    queryFn: async () => {
      if (!permeateProductionPlantIds.length) return { ids: [] as string[], trainPlantMap: new Map<string, string>() };
      const { data, error } = await supabase
        .from('ro_trains')
        .select('id, plant_id, unit_type')
        .in('plant_id', permeateProductionPlantIds);
      if (error) throw error;
      const rows = (data ?? []).filter((t) => t.unit_type !== 'secondary');
      const trainPlantMap = new Map<string, string>();
      rows.forEach((t) => trainPlantMap.set(t.id, t.plant_id));
      return { ids: rows.map((t) => t.id), trainPlantMap };
    },
    enabled: permeateProductionPlantIds.length > 0,
    staleTime: 10 * 60_000,
  });
  const permeateTrainIds = _permeateTrainMeta?.ids ?? [];
  const permeateTrainPlantMap = _permeateTrainMeta?.trainPlantMap ?? new Map<string, string>();

  const { data: todayRoPermeate = [] } = useQuery({
    queryKey: ['dash-ro-permeate-today', permeateTrainIds, _localDateStr],
    queryFn: async () => {
      if (!permeateTrainIds.length) return [];
      const windowStart = new Date(_localDateStr + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', permeateTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        plant_id: permeateTrainPlantMap.get(r.train_id) ?? null,
      }));
    },
    enabled: permeateTrainIds.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: yRoPermeate = [] } = useQuery({
    queryKey: ['dash-ro-permeate-yest', permeateTrainIds, _yesterdayKey],
    queryFn: async () => {
      if (!permeateTrainIds.length) return [];
      const windowStart = new Date(_yesterdayKey + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_yesterdayKey + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', permeateTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        plant_id: permeateTrainPlantMap.get(r.train_id) ?? null,
      }));
    },
    enabled: permeateTrainIds.length > 0,
    staleTime: 12 * 60 * 60_000,
    refetchInterval: false,
  });

  const { data: yLocators = [] } = useQuery({
    queryKey: ['dash-loc-yest', locatorIds, yesterday, today],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings_clean')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: locatorIds.length > 0,
    staleTime: 12 * 60 * 60_000,
    refetchInterval: false,
  });

  const { data: yWells = [] } = useQuery({
    queryKey: ['dash-wells-yest', wellIds, yesterday, today],
    queryFn: async () => {
      if (!wellIds.length) return [];
      const { data, error } = await supabase
        .from('well_readings_clean')
        .select('well_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', wellIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: wellIds.length > 0,
    staleTime: 12 * 60 * 60_000,
    refetchInterval: false,
  });

  const { data: yProductMeters = [] } = useQuery({
    queryKey: ['dash-product-meters-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data, error } = await supabase
        .from('product_meters')
        .select('id')
        .in('plant_id', plantIds);
      if (error) throw error;
      const meterIds = (data ?? []).map((m) => m.id);
      if (!meterIds.length) return [];
      const { data: pData, error: pErr } = await supabase
        .from('product_meter_readings')
        .select('meter_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      if (pErr) throw pErr;
      return pData ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 12 * 60 * 60_000,
    refetchInterval: false,
  });

  const productMetersHaveData = (todayProductMeters?.length ?? 0) > 0;
  const { data: todayAllPermeate = [] } = useQuery({
    queryKey: ['dash-all-permeate-today', qualityTrainIds, _localDateStr],
    queryFn: async () => {
      if (!qualityTrainIds.length) return [];
      const windowStart = new Date(_localDateStr + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', qualityTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !productMetersHaveData && qualityTrainIds.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: blendingTodayRows = [] } = useQuery({
    queryKey: ['dash-blending-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const todayIso = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('blending_events')
        .select('volume_m3, plant_id')
        .in('plant_id', plantIds)
        .eq('event_date', todayIso);
      if (error) throw error;
      return data ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // ── Aggregations ──────────────────────────────────────────────────────────
  const _todayKey = format(new Date(), 'yyyy-MM-dd');

  const rawWaterVol = useMemo((): number => pivotDayTotal(
    computePivotFromReadingsNoCache(todayWells, 'well_id', 'daily_volume'), _todayKey,
  ), [todayWells, _todayKey]);

  const roPermeateProduction = useMemo((): number =>
    todayRoPermeate.reduce((s: number, r: any) => {
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (dateKey !== _localDateStr) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0),
  [todayRoPermeate, _localDateStr]);

  const yRoPermeateProduction = useMemo((): number =>
    yRoPermeate.reduce((s: number, r: any) => {
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (dateKey !== _yesterdayKey) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0),
  [yRoPermeate, _yesterdayKey]);

  const production = useMemo((): number => {
    const meterReadingsForProduction = todayProductMeters.filter(
      (r) => !productExcludedPlantIds.has(r.plant_id),
    );
    const meterTotal = pivotDayTotal(
      computePivotFromReadingsNoCache(meterReadingsForProduction, 'meter_id', 'daily_volume', directProductMeterIds), _todayKey,
    );
    const combined = meterTotal + roPermeateProduction;
    if (combined > 0) return combined;

    const fallbackTotal = todayAllPermeate.reduce((s: number, r: any) => {
      const trainMeta = qualityTrainMeta?.get(r.train_id);
      if (trainMeta?.unit_type === 'secondary') return s;
      if (trainMeta?.plant_id && permeateProductionPlantIds.includes(trainMeta.plant_id)) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0);
    return fallbackTotal;
  }, [todayProductMeters, _todayKey, roPermeateProduction, todayAllPermeate, qualityTrainMeta, permeateProductionPlantIds, productExcludedPlantIds, directProductMeterIds]);

  const consumption = useMemo((): number => pivotDayTotal(
    computePivotFromReadingsNoCache(todayLocators, 'locator_id', 'daily_volume', directLocatorIds), _todayKey,
  ), [todayLocators, _todayKey, directLocatorIds]);

  const yRawWaterVol = useMemo((): number => pivotDayTotal(
    computePivotFromReadingsNoCache(yWells, 'well_id', 'daily_volume'), _yesterdayKey,
  ), [yWells, _yesterdayKey]);

  const yProduction = useMemo((): number =>
    pivotDayTotal(
      computePivotFromReadingsNoCache(
        yProductMeters.filter((r) => !productExcludedPlantIds.has(r.plant_id)),
        'meter_id', 'daily_volume', directProductMeterIds,
      ), _yesterdayKey,
    ) + yRoPermeateProduction,
  [yProductMeters, _yesterdayKey, yRoPermeateProduction, productExcludedPlantIds, directProductMeterIds]);

  const yConsumption = useMemo((): number => pivotDayTotal(
    computePivotFromReadingsNoCache(yLocators, 'locator_id', 'daily_volume', directLocatorIds), _yesterdayKey,
  ), [yLocators, _yesterdayKey, directLocatorIds]);

  const dProduction = pctDelta(production, yProduction);
  const dConsumption = pctDelta(consumption, yConsumption);
  const dRawWater = pctDelta(rawWaterVol, yRawWaterVol);

  const nrw = calc.nrw(production, consumption);
  const yNrw = calc.nrw(yProduction, yConsumption);
  const nrwBreached = nrw != null && nrw > 10;

  const blending = blendingTodayRows.reduce((s: number, r) => s + (+r.volume_m3 || 0), 0);

  return {
    locatorIds,
    directLocatorIds,
    directProductMeterIds,
    wellIds,
    todayLocators,
    todayWells,
    todayProductMeters,
    plantMeterConfigs,
    permeateProductionPlantIds,
    productExcludedPlantIds,
    permeateTrainIds,
    permeateTrainPlantMap,
    todayRoPermeate,
    yRoPermeate,
    yLocators,
    yWells,
    yProductMeters,
    todayAllPermeate,
    blendingTodayRows,
    // Aggregates
    _todayKey,
    rawWaterVol,
    roPermeateProduction,
    yRoPermeateProduction,
    production,
    consumption,
    yRawWaterVol,
    yProduction,
    yConsumption,
    dProduction,
    dConsumption,
    dRawWater,
    nrw,
    yNrw,
    nrwBreached,
    blending,
  };
}
