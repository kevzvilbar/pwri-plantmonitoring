/**
 * NormalizeButton
 * ───────────────
 * Inline control that appears on any reading row/card when the current user
 * holds Admin or Data Analyst privileges.
 *
 * Status lifecycle:
 *   normal  ──► erroneous (Tag)  ──► normalized (Normalize)
 *                                └──► retracted  (Retract)
 *   Any Admin/Analyst can retract a normalization to restore the original.
 *
 * DB contract (reading_normalizations table — see migration below):
 *   source_table  TEXT    e.g. 'locator_readings'
 *   source_id     UUID    FK to the reading row
 *   action        TEXT    'tag' | 'normalize' | 'retract'
 *   original_value NUMERIC  preserved original reading value
 *   adjusted_value NUMERIC  the corrected value (null for tag-only)
 *   note          TEXT    optional analyst note
 *   performed_by  UUID    user_profiles.id
 *   performed_role TEXT   'Admin' | 'Data Analyst'
 *   performed_at  TIMESTAMPTZ
 *   retractable   BOOLEAN default true
 *
 * Required SQL migration:
 *   -- supabase/migrations/20260514_normalization.sql
 *   CREATE TYPE reading_norm_action AS ENUM ('tag', 'normalize', 'retract');
 *   CREATE TABLE reading_normalizations (
 *     id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     source_table   TEXT NOT NULL,
 *     source_id      UUID NOT NULL,
 *     action         reading_norm_action NOT NULL,
 *     original_value NUMERIC,
 *     adjusted_value NUMERIC,
 *     note           TEXT,
 *     performed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
 *     performed_role TEXT NOT NULL,
 *     performed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     retractable    BOOLEAN NOT NULL DEFAULT true
 *   );
 *   CREATE INDEX ON reading_normalizations(source_table, source_id);
 *   ALTER TABLE locator_readings ADD COLUMN IF NOT EXISTS norm_status TEXT
 *     CHECK (norm_status IN ('normal','erroneous','normalized','retracted'))
 *     DEFAULT 'normal';
 *   ALTER TABLE well_readings ADD COLUMN IF NOT EXISTS norm_status TEXT
 *     CHECK (norm_status IN ('normal','erroneous','normalized','retracted'))
 *     DEFAULT 'normal';
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertTriangle, RefreshCw, Undo2, ChevronDown, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NormStatus = 'normal' | 'erroneous' | 'normalized' | 'retracted';

export interface NormalizeButtonProps {
  /** The Supabase table that owns this reading. */
  sourceTable: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
  /** The reading row's UUID. */
  sourceId: string;
  /** Current normalization status of the reading. */
  currentStatus: NormStatus;
  /** The reading's numeric value (current_reading or daily_volume). */
  readingValue: number;
  /** react-query invalidation keys to refresh after a normalization action. */
  invalidateKeys?: string[][];
  /** Extra CSS on the trigger button. */
  className?: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────

