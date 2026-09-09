/**
 * data/hooks/useImports.ts — React Query wrappers for import data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries/mutations with React Query caching.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchEntityNameMap,
  fetchEntityNamesForTemplate,
  getCurrentUserId,
  type ImportTypeConfig,
} from '@/data/queries/imports';
import { 
  batchImportRows,
  type ImportBatchResult,
  type ImportOptions,
  type ParsedRow,
} from '@/data/mutations/imports';

/** Fetch entity name-to-ID mapping for a plant and config */
export function useEntityNameMap(config: ImportTypeConfig | null, plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.imports.entityNameMap(config?.id ?? '', plantId ?? ''),
    queryFn: () => fetchEntityNameMap(config!, plantId!),
    enabled: !!config && !!plantId,
    staleTime: 60_000,
  });
}

/** Fetch entity names for CSV template generation */
export function useEntityNamesForTemplate(config: ImportTypeConfig | null, plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.imports.entityNamesForTemplate(config?.id ?? '', plantId ?? ''),
    queryFn: () => fetchEntityNamesForTemplate(config!, plantId!),
    enabled: !!config && !!plantId,
    staleTime: 60_000,
  });
}

/** Get current user ID */
export function useCurrentUserId() {
  return useQuery({
    queryKey: queryKeys.imports.currentUser(),
    queryFn: getCurrentUserId,
    staleTime: 60_000,
  });
}

/** Batch import mutation */
export function useBatchImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: batchImportRows,
    onSuccess: () => {
      // Invalidate relevant queries after successful import
      queryClient.invalidateQueries({ queryKey: ['reading-history'] });
      queryClient.invalidateQueries({ queryKey: ['kpi'] });
      queryClient.invalidateQueries({ queryKey: ['compliance'] });
    },
  });
}

export type { ImportTypeConfig, ParsedRow, ImportBatchResult, ImportOptions };