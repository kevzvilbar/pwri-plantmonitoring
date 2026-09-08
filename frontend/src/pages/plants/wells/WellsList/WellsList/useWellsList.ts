import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWellsForPlant } from '@/hooks/useWells';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlantMeterConfig, logStatusChange } from '../../../shared';
import { lastReadingFreshness } from '@/lib/format';
import { friendlyError } from '@/lib/supabaseErrors';
import { toast } from 'sonner';
import { fmtNum } from '@/lib/calculations';

export const PAGE_SIZE = 20;

export function useWellsList(plantId: string, highlightId?: string | null) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isManager, isAdmin, user, activeOperator } = useAuth();
  const { config: meterCfg, saveConfig: saveMeterCfg } = usePlantMeterConfig(plantId);

  const [wellDeleteReason, setWellDeleteReason] = useState('');
  const [wellDeleteBusy, setWellDeleteBusy] = useState(false);
  const [wellDeleteTarget, setWellDeleteTarget] = useState<any>(null);
  const [wellOfflineTarget, setWellOfflineTarget] = useState<any>(null);
  const [wellOfflineBusy, setWellOfflineBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [blendingBusy, setBlendingBusy] = useState<Set<string>>(new Set());
  const [powerBusy, setPowerBusy] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editingWell, setEditingWell] = useState<any>(null);
  const [showWellCsv, setShowWellCsv] = useState(false);
  const [wellPulseId, setWellPulseId] = useState<string | null>(null);
  const wellCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: wells, error: wellsError, refetch: refetchWells } = useWellsForPlant(plantId);

  const { data: latestWellReadings } = useQuery({
    queryKey: ['wells-latest-readings', plantId],
    queryFn: async () => {
      const { data } = await (supabase.from('well_readings_latest' as any) as any)
        .select('well_id, reading_datetime')
        .eq('plant_id', plantId);
      return (data ?? []) as { well_id: string; reading_datetime: string }[];
    },
  });

  const latestByWellId = useMemo(() => {
    const map: Record<string, string> = {};
    latestWellReadings?.forEach(r => { map[r.well_id] = r.reading_datetime; });
    return map;
  }, [latestWellReadings]);

  useEffect(() => {
    if (!highlightId) return;
    const el = wellCardRefs.current[highlightId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setWellPulseId(highlightId);
    const t = setTimeout(() => setWellPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, wells]);

  const { data: plant } = useQuery({
    queryKey: ['plant-name', plantId],
    queryFn: async () => (await supabase.from('plants').select('name').eq('id', plantId).single()).data,
  });

  const { data: blendingIds } = useQuery<string[]>({
    queryKey: ['blending-wells-tags', plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blending_wells')
        .select('well_id')
        .eq('plant_id', plantId);
      if (error) return [];
      return (data ?? []).map((r: any) => r.well_id).filter(Boolean);
    },
  });

  const blendingSet = useMemo(() => new Set(Array.isArray(blendingIds) ? blendingIds : []), [blendingIds]);

  const getWellElectricMode = (wellId: string): 'none' | 'dedicated' | 'shared' => {
    if (meterCfg.wells_shared_electric_groups.some(g => g.members.includes(wellId))) return 'shared';
    if (meterCfg.wells_dedicated_electric_ids.includes(wellId)) return 'dedicated';
    return 'none';
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (!wells) return;
    if (selected.size === wells.length) setSelected(new Set());
    else setSelected(new Set(wells.map((w: any) => w.id)));
  };

  const auditWellDelete = async (rows: { id: string; name: string }[], reason: string, bulk: boolean) => {
    try {
      const payload = rows.map((r) => ({
        kind: 'well',
        entity_id: r.id,
        entity_label: r.name ?? null,
        action: 'hard',
        reason: bulk ? `[BULK] ${reason}` : reason,
        performed_by: activeOperator?.id ?? user?.id ?? null,
        forced: false,
      }));
      await supabase.from('deletion_audit_log' as any).insert(payload as any);
    } catch (err) {
      console.warn('[Plants] deletion_audit_log insert failed (non-fatal):', err);
    }
  };

  const doWellDelete = async () => {
    if (!wellDeleteTarget) return;
    if (wellDeleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setWellDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'well', entity_id: wellDeleteTarget.id, entity_label: wellDeleteTarget.name, action: 'hard', reason: wellDeleteReason.trim(), performed_by: activeOperator?.id ?? user?.id ?? null, forced: false }] as any);
    } catch { /* audit log is best-effort */ }
    const { error } = await supabase.from('wells').delete().eq('id', wellDeleteTarget.id);
    setWellDeleteBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Well deleted');
    setWellDeleteTarget(null);
    setWellDeleteReason('');
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  const doBulkDelete = async () => {
    if (!selected.size) return;
    if (bulkReason.trim().length < 5) {
      toast.error('Please enter a reason of at least 5 characters.');
      return;
    }
    setBulkBusy(true);
    const ids = Array.from(selected);
    const rows = (wells ?? []).filter((w: any) => ids.includes(w.id)).map((w: any) => ({ id: w.id, name: w.name }));
    const { error } = await supabase.from('wells').delete().in('id', ids);
    if (error) {
      setBulkBusy(false);
      toast.error(friendlyError(error));
      return;
    }
    await auditWellDelete(rows, bulkReason.trim(), true);
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    setBulkReason('');
    setSelected(new Set());
    toast.success(`${ids.length} well(s) permanently deleted`);
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  const applyWellStatusChange = async (w: any, newStatus: 'Active' | 'Inactive', reasonCategory?: string, reasonDetail?: string) => {
    const { error } = await supabase.from('wells').update({ status: newStatus }).eq('id', w.id);
    if (error) { toast.error(friendlyError(error)); return; }
    await logStatusChange({
      user_id: activeOperator?.id ?? user?.id ?? null,
      plant_id: w.plant_id,
      entity_type: 'Well',
      entity_id: w.id,
      entity_label: w.name,
      from_status: w.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
      reason_category: reasonCategory ?? null,
      reason_detail: reasonDetail || null,
    });
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Well marked ${newStatus}`);
  };

  const toggleWellStatus = async (w: any) => {
    if (!isManager) return;
    if (w.status === 'Active') { setWellOfflineTarget(w); return; }
    await applyWellStatusChange(w, 'Active');
  };

  const toggleWellElectric = async (w: any) => {
    const mode = getWellElectricMode(w.id);
    const turningOff = mode !== 'none';
    setPowerBusy(prev => { const n = new Set(prev); n.add(w.id); return n; });
    const { error } = await supabase
      .from('wells')
      .update({ has_power_meter: !turningOff })
      .eq('id', w.id);
    if (error) {
      setPowerBusy(prev => { const n = new Set(prev); n.delete(w.id); return n; });
      toast.error(friendlyError(error));
      return;
    }
    const nextCfg = { ...meterCfg };
    if (turningOff) {
      nextCfg.wells_dedicated_electric_ids = nextCfg.wells_dedicated_electric_ids.filter(id => id !== w.id);
      nextCfg.wells_shared_electric_groups = nextCfg.wells_shared_electric_groups.map(g => ({
        ...g, members: g.members.filter(m => m !== w.id),
      }));
    } else {
      const alreadyShared = nextCfg.wells_shared_electric_groups.some(g => g.members.includes(w.id));
      if (!alreadyShared && !nextCfg.wells_dedicated_electric_ids.includes(w.id)) {
        nextCfg.wells_dedicated_electric_ids = [...nextCfg.wells_dedicated_electric_ids, w.id];
      }
    }
    await saveMeterCfg(nextCfg);
    setPowerBusy(prev => { const n = new Set(prev); n.delete(w.id); return n; });
    toast.success(turningOff ? `${w.name}: electricity metering removed`
      : `${w.name}: dedicated meter enabled — kWh input will appear in Operations`);
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
  };

  const toggleBlending = async (w: any, next: boolean) => {
    if (!isManager) return;
    setBlendingBusy((prev) => { const s = new Set(prev); s.add(w.id); return s; });
    try {
      if (next) {
        const { error } = await supabase
          .from('blending_wells')
          .upsert({ well_id: w.id, plant_id: plantId, tagged_at: new Date().toISOString(), tagged_by: activeOperator?.id ?? user?.id ?? null }, { onConflict: 'well_id' });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('blending_wells')
          .delete()
          .eq('well_id', w.id);
        if (error) throw new Error(error.message);
      }
      toast.success(next ? `${w.name}: marked as blending — its meter feeds product line separately`
        : `${w.name}: blending cleared`);
      qc.invalidateQueries({ queryKey: ['blending-wells-tags', plantId] });
      qc.invalidateQueries({ queryKey: ['blending-wells', plantId] });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBlendingBusy((prev) => { const s = new Set(prev); s.delete(w.id); return s; });
    }
  };

  const setDetailWell = (id: string) => setDetail(id);
  const setEditWell = (w: any) => setEditingWell(w);
  const setDeleteWell = (w: any) => { setWellDeleteTarget(w); setWellDeleteReason(''); };
  const setNavOperations = (w: any) => navigate(`/operations?tab=well&highlight=${w.id}`);

  return {
    isAdmin, isManager, qc,
    wells, latestWellReadings, latestByWellId, wellCardRefs, wellPulseId,
    wellOfflineTarget, wellOfflineBusy, blendingSet, detail, selectedWell, selected,
    bulkDeleteOpen, bulkReason, bulkBusy, blendingBusy, powerBusy, adding,
    wellDeleteTarget, wellDeleteReason, wellDeleteBusy, editingWell, showWellCsv,
    meterCfg, getWellElectricMode, plant,
    toggle, toggleAll, toggleWellStatus, toggleWellElectric, toggleBlending,
    doWellDelete, doBulkDelete, applyWellStatusChange,
    setDetail: setDetailWell, setSelectedWell, setSelected,
    setBulkDeleteOpen, setBulkReason, setBulkBusy,
    setWellOfflineTarget, setWellOfflineBusy,
    setAdding, setEditingWell: setEditWell, setShowWellCsv,
    setWellDeleteTarget: setDeleteWell, setWellDeleteReason,
    setWellDeleteBusy, setBlendingBusy, setPowerBusy,
    navigate,
  };
}
