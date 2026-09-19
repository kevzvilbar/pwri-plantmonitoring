import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, Gauge, Pencil, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum, fmtDt, tableLabel } from '../../types';
import { FlagBadge } from '../../components/FlagBadge';
import { AnomalyDiagnosticsBadge, PrecedingReadingTooltip } from '../../components/DiagnosticPopover';
import { CompactReasonBadge } from '../../components/CompactReasonBadge';
import { ChainContext } from '../../components/ChainContext';
import { DeltaBadge } from '../../components/DeltaBadge';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { MarkRolloverModal } from '../../components/MarkRolloverModal';
import { EditValueModal } from '../../components/EditValueModal';
import type { FlaggedRow } from '../../types';

interface FlaggedReadingRowProps {
  row: FlaggedRow;
  isSelected: boolean;
  isExpanded: boolean;
  isBusy: boolean;
  customReasons: Record<string, string>;
  notes: Record<string, string>;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string | null) => void;
  onSaveReason: (row: FlaggedRow, reasonText: string) => Promise<void>;
  onNoteChange: (notes: Record<string, string>) => void;
  onResolve: (row: FlaggedRow, decision: 'normal' | 'retracted') => void;
  onEdit: (row: FlaggedRow) => void;
  onRollover: (row: FlaggedRow) => void;
  onUnlock: (row: FlaggedRow) => void;
  onCustomReasonChange: (reasons: Record<string, string>) => void;
}

