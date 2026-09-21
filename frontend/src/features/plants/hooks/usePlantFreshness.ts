import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlantFreshnessMap {
  [plantId: string]: Date | null;
}

export interface UsePlantFreshnessResult {
  /** Map of plantId -> latest Date from ro/well/locator/product readings, or null if none. */
  freshnessByPlant: PlantFreshnessMap;
  /** Latest Date across all requested plants. */
  latestReadingAt: Date | null;
  /** Plant IDs that have no readings or whose latest reading is null. */
  silentPlantIds: string[];
  isLoading: boolean;
  refetch: () => void;
}

/**
 * P4-3 & P4-6: Per-Plant Data Freshness
 *
 * Unifies freshness across all four reading sources:
 *   1. ro_train_readings_latest
 *   2. well_readings_latest
 *   3. locator_readings_latest
 *   4. product_meter_readings_latest
 *
 * Solves:
 *   - P4-6: Plants without RO trains (only wells/locators/product meters) no longer show "no recent readings".
 *   - P4-3: A silent plant can no longer hide behind a single global reading from another plant.
 */
export async function fetchPlantFreshness(plantIds: string[]): Promise<PlantFreshnessMap> {
  const map: PlantFreshnessMap = {};
  if (!plantIds.length) return map;

  plantIds.forEach((id) => {
    map[id] = null;
  });

  const [roRes, wellRes, locRes, prodRes] = await Promise.allSettled([
    (supabase.from('ro_train_readings_latest' as any) as any)
      .select('plant_id, reading_datetime')
      .in('plant_id', plantIds),
    (supabase.from('well_readings_latest' as any) as any)
      .select('plant_id, reading_datetime')
      .in('plant_id', plantIds),
    (supabase.from('locator_readings_latest' as any) as any)
      .select('plant_id, reading_datetime')
      .in('plant_id', plantIds),
    (supabase.from('product_meter_readings_latest' as any) as any)
      .select('plant_id, reading_datetime')
      .in('plant_id', plantIds),
  ]);

  const processRows = (rows: { plant_id: string; reading_datetime?: string | null }[] | null | undefined) => {
    (rows ?? []).forEach((r) => {
      if (!r?.plant_id || !r.reading_datetime) return;
      const d = new Date(r.reading_datetime);
      if (isNaN(d.getTime())) return;
      const current = map[r.plant_id];
      if (!current || d.getTime() > current.getTime()) {
        map[r.plant_id] = d;
      }
    });
  };

  if (roRes.status === 'fulfilled' && roRes.value?.data) processRows(roRes.value.data);
  if (wellRes.status === 'fulfilled' && wellRes.value?.data) processRows(wellRes.value.data);
  if (locRes.status === 'fulfilled' && locRes.value?.data) processRows(locRes.value.data);
  if (prodRes.status === 'fulfilled' && prodRes.value?.data) processRows(prodRes.value.data);

  return map;
}

export function usePlantFreshness(plantIds: string[]): UsePlantFreshnessResult {
  const plantIdsKey = plantIds.slice().sort().join(',');

  const { data, isLoading, refetch } = useQuery<PlantFreshnessMap>({
    queryKey: ['plant-freshness', plantIdsKey],
    queryFn: () => fetchPlantFreshness(plantIds),
    enabled: plantIds.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const freshnessByPlant = useMemo(() => {
    const res: PlantFreshnessMap = {};
    plantIds.forEach((id) => {
      res[id] = data?.[id] ?? null;
    });
    return res;
  }, [plantIds, data]);

  const { latestReadingAt, silentPlantIds } = useMemo(() => {
    let latest: Date | null = null;
    const silent: string[] = [];

    plantIds.forEach((id) => {
      const dt = freshnessByPlant[id];
      if (!dt) {
        silent.push(id);
      } else if (!latest || dt.getTime() > latest.getTime()) {
        latest = dt;
      }
    });

    return { latestReadingAt: latest, silentPlantIds: silent };
  }, [plantIds, freshnessByPlant]);

  return {
    freshnessByPlant,
    latestReadingAt,
    silentPlantIds,
    isLoading,
    refetch,
  };
}
