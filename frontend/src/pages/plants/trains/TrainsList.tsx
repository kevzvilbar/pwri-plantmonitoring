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
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, Search, Waves, Sparkles, Filter, Activity, Layers } from 'lucide-react';
import { ROTrainIcon, ChangeMeterIcon, MeterOdometerIcon, PressureGaugeIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


import { EditTrainDialog } from './EditTrainDialog';
import { TrainOperatorLogModal } from './TrainOperatorLogModal';
import { TrainRODetailCharts } from './TrainRODetailCharts';
import { PretreatAFMChart } from './PretreatAFMChart';
import { PretreatBoosterChart } from './PretreatBoosterChart';
import { PretreatCFChart } from './PretreatCFChart';
import { PretreatHPPChart } from './PretreatHPPChart';
import { MeterDetailButton } from '../charts/EntityHistoryChart';
import { ReplaceTrainMeterDialog } from '../../ro-trains/ReplaceTrainMeterDialog';
import { parseCsv, downloadTemplate, CsvPreviewTable, CollapsibleSection } from '../shared';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { ReasonDialog } from '@/components/ReasonDialog';
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

  const applyTrainStatusChange = async (t: any, newStatus: 'Running' | 'Offline' | 'Maintenance', reasonCategory?: string, reasonDetail?: string) => {
    const { error } = await supabase.from('ro_trains').update({ status: newStatus }).eq('id', t.id);
    if (error) { toast.error(friendlyError(error)); return; }
    // train_status_log, not entity_status_audit_log — this is the RO-train
    // status timeline TrainLogModal reconstructs shutdown/maintenance
    // banners from, and the same table the 2h auto-offline safety net and
    // the operator hourly-log offline toggle both write to. Its RLS has no
    // manager gate (unlike entity_status_audit_log), so this insert
    // succeeds regardless of who's driving this page. Folded into one
    // human-readable string rather than a category/detail pair — this
    // table only ever stores free text (see the auto-offline hook's
    // "Auto-flagged: no reading for Xh" messages), so there's no separate
    // reason_category column here to keep in sync.
    try {
      await supabase.from('train_status_log').insert({
        train_id: t.id,
        plant_id: t.plant_id,
        status: newStatus,
        reason: reasonCategory
          ? `${reasonCategoryLabel(reasonCategory)}${reasonDetail ? `: ${reasonDetail}` : ''}`
          : null,
        confirmed_by: activeOperator?.id ?? user?.id ?? null,
      });
    } catch {
      // Best-effort — the status change on ro_trains above already
      // succeeded and is what actually gates the train's behavior; a
      // failure here only means this transition won't render as a banner
      // in the operator log later, not a broken save.
    }
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
  // Sections: 'afm' | 'booster' | 'hpp' | 'ro' | 'meters' | 'cf' | null (none expanded)
  const [activeSection, setActiveSection] = useState<Record<string, string | null>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Running' | 'Maintenance' | 'Offline'>('all');

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
  }) => {
    const isActive = activeKey === sectionKey;
    return (
      <button
        onClick={() => toggleSection(tid, sectionKey)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shadow-2xs',
          isActive
            ? 'bg-primary text-primary-foreground border-primary shadow-xs'
            : 'bg-card/90 border-border/70 text-muted-foreground hover:border-primary/60 hover:text-foreground hover:bg-muted/60',
        ].join(' ')}
      >
        <span className={isActive ? 'text-primary-foreground' : 'text-primary'}>
          {icon}
        </span>
        <span>{label}</span>
        {count !== undefined && (
          <span className={`px-1.5 py-0.5 rounded-full text-3xs font-bold ${
            isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground border border-border/60'
          }`}>
            {count}
          </span>
        )}
        <TrendingUp className={`h-3 w-3 ml-0.5 transition-transform ${isActive ? 'rotate-90 text-primary-foreground' : 'opacity-40'}`} />
      </button>
    );
  };

  const [logTrain, setLogTrain] = useState<{ id: string; label: string } | null>(null);
  const [replaceTrainMeter, setReplaceTrainMeter] = useState<{ trainId: string } | null>(null);

  const filteredTrains = useMemo(() => {
    return (trains ?? []).filter((t: any) => {
      const st = deriveTrainStatus(t);
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const numMatch = `train ${t.train_number}`.includes(q) || `${t.train_number}`.includes(q);
        const nameMatch = (t.name ?? '').toLowerCase().includes(q);
        return numMatch || nameMatch;
      }
      return true;
    });
  }, [trains, statusFilter, searchTerm, recentTrainIds]);

  const runningCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t) === 'Running').length;
  const maintenanceCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t) === 'Maintenance').length;
  const offlineCount = (trains ?? []).filter((t: any) => deriveTrainStatus(t) === 'Offline').length;

  return (
    <div className="space-y-3.5">
      {/* ── Executive Fleet Header & Controls ── */}
      <div className="p-4 rounded-2xl border border-border/80 bg-card shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 shadow-2xs">
              <ROTrainIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-foreground tracking-tight">
                  RO Trains &amp; Pre-treatment Fleet
                </h2>
                <span className="px-2 py-0.5 rounded-full text-3xs font-bold bg-primary-soft text-primary border border-primary/30">
                  {runningCount}/{trains?.length ?? 0} Online
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Media Filtration ➔ Booster Pumps ➔ Pre-filter Housings ➔ High Pressure Pumps ➔ RO Permeate
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {isManager && (
              <Button size="sm" className="h-8 px-3 text-xs gap-1.5 font-bold shadow-2xs" onClick={() => setShowAddTrain(true)}>
                <Plus className="h-3.5 w-3.5" />
                <span>Add Train</span>
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs gap-1" onClick={() => setShowTrainCsv(true)} title="Import CSV">
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Import</span>
              </Button>
            )}
          </div>
        </div>

        {/* Filter bar & Quick Status Chips */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-2.5 pt-2.5 border-t border-border/50">
          <div className="relative w-full md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search train # or name…"
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>

          <div className="flex items-center gap-1 w-full md:w-auto overflow-x-auto pb-0.5">
            {(['all', 'Running', 'Maintenance', 'Offline'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={[
                  'h-7 px-2.5 text-2xs font-medium rounded-md transition-all border shrink-0 flex items-center gap-1.5',
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:bg-muted',
                ].join(' ')}
              >
                {s === 'all' && <span>All ({trains?.length ?? 0})</span>}
                {s === 'Running' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    <span>Online ({runningCount})</span>
                  </>
                )}
                {s === 'Maintenance' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                    <span>Maintenance ({maintenanceCount})</span>
                  </>
                )}
                {s === 'Offline' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    <span>Offline ({offlineCount})</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Train Cards ── */}
      {filteredTrains.map((t: any) => {
        const mt = effectiveMediaType(t);
        const ft = effectiveFilterType(t);
        const effectiveStatus = deriveTrainStatus(t);
        const activeKey = activeSection[t.id] ?? null;
        const trainLabel = `Train ${t.train_number}${t.name ? ` · ${t.name}` : ''}`;

        const numAfm   = t.num_afm            ?? 0;
        const numBp    = t.num_booster_pumps  ?? 0;
        const numHpp   = t.num_hp_pumps       ?? 0;
        const numCf    = t.num_cartridge_filters ?? 0;
        const numCtrl  = t.num_controllers    ?? 0;

        return (
          <Card key={t.id} className="overflow-hidden border border-border rounded-lg shadow-xs transition-all hover:border-primary/40" data-testid={`train-card-${t.id}`}>
            {/* ── Train Header ── */}
            <div className="p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-card border-b border-border/60">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="h-7 w-7 rounded-md bg-primary-soft text-primary flex items-center justify-center shrink-0">
                    <ROTrainIcon className="h-4 w-4" />
                  </div>
                  <h3 className="font-semibold text-sm sm:text-base text-foreground tracking-tight flex items-center gap-2">
                    <span>{trainLabel}</span>
                  </h3>
                  <span className="inline-flex items-center text-3xs font-medium px-2 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/30">
                    {mt} Media
                  </span>
                  <span className="inline-flex items-center text-3xs font-medium px-2 py-0.5 rounded-full bg-info-soft text-info border border-info/30">
                    {ft}
                  </span>
                </div>

                {/* Configuration summary */}
                <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono pl-9">
                  <span>{numAfm} AFM</span>
                  <span>·</span>
                  <span>{numBp} Booster</span>
                  <span>·</span>
                  <span>{numCf} {ft === 'Bag Filter' ? 'Filter Housing' : 'CF Housing'}</span>
                  <span>·</span>
                  <span>{numHpp} HPP</span>
                  {numCtrl > 0 && (
                    <>
                      <span>·</span>
                      <span>{numCtrl} Ctrl</span>
                    </>
                  )}
                </div>
              </div>

              {/* Status pill & actions */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                <button
                  type="button"
                  onClick={() => toggleTrainStatus(t)}
                  title={isManager ? `Click to cycle status (currently ${effectiveStatus})` : effectiveStatus}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
                    effectiveStatus === 'Running'
                      ? 'text-accent bg-accent-soft border-accent/40 hover:bg-accent-soft/80'
                      : effectiveStatus === 'Maintenance'
                      ? 'text-warn bg-warn-soft border-warn/40 hover:bg-warn-soft/80'
                      : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                  } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    effectiveStatus === 'Running' ? 'bg-accent'
                    : effectiveStatus === 'Maintenance' ? 'bg-warn'
                    : 'bg-muted-foreground'
                  }`} />
                  <span>{effectiveStatus}</span>
                </button>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs font-medium gap-1 rounded-lg"
                    onClick={() => setLogTrain({ id: t.id, label: trainLabel })}
                    title="View Operator Shift Logs"
                  >
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    <span>Logs</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs font-medium gap-1 rounded-lg"
                    onClick={() => setEditTrain(t)}
                    data-testid={`edit-train-${t.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Edit</span>
                  </Button>
                  {isManager && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete train"
                      onClick={() => { setTrainDeleteTarget(t); setTrainDeleteReason(''); }}
                      data-testid={`delete-train-${t.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ══ INTEGRATED SUBSYSTEM PIPELINE ══ */}
            <div className="p-3.5 bg-muted/20 space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Stage 1: Pre-treatment */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/80 space-y-2">
                  <div className="flex items-center justify-between gap-1 pb-1 border-b border-border/40">
                    <div className="flex items-center gap-1.5">
                      <span className="text-3xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/40">
                        Pre-treatment
                      </span>
                      <span className="text-3xs text-muted-foreground font-mono">Stage 1</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">Filtration &amp; Boost</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {numAfm > 0 && (
                      <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="afm"
                        icon={<Filter className="h-3.5 w-3.5" />} label={mt} count={numAfm} />
                    )}
                    {numBp > 0 && (
                      <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="booster"
                        icon={<Activity className="h-3.5 w-3.5" />} label="Booster Pump" count={numBp} />
                    )}
                    {numCf > 0 && (
                      <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="cf"
                        icon={<Layers className="h-3.5 w-3.5" />}
                        label={ft === 'Bag Filter' ? 'Filter Housing' : 'CF Housing'}
                        count={numCf} />
                    )}
                  </div>
                </div>

                {/* Stage 2: Reverse Osmosis */}
                <div className="p-3 rounded-xl border border-border/70 bg-card/80 space-y-2">
                  <div className="flex items-center justify-between gap-1 pb-1 border-b border-border/40">
                    <div className="flex items-center gap-1.5">
                      <span className="text-3xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-info-soft text-info border border-info/40">
                        RO Stage
                      </span>
                      <span className="text-3xs text-muted-foreground font-mono">Stage 2</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">High Pressure &amp; Permeate</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {numHpp > 0 && (
                      <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="hpp"
                        icon={<Zap className="h-3.5 w-3.5" />} label="High Pressure Pump" count={numHpp} />
                    )}
                    <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="ro"
                      icon={<BarChart2 className="h-3.5 w-3.5" />} label="RO Performance" />
                    <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="meters"
                      icon={<MeterOdometerIcon className="h-3.5 w-3.5" />} label="Meters" />
                  </div>
                </div>
              </div>

              {/* ── EXPANDED MODULE DRAWERS ── */}
              {activeKey === 'afm' && (
                <div className="p-3.5 rounded-xl border border-accent/40 bg-card animate-fade-in shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                      <Filter className="h-4 w-4" /> {mt} Media Filtration Telemetry
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'afm')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <PretreatAFMChart trainId={t.id} mediaType={mt} />
                </div>
              )}

              {activeKey === 'booster' && (
                <div className="p-3.5 rounded-xl border border-accent/40 bg-card animate-fade-in shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                      <Activity className="h-4 w-4" /> Booster Pump Pressure &amp; Flow
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'booster')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <PretreatBoosterChart trainId={t.id} />
                </div>
              )}

              {activeKey === 'cf' && (
                <div className="p-3.5 rounded-xl border border-accent/40 bg-card animate-fade-in shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                      <Layers className="h-4 w-4" /> {ft} Differential Pressure &amp; Replacement History
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'cf')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <PretreatCFChart trainId={t.id} filterType={ft} />
                </div>
              )}

              {activeKey === 'hpp' && (
                <div className="p-3.5 rounded-xl border border-info/40 bg-card animate-fade-in shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-info flex items-center gap-1.5">
                      <Zap className="h-4 w-4" /> High Pressure Pump Performance &amp; Current Draw
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'hpp')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <PretreatHPPChart trainId={t.id} />
                </div>
              )}

              {activeKey === 'ro' && (
                <div className="p-3.5 rounded-xl border border-info/40 bg-card animate-fade-in shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-info flex items-center gap-1.5">
                      <BarChart2 className="h-4 w-4" /> Reverse Osmosis Recovery &amp; Salt Rejection
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'ro')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <TrainRODetailCharts trainId={t.id} trainLabel={trainLabel} />
                </div>
              )}

              {activeKey === 'meters' && (
                <div className="p-3.5 rounded-xl border border-info/40 bg-card animate-fade-in shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-info flex items-center gap-1.5">
                      <MeterOdometerIcon className="h-4 w-4" /> Train Meters &amp; Calibration Identity
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'meters')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
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
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                      onClick={() => setReplaceTrainMeter({ trainId: t.id })}>
                      <ChangeMeterIcon className="h-3.5 w-3.5" /> Replace Meter / Calibrate
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
      {!trains?.length && (
        <Card className="p-8 text-center text-xs text-muted-foreground border-dashed">
          No RO trains configured for this plant yet.
        </Card>
      )}

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
              <Label htmlFor="trainslist-train-number">Train Number</Label>
              <Input type="number" min={1} value={form.train_number} onChange={num('train_number')} id="trainslist-train-number"/>
            </div>
            <div>
              <Label htmlFor="trainslist-name-optional">Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input placeholder="e.g. Train A" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} id="trainslist-name-optional"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {fields.filter(f => !f.hide).map(({ key, label }) => (
              <div key={key}>
                <Label htmlFor="trainslist-field">{label}</Label>
                <Input type="number" min={0} value={form[key] as number} onChange={num(key)} id="trainslist-field"/>
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
            <p className="text-xs font-medium">Select CSV file</p>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary group-hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-4 py-1.5 transition-colors select-none">
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
