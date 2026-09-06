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


// ── Types ─────────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────────
// BUGFIX: every reading_normalizations audit write on this page hardcoded
// performed_role: 'Admin', regardless of who actually performed the action.
// Since this page is also open to Manager and Data Analyst (20260723
// migration), a Manager's approve/reject/retract was being logged as if an
// Admin did it — actively wrong for the exact "who did what" tracing this
// audit table exists for. Priority order matches the tie-break already used
// server-side for multi-role users (see fn_cascade_reading_correction).
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
// Same "guessed max, human confirms" heuristic as Step 1 of
// supabase/migrations/*_meter_rollover_backfill.sql: a mechanical register
// almost always wraps at a round power-of-ten boundary just above its
// previous value (e.g. a reading in the 900,000s on a 6-digit odometer
// wraps at 999999.99). It's a starting point for the admin to confirm or
// overtype against the physical meter's real register size, never applied
// automatically.
// "Mark as rollover" for a row stuck in Pending Review because it looked
// like a backward reading. Deliberately single-row only (no bulk variant,
// unlike Approve/Reject all) — telling a genuine meter wrap-around apart
// from a data-entry typo needs a human actually looking at the value
// against this meter's normal range, the same reasoning behind the backfill
// script's explicit per-row allow-list instead of an auto-apply pass.
export function MarkRolloverModal({
  row, onClose, onDone,
}: { row: FlaggedRow; onClose: () => void; onDone: () => void }) {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const [maxVal, setMaxVal] = useState(String(guessMeterMax(row.previous_reading)));
  const [maxTouched, setMaxTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Wells can carry a configured wrap point (wells.meter_rollover_max, see
  // 20260806143000_wells_meter_rollover_max_config.sql) — prefer it over the
  // guessed digit-count heuristic once it loads. Locators and product
  // meters have no equivalent config column yet, so they keep using the
  // guess. maxTouched guards against clobbering a value the admin already
  // started typing before this resolves.
  const { data: configuredMax } = useQuery({
    queryKey: ['well-rollover-max', row.entity_id],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('meter_rollover_max').eq('id', row.entity_id as string).maybeSingle();
      return (data as any)?.meter_rollover_max ?? null;
    },
    enabled: row.source_table === 'well_readings' && !!row.entity_id,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (configuredMax != null && !maxTouched) setMaxVal(String(configuredMax));
  }, [configuredMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsedMax = Number(maxVal);
  const validMax = maxVal !== '' && !isNaN(parsedMax) && parsedMax > 0
    && (row.previous_reading == null || parsedMax >= row.previous_reading);

  // Same formula as calc.dailyVolume (frontend) and the DB's rollover-aware
  // daily_volume expression: (max - previous) + current, floored at zero.
  const computedVolume = validMax
    ? Math.max(0, Math.round((parsedMax - (row.previous_reading ?? 0)) + row.current_reading))
    : null;

  const handleSave = async () => {
    if (!validMax) {
      toast.error(row.previous_reading != null
        ? `Enter a wrap point ≥ the previous reading (${fmtNum(row.previous_reading)})`
        : 'Enter a valid wrap point');
      return;
    }
    setBusy(true);
    try {
      // locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres
      // recomputes it from is_meter_rollover/meter_rollover_max automatically
      // and must never appear in this UPDATE. well_readings and
      // product_meter_readings store it as a plain column that needs setting
      // directly — the same table-shape distinction the backfill SQL
      // script's Step 2 makes.
      const payload: Record<string, unknown> = {
        is_meter_rollover: true,
        meter_rollover_max: parsedMax,
        norm_status: 'normal',
      };
      if (row.source_table !== 'locator_readings') {
        payload.daily_volume = computedVolume;
      }
      const { error } = await (supabase.from(row.source_table as any).update(payload).eq('id', row.id) as any);
      if (error) throw error;

      await (supabase.from('reading_normalizations' as any).insert({
        source_table: row.source_table, source_id: row.id,
        action: 'normalize',
        original_value: row.current_reading,
        adjusted_value: computedVolume,
        note: `Marked as meter rollover (wrap point ${fmtNum(parsedMax)}) from Pending Review — true delta ${fmtNum(computedVolume)} m³`,
        performed_by: user?.id ?? null, performed_role: actorRole,
      }) as any);
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        'Superseded — reading marked as meter rollover directly from Pending Review',
      );
      toast.success(`${row.entity_name}: marked as rollover · +${fmtNum(computedVolume)} m³`);
      onDone();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title={(
        <span className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-primary shrink-0" />
          Mark as meter rollover — {row.entity_name}
        </span>
      )}
      description={(
        <>
          {row.plant_name} · {fmtDt(row.reading_datetime)}
          <br />
          Previous: <span className="font-mono">{fmtNum(row.previous_reading)}</span>
          {' → '}Current: <span className="font-mono">{fmtNum(row.current_reading)}</span>
        </>
      )}
      className="max-w-sm"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={busy || !validMax}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Confirm rollover
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 pb-4">
        <p className="text-xs text-muted-foreground">
          Only confirm this if the meter's register actually wrapped around —
          the current reading should look like an early value for this meter
          (small, near its usual minimum), not a plausible mid-range value
          with a digit dropped or transposed.
        </p>

        <div className="space-y-1">
          <label htmlFor="datacorrections-wrap-point" className="text-xs font-medium">Meter wrap point (register max)</label>
          <Input
            id="datacorrections-wrap-point"
            type="number"
            value={maxVal}
            onChange={e => { setMaxVal(e.target.value); setMaxTouched(true); }}
            className="font-mono h-9 text-sm"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs text-muted-foreground">Presets:</span>
            {[
              { label: '99,999.99', val: 99999.99 },
              { label: '999,999.99', val: 999999.99 },
              { label: '9,999,999.99', val: 9999999.99 },
              { label: '99,999', val: 99999 },
              { label: '999,999', val: 999999 },
              { label: '9,999,999', val: 9999999 },
            ].map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setMaxVal(String(p.val)); setMaxTouched(true); }}
                className={cn(
                  'text-2xs font-mono px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-accent/20 transition-colors',
                  Number(maxVal) === p.val && 'bg-primary/20 border-primary text-primary font-semibold'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {configuredMax != null && !maxTouched
              ? "From this well's configured wrap point (Edit Well) — overtype if it's wrong."
              : "Guessed from the previous reading's digit count — overtype with the physical meter's actual register size if you know it."}
          </p>
          {validMax && (
            <p className="text-xs text-muted-foreground">
              True delta if confirmed: <DeltaBadge vol={computedVolume} />
            </p>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  );
}