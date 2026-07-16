import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';


import {
  EditWellDialog, AddWellDialog, EditElectricMeterDialog,
  EditHydraulicDialog, WellCsvImportDialog,
} from './WellDialogs';
import { ReplaceMeterDialog } from '../locators/LocatorDialogs';
import { EntityHistoryChart, MeterDetailButton } from '../charts/EntityHistoryChart';
import { CollapsibleSection, GridPylonIcon } from '../shared';

export function WellsList({ plantId }: { plantId: string }) {
  const qc = useQueryClient();
  const { isManager, isAdmin, user, activeOperator } = useAuth();
  const [wellDeleteReason, setWellDeleteReason] = useState('');
  const [wellDeleteBusy, setWellDeleteBusy] = useState(false);

  const doWellDelete = async () => {
    if (!wellDeleteTarget) return;
    if (wellDeleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setWellDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'well', entity_id: wellDeleteTarget.id, entity_label: wellDeleteTarget.name, action: 'hard', reason: wellDeleteReason.trim(), performed_by: activeOperator?.id ?? user?.id ?? null, forced: false }] as any);
    } catch {}
    const { error } = await supabase.from('wells').delete().eq('id', wellDeleteTarget.id);
    setWellDeleteBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Well deleted');
    setWellDeleteTarget(null);
    setWellDeleteReason('');
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };
  const { data: wells } = useQuery({
    queryKey: ['wells', plantId],
    queryFn: async () => (await supabase.from('wells').select('*').eq('plant_id', plantId).order('name')).data ?? [],
  });

  // Toggle a single well Active ↔ Inactive and write audit log
  const toggleWellStatus = async (w: any) => {
    if (!isManager) return;
    const newStatus = w.status === 'Active' ? 'Inactive' : 'Active';
    const { error } = await supabase.from('wells').update({ status: newStatus }).eq('id', w.id);
    if (error) { toast.error(error.message); return; }
    await logStatusChange({
      user_id: activeOperator?.id ?? user?.id ?? null,
      plant_id: w.plant_id,
      entity_type: 'Well',
      entity_id: w.id,
      entity_label: w.name,
      from_status: w.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Well marked ${newStatus}`);
  };
  // Plant-level blending state — used to render the blending checkbox
  // per row and to know which wells inject directly into the product line.
  const { data: plant } = useQuery({
    queryKey: ['plant-name', plantId],
    queryFn: async () => (await supabase.from('plants').select('name').eq('id', plantId).single()).data,
  });
  const { data: blendingIds } = useQuery<string[]>({
    queryKey: ['blending-wells', plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('well_blending')
        .select('well_id')
        .eq('plant_id', plantId);
      if (error) return [];
      return (data ?? []).map((r: any) => r.well_id).filter(Boolean);
    },
  });
  const blendingSet = new Set(Array.isArray(blendingIds) ? blendingIds : []);

  const [detail, setDetail] = useState<string | null>(null);
  // Inline graph expansion — click a well card to show its history chart
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  // Per-well blending-toggle in-flight indicator.
  const [blendingBusy, setBlendingBusy] = useState<Set<string>>(new Set());
  // Per-well power-meter toggle in-flight indicator.
  const [powerBusy, setPowerBusy] = useState<Set<string>>(new Set());
  // Add-well dialog visibility.
  const [adding, setAdding] = useState(false);
  // Well targeted for single deletion.
  const [wellDeleteTarget, setWellDeleteTarget] = useState<any>(null);
  // Well being edited.
  const [editingWell, setEditingWell] = useState<any>(null);
  // CSV import dialog visibility.
  const [showWellCsv, setShowWellCsv] = useState(false);

  // ── Meter config — used to derive each well's electric metering mode ──────────
  // WellsList reads the config to reflect the correct state in the Power pill, and
  // writes it when the pill is toggled so both data stores stay in sync.
  const { config: meterCfg, saveConfig: saveMeterCfg } = usePlantMeterConfig(plantId);

  /** Returns the electricity metering mode for a given well based on meter config. */
  const getWellElectricMode = (wellId: string): 'none' | 'dedicated' | 'shared' => {
    if (meterCfg.wells_shared_electric_groups.some(g => g.members.includes(wellId))) return 'shared';
    if (meterCfg.wells_dedicated_electric_ids.includes(wellId)) return 'dedicated';
    return 'none';
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
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
      // Log non-fatal: deletion_audit_log table may be missing pre-migration.
      // Surfacing keeps debugging easy without crashing the delete flow.
      // eslint-disable-next-line no-console
      console.warn('[Plants] deletion_audit_log insert failed (non-fatal):', err);
    }
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
    // Wells have ON DELETE CASCADE on readings/replacements/pms — Supabase
    // will remove dependent rows automatically.
    const { error } = await supabase.from('wells').delete().in('id', ids);
    if (error) {
      setBulkBusy(false);
      toast.error(error.message);
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

  // Toggle electricity metering on a well. Keeps both `wells.has_power_meter`
  // (which controls the kWh input in Operations) and `plant_meter_config`
  // (which controls topology / reporting groupings) in sync.
  //
  // Behaviour:
  //  • none  → dedicated  Adds to wells_dedicated_electric_ids, sets has_power_meter = true
  //  • dedicated → none   Removes from wells_dedicated_electric_ids, sets has_power_meter = false
  //  • shared → none      Removes from all shared groups, sets has_power_meter = false
  //                       (wells already in a shared group are managed via the config panel;
  //                        the pill is a quick escape hatch to remove them entirely)
  const toggleWellElectric = async (w: any) => {
    const mode = getWellElectricMode(w.id);
    const turningOff = mode !== 'none';

    setPowerBusy(prev => { const n = new Set(prev); n.add(w.id); return n; });

    // 1 — Update wells.has_power_meter (controls Operations kWh input)
    const { error } = await supabase
      .from('wells')
      .update({ has_power_meter: !turningOff })
      .eq('id', w.id);

    if (error) {
      setPowerBusy(prev => { const n = new Set(prev); n.delete(w.id); return n; });
      toast.error(`Power meter toggle failed: ${error.message}`);
      return;
    }

    // 2 — Sync meter config so topology / reporting stays consistent
    const nextCfg = { ...meterCfg };
    if (turningOff) {
      // Remove from dedicated list
      nextCfg.wells_dedicated_electric_ids = nextCfg.wells_dedicated_electric_ids.filter(id => id !== w.id);
      // Remove from every shared group
      nextCfg.wells_shared_electric_groups = nextCfg.wells_shared_electric_groups.map(g => ({
        ...g,
        members: g.members.filter(m => m !== w.id),
      }));
    } else {
      // Add to dedicated only if not already captured by a shared group
      const alreadyShared = nextCfg.wells_shared_electric_groups.some(g => g.members.includes(w.id));
      if (!alreadyShared && !nextCfg.wells_dedicated_electric_ids.includes(w.id)) {
        nextCfg.wells_dedicated_electric_ids = [...nextCfg.wells_dedicated_electric_ids, w.id];
      }
    }
    await saveMeterCfg(nextCfg);

    setPowerBusy(prev => { const n = new Set(prev); n.delete(w.id); return n; });
    toast.success(turningOff
      ? `${w.name}: electricity metering removed`
      : `${w.name}: dedicated meter enabled — kWh input will appear in Operations`);
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
  };

  const toggleBlending = async (w: any, next: boolean) => {
    if (!isManager) return;
    setBlendingBusy((prev) => { const s = new Set(prev); s.add(w.id); return s; });
    try {
      if (next) {
        const { error } = await supabase
          .from('well_blending')
          .upsert({ well_id: w.id, plant_id: plantId, tagged_at: new Date().toISOString(), tagged_by: activeOperator?.id ?? user?.id ?? null }, { onConflict: 'well_id' });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('well_blending')
          .delete()
          .eq('well_id', w.id);
        if (error) throw new Error(error.message);
      }
      toast.success(next
        ? `${w.name}: marked as blending — its meter feeds product line separately`
        : `${w.name}: blending cleared`);
      qc.invalidateQueries({ queryKey: ['blending-wells', plantId] });
    } catch (e: any) {
      toast.error(`Blending toggle failed: ${e.message || e}`);
    } finally {
      setBlendingBusy((prev) => { const s = new Set(prev); s.delete(w.id); return s; });
    }
  };

  if (detail) return <WellDetail wellId={detail} onBack={() => setDetail(null)} />;
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wells ({wells?.length ?? 0})</h3>
        <div className="flex items-center gap-1.5">
          {isAdmin && wells && wells.length > 0 && (
            <button
              onClick={toggleAll}
              className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
              data-testid="wells-toggle-all"
            >
              {selected.size === wells.length ? 'Clear' : 'Select all'}
            </button>
          )}
          {isAdmin && selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setBulkDeleteOpen(true)}
              data-testid="wells-bulk-delete-btn"
            >
              <Trash2 className="h-3 w-3 mr-1" />{selected.size}
            </Button>
          )}
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAdding(true)} data-testid="add-well-btn">
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setShowWellCsv(true)}>
              <Upload className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {wells?.map((w: any) => {
        const checked = selected.has(w.id);
        const isBlending = blendingSet.has(w.id);
        const blendingPending = blendingBusy.has(w.id);
        return (
          <Card
            key={w.id}
            className={`p-3 hover:shadow-elev border-l-2 ${checked ? 'ring-1 ring-primary' : ''} ${
              w.status === 'Active'
                ? 'border-l-emerald-400 dark:border-l-emerald-600'
                : 'border-l-muted-foreground/30'
            } ${isBlending ? 'border-teal-400' : ''}`}
            data-testid={`well-card-${w.id}`}
          >
            <div className="flex items-start gap-2">
              {isAdmin && (
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(w.id)}
                  className="mt-1 h-5 w-5 sm:h-4 sm:w-4 [&]:rounded-full sm:[&]:rounded-sm"
                  data-testid={`well-select-${w.id}`}
                />
              )}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setSelectedWell(selectedWell === w.id ? null : w.id)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
                      <span className="truncate">{w.name}</span>
                      <TrendingUp className={`h-3 w-3 transition-colors shrink-0 ${selectedWell === w.id ? 'text-teal-600' : 'text-muted-foreground/30'}`} />
                      {w.has_power_meter && (() => {
                        const elMode = getWellElectricMode(w.id);
                        return (
                          <span
                            className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${
                              elMode === 'shared'
                                ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                            }`}
                            title={elMode === 'shared' ? 'Shared kWh meter group' : 'Dedicated kWh meter'}
                          >
                            <Zap className="h-2.5 w-2.5" />
                            {elMode === 'shared' ? 'Shared kWh' : 'Electric'}
                          </span>
                        );
                      })()}
                      {isBlending && (
                        <span
                          className="text-[9px] uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 px-1.5 py-0.5 rounded"
                          title="Blending: separate water meter feeding product line"
                        >
                          Blending
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      {(w.diameter != null || w.drilling_depth_m != null) && (
                        <span>
                          {w.diameter ?? '—'}{w.drilling_depth_m != null ? ` · ${w.drilling_depth_m} m` : ''}
                        </span>
                      )}
                      {w.meter_serial && (
                        <span className="inline-flex items-center gap-0.5">
                          <Gauge className="h-2.5 w-2.5" /> Water SN {w.meter_serial}
                        </span>
                      )}
                      {w.has_power_meter && w.electric_meter_serial && (
                        <span className="inline-flex items-center gap-0.5">
                          <Zap className="h-2.5 w-2.5" /> kWh SN {w.electric_meter_serial}
                        </span>
                      )}
                      {(w.gps_lat != null && w.gps_lng != null) && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="h-2.5 w-2.5" /> {(+w.gps_lat).toFixed(4)}, {(+w.gps_lng).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleWellStatus(w); }}
                    title={isManager ? `Click to toggle status (currently ${w.status})` : w.status}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0 border transition-colors ${
                      w.status === 'Active'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                    } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${w.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    {w.status}
                  </button>
                </div>
              </div>
              {/* Right-side row controls — Blending and Power are independent
                  attributes (a well can be either, both, or neither). Hidden
                  during read-only roles. */}
              {isManager && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" title="Edit well" onClick={e => { e.stopPropagation(); setEditingWell(w); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete well" onClick={e => { e.stopPropagation(); setWellDeleteTarget(w); setWellDeleteReason(''); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
            {/* Blending + Power toggles as compact pill row below */}
            {isManager && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => toggleBlending(w, !isBlending)}
                  disabled={blendingPending}
                  className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border transition-colors ${
                    isBlending
                      ? 'bg-teal-700 border-teal-700 text-white'
                      : 'bg-background border-border text-muted-foreground hover:bg-muted'
                  } ${blendingPending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                  title={isBlending ? 'Blending on — click to clear' : 'Mark as blending well'}
                  data-testid={`well-blending-${w.id}`}
                >
                  {blendingPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${isBlending ? 'bg-white' : 'bg-muted-foreground'}`} />}
                  Blending
                </button>
                {/* Power pill — 3 states: none / dedicated / shared.
                    Reflects meter config and syncs both config + wells.has_power_meter on click. */}
                {(() => {
                  const elMode = getWellElectricMode(w.id);
                  return (
                    <button
                      onClick={() => toggleWellElectric(w)}
                      disabled={powerBusy.has(w.id)}
                      className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border transition-colors ${
                        elMode === 'dedicated'
                          ? 'bg-amber-600 border-amber-600 text-white'
                          : elMode === 'shared'
                          ? 'bg-teal-600 border-teal-600 text-white'
                          : 'bg-background border-border text-muted-foreground hover:bg-muted'
                      } ${powerBusy.has(w.id) ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                      title={
                        elMode === 'dedicated'
                          ? 'Dedicated meter — click to remove'
                          : elMode === 'shared'
                          ? 'In a shared meter group — click to remove from metering'
                          : 'No electric meter — click to add as dedicated'
                      }
                      data-testid={`well-power-${w.id}`}
                    >
                      {powerBusy.has(w.id)
                        ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        : <Zap className="h-2.5 w-2.5" />}
                      {elMode === 'dedicated' ? 'Dedicated' : elMode === 'shared' ? 'Shared' : 'Power'}
                    </button>
                  );
                })()}
              </div>
            )}
            {/* ── Details link ── */}
            <div className="mt-1.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setDetail(w.id)}
                className="text-[11px] text-teal-600 hover:underline inline-flex items-center gap-0.5"
              >
                Details →
              </button>
            </div>
            {/* ── Inline history chart ── */}
            {selectedWell === w.id && (
              <div className="mt-3 pt-3 border-t">
                <EntityHistoryChart entityId={w.id} entityType="well" entityName={w.name} />
              </div>
            )}
          </Card>
        );
      })}
      {!wells?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No Wells Yet</Card>}
      {adding && (
        <AddWellDialog plantId={plantId} onClose={() => {
          setAdding(false);
          qc.invalidateQueries({ queryKey: ['wells', plantId] });
        }} />
      )}
      {editingWell && <EditWellDialog well={editingWell} onClose={() => { setEditingWell(null); qc.invalidateQueries({ queryKey: ['wells', plantId] }); }} />}
      {showWellCsv && (
        <WellCsvImportDialog
          plantId={plantId}
          onClose={() => { setShowWellCsv(false); qc.invalidateQueries({ queryKey: ['wells', plantId] }); }}
        />
      )}

      {/* Single well delete confirm */}
      <AlertDialog open={!!wellDeleteTarget} onOpenChange={(o) => !o && !wellDeleteBusy && setWellDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete "{wellDeleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>All meter readings, hydraulic history, and replacement logs will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={wellDeleteReason} onChange={setWellDeleteReason} testId="well-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={wellDeleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doWellDelete} disabled={wellDeleteBusy || wellDeleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {wellDeleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {selected.size} well(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All meter readings, hydraulic history, and meter-replacement logs
              attached to the selected wells will be removed via the database
              cascade rule. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Reason <span className="text-danger">*</span>
              <span className="ml-1 text-[10px]">(min 5 chars — required for audit log)</span>
            </Label>
            <Textarea
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="e.g. Wells decommissioned after Q1 2026"
              maxLength={500}
              rows={2}
              data-testid="wells-bulk-reason"
              aria-invalid={bulkReason.length > 0 && bulkReason.trim().length < 5}
              className={bulkReason.length > 0 && bulkReason.trim().length < 5 ? 'border-danger' : ''}
            />
            {bulkReason.length > 0 && bulkReason.trim().length < 5 && (
              <p className="text-[10px] text-danger">
                Reason must be at least 5 characters ({bulkReason.trim().length}/5).
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doBulkDelete}
              disabled={bulkBusy || bulkReason.trim().length < 5}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-wells-bulk-delete"
            >
              {bulkBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}


function WellDetail({ wellId, onBack }: { wellId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [editHydraulicOpen, setEditHydraulicOpen] = useState(false);
  const [editElectricOpen, setEditElectricOpen] = useState(false);
  const { data: well } = useQuery({
    queryKey: ['well', wellId],
    queryFn: async () => (await supabase.from('wells').select('*').eq('id', wellId).single()).data,
  });
  const { data: pms } = useQuery({
    queryKey: ['well-pms', wellId],
    queryFn: async () => (await supabase.from('well_pms_records').select('*').eq('well_id', wellId).order('date_gathered', { ascending: false })).data ?? [],
  });
  const { data: latestReplacement } = useQuery({
    queryKey: ['well-latest-replacement', wellId],
    queryFn: async () => {
      const { data } = await supabase.from('well_meter_replacements')
        .select('*, replacer:user_profiles!well_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('well_id', wellId).order('replacement_date', { ascending: false }).limit(1);
      return (data?.[0] ?? null) as any;
    },
  });
  const { data: rawReadings = [] } = useQuery<any[]>({
    queryKey: ['well-raw-readings', wellId],
    queryFn: async () => {
      const { data } = await supabase
        .from('well_readings')
        .select('id, reading_datetime, current_reading, previous_reading, power_meter_reading, tds_ppm, pressure_psi')
        .eq('well_id', wellId)
        .order('reading_datetime', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  if (!well) return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  const latest = pms?.[0];
  const replacerName = latestReplacement?.replacer
    ? [latestReplacement.replacer.first_name, latestReplacement.replacer.last_name].filter(Boolean).join(' ')
    : null;
  const hasCoords = (well as any).gps_lat != null && (well as any).gps_lng != null;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${(well as any).gps_lat},${(well as any).gps_lng}` : null;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> Back to Wells
      </button>

      {/* Hero */}
      <Card className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-base">{well.name}</h3>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {well.diameter && <span>{well.diameter}</span>}
              {(well as any).drilling_depth_m && <span>{(well as any).drilling_depth_m} m depth</span>}
            </div>
            {hasCoords && (
              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                <MapPin className="h-3 w-3" />
                {(+(well as any).gps_lat).toFixed(5)}, {(+(well as any).gps_lng).toFixed(5)}
              </a>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
            well.status === 'Active'
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30'
              : 'text-muted-foreground bg-muted border-border'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${well.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
            {well.status ?? 'Active'}
          </span>
        </div>
      </Card>

      {/* Water Meter — popup button */}
      <MeterDetailButton
        label="Water Meter"
        icon={<Gauge className="h-4 w-4 text-blue-500" />}
        fields={[
          { label: 'Brand', value: well.meter_brand },
          { label: 'Size', value: well.meter_size ? `${well.meter_size} in` : null },
          { label: 'Serial No.', value: well.meter_serial },
          { label: 'Installed', value: well.meter_installed_date },
          { label: 'Last Replaced By', value: replacerName },
          { label: 'Replacement Date', value: latestReplacement?.replacement_date },
        ]}
      >
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceOpen(true)}>
          <Wrench className="h-3.5 w-3.5" /> Replace Meter
        </Button>
      </MeterDetailButton>

      {/* Electric Meter — popup button (if applicable) */}
      {well.has_power_meter && (
        <MeterDetailButton
          label="Electric Meter"
          icon={<Zap className="h-4 w-4 text-amber-500" />}
          fields={[
            { label: 'Brand', value: (well as any).electric_meter_brand },
            { label: 'Size', value: (well as any).electric_meter_size },
            { label: 'Serial No.', value: (well as any).electric_meter_serial },
            { label: 'Installed', value: (well as any).electric_meter_installed_date },
          ]}
        >
          {isManager && (
            <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setEditElectricOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit Electric Meter
            </Button>
          )}
        </MeterDetailButton>
      )}

      {/* Historical Consumption Chart */}
      <Card className="p-3">
        <EntityHistoryChart entityId={wellId} entityType="well" entityName={well.name} />
      </Card>

      {/* Hydraulic data */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-sky-500" /> Hydraulic Data
          </span>
          {isManager && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditHydraulicOpen(true)}>
              <Wrench className="h-3 w-3 mr-1" />Edit
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {([
            ['Drilling depth', `${(latest as any)?.drilling_depth_m ?? well.drilling_depth_m ?? '—'} m`],
            ['SWL', `${latest?.static_water_level_m ?? '—'} m`],
            ['PWL', `${latest?.pumping_water_level_m ?? '—'} m`],
            ['Pump setting', latest?.pump_setting ?? '—'],
            ['Motor HP', latest?.motor_hp ?? '—'],
            ['TDS (PMS)', `${latest?.tds_ppm ?? '—'} ppm`],
            ['TDS (daily)', `${(rawReadings as any[]).find((r: any) => r.tds_ppm != null)?.tds_ppm ?? '—'} ppm`],
            ['Pressure', `${(rawReadings as any[]).find((r: any) => r.pressure_psi != null)?.pressure_psi ?? '—'} psi`],
            ['Turbidity', `${latest?.turbidity_ntu ?? '—'} NTU`],
          ] as [string, string | number | null | undefined][]).map(([k, val]) => (
            <div key={k}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
              <div className="font-mono-num font-medium">{val ?? '—'}</div>
            </div>
          ))}
          {latest?.date_gathered && (
            <div className="col-span-2 text-[10px] text-muted-foreground pt-1">Last gathered: {latest.date_gathered}</div>
          )}
        </div>
        {pms && pms.length > 1 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              History ({pms.length} records)
            </summary>
            <div className="mt-2 space-y-0 text-[11px] max-h-48 overflow-y-auto">
              {(pms as any[]).map((p: any) => (
                <div key={p.id} className="border-t py-1.5 grid grid-cols-3 gap-x-2">
                  <span className="font-medium col-span-3">{p.date_gathered}</span>
                  <span className="text-muted-foreground">D: {p.drilling_depth_m ?? '—'}m</span>
                  <span className="text-muted-foreground">SWL: {p.static_water_level_m ?? '—'}m</span>
                  <span className="text-muted-foreground">PWL: {p.pumping_water_level_m ?? '—'}m</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Recent raw readings table */}
      {rawReadings.length > 0 && (
        <Card className="p-3" data-testid="well-raw-readings-card">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> Recent Readings
            {well.has_power_meter && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400 px-1.5 py-0.5 rounded">
                <Zap className="h-2.5 w-2.5" /> kWh tracked
              </span>
            )}
          </h4>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left px-1 py-1 font-medium">Date</th>
                  <th className="text-right px-1 py-1 font-medium">Water m³</th>
                  <th className="text-right px-1 py-1 font-medium">Δ</th>
                  {well.has_power_meter && <th className="text-right px-1 py-1 font-medium">kWh</th>}
                  <th className="text-right px-1 py-1 font-medium">TDS (ppm)</th>
                  <th className="text-right px-1 py-1 font-medium">Pressure (psi)</th>
                </tr>
              </thead>
              <tbody>
                {rawReadings.map((r: any) => {
                  const delta = r.previous_reading != null && r.current_reading != null
                    ? +r.current_reading - +r.previous_reading : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-1 py-1 text-muted-foreground whitespace-nowrap">
                        {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-1 py-1 text-right font-mono-num">{r.current_reading != null ? fmtNum(+r.current_reading) : '—'}</td>
                      <td className="px-1 py-1 text-right font-mono-num text-muted-foreground">{delta != null ? fmtNum(delta) : '—'}</td>
                      {well.has_power_meter && (
                        <td className="px-1 py-1 text-right font-mono-num text-amber-700 dark:text-amber-300">
                          {r.power_meter_reading != null ? fmtNum(+r.power_meter_reading) : '—'}
                        </td>
                      )}
                      <td className="px-1 py-1 text-right font-mono-num">
                        {r.tds_ppm != null ? fmtNum(+r.tds_ppm) : '—'}
                      </td>
                      <td className="px-1 py-1 text-right font-mono-num">
                        {r.pressure_psi != null ? fmtNum(+r.pressure_psi) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {replaceOpen && (
        <ReplaceMeterDialog kind="well" assetId={wellId} plantId={well.plant_id} oldSerial={well.meter_serial}
          onClose={() => {
            setReplaceOpen(false);
            qc.invalidateQueries({ queryKey: ['well', wellId] });
            qc.invalidateQueries({ queryKey: ['well-latest-replacement', wellId] });
          }}
        />
      )}
      {editHydraulicOpen && (
        <EditHydraulicDialog well={well} latest={latest} onClose={() => {
          setEditHydraulicOpen(false);
          qc.invalidateQueries({ queryKey: ['well-pms', wellId] });
          qc.invalidateQueries({ queryKey: ['well', wellId] });
        }} />
      )}
      {editElectricOpen && (
        <EditElectricMeterDialog well={well} onClose={() => {
          setEditElectricOpen(false);
          qc.invalidateQueries({ queryKey: ['well', wellId] });
          qc.invalidateQueries({ queryKey: ['wells', well.plant_id] });
        }} />
      )}
    </div>
  );
}

