import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Invalidate this after approving an account so the nav badge drops at once. */
export const PENDING_APPROVALS_COUNT_KEY = ['pending-approvals-count'] as const;

/**
 * Accounts waiting for an Admin to approve them. Uses the same test as the
 * Admin → Users "Pending" filter, so the badge and the list always agree.
 * A head-only count: no rows are fetched.
 *
 * Pass `enabled = false` for users who cannot approve, to skip the query.
 */
export function usePendingApprovalsCount(enabled = true): number {
  const { data } = useQuery({
    queryKey: PENDING_APPROVALS_COUNT_KEY,
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .or('confirmed.eq.false,status.eq.Pending');
      if (error) throw error;
      return count ?? 0;
    },
  });
  return data ?? 0;
}
