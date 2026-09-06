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
import { DeltaBadge } from '../components/DeltaBadge';
import { FlagBadge } from '../components/FlagBadge';
import { ChainContext } from '../components/ChainContext';
import { AnomalyDiagnosticsBadge, formatElapsedDuration, PrecedingReadingTooltip } from '../components/DiagnosticPopover';
import { RecentCorrectionsPanel, useRecentCorrections, RecentCorrection } from '../components/RecentCorrectionsPanel';
import { EditValueModal } from '../components/EditValueModal';
import { CompactReasonBadge, QUICK_ANOMALY_REASONS } from '../components/CompactReasonBadge';
import { MarkRolloverModal } from '../components/MarkRolloverModal';


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
// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

// BUGFIX: this previously capped each of the 3 source tables at .limit(200)
// while the header badge (usePendingCount, below) does an exact head-count
// with no limit at all. With >200 pending rows in any one table, the badge
// and the visible list permanently disagreed — approving everything visible
// would empty the list while the badge still showed a large leftover number,
// which reads exactly like "approved items are still stuck as pending."
// They weren't stuck; they were never fetched. Raised to PostgREST's own
// per-request row cap (1000) and the query now reports whether even THAT
// was hit, so a future plant with >1000 pending rows in one table gets a
// visible "showing partial results" banner instead of the same silent gap.

