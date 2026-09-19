/**
 * data/hooks/useWellReadings.ts — React Query wrappers for well data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching, so UI
 * components never touch supabase directly.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { fetchWellReadings, type WellReadingRow } from '@/data/queries/wells';
import { insertWellReading, type WellReadingInput } from '@/data/mutations/readings';

export function useWellReadings(wellId: string, limit = 50) {
  return useQuery({
    queryKey: ['wellReadings', wellId, { limit }],
    queryFn: () => fetchWellReadings(wellId, limit),
    enabled: !!wellId,
    staleTime: 60_000,
  });
}

/** Mutation + automatic invalidation of the well-reading cache on success. */
export function useInsertWellReading() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: insertWellReading,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wellReadings'] });
    },
  });
}

export type { WellReadingRow, WellReadingInput };