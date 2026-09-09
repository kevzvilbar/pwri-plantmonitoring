/**
 * data/hooks/useKpi.ts — React Query wrappers for KPI data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchPlantFlags,
  fetchEntityCountsPerPlant,
  fetchKpiReadings,
  fetchWellsConfig,
  fetchLocatorsConfig,
  fetchTrainsConfig,
  fetchMetersConfig,
  fetchWellReadings,
  fetchLocatorReadings,
  fetchRoTrainReadings,
  fetchProductMeterReadings,
  fetchPowerReadings,
  fetchChemReadings,
  fetchBlendingReadings,
  type PlantFlags,
  type EntityCountsPerPlant,
  type KpiReadings,
} from '@/data/queries/kpi';

/** Plant flags for KPI calculations */
export function usePlantFlags() {
  return useQuery({
    queryKey: queryKeys.kpi.plantFlags(),
    queryFn: fetchPlantFlags,
    staleTime: 60_000,
  });
}

/** Entity counts per plant for KPI denominators */
export function useEntityCountsPerPlant() {
  return useQuery({
    queryKey: queryKeys.kpi.entityCounts(),
    queryFn: fetchEntityCountsPerPlant,
    staleTime: 60_000,
  });
}

/** All KPI readings for a given since date */
export function useKpiReadings(since: string) {
  return useQuery({
    queryKey: queryKeys.kpi.readings(since),
    queryFn: () => fetchKpiReadings(since),
    staleTime: 3 * 60_000,
  });
}

/** Individual config queries for fine-grained caching */
export function useWellsConfig() {
  return useQuery({
    queryKey: queryKeys.kpi.wellsConfig(),
    queryFn: fetchWellsConfig,
    staleTime: 10 * 60_000,
  });
}

export function useLocatorsConfig() {
  return useQuery({
    queryKey: queryKeys.kpi.locatorsConfig(),
    queryFn: fetchLocatorsConfig,
    staleTime: 10 * 60_000,
  });
}

export function useTrainsConfig() {
  return useQuery({
    queryKey: queryKeys.kpi.trainsConfig(),
    queryFn: fetchTrainsConfig,
    staleTime: 10 * 60_000,
  });
}

export function useMetersConfig() {
  return useQuery({
    queryKey: queryKeys.kpi.metersConfig(),
    queryFn: fetchMetersConfig,
    staleTime: 10 * 60_000,
  });
}

/** Individual reading queries for fine-grained caching */
export function useWellReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.wellReadings(since, refreshKey),
    queryFn: () => fetchWellReadings(since),
    staleTime: 3 * 60_000,
  });
}

export function useLocatorReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.locatorReadings(since, refreshKey),
    queryFn: () => fetchLocatorReadings(since),
    staleTime: 3 * 60_000,
  });
}

export function useRoTrainReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.roTrainReadings(since, refreshKey),
    queryFn: () => fetchRoTrainReadings(since),
    staleTime: 3 * 60_000,
  });
}

export function useProductMeterReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.productMeterReadings(since, refreshKey),
    queryFn: () => fetchProductMeterReadings(since),
    staleTime: 3 * 60_000,
  });
}

export function usePowerReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.powerReadings(since, refreshKey),
    queryFn: () => fetchPowerReadings(since),
    staleTime: 3 * 60_000,
  });
}

export function useChemReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.chemReadings(since, refreshKey),
    queryFn: () => fetchChemReadings(since),
    staleTime: 3 * 60_000,
  });
}

export function useBlendingReadings(since: string, refreshKey: number) {
  return useQuery({
    queryKey: queryKeys.kpi.blendingReadings(since, refreshKey),
    queryFn: () => fetchBlendingReadings(since),
    staleTime: 3 * 60_000,
  });
}

export type { PlantFlags, EntityCountsPerPlant, KpiReadings };