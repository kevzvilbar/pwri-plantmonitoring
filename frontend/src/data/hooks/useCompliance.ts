/**
 * data/hooks/useCompliance.ts — React Query wrappers for compliance data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchPlantMetrics,
  fetchChemDaysOfSupply,
  fetchPreviousPeriodMetrics,
  loadThresholds,
  persistThresholds,
  fetchFleetCompliance,
  computeViolations,
  computeComplianceScore,
  type Thresholds,
  type Violation,
  type ChemSupply,
  type PlantComplianceSummary,
  type EvalResult,
  DEFAULT_THRESHOLDS,
} from '@/data/queries/compliance';
import { persistThresholds as mutatePersistThresholds, createComplianceSnapshot } from '@/data/mutations/compliance';

/** Fetch plant metrics for a given period */
export function usePlantMetrics(plantId: string | null, days = 7, from?: string, to?: string) {
  return useQuery({
    queryKey: queryKeys.compliance.metrics(plantId ?? '', days, from, to),
    queryFn: () => fetchPlantMetrics(plantId!, days, from, to),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

/** Fetch chemical days of supply for a plant */
export function useChemDaysOfSupply(plantId: string | null, lookbackDays = 30) {
  return useQuery({
    queryKey: queryKeys.compliance.chemSupply(plantId ?? '', lookbackDays),
    queryFn: () => fetchChemDaysOfSupply(plantId!, lookbackDays),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

/** Fetch previous period metrics for comparison */
export function usePreviousPeriodMetrics(plantId: string | null, days: number) {
  return useQuery({
    queryKey: queryKeys.compliance.previousMetrics(plantId ?? '', days),
    queryFn: () => fetchPreviousPeriodMetrics(plantId!, days),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

/** Load thresholds from database with localStorage fallback */
export function useThresholds(scope: string) {
  return useQuery({
    queryKey: queryKeys.compliance.thresholds(scope),
    queryFn: () => loadThresholds(scope),
    staleTime: 60_000,
  });
}

/** Fetch fleet compliance summary for all plants */
export function useFleetCompliance(plants: Array<{ id: string; name: string }> | undefined, days: number) {
  return useQuery({
    queryKey: queryKeys.compliance.fleet(plants ?? [], days),
    queryFn: () => fetchFleetCompliance(plants ?? [], days),
    staleTime: 60_000,
  });
}

/** Mutations */
export function usePersistThresholds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, thresholds }: { scope: string; thresholds: Thresholds }) => 
      mutatePersistThresholds(scope, thresholds),
    onSuccess: (_data, { scope }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.compliance.thresholds(scope) });
    },
  });
}

export function useCreateComplianceSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      plantId, 
      scope, 
      scopeLabel, 
      violations, 
      thresholds 
    }: { 
      plantId: string;
      scope: string;
      scopeLabel: string;
      violations: Violation[];
      thresholds: Thresholds;
    }) => createComplianceSnapshot(plantId, scope, scopeLabel, violations, thresholds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceSnapshots'] });
    },
  });
}

/** Compute violations (pure function, exposed for convenience) */
export function useComputeViolations() {
  return { computeViolations, computeComplianceScore, DEFAULT_THRESHOLDS };
}

export type { Thresholds, Violation, ChemSupply, PlantComplianceSummary, EvalResult };