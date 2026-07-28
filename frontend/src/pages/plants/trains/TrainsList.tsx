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
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


import {
  EditTrainDialog, TrainOperatorLogModal, TrainRODetailCharts,
  PretreatAFMChart, PretreatBoosterChart, PretreatCFChart, PretreatHPPChart,
} from './TrainDetail';
import { MeterDetailButton } from '../charts/EntityHistoryChart';
import { ReplaceTrainMeterDialog } from '../../ro-trains/ReplaceTrainMeterDialog';
import { parseCsv, downloadTemplate, CsvPreviewTable, CollapsibleSection, logStatusChange } from '../shared';
import { ReasonDialog } from '@/components/ReasonDialog';
import type { ReasonCategory } from '@/lib/reasonCodes';
import { ReasonField } from '../locators/LocatorDialogs';

export function TrainsList({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const { data: plants } = usePlants();
  const plant = plants?.find((p) => p.id === plantId);

  const qc = useQueryClient();
  const { isManager, isAdmin, user, activeOperator } = useAuth();
  const { data: trains } = useQuery({
    queryKey: ['ro-trains', plantId],
    queryFn: async () =>
      (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? [],
  });

  // Derive Running/Offline using the same 2-hr data rule as the Overview tab.
  // Avoids relying on the raw DB status field which defaults to 'Offline' for all trains.
  const trainIdsKey = (trains ?? []).map((t: any) => t.id).join(',');
  const { data: recentTrainIds } = useQuery({
    queryKey: ['ro-trains-recent', plantId, trainIdsKey],
    queryFn: async () => {
      const ids = (trains ?? []).map((t: any) => t.id);
      if (!ids.length) return new Set<string>();
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id')
        .in('train_id', ids)
        .gte('reading_datetime', twoHoursAgo);
      return new Set((data ?? []).map((r: any) => r.train_id));
    },
    enabled: (trains ?? []).length > 0,
  });

  // Maintenance => Maintenance (hard lock) | recent data => Running | else Offline
  const deriveTrainStatus = (t: any): 'Running' | 'Maintenance' | 'Offline' => {
    if (t.status === 'Maintenance') return 'Maintenance';
    if (recentTrainIds?.has(t.id)) return 'Running';
    return 'Offline';
  };

  // Latest meter replacement per (train, meter_type) — powers the "Last
  // Replaced By" / "Replacement Date" fields in each train's Feed/Permeate/
  // Reject MeterDetailButton popups. Fetched once for the whole plant and
  // indexed client-side, same pattern as ProductMeters.tsx.
  const { data: trainMeterReplacements } = useQuery({
    queryKey: ['ro-train-meter-replacements', plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_train_meter_replacements' as any)
        .select('*, replacer:user_profiles!ro_train_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('plant_id', plantId)
        .order('replacement_date', { ascending: false });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const latestTrainReplacement = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trainMeterReplacements ?? []) {
      const key = `${r.train_id}:${r.meter_type}`;
      if (!map[key]) map[key] = r;
    }
    return map;
  }, [trainMeterReplacements]);

  const [editTrain, setEditTrain] = useState<any | null>(null);
  const [trainDeleteTarget, setTrainDeleteTarget] = useState<any | null>(null);
  const [trainDeleteReason, setTrainDeleteReason] = useState('');
  const [trainDeleteBusy, setTrainDeleteBusy] = useState(false);
  const [showAddTrain, setShowAddTrain] = useState(false);
  const [addTrainBusy, setAddTrainBusy] = useState(false);
  const [showTrainCsv, setShowTrainCsv] = useState(false);

  const doAddTrain = async (form: {
    train_number: number; name: string;
    num_afm: number; num_booster_pumps: number; num_cartridge_filters: number;
    num_controllers: number; num_filter_housings: number; num_hp_pumps: number;
  }) => {
    setAddTrainBusy(true);
    const { error } = await supabase.from('ro_trains').insert({
      plant_id: plantId,
      train_number: form.train_number,
      name: form.name || null,
      num_afm: form.num_afm,
      num_booster_pumps: form.num_booster_pumps,
      num_cartridge_filters: form.num_cartridge_filters,
      num_controllers: form.num_controllers,
      num_filter_housings: form.num_filter_housings,
      num_hp_pumps: form.num_hp_pumps,
      status: 'Running' as any,
    });
    setAddTrainBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('RO Train added');
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    setShowAddTrain(false);
  };

  const doTrainDelete = async () => {
    if (!trainDeleteTarget) return;
    if (trainDeleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setTrainDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'ro_train', entity_id: trainDeleteTarget.id, entity_label: `Train ${trainDeleteTarget.train_number}`, action: 'hard', reason: trainDeleteReason.trim(), performed_by: activeOperator?.id ?? user?.id ?? null, forced: false }] as any);
    } catch { /* audit log is best-effort — don't block the delete */ }
    const { error } = await supabase.from('ro_trains').delete().eq('id', trainDeleteTarget.id);
    setTrainDeleteBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Train deleted');
    setTrainDeleteTarget(null);
    setTrainDeleteReason('');
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
  };

  // Resolve the effective media/filter type for a given train:
  // Train-level override wins; falls back to plant default; then hardcoded default.
  const [trainOfflineTarget, setTrainOfflineTarget] = useState<{ train: any; newStatus: 'Offline' | 'Maintenance' } | null>(null);
  const [trainOfflineBusy, setTrainOfflineBusy] = useState(false);

  const applyTrainStatusChange = async (t: any, newStatus: 'Running' | 'Offline' | 'Maintenance', reasonCategory?: ReasonCategory, reasonDetail?: string) => {
    const { error } = await supabase.from('ro_trains').update({ status: newStatus }).eq('id', t.id);
    if (error) { toast.error(friendlyError(error)); return; }
    await logStatusChange({
      user_id: activeOperator?.id ?? user?.id ?? null,
      plant_id: t.plant_id,
      entity_type: 'RO Train',
      entity_id: t.id,
      entity_label: `Train ${t.train_number}${t.name ? ' · ' + t.name : ''}`,
      from_status: t.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
      reason_category: reasonCategory ?? null,
      reason_detail: reasonDetail || null,
    });
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Train ${t.train_number} → ${newStatus}`);
  };

  const toggleTrainStatus = async (t: any) => {
    if (!isManager) return;
    // Cycle through effective status: Running → Offline → Maintenance → Running
    //   Offline = no recent data (data will flip it back to Running automatically)
    //   Maintenance = hard manual lock that beats even live data
    const effectiveStatus = deriveTrainStatus(t);
    const cycle: Record<'Running' | 'Offline' | 'Maintenance', 'Running' | 'Offline' | 'Maintenance'> =
      { Running: 'Offline', Offline: 'Maintenance', Maintenance: 'Running' };
    const newStatus = cycle[effectiveStatus] ?? 'Running';
    if (newStatus === 'Offline' || newStatus === 'Maintenance') {
      setTrainOfflineTarget({ train: t, newStatus });
      return;
    }
    await applyTrainStatusChange(t, newStatus);
  };

  const effectiveMediaType = (t: any) =>
    t.filter_media_type ?? plant?.filter_media_type ?? 'AFM';
  const effectiveFilterType = (t: any) =>
    t.filter_housing_type ?? plant?.filter_housing_type ?? 'Cartridge Filter';

  // Per-train active component graph: maps trainId → active section key
  // Sections: 'afm' | 'booster' | 'hpp' | 'ro' | null (none expanded)
  const [activeSection, setActiveSection] = useState<Record<string, string | null>>({});
  const toggleSection = (trainId: string, section: string) => {
    setActiveSection(prev => ({
      ...prev,
      [trainId]: prev[trainId] === section ? null : section,
    }));
  };

  // ── Component-selector button — defined outside map() to avoid React remount
  const CompBtn = ({
    trainId: tid, activeKey, sectionKey, icon, label, count,
  }: {
    trainId: string; activeKey: string | null;
    sectionKey: string; icon: React.ReactNode; label: string; count?: number;
  }) => (
    <button
      onClick={() => toggleSection(tid, sectionKey)}
      className={[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all',
        activeKey === sectionKey
          ? 'bg-primary-soft border-primary text-primary'
          : 'bg-muted/40 border-border text-muted-foreground hover:border-primary/90 hover:text-foreground hover:bg-muted/60',
      ].join(' ')}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className="ml-0.5 text-2xs font-normal opacity-70">×{count}</span>
      )}
      <TrendingUp className={`h-2.5 w-2.5 ml-0.5 transition-colors ${activeKey === sectionKey ? 'text-primary' : 'opacity-30'}`} />
    </button>
  );

  const [logTrain, setLogTrain] = useState<{ id: string; label: string } | null>(null);
  const [replaceTrainMeter, setReplaceTrainMeter] = useState<{ trainId: string } | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-2 pt-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          RO Trains{' '}
          <span className="font-normal">
            ({trains ? `${trains.filter((t: any) => deriveTrainStatus(t) === 'Running').length}/${trains.length}` : '0/0'})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {isManager && (
            <Button size="sm" variant="outline" className="h-8 px-3 text-xs gap-1.5" onClick={() => setShowAddTrain(true)}>
              <Plus className="h-3.5 w-3.5" />Add
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setShowTrainCsv(true)} title="Import CSV">
              <Upload className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {trains?.map((t: any) => {
        const mt = effectiveMediaType(t);
        const ft = effectiveFilterType(t);
        const effectiveStatus = deriveTrainStatus(t);
        const borderColor =
          effectiveStatus === 'Running'     ? 'border-l-emerald-400 dark:border-l-emerald-600' :
          effectiveStatus === 'Maintenance' ? 'border-l-amber-400 dark:border-l-amber-500'     :
                                              'border-l-muted-foreground/30';
        const activeKey = activeSection[t.id] ?? null;
        const trainLabel = `Train ${t.train_number}${t.name ? ` · ${t.name}` : ''}`;

        // Resolved component counts (fall back to 0)
        const numAfm   = t.num_afm            ?? 0;
        const numBp    = t.num_booster_pumps  ?? 0;
        const numHpp   = t.num_hp_pumps       ?? 0;
        const numCf    = t.num_cartridge_filters ?? 0;
        const numCtrl  = t.num_controllers    ?? 0;

        return (
          <Card key={t.id} className={`overflow-hidden border-l-2 ${borderColor}`} data-testid={`train-card-${t.id}`}>
            {/* ── Train header ── */}
            <div className="p-3 flex justify-between items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">
                  {trainLabel}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>{mt} × {numAfm}</span>
                  <span>BP × {numBp}</span>
                  <span>HPP × {numHpp}</span>
                  <span>{ft === 'Bag Filter' ? 'Filter Housing' : 'CF Housing'} × {numCf}</span>
                  {numCtrl > 0 && <span>Ctrl × {numCtrl}</span>}
                </div>
                {/* Type badges */}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="inline-flex items-center text-2xs font-medium px-1.5 py-0.5 rounded bg-primary-soft text-primary border border-primary">{mt}</span>
                  <span className="inline-flex items-center text-2xs font-medium px-1.5 py-0.5 rounded bg-info-soft text-info border border-info">{ft}</span>
                </div>
              </div>
              {/* Status + edit actions */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleTrainStatus(t)}
                  title={isManager ? `Click to cycle status (currently ${effectiveStatus})` : effectiveStatus}
                  className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border transition-colors ${
                    effectiveStatus === 'Running'
                      ? 'text-accent bg-accent-soft border-accent hover:bg-accent-soft'
                      : effectiveStatus === 'Maintenance'
                        ? 'text-warn bg-warn-soft border-warn hover:bg-warn-soft'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                  } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    effectiveStatus === 'Running' ? 'bg-accent'
                    : effectiveStatus === 'Maintenance' ? 'bg-warn'
                    : 'bg-muted-foreground'
                  }`} />
                  {effectiveStatus}
                </button>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                    onClick={() => setEditTrain(t)} data-testid={`edit-train-${t.id}`}>
                    <Wrench className="h-3 w-3 mr-1" />Edit
                  </Button>
                  {isManager && (
                    <Button size="sm" variant="ghost"
                      className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete train"
                      onClick={() => { setTrainDeleteTarget(t); setTrainDeleteReason(''); }}
                      data-testid={`delete-train-${t.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ══ PRE-TREATMENT SECTION ══ */}
            <div className="border-t border-border/60">
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                <span className="text-3xs font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-accent-soft text-accent border border-accent">
                  Pre-treatment
                </span>
                <span className="text-2xs text-muted-foreground">{mt} → Booster Pump → Pre-filter</span>
              </div>
              <div className="px-3 pb-3 flex flex-wrap gap-2">
                {numAfm > 0 && (
                  <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="afm"
                    icon={<Gauge className="h-3 w-3" />} label={mt} count={numAfm} />
                )}
                {numBp > 0 && (
                  <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="booster"
                    icon={<Wrench className="h-3 w-3" />} label="Booster Pump" count={numBp} />
                )}
                {/* CF Housing — NOW CLICKABLE */}
                {numCf > 0 && (
                  <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="cf"
                    icon={<Wrench className="h-3 w-3" />}
                    label={ft === 'Bag Filter' ? 'Filter Housing' : 'CF Housing'}
                    count={numCf} />
                )}
              </div>

              {/* AFM expanded */}
              {activeKey === 'afm' && (
                <div className="px-3 pb-3 pt-0 border-t border-dashed border-border/50">
                  <div className="mt-3">
                    <PretreatAFMChart trainId={t.id} mediaType={mt} />
                  </div>
                </div>
              )}

              {/* Booster expanded */}
              {activeKey === 'booster' && (
                <div className="px-3 pb-3 pt-0 border-t border-dashed border-border/50">
                  <div className="mt-3">
                    <PretreatBoosterChart trainId={t.id} />
                  </div>
                </div>
              )}

              {/* CF Housing expanded */}
              {activeKey === 'cf' && (
                <div className="px-3 pb-3 pt-0 border-t border-dashed border-border/50">
                  <div className="mt-3">
                    <PretreatCFChart trainId={t.id} filterType={ft} />
                  </div>
                </div>
              )}
            </div>

            {/* ══ RO SECTION ══ */}
            <div className="border-t border-border/60">
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                <span className="text-3xs font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-info-soft text-info border border-info">
                  RO
                </span>
                <span className="text-2xs text-muted-foreground">HPP → RO Membranes → Permeate</span>
              </div>
              <div className="px-3 pb-3 flex flex-wrap gap-2">
                {numHpp > 0 && (
                  <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="hpp"
                    icon={<Zap className="h-3 w-3" />} label="High Pressure Pump" count={numHpp} />
                )}
                <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="ro"
                  icon={<BarChart2 className="h-3 w-3" />} label="RO Performance" />
                <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="meters"
                  icon={<Gauge className="h-3 w-3" />} label="Meters" />
              </div>

              {/* HPP expanded — target vs actual */}
              {activeKey === 'hpp' && (
                <div className="px-3 pb-3 pt-0 border-t border-dashed border-border/50">
                  <div className="mt-3">
                    <PretreatHPPChart trainId={t.id} />
                  </div>
                </div>
              )}
              {/* Expanded RO performance mini-charts grid */}
              {activeKey === 'ro' && (
                <div className="px-3 pb-3 pt-0 border-t border-dashed border-border/50">
                  <div className="mt-3">
                    <TrainRODetailCharts trainId={t.id} trainLabel={trainLabel} />
                  </div>
                </div>
              )}
              {/* Feed / Permeate / Reject meter identity — Replace Meter dialog
                  itself asks which of the three was swapped (see
                  ReplaceTrainMeterDialog), so one button covers all three. */}
              {activeKey === 'meters' && (
                <div className="px-3 pb-3 pt-0 border-t border-dashed border-border/50">
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {(['feed', 'permeate', 'reject'] as const).map((mt) => {
                      const latest = latestTrainReplacement[`${t.id}:${mt}`];
                      const replacerName = latest?.replacer
                        ? [latest.replacer.first_name, latest.replacer.last_name].filter(Boolean).join(' ')
                        : null;
                      return (
                        <MeterDetailButton
                          key={mt}
                          label={`${mt[0].toUpperCase()}${mt.slice(1)} Meter`}
                          icon={<Gauge className="h-4 w-4 text-info" />}
                          fields={[
                            { label: 'Brand', value: t[`${mt}_meter_brand`] },
                            { label: 'Size', value: t[`${mt}_meter_size`] ? `${t[`${mt}_meter_size`]} in` : null },
                            { label: 'Serial No.', value: t[`${mt}_meter_serial`] },
                            { label: 'Installed', value: t[`${mt}_meter_installed_date`] },
                            { label: 'Last Replaced By', value: replacerName },
                            { label: 'Replacement Date', value: latest?.replacement_date },
                          ]}
                        />
                      );
                    })}
                  </div>
                  {isManager && (
                    <Button size="sm" variant="outline" className="mt-2 gap-1.5"
                      onClick={() => setReplaceTrainMeter({ trainId: t.id })}>
                      <Wrench className="h-3.5 w-3.5" /> Replace Meter
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
      {!trains?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No trains yet</Card>}

      <AddTrainDialog
        open={showAddTrain}
        onOpenChange={setShowAddTrain}
        defaultTrainNumber={(trains?.length ?? 0) + 1}
        onSubmit={doAddTrain}
        loading={addTrainBusy}
        plantFilterType={plant?.filter_housing_type ?? 'Cartridge Filter'}
        plantMediaType={plant?.filter_media_type ?? 'AFM'}
      />
      {showTrainCsv && (
        <TrainCsvImportDialog
          plantId={plantId}
          plantFilterType={plant?.filter_housing_type ?? 'Cartridge Filter'}
          plantMediaType={plant?.filter_media_type ?? 'AFM'}
          onClose={() => { setShowTrainCsv(false); qc.invalidateQueries({ queryKey: ['ro-trains', plantId] }); }}
        />
      )}

      {editTrain && plant && (
        <EditTrainDialog
          train={editTrain}
          plant={plant}
          onClose={() => {
            setEditTrain(null);
            qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
          }}
        />
      )}

      <AlertDialog open={!!trainDeleteTarget} onOpenChange={(o) => !o && !trainDeleteBusy && setTrainDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete Train {trainDeleteTarget?.train_number}?</AlertDialogTitle>
            <AlertDialogDescription>All logs associated with this train will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={trainDeleteReason} onChange={setTrainDeleteReason} testId="train-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trainDeleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doTrainDelete} disabled={trainDeleteBusy || trainDeleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {trainDeleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasonDialog
        open={!!trainOfflineTarget}
        onOpenChange={(o) => !o && setTrainOfflineTarget(null)}
        title={`Mark Train ${trainOfflineTarget?.train.train_number} ${trainOfflineTarget?.newStatus}?`}
        description="This status change will explain any gaps in Data Summary while the train is down."
        confirmLabel={`Mark ${trainOfflineTarget?.newStatus ?? ''}`}
        busy={trainOfflineBusy}
        onConfirm={async (category, detail) => {
          if (!trainOfflineTarget) return;
          setTrainOfflineBusy(true);
          await applyTrainStatusChange(trainOfflineTarget.train, trainOfflineTarget.newStatus, category, detail);
          setTrainOfflineBusy(false);
          setTrainOfflineTarget(null);
        }}
      />

      {logTrain && (
        <TrainOperatorLogModal
          trainId={logTrain.id}
          trainLabel={logTrain.label}
          plantId={plantId}
          onClose={() => setLogTrain(null)}
        />
      )}

      {replaceTrainMeter && (
        <ReplaceTrainMeterDialog
          trainId={replaceTrainMeter.trainId}
          plantId={plantId}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
            qc.invalidateQueries({ queryKey: ['ro-train-meter-replacements', plantId] });
            qc.invalidateQueries({ queryKey: ['train-meter-identity', replaceTrainMeter.trainId] });
          }}
          onClose={() => setReplaceTrainMeter(null)}
        />
      )}
    </div>
  );
}

// ─── Add Train Dialog ─────────────────────────────────────────────────────────

export type AddTrainFormData = {
  train_number: number; name: string;
  num_afm: number; num_booster_pumps: number; num_cartridge_filters: number;
  num_controllers: number; num_filter_housings: number; num_hp_pumps: number;
};

export function AddTrainDialog({ open, onOpenChange, defaultTrainNumber, onSubmit, loading,
  plantFilterType = 'Cartridge Filter', plantMediaType = 'AFM',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTrainNumber: number;
  onSubmit: (form: AddTrainFormData) => void;
  loading: boolean;
  plantFilterType?: 'Cartridge Filter' | 'Bag Filter';
  plantMediaType?: 'AFM' | 'MMF';
}) {
  const isBagFilter = plantFilterType === 'Bag Filter';

  const blank = (): AddTrainFormData => ({
    train_number: defaultTrainNumber, name: '',
    num_afm: 2, num_booster_pumps: 1, num_cartridge_filters: 1,
    num_controllers: 1,
    // num_filter_housings is merged into num_cartridge_filters for Bag Filter plants
    num_filter_housings: isBagFilter ? 0 : 1,
    num_hp_pumps: 1,
  });
  const [form, setForm] = useState<AddTrainFormData>(blank);

  useEffect(() => {
    if (open) setForm({ ...blank(), train_number: defaultTrainNumber });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTrainNumber]);

  const num = (field: keyof AddTrainFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: parseInt(e.target.value) || 0 }));

  // Dynamic labels based on plant-wide component types:
  // - Media field:  "AFM Units" or "MMF Units" (follows plantMediaType)
  // - Housing field: ONE combined pre-filter field whose label reflects plantFilterType:
  //     Cartridge Filter → "Cartridge Filter Housing"  (num_cartridge_filters)
  //     Bag Filter       → "Filter Housing"            (num_cartridge_filters)
  //   num_filter_housings is always hidden — it is merged into this single field.
  // - HP Pumps → "High Pressure Pumps"
  const afmLabel = `${plantMediaType} Units`;
  const housingLabel = isBagFilter ? 'Filter Housing' : 'Cartridge Filter Housing';
  // Always hide the separate num_filter_housings — merged into housingLabel above.
  const fields: { key: keyof AddTrainFormData; label: string; hide?: boolean }[] = [
    { key: 'num_afm',               label: afmLabel         },
    { key: 'num_booster_pumps',     label: 'Booster Pumps'  },
    { key: 'num_cartridge_filters', label: housingLabel      },
    { key: 'num_controllers',       label: 'Controllers'    },
    { key: 'num_filter_housings',   label: 'Filter Housings', hide: true },
    { key: 'num_hp_pumps',          label: 'High Pressure Pumps' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add RO Train</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Train Number</Label>
              <Input type="number" min={1} value={form.train_number} onChange={num('train_number')} />
            </div>
            <div>
              <Label>Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input placeholder="e.g. Train A" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fields.filter(f => !f.hide).map(({ key, label }) => (
              <div key={key}>
                <Label>{label}</Label>
                <Input type="number" min={0} value={form[key] as number} onChange={num(key)} />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={loading}>
            {loading ? 'Adding…' : 'Add Train'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared CSV utilities ─────────────────────────────────────────────────────


export function getTrainCsvHeaders(
  plantMediaType: 'AFM' | 'MMF' = 'AFM',
  plantFilterType: 'Cartridge Filter' | 'Bag Filter' = 'Cartridge Filter',
): string[] {
  // Column name mirrors the plant-wide filter type so the CSV is self-documenting.
  const housingCol = plantFilterType === 'Bag Filter' ? 'filter_housing' : 'cartridge_filter_housing';
  const afmCol     = plantMediaType === 'MMF' ? 'num_mmf' : 'num_afm';
  return [
    'train_number', 'name',
    afmCol, 'num_booster_pumps',
    housingCol,
    'num_controllers', 'num_hp_pumps',
    // Power meter topology — leave blank for trains with individual meters.
    // Trains sharing one physical meter get the SAME non-empty group label
    // e.g. "colbox" for Umapad Colbox 1/2/3. Used for volume-weighted kWh allocation.
    'shared_power_meter_group',
  ];
}

export function TrainCsvImportDialog({ plantId, onClose,
  plantFilterType = 'Cartridge Filter', plantMediaType = 'AFM',
}: { plantId: string; onClose: () => void;
     plantFilterType?: 'Cartridge Filter' | 'Bag Filter';
     plantMediaType?: 'AFM' | 'MMF'; }) {
  const isBagFilter = plantFilterType === 'Bag Filter';
  // Dynamic CSV headers based on plant component types
  const TRAIN_CSV_HEADERS = getTrainCsvHeaders(plantMediaType, plantFilterType);
  const housingCol = isBagFilter ? 'filter_housing' : 'cartridge_filter_housing';
  const afmCol     = plantMediaType === 'MMF' ? 'num_mmf' : 'num_afm';
  // Human-readable notes shown in the dialog
  const headerNotes = [
    `${afmCol} = ${plantMediaType} Units`,
    'num_booster_pumps = Booster Pumps',
    `${housingCol} = ${isBagFilter ? 'Filter Housing' : 'Cartridge Filter Housing'}`,
    'num_controllers = Controllers',
    'num_hp_pumps = High Pressure Pumps',
    'shared_power_meter_group = same label on trains that share one physical power meter (leave blank if each train has its own)',
  ].join(' · ');

  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setRows(parseCsv(ev.target?.result as string));
      setErrors([]);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    const errs: string[] = [];
    rows.forEach((r, i) => {
      if (!r.train_number || isNaN(+r.train_number)) errs.push(`Row ${i + 1}: train_number must be a number`);
      // Warn if a shared_power_meter_group value contains spaces or special chars
      if (r.shared_power_meter_group && /[^a-zA-Z0-9_-]/.test(r.shared_power_meter_group.trim())) {
        errs.push(`Row ${i + 1}: shared_power_meter_group should only contain letters, numbers, hyphens or underscores (got "${r.shared_power_meter_group}")`);
      }
    });
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    // Read from dynamic column names — both the old internal names and the new descriptive ones are accepted.
    const resolveHousing = (r: Record<string, string>) =>
      +(r[housingCol] ?? r.num_cartridge_filters ?? 0);
    const resolveAfm = (r: Record<string, string>) =>
      +(r[afmCol] ?? r.num_afm ?? 0);
    const payload = rows.map(r => ({
      plant_id: plantId,
      train_number: +r.train_number,
      name: r.name || null,
      num_afm: resolveAfm(r),
      num_booster_pumps: r.num_booster_pumps ? +r.num_booster_pumps : 0,
      num_cartridge_filters: resolveHousing(r),
      num_controllers: r.num_controllers ? +r.num_controllers : 0,
      num_filter_housings: 0,
      num_hp_pumps: r.num_hp_pumps ? +r.num_hp_pumps : 0,
      filter_media_type: plantMediaType,
      filter_housing_type: plantFilterType,
      // Shared power meter group — null if blank (train has its own meter or no per-train meter)
      shared_power_meter_group: r.shared_power_meter_group?.trim() || null,
    }));
    const { error } = await supabase.from('ro_trains').insert(payload);
    setBusy(false);
    if (error) { setErrors([error.message]); return; }
    toast.success(`${rows.length} train(s) imported`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import RO Trains from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadTemplate(`ro_trains_${plantMediaType}_${plantFilterType.replace(' ', '_')}_template.csv`, TRAIN_CSV_HEADERS)}>
              <FileDown className="h-3 w-3 mr-1" />Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>
          <div className="rounded-md bg-muted/40 border p-2">
            <p className="text-xs font-medium mb-1">Expected columns:</p>
            <p className="text-xs text-muted-foreground font-mono">{TRAIN_CSV_HEADERS.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1"><strong>train_number</strong> required (integer). All component count fields default to 0 if blank.</p>
            <p className="text-xs text-muted-foreground mt-0.5 italic">{headerNotes}</p>
            <p className="text-xs text-muted-foreground mt-1">
              <strong>shared_power_meter_group</strong>: leave blank for trains with individual meters.
              Trains sharing one physical power meter (e.g. Umapad Colbox 1/2/3) should all have
              the same short label such as <code className="font-mono bg-muted px-1 rounded">colbox</code>.
              kWh is stored per-train; volume-weighted attribution runs in reports.
            </p>
          </div>
          <div>
            <Label className="text-xs font-medium">Select CSV file</Label>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary group-hover:bg-primary/90 text-white text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <Upload className="h-3.5 w-3.5" />
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-primary font-medium">{rows.length} row(s) ready</span>
                  : <span className="text-xs text-muted-foreground">No file chosen</span>}
              </label>
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{rows.length} row(s) parsed</p>
              <CsvPreviewTable rows={rows} headers={TRAIN_CSV_HEADERS} />
            </>
          )}
          {errors.length > 0 && (
            <div className="rounded bg-destructive/10 border border-destructive/30 p-2 space-y-0.5">
              {errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || !rows.length}>
            {busy ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importing…</> : `Import ${rows.length || ''} Rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MeterNameList (inline chip editor) ─────────────────────────────────────
