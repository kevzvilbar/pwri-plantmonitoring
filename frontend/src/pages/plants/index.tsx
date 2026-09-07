import { useState, useEffect, useRef, useId, type ReactNode } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, Settings2, Search, Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { STALE_READING_HOURS } from '@/lib/format';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { PlantTelemetryDrawer } from './PlantTelemetryDrawer';
import { CollapsibleSection, SummaryCount, GridPylonIcon, usePlantMeterConfig, logPlantEdit } from './shared';
import { LocatorsList }  from './locators/LocatorsList';
import { WellsList }     from './wells/WellsList';
import { TrainsList }    from './trains/TrainsList';
import { PlantMeterConfigCard, CIPChemicalsSection } from './config/MeterConfig';
import { ProductMetersCard, ProductMetersStat }      from './config/ProductMeters';
import { PowerMetersCard }                           from './config/PowerMeters';
import { BackwashModeCard, EnergySourceCard, EnergySourceInline } from './config/Appearance';
import { PlantHeroBanner }                           from './components/PlantHeroBanner';
import { PlantTelemetryChart }                       from './charts/PlantTelemetryChart';
import { usePlantSummary } from './hooks/usePlantSummary';
import { usePlantDetail } from './hooks/usePlantDetail';
import { PlantList } from './components/PlantList';

