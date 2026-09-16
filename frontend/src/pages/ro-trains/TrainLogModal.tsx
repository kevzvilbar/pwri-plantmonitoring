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
  Loader2, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { friendlyError } from '@/lib/supabaseErrors';
import { isOfflineReadingRow } from '@/lib/hourlyReadingGuard';
import { planStrayReadingShift, type StrayReadingRef, type StrayReadingShift } from '@/lib/trainStatusTimeline';
import { CORRECTION_REASONS, isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { canEditEntry, logReadingEdit, recalculateTrainDeltas } from './helpers';
import { ReplaceTrainMeterDialog } from './ReplaceTrainMeterDialog';
import { EditRoReadingDialog } from './EditRoReadingDialog';
import { EditPretreatReadingDialog } from './EditPretreatReadingDialog';
import { ImportROReadingsDialog } from './ImportROReadingsDialog';
import { ImportPretreatReadingsDialog } from './ImportPretreatReadingsDialog';
import { ReasonDialog } from '@/components/ReasonDialog';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { cn } from '@/lib/utils';
import { useTrainLogActions } from './hooks/useTrainLogActions';
import { useReportTrainRunning } from '@/hooks/useTrainUptimeExemption';
import { UPTIME_EXEMPTION_SUBREASONS } from '@/lib/trainUptimeExemption';

import { TrainLogHeader } from './components/TrainLogHeader';
import { TrainLogFilters } from './components/TrainLogFilters';
import { RoLogTable } from './components/RoLogTable';
import { PreTreatLogTable } from './components/PreTreatLogTable';

/** Reason options for the "Report Running — failed to encode" attestation dialog. */
const UPTIME_REPORT_CATEGORIES = UPTIME_EXEMPTION_SUBREASONS;

/** Reason options for the "fix timings" dialog — same vocabulary as every other reading edit (correctionReasons.ts). */
const TIMING_FIX_CATEGORIES = CORRECTION_REASONS.map((r) => ({ value: r, label: r }));

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

export function TrainLogModal({ trainId, trainLabel, plantId, onClose, initialTab, highlightId }: TrainLogModalProps) {
  const qc = useQueryClient();
  const { isManager, isDataAnalyst, activeOperator, user } = useAuth();
  const hasFullAccess = isManager || isDataAnalyst;
  const actorLabel = () =>
    `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
    || activeOperator?.username || null;

  const [page, setPage]               = useState(0);
  const [togglingId, setTogglingId]   = useState<string | null>(null);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());

  const toggleSpanExpand = (id: string) => {
    setExpandedSpanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);
  const [logTab, setLogTab]           = useState<'ro' | 'pretreat'>(initialTab ?? 'ro');
  const [editingRoRow, setEditingRoRow]           = useState<any | null>(null);
  const [editingPretreatRow, setEditingPretreatRow] = useState<any | null>(null);
  const [correctionTarget, setCorrectionTarget]   = useState<CorrectionTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ type: 'ro' | 'pretreat'; row: any } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showImportRO, setShowImportRO]           = useState(false);
  const [showImportPretreat, setShowImportPretreat] = useState(false);

  const [gapDialogTarget, setGapDialogTarget] = useState<{
    gap: any; sourceTable: 'ro_train_readings' | 'ro_pretreatment_readings';
  } | null>(null);
  const [gapDialogBusy, setGapDialogBusy] = useState(false);

  // ── "Report Running — failed to encode" exemption ──────────────────────────
  // Files a retroactive attestation that the train kept running through a gap
  // the auto-offline flagger mis-read (operator failed to encode, or a
  // system/app outage). Removes the open bogus flag and puts the train back
  // to Running. The report row is the audit trail; the flagger skips future
  // candidates whose gap start falls inside the reported window.
  const { reportRunning } = useReportTrainRunning();
  const [reportingBanner, setReportingBanner] = useState(false);
  const [uptimeReportTarget, setUptimeReportTarget] = useState<any | null>(null);
  const handleReportRunning = (segment: any) => setUptimeReportTarget(segment);
  const submitUptimeReport = async (category: string, detail: string) => {
    if (!uptimeReportTarget) return;
    const isOpenSegment = uptimeReportTarget.endAt === null;
    setReportingBanner(true);
    try {
      await reportRunning({
        trainId,
        plantId,
        coveredFrom: uptimeReportTarget.startAt,
        // Closed segment: bound the exemption to when it actually closed,
        // not "now" — see useReportTrainRunning's doc comment.
        coveredUntil: uptimeReportTarget.endAt ?? undefined,
        isOpenSegment,
        category: category as any,
        detail,
      });
      toast.success(
        isOpenSegment
          ? 'Uptime reported — flag removed, train back to Running'
          : 'Uptime reported — historical record corrected',
      );
      setUptimeReportTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to report uptime');
    } finally {
      setReportingBanner(false);
    }
  };

  // ── One-click "fix timings" for conflicting-readings banners ────────────────
  // A closed Offline segment flagged with hasConflictingReadings usually means
  // mistimed entries: readings logged right after the restart but stamped
  // before it. This moves those strays' timestamps to just after the window's
  // close (shared offset, collision-safe — see planStrayReadingShift),
  // recalculates meter deltas, and writes the same reading_edit_audit_log
  // trail every other reading edit uses. train_status_log is never touched.
  const [timingFixTarget, setTimingFixTarget] = useState<{ segment: any; plan: StrayReadingShift[] } | null>(null);
  const [fixingTimings, setFixingTimings] = useState(false);

  const handleFixTimings = (segment: any) => {
    if (!segment?.endAt) return; // conflicts are only ever flagged on closed segments
    const startMs = new Date(segment.startAt).getTime();
    const endMs = new Date(segment.endAt).getTime();
    const inWindow = (r: any) =>
      !isOfflineReadingRow(r)
      && !!r.reading_datetime
      && new Date(r.reading_datetime).getTime() > startMs
      && new Date(r.reading_datetime).getTime() < endMs;
    const strays: StrayReadingRef[] = [
      ...logs.filter(inWindow).map((r: any) => ({ id: r.id, source_table: 'ro_train_readings' as const, reading_datetime: r.reading_datetime })),
      ...preLogs.filter(inWindow).map((r: any) => ({ id: r.id, source_table: 'ro_pretreatment_readings' as const, reading_datetime: r.reading_datetime })),
    ];
    const strayIds = new Set(strays.map((s) => s.id));
    const others = [...logs, ...preLogs]
      .filter((r: any) => !isOfflineReadingRow(r) && !strayIds.has(r.id))
      .map((r: any) => r.reading_datetime);
    const plan = planStrayReadingShift(strays, segment.endAt, others);
    if (!plan.length) {
      toast.error('No stray readings found inside this window — nothing to move.');
      return;
    }
    setTimingFixTarget({ segment, plan });
  };

  const submitTimingFix = async (category: string, detail: string) => {
    if (!timingFixTarget) return;
    if (!isReasonComplete(category, detail)) {
      toast.error('Please explain the "Other" reason (at least 5 characters).');
      return;
    }
    setFixingTimings(true);
    try {
      const reason = resolveReason(category, detail);
      const actor = actorLabel();
      for (const shift of timingFixTarget.plan) {
        const { error } = await (supabase.from(shift.source_table) as any)
          .update({ reading_datetime: shift.to })
          .eq('id', shift.id);
        if (error) throw error;
        await logReadingEdit({
          table_name: shift.source_table,
          record_id: shift.id,
          plant_id: plantId,
          train_id: trainId,
          action: 'update',
          actor_user_id: user?.id ?? null,
          actor_label: actor,
          changes: { reading_datetime: { old: shift.from, new: shift.to } },
          reason,
        });
      }
      await recalculateTrainDeltas(trainId);
      qc.invalidateQueries({ queryKey: queryKey });
      qc.invalidateQueries({ queryKey: preQueryKey });
      qc.invalidateQueries({ queryKey: ['train-status-log', trainId] });
      qc.invalidateQueries({ queryKey: ['train-hourly-gaps'] });
      qc.invalidateQueries({ queryKey: ['ro-overview'] });
      toast.success(`Moved ${timingFixTarget.plan.length} reading${timingFixTarget.plan.length === 1 ? '' : 's'} out of the downtime window — meter deltas recalculated.`);
      setTimingFixTarget(null);
    } catch (e: any) {
      toast.error(friendlyError(e) ?? 'Failed to move the readings — nothing was changed. Please try again.');
    } finally {
      setFixingTimings(false);
    }
  };

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

        const ascReadings = [...readings].reverse();
        const lastFeedMeter = new Map<string, number>();
        const lastMeter     = new Map<string, number>();
        const lastRejMeter  = new Map<string, number>();
        ascReadings.forEach((r: any) => {
          if (r.feed_meter != null) {
            const prev = lastFeedMeter.get(trainId);
            r._computed_feed_delta = prev != null ? Math.max(0, +r.feed_meter - prev) : null;
            lastFeedMeter.set(trainId, +r.feed_meter);
          }
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(trainId);
            r._computed_delta = prev != null ? Math.max(0, +r.permeate_meter - prev) : null;
            lastMeter.set(trainId, +r.permeate_meter);
          }
          if (r.reject_meter != null) {
            const isRejRepl = !!(r.is_reject_meter_replacement);
            const prev = lastRejMeter.get(trainId);
            r._computed_rej_delta = isRejRepl
              ? 0
              : prev != null ? Math.max(0, +r.reject_meter - prev) : null;
            lastRejMeter.set(trainId, +r.reject_meter);
          }

          // Fallback inference for reject delta if physical reject was not logged/metered
          const effFeedDelta = r._computed_feed_delta ?? (r.feed_meter_delta != null ? +r.feed_meter_delta : null);
          const effPermDelta = r._computed_delta ?? (r.permeate_meter_delta != null ? +r.permeate_meter_delta : null);
          const effRejDelta  = r._computed_rej_delta ?? (r.reject_meter_delta != null ? +r.reject_meter_delta : null);

          if (effRejDelta == null) {
            if (effFeedDelta != null && effPermDelta != null) {
              r._inferred_rej_delta = Math.max(0, +(effFeedDelta - effPermDelta).toFixed(2));
            } else if (effPermDelta != null && r.recovery_pct != null && +r.recovery_pct > 0 && +r.recovery_pct < 100) {
              r._inferred_rej_delta = Math.max(0, +(effPermDelta * (100 - +r.recovery_pct) / +r.recovery_pct).toFixed(2));
            }
          }
        });

        const uids = [...new Set(readings.map((r: any) => r.recorded_by).filter((id): id is string => !!id))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          const { data: pdata, error: perr } = await supabase
            .from('user_profiles')
            .select('id, first_name, last_name, username')
            .in('id', uids);
          if (!perr && pdata?.length) {
            profileMap = Object.fromEntries(pdata.map((p) => {
              const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
              return [p.id, name || null];
            }).filter(([, n]) => n));
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
        let q = supabase
          .from('ro_pretreatment_readings')
          .select('id,reading_datetime,recorded_by,created_at,plant_id,hpp_target_pressure_psi,bag_filters_changed,afm_units,mmf_readings,booster_pumps,filter_housings,cartridge_filter_housings,remarks,incomplete_reason')
          .eq('train_id', trainId).order('reading_datetime', { ascending: false }).limit(2000);
        if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
        if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
        const { data, error } = await q;
        if (error) return [];
        const uids = [...new Set((data ?? []).map((r) => r.recorded_by).filter((id): id is string => !!id))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          const { data: pd, error: pe } = await supabase
            .from('user_profiles')
            .select('id, first_name, last_name, username')
            .in('id', uids);
          if (!pe && pd?.length) {
            profileMap = Object.fromEntries(pd.map((p) => {
              const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
              return [p.id, name || null];
            }).filter(([, n]) => n));
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

  const { data: gapReasonRows = [] } = useQuery({
    queryKey: ['ro-train-data-gaps', trainId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_train_data_gaps')
        .select('id,source_table,gap_start_at,reason_category,reason_detail')
        .eq('train_id', trainId);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 15_000,
  });

  const highlightGapStartAt = highlightId?.startsWith('gap:') ? highlightId.slice(4) : null;
  const highlightRowRef = useRef<HTMLTableRowElement>(null);
  const [highlightJumped, setHighlightJumped] = useState(false);

  const actions = useTrainLogActions({
    trainId, plantId, qc, isManager, activeOperator, hasFullAccess, trainLabel,
    logs, preLogs, statusLogRows, gapReasonRows,
    dateFrom, untilNextDay,
    gapDialogTarget, setGapDialogTarget, gapDialogBusy, setGapDialogBusy,
    togglingId, setTogglingId,
    replaceReadingId, setReplaceReadingId,
    editingRoRow, setEditingRoRow,
    editingPretreatRow, setEditingPretreatRow,
    pendingDelete, setPendingDelete,
    deletingId, setDeletingId,
    page, setPage,
    expandedSpanIds, setExpandedSpanIds, toggleSpanExpand,
    highlightId, highlightGapStartAt, highlightRowRef, highlightJumped, setHighlightJumped,
    logTab, queryKey, preQueryKey,
  });

  useEffect(() => {
    if (highlightRowRef.current) highlightRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [page, highlightJumped]);

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent
          className="max-w-[95vw] w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
          onInteractOutside={(e) => {
            if (editingRoRow || editingPretreatRow || replaceReadingId || correctionTarget || showImportRO || showImportPretreat || pendingDelete) {
              e.preventDefault();
              return;
            }
            onClose();
          }}
        >
          <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

          <TrainLogHeader
            trainLabel={trainLabel}
            logTab={logTab}
            isManager={isManager}
            setShowImportRO={setShowImportRO}
            setShowImportPretreat={setShowImportPretreat}
            exportCSV={actions.exportCSV}
          />

          <TrainLogFilters
            logTab={logTab}
            setLogTab={setLogTab}
            rangePreset={rangePreset}
            applyPreset={applyPreset}
            dateFrom={dateFrom}
            dateTo={dateTo}
            setDateFrom={setDateFrom}
            setDateTo={setDateTo}
            setRangePreset={setRangePreset}
            setPage={setPage}
            isLoading={isLoading}
            preLoading={preLoading}
            activeTotal={actions.activeTotal}
          />

          <div className="flex-1 overflow-auto">
            {logTab === 'ro' ? (
              <RoLogTable
                isLoading={isLoading}
                logsLength={logs.length}
                pageRoItems={actions.pageRoItems}
                roItemsLength={actions.roItems.length}
                logTab={logTab}
                highlightId={highlightId}
                highlightGapStartAt={highlightGapStartAt}
                highlightRowRef={highlightRowRef}
                highlightJumped={highlightJumped}
                expandedSpanIds={expandedSpanIds}
                toggleSpanExpand={toggleSpanExpand}
                gapDialogTarget={gapDialogTarget}
                setGapDialogTarget={setGapDialogTarget}
                gapDialogBusy={gapDialogBusy}
                submitGapReason={actions.submitGapReason}
                togglingId={togglingId}
                setEditingRoRow={setEditingRoRow}
                setPendingDelete={setPendingDelete}
                canEditEntry={canEditEntry}
                hasFullAccess={hasFullAccess}
                activeOperator={activeOperator}
                isManager={isManager}
                editingRoRow={editingRoRow}
                replaceReadingId={replaceReadingId}
                setReplaceReadingId={setReplaceReadingId}
                toggleMeterReplacement={actions.toggleMeterReplacement}
                recalculateTrainDeltas={recalculateTrainDeltas}
                trainId={trainId}
                qc={qc}
                queryKey={queryKey}
                exportCSV={actions.exportCSV}
                doDeleteReading={actions.doDeleteReading}
                onReportRunning={handleReportRunning}
                reportingBanner={reportingBanner}
                onFixTimings={hasFullAccess ? handleFixTimings : undefined}
                fixingTimings={fixingTimings}
                fmtVal={actions.fmtVal}
                format={format}
              />
            ) : (
              <PreTreatLogTable
                isLoading={preLoading}
                logsLength={preLogs.length}
                pagePreItems={actions.pagePreItems}
                itemsLength={actions.preItems.length}
                logTab={logTab}
                highlightId={highlightId}
                highlightGapStartAt={highlightGapStartAt}
                highlightRowRef={highlightRowRef}
                highlightJumped={highlightJumped}
                expandedSpanIds={expandedSpanIds}
                toggleSpanExpand={toggleSpanExpand}
                gapDialogTarget={gapDialogTarget}
                setGapDialogTarget={setGapDialogTarget}
                gapDialogBusy={gapDialogBusy}
                submitGapReason={actions.submitGapReason}
                setEditingPretreatRow={setEditingPretreatRow}
                setPendingDelete={setPendingDelete}
                setCorrectionTarget={setCorrectionTarget}
                canEditEntry={canEditEntry}
                hasFullAccess={hasFullAccess}
                activeOperator={activeOperator}
                isManager={isManager}
                editingPretreatRow={editingPretreatRow}
                fmtVal={actions.fmtVal}
                format={format}
                onReportRunning={handleReportRunning}
                reportingBanner={reportingBanner}
                onFixTimings={hasFullAccess ? handleFixTimings : undefined}
                fixingTimings={fixingTimings}
                trainLabel={trainLabel}
              />
            )}
          </div>

          {/* Pagination */}
          {actions.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20 shrink-0">
              <span className="text-xs text-muted-foreground">Page {page + 1} of {actions.totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3 w-3" />Prev</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= actions.totalPages - 1} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
          onConfirm={actions.submitGapReason}
        />
      )}
      {uptimeReportTarget && (
        <ReasonDialog
          open={!!uptimeReportTarget}
          onOpenChange={(o) => { if (!o && !reportingBanner) setUptimeReportTarget(null); }}
          title="Report Running — readings not encoded"
          description={
            `Attest that Train ${trainLabel} was actually running the whole time and the auto-offline flag `
            + `(started ${format(new Date(uptimeReportTarget.startAt), 'MMM d, HH:mm')}) is a false positive `
            + `because readings weren't encoded. `
            + (uptimeReportTarget.endAt === null
              ? 'This removes the flag and puts the train back to Running. '
              : "This corrects the closed period in the record without changing the train's current status. ")
            + `The attestation is logged with your name.`
          }
          confirmLabel="File attestation"
          busy={reportingBanner}
          categories={UPTIME_REPORT_CATEGORIES}
          onConfirm={submitUptimeReport}
        />
      )}
      {timingFixTarget && (
        <ReasonDialog
          open={!!timingFixTarget}
          onOpenChange={(o) => { if (!o && !fixingTimings) setTimingFixTarget(null); }}
          title="Move readings out of the Offline window?"
          description={
            `${timingFixTarget.plan.length} reading${timingFixTarget.plan.length === 1 ? '' : 's'} will move `
            + timingFixTarget.plan
              .map((s) => `${format(new Date(s.from), 'MMM d, HH:mm')} → ${format(new Date(s.to), 'HH:mm')}`)
              .join(' · ')
            + `. Meter deltas are recalculated and the move is audit-logged with your reason. `
            + `The confirmed status log is not changed.`
          }
          confirmLabel="Move readings"
          busy={fixingTimings}
          categories={TIMING_FIX_CATEGORIES}
          onConfirm={submitTimingFix}
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
              onClick={actions.doDeleteReading}
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
