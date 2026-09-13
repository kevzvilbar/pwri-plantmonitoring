/**
 * useReconciliationHealthTotals.ts
 *
 * Dashboard-level fan-out of the same permeate-vs-product-meter reconciliation
 * math already used on the Plant Topology page (see
 * `frontend/src/lib/waterBalanceReconciliation.ts` and
 * `frontend/src/data/hooks/useWaterBalanceReconciliation.ts`), but computed
 * PER PLANT across a list of plants instead of for one plant in depth.
 *
 * A plant is only included in the result if it has BOTH RO train permeate
 * readings AND separate product/bulk meter readings in the window — i.e.
 * plants where `ro_production_source` is 'product' or 'both' and there's
 * something to actually compare. Permeate-only plants (no dedicated product
 * meter) have nothing to reconcile against and are silently excluded.
 *
 * Deliberately lighter than useWaterBalanceReconciliation: no wells,
 * locators, or blending events, since this card only needs the two meter
 * streams, not the full NRW mass balance. Follows the same global date
 * range as every other Dashboard card (appStore.chartRange/From/To), unlike
 * the Topology page's local 7D/30D/Monthly toggle.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { computeEntityDeltas } from '@/lib/entityDeltas';
import { useAppStore } from '@/store/appStore';
import { resolveDateWindow } from '../WaterBalanceBridgeCard';
import {
  computePermeateReconciliation,
  type TrainPermeateDetail,
  type ProductMeterDetail,
  type PermeateReconciliationResult,
} from '@/lib/waterBalanceReconciliation';

export interface PlantReconciliationRow {
  plantId: string;
  plantName: string;
  result: PermeateReconciliationResult;
}

export function useReconciliationHealthTotals(plantIds: string[]) {
  const hasPlants = plantIds.length > 0;
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);

  const { startISO, endISO, startKey, endKey } = useMemo(
    () => resolveDateWindow(chartRange, chartFrom, chartTo),
    [chartRange, chartFrom, chartTo],
  );

  const { data: plants, isFetching: fPlants } = useQuery({
    queryKey: ['rhc-plants', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('plants').select('id,name').in('id', plantIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  const { data: roTrains, isFetching: fTrains } = useQuery({
    queryKey: ['rhc-ro-trains', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_trains')
        .select('id, plant_id, train_number, name, unit_type')
        .in('plant_id', plantIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  const { data: productMeters, isFetching: fMeters } = useQuery({
    queryKey: ['rhc-product-meters', plantIds],
    queryFn: async () => {
      const { data, error } = await (supabase.from('product_meters' as never) as any)
        .select('id, plant_id, name, is_derived')
        .in('plant_id', plantIds);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  const trainIds = useMemo(() => (roTrains ?? []).map((t) => t.id), [roTrains]);
  const productMeterIds = useMemo(() => (productMeters ?? []).map((m: any) => m.id as string), [productMeters]);

  const { data: roReadings, isFetching: fRo } = useQuery({
    queryKey: ['rhc-ro-readings', trainIds, startKey, endKey],
    queryFn: async () => {
      if (!trainIds.length) return [];
      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select('train_id, permeate_meter, permeate_meter_prev, permeate_meter_delta, reading_datetime, is_meter_replacement')
        .in('train_id', trainIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: hasPlants && trainIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const { data: productReadings, isFetching: fProduct } = useQuery({
    queryKey: ['rhc-product-readings', productMeterIds, startKey, endKey],
    queryFn: async () => {
      if (!productMeterIds.length) return [];
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        .select('meter_id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement')
        .in('meter_id', productMeterIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: hasPlants && productMeterIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const metaLoaded = plants !== undefined && roTrains !== undefined && productMeters !== undefined;
  const isLoading = hasPlants && (!metaLoaded || fPlants || fTrains || fMeters || fRo || fProduct);

  const rows = useMemo<PlantReconciliationRow[]>(() => {
    if (!hasPlants || isLoading) return [];

    // Per-train permeate delta (mirrors useWaterBalanceReconciliation.ts)
    const trainVolumeMap = new Map<string, number>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r?.train_id || r.is_meter_replacement) return;
      const delta =
        r.permeate_meter_delta != null
          ? Math.max(0, +r.permeate_meter_delta)
          : r.permeate_meter != null && r.permeate_meter_prev != null
          ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
          : 0;
      trainVolumeMap.set(r.train_id, (trainVolumeMap.get(r.train_id) || 0) + delta);
    });

    // Per-meter product delta
    const directProductMeterIds = new Set(
      (productMeters ?? []).filter((m: any) => m.is_derived).map((m: any) => m.id as string),
    );
    const prodDeltas = computeEntityDeltas(
      productReadings ?? [],
      'meter_id',
      'daily_volume',
      { directModeIds: directProductMeterIds },
    );
    const meterVolumeMap = new Map<string, number>();
    prodDeltas.forEach(({ r, delta }) => {
      if (r?.meter_id) meterVolumeMap.set(r.meter_id, (meterVolumeMap.get(r.meter_id) || 0) + delta);
    });

    // Group trains + meters by plant
    const byPlant = new Map<string, { trains: TrainPermeateDetail[]; meters: ProductMeterDetail[] }>();
    (roTrains ?? []).forEach((t) => {
      const entry = byPlant.get(t.plant_id) ?? { trains: [], meters: [] };
      entry.trains.push({
        trainId: t.id,
        trainNumber: t.train_number,
        name: t.name,
        volume: trainVolumeMap.get(t.id) ?? 0,
      });
      byPlant.set(t.plant_id, entry);
    });
    (productMeters ?? []).forEach((m: any) => {
      const entry = byPlant.get(m.plant_id) ?? { trains: [], meters: [] };
      entry.meters.push({ meterId: m.id, name: m.name, volume: meterVolumeMap.get(m.id) ?? 0 });
      byPlant.set(m.plant_id, entry);
    });

    const plantNameMap = new Map<string, string>();
    (plants ?? []).forEach((p: any) => plantNameMap.set(p.id, p.name));

    const out: PlantReconciliationRow[] = [];
    byPlant.forEach((entry, plantId) => {
      const result = computePermeateReconciliation(entry.trains, entry.meters);
      // Only plants with genuinely separate permeate + product meter data are
      // comparable — a permeate-only plant has nothing to reconcile against.
      if (!result.hasTrainData || !result.hasProductData) return;
      out.push({ plantId, plantName: plantNameMap.get(plantId) ?? 'Unknown plant', result });
    });

    // Worst variance first so the plants most likely to need attention surface at the top.
    out.sort((a, b) => (b.result.variancePct ?? 0) - (a.result.variancePct ?? 0));
    return out;
  }, [hasPlants, isLoading, roTrains, productMeters, roReadings, productReadings, plants]);

  return { rows, isLoading, chartRange, chartFrom, chartTo, startKey, endKey };
}
