/**
 * useMyCorrections: the signed-in user's own correction requests (P5-6).
 *
 * Refetches every minute (while the tab is visible) and on focus, so a
 * supervisor's decision shows up without a reload. The dialog that submits a
 * request invalidates `queryKeys.corrections.myRequestsAll()`.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/data/queryKeys';
import { fetchMyCorrectionRequests } from '@/data/queries/myCorrections';

export function useMyCorrections() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  return useQuery({
    queryKey: queryKeys.corrections.myRequests(userId),
    queryFn: () => fetchMyCorrectionRequests(userId),
    enabled: Boolean(userId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
