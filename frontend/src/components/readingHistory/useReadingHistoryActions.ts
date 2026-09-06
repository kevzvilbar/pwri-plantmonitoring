/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { canEditEntry, logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { HistoryEditState, HistoryModule } from './types';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';
import {
  invalidateLocatorDash, invalidateWellDash, invalidatePowerDash,
} from '@/pages/operations/shared';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';

export function useReadingHistoryActions(options: {
  module: HistoryModule;
  entityId: string;
  plantId?: string;
  queryKey: any[];
  qc: ReturnType<typeof useQueryClient>;
  rows: any[];
  hasFullAccess: boolean;
  activeOperatorId?: string;
  user?: { id: string } | null;
  assetMeterSerial?: string | null;
  multiplier?: number;
  gridMeterCountProp?: number;
  gridMeterNames?: string[];
  gridMultipliers?: number[];
  defaultInputMode?: string;
  solarInputMode?: string;
  isSolarDirectMode?: boolean;
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number } | null;
  solarDirectVal?: (row: any) => number | null;
  getGridMeterVal?: (row: any, idx: number, rowIndex: number, allRows: any[]) => number | null;
  getHistGridLabel?: (idx: number) => string;
  activeOperator?: { first_name?: string; last_name?: string; username?: string } | null;
}) {
  const [editRow, setEditRow] = useState<HistoryEditState | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);
  const [togglingGridId, setTogglingGridId] = useState<string | null>(null);
  const [replacePowerReadingId, setReplacePowerReadingId] = useState<{ id: string; gridIdx: number } | null>(null);
  const [togglingSolarId, setTogglingSolarId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  const localMidnight = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const auditTableName = (
    m: HistoryModule,
  ): 'locator_readings' | 'power_readings' | 'blending_events' | 'well_readings' =>
    m === 'locator' ? 'locator_readings'
    : m === 'power' ? 'power_readings'
    : m === 'blending' ? 'blending_events'
    : 'well_readings';

  const actorLabel = () =>
    `${options.activeOperator?.first_name ?? ''} ${options.activeOperator?.last_name ?? ''}`.trim()
    || options.activeOperator?.username || null;

  const resyncLocatorChain = async (locatorId: string) => {
    const { data: all, error } = await supabase
      .from('locator_readings')
      .select('id, current_reading, previous_reading, reading_datetime, is_estimated')
      .eq('locator_id', locatorId)
      .order('reading_datetime', { ascending: true });
    if (error || !all) return;

    let last: number | null = null;
    const updates: { id: string; previous_reading: number | null }[] = [];
    const staleEstimatedIds: string[] = [];

    for (const row of all as any[]) {
      const cur = +row.current_reading;
      if (row.is_estimated && last != null && cur <= last) {
        staleEstimatedIds.push(row.id);
        continue;
      }
      const newPrev = last;
      if (row.previous_reading !== newPrev) {
        updates.push({ id: row.id, previous_reading: newPrev });
      }
      last = cur;
    }

    if (staleEstimatedIds.length) {
      await supabase.from('locator_readings').delete().in('id', staleEstimatedIds);
    }

    if (updates.length) {
      await Promise.all(updates.map(u => supabase
        .from('locator_readings')
        .update({ previous_reading: u.previous_reading } as any)
        .eq('id', u.id)));
    }

    if (staleEstimatedIds.length || updates.length) {
      options.qc.invalidateQueries({ queryKey: options.queryKey });
    }

    (supabase.rpc as any)('fn_backfill_missing_readings', { p_lookback_days: 14 }).catch(() => {});
  };

  const startEdit = (r: any) => {
    if (!canEditEntry(r, options.hasFullAccess, options.activeOperatorId)) {
      toast.error('You can only edit your own entries, within 8 hours of submitting them.');
      return;
    }
    setEditReason('');
    setEditCustomReason('');
    const dt = r.reading_datetime ?? r.created_at ?? '';
    const dtStr = dt ? format(new Date(dt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
    if (options.module === 'well') {
      setEditRow({
        id: r.id,
        datetime: dtStr,
        value: String(r.current_reading ?? ''),
        value2: r.power_meter_reading != null ? String(r.power_meter_reading) : '',
        value4: 'tds_ppm'       in r ? (r.tds_ppm        != null ? String(r.tds_ppm)                  : '') : undefined,
        value6: 'turbidity_ntu' in r ? ((r as any).turbidity_ntu != null ? String((r as any).turbidity_ntu) : '') : undefined,
        value5: 'pressure_psi'  in r ? (r.pressure_psi   != null ? String(r.pressure_psi)              : '') : undefined,
        hasMeterReplacement: 'is_meter_replacement' in r,
        isMeterReplacement: !!r.is_meter_replacement,
      });
    } else if (options.module === 'locator') {
      setEditRow({ id: r.id, datetime: dtStr, value: String(r.current_reading ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    } else if (options.module === 'power') {
      const isSolarEdit = options.meterFilter?.type === 'solar';
      const gridIdxForEdit = options.meterFilter && !isSolarEdit ? (options.meterFilter as { type: 'grid'; idx: number }).idx : 0;
      const rIdx = (options.rows ?? []).indexOf(r);
      const gridValueForEdit = options.getGridMeterVal!(r, gridIdxForEdit, rIdx, options.rows ?? []);
      const solarValueForEdit = options.isSolarDirectMode ? options.solarDirectVal!(r) : r.solar_meter_reading;
      setEditRow({
        id: r.id,
        datetime: dtStr,
        value: String(gridValueForEdit ?? ''),
        value2: solarValueForEdit != null ? String(solarValueForEdit) : '',
        value3: r.daily_grid_kwh != null ? String(r.daily_grid_kwh) : '',
        gridIdx: gridIdxForEdit,
        isMeterReplacement: !!r.is_meter_replacement,
      });
    } else if (options.module === 'blending') {
      const eventDt = r.event_date ?? r.noted_at ?? '';
      const blendDtStr = eventDt ? format(new Date(eventDt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
      setEditRow({ id: r.id, datetime: blendDtStr, value: String(r.raw_meter_reading ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    }
  };

  const cancelEdit = () => {
    setEditRow(null);
    setEditReason('');
    setEditCustomReason('');
  };

  const saveEdit = async () => {
    if (!editRow) return;
    const originalRow = options.rows?.find((r: any) => r.id === editRow.id);
    if (!originalRow || !canEditEntry(originalRow, options.hasFullAccess, options.activeOperatorId)) {
      toast.error(
        originalRow?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can\'t be edited until a reviewer approves or rejects it.'
          : 'You can only edit your own entries, within 8 hours of submitting them.',
      );
      setEditRow(null);
      return;
    }
    if (!editReason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(editReason, editCustomReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);
    let error: any = null;
    const dtIso = new Date(editRow.datetime).toISOString();

    if (options.module === 'well') {
      const wellRow = options.rows?.find((r: any) => r.id === editRow.id);
      const wellCur = +editRow.value;
      const wellPrev = wellRow?.previous_reading;
      const wellDailyVol = wellPrev != null ? (editRow.isMeterReplacement ? 0 : wellCur - wellPrev) : null;
      const wellEditPayload: Record<string, any> = {
        current_reading: wellCur,
        power_meter_reading: editRow.value2 ? +editRow.value2 : null,
        reading_datetime: dtIso,
        daily_volume: wellDailyVol,
        is_estimated: false,
      };
      if (editRow.hasMeterReplacement) wellEditPayload.is_meter_replacement = !!editRow.isMeterReplacement;
      if (editRow.value4 !== undefined) wellEditPayload.tds_ppm = editRow.value4 ? +editRow.value4 : null;
      if (editRow.value6 !== undefined) wellEditPayload.turbidity_ntu = editRow.value6 ? +editRow.value6 : null;
      if (editRow.value5 !== undefined) wellEditPayload.pressure_psi = editRow.value5 ? +editRow.value5 : null;
      ({ error } = await (supabase.from('well_readings') as any).update(wellEditPayload).eq('id', editRow.id));
    } else if (options.module === 'locator') {
      const newCur = +editRow.value;
      ({ error } = await (supabase.from('locator_readings') as any).update({
        current_reading: newCur,
        reading_datetime: dtIso,
        is_meter_replacement: !!editRow.isMeterReplacement,
        is_estimated: false,
      }).eq('id', editRow.id));
      if (!error) await resyncLocatorChain(options.entityId);
    } else if (options.module === 'power') {
      const gridIdx = editRow.gridIdx ?? 0;
      const isSolarEditCtx = options.meterFilter?.type === 'solar';
      const editedDt = new Date(dtIso).toISOString();
      const editedDate = editedDt.slice(0, 10);
      let recomputedConsumption: number | null = null;
      if (gridIdx === 0 && !isSolarEditCtx) {
        try {
          const { data: pred } = await supabase
            .from('power_readings')
            .select('meter_reading_kwh')
            .eq('plant_id', options.entityId)
            .lt('reading_datetime', `${editedDate}T00:00:00.000Z`)
            .order('reading_datetime', { ascending: false })
            .limit(1);
          if (pred && pred.length > 0) {
            const delta = +editRow.value - (pred[0] as any).meter_reading_kwh;
            if (delta >= 0) recomputedConsumption = delta * (options.multiplier ?? 1);
          }
        } catch { /* non-critical */ }
      }
      const powerUpdatePayload: Record<string, any> = options.isSolarDirectMode
        ? {
            daily_solar_kwh: editRow.value2 ? +editRow.value2 : null,
            solar_meter_reading: null,
            reading_datetime: dtIso,
            is_meter_replacement: !!editRow.isMeterReplacement,
            is_estimated: false,
          }
        : {
            solar_meter_reading: editRow.value2 ? +editRow.value2 : null,
            reading_datetime: dtIso,
            is_meter_replacement: !!editRow.isMeterReplacement,
            is_estimated: false,
          };
      if (gridIdx === 0 && !isSolarEditCtx) {
        powerUpdatePayload.meter_reading_kwh = +editRow.value;
      }
      if (!isSolarEditCtx) {
        try {
          const { data: existingPR } = await (supabase.from('power_readings') as any)
            .select('grid_meter_readings').eq('id', editRow.id).maybeSingle();
          const existingGmr = (existingPR?.grid_meter_readings as Record<string, number> | null) ?? {};
          powerUpdatePayload.grid_meter_readings = { ...existingGmr, [String(gridIdx)]: +editRow.value };
        } catch { /* non-critical */ }
      }
      if (recomputedConsumption != null) {
        powerUpdatePayload.daily_consumption_kwh = recomputedConsumption;
        powerUpdatePayload.daily_grid_kwh = recomputedConsumption;
      }
      ({ error } = await (supabase.from('power_readings') as any).update(powerUpdatePayload).eq('id', editRow.id));
    }

    if (options.module === 'blending') {
      const blendPayload: Record<string, any> = {
        raw_meter_reading: +editRow.value,
        event_date: editRow.datetime.slice(0, 10),
        reading_datetime: new Date(editRow.datetime).toISOString(),
        is_meter_replacement: !!editRow.isMeterReplacement,
        is_estimated: false,
      };
      const { error: _ue, count: _uc } = await (supabase.from('blending_events' as any) as any)
        .update(blendPayload, { count: 'exact' })
        .eq('id', editRow.id);
      error = _ue ?? (_uc === 0 ? new Error('Update blocked — run the missing RLS policy SQL (see console)') : null);
      if (_uc === 0 && !_ue) console.error('blending_events UPDATE returned 0 rows. Add policy: CREATE POLICY "auth_update_blending_events" ON blending_events FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);');
    }
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logReadingEdit({
      table_name: auditTableName(options.module),
      record_id: editRow.id,
      plant_id: options.plantId ?? null,
      action: 'update',
      actor_user_id: options.user?.id ?? null,
      actor_label: actorLabel(),
      changes: diffFields(
        {
          current_reading: originalRow.current_reading,
          reading_datetime: originalRow.reading_datetime,
          is_meter_replacement: !!originalRow.is_meter_replacement,
        },
        {
          current_reading: +editRow.value,
          reading_datetime: dtIso,
          is_meter_replacement: !!editRow.isMeterReplacement,
        },
      ),
      reason: resolveReason(editReason, editCustomReason),
    });
    toast.success('Reading updated');
    setEditRow(null);
    setEditReason('');
    setEditCustomReason('');
    options.qc.invalidateQueries({ queryKey: options.queryKey });
    if (options.module === 'power') options.qc.invalidateQueries({ queryKey: ['op-power', options.entityId] });
    if (options.module === 'locator') invalidateLocatorDash(options.qc);
    else if (options.module === 'well') invalidateWellDash(options.qc);
    else if (options.module === 'power') invalidatePowerDash(options.qc);
    else if (options.module === 'blending') invalidateWellDash(options.qc);
  };

  const handleDelete = async (id: string) => {
    const row = options.rows?.find((r: any) => r.id === id);
    if (!row || !canEditEntry(row, options.hasFullAccess, options.activeOperatorId)) {
      toast.error(
        row?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can\'t be deleted until a reviewer approves or rejects it.'
          : 'You can only delete your own entries, within 8 hours of submitting them.',
      );
      setPendingDeleteId(null);
      return;
    }
    setPendingDeleteId(null);
    setDeletingId(id);
    let error: any = null;
    if (options.module === 'well') ({ error } = await supabase.from('well_readings').delete().eq('id', id));
    else if (options.module === 'locator') {
      ({ error } = await supabase.from('locator_readings').delete().eq('id', id));
      if (!error) await resyncLocatorChain(options.entityId);
    }
    else if (options.module === 'power') ({ error } = await supabase.from('power_readings').delete().eq('id', id));
    else if (options.module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).eq('id', id);
      error = _be ?? (_bc === 0 ? new Error('Delete blocked — check RLS policy on blending_events') : null);
      if (_bc === 0 && !_be) console.error('blending_events DELETE returned 0 rows. Add policy: CREATE POLICY "auth_delete_blending_events" ON blending_events FOR DELETE USING (auth.uid() IS NOT NULL);');
    }
    setDeletingId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    await logReadingEdit({
      table_name: auditTableName(options.module),
      record_id: id,
      plant_id: options.plantId ?? null,
      action: 'delete',
      actor_user_id: options.user?.id ?? null,
      actor_label: actorLabel(),
    });
    toast.success('Reading deleted');
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    options.qc.invalidateQueries({ queryKey: options.queryKey });
    if (options.module === 'power') options.qc.invalidateQueries({ queryKey: ['op-power', options.entityId] });
    if (options.module === 'locator') invalidateLocatorDash(options.qc);
    else if (options.module === 'well') invalidateWellDash(options.qc);
    else if (options.module === 'power') invalidatePowerDash(options.qc);
  };

  const handleToggleReplacement = async (r: any) => {
    const next = !r.is_meter_replacement;
    if (next && (options.module === 'well' || options.module === 'locator')) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    let error: any = null;
    if (options.module === 'well') {
      ({ error } = await (supabase.from('well_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
      if (error?.message?.includes('does not exist')) error = null;
    } else if (options.module === 'locator') {
      ({ error } = await (supabase.from('locator_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
      if (!error) await resyncLocatorChain(options.entityId);
    } else if (options.module === 'blending') {
      ({ error } = await (supabase.from('blending_events' as any) as any).update({ is_meter_replacement: next }).eq('id', r.id));
      if (error?.message?.includes('does not exist') || error?.message?.includes('is_meter_replacement')) error = null;
    }
    setTogglingId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(next ? 'Marked as meter replacement — Δ zeroed' : 'Meter replacement flag removed');
    options.qc.invalidateQueries({ queryKey: options.queryKey });
  };

  const handleToggleGridReplacement = async (r: any, gridIdx: number = 0) => {
    const currentRepl = !!(r.is_grid_replacement ?? r.is_meter_replacement);
    const next = !currentRepl;
    if (next) {
      setReplacePowerReadingId({ id: r.id, gridIdx });
      return;
    }
    setTogglingGridId(r.id);
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_grid_replacement: next }).eq('id', r.id);
    setTogglingGridId(null);
    if (error) {
      const { error: e2 } = await (supabase.from('power_readings') as any)
        .update({ is_meter_replacement: next }).eq('id', r.id);
      if (e2) { toast.error(friendlyError(e2)); return; }
    }
    toast.success('Grid replacement flag removed');
    options.qc.invalidateQueries({ queryKey: options.queryKey });
  };

  const handleToggleSolarReplacement = async (r: any) => {
    setTogglingSolarId(r.id);
    const next = !r.is_solar_replacement;
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_solar_replacement: next }).eq('id', r.id);
    setTogglingSolarId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(next ? 'Solar replacement marked — Δ zeroed' : 'Solar replacement flag removed');
    options.qc.invalidateQueries({ queryKey: options.queryKey });
  };

  const handleSelectOne = (id: string) => {
    const row = options.rows?.find((r: any) => r.id === id);
    if (!row || !canEditEntry(row, options.hasFullAccess, options.activeOperatorId)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!options.rows?.length) return;
    const editableIds = options.rows
      .filter((r: any) => canEditEntry(r, options.hasFullAccess, options.activeOperatorId))
      .map((r: any) => r.id);
    setSelectedIds(prev =>
      prev.size === editableIds.length ? new Set() : new Set(editableIds)
    );
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const idsRequested = [...selectedIds];
    const deletable = new Set(
      (options.rows ?? [])
        .filter((r: any) => canEditEntry(r, options.hasFullAccess, options.activeOperatorId))
        .map((r: any) => r.id),
    );
    const ids = idsRequested.filter(id => deletable.has(id));
    if (ids.length === 0) {
      toast.error('None of the selected rows are yours to delete, or they\u2019re past the 8-hour edit window.');
      return;
    }
    setBulkDeletePending(false);
    setBulkDeleting(true);
    let error: any = null;
    if (options.module === 'well')
      ({ error } = await supabase.from('well_readings').delete().in('id', ids));
    else if (options.module === 'locator') {
      ({ error } = await supabase.from('locator_readings').delete().in('id', ids));
      if (!error) await resyncLocatorChain(options.entityId);
    }
    else if (options.module === 'power')
      ({ error } = await supabase.from('power_readings').delete().in('id', ids));
    else if (options.module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).in('id', ids);
      error = _be ?? (_bc === 0 ? new Error('Bulk delete blocked — check RLS policy on blending_events') : null);
    }
    setBulkDeleting(false);
    if (error) { toast.error(friendlyError(error)); return; }
    const label = actorLabel();
    for (const id of ids) {
      await logReadingEdit({
        table_name: auditTableName(options.module),
        record_id: id,
        plant_id: options.plantId ?? null,
        action: 'delete',
        actor_user_id: options.user?.id ?? null,
        actor_label: label,
      });
    }
    toast.success(`${ids.length} reading(s) deleted`);
    setSelectedIds(new Set());
    options.qc.invalidateQueries({ queryKey: options.queryKey });
    if (options.module === 'power') options.qc.invalidateQueries({ queryKey: ['op-power', options.entityId] });
    if (options.module === 'locator') invalidateLocatorDash(options.qc);
    else if (options.module === 'well') invalidateWellDash(options.qc);
    else if (options.module === 'power') invalidatePowerDash(options.qc);
    else if (options.module === 'blending') invalidateWellDash(options.qc);
  };

  return {
    editRow, setEditRow,
    editReason, setEditReason,
    editCustomReason, setEditCustomReason,
    saving, setSaving,
    deletingId, setDeletingId,
    togglingId, setTogglingId,
    replaceReadingId, setReplaceReadingId,
    togglingGridId, setTogglingGridId,
    replacePowerReadingId, setReplacePowerReadingId,
    togglingSolarId, setTogglingSolarId,
    pendingDeleteId, setPendingDeleteId,
    selectedIds, setSelectedIds,
    bulkDeleting, setBulkDeleting,
    bulkDeletePending, setBulkDeletePending,
    startEdit, cancelEdit, saveEdit,
    handleDelete,
    handleToggleReplacement,
    handleToggleGridReplacement,
    handleToggleSolarReplacement,
    handleSelectOne, handleSelectAll, handleBulkDelete,
    resyncLocatorChain, auditTableName, actorLabel,
    localMidnight,
  };
}
