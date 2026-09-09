/**
 * data/hooks/useReadingHistory.ts — React Query wrappers for reading history data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchReadingHistory,
  resyncLocatorChain,
  type ReadingHistoryOptions,
} from '@/data/queries/readingHistory';
import { 
  insertReadingNormalization,
  updateReadingEntry,
  deleteReadingEntry,
  toggleMeterReplacement,
  cascadeReadingEdit,
  bulkDeleteReadings,
  type ReadingNormalizationInsert,
} from '@/data/mutations/readingHistory';

/** Fetch reading history for a module */
export function useReadingHistory(options: ReadingHistoryOptions) {
  return useQuery({
    queryKey: queryKeys.readingHistory.list(options),
    queryFn: () => fetchReadingHistory(options),
    staleTime: 0, // Always fresh for history dialog
  });
}

/** Resync locator chain */
export function useResyncLocatorChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resyncLocatorChain,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

/** Mutations */
export function useInsertReadingNormalization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: insertReadingNormalization,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

export function useUpdateReadingEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      updates, 
      editorId, 
      reason 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events';
      id: string;
      updates: Record<string, any>;
      editorId: string;
      reason: string;
    }) => updateReadingEntry(table, id, updates, editorId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

export function useDeleteReadingEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ table, id }: { table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events'; id: string }) => 
      deleteReadingEntry(table, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

export function useToggleMeterReplacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      value 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events';
      id: string;
      value: boolean;
    }) => toggleMeterReplacement(table, id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

export function useCascadeReadingEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      newValue, 
      editorId, 
      reason 
    }: { 
      table: 'locator_readings' | 'well_readings';
      id: string;
      newValue: number;
      editorId: string;
      reason: string;
    }) => cascadeReadingEdit(table, id, newValue, editorId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

export function useBulkDeleteReadings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      ids 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events';
      ids: string[];
    }) => bulkDeleteReadings(table, ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
    },
  });
}

export type { ReadingHistoryOptions, ReadingNormalizationInsert };