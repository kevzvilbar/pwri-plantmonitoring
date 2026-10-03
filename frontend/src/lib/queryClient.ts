import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import { friendlyError } from "@/lib/supabaseErrors";
import { reportError } from "@/lib/monitoring";
import { globalStampActivity } from "@/hooks/usePresence";
import { registerOfflineMutationDefaults } from "@/lib/offlineMutations";
import { isTransientBackendError, queryRetry, queryRetryDelay } from "@/lib/apiHealth";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Outage-aware (lib/apiHealth.ts): no retries for wrong queries (400/42703…),
      // max 2 backed-off retries for 5xx/network failures, none while the breaker is open.
      retry: queryRetry,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,   // handled by useBackgroundSync visibilitychange listener
      refetchOnReconnect: true,      // re-sync immediately when network comes back
      // 300 s (5 min) staleTime: data is considered fresh for 5 min, ensuring
      // background sync only refetches queries that are genuinely stale.
      staleTime: 300_000,
      // gcTime: keep evicted queries in memory for 15 min so navigating back
      // shows cached data instantly while re-fetching.
      gcTime: 15 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const msg = friendlyError(error) || (error instanceof Error ? error.message : (error as any)?.message) || 'Query failed';
      if (!msg || /abort/i.test(msg)) return;
      // Queries with meta.silent = true silently fail (backend unavailable in static deploy)
      if (query.meta?.silent) return;
      const key = Array.isArray(query.queryKey) ? String(query.queryKey[0]) : 'query';
      if (isTransientBackendError(error)) {
        // One shared toast for the whole outage instead of one per failing query.
        toast.error('Server temporarily unavailable — retrying automatically.', { id: 'backend-degraded' });
        return;
      }
      toast.error(`Load failed (${key}): ${msg}`);
      reportError(error, { where: 'react-query', kind: 'query', key });
    },
  }),
  mutationCache: new MutationCache({
    onSuccess: () => {
      // Every successful data-entry mutation stamps the operator as "active"
      // so the admin's People & Staff page reflects them online instantly.
      globalStampActivity();
    },
    onError: (error) => {
      const msg = friendlyError(error);
      if (msg) toast.error(msg);
      reportError(error, { where: 'react-query', kind: 'mutation' });
    },
  }),
});

registerOfflineMutationDefaults(queryClient);