export function NormStatusBadge({ status }: { status: NormStatus }) {
  if (status === 'normal') return null;
  const cfg = {
    erroneous:  { icon: <AlertTriangle className="h-3 w-3" />, label: 'Flagged',    cls: 'text-amber-600 bg-amber-50  dark:bg-amber-950/40 dark:text-amber-300 border-amber-300/60' },
    normalized: { icon: <RefreshCw     className="h-3 w-3" />, label: 'Normalized', cls: 'text-teal-600  bg-teal-50   dark:bg-teal-950/40  dark:text-teal-300  border-teal-300/60'  },
    retracted:  { icon: <Undo2         className="h-3 w-3" />, label: 'Retracted',  cls: 'text-muted-foreground bg-muted border-border' },
  }[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border',
        cfg.cls,
      )}
      title={`Reading ${cfg.label.toLowerCase()}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Inline emoji indicator (for dashboard cells / chart tooltips) ─────────────

export function NormStatusEmoji({ status }: { status: NormStatus }) {
  if (status === 'normal') return null;
  const map: Record<NormStatus, string> = {
    normal:     '',
    erroneous:  '⚠️',
    normalized: '🔄',
    retracted:  '⏪',
  };
  return <span title={status} aria-label={status}>{map[status]}</span>;
}

// ── Normalize dialog ──────────────────────────────────────────────────────────

interface NormalizeDialogProps {
  open: boolean;
  onClose: () => void;
  sourceTable: NormalizeButtonProps['sourceTable'];
  sourceId: string;
  originalValue: number;
  performerRole: string;
  onSuccess: (newStatus: NormStatus) => void;
}

function NormalizeDialog({
  open, onClose, sourceTable, sourceId, originalValue, performerRole, onSuccess,
}: NormalizeDialogProps) {
  const [adjustedValue, setAdjustedValue] = useState(String(originalValue));
  const [note, setNote]                   = useState('');
  const [busy, setBusy]                   = useState(false);

  const handleSubmit = async () => {
    const adj = parseFloat(adjustedValue);
    if (isNaN(adj)) { toast.error('Enter a valid adjusted value.'); return; }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not signed in.'); setBusy(false); return; }

    // 1. Write normalization audit row
    const { error: auditErr } = await (supabase.from('reading_normalizations' as any) as any).insert({
      source_table:   sourceTable,
      source_id:      sourceId,
      action:         'normalize',
      original_value: originalValue,
      adjusted_value: adj,
      note:           note.trim() || null,
      performed_by:   user.id,
      performed_role: performerRole,
      retractable:    true,
    });
    if (auditErr) { toast.error(`Audit write failed: ${auditErr.message}`); setBusy(false); return; }

    // 2. Update the reading's norm_status column
    const { error: updErr } = await (supabase.from(sourceTable as any) as any)
      .update({ norm_status: 'normalized' })
      .eq('id', sourceId);
    if (updErr) { toast.error(`Status update failed: ${updErr.message}`); setBusy(false); return; }

    toast.success('Reading normalized.');
    setBusy(false);
    onSuccess('normalized');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-teal-600" />
            Normalize Reading
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Original value</Label>
            <p className="text-sm font-mono mt-0.5 text-muted-foreground">{originalValue}</p>
          </div>
          <div>
            <Label htmlFor="adj-val" className="text-xs">Adjusted value <span className="text-destructive">*</span></Label>
            <Input
              id="adj-val"
              type="number"
              step="any"
              value={adjustedValue}
              onChange={(e) => setAdjustedValue(e.target.value)}
              className="mt-1 h-8 text-sm"
              placeholder="Enter corrected value"
            />
          </div>
          <div>
            <Label htmlFor="norm-note" className="text-xs">Note <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="norm-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 h-8 text-sm"
              placeholder="Reason for adjustment…"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Metadata: <code>normalized_by={performerRole}:{'{your user id}'}</code>,
            timestamp={new Date().toISOString().slice(0, 16)},
            retractable=true
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy} data-testid="normalize-confirm-btn">
            {busy ? 'Saving…' : 'Normalize'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main NormalizeButton ──────────────────────────────────────────────────────

export function NormalizeButton({
  sourceTable, sourceId, currentStatus, readingValue, invalidateKeys = [], className,
}: NormalizeButtonProps) {
  const { isDataAnalyst, isAdmin, roles } = useAuth();
  const qc = useQueryClient();

  const [status, setStatus]         = useState<NormStatus>(currentStatus);
  const [normalizeOpen, setNormOpen] = useState(false);
  const [busy, setBusy]             = useState(false);

  // Only visible to Admin / Data Analyst
  if (!isDataAnalyst) return null;

  const performerRole = isAdmin ? 'Admin' : 'Data Analyst';
  const canRetract    = status === 'normalized' || status === 'erroneous';

  const invalidate = () => {
    invalidateKeys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
  };

  const writeAudit = async (
    action: 'tag' | 'retract',
    originalValue?: number,
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await (supabase.from('reading_normalizations' as any) as any).insert({
      source_table:   sourceTable,
      source_id:      sourceId,
      action,
      original_value: originalValue ?? null,
      performed_by:   user.id,
      performed_role: performerRole,
      retractable:    action !== 'retract',
    });
    return !error;
  };

  const updateStatus = async (newStatus: NormStatus) => {
    const { error } = await (supabase.from(sourceTable as any) as any)
      .update({ norm_status: newStatus })
      .eq('id', sourceId);
    return !error;
  };

  // Tag only — mark as erroneous without changing value
  const handleTag = async () => {
    setBusy(true);
    const ok1 = await writeAudit('tag', readingValue);
    const ok2 = await updateStatus('erroneous');
    if (ok1 && ok2) {
      setStatus('erroneous');
      invalidate();
      toast.success('Reading tagged as erroneous.');
    } else {
      toast.error('Tag action failed — check console.');
    }
    setBusy(false);
  };

  // Retract — undo previous normalization or tag
  const handleRetract = async () => {
    setBusy(true);
    const ok1 = await writeAudit('retract');
    const ok2 = await updateStatus('retracted');
    if (ok1 && ok2) {
      setStatus('retracted');
      invalidate();
      toast.success('Normalization retracted. Original value preserved.');
    } else {
      toast.error('Retract failed — check console.');
    }
    setBusy(false);
  };

  const triggerCls = cn(
    'h-6 px-1.5 text-[10px] font-medium rounded border transition-colors inline-flex items-center gap-1',
    status === 'erroneous'  && 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300',
    status === 'normalized' && 'border-teal-400  text-teal-600  bg-teal-50  dark:bg-teal-950/40  dark:text-teal-300',
    status === 'retracted'  && 'border-border    text-muted-foreground bg-muted',
    status === 'normal'     && 'border-border    text-muted-foreground bg-card hover:bg-muted',
    className,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={triggerCls}
            disabled={busy}
            title="Normalization options"
            data-testid={`normalize-btn-${sourceId}`}
          >
            {status === 'normal'     && <><Tag className="h-3 w-3" /> Normalize</>}
            {status === 'erroneous'  && <><AlertTriangle className="h-3 w-3" /> ⚠️ Flagged</>}
            {status === 'normalized' && <><RefreshCw className="h-3 w-3" /> 🔄 Normalized</>}
            {status === 'retracted'  && <><Undo2 className="h-3 w-3" /> ⏪ Retracted</>}
            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-44 text-xs">
          <DropdownMenuItem
            onClick={handleTag}
            disabled={busy || status === 'erroneous'}
            className="text-amber-600 focus:text-amber-600 gap-2"
            data-testid="normalize-action-tag"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Tag as erroneous
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setNormOpen(true)}
            disabled={busy}
            className="gap-2"
            data-testid="normalize-action-normalize"
          >
            <RefreshCw className="h-3.5 w-3.5 text-teal-600" />
            Normalize value
          </DropdownMenuItem>

          {canRetract && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleRetract}
                disabled={busy}
                className="text-muted-foreground gap-2"
                data-testid="normalize-action-retract"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Retract
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NormalizeDialog
        open={normalizeOpen}
        onClose={() => setNormOpen(false)}
        sourceTable={sourceTable}
        sourceId={sourceId}
        originalValue={readingValue}
        performerRole={performerRole}
        onSuccess={(s) => { setStatus(s); invalidate(); }}
      />
    </>
  );
}
