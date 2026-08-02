import { useQuery } from '@tanstack/react-query';

const BASE = (import.meta.env.VITE_BACKEND_URL as string) || '';

/**
 * Is the FastAPI backend reachable at all? Distinct from the AI-specific
 * health check (`/api/ai/health`), which also verifies EMERGENT_LLM_KEY —
 * this just answers "is there a server here." Use it to gate admin tools
 * that need service-role Supabase access (migrations, privileged hard
 * deletes) that can never run client-side, regardless of the AI key.
 *
 * One shared hook so every admin panel checks this the same way, instead
 * of each one growing its own slightly-different reachability probe.
 */
export function useBackendReachable() {
  const { isError, isLoading, refetch } = useQuery({
    queryKey: ['backend-reachable'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
  });
  return { reachable: !isLoading && !isError, checking: isLoading, recheck: refetch };
}
