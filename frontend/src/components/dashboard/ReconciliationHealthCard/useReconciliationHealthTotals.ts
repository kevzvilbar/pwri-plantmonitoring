/**
 * useReconciliationHealthTotals.ts
 *
 * Dashboard-level fan-out of the same permeate-vs-product-meter reconciliation
 * math already used on the Plant Topology page (see
 * `frontend/src/lib/waterBalanceReconciliation.ts` and
 * `frontend/src/data/hooks/useWaterBalanceReconciliation.ts`), but computed
 * PER PLANT across a list of plants instead of for one plant in depth.
 *
 * A plant is only included in the result if it runs a DEDICATED product
 * meter (`plant_meter_config.config.ro_production_source === 'product'`;
 * plants without a saved config fall back to the DEFAULT_METER_CONFIG
 * default of 'product') AND it has RO train permeate readings and product
 * meter readings in the window — i.e. genuinely separate metering to
 * compare. 'permeate' plants (permeate IS production; any product meter
 * just re-reads the same flow) and 'both' plants (permeate and product are
 * independent sources whose totals are ADDED, so a gap is expected, not a
 * fault) are excluded — neither has a meaningful reconciliation delta.
 *
 * Lighter than useWaterBalanceReconciliation on purpose: no wells, locators,
 * or blending events, since this card only needs the two meter streams, not
 * the full NRW mass balance. Follows the same global date range as every
 * other Dashboard card (appStore.chartRange/From/To), unlike the Topology
 * page's local 7D/30D/Monthly toggle.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { resolveDateWindow } from '../WaterBalanceBridgeCard';
import {
  resolveReconcilablePlantIds,
  buildPlantReconciliationRows,
  type PlantReconciliationRow,
} from './plantReconciliation';

export type { PlantReconciliationRow } from './plantReconciliation';

export function useReconciliationHealthTotals(plantIds: string[]) {
  const hasPlants = plantIds.length > 0;
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);

  const { startISO, endISO, startKey, endKey } = useMemo(
    () => resolveDateWindow(chartRange, chartFrom, chartTo),
    [chartRange, chartFrom, chartTo],
  );

  const { data: plants, isFetching: fPlants, error: ePlants } = useQuery({
    queryKey: ['rhc-plants', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('plants').select('id,name').in('id', plantIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  // Plant meter config — which plants run a dedicated product meter whose
  // readings SHOULD agree with their RO permeate meters. Mirrors the config
  // split the WaterBalanceBridgeCard / TrendChart already apply for
  // production billing: 'product' → dedicated meter → reconcile; 'permeate'
  // → permeate IS production → not comparable; 'both' → independent sources
  // that get ADDED → a gap is expected, not a fault. Missing config rows fall
  // back to the DEFAULT_METER_CONFIG default ('product').
  const { data: meterConfigs, isFetching: fConfig, error: eConfig } = useQuery({
    queryKey: ['rhc-meter-config', plantIds],
    queryFn: async () => {
      const { data, error } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, config')
        .in('plant_id', plantIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  const { data: roTrains, isFetching: fTrains, error: eTrains } = useQuery({
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

  const { data: productMeters, isFetching: fMeters, error: eMeters } = useQuery({
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

  // ro_trains fetch `unit_type` but only PRIMARY units produce the permeate
  // a bulk product meter can be reconciled against — a secondary (2nd-pass)
  // unit's permeate is already downstream of the primary loop, so counting it
  // would double-count production against the same product meter. Matches the
  // WaterBalanceBridgeCard's production split.
  const secondaryTrainIds = useMemo(
    () => new Set((roTrains ?? []).filter((t: any) => t.unit_type === 'secondary').map((t: any) => t.id as string)),
    [roTrains],
  );

  // Plants with a genuinely separate product meter (dedicated 'product'
  // source). Plants absent from plant_meter_config fall back to the
  // DEFAULT_METER_CONFIG default ('product') — see resolveReconcilablePlantIds.
  const reconcilablePlantIds = useMemo(
    () => resolveReconcilablePlantIds(plants ?? [], meterConfigs ?? []),
    [plants, meterConfigs],
  );

  const { data: roReadings, isFetching: fRo, error: eRo } = useQuery({
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

  const { data: productReadings, isFetching: fProduct, error: eProduct } = useQuery({
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

  const metaLoaded = plants !== undefined && meterConfigs !== undefined
    && roTrains !== undefined && productMeters !== undefined;
  const isLoading = hasPlants && (!metaLoaded || fPlants || fConfig || fTrains || fMeters || fRo || fProduct);
  const error = ePlants || eConfig || eTrains || eMeters || eRo || eProduct;

  const rows = useMemo<PlantReconciliationRow[]>(() => {
    if (!hasPlants || isLoading) return [];
    return buildPlantReconciliationRows({
      roReadings: roReadings ?? [],
      productReadings: productReadings ?? [],
      roTrains: roTrains ?? [],
      productMeters: productMeters ?? [],
      plants: plants ?? [],
      reconcilablePlantIds,
      secondaryTrainIds,
    });
  }, [
    hasPlants, isLoading, roReadings, productReadings, roTrains, productMeters, plants,
    reconcilablePlantIds, secondaryTrainIds,
  ]);

  return { rows, isLoading, error, chartRange, chartFrom, chartTo, startKey, endKey };
}
