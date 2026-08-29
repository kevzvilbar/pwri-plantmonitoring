/**
 * ro-trains/TrainLogModal.tsx
 *
 * Per-train operator history dialog — shows paginated RO and Pre-Treatment
 * readings with edit/correction-request actions.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */
import { useState, useMemo, useEffect, useRef, type Ref } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Loader2, BarChart2, Download, Upload, Pencil, MessageSquarePlus, Trash2,
  Calendar, ChevronLeft, ChevronRight, PowerOff, Wrench, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { cn } from '@/lib/utils';
import { canEditEntry, recalculateTrainDeltas, logReadingEdit } from './helpers';
import { ReplaceTrainMeterDialog } from './ReplaceTrainMeterDialog';
import { EditRoReadingDialog } from './EditRoReadingDialog';
import { EditPretreatReadingDialog } from './EditPretreatReadingDialog';
import { ImportROReadingsDialog } from './ImportROReadingsDialog';
import { ImportPretreatReadingsDialog } from './ImportPretreatReadingsDialog';
import {
  buildStatusTimeline, nonRunningSegmentsInRange, mergeSegmentsForDisplay, formatSegmentDuration,
  reconcileOngoingSegmentWithReadings, flagConflictingClosedSegments, type StatusSegment,
} from '@/lib/trainStatusTimeline';
import {
  detectHourlyGaps, mergeGapsForDisplay, type FlaggedGap, type GapReason,
} from '@/lib/hourlyGapDetection';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';

interface TrainLogModalProps {
  trainId: string;
  trainLabel: string;
  /** Required for CSV import dialogs. Passed from TrainCard (train.plant_id). */
  plantId: string;
  onClose: () => void;
  /** Deep-link support (Dashboard alert → "Open log" instead of the input form). */
  initialTab?: 'ro' | 'pretreat';
  /** A specific reading id to jump to, scroll into view, and highlight. */
  highlightId?: string;
}

/**
 * A single collapsed row spanning an Offline/Maintenance stretch, in place
 * of the individual (mostly-empty) reading rows that stretch used to leave
 * behind — or, once useTrainAutoOffline's auto-flip is the cause, in place
 * of nothing at all, since that path never wrote anything a human could
 * read here before train_status_log existed. colSpan is intentionally
 * larger than either tab's real column count — browsers clamp an
 * oversized colSpan to the table's actual width, so one constant safely
 * spans both the RO and Pre-Treatment tables without tracking their
 * column counts separately.
 */
