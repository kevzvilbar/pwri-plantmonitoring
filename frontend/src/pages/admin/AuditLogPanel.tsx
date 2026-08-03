import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataState } from '@/components/DataState';
import { format } from 'date-fns';

interface AuditEntry {
  id: string;
  kind: 'user' | 'plant';
  entity_id: string;
  entity_label: string | null;
  action: 'soft' | 'hard';
  actor_user_id: string | null;
  actor_label: string | null;
  reason: string | null;
  dependencies: Record<string, unknown> | null;
  created_at: string;
}

type AuditLogResult = {
  entries: AuditEntry[];
};

export function AuditLogPanel() {
  const [kindFilter, setKindFilter] = useState<'all' | 'user' | 'plant'>('all');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-audit-log', kindFilter],
    queryFn: async (): Promise<AuditLogResult> => {
      // Direct read of deletion_audit_log. RLS (`is_manager_or_admin`)
      // already restricts SELECT to admins/managers, so this is safe with
      // the browser's anon key + the signed-in user's JWT — see
      // supabase/migrations/20260424_deletion_audit_log.sql.
      let q = supabase
        .from('deletion_audit_log' as any)
        .select('id, kind, entity_id, entity_label, action, actor_user_id, actor_label, reason, dependencies, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (kindFilter !== 'all') q = q.eq('kind', kindFilter);

      const { data: rows, error: sbError } = await q;
      if (sbError) {
        // Both paths failed — table missing, RLS denied, or a genuine
        // outage. Let this surface as a real error rather than an empty list.
        throw new Error(sbError.message);
      }
      return { entries: (rows ?? []) as unknown as AuditEntry[] };
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(['all', 'user', 'plant'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className={`px-3 py-1 text-xs rounded-md border transition-colors ${
              kindFilter === k
                ? 'bg-accent text-accent-foreground border-accent'
                : 'bg-card hover:bg-muted'
            }`}
            data-testid={`audit-filter-${k}`}
          >
            {k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1) + 's'}
          </button>
        ))}
      </div>

      {(isLoading || (error && !data)) ? (
        <DataState loading={isLoading} error={!data ? error : undefined} onRetry={() => refetch()} />
      ) : (
        <>
          {(data?.entries ?? []).map((e) => (
            <Card key={e.id} className="p-3 space-y-1" data-testid={`audit-entry-${e.id}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="capitalize">{e.kind}</Badge>
                  <Badge
                    variant={e.action === 'hard' ? 'destructive' : 'secondary'}
                    className="capitalize"
                  >
                    {e.action === 'hard' ? 'Hard delete' : 'Soft delete'}
                  </Badge>
                  {e.reason?.startsWith('[FORCE]') && (
                    <Badge className="bg-danger text-danger-foreground">FORCE</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(e.created_at), 'yyyy-MM-dd HH:mm')}
                </span>
              </div>
              <div className="text-sm">
                <strong>{e.entity_label ?? e.entity_id}</strong>
                <span className="text-muted-foreground"> · by {e.actor_label ?? e.actor_user_id ?? '—'}</span>
              </div>
              {e.reason && (
                <div className="text-xs text-muted-foreground italic">"{e.reason}"</div>
              )}
            </Card>
          ))}
          {(data?.entries?.length ?? 0) === 0 && (
            <Card className="p-4 text-center text-xs text-muted-foreground">
              No deletion events recorded yet.
            </Card>
          )}
        </>
      )}
    </div>
  );
}
