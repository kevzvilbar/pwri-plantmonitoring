/**
 * CorrectionRequestDialog.tsx
 * ════════════════════════════
 * Item 8 — replaces the window.prompt() call in Operations.tsx.
 * Operator fills in proposed value + reason + optional note.
 * On submit:
 *   1. Creates a row in correction_requests
 *   2. Sets the reading's norm_status = 'pending_review'  (existing behaviour)
 *   3. Writes to reading_normalizations for audit trail    (existing behaviour)
 *   4. DB trigger fn_notify_supervisors_on_request fires → notification bell
 */

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Loader2, AlertCircle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CorrectionTarget {
  id: string;
  sourceTable: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';
  plantId: string;
  entityName: string;      // e.g. "MCWD-M1" or "Well 8"
  currentReading: number;
  previousReading: number | null;
  dailyVolume: number | null;
  readingDatetime: string;
}

interface Props {
  target: CorrectionTarget;
  onClose: () => void;
  onSubmitted: () => void;
}

const REASONS = [
  'Meter misread — wrong digits copied',
  'Data entry typo — extra/missing digit',
  'Wrong previous value used as anchor',
  'Meter replaced — should be marked as replacement',
  'Duplicate submission — this entry is the wrong one',
  'Reading entered for wrong locator/well',
  'Other',
] as const;

const fmtNum = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });

// ── Component ─────────────────────────────────────────────────────────────────

export function CorrectionRequestDialog({ target, onClose, onSubmitted }: Props) {
  const { user } = useAuth();
  const [proposedValue, setProposedValue] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = proposedValue !== '' ? Number(proposedValue) : null;
  const newDelta = parsed != null && target.previousReading != null
    ? parsed - target.previousReading : null;

  const handleSubmit = async () => {
    if (parsed == null || isNaN(parsed)) { toast.error('Enter a valid proposed value'); return; }
    if (!reason) { toast.error('Select a reason'); return; }

    const finalReason = reason === 'Other' ? (customReason.trim() || 'Other') : reason;
    setBusy(true);

    try {
      // 1. Create correction request (triggers supervisor notification)
      const { error: crErr } = await (supabase
        .from('correction_requests' as any)
        .insert({
          source_table:   target.sourceTable,
          source_id:      target.id,
          plant_id:       target.plantId,
          submitted_by:   user?.id ?? null,
          original_value: target.currentReading,
          proposed_value: parsed,
          reason:         finalReason,
          note:           note.trim() || null,
          status:         'pending',
        }) as any);
      if (crErr) throw crErr;

      // 2. Flag the reading as pending_review
      const { error: upErr } = await (supabase
        .from(target.sourceTable as any)
        .update({ norm_status: 'pending_review' })
        .eq('id', target.id) as any);
      if (upErr) throw upErr;

      // 3. Write normalization audit record
      await (supabase
        .from('reading_normalizations' as any)
        .insert({
          source_table:   target.sourceTable,
          source_id:      target.id,
          action:         'tag',
          original_value: target.currentReading,
          adjusted_value: parsed,
          note:           `Operator correction request: ${finalReason}${note ? ' — ' + note : ''}`,
          performed_by:   user?.id ?? null,
          performed_role: 'Operator',
        }) as any);

      toast.info(
        `${target.entityName}: correction request submitted. Your supervisor has been notified.`,
        { duration: 7000 },
      );
      onSubmitted();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-xl shadow-xl w-full max-w-sm space-y-4 p-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <h3 className="font-semibold text-sm">Request correction — {target.entityName}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date(target.readingDatetime).toLocaleString('en-PH', {
              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>

        {/* Current reading summary */}
        <div className="bg-muted/40 rounded-lg px-3 py-2.5 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Previous reading</span>
            <span className="font-mono font-medium">{fmtNum(target.previousReading)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current reading (to fix)</span>
            <span className="font-mono font-medium text-amber-600">{fmtNum(target.currentReading)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current delta</span>
            <span className={`font-mono font-medium ${(target.dailyVolume ?? 0) < 0 ? 'text-destructive' : ''}`}>
              {target.dailyVolume != null
                ? `${target.dailyVolume >= 0 ? '+' : ''}${fmtNum(target.dailyVolume)} m³`
                : '—'}
            </span>
          </div>
        </div>

        {/* Proposed value */}
        <div className="space-y-1">
          <label className="text-xs font-medium">Proposed correct reading *</label>
          <Input
            type="number"
            placeholder={`e.g. ${fmtNum(target.currentReading)}`}
            value={proposedValue}
            onChange={e => setProposedValue(e.target.value)}
            className="font-mono h-9 text-sm"
            autoFocus
          />
          {newDelta != null && (
            <p className="text-xs text-muted-foreground">
              New delta would be{' '}
              <span className={`font-mono font-medium ${newDelta < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                {newDelta >= 0 ? '+' : ''}{fmtNum(newDelta)} m³
              </span>
            </p>
          )}
        </div>

        {/* Reason */}
        <div className="space-y-1">
          <label className="text-xs font-medium">Reason *</label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select reason…" />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map(r => (
                <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reason === 'Other' && (
            <Input
              placeholder="Describe the issue…"
              className="h-8 text-xs mt-1"
              value={customReason}
              onChange={e => setCustomReason(e.target.value)}
            />
          )}
        </div>

        {/* Optional note */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Additional note (optional)</label>
          <Input
            placeholder="e.g. meter display was foggy, read right digit as 6 not 0"
            className="h-8 text-xs"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Your supervisor will be notified and must approve this correction.
            The reading will be excluded from totals until reviewed.
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={busy || parsed == null || isNaN(parsed as number) || !reason}
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Submit request
          </Button>
        </div>
      </div>
    </div>
  );
}