export function PendingReviewTab() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['data-corrections-pending'],
    queryFn: fetchPending,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
  const rows = data?.rows ?? [];
  const truncated = data?.truncated ?? false;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<FlaggedRow | null>(null);
  const [rolloverRow, setRolloverRow] = useState<FlaggedRow | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [plantFilter, setPlantFilter] = useState('all');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [customReasons, setCustomReasons] = useState<Record<string, string>>({});
  /** Required rejection reason for operator correction requests (item 8) —
   *  keyed by correction_requests.id. Unlike `notes` above (optional, for
   *  admin's own direct edits/approvals), this one gates the Reject button:
   *  an operator who submitted a reasoned request is owed an explanation
   *  when it's turned down, not just a silent "kept the original value." */
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});
  const recent = useRecentCorrections();

  const handleSaveReason = async (row: FlaggedRow, reasonText: string) => {
    try {
      await submitAnomalyRemark({
        table_name: row.source_table as any,
        record_id: row.id,
        plant_id: row.plant_id ?? '',
        tier: (row.anomaly_remark?.tier as any) ?? (row.is_backward ? 'critical' : 'needs_remark'),
        direction: (row.deviation_direction as any) ?? (row.is_backward ? 'low' : 'high'),
        deviation_pct: row.deviation_pct ?? 0,
        flow_rate: row.calculated_flow_rate ?? null,
        avg_flow_rate: row.avg_flow_rate ?? null,
        rate_unit: 'm3/hr',
        remark_text: reasonText,
      });

      setNotes(p => ({ ...p, [row.id]: p[row.id] || reasonText }));
      setCustomReasons(p => ({ ...p, [row.id]: reasonText }));

      qc.setQueryData(['data-corrections-pending'], (old: any) => {
        if (!old?.rows) return old;
        return {
          ...old,
          rows: old.rows.map((r: FlaggedRow) => {
            if (r.id !== row.id) return r;
            return {
              ...r,
              anomaly_remark: {
                text: reasonText,
                tier: r.anomaly_remark?.tier ?? 'needs_remark',
                direction: r.deviation_direction ?? null,
                deviation_pct: r.deviation_pct ?? null,
                flow_rate: r.calculated_flow_rate ?? null,
                avg_flow_rate: r.avg_flow_rate ?? null,
                rate_unit: 'm3/hr',
                logged_at: new Date().toISOString(),
              },
            };
          }),
        };
      });

      toast.success('Anomaly reason documented');
    } catch (err: any) {
      toast.error(friendlyError(err));
    }
  };

  const plants = useMemo(() => [...new Set(rows.map(r => r.plant_name))].sort(), [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (plantFilter !== 'all' && r.plant_name !== plantFilter) return false;
    if (searchQ) {
      const q = searchQ.toLowerCase();
      return r.entity_name.toLowerCase().includes(q) || r.operator_username?.toLowerCase().includes(q) || false;
    }
    return true;
  }), [rows, plantFilter, searchQ]);

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['data-corrections-pending'] });
    qc.invalidateQueries({ queryKey: ['correction-inbox'] });
    qc.invalidateQueries({ queryKey: ['pending-readings-count'] });
    qc.invalidateQueries({ queryKey: ['correction-requests-pending'] });
  }, [qc]);

  const { data: corrReqs = [] } = useQuery({
    queryKey: ['correction-requests-pending'],
    queryFn: fetchCorrectionRequests,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const approveRequest = async (req: CorrectionRequest) => {
    // 1. Run cascade correction to apply proposed value
    const { error } = await (supabase.rpc('fn_cascade_reading_correction', {
      p_table:       req.source_table,
      p_row_id:      req.source_id,
      p_new_current: req.proposed_value,
      p_admin_id:    user?.id ?? null,
      p_reason:      'Approved correction request: ' + req.reason,
    }) as any);
    if (error) { toast.error(friendlyError(error)); return; }
    // 2. Mark request as approved (triggers operator notification).
    // .select('id') matters here: an UPDATE that RLS silently narrows to
    // zero matching rows returns { data: [], error: null } — identical to
    // a real success unless you check what actually came back. Without
    // this check, the row keeps re-appearing as "pending" on every refetch
    // with no visible reason why (see 20260723 migration's note that this
    // table's RLS was set up outside the migration history and was never
    // actually confirmed from code).
    const { data: resolvedRows, error: resolveErr } = await (supabase
      .from('correction_requests' as any)
      .update({ status: 'approved', resolved_by: user?.id, resolved_at: new Date().toISOString() })
      .eq('id', req.id)
      .select('id') as any);
    if (resolveErr) { toast.error(friendlyError(resolveErr)); return; }
    if (!resolvedRows?.length) {
      toast.error('Reading corrected, but the request could not be marked approved — you may not have permission to update it. It will keep showing here until that\u2019s fixed.');
      invalidate();
      return;
    }
    // 3. Close out any OTHER pending request for this same reading (e.g. a
    // second operator flagged it too) so it doesn't linger as a duplicate
    // approval prompt for a reading that's already been corrected.
    await supersedeOtherCorrectionRequests(
      req.source_table, req.source_id, user?.id,
      'Superseded — a duplicate correction request for this reading was already approved',
      req.id,
    );
    recent.add({
      label: `${tableLabel[req.source_table]} · ${req.reason}`,
      plantName: req.plant_name ?? '—',
      sourceTable: req.source_table,
      oldValue: req.original_value,
      newValue: req.proposed_value,
    });
    toast.success('Correction approved and applied');
    invalidate();
  };

  const rejectRequest = async (req: CorrectionRequest, resolutionNote: string) => {
    if (!resolutionNote.trim()) { toast.error('A reason is required to reject a correction request'); return; }
    // Revert to normal without changing value
    const { error: revertErr } = await (supabase
      .from(req.source_table as any).update({ norm_status: 'normal' }).eq('id', req.source_id) as any);
    if (revertErr) { toast.error(friendlyError(revertErr)); return; }
    // .select('id') for the same reason as approveRequest above: a silently
    // RLS-blocked update returns { data: [], error: null }, not an error —
    // without checking what actually came back, the request would keep
    // reappearing as pending with no indication anything went wrong.
    const { data: resolvedRows, error: resolveErr } = await (supabase
      .from('correction_requests' as any)
      .update({ status: 'rejected', resolved_by: user?.id, resolved_at: new Date().toISOString(), resolution_note: resolutionNote || null })
      .eq('id', req.id)
      .select('id') as any);
    if (resolveErr) { toast.error(friendlyError(resolveErr)); return; }
    if (!resolvedRows?.length) {
      toast.error('Could not mark this request as rejected — you may not have permission to update it.');
      invalidate();
      return;
    }
    // The reading was just confirmed as fine (norm_status back to 'normal'),
    // so any OTHER still-pending request against the same reading is moot too.
    await supersedeOtherCorrectionRequests(
      req.source_table, req.source_id, user?.id,
      'Superseded — the underlying reading was already resolved (a related request was rejected)',
      req.id,
    );
    toast.info('Correction request rejected — original value kept');
    invalidate();
  };

  const unlockReading = async (row: FlaggedRow) => {
    await (supabase.from(row.source_table as any)
      .update({ locked_at: null, locked_by: null })
      .eq('id', row.id) as any);
    toast.success(`${row.entity_name}: unlocked`);
    invalidate();
  };

  const resolveOne = async (row: FlaggedRow, decision: 'normal' | 'retracted') => {
    // Check if an anomaly reason or note was documented
    const hasReason = Boolean(
      row.anomaly_remark?.text ||
      row.edit_reason?.text ||
      customReasons[row.id]?.trim() ||
      notes[row.id]?.trim()
    );

    setBusy(p => ({ ...p, [row.id]: true }));
    // NOTE: .select('id') is required here, not cosmetic. Without it, a
    // silent RLS/lock mismatch returns { data: [], error: null } — same
    // failure mode approveRequest/rejectRequest already guard against above.
    // Skipping it means "approved" toasts fire even when nothing changed,
    // and the row reappears on next refetch with no visible explanation.
    const { data: updated, error } = await (supabase
      .from(row.source_table as any)
      .update({ norm_status: decision })
      .eq('id', row.id)
      .select('id') as any);

    if (error) {
      toast.error(friendlyError(error));
    } else if (!updated?.length) {
      toast.error(`${row.entity_name}: update didn't apply — check permissions or whether this reading is locked, then refresh.`);
      invalidate();
    } else {
      const resolvedNote = notes[row.id] || customReasons[row.id] || (decision === 'normal' ? 'Approved from corrections queue' : 'Rejected from corrections queue');
      await (supabase.from('reading_normalizations' as any).insert({
        source_table: row.source_table, source_id: row.id,
        action: decision === 'normal' ? 'normalize' : 'retract',
        original_value: row.current_reading,
        adjusted_value: decision === 'normal' ? row.current_reading : null,
        note: resolvedNote,
        performed_by: user?.id ?? null, performed_role: actorRole,
      }) as any);
      // This reading is no longer pending — close out any duplicate
      // correction_requests row for it too (see supersedeOtherCorrectionRequests).
      await supersedeOtherCorrectionRequests(
        row.source_table, row.id, user?.id,
        decision === 'normal'
          ? 'Superseded — reading approved directly from Pending Review'
          : 'Superseded — reading rejected directly from Pending Review',
      );
      if (decision === 'normal') {
        if (!hasReason && (row.flag_reason === 'spike' || row.is_backward || row.is_unchanged || row.flag_reason === 'needs_remark')) {
          toast.warning(`${row.entity_name}: approved with no documented reason/note`);
        } else {
          toast.success(`${row.entity_name}: approved`);
        }
      } else {
        toast.success(`${row.entity_name}: rejected`);
      }
      invalidate();
    }
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  const bulkResolve = async (decision: 'normal' | 'retracted') => {
    if (!selected.size) return;
    setBulkBusy(true);
    const targets = rows.filter(r => selected.has(r.id));
    const succeeded: FlaggedRow[] = [];
    const failed: FlaggedRow[] = [];
    for (const row of targets) {
      // Same .select('id') requirement as resolveOne — an unaffected row
      // must not be counted as succeeded just because there was no error.
      const { data: updated, error } = await (supabase
        .from(row.source_table as any)
        .update({ norm_status: decision })
        .eq('id', row.id)
        .select('id') as any);
      if (!error && updated?.length) succeeded.push(row);
      else failed.push(row);
    }
    if (succeeded.length) {
      await (supabase.from('reading_normalizations' as any).insert(
        succeeded.map(row => ({
          source_table: row.source_table, source_id: row.id,
          action: decision === 'normal' ? 'normalize' : 'retract',
          original_value: row.current_reading,
          note: `Bulk ${decision === 'normal' ? 'approval' : 'rejection'} (${targets.length} rows)`,
          performed_by: user?.id ?? null, performed_role: actorRole,
        }))
      ) as any);
      // Close out any duplicate correction_requests for each row actually
      // resolved — batched per source_table rather than one call per row.
      const bySourceTable = new Map<SourceTable, string[]>();
      for (const row of succeeded) {
        const ids = bySourceTable.get(row.source_table) ?? [];
        ids.push(row.id);
        bySourceTable.set(row.source_table, ids);
      }
      const note = decision === 'normal'
        ? 'Superseded — reading approved via bulk action from Pending Review'
        : 'Superseded — reading rejected via bulk action from Pending Review';
      const results = await Promise.all([...bySourceTable.entries()].map(([sourceTable, ids]) =>
        supabase.from('correction_requests' as any)
          .update({ status: 'rejected', resolved_by: user?.id ?? null, resolved_at: new Date().toISOString(), resolution_note: note })
          .eq('source_table', sourceTable)
          .eq('status', 'pending')
          .in('source_id', ids) as any,
      ));
      // Same class of "looks fine, quietly didn't happen" risk as
      // supersedeOtherCorrectionRequests above — this is a best-effort
      // cleanup step (the primary bulk approve/reject already succeeded
      // via reading_normalizations), so it shouldn't block the user, but a
      // failure here shouldn't vanish either.
      for (const r of results) {
        if ((r as any)?.error) console.error('bulkResolve correction_requests supersede failed:', (r as any).error);
      }
    }
    const ok = succeeded.length;
    if (ok) {
      if (decision === 'normal') {
        const withoutReasonCount = succeeded.filter(row => {
          const hasReason = Boolean(
            row.anomaly_remark?.text ||
            row.edit_reason?.text ||
            customReasons[row.id]?.trim() ||
            notes[row.id]?.trim()
          );
          return !hasReason && (row.flag_reason === 'spike' || row.is_backward || row.is_unchanged || row.flag_reason === 'needs_remark');
        }).length;
        if (withoutReasonCount > 0) {
          toast.warning(`${ok} of ${targets.length} readings approved (${withoutReasonCount} with no documented reason/note)`);
        } else {
          toast.success(`${ok} of ${targets.length} readings approved`);
        }
      } else {
        toast.success(`${ok} of ${targets.length} readings rejected`);
      }
    }
    if (failed.length) {
      toast.error(
        `${failed.length} row(s) didn't update — permission or lock issue: ${failed.map(f => f.entity_name).join(', ')}`,
      );
    }
    setSelected(new Set());
    setBulkBusy(false);
    invalidate();
  };

  if (isLoading) return <DataState loading />;
  if (error) return <DataState error={error} onRetry={refetch} />;

  return (
    <div className="space-y-3">
      {/* Filters + Bulk bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search locator or operator…" className="pl-8 h-8 text-xs" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        </div>
        <Select value={plantFilter} onValueChange={setPlantFilter}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plants</SelectItem>
            {plants.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}><RefreshCw className="h-3 w-3" /></Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <div className="flex gap-1.5 ml-auto">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-accent/40 text-accent hover:bg-accent-soft"
              disabled={bulkBusy} onClick={() => bulkResolve('normal')}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve all
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
              disabled={bulkBusy} onClick={() => bulkResolve('retracted')}>
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Reject all
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <RecentCorrectionsPanel items={recent.items} onClear={recent.clear} />

      {/* Item 8: Operator correction requests with quick-reason presets and visual diff */}
      {corrReqs.length > 0 && (
        <div className="space-y-2.5 pb-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">
                Operator Correction Requests
              </p>
              <Badge className="h-5 px-2 text-3xs font-bold bg-amber-500 text-white animate-pulse">
                {corrReqs.length} Awaiting Approval
              </Badge>
            </div>
            <span className="text-3xs text-muted-foreground">Action required by Manager or Admin</span>
          </div>

          <div className="grid gap-3">
            {corrReqs.map(req => {
              const diff = req.proposed_value - req.original_value;
              const isPositive = diff > 0;
              const hasDiff = diff !== 0;

              return (
                <Card key={req.id} className="p-4 border-amber-500/40 bg-amber-500/5 shadow-2xs space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground">{tableLabel[req.source_table]}</span>
                        <Badge variant="outline" className="text-3xs px-2 py-0 font-bold border-amber-500/40 bg-background">
                          {req.plant_name}
                        </Badge>
                        <span className="text-3xs px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          Operator Requested
                        </span>
                      </div>
                      <div className="text-3xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <span>Submitted by <strong className="text-foreground">{req.submitter_email}</strong></span>
                        <span>·</span>
                        <span>{fmtDt(req.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Side-by-side Visual Diff */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-2.5 rounded-lg bg-background/80 border border-border/60 text-xs">
                    <div>
                      <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Original Recorded</div>
                      <div className="font-mono font-bold text-sm text-destructive mt-0.5">{fmtNum(req.original_value)}</div>
                    </div>
                    <div>
                      <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                        <ArrowRight className="h-3 w-3 text-primary" /> Proposed New Value
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono font-bold text-sm text-accent">{fmtNum(req.proposed_value)}</span>
                        {hasDiff && (
                          <span className={cn('text-3xs font-mono font-bold px-1.5 py-0.2 rounded',
                            isPositive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400')}>
                            {isPositive ? `+${fmtNum(diff)}` : fmtNum(diff)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Operator Reason</div>
                      <div className="text-xs font-semibold text-foreground mt-0.5 leading-snug">{req.reason}</div>
                    </div>
                  </div>

                  {req.note && (
                    <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border/40 italic">
                      "{req.note}"
                    </div>
                  )}

                  {/* Action & Preset Rejection Reason Row */}
                  <div className="space-y-2 pt-1 border-t border-border/40">
                    <div className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Rejection explanation (required to reject)…"
                        value={reqNotes[req.id] ?? ''}
                        onChange={e => setReqNotes(p => ({ ...p, [req.id]: e.target.value }))}
                        className="h-8 text-xs flex-1 min-w-[200px] bg-background"
                      />
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs font-bold bg-accent text-accent-foreground hover:bg-accent/90"
                        onClick={() => approveRequest(req)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve &amp; Apply</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs font-bold border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={!reqNotes[req.id]?.trim()}
                        onClick={() => rejectRequest(req, reqNotes[req.id] ?? '')}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </Button>
                    </div>

                    {/* Quick preset reason chips */}
                    <div className="flex items-center gap-1.5 flex-wrap text-3xs">
                      <span className="text-muted-foreground font-semibold">Quick rejection presets:</span>
                      {[
                        'Verified accurate against field logbook',
                        'Exceeds plausibility threshold',
                        'Duplicate correction request',
                        'Requires meter replacement flow',
                      ].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
                          onClick={() => setReqNotes(p => ({ ...p, [req.id]: preset }))}
                        >
                          + {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {truncated && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warn-soft border border-warn/30 rounded-lg text-xs text-warn">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          One or more tables have more than {PENDING_FETCH_LIMIT_PER_TABLE.toLocaleString()} pending readings —
          showing the most recent {PENDING_FETCH_LIMIT_PER_TABLE.toLocaleString()} per table. Use the plant filter
          to narrow this down, or work through the newest ones first.
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-accent" />
          {rows.length === 0 ? 'No readings pending review — all clear.' : 'No results match the current filters.'}
        </Card>
      ) : (
        <div className="space-y-2.5">
          {/* Section Header for Quarantined Original Readings */}
          <div className="flex items-center justify-between px-1 pt-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">
                Flagged Field Readings (Anomaly Quarantine)
              </p>
              <Badge variant="outline" className="h-5 px-2 text-3xs font-semibold">
                {filtered.length} Quarantined
              </Badge>
            </div>
            <span className="text-3xs text-muted-foreground">Original submissions held by validation guards for supervisor review</span>
          </div>

          {/* Select-all header */}
          <div className="flex items-center gap-2 px-1">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} className="h-4 w-4" />
            <span className="text-xs text-muted-foreground">{filtered.length} reading{filtered.length !== 1 ? 's' : ''} pending</span>
          </div>

          {filtered.map(row => {
            const isBack = !!row.is_backward;
            const isUnchanged = !!row.is_unchanged;
            const isBusy = busy[row.id] ?? false;
            const isExp = expanded === row.id;
            // Rough entity + plant IDs for chain context — we pass plant_id from the row
            // The row doesn't carry entityId directly; we use id as proxy for chain lookup
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
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleOne(row.id)} className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Header row */}
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
                            onSaveReason={handleSaveReason}
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
                      <button onClick={() => setExpanded(isExp ? null : row.id)}
                        aria-label={isExp ? 'Collapse details' : 'Expand details'}
                        className="text-muted-foreground hover:text-foreground shrink-0 p-0.5">
                        {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Meter values & Visual Diff */}
                    {row.pre_edit_value != null && row.pre_edit_value !== row.current_reading ? (
                      <div className="space-y-2">
                        {/* High-visibility Before vs Corrected comparison banner */}
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
                              <ArrowRight className="h-3 w-3 text-accent" /> Corrected Reading (Current)
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono font-bold text-sm text-accent">{fmtNum(row.current_reading)}</span>
                              <span className={cn('text-3xs font-mono font-bold px-1.5 py-0.5 rounded',
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

                        {/* 4-column breakdown grid */}
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
                      /* Standard meter values grid */
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

                    {/* Compact single-line Operator remark or edit reason strip */}
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

                    {/* Chain context (item 4) */}
                    {isExp && (
                      <ChainContext
                        focusedId={row.id}
                        sourceTable={row.source_table}
                        entityId={row.entity_id ?? row.id}
                        plantId={row.plant_id ?? ''}
                      />
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Optional note…"
                        value={notes[row.id] ?? ''}
                        onChange={e => setNotes(p => ({ ...p, [row.id]: e.target.value }))}
                        className="h-7 text-xs flex-1 min-w-[120px]"
                        disabled={isBusy}
                      />
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary-soft"
                        disabled={isBusy} onClick={() => resolveOne(row, 'normal')}>
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Approve
                      </Button>
                      {isBack && (
                        <Button size="sm" variant="outline"
                          className="h-7 gap-1 text-xs border-accent/40 text-accent hover:bg-accent-soft"
                          disabled={isBusy} onClick={() => setRolloverRow(row)}>
                          <Gauge className="h-3 w-3" />
                          Mark as rollover
                        </Button>
                      )}
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-warn/40 text-warn hover:bg-warn-soft"
                        disabled={isBusy} onClick={() => setEditRow(row)}>
                        <Pencil className="h-3 w-3" />
                        Edit value
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
                        disabled={isBusy} onClick={() => resolveOne(row, 'retracted')}>
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        Reject
                      </Button>
                      {/* Item 9: unlock button — only shows after supervisor approval locks the row */}
                      {(row as any).locked_at && (
                        <Button size="sm" variant="outline"
                          className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary-soft"
                          disabled={isBusy} onClick={() => unlockReading(row)}>
                          🔓 Unlock
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editRow && (
        <EditValueModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={(result) => {
            if (result) {
              recent.add({
                label: editRow.entity_name,
                plantName: editRow.plant_name,
                sourceTable: editRow.source_table,
                oldValue: result.oldValue,
                newValue: result.newValue,
              });
            }
            setEditRow(null);
            invalidate();
          }}
        />
      )}
      {rolloverRow && (
        <MarkRolloverModal
          row={rolloverRow}
          onClose={() => setRolloverRow(null)}
          onDone={() => { setRolloverRow(null); invalidate(); }}
        />
      )}
    </div>
  );
}