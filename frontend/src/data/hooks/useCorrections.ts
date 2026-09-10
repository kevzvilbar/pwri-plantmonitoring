/**
 * data/hooks/useCorrections.ts — React Query wrappers for correction data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchPending, 
  fetchPendingCount,
  fetchCorrectionRequestsCount,
  fetchInboxCount,
  fetchCorrectionInbox,
  fetchCorrectionRequests,
  fetchEditHistory,
  fetchOperatorStats,
  fetchReadingChain,
  approveReading,
  retractReading,
  updateReadingValue,
  markMeterReplacement,
  type FlaggedRow,
  type CorrectionRequest,
  type ChainEntry,
  type OperatorStat,
} from '@/data/queries/corrections';
import { 
  createCorrectionRequest, 
  updateCorrectionRequest, 
  approveCorrectionRequest, 
  rejectCorrectionRequest,
  insertReadingNormalization,
  bulkApproveReadings,
  bulkRetractReadings,
  type CorrectionRequestUpdate,
} from '@/data/mutations/corrections';

/** Pending review readings with count */
export function usePending() {
  return useQuery({
    queryKey: queryKeys.corrections.pending(),
    queryFn: () => fetchPending(1000),
    staleTime: 60_000,
  });
}

export function usePendingCount() {
  return useQuery({
    queryKey: queryKeys.corrections.pendingCount(),
    queryFn: fetchPendingCount,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}

/** Correction requests counts */
export function useCorrectionRequestsCount() {
  return useQuery({
    queryKey: queryKeys.corrections.requestsCount(),
    queryFn: fetchCorrectionRequestsCount,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}

export function useInboxCount() {
  return useQuery({
    queryKey: queryKeys.corrections.inboxCount(),
    queryFn: fetchInboxCount,
    staleTime: 60_000,
  });
}

/** Correction inbox */
export function useCorrectionInbox() {
  return useQuery({
    queryKey: queryKeys.corrections.inbox(),
    queryFn: () => fetchCorrectionInbox(),
    staleTime: 60_000,
  });
}

/** Correction requests */
export function useCorrectionRequests(status?: 'pending' | 'approved' | 'rejected') {
  return useQuery({
    queryKey: queryKeys.corrections.requests(status),
    queryFn: () => fetchCorrectionRequests(status),
    staleTime: 60_000,
  });
}

/** Edit history */
export function useEditHistory(limit = 200) {
  return useQuery({
    queryKey: queryKeys.corrections.editHistory(limit),
    queryFn: () => fetchEditHistory(limit),
    staleTime: 60_000,
  });
}

/** Operator stats */
export function useOperatorStats() {
  return useQuery({
    queryKey: queryKeys.corrections.operatorStats(),
    queryFn: fetchOperatorStats,
    staleTime: 60_000,
  });
}

/** Reading chain */
export function useReadingChain(
  table: 'locator_readings' | 'well_readings' | 'product_meter_readings',
  entityId: string,
  limit = 100
) {
  return useQuery({
    queryKey: queryKeys.corrections.chain(table, entityId, limit),
    queryFn: () => fetchReadingChain(table, entityId, limit),
    enabled: !!entityId,
    staleTime: 60_000,
  });
}

/** Mutations */
export function useApproveReading() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      reviewerId, 
      note 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
      id: string;
      reviewerId: string;
      note?: string;
    }) => approveReading(table, id, reviewerId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pending() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pendingCount() });
    },
  });
}

export function useRetractReading() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      reviewerId, 
      note 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
      id: string;
      reviewerId: string;
      note?: string;
    }) => retractReading(table, id, reviewerId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pending() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pendingCount() });
    },
  });
}

export function useUpdateReadingValue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      newValue, 
      editorId, 
      reason 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
      id: string;
      newValue: number;
      editorId: string;
      reason: string;
    }) => updateReadingValue(table, id, newValue, editorId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pending() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.inbox() });
    },
  });
}

export function useMarkMeterReplacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      id, 
      editorId 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
      id: string;
      editorId: string;
    }) => markMeterReplacement(table, id, editorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.inbox() });
    },
  });
}

export function useCreateCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCorrectionRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requests() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requestsCount() });
    },
  });
}

export function useUpdateCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: CorrectionRequestUpdate }) => 
      updateCorrectionRequest(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requests() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requestsCount() });
    },
  });
}

export function useApproveCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reviewerId, note }: { id: string; reviewerId: string; note?: string }) => 
      approveCorrectionRequest(id, reviewerId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requests() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requestsCount() });
    },
  });
}

export function useRejectCorrectionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reviewerId, note }: { id: string; reviewerId: string; note?: string }) => 
      rejectCorrectionRequest(id, reviewerId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requests() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.requestsCount() });
    },
  });
}

export function useInsertReadingNormalization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: insertReadingNormalization,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.editHistory(200) });
    },
  });
}

export function useBulkApproveReadings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      ids, 
      reviewerId, 
      note 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
      ids: string[];
      reviewerId: string;
      note?: string;
    }) => bulkApproveReadings(table, ids, reviewerId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pending() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pendingCount() });
    },
  });
}

export function useBulkRetractReadings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ 
      table, 
      ids, 
      reviewerId, 
      note 
    }: { 
      table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
      ids: string[];
      reviewerId: string;
      note?: string;
    }) => bulkRetractReadings(table, ids, reviewerId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pending() });
      queryClient.invalidateQueries({ queryKey: queryKeys.corrections.pendingCount() });
    },
  });
}

export type { FlaggedRow, CorrectionRequest, ChainEntry, OperatorStat };