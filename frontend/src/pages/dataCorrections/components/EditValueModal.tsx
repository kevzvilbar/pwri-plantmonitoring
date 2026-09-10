/**
 * DataCorrections.tsx
 * ═══════════════════
 * Unified correction hub — replaces the scattered Admin → Normalization panel,
 * the Pending Readings queue, and the per-row ReadingHistoryDialog corrections.
 *
 * Tabs
 * ────
 * 1. Pending Review  — readings auto-flagged by the DB trigger awaiting approval.
 *                      Bulk approve/retract + inline chain context (items 3, 4, 5).
 * 2. Correction Inbox — all active backward or erroneous readings still norm_status='normal'.
 *                      Admin can edit value (cascade), retract, or mark as replacement (item 6).
 * 3. Edit History    — reading_normalizations audit trail.
 * 4. Operator Stats  — rolling 30-day error rate table (item 7).
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { format, formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2,
  ChevronDown, ChevronUp, ClipboardCheck, Inbox, History,
  Users, ArrowRight, Pencil, Search, ShieldAlert, Gauge,
  AlertTriangle, CheckSquare, FileText, Clock, Activity, Tag, HelpCircle, FileQuestion,
} from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  computeRollingAverageRate, computeRollingAverageRateFromDeltas, RatePoint, VolumePoint,
} from '@/lib/flowRateGuards';
import { submitAnomalyRemark } from '@/lib/anomalyRemarks';
import { cn } from '@/lib/utils';
import { SourceTable, FlaggedRow, CorrectionRequest, ChainEntry, OperatorStat, tableLabel, fmtNum, fmtDt, parseNumeric, extractOldValueFromChanges, pickDisplayRole, ROLE_DISPLAY_PRIORITY, UUID } from '../types';
import { PENDING_FETCH_LIMIT_PER_TABLE, guessMeterMax, fetchPending, fetchCorrectionRequests, supersedeOtherCorrectionRequests } from '../api';
import { DeltaBadge } from './DeltaBadge';
import { FlagBadge } from './FlagBadge';
import { ChainContext } from './ChainContext';
import { AnomalyDiagnosticsBadge, formatElapsedDuration, PrecedingReadingTooltip } from './DiagnosticPopover';
import { CompactReasonBadge, QUICK_ANOMALY_REASONS } from './CompactReasonBadge';


// ── Recently corrected (old ↔ new value) panel ────────────────────────────────
// Both "Edit value" (fn_cascade_reading_correction) and "Approve & Apply" on an
// operator correction request immediately flip the reading's norm_status away
// from whatever this tab is filtering on — 'pending_review' here, 'pending' for
// correction_requests — so the row disappears from the list the instant it's
// corrected. The only record of what changed used to be a toast that fades in
// a few seconds; the durable copy (reading_normalizations) only surfaces later,
// buried in the separate Edit History tab. This keeps the last few corrections
// visible, old value and new value side by side, right where the reviewer is
// already looking. Session-only by design — Edit History is the permanent record.
// ── Chain context component (item 4) ──────────────────────────────────────────
// ── Edit value dialog (item 6 – cascade correction) ───────────────────────────

export function EditValueModal({
  row, onClose, onDone,
}: {
  row: FlaggedRow;
  onClose: () => void;
  /** Called after a successful save. `result` carries the old (pre-edit) and
   *  new value so the caller can surface a durable before/after record —
   *  this row's own norm_status flips away from 'pending_review' as part of
   *  the same save, so it vanishes from whatever list is showing it, and a
   *  toast alone isn't enough for a reviewer to confirm what actually
   *  changed after the fact. */
  onDone: (result?: { oldValue: number; newValue: number }) => void;
}) {
  const { user } = useAuth();
  const [newVal, setNewVal] = useState(String(row.current_reading));
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [busy, setBusy] = useState(false);

  const delta = Number(newVal) - (row.previous_reading ?? 0);

  const handleSave = async () => {
    const parsed = Number(newVal);
    if (isNaN(parsed) || !newVal) { toast.error('Enter a valid number'); return; }
    if (!isReasonComplete(reason, customReason)) { toast.error('A correction reason is required'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('fn_cascade_reading_correction', {
        p_table:       row.source_table,
        p_row_id:      row.id,
        p_new_current: parsed,
        p_admin_id:    user?.id ?? null,
        p_reason:      resolveReason(reason, customReason),
      });
      if (error) throw error;
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        'Superseded — value corrected directly from Pending Review',
      );
      toast.success(`Corrected: ${fmtNum(row.current_reading)} → ${fmtNum(parsed)}${(data as any)?.cascade_id ? ' · next row updated' : ''}`);
      onDone({ oldValue: row.current_reading, newValue: parsed });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title={`Edit reading — ${row.entity_name}`}
      description={(
        <>
          {row.plant_name} · {fmtDt(row.reading_datetime)}
          <br />
          Previous reading: <span className="font-mono">{fmtNum(row.previous_reading)}</span>
        </>
      )}
      className="max-w-sm"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !isReasonComplete(reason, customReason) || !newVal}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save &amp; cascade
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 pb-4">
        {/* Current (about-to-be-replaced) value — kept visible on its own,
            separate from the editable input below, so it doesn't disappear
            from view the moment the reviewer starts typing over it. */}
        <div className="bg-muted/40 rounded-lg px-3 py-2.5 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current (flagged) value</span>
            <span className="font-mono font-medium text-warn">{fmtNum(row.current_reading)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Previous reading</span>
            <span className="font-mono font-medium">{fmtNum(row.previous_reading)}</span>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="datacorrections-new-value" className="text-xs font-medium">Correct current reading</label>
          <Input
            id="datacorrections-new-value"
            type="number"
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            className="font-mono h-9 text-sm"
            autoFocus
          />
          {newVal && !isNaN(Number(newVal)) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span className="font-mono line-through decoration-destructive/60 text-destructive">{fmtNum(row.current_reading)}</span>
              <ArrowRight className="h-3 w-3 text-accent" />
              <span className="font-mono font-semibold text-accent">{fmtNum(Number(newVal))}</span>
              <span>· New delta: <DeltaBadge vol={delta} /></span>
              <span>· next row previous_reading will auto-update</span>
            </p>
          )}
        </div>

        <CorrectionReasonField
          reason={reason} onReasonChange={setReason}
          customReason={customReason} onCustomReasonChange={setCustomReason}
          label="Correction reason"
        />
      </div>
    </ResponsiveDialog>
  );
}