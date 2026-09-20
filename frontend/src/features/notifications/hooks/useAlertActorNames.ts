import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** P3-3: user id → display name for "Acknowledged by X" lines. Single query
 *  over user_profiles; falls back to an empty map when RLS hides the table
 *  (alertStatusLine then shows a short id instead of crashing). */
export function useAlertActorNames(): Map<string, string> {
  const { data } = useQuery({
    queryKey: ['alert-actor-names'],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id,username,first_name,last_name');
      return (data ?? []) as { id: string; username: string | null; first_name: string | null; last_name: string | null }[];
    },
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data ?? []) {
      const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      m.set(p.id, p.username ? `@${p.username}` : full || p.id);
    }
    return m;
  }, [data]);
}
