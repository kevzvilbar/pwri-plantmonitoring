import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { submitAnomalyRemark } from '@/lib/anomalyRemarks';
import { cn } from '@/lib/utils';
import {
  SourceTable, FlaggedRow, CorrectionRequest, ChainEntry, OperatorStat, tableLabel, fmtNum, fmtDt, parseNumeric, extractOldValueFromChanges, pickDisplayRole, ROLE_DISPLAY_PRIORITY, UUID,
} from '../../types';
import {
  PENDING_FETCH_LIMIT_PER_TABLE, guessMeterMax, fetchPending, fetchCorrectionRequests, supersedeOtherCorrectionRequests,
} from '../../api';
import { useRecentCorrections, type RecentCorrection } from '../../components/RecentCorrectionsPanel';

export function usePendingReviewActions() {
  const { user, roles } = useAuth();
  const actorRole = pickDisplayRole(roles);
  const qc = useQueryClient();
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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['data-corrections-pending'],
    queryFn: fetchPending,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
  const rows = data?.rows ?? [];
  const truncated = data?.truncated ?? false;

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
    const { error } = await (supabase.rpc('fn_cascade_reading_correction', {
      p_table:       req.source_table,
      p_row_id:      req.source_id,
      p_new_current: req.proposed_value,
      p_admin_id:    user?.id ?? null,
      p_reason:      'Approved correction request: ' + req.reason,
    }) as any);
    if (error) { toast.error(friendlyError(error)); return; }
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
    const { error: revertErr } = await (supabase
      .from(req.source_table as any).update({ norm_status: 'normal' }).eq('id', req.source_id) as any);
    if (revertErr) { toast.error(friendlyError(revertErr)); return; }
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
    const hasReason = Boolean(
      row.anomaly_remark?.text ||
      row.edit_reason?.text ||
      customReasons[row.id]?.trim() ||
      notes[row.id]?.trim()
    );

    setBusy(p => ({ ...p, [row.id]: true }));
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

  return {
    rows, isLoading, error, refetch, truncated,
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
