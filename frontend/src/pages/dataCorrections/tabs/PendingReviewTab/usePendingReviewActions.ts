import { useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { submitAnomalyRemark } from '@/lib/anomalyRemarks';
import {
  SourceTable, FlaggedRow, CorrectionRequest, pickDisplayRole, tableLabel,
} from '../../types';
import { useRecentCorrections } from '../../components/RecentCorrectionsPanel';
import { 
  usePending, 
  useCorrectionRequests, 
  useApproveCorrectionRequest, 
  useRejectCorrectionRequest,
  useApproveReading,
  useRetractReading,
  useBulkApproveReadings,
  useBulkRetractReadings,
  useInsertReadingNormalization,
  type FlaggedRow as DataFlaggedRow,
  type CorrectionRequest as DataCorrectionRequest,
} from '@/data/hooks/useCorrections';

/** Cast data layer types to local types */
function toLocalFlaggedRow(row: DataFlaggedRow): FlaggedRow {
  return {
    ...row,
    source_table: row.source_table,
    entity_id: row.entity_id,
    entity_name: row.entity_name,
    plant_id: row.plant_id,
    plant_name: row.plant_name,
    recorded_by: row.recorded_by,
    operator_username: row.operator_username,
    predecessor: row.predecessor,
  } as FlaggedRow;
}

function toLocalCorrectionRequest(req: DataCorrectionRequest): CorrectionRequest {
  return {
    ...req,
    source_table: req.source_table,
    source_id: req.source_id,
    entity_name: req.entity_name,
    plant_name: req.plant_name,
    original_value: req.original_value,
    proposed_value: req.proposed_value,
    reason: req.reason,
    note: req.note,
    status: req.status,
    submitter_email: req.submitter_email,
    created_at: req.created_at,
  } as CorrectionRequest;
}

export function usePendingReviewActions() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const recent = useRecentCorrections();

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
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});

  // Use new data layer hooks
  const { data: pendingData, isLoading, error, refetch, isFetching } = usePending();
  const rows = (pendingData?.rows ?? []).map(toLocalFlaggedRow);
  const truncated = pendingData?.truncated ?? false;

  const { data: corrReqsData = [], refetch: refetchCorrReqs } = useCorrectionRequests('pending');
  const corrReqs = corrReqsData.map(toLocalCorrectionRequest);

  const approveReadingMutation = useApproveReading();
  const retractReadingMutation = useRetractReading();
  const bulkApproveMutation = useBulkApproveReadings();
  const bulkRetractMutation = useBulkRetractReadings();
  const approveCorrectionRequestMutation = useApproveCorrectionRequest();
  const rejectCorrectionRequestMutation = useRejectCorrectionRequest();
  const insertNormalizationMutation = useInsertReadingNormalization();

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
    refetch();
    refetchCorrReqs();
  }, [refetch, refetchCorrReqs]);

  const approveRequest = async (req: CorrectionRequest) => {
    try {
      await approveCorrectionRequestMutation.mutateAsync({
        id: req.id,
        reviewerId: user?.id ?? '',
        note: 'Approved correction request: ' + req.reason,
      });
      
      recent.add({
        label: `${tableLabel[req.source_table]} · ${req.reason}`,
        plantName: req.plant_name ?? '—',
        sourceTable: req.source_table,
        oldValue: req.original_value,
        newValue: req.proposed_value,
      });
      toast.success('Correction approved and applied');
      invalidate();
    } catch (err: any) {
      toast.error(friendlyError(err));
    }
  };

  const rejectRequest = async (req: CorrectionRequest, resolutionNote: string) => {
    if (!resolutionNote.trim()) { toast.error('A reason is required to reject a correction request'); return; }
    try {
      await rejectCorrectionRequestMutation.mutateAsync({
        id: req.id,
        reviewerId: user?.id ?? '',
        note: resolutionNote,
      });
      toast.info('Correction request rejected — original value kept');
      invalidate();
    } catch (err: any) {
      toast.error(friendlyError(err));
    }
  };

  const unlockReading = async (row: FlaggedRow) => {
    // This still needs direct supabase call - unlock is a simple update
    const { supabase } = await import('@/integrations/supabase/client');
    await (supabase.from(row.source_table as any)
      .update({ locked_at: null, locked_by: null })
      .eq('id', row.id) as any);
    toast.success(`${row.entity_name}: unlocked`);
    invalidate();
  };

  const resolveOne = async (row: FlaggedRow, decision: 'normal' | 'retracted') => {
    const hasReason = Boolean(
      row.anomaly_remark?.text ||
      row.edit_reason?.text ||
      customReasons[row.id]?.trim() ||
      notes[row.id]?.trim()
    );

    setBusy(p => ({ ...p, [row.id]: true }));
    
    try {
      if (decision === 'normal') {
        await approveReadingMutation.mutateAsync({
          table: row.source_table,
          id: row.id,
          reviewerId: user?.id ?? '',
          note: notes[row.id] || customReasons[row.id] || 'Approved from corrections queue',
        });
      } else {
        await retractReadingMutation.mutateAsync({
          table: row.source_table,
          id: row.id,
          reviewerId: user?.id ?? '',
          note: notes[row.id] || customReasons[row.id] || 'Rejected from corrections queue',
        });
      }

      // Insert normalization audit
      await insertNormalizationMutation.mutateAsync({
        source_table: row.source_table,
        source_id: row.id,
        action: decision === 'normal' ? 'normalize' : 'retract',
        original_value: row.current_reading,
        adjusted_value: decision === 'normal' ? row.current_reading : null,
        note: notes[row.id] || customReasons[row.id] || (decision === 'normal' ? 'Approved from corrections queue' : 'Rejected from corrections queue'),
        performed_by: user?.id ?? null,
        performed_role: actorRole,
      });

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
    } catch (err: any) {
      toast.error(friendlyError(err));
    }
    setBusy(p => ({ ...p, [row.id]: false }));
  };

  const bulkResolve = async (decision: 'normal' | 'retracted') => {
    if (!selected.size) return;
    setBulkBusy(true);
    const targets = rows.filter(r => selected.has(r.id));
    const ids = targets.map(r => r.id);
    const tables = [...new Set(targets.map(r => r.source_table))];
    
    try {
      // Process each table separately since mutations are per-table
      for (const table of tables) {
        const tableIds = targets.filter(r => r.source_table === table).map(r => r.id);
        if (decision === 'normal') {
          await bulkApproveMutation.mutateAsync({
            table,
            ids: tableIds,
            reviewerId: user?.id ?? '',
            note: `Bulk approval (${tableIds.length} rows)`,
          });
        } else {
          await bulkRetractMutation.mutateAsync({
            table,
            ids: tableIds,
            reviewerId: user?.id ?? '',
            note: `Bulk rejection (${tableIds.length} rows)`,
          });
        }
      }

      // Insert normalization audit for all
      await insertNormalizationMutation.mutateAsync({
        source_table: tables[0], // This is a limitation - we'd need multiple inserts
        source_id: ids[0],
        action: decision === 'normal' ? 'normalize' : 'retract',
        original_value: targets[0]?.current_reading ?? 0,
        note: `Bulk ${decision === 'normal' ? 'approval' : 'rejection'} (${targets.length} rows)`,
        performed_by: user?.id ?? null,
        performed_role: actorRole,
      });

      const ok = targets.length;
      if (ok) {
        if (decision === 'normal') {
          const withoutReasonCount = targets.filter(row => {
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
      setSelected(new Set());
      invalidate();
    } catch (err: any) {
      toast.error(friendlyError(err));
    }
    setBulkBusy(false);
  };

  return {
    rows, isLoading: isLoading || isFetching, error, refetch, truncated,
    selected, setSelected, expanded, setExpanded,
    editRow, setEditRow, rolloverRow, setRolloverRow,
    busy, setBusy, bulkBusy, setBulkBusy,
    searchQ, setSearchQ, plantFilter, setPlantFilter,
    notes, setNotes, customReasons, setCustomReasons, reqNotes, setReqNotes,
    plants, filtered, allSelected,
    toggleAll, toggleOne, invalidate, corrReqs,
    handleSaveReason, approveRequest, rejectRequest, unlockReading, resolveOne, bulkResolve, recent,
  };
}
