import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Eye, Pencil, Trash2 } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { ReplPill } from '@/components/readingHistory/ReplPill';
import { normalizeReplacementRow } from '@/components/readingHistory/replacementLookup';
import { replacementToInitial } from '@/components/readingHistory/replacementEdit';
import type { NormalizedReplacement } from '@/components/readingHistory/replacementTypes';
import { fmtNum } from '@/lib/calculations';

export function WellReplacementHistoryCard({
  allReplacements,
  isManager,
  onReplaceMeter,
  onViewDetail,
  onEditReplacement,
  onDeleteReplacement,
}: {
  allReplacements: any[];
  isManager: boolean;
  onReplaceMeter: () => void;
  onViewDetail: (norm: NormalizedReplacement) => void;
  onEditReplacement: (initial: any) => void;
  onDeleteReplacement: (norm: NormalizedReplacement) => void;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <ChangeMeterIcon className="h-4 w-4 text-muted-foreground" /> Replacement History
          </h4>
          <Badge variant="secondary" className="text-2xs font-mono h-5 px-1.5">
            {allReplacements.length}
          </Badge>
        </div>
        {isManager && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={onReplaceMeter}>
            <Plus className="h-3.5 w-3.5" /> Replace Meter
          </Button>
        )}
      </div>
      {allReplacements.length ? (
        <div className="space-y-2">
          {allReplacements.map((r: any) => {
            const norm = normalizeReplacementRow('well', r);
            const replacerStr = r.replacer
              ? [r.replacer.first_name, r.replacer.last_name].filter(Boolean).join(' ')
              : null;
            return (
              <div
                key={r.id}
                className="rounded-lg border border-border/70 bg-card p-2.5 space-y-2 text-xs hover:border-border transition-colors"
              >
                <div className="flex items-center justify-between gap-2 border-b pb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{r.replacement_date}</span>
                    <ReplPill title="View replacement details" onClick={() => onViewDetail(norm)} />
                    {replacerStr && (
                      <span className="text-2xs text-muted-foreground hidden sm:inline">
                        by {replacerStr}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                      title="View details"
                      onClick={() => onViewDetail(norm)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {isManager && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          title="Edit replacement"
                          onClick={() => onEditReplacement(replacementToInitial(norm))}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete replacement"
                          onClick={() => onDeleteReplacement(norm)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-2xs">
                  <div className="rounded bg-muted/40 p-2 border border-border/40">
                    <div className="text-muted-foreground font-medium uppercase tracking-wider text-3xs">Old Meter</div>
                    <div className="text-foreground font-mono mt-0.5">SN: {r.old_serial ?? '—'}</div>
                    <div className="text-muted-foreground mt-0.5">
                      Final: <span className="font-mono font-medium text-foreground">{r.old_final_reading != null ? fmtNum(+r.old_final_reading, 2) : '—'}</span>
                    </div>
                  </div>
                  <div className="rounded bg-primary/5 p-2 border border-primary/20">
                    <div className="text-primary font-medium uppercase tracking-wider text-3xs">New Meter</div>
                    <div className="text-foreground font-mono mt-0.5">SN: {r.new_serial ?? '—'}</div>
                    <div className="text-muted-foreground mt-0.5">
                      Initial: <span className="font-mono font-medium text-foreground">{r.new_initial_reading != null ? fmtNum(+r.new_initial_reading, 2) : '—'}</span>
                    </div>
                  </div>
                </div>

                {r.reason_for_replacement && (
                  <div className="text-2xs text-muted-foreground pt-0.5">
                    <span className="font-medium">Reason:</span> {r.reason_for_replacement}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-2">No meter replacements recorded yet.</p>
      )}
    </Card>
  );
}
