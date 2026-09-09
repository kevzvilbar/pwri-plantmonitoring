/**
 * data/hooks/usePlantTopology.ts — React Query wrappers for plant topology data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchTopologyData,
  fetchTopologyLinks,
  fetchWellsForTopology,
  fetchRoTrainsForTopology,
  fetchLocatorsForTopology,
  fetchProductMetersForTopology,
  fetchPowerConfigForTopology,
  fetchMeterConfigForTopology,
  type TopologyData,
  type TopoLink,
  type TopoWell,
  type TopoRoTrain,
  type TopoLocator,
  type TopoProductMeter,
  type TopoPowerConfig,
  type TopoMeterConfig,
} from '@/data/queries/plantTopology';
import { saveTopologyLinks, deleteTopologyLink } from '@/data/mutations/plantTopology';

/** Fetch all topology data for a plant */
export function useTopologyData(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.data(plantId ?? ''),
    queryFn: () => fetchTopologyData(plantId!),
    enabled: !!plantId,
    staleTime: 30_000,
  });
}

/** Fetch topology links */
export function useTopologyLinks(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.links(plantId ?? ''),
    queryFn: () => fetchTopologyLinks(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

/** Individual component queries for fine-grained caching */
export function useWellsForTopology(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.wells(plantId ?? ''),
    queryFn: () => fetchWellsForTopology(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

export function useRoTrainsForTopology(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.roTrains(plantId ?? ''),
    queryFn: () => fetchRoTrainsForTopology(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

export function useLocatorsForTopology(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.locators(plantId ?? ''),
    queryFn: () => fetchLocatorsForTopology(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

export function useProductMetersForTopology(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.productMeters(plantId ?? ''),
    queryFn: () => fetchProductMetersForTopology(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

export function usePowerConfigForTopology(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.powerConfig(plantId ?? ''),
    queryFn: () => fetchPowerConfigForTopology(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

export function useMeterConfigForTopology(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.plantTopology.meterConfig(plantId ?? ''),
    queryFn: () => fetchMeterConfigForTopology(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

/** Mutations */
export function useSaveTopologyLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ plantId, links }: { plantId: string; links: { from_id: string; to_id: string }[] }) => 
      saveTopologyLinks(plantId, links),
    onSuccess: (_data, { plantId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plantTopology.data(plantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.plantTopology.links(plantId) });
    },
  });
}

export function useDeleteTopologyLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ plantId, fromId, toId }: { plantId: string; fromId: string; toId: string }) => 
      deleteTopologyLink(plantId, fromId, toId),
    onSuccess: (_data, { plantId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plantTopology.data(plantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.plantTopology.links(plantId) });
    },
  });
}

export type { TopologyData, TopoLink, TopoWell, TopoRoTrain, TopoLocator, TopoProductMeter, TopoPowerConfig, TopoMeterConfig };