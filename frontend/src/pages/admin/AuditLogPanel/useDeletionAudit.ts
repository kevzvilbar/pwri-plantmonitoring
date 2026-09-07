import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, isToday, isYesterday } from 'date-fns';
import type { AuditEntry } from './types';

interface GroupedDeletion {
  dateKey: string;
  label: string;
  items: AuditEntry[];
}

export function useDeletionAudit(kindFilter: string, auditMode: string) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-audit-log', kindFilter],
    enabled: auditMode === 'deletions',
    queryFn: async (): Promise<{ entries: AuditEntry[] }> => {
      let q = supabase
        .from('deletion_audit_log' as any)
        .select('id, kind, entity_id, entity_label, action, actor_user_id, actor_label, reason, dependencies, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (kindFilter !== 'all') q = q.eq('kind', kindFilter);

      const { data: rows, error: sbError } = await q;
      if (sbError) {
        throw new Error(sbError.message);
      }
      return { entries: (rows ?? []) as unknown as AuditEntry[] };
    },
  });

  const entries = data?.entries ?? [];

  const groupedDeletionsByDay = useMemo(() => {
    const groups: GroupedDeletion[] = [];
    const map = new Map<string, AuditEntry[]>();

    for (const item of entries) {
      const d = new Date(item.created_at);
      const dateKey = format(d, 'yyyy-MM-dd');
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(item);
    }

    for (const [dateKey, items] of map.entries()) {
      const sampleDate = new Date(items[0].created_at);
      let label = format(sampleDate, 'MMMM d, yyyy');
      if (isToday(sampleDate)) label = `Today — ${label}`;
      else if (isYesterday(sampleDate)) label = `Yesterday — ${label}`;
      groups.push({ dateKey, label, items });
    }

    return groups;
  }, [entries]);

  return { entries, groupedDeletionsByDay, isLoading, isFetching, error, refetch, data };
}
