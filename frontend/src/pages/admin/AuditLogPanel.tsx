import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import { format, isToday, isYesterday } from 'date-fns';
import { User, Building2, Trash2, AlertOctagon, RefreshCw, Clock, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

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

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-audit-log', kindFilter],
    queryFn: async (): Promise<AuditLogResult> => {
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

  // Group entries by formatted date
  const groupedByDay = useMemo(() => {
    const groups: { dateKey: string; label: string; items: AuditEntry[] }[] = [];
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

  return (
    <div className="space-y-4 font-sans" data-testid="audit-log-panel">
      {/* Top filter ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
            {(['all', 'user', 'plant'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-all',
                  kindFilter === k
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                data-testid={`audit-filter-${k}`}
              >
                {k === 'all' ? 'All Events' : k === 'user' ? 'Users Only' : 'Plants Only'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono-num font-medium">
            Showing <strong>{entries.length}</strong> events (capped at 200)
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 hover:bg-muted"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {(isLoading || (error && !data)) ? (
        <DataState loading={isLoading} error={!data ? error : undefined} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          {groupedByDay.map(({ dateKey, label, items }) => (
            <div key={dateKey} className="space-y-2.5">
              {/* Sticky day header */}
              <div className="flex items-center gap-2 sticky top-0 z-10 py-1 bg-background/90 backdrop-blur-xs">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</h4>
                <div className="flex-1 h-px bg-border/60" />
                <span className="text-2xs font-mono-num font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                  {items.length} event{items.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Event cards */}
              <div className="space-y-2">
                {items.map((e) => {
                  const isHard = e.action === 'hard';
                  const isPlant = e.kind === 'plant';

                  return (
                    <Card
                      key={e.id}
                      className={cn(
                        'p-3.5 transition-colors border shadow-2xs',
                        isHard ? 'border-danger/30 hover:border-danger/50' : 'border-border/70 hover:border-border',
                      )}
                      data-testid={`audit-entry-${e.id}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div
                            className={cn(
                              'h-7 w-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold',
                              isPlant ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary',
                            )}
                          >
                            {isPlant ? <Building2 className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-foreground">
                                {e.entity_label ?? e.entity_id}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-3xs font-semibold px-1.5 py-0.2 uppercase tracking-wide',
                                  isPlant ? 'border-info/40 text-info bg-info-soft/40' : 'border-primary/40 text-primary bg-primary-soft/40',
                                )}
                              >
                                {e.kind}
                              </Badge>
                              <Badge
                                variant={isHard ? 'destructive' : 'secondary'}
                                className="text-3xs font-bold px-1.5 py-0.2"
                              >
                                {isHard ? 'Hard Delete' : 'Soft Delete'}
                              </Badge>
                              {e.reason?.startsWith('[FORCE]') && (
                                <Badge className="bg-danger text-danger-foreground text-3xs font-bold px-1.5 py-0.2">
                                  <AlertOctagon className="h-2.5 w-2.5 mr-0.5 inline" /> FORCE
                                </Badge>
                              )}
                            </div>
                            <div className="text-2xs text-muted-foreground mt-0.5">
                              Executed by: <strong className="text-foreground">{e.actor_label ?? e.actor_user_id ?? 'Unknown user'}</strong>
                            </div>
                          </div>
                        </div>

                        <span className="text-2xs text-muted-foreground font-mono-num shrink-0">
                          {format(new Date(e.created_at), 'HH:mm:ss')}
                        </span>
                      </div>

                      {e.reason && (
                        <div className="mt-2 text-xs text-muted-foreground italic bg-muted/40 p-2 rounded-lg border border-border/40">
                          "{e.reason}"
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}

          {entries.length === 0 && (
            <Card className="p-8 text-center text-xs text-muted-foreground space-y-2 border-dashed">
              <Trash2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <div className="font-semibold text-sm text-foreground">No deletion events recorded</div>
              <p className="text-xs max-w-sm mx-auto">
                No plant or user records have been soft-deleted or permanently purged under this filter.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
