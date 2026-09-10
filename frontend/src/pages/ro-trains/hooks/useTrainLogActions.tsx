/**
 * frontend/src/pages/ro-trains/hooks/useTrainLogActions.ts
 *
 * Encapsulates all action handlers, computed values, and helper utilities
 * previously defined inside TrainLogModal.tsx. The parent component owns
 * raw state/queries and passes them in; this hook returns everything the
 * rendered sub-components need.
 */
import { useMemo, useEffect, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { supabase } from '@/integrations/supabase/client';
import { canEditEntry, recalculateTrainDeltas, logReadingEdit } from '../helpers';
import {
  buildStatusTimeline,
  nonRunningSegmentsInRange,
  mergeSegmentsForDisplay,
  formatSegmentDuration,
  reconcileOngoingSegmentWithReadings,
  flagConflictingClosedSegments,
  type StatusSegment,
} from '@/lib/trainStatusTimeline';
import {
  detectHourlyGaps,
  mergeGapsForDisplay,
  type FlaggedGap,
  type GapReason,
} from '@/lib/hourlyGapDetection';
import {
  groupLogItemsWithOfflineSpans,
  formatSpanDuration,
  type OfflineSpan,
} from '@/lib/downtimeRowMerger';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { format } from 'date-fns';

const PAGE_SIZE = 20;

export interface TrainLogActionsOptions {
  trainId: string;
  plantId: string;
  qc: ReturnType<typeof useQueryClient>;
  isManager: boolean;
  activeOperator: { id?: string; first_name?: string | null; last_name?: string | null; username?: string | null } | null;
  hasFullAccess: boolean;
  trainLabel: string;
  logs: any[];
  preLogs: any[];
  statusLogRows: any[];
  gapReasonRows: any[];
  dateFrom: string | null;
  untilNextDay: string | null;
  gapDialogTarget: { gap: FlaggedGap; sourceTable: 'ro_train_readings' | 'ro_pretreatment_readings' } | null;
  setGapDialogTarget: (v: any) => void;
  gapDialogBusy: boolean;
  setGapDialogBusy: (v: boolean) => void;
  togglingId: string | null;
  setTogglingId: (v: string | null) => void;
  replaceReadingId: string | null;
  setReplaceReadingId: (v: string | null) => void;
  editingRoRow: any;
  setEditingRoRow: (v: any) => void;
  editingPretreatRow: any;
  setEditingPretreatRow: (v: any) => void;
  pendingDelete: { type: 'ro' | 'pretreat'; row: any } | null;
  setPendingDelete: (v: any) => void;
  deletingId: string | null;
  setDeletingId: (v: string | null) => void;
  page: number;
  setPage: (v: number | ((prev: number) => number)) => void;
  expandedSpanIds: Set<string>;
  setExpandedSpanIds: (updater: (prev: Set<string>) => Set<string>) => void;
  toggleSpanExpand: (id: string) => void;
  highlightId?: string;
  highlightGapStartAt: string | null;
  highlightRowRef: React.RefObject<HTMLTableRowElement>;
  highlightJumped: boolean;
  setHighlightJumped: (v: boolean) => void;
  logTab: 'ro' | 'pretreat';
  queryKey: any[];
  preQueryKey: any[];
}

export interface TrainLogActionsReturn {
  actorLabel: () => string | null;
  submitGapReason: (category: string, detail: string) => Promise<void>;
  toggleMeterReplacement: (r: any) => Promise<void>;
  doDeleteReading: () => Promise<void>;
  exportCSV: () => void;
  logsWithMeterFlow: any[];
  roItemsWithBanners: any[];
  preItemsWithBanners: any[];
  roItemsWithGaps: any[];
  preItemsWithGaps: any[];
  roItems: any[];
  preItems: any[];
  pageRoItems: any[];
  pagePreItems: any[];
  activeTotal: number;
  totalPages: number;
  fmtVal: (v: any, unit?: string) => React.ReactNode;
}

export function useTrainLogActions(options: TrainLogActionsOptions): TrainLogActionsReturn {
  const {
    trainId, plantId, qc, isManager, activeOperator, hasFullAccess, trainLabel,
    logs, preLogs, statusLogRows, gapReasonRows,
    dateFrom, untilNextDay,
    gapDialogTarget, setGapDialogTarget, gapDialogBusy, setGapDialogBusy,
    togglingId, setTogglingId, replaceReadingId, setReplaceReadingId,
    editingRoRow, setEditingRoRow, editingPretreatRow, setEditingPretreatRow,
    pendingDelete, setPendingDelete, deletingId, setDeletingId,
    page, setPage, expandedSpanIds, setExpandedSpanIds, toggleSpanExpand,
    highlightId, highlightGapStartAt, highlightRowRef, highlightJumped, setHighlightJumped,
    logTab, queryKey, preQueryKey,
  } = options;

  const actorLabel = () =>
    `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
    || activeOperator?.username || null;

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

  const statusTimeline = useMemo(() => buildStatusTimeline(statusLogRows), [statusLogRows]);

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
    return flagConflictingClosedSegments(reconciled, readingTimestamps);
  }, [statusTimeline, dateFrom, untilNextDay, logs, preLogs]);

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

  const roItemsWithBanners = useMemo(
    () => mergeSegmentsForDisplay(logsWithMeterFlow, bannerSegments, (r: any) => r.reading_datetime),
    [logsWithMeterFlow, bannerSegments],
  );
  const preItemsWithBanners = useMemo(
    () => mergeSegmentsForDisplay(preLogs, bannerSegments, (r: any) => r.reading_datetime),
    [preLogs, bannerSegments],
  );
  const roItemsWithGaps = useMemo(
    () => mergeGapsForDisplay(roItemsWithBanners, roGaps, gapReasonsBySourceTable.ro_train_readings, (r: any) => r.reading_datetime),
    [roItemsWithBanners, roGaps, gapReasonsBySourceTable],
  );
  const preItemsWithGaps = useMemo(
    () => mergeGapsForDisplay(preItemsWithBanners, preGaps, gapReasonsBySourceTable.ro_pretreatment_readings, (r: any) => r.reading_datetime),
    [preItemsWithBanners, preGaps, gapReasonsBySourceTable],
  );

  const roItems = useMemo(
    () => groupLogItemsWithOfflineSpans(roItemsWithGaps as any, 2),
    [roItemsWithGaps],
  );
  const preItems = useMemo(
    () => groupLogItemsWithOfflineSpans(preItemsWithGaps as any, 2),
    [preItemsWithGaps],
  );

  const pageRoItems = roItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pagePreItems = preItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeTotal = logTab === 'ro' ? roItems.length : preItems.length;
  const totalPages  = Math.ceil(activeTotal / PAGE_SIZE);

  useEffect(() => {
    if (!highlightId || highlightJumped) return;
    const source = logTab === 'ro' ? roItems : preItems;
    if (!source.length) return;
    const idx = highlightGapStartAt
      ? source.findIndex((item: any) => item.kind === 'gap' && item.gap.gapStartAt === highlightGapStartAt)
      : source.findIndex((item: any) => {
          if (item.kind === 'reading') return (item.row as any).id === highlightId;
          if (item.kind === 'offline-span') return item.span.rows.some((r: any) => r.id === highlightId);
          return false;
        });
    if (idx === -1) { setHighlightJumped(true); return; }
    const targetItem: any = source[idx];
    if (targetItem?.kind === 'offline-span') {
      setExpandedSpanIds((prev) => new Set(prev).add(targetItem.span.id));
    }
    setPage(Math.floor(idx / PAGE_SIZE));
    setHighlightJumped(true);
  }, [highlightId, highlightGapStartAt, highlightJumped, logTab, roItems, preItems, setPage, setHighlightJumped, setExpandedSpanIds]);

  const fmtVal = (v: any, unit = '') =>
    v != null
      ? <span className="font-mono tabular-nums whitespace-nowrap">{Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-muted-foreground/60 ml-0.5 text-2xs">{unit}</span></span>
      : <span className="text-muted-foreground/30">—</span>;

  return {
    actorLabel,
    submitGapReason,
    toggleMeterReplacement,
    doDeleteReading,
    exportCSV,
    logsWithMeterFlow,
    roItemsWithBanners,
    preItemsWithBanners,
    roItemsWithGaps,
    preItemsWithGaps,
    roItems,
    preItems,
    pageRoItems,
    pagePreItems,
    activeTotal,
    totalPages,
    fmtVal,
  };
}