export function FlaggedReadingRow({
  row, isSelected, isExpanded, isBusy, customReasons, notes,
  onToggleSelect, onToggleExpand, onSaveReason, onNoteChange,
  onResolve, onEdit, onRollover, onUnlock, onCustomReasonChange,
}: FlaggedReadingRowProps) {
  const isBack = !!row.is_backward;
  const isUnchanged = !!row.is_unchanged;

  return (
    <Card
      key={row.id}
      className={cn(
        'p-4',
        isBack
          ? 'border-destructive/30'
          : isUnchanged
          ? 'border-border/80'
          : 'border-warn/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(row.id)} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium truncate">{row.entity_name}</span>
                <Badge variant="outline" className="text-2xs px-1.5 py-0">{row.plant_name}</Badge>
                <Badge variant="outline" className="text-2xs px-1.5 py-0">{tableLabel[row.source_table]}</Badge>
                <FlagBadge reason={row.flag_reason} />
                <AnomalyDiagnosticsBadge row={row} />
                <CompactReasonBadge
                  row={row}
                  customReason={customReasons[row.id] ?? ''}
                  onSaveReason={onSaveReason}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>{fmtDt(row.reading_datetime)}</span>
                <span>·</span>
                <span>Submitted by <span className="font-medium text-foreground">{row.operator_username ?? '—'}</span></span>
                {row.edit_reason?.actor_label && (
                  <>
                    <span>·</span>
                    <span className="text-accent font-medium">Corrected by {row.edit_reason.actor_label}</span>
                  </>
                )}
              </div>
            </div>
            <button onClick={() => onToggleExpand(isExpanded ? null : row.id)}
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
              className="text-muted-foreground hover:text-foreground shrink-0 p-0.5">
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {row.pre_edit_value != null && row.pre_edit_value !== row.current_reading ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
                <div>
                  <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Value Before Correction</div>
                  <div className="font-mono font-bold text-sm text-destructive line-through decoration-destructive/70 mt-0.5">
                    {fmtNum(row.pre_edit_value)}
                  </div>
                  {row.previous_reading != null && (
                    <div className="text-3xs text-muted-foreground mt-0.5">
                      Old Δ: {fmtNum(row.pre_edit_value - row.previous_reading)} m³
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                    <span className="text-accent">→</span> Corrected Reading (Current)
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono font-bold text-sm text-accent">{fmtNum(row.current_reading)}</span>
                    <span className={cn('text-3xs font-mono font-bold px-1.5 py-0.2 rounded',
                      row.current_reading >= row.pre_edit_value
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    )}>
                      {row.current_reading >= row.pre_edit_value
                        ? `+${fmtNum(row.current_reading - row.pre_edit_value)}`
                        : fmtNum(row.current_reading - row.pre_edit_value)}
                    </span>
                  </div>
                  {row.daily_volume != null && (
                    <div className="text-3xs text-accent font-medium mt-0.5">
                      New Δ: <DeltaBadge vol={row.daily_volume} />
                    </div>
                  )}
                </div>
                <div>
                  <PrecedingReadingTooltip
                    prevReading={row.previous_reading}
                    prevDatetime={row.previous_reading_datetime}
                    prevUser={row.previous_operator_username}
                    elapsedHours={row.elapsed_hours}
                    label="Preceding Baseline (Prev)"
                  />
                  <div className="font-mono font-medium text-xs text-muted-foreground mt-0.5">{fmtNum(row.previous_reading)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-muted/20 p-2 rounded-md">
                <div>
                  <PrecedingReadingTooltip
                    prevReading={row.previous_reading}
                    prevDatetime={row.previous_reading_datetime}
                    prevUser={row.previous_operator_username}
                    elapsedHours={row.elapsed_hours}
                    label="Preceding Baseline"
                  />
                  <div className="font-mono font-medium">{fmtNum(row.previous_reading)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-2xs">Before Correction</div>
                  <div className="font-mono font-medium text-destructive line-through decoration-destructive/60">{fmtNum(row.pre_edit_value)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-2xs font-semibold text-accent">Corrected Current</div>
                  <div className="font-mono font-bold text-accent">{fmtNum(row.current_reading)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-2xs">Calculated Delta</div>
                  <DeltaBadge vol={row.daily_volume} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 text-xs bg-muted/15 p-2 rounded-md border border-border/40">
              <div>
                <PrecedingReadingTooltip
                  prevReading={row.previous_reading}
                  prevDatetime={row.previous_reading_datetime}
                  prevUser={row.previous_operator_username}
                  elapsedHours={row.elapsed_hours}
                  label="Preceding Reading"
                />
                <div className="font-mono font-medium mt-0.5">{fmtNum(row.previous_reading)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-2xs font-semibold">Logged Reading</div>
                <div className="font-mono font-bold text-foreground mt-0.5">{fmtNum(row.current_reading)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-2xs font-semibold">Calculated Delta</div>
                <div className="mt-0.5"><DeltaBadge vol={row.daily_volume} /></div>
              </div>
            </div>
          )}

          {(row.anomaly_remark || row.edit_reason) && (
            <div className="flex items-center gap-1.5 text-2xs px-2.5 py-1 rounded-md border bg-muted/20 border-border/40 text-foreground/90">
              <Tag className="h-3 w-3 shrink-0 text-primary" />
              <span className="font-semibold text-muted-foreground shrink-0">
                {row.anomaly_remark ? 'Operator remark:' : 'Edit reason:'}
              </span>
              <span className="truncate italic">"{row.anomaly_remark?.text || row.edit_reason?.text}"</span>
              {row.edit_reason?.actor_label && (
                <span className="text-3xs text-muted-foreground shrink-0">— by {row.edit_reason.actor_label}</span>
              )}
            </div>
          )}

          {isExpanded && (
            <ChainContext
              focusedId={row.id}
              sourceTable={row.source_table}
              entityId={row.entity_id ?? row.id}
              plantId={row.plant_id ?? ''}
            />
          )}

          <div className="flex gap-2 items-center flex-wrap">
            <Input
              placeholder="Optional note…"
              value={notes[row.id] ?? ''}
              onChange={e => onNoteChange({ ...notes, [row.id]: e.target.value })}
              className="h-7 text-xs flex-1 min-w-[120px]"
              disabled={isBusy}
            />
            <Button size="sm" variant="outline"
              className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary-soft"
              disabled={isBusy} onClick={() => onResolve(row, 'normal')}>
              {isBusy ? <><span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full mr-1" /> Approving…</> : <><CheckCircle2 className="h-3 w-3" /> Approve</>}
            </Button>
            {isBack && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs border-accent/40 text-accent hover:bg-accent-soft"
                disabled={isBusy} onClick={() => onRollover(row)}>
                <Gauge className="h-3 w-3" />
                Mark as rollover
              </Button>
            )}
            <Button size="sm" variant="outline"
              className="h-7 gap-1 text-xs border-warn/40 text-warn hover:bg-warn-soft"
              disabled={isBusy} onClick={() => onEdit(row)}>
              <Pencil className="h-3 w-3" />
              Edit value
            </Button>
            <Button size="sm" variant="outline"
              className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
              disabled={isBusy} onClick={() => onResolve(row, 'retracted')}>
              {isBusy ? <><span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full mr-1" /> Rejecting…</> : <><XCircle className="h-3 w-3" /> Reject</>}
            </Button>
            {(row as any).locked_at && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary-soft"
                disabled={isBusy} onClick={() => onUnlock(row)}>
                🔓 Unlock
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
