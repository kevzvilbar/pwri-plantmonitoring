import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useROTrains } from '@/hooks/useROTrains';

export interface UseTrendEntityMetaOptions {
  plantIds: string[];
  needsWellReadings: boolean;
  needsLocReadings: boolean;
  needsProductMeterReadings: boolean;
  needsPowerReadings: boolean;
  needsPermeateProduction: boolean;
  needsRoReadings: boolean;
}

export function useTrendEntityMeta({
  plantIds,
  needsWellReadings,
  needsLocReadings,
  needsProductMeterReadings,
  needsPowerReadings,
  needsPermeateProduction,
  needsRoReadings,
}: UseTrendEntityMetaOptions) {
  // ── Entity name & multiplier lookups — fetched once per plant selection ────
  const { data: wellMeta } = useQuery({
    queryKey: ['entity-names-wells', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name, meter_multiplier, multiplier_enabled').in('plant_id', plantIds);
      const nameMap: Record<string, string> = {};
      const multMap: Record<string, number> = {};
      (data ?? []).forEach((w: { id: string; name: string; meter_multiplier?: number | null; multiplier_enabled?: boolean | null }) => {
        nameMap[w.id] = w.name;
        if (w.multiplier_enabled && w.meter_multiplier) multMap[w.id] = Number(w.meter_multiplier);
      });
      return { nameMap, multMap };
    },
    enabled: plantIds.length > 0 && needsWellReadings,
    staleTime: 10 * 60_000,
  });
  const wellNames = useMemo(() => {
    const raw = wellMeta?.nameMap;
    if (!raw) return new Map<string, string>();
    if (raw instanceof Map) return raw;
    const m = new Map<string, string>();
    if (typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => m.set(k, String(v)));
    return m;
  }, [wellMeta]);
  const wellMultipliers = useMemo(() => {
    const raw = wellMeta?.multMap;
    if (!raw) return new Map<string, number>();
    if (raw instanceof Map) return raw;
    const m = new Map<string, number>();
    if (typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => m.set(k, Number(v)));
    return m;
  }, [wellMeta]);

  const { data: locatorsMeta } = useQuery({
    queryKey: ['entity-names-locators', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name, meter_multiplier, multiplier_enabled').in('plant_id', plantIds);
      const nameMap: Record<string, string> = {};
      const multMap: Record<string, number> = {};
      (data ?? []).forEach((l: { id: string; name: string; meter_multiplier?: number | null; multiplier_enabled?: boolean | null }) => {
        nameMap[l.id] = l.name;
        if (l.multiplier_enabled && l.meter_multiplier) multMap[l.id] = Number(l.meter_multiplier);
      });
      return { nameMap, multMap };
    },
    enabled: plantIds.length > 0 && needsLocReadings,
    staleTime: 10 * 60_000,
  });
  const locatorNames = useMemo(() => {
    const raw = locatorsMeta?.nameMap;
    if (!raw) return new Map<string, string>();
    if (raw instanceof Map) return raw;
    const m = new Map<string, string>();
    if (typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => m.set(k, String(v)));
    return m;
  }, [locatorsMeta]);
  const locatorMultipliers = useMemo(() => {
    const raw = locatorsMeta?.multMap;
    if (!raw) return new Map<string, number>();
    if (raw instanceof Map) return raw;
    const m = new Map<string, number>();
    if (typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => m.set(k, Number(v)));
    return m;
  }, [locatorsMeta]);

  const { data: productMetersMeta } = useQuery({
    queryKey: ['entity-names-product-meters', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('product_meters')
        .select('id, name, meter_multiplier, multiplier_enabled').in('plant_id', plantIds);
      const nameMap: Record<string, string> = {};
      const multMap: Record<string, number> = {};
      (data ?? []).forEach((m: { id: string; name: string; meter_multiplier?: number | null; multiplier_enabled?: boolean | null }) => {
        nameMap[m.id] = m.name;
        if (m.multiplier_enabled && m.meter_multiplier) multMap[m.id] = Number(m.meter_multiplier);
      });
      return { nameMap, multMap };
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
    staleTime: 10 * 60_000,
  });
  const productMeterNames = useMemo(() => {
    const raw = productMetersMeta?.nameMap;
    if (!raw) return new Map<string, string>();
    if (raw instanceof Map) return raw;
    const m = new Map<string, string>();
    if (typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => m.set(k, String(v)));
    return m;
  }, [productMetersMeta]);
  const productMeterMultipliers = useMemo(() => {
    const raw = productMetersMeta?.multMap;
    if (!raw) return new Map<string, number>();
    if (raw instanceof Map) return raw;
    const m = new Map<string, number>();
    if (typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => m.set(k, Number(v)));
    return m;
  }, [productMetersMeta]);

  const { data: _rawDirectProductMeterIds } = useQuery<string[]>({
    queryKey: ['trend-meter-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('product_meters')
        .select('id,is_derived')
        .in('plant_id', plantIds);
      return (data ?? [])
        .filter((m) => m.is_derived === true)
        .map((m) => m.id);
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
    staleTime: 10 * 60_000,
  });
  const _directProductMeterIds = useMemo(() => {
    if (!_rawDirectProductMeterIds) return new Set<string>();
    if (_rawDirectProductMeterIds instanceof Set) return _rawDirectProductMeterIds;
    if (Array.isArray(_rawDirectProductMeterIds)) return new Set(_rawDirectProductMeterIds);
    if (typeof _rawDirectProductMeterIds === 'object') return new Set(Object.keys(_rawDirectProductMeterIds));
    return new Set<string>();
  }, [_rawDirectProductMeterIds]);

  const { data: rawPlantNames } = useQuery<Record<string, string>>({
    queryKey: ['entity-names-plants', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').in('id', plantIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => { map[p.id] = p.name; });
      return map;
    },
    enabled: plantIds.length > 0 && (needsPowerReadings || needsPermeateProduction),
    staleTime: 10 * 60_000,
  });
  const plantNames = useMemo(() => {
    if (!rawPlantNames) return new Map<string, string>();
    if (rawPlantNames instanceof Map) return rawPlantNames;
    const m = new Map<string, string>();
    if (typeof rawPlantNames === 'object') Object.entries(rawPlantNames).forEach(([k, v]) => m.set(k, String(v)));
    return m;
  }, [rawPlantNames]);

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
    staleTime: 10 * 60_000,
  });

  const { data: _rawDirectLocatorIds } = useQuery<string[]>({
    queryKey: ['trend-loc-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase
        .from('locators').select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      return (data ?? [])
        .filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true)
        .map((l: any) => l.id as string);
    },
    enabled: plantIds.length > 0 && needsLocReadings,
    staleTime: 10 * 60_000,
  });
  const _directLocatorIds = useMemo(() => {
    if (!_rawDirectLocatorIds) return new Set<string>();
    if (_rawDirectLocatorIds instanceof Set) return _rawDirectLocatorIds;
    if (Array.isArray(_rawDirectLocatorIds)) return new Set(_rawDirectLocatorIds);
    if (typeof _rawDirectLocatorIds === 'object') return new Set(Object.keys(_rawDirectLocatorIds));
    return new Set<string>();
  }, [_rawDirectLocatorIds]);

  const { data: _roTrainRows } = useROTrains(plantIds);
  const _roTrainMeta = useMemo(() => {
    const trainPlantMap = new Map<string, string>();
    const trainUnitTypeMap = new Map<string, string>();
    (_roTrainRows ?? []).forEach((t) => {
      trainPlantMap.set(t.id, t.plant_id);
      trainUnitTypeMap.set(t.id, t.unit_type ?? 'primary');
    });
    return { ids: (_roTrainRows ?? []).map((t) => t.id), trainPlantMap, trainUnitTypeMap };
  }, [_roTrainRows]);
  const _roTrainIdsForReadings = _roTrainMeta?.ids;
  const _trainPlantMap = _roTrainMeta?.trainPlantMap ?? new Map<string, string>();
  const _trainUnitTypeMap = _roTrainMeta?.trainUnitTypeMap ?? new Map<string, string>();

  const { data: rawRoTrainNames } = useQuery<Record<string, string>>({
    queryKey: ['entity-names-ro-trains', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('ro_trains')
        .select('id, name')
        .in('plant_id', plantIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach((t) => { map[t.id] = t.name ?? `Train ${String(t.id).slice(-4)}`; });
      return map;
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction),
    staleTime: 10 * 60_000,
  });
  const roTrainNames = useMemo(() => {
    if (!rawRoTrainNames) return new Map<string, string>();
    if (rawRoTrainNames instanceof Map) return rawRoTrainNames;
    const m = new Map<string, string>();
    if (typeof rawRoTrainNames === 'object') Object.entries(rawRoTrainNames).forEach(([k, v]) => m.set(k, String(v)));
    return m;
  }, [rawRoTrainNames]);

  const { data: permeateConfigData } = useQuery({
    queryKey: ['plant-meter-config-permeate', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('plant_meter_config')
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      const permeateCounts: string[] = [];
      const productExcluded: string[] = [];
      (data ?? []).forEach((row) => {
        const cfg = row.config as Record<string, unknown> | null;
        const permeateOn = row.permeate_is_production === true || cfg?.permeate_is_production === true;
        if (permeateOn) permeateCounts.push(row.plant_id);
        if (cfg?.ro_production_source === 'permeate' && permeateOn) productExcluded.push(row.plant_id);
      });
      return { permeateCounts, productExcluded };
    },
    enabled: plantIds.length > 0 && needsPermeateProduction,
    staleTime: 10 * 60_000,
  });
  const permeateIsProductionPlants = useMemo(() => {
    const raw = permeateConfigData?.permeateCounts;
    if (!raw) return new Set<string>();
    if (raw instanceof Set) return raw;
    if (Array.isArray(raw)) return new Set(raw);
    if (typeof raw === 'object') return new Set(Object.keys(raw));
    return new Set<string>();
  }, [permeateConfigData]);
  const productExcludedPlants = useMemo(() => {
    const raw = permeateConfigData?.productExcluded;
    if (!raw) return new Set<string>();
    if (raw instanceof Set) return raw;
    if (Array.isArray(raw)) return new Set(raw);
    if (typeof raw === 'object') return new Set(Object.keys(raw));
    return new Set<string>();
  }, [permeateConfigData]);

  return {
    wellNames, wellMultipliers,
    locatorNames, locatorMultipliers, _locatorIdsForReadings, _directLocatorIds,
    productMeterNames, productMeterMultipliers, _directProductMeterIds,
    plantNames,
    _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap, roTrainNames,
    permeateConfigData, permeateIsProductionPlants, productExcludedPlants,
  };
}