export default function Plants() {
  const { id } = useParams();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isManager, profile, user: currentUser } = useAuth();

  const visiblePlants = isManager
    ? plants
    : plants?.filter(p => profile?.plant_assignments?.includes(p.id));

  const list = selectedPlantId
    ? visiblePlants?.filter(p => p.id === selectedPlantId)
    : visiblePlants;
  const navigate = useNavigate();

  const { data: summaryCounts } = usePlantSummary();

  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [addPlantBusy, setAddPlantBusy] = useState(false);
  const [inspectedPlant, setInspectedPlant] = useState<any | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(3);
  useEffect(() => {
    const timer = setInterval(() => setSecondsAgo(s => (s % 20) + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const qc = useQueryClient();

  const doAddPlant = async (form: AddPlantFormData) => {
    if (!form.name.trim()) { toast.error('Plant name is required.'); return; }
    setAddPlantBusy(true);
    const { data, error } = await supabase.from('plants').insert({
      name: form.name.trim(),
      address: form.address.trim() || null,
      design_capacity_m3: form.design_capacity_m3 === '' ? null : Number(form.design_capacity_m3),
      filter_housing_type: form.filter_housing_type,
      filter_media_type: form.filter_media_type,
    }).select('id').single();
    setAddPlantBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Plant added');
    await logPlantEdit({
      plant_id: data!.id,
      user_id: currentUser?.id ?? null,
      field_changed: 'created',
      old_value: null,
      new_value: form.name.trim(),
      timestamp: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ['plants'] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    setShowAddPlant(false);
    navigate(`/plants/${data!.id}`);
  };

  if (id) return <PlantDetail plantId={id} />;

  const totalCapacity = list?.reduce((s, p) => s + (p.design_capacity_m3 ?? 0), 0) ?? 0;
  const activePlants  = list?.filter(p => p.status === 'Active').length ?? 0;

  const allTrainCounts = Object.values(summaryCounts?.trains ?? {});
  const totalTrainsActive = allTrainCounts.reduce((s, c) => s + c.active, 0);
  const totalTrainsTotal  = allTrainCounts.reduce((s, c) => s + c.total,  0);
  const roUtilPct = totalTrainsTotal > 0
    ? Math.round((totalTrainsActive / totalTrainsTotal) * 100)
    : 0;

  function plantHealthScore(wells: { active: number; total: number }, locators: { active: number; total: number }, trains: { active: number; total: number }) {
    const scores = [
      wells.total    > 0 ? Math.round((wells.active    / wells.total)    * 100) : 0,
      locators.total > 0 ? Math.round((locators.active / locators.total) * 100) : 0,
      trains.total   > 0 ? Math.round((trains.active   / trains.total)   * 100) : 0,
    ];
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  const avgHealth = list?.length
    ? Math.round(
        list.reduce((sum, p) => {
          const w = summaryCounts?.wells?.[p.id]    ?? { active: 0, total: 0 };
          const l = summaryCounts?.locators?.[p.id] ?? { active: 0, total: 0 };
          const t = summaryCounts?.trains?.[p.id]   ?? { active: 0, total: 0 };
          return sum + plantHealthScore(w, l, t);
        }, 0) / list.length,
      )
    : 0;

  const filteredList = list?.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-foreground">Water Production Facilities</h1>
              <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-primary-soft text-primary border border-primary/20">
                Live Overview
              </span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 font-medium">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              <span>{list?.length ?? 0} {list?.length === 1 ? 'Facility' : 'Facilities'} Monitored</span>
              <span className="opacity-40">&bull;</span>
              <span>Synced <strong className="text-foreground font-semibold font-mono">{secondsAgo}s</strong> ago</span>
            </p>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 border-t sm:border-t-0 sm:border-l border-border/60 pt-3 sm:pt-0 sm:pl-6">
            <div className="text-left sm:text-right">
              <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Total Capacity</div>
              <div className="text-lg sm:text-xl font-black text-foreground font-mono leading-tight">
                {totalCapacity > 0 ? fmtNum(totalCapacity) : '—'}{' '}
                <span className="text-2xs font-bold text-primary font-sans">MLD</span>
              </div>
              {totalCapacity > 0 && (
                <div className="text-3xs text-muted-foreground font-mono font-medium">
                  {fmtNum(totalCapacity * 1000)} m³/d
                </div>
              )}
            </div>
            <div className="h-8 w-px bg-border/60" />
            <div className="text-left sm:text-right">
              <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">RO Utilization</div>
              <div className="text-lg sm:text-xl font-black text-info font-mono">
                {roUtilPct}%
              </div>
            </div>
            <div className="h-8 w-px bg-border/60" />
            <div className="text-left sm:text-right">
              <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Avg Health</div>
              <div className="text-lg sm:text-xl font-black text-accent font-mono">
                {avgHealth}%
              </div>
            </div>
          </div>
        </div>
      </div>

      <PlantList
        plants={list}
        filteredList={filteredList}
        summaryCounts={summaryCounts}
        isManager={isManager}
        onNavigate={navigate}
        onInspect={setInspectedPlant}
        setSearch={setSearch}
        setStatusFilter={setStatusFilter}
      />

      <AddPlantDialog
        open={showAddPlant}
        onOpenChange={setShowAddPlant}
        onSubmit={doAddPlant}
        loading={addPlantBusy}
      />

      <PlantTelemetryDrawer
        open={!!inspectedPlant}
        onOpenChange={(open) => !open && setInspectedPlant(null)}
        plant={inspectedPlant}
        summaryCounts={summaryCounts}
      />
    </div>
  );
}

function PlantDetail({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const {
    plant, trainCounts, tab, setTab, highlightId,
    editingInfo, setEditingInfo, infoSaving, infoForm, setInfoForm,
    openInfoEdit, saveInfo, isManager,
  } = usePlantDetail(plantId);

  if (!plant) return <div>Plant not found.</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <PlantHeroBanner
        plant={plant}
        trainCounts={trainCounts}
        isManager={isManager}
        onEdit={openInfoEdit}
        onBack={() => navigate('/plants')}
        deleteButton={
          isManager && (
            <DeleteEntityMenu
              kind="plant"
              id={plant.id}
              label={plant.name}
              canSoftDelete={plant.status === 'Active'}
              canHardDelete
              invalidateKeys={[['plants']]}
              onDeleted={() => navigate('/plants')}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 text-xs font-medium bg-card shadow-2xs"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Delete</span>
                </Button>
              }
            />
          )
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-cyan-400 space-y-1 shadow-2xs">
          <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-cyan-500 dark:text-cyan-400 font-semibold">
              <Droplet className="h-3.5 w-3.5" />
              <span>Design Cap</span>
            </span>
            <span className="text-3xs font-mono text-muted-foreground">MLD</span>
          </div>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-mono text-xl sm:text-2xl font-bold text-foreground tabular-nums">
              {plant.design_capacity_m3 ? fmtNum(plant.design_capacity_m3) : '—'}
            </span>
            {plant.design_capacity_m3 ? (
              <span className="text-2xs text-muted-foreground font-mono font-medium">
                ({fmtNum(plant.design_capacity_m3 * 1000)} m³/d)
              </span>
            ) : (
              <span className="text-2xs text-muted-foreground italic">Unassigned</span>
            )}
          </div>
          <div className="text-3xs text-muted-foreground">Peak extraction throughput</div>
        </div>

        <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-indigo-400 space-y-1 shadow-2xs">
          <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400 font-semibold">
              <ROTrainIcon className="h-3.5 w-3.5" />
              <span>RO Fleet</span>
            </span>
            <span className="text-3xs font-mono text-muted-foreground">TRAINS</span>
          </div>
          <div className="font-mono text-xl sm:text-2xl font-bold text-foreground tabular-nums">
            {trainCounts ? (
              <>
                <span className={
                  trainCounts.active === trainCounts.total && trainCounts.total > 0
                    ? 'text-accent'
                    : trainCounts.active === 0 && trainCounts.total > 0
                      ? 'text-danger'
                      : 'text-primary'
                }>{trainCounts.active}</span>
                <span className="text-muted-foreground font-normal text-base">/{trainCounts.total}</span>
              </>
            ) : (
              <span>{plant.num_ro_trains ?? '—'}</span>
            )}
          </div>
          <div className="text-3xs text-muted-foreground">
            {trainCounts && trainCounts.total > 0
              ? `${Math.round((trainCounts.active / trainCounts.total) * 100)}% fleet operational`
              : 'Active train telemetry'}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-amber-400 space-y-1 shadow-2xs">
          <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400 font-semibold">
              <Gauge className="h-3.5 w-3.5" />
              <span>Distribution</span>
            </span>
            <span className="text-3xs font-mono text-muted-foreground">METERS</span>
          </div>
          <div className="font-mono text-xl sm:text-2xl font-bold text-foreground tabular-nums">
            <ProductMetersStat plantId={plant.id} />
          </div>
          <div className="text-3xs text-muted-foreground">Offtake &amp; bulk consumption</div>
        </div>

        <div className="p-3 rounded-xl bg-card border border-border/80 border-l-[3px] border-l-teal-400 space-y-1 shadow-2xs">
          <div className="text-2xs uppercase font-mono font-medium tracking-wider text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-teal-500 dark:text-teal-400 font-semibold">
              <Zap className="h-3.5 w-3.5" />
              <span>Power Mix</span>
            </span>
            <span className="text-3xs font-mono text-muted-foreground">ENERGY</span>
          </div>
          <div className="pt-0.5">
            <EnergySourceInline plant={plant} />
          </div>
          <div className="text-3xs text-muted-foreground">Grid / Solar telemetry</div>
        </div>
      </div>

      <PlantTelemetryChart
        plantId={plant.id}
        designCapacityM3={plant.design_capacity_m3}
        plantName={plant.name}
      />

      <div className="flex gap-1 p-1 bg-muted/60 border border-border/60 rounded-xl w-full overflow-x-auto shadow-sm">
        {([
          { id: 'locators', label: 'Locators', short: 'LOC', icon: <MapPin className="h-3.5 w-3.5" /> },
          { id: 'wells', label: 'Wells', short: 'WELL', icon: <Droplet className="h-3.5 w-3.5" /> },
          { id: 'product', label: 'Product', short: 'PROD', icon: <Gauge className="h-3.5 w-3.5" /> },
          { id: 'trains', label: 'RO Trains', short: 'RO', icon: <ROTrainIcon className="h-3.5 w-3.5" /> },
          { id: 'power', label: 'Power & Energy', short: 'PWR', icon: <Zap className="h-3.5 w-3.5" /> },
          { id: 'configuration', label: 'Configuration', short: 'CONFIG', icon: <Settings2 className="h-3.5 w-3.5" /> },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'flex-1 py-2 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap min-w-max sm:min-w-0',
              tab === t.id
                ? 'bg-card text-primary shadow-sm border border-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
            ].join(' ')}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.short}</span>
          </button>
        ))}
      </div>

      <div className={tab === 'locators' ? undefined : 'hidden'}><LocatorsList plantId={plantId} highlightId={tab === 'locators' ? highlightId : null} /></div>
      <div className={tab === 'wells'    ? undefined : 'hidden'}><WellsList plantId={plantId} highlightId={tab === 'wells' ? highlightId : null} /></div>
      <div className={tab === 'product'  ? undefined : 'hidden'}><ProductMetersCard plant={plant} highlightId={tab === 'product' ? highlightId : null} /></div>
      <div className={tab === 'trains'   ? undefined : 'hidden'}><TrainsList plantId={plantId} /></div>
      <div className={tab === 'power'    ? undefined : 'hidden'}><PowerMetersCard plant={plant} /></div>
      <div className={tab === 'configuration' ? undefined : 'hidden'}><PlantMeterConfigCard plant={plant} /></div>

      {editingInfo && (
        <Dialog open onOpenChange={(o) => { if (!o && !infoSaving) setEditingInfo(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Plant Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="index-plant-name" className="text-xs">Plant Name</Label>
                <Input
                  value={infoForm.name}
                  onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                  placeholder="e.g. Guizo"
                  data-testid="edit-plant-name"
                  id="index-plant-name"
                />
              </div>
              <div>
                <Label htmlFor="index-address" className="text-xs">Address</Label>
                <Input
                  value={infoForm.address}
                  onChange={(e) => setInfoForm({ ...infoForm, address: e.target.value })}
                  placeholder="e.g. Guizo, Mandaue City"
                  data-testid="edit-plant-address"
                  id="index-address"
                />
              </div>
              <div>
                <Label htmlFor="index-capacity-mld" className="text-xs">Capacity (MLD)</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={infoForm.capacity}
                  onChange={(e) => setInfoForm({ ...infoForm, capacity: e.target.value })}
                  placeholder="e.g. 8"
                  data-testid="edit-plant-capacity"
                  id="index-capacity-mld"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingInfo(false)} disabled={infoSaving}>Cancel</Button>
              <Button onClick={saveInfo} disabled={infoSaving} data-testid="save-plant-info-btn">
                {infoSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Add Plant ──────────────────────────────────────────────────────────────
export interface AddPlantFormData {
  name: string;
  address: string;
  design_capacity_m3: number | '';
  filter_housing_type: 'Cartridge Filter' | 'Bag Filter';
  filter_media_type: 'AFM' | 'MMF';
}

function AddPlantDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (form: AddPlantFormData) => void;
  loading: boolean;
}) {
  const blank = (): AddPlantFormData => ({
    name: '', address: '', design_capacity_m3: '',
    filter_housing_type: 'Cartridge Filter', filter_media_type: 'AFM',
  });
  const [form, setForm] = useState<AddPlantFormData>(blank);

  useEffect(() => {
    if (open) setForm(blank());
  }, [open]);

  const canSubmit = form.name.trim().length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Plant</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="index-plant-name-2">Plant Name</Label>
            <Input placeholder="e.g. Mambaling WTP" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onSubmit(form); }} id="index-plant-name-2"/>
          </div>
          <div>
            <Label htmlFor="index-address-optional">Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input placeholder="e.g. Brgy. San Isidro, Iloilo City" value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))} id="index-address-optional"/>
          </div>
          <div>
            <Label htmlFor="index-design-capacity-optional-mld">Design Capacity <span className="text-muted-foreground text-xs">(optional, MLD)</span></Label>
            <Input type="number" min={0} step="0.1" placeholder="e.g. 5.0"
              value={form.design_capacity_m3}
              onChange={e => setForm(f => ({
                ...f, design_capacity_m3: e.target.value === '' ? '' : Number(e.target.value),
              }))} id="index-design-capacity-optional-mld"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="index-filter-housing">Filter Housing</Label>
              <Select value={form.filter_housing_type}
                onValueChange={(v: 'Cartridge Filter' | 'Bag Filter') =>
                  setForm(f => ({ ...f, filter_housing_type: v }))}>
                <SelectTrigger id="index-filter-housing"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cartridge Filter">Cartridge Filter</SelectItem>
                  <SelectItem value="Bag Filter">Bag Filter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="index-filter-media">Filter Media</Label>
              <Select value={form.filter_media_type}
                onValueChange={(v: 'AFM' | 'MMF') => setForm(f => ({ ...f, filter_media_type: v }))}>
                <SelectTrigger id="index-filter-media"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AFM">AFM</SelectItem>
                  <SelectItem value="MMF">MMF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-2xs text-muted-foreground">
            Wells, locators, RO trains, and energy source are all added after the plant is created.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={!canSubmit}>
            {loading ? 'Adding…' : 'Add Plant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
