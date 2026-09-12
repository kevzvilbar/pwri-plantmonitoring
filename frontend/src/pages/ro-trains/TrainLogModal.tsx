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
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { cn } from '@/lib/utils';
import { canEditEntry, recalculateTrainDeltas } from './helpers';
import { ReplaceTrainMeterDialog } from './ReplaceTrainMeterDialog';
import { EditRoReadingDialog } from './EditRoReadingDialog';
import { EditPretreatReadingDialog } from './EditPretreatReadingDialog';
import { ImportROReadingsDialog } from './ImportROReadingsDialog';
import { ImportPretreatReadingsDialog } from './ImportPretreatReadingsDialog';
import { ReasonDialog } from '@/components/ReasonDialog';
import { useTrainLogActions } from './hooks/useTrainLogActions';
import { useReportTrainRunning } from './hooks/useReportTrainRunning';

import { TrainLogHeader } from './components/TrainLogHeader';
import { TrainLogFilters } from './components/TrainLogFilters';
import { RoLogTable } from './components/RoLogTable';
import { PreTreatLogTable } from './components/PreTreatLogTable';
import { UPTIME_EXEMPTION_SUBREASONS } from '../ROTrains/pretreatment/types';

/**
 * Reason options for the "Report Running — failed to encode" attestation
 * dialog. Single-sourced from UPTIME_EXEMPTION_SUBREASONS (the RO Train log
 * page's exemption dropdown) so the two surfaces can't drift apart.
 */
const UPTIME_REPORT_CATEGORIES = UPTIME_EXEMPTION_SUBREASONS;

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
        const lastMeter    = new Map<string, number>();
        const lastRejMeter = new Map<string, number>();
        ascReadings.forEach((r: any) => {
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(trainId);
            r._computed_delta = prev != null ? +r.permeate_meter - prev : null;
            lastMeter.set(trainId, +r.permeate_meter);
          }
          if (r.reject_meter != null) {
            const isRejRepl = !!(r.is_reject_meter_replacement);
            const prev = lastRejMeter.get(trainId);
            r._computed_rej_delta = isRejRepl
              ? 0
              : prev != null ? +r.reject_meter - prev : null;
            lastRejMeter.set(trainId, +r.reject_meter);
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