function TrainStatusBannerRow({ segment }: { segment: StatusSegment }) {
  const isMaintenance = segment.status === 'Maintenance';
  const Icon = isMaintenance ? Wrench : PowerOff;
  const label = isMaintenance ? 'Maintenance' : 'Offline';
  const fmtPoint = (iso: string) => format(new Date(iso), 'MMM d, HH:mm');
  return (
    <tr className={cn('border-t', isMaintenance ? 'bg-warn-soft/60' : 'bg-danger-soft/60')}>
      <td colSpan={30} className="px-3 py-2">
        <div className={cn('flex items-center gap-2 text-xs font-medium flex-wrap', isMaintenance ? 'text-warn' : 'text-danger')}>
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            {label} {fmtPoint(segment.startAt)} → {segment.endAt ? fmtPoint(segment.endAt) : 'ongoing'}
          </span>
          <span className="text-muted-foreground font-normal whitespace-nowrap">
            · {formatSegmentDuration(segment.startAt, segment.endAt)}
          </span>
          {segment.reason && (
            <span className="text-muted-foreground font-normal truncate max-w-[320px]" title={segment.reason}>
              · {segment.reason}
            </span>
          )}
          {segment.inferredEnd && (
            <span
              className="text-muted-foreground font-normal whitespace-nowrap"
              title="No Back Online At was ever submitted for this train — this end time is inferred from the next real reading on record, not a confirmed closure."
            >
              · closed by later reading, not confirmed
            </span>
          )}
          {segment.hasConflictingReadings && (
            <span
              className="inline-flex items-center gap-1 text-warn font-normal whitespace-nowrap"
              title="One or more readings are logged with timestamps inside this window, despite this segment having a confirmed close event. Check train_status_log for a stray or mistimed entry — this banner's range is shown as recorded, not adjusted."
            >
              <AlertTriangle className="h-3 w-3" />
              readings exist in this window — check status log
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * One collapsed row for a flagged unexplained gap. Unresolved: an amber
 * "N hrs missing — log why" button that opens ReasonDialog. Resolved: the
 * same span shown muted with its logged reason, still clickable to re-log
 * (ReasonDialog itself has no prefill, so re-opening starts blank — same
 * behavior as the well/locator daily version this mirrors).
 */
function GapBadgeRow({ gap, existingReason, onClick, highlighted, rowRef }: {
  gap: FlaggedGap; existingReason: GapReason | null; onClick: () => void;
  highlighted?: boolean; rowRef?: Ref<HTMLTableRowElement>;
}) {
  const label = `${gap.missedHours} hr${gap.missedHours === 1 ? '' : 's'} missing`;
  const timeRange = `${format(new Date(gap.gapStartAt), 'HH:mm')}–${format(new Date(new Date(gap.gapEndAt).getTime() - 1), 'HH:mm')}`;
  return (
    <tr
      ref={rowRef}
      className={cn(
        'border-t transition-colors',
        highlighted ? 'bg-danger-soft ring-1 ring-inset ring-danger' : existingReason ? 'bg-muted/40' : 'bg-warn-soft/60',
      )}
    >
      <td colSpan={30} className="px-3 py-2">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'flex items-center gap-2 text-xs font-medium hover:underline',
            existingReason ? 'text-muted-foreground' : 'text-warn',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{label} ({timeRange})</span>
          {existingReason ? (
            <span className="font-normal">
              — {reasonCategoryLabel(existingReason.reasonCategory)}
              {existingReason.reasonDetail ? `: ${existingReason.reasonDetail}` : ''}
            </span>
          ) : (
            <span className="font-normal">— log why</span>
          )}
        </button>
      </td>
    </tr>
  );
}

export function TrainLogModal({ trainId, trainLabel, plantId, onClose, initialTab, highlightId }: TrainLogModalProps) {
  const qc = useQueryClient();
  const { isManager, isDataAnalyst, activeOperator, user } = useAuth();
  // Managers, Admins, and Data Analysts can edit any reading at any time;
  // Operators are limited to their own entries, no time cutoff (RO Train /
  // Pretreatment reading edits are the one exception to EDIT_WINDOW_HOURS
  // — see helpers.ts canEditEntry). isManager alone used to gate this, which
  // excluded Data Analysts — broadened per the pretreatment-edit request.
  const hasFullAccess = isManager || isDataAnalyst;
  const [page, setPage]               = useState(0);
  const PAGE_SIZE = 20;
  const [togglingId, setTogglingId]   = useState<string | null>(null);
  // Reading id currently going through the granular "Replace Train Meter"
  // dialog. Checking Repl. opens this; unchecking still clears all three
  // granular flags (+ the shared flag, kept in sync by a DB trigger) directly.
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);
  const [logTab, setLogTab]           = useState<'ro' | 'pretreat'>(initialTab ?? 'ro');
  const [editingRoRow, setEditingRoRow]           = useState<any | null>(null);
  const [editingPretreatRow, setEditingPretreatRow] = useState<any | null>(null);
  const [correctionTarget, setCorrectionTarget]   = useState<CorrectionTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ type: 'ro' | 'pretreat'; row: any } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Piece 3+4: gap-scoped import dialogs
  const [showImportRO, setShowImportRO]           = useState(false);
  const [showImportPretreat, setShowImportPretreat] = useState(false);

  const todayStr  = format(new Date(), 'yyyy-MM-dd');
  const thirtyAgo = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
  const ninetyAgo = format(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom]       = useState(highlightId ? ninetyAgo : thirtyAgo);
  const [dateTo, setDateTo]           = useState(todayStr);
  const [rangePreset, setRangePreset] = useState<'7' | '30' | '90' | 'custom'>(highlightId ? '90' : '30');

  const applyPreset = (p: '7' | '30' | '90') => {
    setDateFrom(format(new Date(Date.now() - parseInt(p) * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
    setDateTo(todayStr); setRangePreset(p); setPage(0);
  };

  const untilNextDay = dateTo ? (() => {
    const [y, m, d] = dateTo.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  })() : null;

  const queryKey = ['train-log-overview', trainId, dateFrom, untilNextDay];
  const { data: logs = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        // norm_status is included in every tier (not just ALL_COLS) even
        // though it's not rendered anywhere in this modal: canEditEntry()
        // (helpers.tsx) uses it to block self-editing a reading that's
        // currently flagged and sitting in Data Corrections' pending-review
        // queue. Without it here, every row this modal ever sees has
        // norm_status === undefined, so that lockdown silently never
        // engages for RO Train readings specifically -- an operator could
        // self-edit a flagged reading mid-review via this modal (or the
        // EditRoReadingDialog it opens, which trusts this same row object)
        // even though the exact same guard already works correctly for
        // well/locator/product readings elsewhere in the app.
        const ALL_COLS = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'feed_ph','permeate_ph','reject_ph','temperature_c','turbidity_ntu','recovery_pct','chlorine_residual_mg_l',
          'feed_meter','feed_meter_prev','feed_meter_delta',
          'permeate_meter','permeate_meter_prev','permeate_meter_delta',
          'reject_meter','reject_meter_prev','reject_meter_delta',
          'is_meter_replacement','is_permeate_meter_replacement','is_reject_meter_replacement','remarks','incomplete_reason','norm_status'];
        const TIER2 = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'feed_ph','permeate_ph','reject_ph','temperature_c','turbidity_ntu','recovery_pct','chlorine_residual_mg_l','remarks',
          'feed_meter','permeate_meter','permeate_meter_delta','reject_meter','is_meter_replacement','is_reject_meter_replacement','incomplete_reason','norm_status'];
        const TIER3 = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'feed_ph','permeate_ph','reject_ph','temperature_c','turbidity_ntu','recovery_pct','remarks','permeate_meter','incomplete_reason','norm_status'];
        const TIER4 = ['id','reading_datetime','recorded_by','created_at','plant_id','permeate_flow','feed_flow','reject_flow',
          'feed_pressure_psi','reject_pressure_psi','suction_pressure_psi','feed_tds','permeate_tds','reject_tds',
          'temperature_c','recovery_pct','permeate_meter','incomplete_reason','norm_status'];

        const buildQ = (cols: string[]) => {
          let q = (supabase.from('ro_train_readings' as any) as any)
            .select(cols.join(',')).eq('train_id', trainId)
            .order('reading_datetime', { ascending: false }).limit(2000);
          if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
          if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
          return q;
        };

        let readings: any[] | null = null;
        for (const tier of [ALL_COLS, TIER2, TIER3, TIER4]) {
          const { data, error } = await buildQ(tier);
          if (!error) { readings = data ?? []; break; }
          const isMissingCol = error.message.includes('column') || error.message.includes('does not exist');
          if (!isMissingCol) break;
        }
        if (!readings?.length) return [];

        // Compute client-side deltas and build profile map
        const ascReadings = [...readings].reverse();
        const lastMeter    = new Map<string, number>();
        const lastRejMeter = new Map<string, number>();
        ascReadings.forEach((r: any) => {
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(trainId);
            r._computed_delta = prev != null ? Math.max(0, +r.permeate_meter - prev) : null;
            lastMeter.set(trainId, +r.permeate_meter);
          }
          if (r.reject_meter != null) {
            // Only the granular flag zeros the reject delta.  Pre-migration rows
            // with is_meter_replacement=true but no granular flag were permeate-
            // only replacements — don't zero reject there.
            const isRejRepl = !!(r.is_reject_meter_replacement);
            const prev = lastRejMeter.get(trainId);
            r._computed_rej_delta = isRejRepl
              ? 0
              : prev != null ? Math.max(0, +r.reject_meter - prev) : null;
            // Always advance the baseline so subsequent rows compute correctly.
            lastRejMeter.set(trainId, +r.reject_meter);
          }
        });

        const uids = [...new Set(readings.map((r: any) => r.recorded_by).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          for (const table of ['user_profiles', 'profiles']) {
            const { data: pdata, error: perr } = await (supabase.from(table as any) as any)
              .select('id, first_name, last_name, username').in('id', uids);
            if (!perr && pdata?.length) {
              profileMap = Object.fromEntries((pdata as any[]).map((p: any) => {
                const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
                return [p.id, name || null];
              }).filter(([, n]) => n));
              if (Object.keys(profileMap).length) break;
            }
          }
        }
        return readings.map((r: any) => ({
          ...r,
          _operatorName: profileMap[r.recorded_by] ?? (r.recorded_by ? `UID:${String(r.recorded_by).slice(0, 8)}` : 'Unknown'),
        }));
      } catch { return []; }
    },
    staleTime: 30_000,
  });

  const preQueryKey = ['pretreat-log-modal', trainId, dateFrom, untilNextDay];
  const { data: preLogs = [], isLoading: preLoading } = useQuery({
    queryKey: preQueryKey,
    queryFn: async () => {
      try {
        let q = (supabase.from('ro_pretreatment_readings' as any) as any)
          .select('id,reading_datetime,recorded_by,created_at,plant_id,hpp_target_pressure_psi,bag_filters_changed,afm_units,mmf_readings,booster_pumps,filter_housings,cartridge_filter_housings,remarks,incomplete_reason')
          .eq('train_id', trainId).order('reading_datetime', { ascending: false }).limit(2000);
        if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
        if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
        const { data, error } = await q;
        if (error) return [];
        const uids = [...new Set((data ?? []).map((r: any) => r.recorded_by).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          for (const table of ['user_profiles', 'profiles']) {
            const { data: pd, error: pe } = await (supabase.from(table as any) as any)
              .select('id, first_name, last_name, username').in('id', uids);
            if (!pe && pd?.length) {
              profileMap = Object.fromEntries((pd as any[]).map((p: any) => {
                const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
                return [p.id, name || null];
              }).filter(([, n]) => n));
              if (Object.keys(profileMap).length) break;
            }
          }
        }
        return (data ?? []).map((r: any) => ({
          ...r,
          _operatorName: profileMap[r.recorded_by] ?? (r.recorded_by ? `UID:${String(r.recorded_by).slice(0, 8)}` : 'Unknown'),
        }));
      } catch { return []; }
    },
    staleTime: 30_000,
  });

  // Fetched unbounded by date (not scoped to dateFrom/untilNextDay) — a
  // segment overlapping the start of the visible range needs to know the
  // status *before* the range began, and per-train row volume here is a
  // handful of transitions total, not readings-scale. Feeds the shutdown /
  // maintenance banners rendered in both tabs below.
  const { data: statusLogRows = [] } = useQuery({
    queryKey: ['train-status-log', trainId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('train_status_log')
        .select('status,reason,confirmed_at')
        .eq('train_id', trainId)
        .order('confirmed_at', { ascending: true });
      if (error) return [];
      return (data ?? []).map((r) => ({ status: r.status, reason: r.reason, confirmed_at: r.confirmed_at }));
    },
    staleTime: 30_000,
  });

  const statusTimeline = useMemo(() => buildStatusTimeline(statusLogRows), [statusLogRows]);
  // Display-only fixup: a still-"ongoing" segment with a real RO or
  // Pre-Treatment reading logged after it started (typically a CSV
  // backfill — see reconcileOngoingSegmentWithReadings' own doc comment)
  // gets clipped to that reading's time instead of floating above it as
  // "ongoing" forever. Feeds only bannerSegments below, not statusTimeline
  // itself — roGaps/preGaps' hourly-gap detection further down deliberately
  // keeps using the uncapped timeline, since train_status_log genuinely
  // never closed this segment and that's a separate signal from "is there a
  // banner to draw".
  const bannerSegments = useMemo(() => {
    if (!dateFrom || !untilNextDay) return [];
    const inRange = nonRunningSegmentsInRange(statusTimeline, `${dateFrom}T00:00:00`, `${untilNextDay}T00:00:00`);
    const readingTimestamps = [...logs, ...preLogs].map((r: any) => r.reading_datetime);
    const latestReadingAt = readingTimestamps.reduce<string | null>((latest, at) => {
      if (!at) return latest;
      if (!latest) return at;
      return new Date(at).getTime() > new Date(latest).getTime() ? at : latest;
    }, null);
    const reconciled = reconcileOngoingSegmentWithReadings(inRange, latestReadingAt);
    // reconcileOngoingSegmentWithReadings only ever fixes the one still-open
    // segment. flagConflictingClosedSegments catches the sibling case — a
    // segment that DOES have a confirmed close but still disagrees with
    // readings sitting inside it (stray status_log row, wrong-timestamp
    // close, etc.) — by annotating rather than clipping, since a confirmed
    // closure shouldn't be silently overridden by a reading's timestamp.
    return flagConflictingClosedSegments(reconciled, readingTimestamps);
  }, [statusTimeline, dateFrom, untilNextDay, logs, preLogs]);

  // Already-logged reasons for flagged gaps, keyed by gap_start_at — same
  // low-volume-per-train reasoning as statusLogRows above: cheaper to fetch
  // this train's full history once than to refetch per date-range change.
  const { data: gapReasonRows = [] } = useQuery({
    queryKey: ['ro-train-data-gaps', trainId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_train_data_gaps' as any)
        .select('id,source_table,gap_start_at,reason_category,reason_detail')
        .eq('train_id', trainId);
      if (error) return [];
      return (data ?? []) as any[];
    },
    staleTime: 15_000,
  });
  const gapReasonsBySourceTable = useMemo(() => {
    const byTable: Record<string, Map<string, GapReason>> = {
      ro_train_readings: new Map(), ro_pretreatment_readings: new Map(),
    };
    for (const row of gapReasonRows) {
      byTable[row.source_table]?.set(row.gap_start_at, {
        reasonCategory: row.reason_category, reasonDetail: row.reason_detail,
      });
    }
    return byTable;
  }, [gapReasonRows]);

  const roGaps = useMemo(() => {
    if (!dateFrom || !untilNextDay) return [];
    return detectHourlyGaps({
      readingTimestamps: logs.map((r: any) => r.reading_datetime),
      statusTimeline,
      rangeStart: new Date(`${dateFrom}T00:00:00`),
      rangeEnd: new Date(`${untilNextDay}T00:00:00`),
    });
  }, [logs, statusTimeline, dateFrom, untilNextDay]);
  const preGaps = useMemo(() => {
    if (!dateFrom || !untilNextDay) return [];
    return detectHourlyGaps({
      readingTimestamps: preLogs.map((r: any) => r.reading_datetime),
      statusTimeline,
      rangeStart: new Date(`${dateFrom}T00:00:00`),
      rangeEnd: new Date(`${untilNextDay}T00:00:00`),
    });
  }, [preLogs, statusTimeline, dateFrom, untilNextDay]);

  const [gapDialogTarget, setGapDialogTarget] = useState<{
    gap: FlaggedGap; sourceTable: 'ro_train_readings' | 'ro_pretreatment_readings';
  } | null>(null);
  const [gapDialogBusy, setGapDialogBusy] = useState(false);

  const submitGapReason = async (category: string, detail: string) => {
    if (!gapDialogTarget) return;
    setGapDialogBusy(true);
    try {
      const { error } = await supabase.from('ro_train_data_gaps' as any).upsert({
        train_id: trainId,
        plant_id: plantId,
        source_table: gapDialogTarget.sourceTable,
        gap_start_at: gapDialogTarget.gap.gapStartAt,
        gap_end_at: gapDialogTarget.gap.gapEndAt,
        missed_hours: gapDialogTarget.gap.missedHours,
        reason_category: category,
        reason_detail: detail || null,
        logged_by: activeOperator?.id ?? null,
        logged_at: new Date().toISOString(),
      }, { onConflict: 'train_id,source_table,gap_start_at' });
      if (error) { toast.error(friendlyError(error)); return; }
      qc.invalidateQueries({ queryKey: ['ro-train-data-gaps', trainId] });
      toast.success('Reason logged');
      setGapDialogTarget(null);
    } finally {
      setGapDialogBusy(false);
    }
  };

  const toggleMeterReplacement = async (r: any) => {
    if (!isManager) return;
    const next = !r.is_meter_replacement;
    if (next) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    const { error } = await (supabase.from('ro_train_readings' as any) as any)
      .update({
        is_meter_replacement: false,
        is_feed_meter_replacement: false,
        is_permeate_meter_replacement: false,
        is_reject_meter_replacement: false,
      }).eq('id', r.id);
    setTogglingId(null);
    if (error) { toast.error('is_meter_replacement column missing — run migration'); return; }
    await recalculateTrainDeltas(trainId);
    toast.success('Replacement flag removed');
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['ro-overview'] });
  };

  const actorLabel = () =>
    `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
    || activeOperator?.username || null;

  const doDeleteReading = async () => {
    if (!pendingDelete) return;
    const { type, row } = pendingDelete;
    if (!canEditEntry(row, hasFullAccess, activeOperator?.id, true)) {
      toast.error('You can only delete your own entries.');
      setPendingDelete(null);
      return;
    }
    setDeletingId(row.id);
    const table = type === 'ro' ? 'ro_train_readings' : 'ro_pretreatment_readings';
    try {
      // .select() is required here, not cosmetic: Supabase/PostgREST does NOT
      // error when RLS silently matches 0 rows (e.g. a manager whose
      // plant_assignments don't cover this row's plant) — .delete() alone
      // resolves with { error: null, data: null } either way, so without
      // .select() a blocked delete looks identical to a successful one and
      // we'd show "Reading deleted" while the row is still there. This is
      // the exact failure mode already hit once for blending_events (see
      // 20260729_blending_events_meter_columns.sql) — guarding it here too.
      const { data, error } = await (supabase.from(table as any) as any)
        .delete().eq('id', row.id).select('id');
      if (error) { toast.error(friendlyError(error)); return; }
      if (!data || data.length === 0) {
        console.error('[doDeleteReading] delete matched 0 rows', { table, id: row.id });
        toast.error("Delete didn't go through — you may not have permission to remove this entry. No changes were made.");
        return;
      }
      if (type === 'ro') await recalculateTrainDeltas(trainId);
      await logReadingEdit({
        table_name: table,
        record_id: row.id,
        plant_id: row.plant_id ?? plantId ?? null,
        action: 'delete',
        actor_user_id: activeOperator?.id ?? null,
        actor_label: actorLabel(),
      });
      toast.success('Reading deleted');
    } catch (err) {
      console.error('[doDeleteReading] unexpected error', err);
      toast.error('Something went wrong deleting this reading. Please try again.');
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: type === 'ro' ? queryKey : preQueryKey });
      qc.invalidateQueries({ queryKey: ['ro-overview'] });
    }
  };

  const logsWithMeterFlow = useMemo(() => {
    return logs.map((r: any, i: number) => {
      const delta = r._computed_delta ?? r.permeate_meter_delta;
      if (delta == null || r.is_meter_replacement) return { ...r, _perm_flow_meter: null };
      const nextR = logs[i + 1];
      if (!nextR?.reading_datetime || !r.reading_datetime) return { ...r, _perm_flow_meter: null };
      const durHr = (new Date(r.reading_datetime).getTime() - new Date(nextR.reading_datetime).getTime()) / 3_600_000;
      if (durHr <= 0) return { ...r, _perm_flow_meter: null };
      return { ...r, _perm_flow_meter: +(delta / durHr).toFixed(2) };
    });
  }, [logs]);

  // Banner segments are train-wide (Offline/Maintenance locks both tabs
  // equally), so the same bannerSegments feed both merges below — RO and
  // Pre-Treatment just interleave them into their own reading list.
  // logsWithMeterFlow/preLogs are computed from the raw readings only (not
  // the merged list) so a banner can never leak into the flow-rate/delta
  // math — that math needs the literal next *reading*, not a banner.
  const roItemsWithBanners = useMemo(
    () => mergeSegmentsForDisplay(logsWithMeterFlow, bannerSegments, (r: any) => r.reading_datetime),
    [logsWithMeterFlow, bannerSegments],
  );
  const preItemsWithBanners = useMemo(
    () => mergeSegmentsForDisplay(preLogs, bannerSegments, (r: any) => r.reading_datetime),
    [preLogs, bannerSegments],
  );
  const roItems = useMemo(
    () => mergeGapsForDisplay(roItemsWithBanners, roGaps, gapReasonsBySourceTable.ro_train_readings, (r: any) => r.reading_datetime),
    [roItemsWithBanners, roGaps, gapReasonsBySourceTable],
  );
  const preItems = useMemo(
    () => mergeGapsForDisplay(preItemsWithBanners, preGaps, gapReasonsBySourceTable.ro_pretreatment_readings, (r: any) => r.reading_datetime),
    [preItemsWithBanners, preGaps, gapReasonsBySourceTable],
  );
  const pageRoItems = roItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Deep-link highlight: jump to whichever page contains highlightId ──────
  // Indexed against roItems/preItems (not the raw logs/preLogs) so a banner
  // occupying a slot ahead of the target reading doesn't shift it onto the
  // wrong page. highlightId doubles as two different targets depending on
  // its shape: a bare UUID highlights a reading row (existing behavior);
  // a 'gap:<gapStartAt ISO>' string highlights a flagged-gap badge instead
  // — used by the dashboard's hourly-gap alert (useTrainHourlyGaps.ts) to
  // deep-link straight to the specific unresolved span, not just the train.
  const highlightGapStartAt = highlightId?.startsWith('gap:') ? highlightId.slice(4) : null;
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const [highlightJumped, setHighlightJumped] = useState(false);
  useEffect(() => {
    if (!highlightId || highlightJumped) return;
    const source = logTab === 'ro' ? roItems : preItems;
    if (!source.length) return; // still loading — wait for the next run
    const idx = highlightGapStartAt
      ? source.findIndex((item) => item.kind === 'gap' && item.gap.gapStartAt === highlightGapStartAt)
      : source.findIndex((item) => item.kind === 'reading' && (item.row as any).id === highlightId);
    if (idx === -1) { setHighlightJumped(true); return; } // not in range even at 90d — give up quietly
    setPage(Math.floor(idx / PAGE_SIZE));
    setHighlightJumped(true);
  }, [highlightId, highlightGapStartAt, highlightJumped, logTab, roItems, preItems]);
  useEffect(() => {
    if (highlightRowRef.current) highlightRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [page, highlightJumped]);

  const fmtVal = (v: any, unit = '') =>
    v != null
      ? <span>{Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}<span className="text-muted-foreground/60 ml-0.5 text-2xs">{unit}</span></span>
      : <span className="text-muted-foreground/30">—</span>;

  const exportCSV = () => {
    if (!logs.length) { toast.error('No logs to export'); return; }
    const headers = ['Date/Time','Operator','Repl.','Perm Flow','Feed Flow','Rej Flow','Feed Press','Rej Press','Suction',
      'Feed TDS','Perm TDS','Rej TDS','Temp','Turbidity (NTU)','Feed pH','Perm pH','Cl Residual (mg/L)',
      'Recovery','Feed Meter','Perm Meter','Δ Perm m³','Rej Meter','Δ Rej m³','Remarks'];
    const rows2 = logs.map((r: any) => [
      r.reading_datetime ? format(new Date(r.reading_datetime), 'yyyy-MM-dd HH:mm') : '',
      r._operatorName ?? 'Unknown', r.is_meter_replacement ? 'YES' : '',
      r.permeate_flow ?? '', r.feed_flow ?? '', r.reject_flow ?? '',
      r.feed_pressure_psi ?? '', r.reject_pressure_psi ?? '', r.suction_pressure_psi ?? '',
      r.feed_tds ?? '', r.permeate_tds ?? '', r.reject_tds ?? '',
      r.temperature_c ?? '', r.turbidity_ntu ?? '', r.feed_ph ?? '', r.permeate_ph ?? '',
      r.chlorine_residual_mg_l ?? '', r.recovery_pct ?? '',
      r.feed_meter ?? '', r.permeate_meter ?? '', r._computed_delta ?? r.permeate_meter_delta ?? '',
      r.reject_meter ?? '', r._computed_rej_delta ?? r.reject_meter_delta ?? '', r.remarks ?? '',
    ].map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...rows2].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${trainLabel.replace(/\s+/g, '_')}_log.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Log exported');
  };

  const activeTotal = logTab === 'ro' ? roItems.length : preItems.length;
  const totalPages  = Math.ceil(activeTotal / PAGE_SIZE);

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent
          className="max-w-[95vw] w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
          onInteractOutside={(e) => {
            // Every nested dialog rendered below (ReplaceTrainMeterDialog,
            // CorrectionRequestDialog, the two Import dialogs, plus the two
            // row-edit dialogs) is itself a Radix Dialog.Portal — its content
            // mounts as a *sibling* of this DialogContent's node, not a
            // descendant. So a pointerdown inside any of them is, from this
            // outer layer's point of view, "outside," and would otherwise
            // call onClose() here and unmount this whole modal (and the
            // nested dialog with it) before the user can finish using it.
            // Must guard on every nested-dialog state, not just the two
            // row-edit ones this check used to cover.
            if (editingRoRow || editingPretreatRow || replaceReadingId || correctionTarget || showImportRO || showImportPretreat || pendingDelete) {
              e.preventDefault();
              return;
            }
            onClose();
          }}
        >
          <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
            <div className="min-w-0">
              <div className="text-base font-semibold flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">Operator Log — {trainLabel}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {logTab === 'ro'
                  ? `All RO train readings · ${isManager ? 'Click orange checkbox to flag meter replacement' : 'Managers can flag meter replacements'}`
                  : 'Pre-Treatment records — AFM/MMF, Booster Pumps, Filter Housings, HPP'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mr-8">
              {/* Piece 3: Import RO CSV — only shown on the RO tab */}
              {logTab === 'ro' && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 px-2.5 text-xs gap-1 text-primary border-primary hover:bg-primary-soft"
                  onClick={() => setShowImportRO(true)}
                >
                  <Upload className="h-3 w-3" /><span className="hidden sm:inline">Import RO CSV</span>
                </Button>
              )}
              {/* Piece 4: Import Pre-Treatment CSV — only shown on the Pre-Treatment tab */}
              {logTab === 'pretreat' && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 px-2.5 text-xs gap-1 text-primary border-primary hover:bg-primary-soft"
                  onClick={() => setShowImportPretreat(true)}
                >
                  <Upload className="h-3 w-3" /><span className="hidden sm:inline">Import Pre-Treatment CSV</span>
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={exportCSV}>
                <Download className="h-3 w-3" /><span className="hidden sm:inline">Export CSV</span>
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 shrink-0 flex-wrap">
            <div className="flex rounded-full border border-border overflow-hidden text-xs font-semibold mr-1">
              {(['ro', 'pretreat'] as const).map(tab => (
                <button key={tab} onClick={() => { setLogTab(tab); setPage(0); }}
                  className={cn('px-3 py-1 transition-colors',
                    logTab === tab ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
                  {tab === 'ro' ? 'RO' : 'Pre-Treatment'}
                </button>
              ))}
            </div>
            {(['7', '30', '90'] as const).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={cn('h-6 px-2 rounded text-xs font-medium border transition-colors',
                  rangePreset === p ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input text-muted-foreground hover:text-foreground')}>
                {p}d
              </button>
            ))}
            <input type="date" value={dateFrom} max={dateTo || todayStr}
              onChange={e => { setDateFrom(e.target.value); setRangePreset('custom'); setPage(0); }}
              className="h-6 text-xs px-2 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
            <span className="text-muted-foreground text-xs">→</span>
            <input type="date" value={dateTo} min={dateFrom} max={todayStr}
              onChange={e => { setDateTo(e.target.value); setRangePreset('custom'); setPage(0); }}
              className="h-6 text-xs px-2 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
            {!isLoading && !preLoading && (
              <span className="text-xs text-muted-foreground ml-auto">
                <span className="font-semibold text-foreground">{activeTotal}</span> entries
              </span>
            )}
          </div>

          {/* Table area */}
          <div className="flex-1 overflow-auto">
            {logTab === 'ro' && (isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Calendar className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">No logs found</p>
                <p className="text-xs mt-0.5">Try expanding the date range.</p>
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-background border-b z-10">
                  <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap w-[130px]">Date / Time</th>
                    <th className="text-left px-2 py-2 font-semibold w-[100px]">Operator</th>
                    <th className="text-right px-0 py-0 font-semibold whitespace-nowrap" colSpan={2}>
                      <div className="flex flex-col items-end">
                        <span className="px-2 pt-2 pb-0.5">Perm Flow</span>
                        <div className="flex border-t border-border/40 w-full">
                          <span className="flex-1 px-1.5 pb-1.5 pt-0.5 text-3xs text-right border-r border-border/30">EM</span>
                          <span className="flex-1 px-1.5 pb-1.5 pt-0.5 text-3xs text-right text-primary">Meter</span>
                        </div>
                      </div>
                    </th>
                    {['Feed Flow','Rej. Flow','Feed Press.','Rej. Press.','Suction',
                      'Feed TDS','Perm TDS','Rej. TDS','Temp','Turbidity','Feed pH','Perm pH',
                      'Cl Residual','Recovery','Feed Meter','Perm Meter','Δ Perm m³','Rej. Meter','Δ Rej. m³'].map(h => (
                      <th key={h} className="text-right px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-2 py-2 font-semibold text-center text-kpi-solar whitespace-nowrap w-[50px]" title="Meter Replacement flag">Repl.</th>
                    <th className="text-left px-2 py-2 font-semibold">Remarks</th>
                    <th className="px-2 py-2 font-semibold text-center whitespace-nowrap w-[36px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRoItems.map((item, i) => {
                    if (item.kind === 'banner') {
                      return <TrainStatusBannerRow key={`banner-${item.segment.startAt}`} segment={item.segment} />;
                    }
                    if (item.kind === 'gap') {
                      const isHighlighted = highlightGapStartAt === item.gap.gapStartAt;
                      return (
                        <GapBadgeRow
                          key={`gap-${item.gap.gapStartAt}`}
                          gap={item.gap}
                          existingReason={item.existingReason}
                          onClick={() => setGapDialogTarget({ gap: item.gap, sourceTable: 'ro_train_readings' })}
                          highlighted={isHighlighted}
                          rowRef={isHighlighted ? highlightRowRef : undefined}
                        />
                      );
                    }
                    const r: any = item.row;
                    const isRepl     = !!r.is_meter_replacement;
                    const isToggling = togglingId === r.id;
                    const opName     = r._operatorName ?? 'Unknown';
                    const initials   = opName !== 'Unknown'
                      ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
                    const delta = r._computed_delta ?? r.permeate_meter_delta;
                    const isHighlighted = highlightId != null && r.id === highlightId;
                    return (
                      <tr
                        key={r.id ?? i}
                        ref={isHighlighted ? highlightRowRef : undefined}
                        className={cn(
                          'border-t transition-colors',
                          isHighlighted ? 'bg-danger-soft ring-1 ring-inset ring-danger' : isRepl ? 'bg-kpi-solar/40' : 'hover:bg-muted/30',
                        )}
                      >
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                          <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                          <div className="text-muted-foreground">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="h-5 w-5 rounded-full bg-primary-soft text-primary text-3xs font-bold inline-flex items-center justify-center shrink-0">{initials}</span>
                            <div className="min-w-0">
                              <span className="text-xs font-medium leading-tight truncate max-w-[90px] block">{opName}</span>
                              {/* A row with no readings isn't necessarily a bug — it may be an
                                  offline check-in, which locks all RO inputs by design (see
                                  isOfflineBlocked in PretreatmentAndROLog.tsx). Surface the
                                  stored reason here instead of leaving a wall of dashes with
                                  no explanation. */}
                              {r.incomplete_reason && (
                                <span className="text-3xs text-kpi-solar leading-tight truncate max-w-[110px] block" title={r.incomplete_reason}>
                                  {r.incomplete_reason}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right border-r border-border/20">{fmtVal(r.permeate_flow, 'm³/h')}</td>
                        <td className="px-2 py-2 text-right">
                          {isRepl ? <span className="text-kpi-solar text-2xs">—</span>
                            : r._perm_flow_meter != null
                              ? <span className="text-primary font-mono text-xs">{r._perm_flow_meter}<span className="text-muted-foreground/60 ml-0.5 text-3xs">m³/h</span></span>
                              : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_flow, 'm³/h')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.reject_flow, 'm³/h')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_pressure_psi, 'psi')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.reject_pressure_psi, 'psi')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.suction_pressure_psi, 'psi')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_tds, 'ppm')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.permeate_tds, 'ppm')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.reject_tds, 'ppm')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.temperature_c, '°C')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.turbidity_ntu, 'NTU')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.feed_ph, '')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.permeate_ph, '')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.chlorine_residual_mg_l, 'mg/L')}</td>
                        <td className="px-2 py-2 text-right">{fmtVal(r.recovery_pct, '%')}</td>
                        <td className="px-2 py-2 text-right font-mono text-xs">
                          {r.feed_meter != null ? Number(r.feed_meter).toLocaleString() : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">
                          {r.permeate_meter != null ? Number(r.permeate_meter).toLocaleString() : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className={cn('px-2 py-2 text-right font-mono text-xs', isRepl && 'text-kpi-solar')}>
                          {isRepl ? <span className="text-kpi-solar font-semibold">★ 0</span>
                            : delta != null ? <span>{Number(delta).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-3xs">m³</span></span>
                            : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">
                          {r.reject_meter != null ? Number(r.reject_meter).toLocaleString() : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className={cn('px-2 py-2 text-right font-mono text-xs', r.is_reject_meter_replacement && 'text-kpi-solar')}>
                          {(() => {
                            const isRejRepl = !!(r.is_reject_meter_replacement);
                            const rejDelta  = r._computed_rej_delta ?? (r.reject_meter_delta != null ? +r.reject_meter_delta : null);
                            if (isRejRepl)         return <span className="text-kpi-solar font-semibold">★ 0</span>;
                            if (rejDelta != null)   return <span>{Number(rejDelta).toLocaleString()}<span className="text-muted-foreground/60 ml-0.5 text-3xs">m³</span></span>;
                            return <span className="text-muted-foreground/30">—</span>;
                          })()}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {isManager ? (
                            <button onClick={() => toggleMeterReplacement(r)} disabled={isToggling}
                              title={isRepl ? 'Meter replacement — click to unmark' : 'Toggle meter replacement flag'}
                              aria-label={isRepl ? 'Meter replacement — click to unmark' : 'Toggle meter replacement flag'}
                              className={cn('h-5 w-5 rounded border-2 inline-flex items-center justify-center transition-colors mx-auto',
                                isRepl ? 'border-kpi-solar bg-kpi-solar text-white' : 'border-border bg-background hover:border-kpi-solar/90',
                                isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer')}>
                              {isToggling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : isRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
                            </button>
                          ) : isRepl ? <span className="text-kpi-solar text-2xs">★</span> : null}
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground max-w-[150px] truncate">{r.remarks || ''}</td>
                        <td className="px-2 py-2 text-center">
                          {canEditEntry(r, hasFullAccess, activeOperator?.id, true) ? (
                            <div className="flex items-center justify-center gap-0.5">
                              <button onClick={() => setEditingRoRow(r)} title="Edit reading" aria-label="Edit reading"
                                disabled={deletingId === r.id}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => setPendingDelete({ type: 'ro', row: r })}
                                title="Delete reading" aria-label="Delete reading"
                                disabled={deletingId === r.id}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40">
                                {deletingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              </button>
                            </div>
                          ) : !hasFullAccess && activeOperator?.id && r.permeate_meter != null && (
                            <button
                              onClick={() => setCorrectionTarget({
                                id: r.id, sourceTable: 'ro_train_readings',
                                plantId: r.plant_id ?? '', entityName: trainLabel,
                                currentReading: Number(r.permeate_meter),
                                previousReading: r.permeate_meter_prev != null ? Number(r.permeate_meter_prev) : null,
                                dailyVolume: (r._computed_delta ?? r.permeate_meter_delta) != null ? Number(r._computed_delta ?? r.permeate_meter_delta) : null,
                                readingDatetime: r.reading_datetime ?? new Date().toISOString(),
                              })}
                              title="Request correction" aria-label="Request correction"
                              className="p-1 rounded hover:bg-warn-soft text-muted-foreground/40 hover:text-warn/90 transition-colors">
                              <MessageSquarePlus className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}

            {logTab === 'pretreat' && (preLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : preLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Calendar className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">No pre-treatment records found</p>
                <p className="text-xs mt-0.5">Try expanding the date range.</p>
              </div>
            ) : (() => {
              const pagePreItems = preItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              const pressurePills = (units: any[], getLabel = (u: any) => `U${u.unit}`) =>
                units.length === 0
                  ? <span className="text-muted-foreground/30">—</span>
                  : <div className="flex flex-wrap gap-0.5 justify-end">
                      {units.map((u: any, j: number) => {
                        const inP  = u.in_psi ?? u.inlet_psi ?? null;
                        const outP = u.out_psi ?? u.outlet_psi ?? null;
                        const dp   = u.dp_psi != null ? u.dp_psi : (inP != null && outP != null ? (inP - outP).toFixed(1) : null);
                        if (u.backwash_on) {
                          const mRow   = (u._mmfReadings ?? []).find((m: any) => m.unit === u.unit);
                          const mDelta = mRow?.meter_start != null && mRow?.meter_end != null ? ` +${(mRow.meter_end - mRow.meter_start).toFixed(0)}` : '';
                          return <span key={j} className="text-3xs px-1 py-0.5 rounded bg-warn-soft border border-warn font-mono whitespace-nowrap text-warn">{getLabel(u)} BW{mDelta}</span>;
                        }
                        return <span key={j} className="text-3xs px-1 py-0.5 rounded bg-muted/50 border border-border/40 font-mono whitespace-nowrap">{getLabel(u)}{dp != null ? ` ΔP=${dp}` : inP != null ? ` ${inP}→${outP}` : ''}</span>;
                      })}
                    </div>;
              const boosterPills = (units: any[]) =>
                units.length === 0
                  ? <span className="text-muted-foreground/30">—</span>
                  : <div className="flex flex-wrap gap-0.5 justify-end">
                      {units.map((u: any, j: number) => (
                        <span key={j} className="text-3xs px-1 py-0.5 rounded bg-info-soft border border-info font-mono whitespace-nowrap">
                          P{u.unit} {u.target_pressure_psi != null ? `${u.target_pressure_psi}psi` : u.target_hz != null ? `${u.target_hz}Hz` : '—'}{u.amperage != null ? ` ${u.amperage}A` : ''}
                        </span>
                      ))}
                    </div>;
              return (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-background border-b z-10">
                    <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
                      {['Date / Time','Operator','HPP (psi)','AFM/MMF Units','Booster Pumps','Cart./Bag Housings','Filter Housings','Changed','Remarks',''].map((h, i) => (
                        <th key={i} className={cn('px-2 py-2 font-semibold whitespace-nowrap', i === 0 ? 'text-left px-3 w-[130px]' : i === 1 ? 'text-left w-[100px]' : i === 8 ? 'text-left' : i === 9 ? 'text-center w-[36px]' : 'text-right')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pagePreItems.map((item, i) => {
                      if (item.kind === 'banner') {
                        return <TrainStatusBannerRow key={`banner-${item.segment.startAt}`} segment={item.segment} />;
                      }
                      if (item.kind === 'gap') {
                        const isHighlighted = highlightGapStartAt === item.gap.gapStartAt;
                        return (
                          <GapBadgeRow
                            key={`gap-${item.gap.gapStartAt}`}
                            gap={item.gap}
                            existingReason={item.existingReason}
                            onClick={() => setGapDialogTarget({ gap: item.gap, sourceTable: 'ro_pretreatment_readings' })}
                            highlighted={isHighlighted}
                            rowRef={isHighlighted ? highlightRowRef : undefined}
                          />
                        );
                      }
                      const r: any = item.row;
                      const opName   = r._operatorName ?? 'Unknown';
                      const initials = opName !== 'Unknown' ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
                      const isHighlighted = highlightId != null && r.id === highlightId;
                      return (
                        <tr
                          key={r.id ?? i}
                          ref={isHighlighted ? highlightRowRef : undefined}
                          className={cn('border-t transition-colors', isHighlighted ? 'bg-danger-soft ring-1 ring-inset ring-danger' : 'hover:bg-muted/30')}
                        >
                          <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                            <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                            <div className="text-muted-foreground">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="h-5 w-5 rounded-full bg-primary-soft text-primary text-3xs font-bold inline-flex items-center justify-center shrink-0">{initials}</span>
                              <div className="min-w-0">
                                <span className="text-xs font-medium leading-tight truncate max-w-[90px] block">{opName}</span>
                                {r.incomplete_reason && (
                                  <span className="text-3xs text-warn leading-tight truncate max-w-[110px] block" title={r.incomplete_reason}>
                                    {r.incomplete_reason}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-xs">
                            {r.hpp_target_pressure_psi != null ? <span>{r.hpp_target_pressure_psi}<span className="text-muted-foreground/60 ml-0.5 text-3xs">psi</span></span> : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-2 py-2 text-right">{pressurePills(r.afm_units ?? [])}</td>
                          <td className="px-2 py-2 text-right">{boosterPills(r.booster_pumps ?? [])}</td>
                          <td className="px-2 py-2 text-right">{pressurePills(r.cartridge_filter_housings ?? [], u => `H${u.unit}`)}</td>
                          <td className="px-2 py-2 text-right">{pressurePills(r.filter_housings ?? [], u => `F${u.unit}`)}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs">
                            {r.bag_filters_changed != null && r.bag_filters_changed > 0
                              ? <span className="text-warn font-semibold">{r.bag_filters_changed}</span>
                              : <span className="text-muted-foreground/30">—</span>}
                          </td>
                          <td className="px-2 py-2 text-xs text-muted-foreground max-w-[150px] truncate">{r.remarks || ''}</td>
                          <td className="px-2 py-2 text-center">
                            {canEditEntry(r, hasFullAccess, activeOperator?.id, true) ? (
                              <div className="flex items-center justify-center gap-0.5">
                                <button onClick={() => setEditingPretreatRow(r)} title="Edit reading" aria-label="Edit reading"
                                  disabled={deletingId === r.id}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button onClick={() => setPendingDelete({ type: 'pretreat', row: r })}
                                  title="Delete reading" aria-label="Delete reading"
                                  disabled={deletingId === r.id}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40">
                                  {deletingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                </button>
                              </div>
                            ) : !hasFullAccess && activeOperator?.id && (
                              <button
                                onClick={() => setCorrectionTarget({
                                  id: r.id, sourceTable: 'ro_train_readings',
                                  plantId: r.plant_id ?? '', entityName: `${trainLabel} (pre-treatment)`,
                                  currentReading: r.hpp_target_pressure_psi ?? 0,
                                  previousReading: null, dailyVolume: null,
                                  readingDatetime: r.reading_datetime ?? new Date().toISOString(),
                                })}
                                title="Request correction" aria-label="Request correction"
                                className="p-1 rounded hover:bg-warn-soft text-muted-foreground/40 hover:text-warn/90 transition-colors">
                                <MessageSquarePlus className="h-3 w-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })())}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20 shrink-0">
              <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3 w-3" />Prev</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Piece 3: RO import — pre-scoped to this train.
          ro_train_data_gaps now exists (see hourlyGapDetection.ts /
          20260823_ro_train_data_gaps.sql) — the dateRange-scoping this
          comment used to be waiting on. Still not threaded through here:
          this dialog remains a train-scoped import, not a gap-scoped one.
          Pre-filling its date range when opened from a flagged gap's "log
          why" badge would be a reasonable follow-up, just a separate one
          from what closes the gap-detection loop itself. */}
      {showImportRO && (
        <ImportROReadingsDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          trainId={trainId}
          trainLabel={trainLabel}
          onClose={() => setShowImportRO(false)}
          onImported={() => {
            setShowImportRO(false);
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {/* Piece 4: Pre-Treatment import — pre-scoped to this train */}
      {showImportPretreat && (
        <ImportPretreatReadingsDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          trainId={trainId}
          trainLabel={trainLabel}
          onClose={() => setShowImportPretreat(false)}
          onImported={() => {
            setShowImportPretreat(false);
            qc.invalidateQueries({ queryKey: preQueryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {editingRoRow && (
        <EditRoReadingDialog
          row={editingRoRow} trainId={trainId}
          onClose={() => setEditingRoRow(null)}
          onSaved={() => { setEditingRoRow(null); qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: ['ro-overview'] }); }}
        />
      )}
      {editingPretreatRow && (
        <EditPretreatReadingDialog
          row={editingPretreatRow} trainId={trainId}
          onClose={() => setEditingPretreatRow(null)}
          onSaved={() => { setEditingPretreatRow(null); qc.invalidateQueries({ queryKey: preQueryKey }); qc.invalidateQueries({ queryKey: ['ro-overview'] }); }}
        />
      )}
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => { setCorrectionTarget(null); qc.invalidateQueries({ queryKey }); qc.invalidateQueries({ queryKey: preQueryKey }); }}
        />
      )}
      {replaceReadingId && (
        <ReplaceTrainMeterDialog
          trainId={trainId}
          plantId={plantId}
          readingId={replaceReadingId}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
          onClose={() => setReplaceReadingId(null)}
        />
      )}
      {gapDialogTarget && (
        <ReasonDialog
          open={!!gapDialogTarget}
          onOpenChange={(o) => { if (!o) setGapDialogTarget(null); }}
          title={`${gapDialogTarget.gap.missedHours} hr${gapDialogTarget.gap.missedHours === 1 ? '' : 's'} missing`}
          description={
            `No ${gapDialogTarget.sourceTable === 'ro_train_readings' ? 'RO Train' : 'Pre-Treatment'} reading was logged `
            + `from ${format(new Date(gapDialogTarget.gap.gapStartAt), 'MMM d, HH:mm')} to `
            + `${format(new Date(new Date(gapDialogTarget.gap.gapEndAt).getTime() - 1), 'HH:mm')} while the train was Running. `
            + `Why was this hour missed?`
          }
          confirmLabel="Log reason"
          busy={gapDialogBusy}
          onConfirm={submitGapReason}
        />
      )}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the {pendingDelete?.type === 'ro' ? 'RO train' : 'pre-treatment'} reading.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDeleteReading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
