/**
 * useWaterBalanceReconciliation.ts
 *
 * React Query hook for plant water balance conservation and permeate reconciliation.
 * Aggregates real telemetry from Supabase across:
 *   - Wells (`well_readings`)
 *   - RO Trains (`ro_train_readings`)
 *   - Product Meters (`product_meter_readings`)
 *   - Locators (`locator_readings`)
 *   - Blending Events (`blending_events`)
 *   - Meter Configuration (`plant_meter_config`)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { computeEntityDeltas } from '@/lib/entityDeltas';
import { resolveDateWindow } from '@/components/dashboard/WaterBalanceBridgeCard';
import type { RangeKey } from '@/components/dashboard/types';
import {
  computePlantWaterBalanceSummary,
  type PlantWaterBalanceSummary,
  type TrainPermeateDetail,
  type ProductMeterDetail,
} from '@/lib/waterBalanceReconciliation';

export interface UseWaterBalanceReconciliationOptions {
  plantId: string | null;
  rangeKey?: RangeKey;
  customFrom?: string;
  customTo?: string;
}

export function useWaterBalanceReconciliation({
  plantId,
  rangeKey = '7D',
  customFrom = '',
  customTo = '',
}: UseWaterBalanceReconciliationOptions) {
  const enabled = !!plantId;

  const { startISO, endISO, startKey, endKey } = useMemo(
    () => resolveDateWindow(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo]
  );

  // 1. Plant Meter Config
  const { data: meterConfig } = useQuery({
    queryKey: ['wbr-meter-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('permeate_is_production, config')
        .eq('plant_id', plantId)
        .maybeSingle();
      const permeateOn = data?.permeate_is_production === true || data?.config?.permeate_is_production === true;
      return { permeateIsProduction: permeateOn };
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  // 2. Wells metadata
  const { data: wells } = useQuery({
    queryKey: ['wbr-wells', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase.from('wells').select('id, name').eq('plant_id', plantId);
      return data ?? [];
    },
    enabled,
    staleTime: 10 * 60_000,
  });

  // 3. RO Trains metadata
  const { data: roTrains } = useQuery({
    queryKey: ['wbr-ro-trains', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase
        .from('ro_trains')
        .select('id, train_number, name, unit_type')
        .eq('plant_id', plantId)
        .order('train_number');
      return data ?? [];
    },
    enabled,
    staleTime: 10 * 60_000,
  });

  // 4. Product Meters metadata
  const { data: productMeters } = useQuery({
    queryKey: ['wbr-product-meters', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase
        .from('product_meters')
        .select('id, name, is_derived')
        .eq('plant_id', plantId)
        .order('name');
      return data ?? [];
    },
    enabled,
    staleTime: 10 * 60_000,
  });

  // 5. Locators metadata
  const { data: locators } = useQuery({
    queryKey: ['wbr-locators', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase
        .from('locators')
        .select('id, name, default_input_mode, is_derived')
        .eq('plant_id', plantId)
        .eq('status', 'Active')
        .order('name');
      return data ?? [];
    },
    enabled,
    staleTime: 10 * 60_000,
  });

  const wellIds = useMemo(() => (wells ?? []).map((w) => w.id), [wells]);
  const trainIds = useMemo(() => (roTrains ?? []).map((t) => t.id), [roTrains]);
  const productMeterIds = useMemo(() => (productMeters ?? []).map((m) => m.id), [productMeters]);
  const locatorIds = useMemo(() => (locators ?? []).map((l) => l.id), [locators]);

  // 6. Well Readings
  const { data: wellReadings, isLoading: loadingWells } = useQuery({
    queryKey: ['wbr-well-readings', plantId, startKey, endKey],
    queryFn: async () => {
      if (!wellIds.length) return [];
      const { data, error } = await supabase
        .from('well_readings')
        .select('well_id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement')
        .in('well_id', wellIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && wellIds.length > 0,
    staleTime: 3 * 60_000,
  });

  // 7. RO Train Readings
  const { data: roReadings, isLoading: loadingRo } = useQuery({
    queryKey: ['wbr-ro-readings', plantId, startKey, endKey],
    queryFn: async () => {
      if (!trainIds.length) return [];
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('train_id, permeate_meter, permeate_meter_prev, permeate_meter_delta, reading_datetime, is_meter_replacement')
        .in('train_id', trainIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && trainIds.length > 0,
    staleTime: 3 * 60_000,
  });

  // 8. Product Meter Readings
  const { data: productReadings, isLoading: loadingProduct } = useQuery({
    queryKey: ['wbr-product-readings', plantId, startKey, endKey],
    queryFn: async () => {
      if (!productMeterIds.length) return [];
      const { data, error } = await supabase
        .from('product_meter_readings')
        .select('meter_id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement')
        .in('meter_id', productMeterIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && productMeterIds.length > 0,
    staleTime: 3 * 60_000,
  });

  // 9. Locator Readings
  const { data: locatorReadings, isLoading: loadingLocators } = useQuery({
    queryKey: ['wbr-locator-readings', plantId, startKey, endKey],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && locatorIds.length > 0,
    staleTime: 3 * 60_000,
  });

  // 10. Blending Events
  const { data: blendRows, isLoading: loadingBlend } = useQuery({
    queryKey: ['wbr-blending', plantId, startKey, endKey],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('volume_m3')
        .eq('plant_id', plantId)
        .gte('event_date', startKey)
        .lte('event_date', endKey);
      if (error) throw error;
      return data ?? [];
    },
    enabled,
    staleTime: 3 * 60_000,
  });

  const isLoading =
    enabled &&
    (loadingWells || loadingRo || loadingProduct || loadingLocators || loadingBlend);

  const summary = useMemo<PlantWaterBalanceSummary | null>(() => {
    if (!plantId || isLoading) return null;

    // A. Well volume per well
    const wellDeltas = computeEntityDeltas(wellReadings ?? [], 'well_id', null);
    const wellVolumeMap = new Map<string, number>();
    wellDeltas.forEach(({ r, delta }) => {
      if (r?.well_id) {
        wellVolumeMap.set(r.well_id, (wellVolumeMap.get(r.well_id) || 0) + delta);
      }
    });
    const wellVolumes = (wells ?? []).map((w) => ({
      wellId: w.id,
      volume: wellVolumeMap.get(w.id) ?? 0,
    }));

    // B. Train Permeate per train
    const trainPermeateMap = new Map<string, number>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r?.train_id || r.is_meter_replacement) return;
      const delta =
        r.permeate_meter_delta != null
          ? Math.max(0, +r.permeate_meter_delta)
          : r.permeate_meter != null && r.permeate_meter_prev != null
          ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
          : 0;
      trainPermeateMap.set(r.train_id, (trainPermeateMap.get(r.train_id) || 0) + delta);
    });
    const trainPermeateDetails: TrainPermeateDetail[] = (roTrains ?? []).map((t) => ({
      trainId: t.id,
      trainNumber: t.train_number,
      name: t.name,
      volume: trainPermeateMap.get(t.id) ?? 0,
    }));

    // C. Product Meter volume per meter
    const directProductMeterIds = new Set(
      (productMeters ?? []).filter((m) => m.is_derived).map((m) => m.id)
    );
    const prodDeltas = computeEntityDeltas(
      productReadings ?? [],
      'meter_id',
      'daily_volume',
      { directModeIds: directProductMeterIds }
    );
    const prodVolumeMap = new Map<string, number>();
    prodDeltas.forEach(({ r, delta }) => {
      if (r?.meter_id) {
        prodVolumeMap.set(r.meter_id, (prodVolumeMap.get(r.meter_id) || 0) + delta);
      }
    });
    const productMeterDetails: ProductMeterDetail[] = (productMeters ?? []).map((m) => ({
      meterId: m.id,
      name: m.name,
      volume: prodVolumeMap.get(m.id) ?? 0,
    }));

    // D. Locator consumption
    const directLocatorIds = new Set(
      (locators ?? []).filter((l) => l.default_input_mode === 'direct' || l.is_derived).map((l) => l.id)
    );
    const locDeltas = computeEntityDeltas(
      locatorReadings ?? [],
      'locator_id',
      'daily_volume',
      { directModeIds: directLocatorIds }
    );
    const locVolumeMap = new Map<string, number>();
    locDeltas.forEach(({ r, delta }) => {
      if (r?.locator_id) {
        locVolumeMap.set(r.locator_id, (locVolumeMap.get(r.locator_id) || 0) + delta);
      }
    });
    const locatorVolumes = (locators ?? []).map((l) => ({
      locatorId: l.id,
      volume: locVolumeMap.get(l.id) ?? 0,
    }));

    // E. Blending Volume
    const blendingVolume = (blendRows ?? []).reduce((sum: number, b: any) => sum + (+b.volume_m3 || 0), 0);

    return computePlantWaterBalanceSummary({
      wellVolumes,
      trainPermeateDetails,
      productMeterDetails,
      locatorVolumes,
      blendingVolume,
      permeateIsProduction: meterConfig?.permeateIsProduction ?? false,
    });
  }, [
    plantId,
    isLoading,
    wellReadings,
    roReadings,
    productReadings,
    locatorReadings,
    blendRows,
    wells,
    roTrains,
    productMeters,
    locators,
    meterConfig,
  ]);

  return {
    summary,
    isLoading,
    window: { startKey, endKey, startISO, endISO },
  };
}
