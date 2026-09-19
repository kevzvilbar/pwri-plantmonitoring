import React, { type Dispatch, type SetStateAction } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataState } from '@/components/DataState';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  User, Building2, Trash2, AlertOctagon, Clock,
} from 'lucide-react';
import type { AuditEntry } from './types';

interface DeletionAuditSectionProps {
  entries: AuditEntry[];
  isLoading: boolean;
  error: any;
  data: any;
  kindFilter: 'all' | 'user' | 'plant';
  onKindFilterChange: Dispatch<SetStateAction<'all' | 'user' | 'plant'>>;
  onRetry: () => void;
  groupedDeletionsByDay: any[];
}

export function DeletionAuditSection({
  entries, isLoading, error, data, kindFilter, onKindFilterChange, onRetry, groupedDeletionsByDay,
}: DeletionAuditSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
            {(['all', 'user', 'plant'] as const).map((k) => (
              <button
                key={k}
                onClick={() => onKindFilterChange(k)}
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

        <div className="text-xs text-muted-foreground font-mono-num">
          Showing <strong>{entries.length}</strong> events (capped at 200)
        </div>
      </div>

      {isLoading || (error && !data) ? (
        <DataState loading={isLoading} error={!data ? error : undefined} onRetry={onRetry} />
      ) : (
        <div className="space-y-5">
          {groupedDeletionsByDay.map(({ dateKey, label, items }) => (
            <div key={dateKey} className="space-y-2.5">
              <div className="flex items-center gap-2 sticky top-0 z-10 py-1 bg-background/90 backdrop-blur-xs">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</h4>
                <div className="flex-1 h-px bg-border/60" />
                <span className="text-2xs font-mono-num font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                  {items.length} event{items.length === 1 ? '' : 's'}
                </span>
              </div>

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
                              <span className="text-xs font-bold text-foreground">{e.entity_label ?? e.entity_id}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-3xs font-semibold px-1.5 py-0.2 uppercase tracking-wide',
                                  isPlant
                                    ? 'border-info/40 text-info bg-info-soft/40'
                                    : 'border-primary/40 text-primary bg-primary-soft/40',
                                )}
                              >
                                {e.kind}
                              </Badge>
                              <Badge variant={isHard ? 'destructive' : 'secondary'} className="text-3xs font-bold px-1.5 py-0.2">
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
