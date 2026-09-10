import { useState, useEffect, useMemo } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { PlantTelemetryDrawer } from './PlantTelemetryDrawer';
import { CollapsibleSection, SummaryCount, GridPylonIcon, usePlantMeterConfig, logPlantEdit } from './shared';
import { LocatorsList }  from './locators/LocatorsList';
import { WellsList }     from './wells/WellsList';
import { TrainsList }    from './trains/TrainsList';
import { PlantMeterConfigCard, CIPChemicalsSection } from './config/MeterConfig';
import { ProductMetersCard, ProductMetersStat }      from './config/ProductMeters';
import { PowerMetersCard }                           from './config/PowerMeters/PowerMeters';
import { BackwashModeCard, EnergySourceCard, EnergySourceInline } from './config/Appearance';
import { PlantHeroBanner }                           from './components/PlantHeroBanner';
import { PlantTelemetryChart }                       from './charts/PlantTelemetryChart';
import { usePlantSummary } from './hooks/usePlantSummary';
import { usePlantDetail } from './hooks/usePlantDetail';
import { PlantList } from './components/PlantList';
import { PlantListHeader } from './index/PlantListHeader';
import { PlantDetailTabs } from './index/PlantDetailTabs';
import { PlantInfoEditDialog } from './index/PlantInfoEditDialog';

export interface AddPlantFormData {
  name: string;
  address: string;
  design_capacity_m3: number | '';
  filter_housing_type: 'Cartridge Filter' | 'Bag Filter';
  filter_media_type: 'AFM' | 'MMF';
}

export default function Plants() {
  const { id } = useParams();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isManager, profile, user: currentUser } = useAuth();

  const visiblePlants = isManager
    ? (plants ?? [])
    : (plants?.filter(p => profile?.plant_assignments?.includes(p.id)) ?? []);

  const list = selectedPlantId
    ? visiblePlants.filter(p => p.id === selectedPlantId)
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
      <PlantListHeader
        list={list}
        summaryCounts={summaryCounts}
        secondsAgo={secondsAgo}
        totalCapacity={totalCapacity}
        roUtilPct={roUtilPct}
        avgHealth={avgHealth}
      />

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

  const handleFieldChange = (field: string, value: string) => {
    setInfoForm((prev: any) => ({ ...prev, [field]: value }));
  };

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

      <PlantTelemetryChart
        plantId={plant.id}
        designCapacityM3={plant.design_capacity_m3}
        plantName={plant.name}
      />

      <PlantDetailTabs tab={tab} onTabChange={setTab} />

      <div className={tab === 'locators' ? undefined : 'hidden'}><LocatorsList plantId={plantId} highlightId={tab === 'locators' ? highlightId : null} /></div>
      <div className={tab === 'wells'    ? undefined : 'hidden'}><WellsList plantId={plantId} highlightId={tab === 'wells' ? highlightId : null} /></div>
      <div className={tab === 'product'  ? undefined : 'hidden'}><ProductMetersCard plant={plant} highlightId={tab === 'product' ? highlightId : null} /></div>
      <div className={tab === 'trains'   ? undefined : 'hidden'}><TrainsList plantId={plantId} /></div>
      <div className={tab === 'power'    ? undefined : 'hidden'}><PowerMetersCard plant={plant} /></div>
      <div className={tab === 'configuration' ? undefined : 'hidden'}><PlantMeterConfigCard plant={plant} /></div>

      {editingInfo && (
        <PlantInfoEditDialog
          open={!!editingInfo}
          infoSaving={infoSaving}
          infoForm={infoForm}
          onOpenChange={(o) => { if (!o && !infoSaving) setEditingInfo(false); }}
          onFieldChange={handleFieldChange}
          onSave={saveInfo}
        />
      )}
    </div>
  );
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
  const set = (field: keyof AddPlantFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

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
              onChange={set('name')}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onSubmit(form); }} id="index-plant-name-2"/>
          </div>
          <div>
            <Label htmlFor="index-address-optional">Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input placeholder="e.g. Brgy. San Isidro, Iloilo City" value={form.address}
              onChange={set('address')} id="index-address-optional"/>
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
