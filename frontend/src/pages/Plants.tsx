import { useState, useEffect, type ReactNode } from 'react';
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
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';

const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';

// ─── SummaryCount pill ───────────────────────────────────────────────────────
// Renders "active/total" — active count in primary color, total in muted.
// If all active: green accent. If any inactive: amber warning.

function SummaryCount({ label }: { label: string }) {
  const [active, total] = label.split('/').map(Number);
  const allActive = active === total && total > 0;
  const noneActive = active === 0;
  const color = allActive
    ? 'text-emerald-600 dark:text-emerald-400'
    : noneActive && total > 0
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground';
  return (
    <div className={`font-mono-num text-sm font-medium ${color}`}>
      {active}
      <span className="text-muted-foreground font-normal">/{total}</span>
    </div>
  );
}

// ─── Entity status change audit logger ───────────────────────────────────────
// Called whenever a Well, Locator, or RO Train flips Active ↔ Inactive.

async function logStatusChange(entry: {
  user_id: string | null;
  plant_id: string;
  entity_type: 'Well' | 'Locator' | 'RO Train';
  entity_id: string;
  entity_label: string;
  from_status: string;
  to_status: string;
  timestamp: string;
}) {
  try {
    await (supabase.from('entity_status_audit_log' as any) as any).insert([entry]);
  } catch {
    // Table may not exist yet — silently ignore.
  }
}

// ─── Plant field-level audit logger ──────────────────────────────────────────
// Logs name / address / capacity edits to plant_edit_audit_log.
// Best-effort: silently ignored if table doesn't exist yet.
async function logPlantEdit(entry: {
  plant_id: string;
  user_id: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('plant_edit_audit_log' as any) as any).insert([entry]);
  } catch {
    // Table may not exist yet — silently ignore.
  }
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-1 py-2 hover:bg-muted/30 rounded-md transition-colors text-left group"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-foreground">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

export default function Plants() {
  const { id } = useParams();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isManager } = useAuth();
  const list = selectedPlantId ? plants?.filter(p => p.id === selectedPlantId) : plants;
  const navigate = useNavigate();

  // Summary counts: active/total per plant for Wells, Locators, RO Trains
  const { data: summaryCounts } = useQuery({
    queryKey: ['plants-summary-counts'],
    queryFn: async () => {
      const [wellsRes, locatorsRes, trainsRes] = await Promise.all([
        supabase.from('wells').select('plant_id, status'),
        supabase.from('locators').select('plant_id, status'),
        supabase.from('ro_trains').select('plant_id, status'),
      ]);

      type Summary = Record<string, { active: number; total: number }>;
      const tally = (
        rows: { plant_id: string; status: string }[],
        activeFn: (s: string) => boolean,
      ): Summary => {
        const out: Summary = {};
        rows.forEach((r) => {
          if (!out[r.plant_id]) out[r.plant_id] = { active: 0, total: 0 };
          out[r.plant_id].total++;
          if (activeFn(r.status)) out[r.plant_id].active++;
        });
        return out;
      };

      return {
        wells:    tally(wellsRes.data    ?? [], (s) => s === 'Active'),
        locators: tally(locatorsRes.data ?? [], (s) => s === 'Active'),
        trains:   tally(trainsRes.data   ?? [], (s) => s === 'Running'),
      };
    },
  });

  const summaryLabel = (
    counts: Record<string, { active: number; total: number }> | undefined,
    plantId: string,
  ) => {
    const c = counts?.[plantId];
    if (!c) return '0/0';
    return `${c.active}/${c.total}`;
  };

  if (id) return <PlantDetail plantId={id} />;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Plants</h1>
      </div>
      <div className="space-y-3">
        {list?.map((p) => (
          <Card key={p.id} className="p-4 hover:shadow-elev transition-all">
            <div className="flex items-start justify-between gap-2">
              <div
                onClick={() => navigate(`/plants/${p.id}`)}
                className="flex-1 cursor-pointer"
                data-testid={`plant-card-${p.id}`}
              >
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-xs text-muted-foreground">{p.address}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={p.status === 'Active' ? 'accent' : 'muted'}>{p.status}</StatusPill>
                {isManager && (
                  <DeleteEntityMenu
                    kind="plant"
                    id={p.id}
                    label={p.name}
                    canSoftDelete={p.status === 'Active'}
                    canHardDelete
                    invalidateKeys={[['plants']]}
                    compact
                  />
                )}
              </div>
            </div>
            <div
              onClick={() => navigate(`/plants/${p.id}`)}
              className="grid grid-cols-4 gap-3 mt-3 text-xs cursor-pointer"
            >
              <div>
                <div className="text-muted-foreground">Capacity</div>
                <div className="font-mono-num text-sm">{fmtNum(p.design_capacity_m3 ?? 0)} m³</div>
              </div>
              <div>
                <div className="text-muted-foreground">Wells</div>
                <SummaryCount label={summaryLabel(summaryCounts?.wells, p.id)} />
              </div>
              <div>
                <div className="text-muted-foreground">Locators</div>
                <SummaryCount label={summaryLabel(summaryCounts?.locators, p.id)} />
              </div>
              <div>
                <div className="text-muted-foreground">RO Trains</div>
                <SummaryCount label={summaryLabel(summaryCounts?.trains, p.id)} />
              </div>
            </div>
          </Card>
        ))}
        {!list?.length && <Card className="p-6 text-center text-muted-foreground text-sm">No plants visible</Card>}
      </div>
    </div>
  );
}

function PlantDetail({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const { data: plants } = usePlants();
  const { isManager, user } = useAuth();
  const qc = useQueryClient();
  const plant = plants?.find(p => p.id === plantId);

  const [tab, setTab] = useState<'locators' | 'wells' | 'product' | 'trains'>('locators');
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: '', address: '', capacity: '' });

  // RO Train active/total count for this plant
  const { data: trainCounts } = useQuery({
    queryKey: ['ro-trains-count', plantId],
    queryFn: async () => {
      const { data } = await supabase.from('ro_trains').select('status').eq('plant_id', plantId);
      const total = data?.length ?? 0;
      const active = data?.filter((t) => t.status === 'Running').length ?? 0;
      return { active, total };
    },
  });

  if (!plant) return <div>Plant not found.</div>;

  const openInfoEdit = () => {
    setInfoForm({
      name: plant.name ?? '',
      address: plant.address ?? '',
      capacity: plant.design_capacity_m3 != null ? String(plant.design_capacity_m3) : '',
    });
    setEditingInfo(true);
  };

  const saveInfo = async () => {
    setInfoSaving(true);
    const payload: Record<string, any> = {};
    const changes: { field: string; old: string | null; next: string | null }[] = [];

    if (infoForm.name.trim() !== (plant.name ?? '')) {
      changes.push({ field: 'name', old: plant.name ?? null, next: infoForm.name.trim() || null });
      payload.name = infoForm.name.trim() || null;
    }
    if (infoForm.address.trim() !== (plant.address ?? '')) {
      changes.push({ field: 'address', old: plant.address ?? null, next: infoForm.address.trim() || null });
      payload.address = infoForm.address.trim() || null;
    }
    const newCap = infoForm.capacity ? parseFloat(infoForm.capacity) : null;
    if (newCap !== (plant.design_capacity_m3 ?? null)) {
      changes.push({ field: 'design_capacity_m3', old: plant.design_capacity_m3 != null ? String(plant.design_capacity_m3) : null, next: newCap != null ? String(newCap) : null });
      payload.design_capacity_m3 = newCap;
    }

    if (!Object.keys(payload).length) { setEditingInfo(false); setInfoSaving(false); return; }

    const { error } = await supabase.from('plants').update(payload).eq('id', plant.id);
    setInfoSaving(false);
    if (error) { toast.error(error.message); return; }

    // Audit each changed field
    const now = new Date().toISOString();
    await Promise.all(
      changes.map((c) =>
        logPlantEdit({
          plant_id: plant.id,
          user_id: user?.id ?? null,
          field_changed: c.field,
          old_value: c.old,
          new_value: c.next,
          timestamp: now,
        }),
      ),
    );

    toast.success('Plant details updated');
    setEditingInfo(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
    qc.invalidateQueries({ queryKey: ['ro-trains-count', plantId] });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Back nav */}
      <button onClick={() => navigate('/plants')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ChevronLeft className="h-4 w-4" /> All plants
      </button>

      {/* Main plant info card — gradient hero */}
      <Card className="p-4 bg-gradient-stat text-topbar-foreground overflow-hidden relative">

        {/* Top-right: Status pill + Edit + Delete */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <span className={[
            'text-xs font-semibold px-2.5 py-1 rounded-full border',
            plant.status === 'Active'
              ? 'bg-white/10 border-white/20 text-white'
              : 'bg-amber-400/20 border-amber-400/30 text-amber-200',
          ].join(' ')}>
            Status: <span className="font-bold">{plant.status}</span>
          </span>
          {isManager && (
            <Button size="sm" variant="ghost"
              onClick={openInfoEdit}
              data-testid="edit-plant-info-btn"
              className="h-8 gap-1 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs">
              <Pencil className="h-3 w-3" />Edit
            </Button>
          )}
          {isManager && (
            <DeleteEntityMenu
              kind="plant" id={plant.id} label={plant.name}
              canSoftDelete={plant.status === 'Active'} canHardDelete
              invalidateKeys={[['plants']]} onDeleted={() => navigate('/plants')}
            />
          )}
        </div>

        {/* Plant name + address */}
        <div className="min-w-0 pr-44">
          <h1 className="text-xl font-bold leading-tight">{plant.name}</h1>
          <p className="text-xs text-topbar-muted flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{plant.address}</span>
          </p>
        </div>

        {/* Stats row — Capacity / RO Trains / Product Meters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 text-xs">
          <div>
            <div className="opacity-60 text-[11px] uppercase tracking-wide">Capacity</div>
            <div className="font-mono-num text-lg font-semibold mt-0.5">
              {fmtNum(plant.design_capacity_m3 ?? 0)} m³
            </div>
          </div>
          <div>
            <div className="opacity-60 text-[11px] uppercase tracking-wide">RO Trains</div>
            <div className="font-mono-num text-lg font-semibold mt-0.5">
              {trainCounts ? (
                <>
                  <span className={
                    trainCounts.active === trainCounts.total && trainCounts.total > 0
                      ? 'text-emerald-300'
                      : trainCounts.active === 0 && trainCounts.total > 0
                        ? 'text-amber-300' : ''
                  }>{trainCounts.active}</span>
                  <span className="opacity-50 font-normal text-base">/{trainCounts.total}</span>
                </>
              ) : (plant.num_ro_trains ?? '—')}
            </div>
            <div className="opacity-40 text-[10px]">active / total</div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="opacity-60 text-[11px] uppercase tracking-wide">Product Meters</div>
            <ProductMetersStat plantId={plant.id} onEdit={() => setTab('product')} />
          </div>
        </div>

        {/* Energy Sources */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <EnergySourceInline plant={plant} isManager={isManager} qc={qc} />
        </div>
      </Card>

      {/* Edit Plant Info Dialog */}
      {editingInfo && (
        <Dialog open onOpenChange={(o) => { if (!o && !infoSaving) setEditingInfo(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Plant Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs">Plant Name</Label>
                <Input
                  value={infoForm.name}
                  onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                  placeholder="e.g. SRP"
                  data-testid="edit-plant-name"
                />
              </div>
              <div>
                <Label className="text-xs">Address</Label>
                <Input
                  value={infoForm.address}
                  onChange={(e) => setInfoForm({ ...infoForm, address: e.target.value })}
                  placeholder="e.g. South Road Properties, Cebu City"
                  data-testid="edit-plant-address"
                />
              </div>
              <div>
                <Label className="text-xs">Capacity (m³)</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={infoForm.capacity}
                  onChange={(e) => setInfoForm({ ...infoForm, capacity: e.target.value })}
                  placeholder="e.g. 4200"
                  data-testid="edit-plant-capacity"
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

      <BackwashModeCard plant={plant} />
      <PlantComponentTypeCard plant={plant} />

      <div className="grid grid-cols-4 gap-1 p-1 bg-muted rounded-lg w-full">
        {(['locators', 'wells', 'product', 'trains'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'py-2 text-sm font-medium rounded-md transition-all duration-200 capitalize focus-visible:outline-none',
              tab === t
                ? 'bg-teal-700 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'locators' && <LocatorsList plantId={plantId} />}
      {tab === 'wells' && <WellsList plantId={plantId} />}
      {tab === 'product' && <ProductMetersCard plant={plant} />}
      {tab === 'trains' && <TrainsList plantId={plantId} />}
    </div>
  );
}

// ─── ProductMetersStat — tiny active/total + Edit link for hero card ────────────
function ProductMetersStat({ plantId, onEdit }: { plantId: string; onEdit: () => void }) {
  const { isManager, isAdmin } = useAuth();
  const canEdit = isManager || isAdmin;
  const { data: meters } = useQuery({
    queryKey: ['product-meters', plantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('product_meters' as any).select('id,name').eq('plant_id', plantId);
      return (data ?? []) as any[];
    },
  });
  // "active" = meters that have at least one reading (non-zero readings count)
  const { data: readingCounts } = useQuery({
    queryKey: ['product-meters-active', plantId],
    queryFn: async () => {
      if (!meters?.length) return {};
      const ids = meters.map((m: any) => m.id);
      const { data } = await supabase
        .from('product_meter_readings' as any)
        .select('meter_id')
        .in('meter_id', ids);
      const seen = new Set((data ?? []).map((r: any) => r.meter_id));
      return Object.fromEntries(ids.map((id: string) => [id, seen.has(id)]));
    },
    enabled: !!meters?.length,
  });
  const total = meters?.length ?? 0;
  const active = Object.values(readingCounts ?? {}).filter(Boolean).length;

  return (
    <div className="mt-0.5">
      <div className="font-mono-num text-lg font-semibold">
        <span className={active > 0 ? 'text-emerald-300' : 'opacity-70'}>{active}</span>
        <span className="opacity-50 font-normal text-base">/{total}</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="opacity-40 text-[10px]">active / total</span>
        {canEdit && (
          <button onClick={onEdit}
            className="text-[10px] text-white/50 hover:text-white underline underline-offset-2 transition-colors">
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Product Meters Card ──────────────────────────────────────────────────────
// Manager/Admin can add, rename, and remove product meters per plant.
// Operators can view meters and their latest readings but cannot edit.

async function logProductMeterAudit(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore */ }
}

function ProductMetersCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager, isAdmin, user } = useAuth();
  const canEdit = isManager || isAdmin;

  const { data: meters, isLoading } = useQuery({
    queryKey: ['product-meters', plant.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('product_meters' as any)
        .select('*')
        .eq('plant_id', plant.id)
        .order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['product-meters', plant.id] });

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const addMeter = async () => {
    if (!newName.trim()) { toast.error('Enter a meter name'); return; }
    setAddBusy(true);
    const { data, error } = await supabase
      .from('product_meters' as any)
      .insert({ plant_id: plant.id, name: newName.trim(), sort_order: meters?.length ?? 0 } as any)
      .select('id')
      .single();
    setAddBusy(false);
    if (error) { toast.error(error.message); return; }
    await logProductMeterAudit({
      plant_id: plant.id,
      meter_id: (data as any)?.id ?? '',
      meter_name: newName.trim(),
      old_value: null,
      new_value: newName.trim(),
      user_id: user?.id ?? null,
      timestamp: new Date().toISOString(),
    });
    toast.success(`"${newName.trim()}" added`);
    setNewName(''); setAdding(false); invalidate();
  };

  return (
    <Card className="p-3 space-y-2" data-testid="product-meters-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-teal-600" />
          <div>
            <div className="text-sm font-semibold">Product Meters</div>
            <div className="text-[11px] text-muted-foreground">
              Meter readings flow into Operations → Product tab.
            </div>
          </div>
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="add-product-meter-btn">
            <Plus className="h-3 w-3 mr-1" />Add
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && meters && (
        <div className="space-y-1.5">
          {meters.map((m: any) => (
            <ProductMeterRow key={m.id} meter={m} plantId={plant.id} userId={user?.id ?? null} canEdit={canEdit} onChanged={invalidate} />
          ))}
          {meters.length === 0 && (
            <p className="text-xs text-muted-foreground">No product meters yet.{canEdit ? ' Click Add to create one.' : ''}</p>
          )}
        </div>
      )}

      {/* Inline add form */}
      {adding && (
        <div className="flex items-center gap-2 pt-1 border-t">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Main Line, Secondary Line…"
            className="h-8 text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') addMeter(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
            autoFocus
            data-testid="product-meter-name-input"
          />
          <Button size="sm" onClick={addMeter} disabled={addBusy || !newName.trim()} data-testid="save-product-meter-btn">
            {addBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── ProductMeterRow inside Plants (rename + delete) ───────────────────────────

function ProductMeterRow({
  meter, plantId, userId, canEdit, onChanged,
}: {
  meter: any; plantId: string; userId: string | null; canEdit: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(meter.name ?? '');
  const [busy, setBusy] = useState(false);

  const saveName = async () => {
    if (!nameInput.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    const { error } = await supabase
      .from('product_meters' as any)
      .update({ name: nameInput.trim() } as any)
      .eq('id', meter.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logProductMeterAudit({
      plant_id: plantId,
      meter_id: meter.id,
      meter_name: nameInput.trim(),
      old_value: meter.name,
      new_value: nameInput.trim(),
      user_id: userId,
      timestamp: new Date().toISOString(),
    });
    toast.success('Meter renamed');
    setEditing(false);
    onChanged();
  };

  const deleteMeter = async () => {
    if (!confirm(`Delete meter "${meter.name}"? All its readings will be removed.`)) return;
    setBusy(true);
    await supabase.from('product_meter_readings' as any).delete().eq('meter_id', meter.id);
    const { error } = await supabase.from('product_meters' as any).delete().eq('id', meter.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logProductMeterAudit({
      plant_id: plantId,
      meter_id: meter.id,
      meter_name: meter.name,
      old_value: meter.name,
      new_value: null,
      user_id: userId,
      timestamp: new Date().toISOString(),
    });
    toast.success(`"${meter.name}" deleted`);
    onChanged();
  };

  return (
    <div className="flex items-center gap-2 py-1 px-1 rounded-md hover:bg-muted/40" data-testid={`plant-product-meter-${meter.id}`}>
      <Gauge className="h-3.5 w-3.5 text-teal-500 shrink-0" />
      {editing ? (
        <>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="h-7 text-sm flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={saveName} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditing(false); setNameInput(meter.name); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm flex-1 truncate">{meter.name}</span>
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 sm:opacity-0 sm:group-hover:opacity-100" title="Rename"
                onClick={() => { setNameInput(meter.name); setEditing(true); }}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 sm:opacity-0 sm:group-hover:opacity-100"
                title="Delete" onClick={deleteMeter} disabled={busy}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── BackwashModeCard ─────────────────────────────────────────────────────────
function BackwashModeCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager, user, profile } = useAuth();
  const [mode, setMode] = useState<'independent' | 'synchronized'>(plant.backwash_mode ?? 'independent');
  const save = async (next: 'independent' | 'synchronized') => {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    const { error } = await supabase.from('plants').update({ backwash_mode: next }).eq('id', plant.id);
    if (error) { setMode(prev); toast.error(error.message); return; }
    // Audit: who, when, from → to. Re-uses deletion_audit_log with kind='plant' /
    // action='soft' (the closest valid enum values) and stores the structured
    // change in `dependencies`. Best-effort: table may be missing pre-migration,
    // and any insert error is logged but never blocks the user.
    const actorLabel = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
      || (profile as any)?.email
      || user?.email
      || null;
    try {
      const { error: auditErr } = await supabase
        .from('deletion_audit_log' as any)
        .insert({
          kind: 'plant',
          entity_id: plant.id,
          entity_label: plant.name ?? null,
          action: 'soft',
          actor_user_id: user?.id ?? null,
          actor_label: actorLabel,
          reason: `Backwash mode: ${prev} → ${next}`,
          dependencies: { type: 'backwash_mode_change', from: prev, to: next },
        } as any);
      if (auditErr) console.warn('[audit] backwash_mode_change insert failed:', auditErr.message);
    } catch (e: any) {
      console.warn('[audit] backwash_mode_change threw:', e?.message ?? e);
    }
    toast.success(`Backwash mode set to ${next}`);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };
  return (
    <Card className="p-3" data-testid="backwash-mode-card">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">AFM/MMF backwash mode</div>
          <div className="text-[11px] text-muted-foreground">
            {mode === 'synchronized' ? 'All units on a train backwash together (e.g. Guizo).' : 'Each unit backwashes independently.'}
          </div>
        </div>
        {/* Desktop: side-by-side row · Mobile: stacked rows w/ radio indicator */}
        <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-1 w-full sm:w-auto">
          {(['independent', 'synchronized'] as const).map((m) => {
            const active = mode === m;
            return (
              <Button
                key={m}
                size="sm"
                variant={active ? 'default' : 'outline'}
                disabled={!isManager}
                onClick={() => save(m)}
                className="capitalize justify-start sm:justify-center w-full sm:w-auto"
                data-testid={`backwash-mode-${m}`}
              >
                <span
                  aria-hidden
                  className={`mr-1.5 h-2.5 w-2.5 rounded-full border ${
                    active ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'
                  }`}
                />
                {m}
              </Button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── EnergySourceInline ──────────────────────────────────────────────────────
// Compact energy source display + edit — sits inside the gradient plant card.

function EnergySourceInline({ plant, isManager, qc }: { plant: any; isManager: boolean; qc: any }) {
  const [hasSolar, setHasSolar] = useState<boolean>(!!plant.has_solar);
  const [hasGrid, setHasGrid] = useState<boolean>(plant.has_grid !== false);
  const [solarKw, setSolarKw] = useState<string>(plant.solar_capacity_kw != null ? String(plant.solar_capacity_kw) : '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('plants').update({
      has_solar: hasSolar,
      has_grid: hasGrid,
      solar_capacity_kw: solarKw ? +solarKw : null,
    }).eq('id', plant.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Energy sources updated');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  const cancel = () => {
    setHasSolar(!!plant.has_solar);
    setHasGrid(plant.has_grid !== false);
    setSolarKw(plant.solar_capacity_kw != null ? String(plant.solar_capacity_kw) : '');
    setEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold opacity-70 uppercase tracking-wide flex items-center gap-1">
            <Zap className="h-3 w-3" /> Energy
          </span>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {hasSolar && (
              <span className="inline-flex items-center gap-1 opacity-90">
                <Sun className="h-3 w-3 text-yellow-300" />
                Solar{plant.solar_capacity_kw ? ` · ${plant.solar_capacity_kw} kW` : ''}
              </span>
            )}
            {hasGrid && (
              <span className="inline-flex items-center gap-1 opacity-90">
                <Zap className="h-3 w-3 text-blue-200" /> Grid
              </span>
            )}
            {!hasSolar && !hasGrid && <span className="opacity-50 italic text-xs">No source</span>}
          </div>
        </div>
        {isManager && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] opacity-70 hover:opacity-100 underline underline-offset-2 transition-opacity shrink-0"
            data-testid="edit-energy-inline-btn"
          >
            Edit
          </button>
        )}
      </div>

      {/* Edit panel — shown inline below */}
      {editing && (
        <div className="mt-3 rounded-lg bg-white/10 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-topbar-foreground/90">
              <Switch checked={hasSolar} onCheckedChange={setHasSolar} data-testid="energy-inline-solar" />
              <span className="inline-flex items-center gap-1"><Sun className="h-3.5 w-3.5 text-yellow-300" /> Solar</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-topbar-foreground/90">
              <Switch checked={hasGrid} onCheckedChange={setHasGrid} data-testid="energy-inline-grid" />
              <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-blue-200" /> Grid</span>
            </label>
          </div>
          {hasSolar && (
            <div>
              <Label className="text-xs text-topbar-foreground/70">Solar capacity (kW)</Label>
              <Input
                type="number" step="any" value={solarKw}
                onChange={(e) => setSolarKw(e.target.value)}
                placeholder="e.g. 50"
                className="bg-white/10 border-white/20 text-topbar-foreground placeholder:text-topbar-muted mt-1"
                data-testid="energy-inline-kw"
              />
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="text-topbar-foreground/70 hover:text-topbar-foreground hover:bg-white/10">Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-white/20 hover:bg-white/30 text-topbar-foreground border-0" data-testid="save-energy-inline-btn">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EnergySourceCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [hasSolar, setHasSolar] = useState<boolean>(!!plant.has_solar);
  const [hasGrid, setHasGrid] = useState<boolean>(plant.has_grid !== false);
  const [solarKw, setSolarKw] = useState<string>(
    plant.solar_capacity_kw != null ? String(plant.solar_capacity_kw) : '',
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const payload: any = {
      has_solar: hasSolar,
      has_grid: hasGrid,
      solar_capacity_kw: solarKw ? +solarKw : null,
    };
    const { error } = await supabase.from('plants').update(payload).eq('id', plant.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Energy sources updated');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  return (
    <Card className="p-3" data-testid="energy-source-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-chart-6" /> Energy Sources
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {hasSolar && (
                <span className="inline-flex items-center gap-1">
                  <Sun className="h-3 w-3 text-yellow-500" />
                  Solar{plant.solar_capacity_kw ? ` · ${plant.solar_capacity_kw} kW` : ''}
                </span>
              )}
              {hasGrid && (
                <span className="inline-flex items-center gap-1">
                  <Zap className="h-3 w-3 text-chart-6" /> Grid
                </span>
              )}
              {!hasSolar && !hasGrid && <span className="italic">No source configured</span>}
            </div>
          </div>
        </div>
        {isManager && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="edit-energy-btn">
            <Wrench className="h-3 w-3 mr-1" />Edit
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={hasSolar}
              onCheckedChange={setHasSolar}
              data-testid="energy-has-solar"
            />
            <span className="inline-flex items-center gap-1">
              <Sun className="h-3.5 w-3.5 text-yellow-500" /> Has solar
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={hasGrid}
              onCheckedChange={setHasGrid}
              data-testid="energy-has-grid"
            />
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3.5 w-3.5 text-chart-6" /> Has grid
            </span>
          </label>
          <div>
            <Label className="text-xs">Solar capacity (kW)</Label>
            <Input
              type="number" step="any" value={solarKw}
              onChange={(e) => setSolarKw(e.target.value)}
              disabled={!hasSolar}
              placeholder="e.g. 50"
              data-testid="energy-solar-kw"
            />
          </div>
          <div className="sm:col-span-3 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => {
              setEditing(false);
              setHasSolar(!!plant.has_solar);
              setHasGrid(plant.has_grid !== false);
              setSolarKw(plant.solar_capacity_kw != null ? String(plant.solar_capacity_kw) : '');
            }} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} data-testid="save-energy-btn">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function LocatorsList({ plantId }: { plantId: string }) {
  const qc = useQueryClient();
  const { isManager, isAdmin, user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [showLocatorCsv, setShowLocatorCsv] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const doDelete = async () => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'locator', entity_id: deleteTarget.id, entity_label: deleteTarget.name, action: 'hard', reason: deleteReason.trim(), performed_by: user?.id ?? null, forced: false }] as any);
    } catch {}
    const { error } = await supabase.from('locators').delete().eq('id', deleteTarget.id);
    setDeleteBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Locator deleted');
    setDeleteTarget(null);
    setDeleteReason('');
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  const toggleLocatorStatus = async (l: any) => {
    if (!isManager) return;
    const newStatus = l.status === 'Active' ? 'Inactive' : 'Active';
    const { error } = await supabase.from('locators').update({ status: newStatus }).eq('id', l.id);
    if (error) { toast.error(error.message); return; }
    await logStatusChange({
      user_id: user?.id ?? null,
      plant_id: l.plant_id,
      entity_type: 'Locator',
      entity_id: l.id,
      entity_label: l.name,
      from_status: l.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Locator marked ${newStatus}`);
  };

  const { data: locators } = useQuery({
    queryKey: ['locators', plantId],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('*').eq('plant_id', plantId).order('name');
      return data ?? [];
    },
  });

  // Admin selection / bulk-delete state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (!locators) return;
    if (selected.size === locators.length) setSelected(new Set());
    else setSelected(new Set(locators.map((l: any) => l.id)));
  };

  const auditDelete = async (rows: { id: string; name: string }[], reason: string, bulk: boolean) => {
    try {
      const payload = rows.map((r) => ({
        kind: 'locator',
        entity_id: r.id,
        entity_label: r.name ?? null,
        action: 'hard',
        reason: bulk ? `[BULK] ${reason}` : reason,
        performed_by: user?.id ?? null,
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
    const rows = (locators ?? []).filter((l: any) => ids.includes(l.id)).map((l: any) => ({ id: l.id, name: l.name }));
    // locators have ON DELETE CASCADE on readings/replacements.
    const { error } = await supabase.from('locators').delete().in('id', ids);
    if (error) { setBulkBusy(false); toast.error(error.message); return; }
    await auditDelete(rows, bulkReason.trim(), true);
    setBulkBusy(false);
    setBulkOpen(false);
    setBulkReason('');
    setSelected(new Set());
    toast.success(`${ids.length} locator(s) permanently deleted`);
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  if (detail) return <LocatorDetail locatorId={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Locators ({locators?.length ?? 0})</h3>
        <div className="flex items-center gap-2">
          {isAdmin && locators && locators.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleAll}
              className="text-xs"
              data-testid="locators-toggle-all"
            >
              {selected.size === locators.length ? 'Clear' : 'Select all'}
            </Button>
          )}
          {isAdmin && selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-danger text-danger hover:bg-danger/10"
              onClick={() => setBulkOpen(true)}
              data-testid="locators-bulk-delete-btn"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete {selected.size}
            </Button>
          )}
          {isManager && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowLocatorCsv(true)}>
              <Upload className="h-3 w-3 mr-1" />Import CSV
            </Button>
          )}
        </div>
      </div>
      {locators?.map((l: any) => {
        const checked = selected.has(l.id);
        return (
          <Card
            key={l.id}
            className={`p-3 hover:shadow-elev ${checked ? 'ring-1 ring-primary' : ''}`}
            data-testid={`locator-card-${l.id}`}
          >
            <div className="flex items-start gap-2">
              {isAdmin && (
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleOne(l.id)}
                  className="mt-1"
                  data-testid={`locator-select-${l.id}`}
                />
              )}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setDetail(l.id)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{l.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.meter_brand} {l.meter_size} · SN {l.meter_serial ?? '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleLocatorStatus(l); }}
                    title={isManager ? `Click to toggle status (currently ${l.status})` : l.status}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md shrink-0 border transition-colors ${
                      l.status === 'Active'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                    } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${l.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    {l.status}
                  </button>
                </div>
              </div>
              {isManager && (
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => setEditing(l)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete" onClick={() => { setDeleteTarget(l); setDeleteReason(''); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </Card>
        );
      })}
      {!locators?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No Locators Yet</Card>}
      {adding && <AddLocatorDialog plantId={plantId} onClose={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }} />}
      {editing && <EditLocatorDialog locator={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }} />}
      {showLocatorCsv && (
        <LocatorCsvImportDialog
          plantId={plantId}
          onClose={() => { setShowLocatorCsv(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }}
        />
      )}

      {/* Single delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteBusy && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>All meter readings and replacement logs will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={deleteReason} onChange={setDeleteReason} testId="locator-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={deleteBusy || deleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {selected.size} locator(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All meter readings and meter-replacement logs attached to the
              selected locators will be removed via the database cascade rule.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={bulkReason} onChange={setBulkReason} testId="locators-bulk-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doBulkDelete}
              disabled={bulkBusy || bulkReason.trim().length < 5}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-locators-bulk-delete"
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

// Shared "reason" textarea with min-5-char hint, used by all admin delete dialogs.
function ReasonField({
  value, onChange, testId,
}: { value: string; onChange: (v: string) => void; testId: string }) {
  const tooShort = value.length > 0 && value.trim().length < 5;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Reason <span className="text-danger">*</span>
        <span className="ml-1 text-[10px]">(min 5 chars — required for audit log)</span>
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Decommissioned after Q1 2026 inspection"
        maxLength={500}
        rows={2}
        data-testid={testId}
        aria-invalid={tooShort}
        className={tooShort ? 'border-danger' : ''}
      />
      {tooShort && (
        <p className="text-[10px] text-danger">
          Reason must be at least 5 characters ({value.trim().length}/5).
        </p>
      )}
    </div>
  );
}

function EditLocatorDialog({ locator, onClose }: { locator: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: locator.name ?? '', address: locator.address ?? locator.location_desc ?? '',
    meter_brand: locator.meter_brand ?? '', meter_size: locator.meter_size ?? '', meter_serial: locator.meter_serial ?? '',
    meter_installed_date: locator.meter_installed_date ?? '', gps_lat: locator.gps_lat?.toString() ?? '', gps_lng: locator.gps_lng?.toString() ?? '',
  });
  const [locating, setLocating] = useState(false);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 })
      );
      setForm(f => ({ ...f, gps_lat: pos.coords.latitude.toFixed(6), gps_lng: pos.coords.longitude.toFixed(6) }));
      toast.success('Location captured');
    } catch {
      toast.error('Could not get location');
    } finally {
      setLocating(false);
    }
  };

  const { user } = useAuth();

  const submit = async () => {
    if (!form.name) { toast.error('Name Required'); return; }
    const { error } = await supabase.from('locators').update({
      name: form.name, address: form.address || null, location_desc: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    }).eq('id', locator.id);
    if (error) { toast.error(error.message); return; }
    // Audit status flip
    if (form.status && form.status !== locator.status) {
      await logStatusChange({
        user_id: user?.id ?? null,
        plant_id: locator.plant_id,
        entity_type: 'Locator',
        entity_id: locator.id,
        entity_label: form.name,
        from_status: locator.status,
        to_status: form.status,
        timestamp: new Date().toISOString(),
      });
    }
    toast.success('Locator updated'); onClose();
  };

  const hasCoords = form.gps_lat && form.gps_lng;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}` : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Locator</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div>
              <Label>Size</Label>
              <div className="relative">
                <Input type="number" min="0" step="0.5" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} className="pr-10" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
              </div>
            </div>
            <div><Label>Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>

          {/* GPS row — editable inputs + clickable map link + use-my-location */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>GPS Coordinates</Label>
              <div className="flex items-center gap-2">
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <MapPin className="h-3 w-3" />View on map
                  </a>
                )}
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2"
                  onClick={useMyLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                  {locating ? 'Locating…' : 'Use my location'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.3157" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.8854" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLocatorDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', address: '', meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '', gps_lat: '', gps_lng: '' });
  const [locating, setLocating] = useState(false);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 })
      );
      setForm((f) => ({
        ...f,
        gps_lat: pos.coords.latitude.toFixed(6),
        gps_lng: pos.coords.longitude.toFixed(6),
      }));
      toast.success('Location Captured');
    } catch (e: any) {
      toast.error(`Location Failed: ${e.message || 'Permission Denied'}`);
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!form.name) { toast.error('Name Required'); return; }
    const { error } = await supabase.from('locators').insert({
      plant_id: plantId, name: form.name, address: form.address || null, location_desc: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Locator Added'); onClose();
  };

  const hasCoords = form.gps_lat && form.gps_lng;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}` : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Locator</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div>
              <Label>Size</Label>
              <div className="relative">
                <Input type="number" min="0" step="0.5" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} className="pr-10" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
              </div>
            </div>
            <div><Label>Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>
          {/* GPS row */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>GPS Coordinates</Label>
              <div className="flex items-center gap-2">
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <MapPin className="h-3 w-3" />View on map
                  </a>
                )}
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2"
                  onClick={useMyLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                  {locating ? 'Locating…' : 'Use my location'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.3157" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.8854" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LocatorDetail({ locatorId, onBack }: { locatorId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const { data: locator } = useQuery({
    queryKey: ['locator', locatorId],
    queryFn: async () => (await supabase.from('locators').select('*').eq('id', locatorId).single()).data,
  });
  const { data: replacements } = useQuery({
    queryKey: ['locator-replacements', locatorId],
    queryFn: async () => (await supabase.from('locator_meter_replacements').select('*').eq('locator_id', locatorId).order('replacement_date', { ascending: false })).data ?? [],
  });
  if (!locator) return <div>Loading…</div>;
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> Back</button>
      <Card className="p-3">
        <h3 className="font-semibold">{locator.name}</h3>
        <p className="text-xs text-muted-foreground">{locator.address}</p>
        <div className="mt-3 text-sm space-y-1">
          <div>Brand: <span className="font-medium">{locator.meter_brand ?? '—'}</span></div>
          <div>Size: <span className="font-medium">{locator.meter_size ?? '—'}</span></div>
          <div>Serial: <span className="font-mono-num">{locator.meter_serial ?? '—'}</span></div>
          <div>Installed: <span>{locator.meter_installed_date ?? '—'}</span></div>
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-muted-foreground" />
            GPS: <span className="font-mono-num">
              {locator.gps_lat != null && locator.gps_lng != null
                ? `${(+locator.gps_lat).toFixed(5)}, ${(+locator.gps_lng).toFixed(5)}`
                : '—'}
            </span>
          </div>
        </div>
        <Button size="sm" className="mt-3" onClick={() => setReplaceOpen(true)}><Wrench className="h-3 w-3 mr-1" />Replace meter</Button>
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Replacement history</h4>
        {replacements?.length ? replacements.map((r: any) => (
          <div key={r.id} className="border-t py-2 text-xs">
            <div className="font-medium">{r.replacement_date}</div>
            <div className="text-muted-foreground">Old SN {r.old_meter_serial ?? '—'} ({r.old_meter_final_reading ?? '—'}) → New SN {r.new_meter_serial ?? '—'} ({r.new_meter_initial_reading ?? '—'})</div>
          </div>
        )) : <p className="text-xs text-muted-foreground">No replacements</p>}
      </Card>
      {replaceOpen && (
        <ReplaceMeterDialog
          kind="locator" assetId={locatorId} plantId={locator.plant_id} oldSerial={locator.meter_serial}
          onClose={() => { setReplaceOpen(false); qc.invalidateQueries({ queryKey: ['locator', locatorId] }); qc.invalidateQueries({ queryKey: ['locator-replacements', locatorId] }); }}
        />
      )}
    </div>
  );
}

export function ReplaceMeterDialog({ kind, assetId, plantId, oldSerial, onClose }: { kind: 'locator' | 'well'; assetId: string; plantId: string; oldSerial: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    replacement_date: format(new Date(), 'yyyy-MM-dd'),
    old_final_reading: '', new_brand: '', new_size: '', new_serial: '', new_initial_reading: '', new_installed_date: format(new Date(), 'yyyy-MM-dd'), remarks: '',
  });
  const submit = async () => {
    if (!form.new_serial) { toast.error('New serial required'); return; }
    const payload: any = {
      plant_id: plantId, replacement_date: form.replacement_date,
      replaced_by: user?.id, remarks: form.remarks || null,
    };
    if (kind === 'locator') {
      Object.assign(payload, {
        locator_id: assetId, old_meter_serial: oldSerial, old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
        new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_meter_installed_date: form.new_installed_date,
      });
      const { error } = await supabase.from('locator_meter_replacements').insert(payload);
      if (error) { toast.error(error.message); return; }
      await supabase.from('locators').update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: form.new_installed_date }).eq('id', assetId);
    } else {
      Object.assign(payload, {
        well_id: assetId, old_serial: oldSerial, old_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_brand: form.new_brand, new_size: form.new_size, new_serial: form.new_serial,
        new_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_installed_date: form.new_installed_date,
      });
      const { error } = await supabase.from('well_meter_replacements').insert(payload);
      if (error) { toast.error(error.message); return; }
      await supabase.from('wells').update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: form.new_installed_date }).eq('id', assetId);
    }
    toast.success('Meter replaced');
    onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace meter</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Replacement date</Label><Input type="date" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} /></div>
            <div><Label>Old final reading</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} /></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{oldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} /></div>
            <div><Label>New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} /></div>
            <div><Label>New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Initial reading</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} /></div>
            <div><Label>Installed date</Label><Input type="date" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} /></div>
          </div>
          <div><Label>Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Save replacement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WellsList({ plantId }: { plantId: string }) {
  const qc = useQueryClient();
  const { isManager, isAdmin, user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [editingWell, setEditingWell] = useState<any | null>(null);
  const [showWellCsv, setShowWellCsv] = useState(false);
  const [wellDeleteTarget, setWellDeleteTarget] = useState<any | null>(null);
  const [wellDeleteReason, setWellDeleteReason] = useState('');
  const [wellDeleteBusy, setWellDeleteBusy] = useState(false);

  const doWellDelete = async () => {
    if (!wellDeleteTarget) return;
    if (wellDeleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setWellDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'well', entity_id: wellDeleteTarget.id, entity_label: wellDeleteTarget.name, action: 'hard', reason: wellDeleteReason.trim(), performed_by: user?.id ?? null, forced: false }] as any);
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
      user_id: user?.id ?? null,
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  // Per-well blending-toggle in-flight indicator.
  const [blendingBusy, setBlendingBusy] = useState<Set<string>>(new Set());
  // Per-well power-meter toggle in-flight indicator.
  const [powerBusy, setPowerBusy] = useState<Set<string>>(new Set());

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
        performed_by: user?.id ?? null,
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

  // Toggle dedicated power meter on a well. Independent of Blending — a well
  // may carry both flags (e.g. a blending well that also has its own kWh meter).
  const togglePowerMeter = async (w: any, on: boolean) => {
    setPowerBusy(prev => { const n = new Set(prev); n.add(w.id); return n; });
    const { error } = await supabase
      .from('wells')
      .update({ has_power_meter: on })
      .eq('id', w.id);
    setPowerBusy(prev => { const n = new Set(prev); n.delete(w.id); return n; });
    if (error) { toast.error(`Power meter toggle failed: ${error.message}`); return; }
    toast.success(on
      ? `${w.name}: power meter enabled — Operations will show a kWh input`
      : `${w.name}: power meter disabled`);
    qc.invalidateQueries({ queryKey: ['wells', plantId] });
  };

  const toggleBlending = async (w: any, next: boolean) => {
    if (!isManager) return;
    setBlendingBusy((prev) => { const s = new Set(prev); s.add(w.id); return s; });
    try {
      if (next) {
        const { error } = await supabase
          .from('well_blending')
          .upsert({ well_id: w.id, plant_id: plantId, tagged_at: new Date().toISOString(), tagged_by: user?.id ?? null }, { onConflict: 'well_id' });
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
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Wells ({wells?.length ?? 0})</h3>
        <div className="flex items-center gap-2">
          {isAdmin && wells && wells.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleAll}
              className="text-xs"
              data-testid="wells-toggle-all"
            >
              {selected.size === wells.length ? 'Clear' : 'Select all'}
            </Button>
          )}
          {isAdmin && selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-danger text-danger hover:bg-danger/10"
              onClick={() => setBulkDeleteOpen(true)}
              data-testid="wells-bulk-delete-btn"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete {selected.size}
            </Button>
          )}
          {isManager && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="add-well-btn">
              <Plus className="h-3 w-3 mr-1" />Add Well
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowWellCsv(true)}>
              <Upload className="h-3 w-3 mr-1" />Import CSV
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
            className={`p-3 hover:shadow-elev ${checked ? 'ring-1 ring-primary' : ''} ${isBlending ? 'border-teal-400' : ''}`}
            data-testid={`well-card-${w.id}`}
          >
            <div className="flex items-start gap-2">
              {isAdmin && (
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(w.id)}
                  className="mt-1"
                  data-testid={`well-select-${w.id}`}
                />
              )}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setDetail(w.id)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
                      <span className="truncate">{w.name}</span>
                      {w.has_power_meter && (
                        <span
                          className="text-[9px] uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                          title="Has dedicated electric meter"
                        >
                          <Zap className="h-2.5 w-2.5" /> Electric
                        </span>
                      )}
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
                      <span>
                        {w.diameter ?? '—'} · {w.drilling_depth_m ?? '—'} m
                      </span>
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
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md shrink-0 border transition-colors ${
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
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit well" onClick={e => { e.stopPropagation(); setEditingWell(w); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete well" onClick={e => { e.stopPropagation(); setWellDeleteTarget(w); setWellDeleteReason(''); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <label
                    className={`flex items-center gap-1 h-7 px-2 rounded-md border cursor-pointer select-none transition-colors ${
                      isBlending
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'bg-background border-border hover:bg-muted'
                    } ${blendingPending ? 'opacity-60 cursor-wait' : ''}`}
                    title={
                      isBlending
                        ? 'Blending on — separate water meter feeds product line. Click to clear.'
                        : 'Mark as blending — well injects to product line; meter is tracked separately'
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isBlending}
                      disabled={blendingPending}
                      onCheckedChange={(v) => toggleBlending(w, !!v)}
                      className={isBlending ? 'border-teal-600 data-[state=checked]:bg-teal-700 data-[state=checked]:border-teal-700' : ''}
                      data-testid={`well-blending-${w.id}`}
                    />
                    <span className="text-[11px] font-medium whitespace-nowrap">Blending</span>
                  </label>
                  <label
                    className={`flex items-center gap-1 h-7 px-2 rounded-md border cursor-pointer select-none transition-colors ${
                      w.has_power_meter
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'bg-background border-border hover:bg-muted'
                    } ${powerBusy.has(w.id) ? 'opacity-60 cursor-wait' : ''}`}
                    title={
                      w.has_power_meter
                        ? 'Dedicated power meter on — Operations shows a kWh input. Click to clear.'
                        : 'Mark this well as having a dedicated power meter'
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={!!w.has_power_meter}
                      disabled={powerBusy.has(w.id)}
                      onCheckedChange={(v) => togglePowerMeter(w, !!v)}
                      className={w.has_power_meter ? 'border-teal-600 data-[state=checked]:bg-teal-700 data-[state=checked]:border-teal-700' : ''}
                      data-testid={`well-power-${w.id}`}
                    />
                    <span className="text-[11px] font-medium whitespace-nowrap inline-flex items-center gap-0.5">
                      <Zap className="h-2.5 w-2.5" /> Power
                    </span>
                  </label>
                </div>
              )}
            </div>
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

function EditWellDialog({ well, onClose }: { well: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: well.name ?? '', diameter: well.diameter ?? '', drilling_depth_m: well.drilling_depth_m?.toString() ?? '',
    meter_brand: well.meter_brand ?? '', meter_size: well.meter_size ?? '', meter_serial: well.meter_serial ?? '',
    gps_lat: well.gps_lat?.toString() ?? '', gps_lng: well.gps_lng?.toString() ?? '',
  });
  const { user } = useAuth();

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name Required'); return; }
    const prevStatus = well.status;
    const nextStatus = well.status; // EditWellDialog doesn't change status — status changes via the toggle in the card
    const { error } = await supabase.from('wells').update({
      name: form.name.trim(), diameter: form.diameter || null,
      drilling_depth_m: form.drilling_depth_m ? +form.drilling_depth_m : null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    }).eq('id', well.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Well updated'); onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Well</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Diameter</Label><Input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} /></div>
            <div><Label>Depth (m)</Label><Input type="number" value={form.drilling_depth_m} onChange={e => setForm({ ...form, drilling_depth_m: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Meter Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div><Label>Meter Size</Label><Input value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} /></div>
            <div><Label>Meter Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>GPS Lat</Label><Input value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} /></div>
            <div><Label>GPS Lng</Label><Input value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddWellDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [form, setForm] = useState({
    name: '', diameter: '', drilling_depth_m: '', has_power_meter: false,
    meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '',
    electric_meter_brand: '', electric_meter_size: '', electric_meter_serial: '', electric_meter_installed_date: '',
    gps_lat: '', gps_lng: '',
  });
  const [locating, setLocating] = useState(false);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 })
      );
      setForm((f) => ({
        ...f,
        gps_lat: pos.coords.latitude.toFixed(6),
        gps_lng: pos.coords.longitude.toFixed(6),
      }));
      toast.success('Location Captured');
    } catch (e: any) {
      toast.error(`Location Failed: ${e.message || 'Permission Denied'}`);
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name Required'); return; }
    const payload: Database['public']['Tables']['wells']['Insert'] & {
      gps_lat?: number | null; gps_lng?: number | null;
      electric_meter_brand?: string | null;
      electric_meter_size?: string | null;
      electric_meter_serial?: string | null;
      electric_meter_installed_date?: string | null;
    } = {
      plant_id: plantId,
      name: form.name.trim(),
      diameter: form.diameter || null,
      drilling_depth_m: form.drilling_depth_m ? +form.drilling_depth_m : null,
      has_power_meter: form.has_power_meter,
      meter_brand: form.meter_brand || null,
      meter_size: form.meter_size || null,
      meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null,
      gps_lng: form.gps_lng ? +form.gps_lng : null,
      status: 'Active',
    };
    if (form.has_power_meter) {
      payload.electric_meter_brand = form.electric_meter_brand || null;
      payload.electric_meter_size = form.electric_meter_size || null;
      payload.electric_meter_serial = form.electric_meter_serial || null;
      payload.electric_meter_installed_date = form.electric_meter_installed_date || null;
    }
    const { error } = await supabase.from('wells').insert(payload as never);
    if (error) { toast.error(error.message); return; }
    toast.success('Well Added');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Well</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name *</Label>
            <Input data-testid="add-well-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Well #1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Diameter</Label><Input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} placeholder="8 inch" /></div>
            <div><Label>Depth (m)</Label><Input type="number" value={form.drilling_depth_m} onChange={e => setForm({ ...form, drilling_depth_m: e.target.value })} /></div>
          </div>

          {/* Water meter */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <div className="text-xs font-semibold inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Water Meter
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
              <div><Label className="text-xs">Size</Label><Input type="number" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} /></div>
              <div><Label className="text-xs">Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
            </div>
          </div>

          {/* Electric meter (optional) */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <Checkbox
                checked={form.has_power_meter}
                onCheckedChange={(v) => setForm({ ...form, has_power_meter: !!v })}
                data-testid="add-well-has-power-meter"
              />
              <Zap className="h-3 w-3 text-amber-500" />
              Has Dedicated Electric Meter
            </label>
            {form.has_power_meter && (
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Brand</Label><Input value={form.electric_meter_brand} onChange={e => setForm({ ...form, electric_meter_brand: e.target.value })} data-testid="add-well-em-brand" /></div>
                <div><Label className="text-xs">Size</Label><Input value={form.electric_meter_size} onChange={e => setForm({ ...form, electric_meter_size: e.target.value })} placeholder="kWh" /></div>
                <div><Label className="text-xs">Serial</Label><Input value={form.electric_meter_serial} onChange={e => setForm({ ...form, electric_meter_serial: e.target.value })} data-testid="add-well-em-serial" /></div>
                <div className="col-span-3">
                  <Label className="text-xs">Installed</Label>
                  <Input type="date" value={form.electric_meter_installed_date} onChange={e => setForm({ ...form, electric_meter_installed_date: e.target.value })} />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div><Label>GPS Lat</Label>
              <Input data-testid="add-well-lat" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} placeholder="10.295" />
            </div>
            <div><Label>GPS Lng</Label>
              <Input data-testid="add-well-lng" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} placeholder="123.877" />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={useMyLocation} disabled={locating} data-testid="use-my-location-btn">
            <MapPin className="h-3 w-3 mr-1" />
            {locating ? 'Capturing…' : 'Use My Location'}
          </Button>
        </div>
        <DialogFooter>
          <Button data-testid="add-well-save" onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  // Recent raw meter readings — water + power side by side (Section 3 of spec).
  const { data: rawReadings = [] } = useQuery<any[]>({
    queryKey: ['well-raw-readings', wellId],
    queryFn: async () => {
      const { data } = await supabase
        .from('well_readings')
        .select('id, reading_datetime, current_reading, previous_reading, power_meter_reading')
        .eq('well_id', wellId)
        .order('reading_datetime', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  if (!well) return <div>Loading…</div>;
  const latest = pms?.[0];
  const replacerName = latestReplacement?.replacer
    ? [latestReplacement.replacer.first_name, latestReplacement.replacer.last_name].filter(Boolean).join(' ')
    : null;
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> Back</button>
      <Card className="p-3">
        <h3 className="font-semibold">{well.name}</h3>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>{well.diameter ?? '—'}</span>
          {(well as any).gps_lat != null && (well as any).gps_lng != null && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              <span className="font-mono-num">{(+(well as any).gps_lat).toFixed(5)}, {(+(well as any).gps_lng).toFixed(5)}</span>
            </span>
          )}
        </div>
      </Card>
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-2"><Gauge className="h-4 w-4" />Hydraulic data</span>
          {isManager && (
            <Button size="sm" variant="outline" onClick={() => setEditHydraulicOpen(true)}>
              <Wrench className="h-3 w-3 mr-1" />Edit
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>Drilling depth: <span className="font-mono-num">{(latest as any)?.drilling_depth_m ?? well.drilling_depth_m ?? '—'} m</span></div>
          <div>SWL: <span className="font-mono-num">{latest?.static_water_level_m ?? '—'} m</span></div>
          <div>PWL: <span className="font-mono-num">{latest?.pumping_water_level_m ?? '—'} m</span></div>
          <div>Pump setting: <span>{latest?.pump_setting ?? '—'}</span></div>
          <div>Motor HP: <span className="font-mono-num">{latest?.motor_hp ?? '—'}</span></div>
          <div>TDS: <span className="font-mono-num">{latest?.tds_ppm ?? '—'} ppm</span></div>
          <div>Turbidity: <span className="font-mono-num">{latest?.turbidity_ntu ?? '—'} NTU</span></div>
          <div className="col-span-2 text-muted-foreground">Last gathered: {latest?.date_gathered ?? '—'}</div>
        </div>
        {pms && pms.length > 1 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer">History ({pms.length})</summary>
            <div className="mt-2 space-y-1 text-[11px] max-h-48 overflow-y-auto">
              {pms.map((p: any) => (
                <div key={p.id} className="border-t py-1">
                  <span className="font-medium">{p.date_gathered}</span> · depth {p.drilling_depth_m ?? '—'}m · SWL {p.static_water_level_m ?? '—'}m · PWL {p.pumping_water_level_m ?? '—'}m
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>
      <Card className="p-3">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-semibold inline-flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5" /> Active Water Meter
          </h4>
          <Button size="sm" variant="outline" onClick={() => setReplaceOpen(true)}><Wrench className="h-3 w-3 mr-1" />Replace</Button>
        </div>
        <div className="mt-2 text-xs space-y-1">
          <div>Brand: {well.meter_brand ?? '—'}</div>
          <div>Size: <span className="font-mono-num">{well.meter_size ?? '—'}</span> {well.meter_size && <span className="text-muted-foreground">inch</span>}</div>
          <div>Serial: <span className="font-mono-num">{well.meter_serial ?? '—'}</span></div>
          <div>Installed: {well.meter_installed_date ?? '—'}</div>
          <div className="text-muted-foreground">
            Replaced by: {replacerName ?? '—'}
            {latestReplacement?.replacement_date ? ` on ${latestReplacement.replacement_date}` : ''}
          </div>
        </div>
      </Card>

      {well.has_power_meter && (
        <Card className="p-3" data-testid="well-electric-meter-card">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-semibold inline-flex items-center gap-1">
              <Zap className="h-3.5 w-3.5 text-amber-500" /> Active Electric Meter
            </h4>
            {isManager && (
              <Button size="sm" variant="outline" onClick={() => setEditElectricOpen(true)}>
                <Wrench className="h-3 w-3 mr-1" />Edit
              </Button>
            )}
          </div>
          <div className="mt-2 text-xs space-y-1">
            <div>Brand: {(well as any).electric_meter_brand ?? '—'}</div>
            <div>Size: <span className="font-mono-num">{(well as any).electric_meter_size ?? '—'}</span></div>
            <div>Serial: <span className="font-mono-num">{(well as any).electric_meter_serial ?? '—'}</span></div>
            <div>Installed: {(well as any).electric_meter_installed_date ?? '—'}</div>
          </div>
        </Card>
      )}
      {/* Raw Readings — water meter + power meter side by side (last 10) */}
      <Card className="p-3" data-testid="well-raw-readings-card">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <h4 className="text-sm font-semibold inline-flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5" /> Raw Readings
            {well.has_power_meter && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                <Zap className="h-2.5 w-2.5" /> kWh tracked
              </span>
            )}
          </h4>
          <span className="text-[10px] text-muted-foreground">last {rawReadings.length} of 10</span>
        </div>
        {rawReadings.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-2 text-center">
            No meter readings recorded yet
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left px-1 py-1.5 font-medium">When</th>
                  <th className="text-right px-1 py-1.5 font-medium">
                    <span className="inline-flex items-center gap-0.5">
                      <Gauge className="h-2.5 w-2.5" /> Water (m³)
                    </span>
                  </th>
                  <th className="text-right px-1 py-1.5 font-medium">Δ</th>
                  {well.has_power_meter && (
                    <th className="text-right px-1 py-1.5 font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        <Zap className="h-2.5 w-2.5 text-amber-500" /> Power (kWh)
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rawReadings.map((r: any) => {
                  const delta = r.previous_reading != null && r.current_reading != null
                    ? +r.current_reading - +r.previous_reading
                    : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-1 py-1.5 text-muted-foreground whitespace-nowrap">
                        {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d HH:mm') : '—'}
                      </td>
                      <td className="px-1 py-1.5 text-right font-mono-num">
                        {r.current_reading != null ? fmtNum(+r.current_reading) : '—'}
                      </td>
                      <td className="px-1 py-1.5 text-right font-mono-num text-muted-foreground">
                        {delta != null ? fmtNum(delta) : '—'}
                      </td>
                      {well.has_power_meter && (
                        <td className="px-1 py-1.5 text-right font-mono-num text-amber-700 dark:text-amber-300">
                          {r.power_meter_reading != null ? fmtNum(+r.power_meter_reading) : '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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

function EditElectricMeterDialog({ well, onClose }: { well: any; onClose: () => void }) {
  const [form, setForm] = useState({
    has_power_meter: !!well.has_power_meter,
    electric_meter_brand: well.electric_meter_brand ?? '',
    electric_meter_size: well.electric_meter_size ?? '',
    electric_meter_serial: well.electric_meter_serial ?? '',
    electric_meter_installed_date: well.electric_meter_installed_date ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const payload: any = {
      has_power_meter: form.has_power_meter,
      electric_meter_brand: form.electric_meter_brand || null,
      electric_meter_size: form.electric_meter_size || null,
      electric_meter_serial: form.electric_meter_serial || null,
      electric_meter_installed_date: form.electric_meter_installed_date || null,
    };
    const { error } = await supabase.from('wells').update(payload).eq('id', well.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Electric meter updated');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Electric Meter — {well.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.has_power_meter}
              onCheckedChange={(v) => setForm({ ...form, has_power_meter: v })}
              data-testid="edit-em-has-power"
            />
            Has dedicated electric meter
          </label>
          {form.has_power_meter && (
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Brand</Label><Input value={form.electric_meter_brand} onChange={e => setForm({ ...form, electric_meter_brand: e.target.value })} /></div>
              <div><Label className="text-xs">Size</Label><Input value={form.electric_meter_size} onChange={e => setForm({ ...form, electric_meter_size: e.target.value })} placeholder="kWh" /></div>
              <div><Label className="text-xs">Serial</Label><Input value={form.electric_meter_serial} onChange={e => setForm({ ...form, electric_meter_serial: e.target.value })} /></div>
              <div className="col-span-3">
                <Label className="text-xs">Installed</Label>
                <Input type="date" value={form.electric_meter_installed_date} onChange={e => setForm({ ...form, electric_meter_installed_date: e.target.value })} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} data-testid="save-electric-meter">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditHydraulicDialog({ well, latest, onClose }: { well: any; latest: any; onClose: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    date_gathered: format(new Date(), 'yyyy-MM-dd'),
    drilling_depth_m: (latest as any)?.drilling_depth_m ?? well.drilling_depth_m ?? '',
    static_water_level_m: latest?.static_water_level_m ?? '',
    pumping_water_level_m: latest?.pumping_water_level_m ?? '',
    pump_setting: latest?.pump_setting ?? '',
    motor_hp: latest?.motor_hp ?? '',
    tds_ppm: latest?.tds_ppm ?? '',
    turbidity_ntu: latest?.turbidity_ntu ?? '',
    remarks: '',
  });
  const submit = async () => {
    const num = (v: any) => v === '' || v == null ? null : +v;
    const { error } = await supabase.from('well_pms_records').insert({
      well_id: well.id, plant_id: well.plant_id,
      record_type: 'PMS',
      date_gathered: form.date_gathered,
      static_water_level_m: num(form.static_water_level_m),
      pumping_water_level_m: num(form.pumping_water_level_m),
      pump_setting: form.pump_setting || null,
      motor_hp: num(form.motor_hp),
      tds_ppm: num(form.tds_ppm),
      turbidity_ntu: num(form.turbidity_ntu),
      recorded_by: user?.id, remarks: form.remarks || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    // Keep wells.drilling_depth_m in sync with the latest entry
    if (form.drilling_depth_m !== '') {
      await supabase.from('wells').update({ drilling_depth_m: num(form.drilling_depth_m) }).eq('id', well.id);
    }
    toast.success('Hydraulic data logged');
    onClose();
  };
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit hydraulic data — {well.name}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Date gathered *</Label><Input type="date" value={form.date_gathered} onChange={e => set('date_gathered', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Drilling depth (m)</Label><Input type="number" step="any" value={form.drilling_depth_m} onChange={e => set('drilling_depth_m', e.target.value)} /></div>
            <div><Label>Pump setting</Label><Input value={form.pump_setting} onChange={e => set('pump_setting', e.target.value)} /></div>
            <div><Label>SWL (m)</Label><Input type="number" step="any" value={form.static_water_level_m} onChange={e => set('static_water_level_m', e.target.value)} /></div>
            <div><Label>PWL (m)</Label><Input type="number" step="any" value={form.pumping_water_level_m} onChange={e => set('pumping_water_level_m', e.target.value)} /></div>
            <div><Label>Motor HP</Label><Input type="number" step="any" value={form.motor_hp} onChange={e => set('motor_hp', e.target.value)} /></div>
            <div><Label>TDS (ppm)</Label><Input type="number" step="any" value={form.tds_ppm} onChange={e => set('tds_ppm', e.target.value)} /></div>
            <div className="col-span-2"><Label>Turbidity (NTU)</Label><Input type="number" step="any" value={form.turbidity_ntu} onChange={e => set('turbidity_ntu', e.target.value)} /></div>
            <div className="col-span-2"><Label>Remarks</Label><Input value={form.remarks} onChange={e => set('remarks', e.target.value)} /></div>
          </div>
          <p className="text-[10px] text-muted-foreground">Each save creates a new history entry so you can track changes over time.</p>
        </div>
        <DialogFooter><Button onClick={submit}>Save entry</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plant-level component type card ────────────────────────────────────────

function PlantComponentTypeCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // These fields may not exist in older DB schemas — we use `?? 'AFM'` fallbacks.
  const [mediaType, setMediaType] = useState<'AFM' | 'MMF'>((plant as any).filter_media_type ?? 'AFM');
  const [filterType, setFilterType] = useState<'Cartridge Filter' | 'Bag Filter'>((plant as any).filter_housing_type ?? 'Cartridge Filter');

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('plants')
      .update({ filter_media_type: mediaType, filter_housing_type: filterType } as any)
      .eq('id', plant.id);
    setSaving(false);
    if (error) {
      // Column may not exist yet — show a friendly note instead of crashing
      toast.error(`Could not save plant-level type: ${error.message}. Apply DB migration to add filter_media_type / filter_housing_type columns to plants.`);
      return;
    }
    toast.success('Component types updated for all trains');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  const cancel = () => {
    setMediaType((plant as any).filter_media_type ?? 'AFM');
    setFilterType((plant as any).filter_housing_type ?? 'Cartridge Filter');
    setEditing(false);
  };

  return (
    <Card className="p-3" data-testid="plant-component-type-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-chart-6" /> Plant-wide Component Types
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
            <span>
              Media filter:{' '}
              <span className="font-medium text-foreground">
                {(plant as any).filter_media_type ?? 'AFM'}
              </span>
            </span>
            <span>
              Pre-filter:{' '}
              <span className="font-medium text-foreground">
                {(plant as any).filter_housing_type ?? 'Cartridge Filter'}
              </span>
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Applies universally — reflected in all train labels &amp; forms.
          </div>
        </div>
        {isManager && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="edit-component-types-btn">
            <Wrench className="h-3 w-3 mr-1" />Edit
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-3">
          {/* Media filter type */}
          <div>
            <Label className="text-xs mb-1.5 block">Media Filter Type (applied to all trains)</Label>
            <div className="flex gap-2">
              {(['AFM', 'MMF'] as const).map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant={mediaType === opt ? 'default' : 'outline'}
                  onClick={() => setMediaType(opt)}
                  data-testid={`media-type-${opt}`}
                  className="flex-1"
                >
                  <span
                    aria-hidden
                    className={`mr-1.5 h-2 w-2 rounded-full border ${mediaType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
                  />
                  {opt}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              AFM = Active Filter Media · MMF = Multi-Media Filter
            </p>
          </div>

          {/* Pre-filter housing type */}
          <div>
            <Label className="text-xs mb-1.5 block">Pre-filter Housing Type (applied to all trains)</Label>
            <div className="flex gap-2">
              {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant={filterType === opt ? 'default' : 'outline'}
                  onClick={() => setFilterType(opt)}
                  data-testid={`filter-type-${opt.replace(' ', '-')}`}
                  className="flex-1"
                >
                  <span
                    aria-hidden
                    className={`mr-1.5 h-2 w-2 rounded-full border ${filterType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
                  />
                  {opt}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} data-testid="save-component-types-btn">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save &amp; Apply to All Trains
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Edit Train Dialog ───────────────────────────────────────────────────────

function EditTrainDialog({
  train,
  plant,
  onClose,
}: {
  train: any;
  plant: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isManager } = useAuth();

  // Plant-wide type defaults
  const plantMediaType: 'AFM' | 'MMF' = (plant as any).filter_media_type ?? 'AFM';
  const plantFilterType: 'Cartridge Filter' | 'Bag Filter' = (plant as any).filter_housing_type ?? 'Cartridge Filter';

  const [form, setForm] = useState({
    name: train.name ?? '',
    num_afm: String(train.num_afm ?? 0),
    num_booster_pumps: String(train.num_booster_pumps ?? 0),
    num_hp_pumps: String(train.num_hp_pumps ?? 0),
    num_cartridge_filters: String(train.num_cartridge_filters ?? 0),
    num_controllers: String(train.num_controllers ?? 0),
    num_filter_housings: String(train.num_filter_housings ?? 0),
    // Per-train overrides (fallback to plant-wide)
    filter_media_type: (train as any).filter_media_type ?? plantMediaType,
    filter_housing_type: (train as any).filter_housing_type ?? plantFilterType,
  });
  const [saving, setSaving] = useState(false);

  const num = (v: string) => (v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0));

  const save = async () => {
    setSaving(true);
    const payload: any = {
      name: form.name.trim() || null,
      num_afm: num(form.num_afm),
      num_booster_pumps: num(form.num_booster_pumps),
      num_hp_pumps: num(form.num_hp_pumps),
      num_cartridge_filters: num(form.num_cartridge_filters),
      num_controllers: num(form.num_controllers),
      num_filter_housings: num(form.num_filter_housings),
      filter_media_type: form.filter_media_type,
      filter_housing_type: form.filter_housing_type,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('ro_trains').update(payload).eq('id', train.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Train ${train.train_number} updated`);
    qc.invalidateQueries({ queryKey: ['ro-trains', train.plant_id] });
    onClose();
  };

  const mediaType = form.filter_media_type as 'AFM' | 'MMF';
  const filterHousingType = form.filter_housing_type as 'Cartridge Filter' | 'Bag Filter';
  const usingPlantMedia = mediaType === plantMediaType;
  const usingPlantFilter = filterHousingType === plantFilterType;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Train {train.train_number}{train.name ? ` · ${train.name}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Train name */}
          <div>
            <Label className="text-xs">Train label / name (optional)</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. North Wing"
              disabled={!isManager}
              data-testid="train-name-input"
            />
          </div>

          {/* ── Component counts ── */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Component Counts</div>

            {/* Media filters row */}
            <div>
              <Label className="text-xs">
                {mediaType} units{' '}
                <span className="text-muted-foreground font-normal">(media filter)</span>
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_afm: String(Math.max(0, num(form.num_afm) - 1)) })}
                  data-testid="dec-afm"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_afm}
                  onChange={(e) => setForm({ ...form, num_afm: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-afm-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_afm: String(num(form.num_afm) + 1) })}
                  data-testid="inc-afm"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Pre-filter housing — label & visibility driven by plant-wide filter type */}
            <div>
              <Label className="text-xs">
                {/* Bag Filter → "Filter Housing" (single merged field)
                    Cartridge Filter → "Cartridge Housing" (separate field below) */}
                {filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'}{' '}
                <span className="text-muted-foreground font-normal">(pre-filter)</span>
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_cartridge_filters: String(Math.max(0, num(form.num_cartridge_filters) - 1)) })}
                  data-testid="dec-cf"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_cartridge_filters}
                  onChange={(e) => setForm({ ...form, num_cartridge_filters: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-cf-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_cartridge_filters: String(num(form.num_cartridge_filters) + 1) })}
                  data-testid="inc-cf"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Booster pumps */}
            <div>
              <Label className="text-xs">Booster Pumps</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_booster_pumps: String(Math.max(0, num(form.num_booster_pumps) - 1)) })}
                  data-testid="dec-bp"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_booster_pumps}
                  onChange={(e) => setForm({ ...form, num_booster_pumps: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-bp-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_booster_pumps: String(num(form.num_booster_pumps) + 1) })}
                  data-testid="inc-bp"
                >
                  +
                </Button>
              </div>
            </div>

            {/* HP pumps */}
            <div>
              <Label className="text-xs">High-Pressure Pumps (HPP)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_hp_pumps: String(Math.max(0, num(form.num_hp_pumps) - 1)) })}
                  data-testid="dec-hpp"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_hp_pumps}
                  onChange={(e) => setForm({ ...form, num_hp_pumps: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-hpp-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_hp_pumps: String(num(form.num_hp_pumps) + 1) })}
                  data-testid="inc-hpp"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Controllers */}
            <div>
              <Label className="text-xs">Controllers</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_controllers: String(Math.max(0, num(form.num_controllers) - 1)) })}
                  data-testid="dec-ctrl"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_controllers}
                  onChange={(e) => setForm({ ...form, num_controllers: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-ctrl-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_controllers: String(num(form.num_controllers) + 1) })}
                  data-testid="inc-ctrl"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Filter Housings — hidden for Bag Filter plants (merged into Cartridge Housing above) */}
            {filterHousingType !== 'Bag Filter' && (
            <div>
              <Label className="text-xs">Filter Housings</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_filter_housings: String(Math.max(0, num(form.num_filter_housings) - 1)) })}
                  data-testid="dec-fh"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_filter_housings}
                  onChange={(e) => setForm({ ...form, num_filter_housings: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-fh-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_filter_housings: String(num(form.num_filter_housings) + 1) })}
                  data-testid="inc-fh"
                >
                  +
                </Button>
              </div>
            </div>
            )}
          </div>

          {/* ── Per-train type overrides ── */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Component Types{' '}
              <span className="normal-case font-normal text-muted-foreground">(overrides plant-wide setting for this train)</span>
            </div>

            {/* Media filter type */}
            <div>
              <Label className="text-xs mb-1.5 block">
                Media Filter Type
                {usingPlantMedia && (
                  <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                    ✓ Matches plant default
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                {(['AFM', 'MMF'] as const).map((opt) => (
                  <Button
                    key={opt}
                    size="sm"
                    variant={mediaType === opt ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, filter_media_type: opt })}
                    data-testid={`train-media-${opt}`}
                    className="flex-1"
                  >
                    <span
                      aria-hidden
                      className={`mr-1.5 h-2 w-2 rounded-full border ${mediaType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
                    />
                    {opt}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">AFM = Active Filter Media · MMF = Multi-Media Filter</p>
            </div>

            {/* Pre-filter housing type */}
            <div>
              <Label className="text-xs mb-1.5 block">
                Pre-filter Housing Type
                {usingPlantFilter && (
                  <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                    ✓ Matches plant default
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => (
                  <Button
                    key={opt}
                    size="sm"
                    variant={filterHousingType === opt ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, filter_housing_type: opt })}
                    data-testid={`train-filter-${opt.replace(' ', '-')}`}
                    className="flex-1"
                  >
                    <span
                      aria-hidden
                      className={`mr-1.5 h-2 w-2 rounded-full border ${filterHousingType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
                    />
                    {opt}
                  </Button>
                ))}
              </div>
            </div>

            {(!usingPlantMedia || !usingPlantFilter) && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                ⚠ This train differs from the plant default. It will display its own type labels.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {isManager ? 'Cancel' : 'Close'}
          </Button>
          {isManager && (
            <Button onClick={save} disabled={saving} data-testid="save-train-btn">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save Train
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Trains List ─────────────────────────────────────────────────────────────

function TrainsList({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const { data: plants } = usePlants();
  const plant = plants?.find((p) => p.id === plantId);

  const qc = useQueryClient();
  const { isManager, isAdmin, user } = useAuth();
  const { data: trains } = useQuery({
    queryKey: ['ro-trains', plantId],
    queryFn: async () =>
      (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? [],
  });

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
    if (error) { toast.error(`Failed to add train: ${error.message}`); return; }
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
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'ro_train', entity_id: trainDeleteTarget.id, entity_label: `Train ${trainDeleteTarget.train_number}`, action: 'hard', reason: trainDeleteReason.trim(), performed_by: user?.id ?? null, forced: false }] as any);
    } catch {}
    const { error } = await supabase.from('ro_trains').delete().eq('id', trainDeleteTarget.id);
    setTrainDeleteBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Train deleted');
    setTrainDeleteTarget(null);
    setTrainDeleteReason('');
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
  };

  // Resolve the effective media/filter type for a given train:
  // Train-level override wins; falls back to plant default; then hardcoded default.
  const toggleTrainStatus = async (t: any) => {
    if (!isManager) return;
    // Cycle: Running → Offline → Maintenance → Running
    const cycle: Record<string, string> = { Running: 'Offline', Offline: 'Maintenance', Maintenance: 'Running' };
    const newStatus = cycle[t.status] ?? 'Running';
    const { error } = await supabase.from('ro_trains').update({ status: newStatus }).eq('id', t.id);
    if (error) { toast.error(error.message); return; }
    await logStatusChange({
      user_id: user?.id ?? null,
      plant_id: t.plant_id,
      entity_type: 'RO Train',
      entity_id: t.id,
      entity_label: `Train ${t.train_number}${t.name ? ' · ' + t.name : ''}`,
      from_status: t.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ['ro-trains', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Train ${t.train_number} → ${newStatus}`);
  };

  const effectiveMediaType = (t: any) =>
    (t as any).filter_media_type ?? (plant as any)?.filter_media_type ?? 'AFM';
  const effectiveFilterType = (t: any) =>
    (t as any).filter_housing_type ?? (plant as any)?.filter_housing_type ?? 'Cartridge Filter';

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">
        RO Trains{' '}
        <span className="font-normal text-muted-foreground">
          ({trains ? `${trains.filter((t: any) => t.status === 'Running').length}/${trains.length}` : '0/0'})
        </span>
        <span className="ml-1 text-[10px] font-normal text-muted-foreground/60">active/total</span>
      </h3>
        <div className="flex items-center gap-2">
          {isManager && (
            <Button size="sm" variant="outline" onClick={() => setShowAddTrain(true)}>
              <Plus className="h-3 w-3 mr-1" />Add Train
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowTrainCsv(true)}>
              <Upload className="h-3 w-3 mr-1" />Import CSV
            </Button>
          )}
        </div>
      </div>

      {trains?.map((t: any) => {
        const mt = effectiveMediaType(t);
        const ft = effectiveFilterType(t);
        return (
          <Card key={t.id} className="p-3" data-testid={`train-card-${t.id}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm">
                  Train {t.train_number}{t.name ? ` · ${t.name}` : ''}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>{mt} × {t.num_afm ?? 0}</span>
                  <span>BP × {t.num_booster_pumps ?? 0}</span>
                  <span>HPP × {t.num_hp_pumps ?? 0}</span>
                  {/* Pre-filter housing — label uses effective filter type */}
                  <span>{ft === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Filter Housing'} × {t.num_cartridge_filters ?? 0}</span>
                  {(t.num_controllers ?? 0) > 0 && <span>Controllers × {t.num_controllers}</span>}
                  {/* Separate Filter Housings — only shown for Cartridge Filter plants */}
                  {ft !== 'Bag Filter' && (t.num_filter_housings ?? 0) > 0 && <span>Filter Housings × {t.num_filter_housings}</span>}
                </div>
                {/* Type badges */}
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                    {mt}
                  </span>
                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    {ft}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleTrainStatus(t)}
                  title={isManager ? `Click to cycle status (currently ${t.status})` : t.status}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md shrink-0 border transition-colors ${
                    t.status === 'Running'
                      ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
                      : t.status === 'Maintenance'
                        ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 hover:bg-amber-100'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                  } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    t.status === 'Running' ? 'bg-emerald-500'
                    : t.status === 'Maintenance' ? 'bg-amber-500'
                    : 'bg-muted-foreground'
                  }`} />
                  {t.status}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setEditTrain(t)}
                  data-testid={`edit-train-${t.id}`}
                >
                  <Wrench className="h-3 w-3 mr-1" />Edit Components
                </Button>
                {isManager && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Delete train"
                    onClick={() => { setTrainDeleteTarget(t); setTrainDeleteReason(''); }}
                    data-testid={`delete-train-${t.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <Button size="sm" variant="link" className="px-0 mt-1 h-auto text-xs" onClick={() => navigate('/ro-trains')}>
              Open log →
            </Button>
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
        plantFilterType={(plant as any)?.filter_housing_type ?? 'Cartridge Filter'}
        plantMediaType={(plant as any)?.filter_media_type ?? 'AFM'}
      />
      {showTrainCsv && (
        <TrainCsvImportDialog
          plantId={plantId}
          plantFilterType={(plant as any)?.filter_housing_type ?? 'Cartridge Filter'}
          plantMediaType={(plant as any)?.filter_media_type ?? 'AFM'}
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
    </div>
  );
}

// ─── Add Train Dialog ─────────────────────────────────────────────────────────

type AddTrainFormData = {
  train_number: number; name: string;
  num_afm: number; num_booster_pumps: number; num_cartridge_filters: number;
  num_controllers: number; num_filter_housings: number; num_hp_pumps: number;
};

function AddTrainDialog({ open, onOpenChange, defaultTrainNumber, onSubmit, loading,
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

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // Handle quoted fields containing commas
    const vals: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function downloadTemplate(filename: string, headers: string[]) {
  const blob = new Blob([headers.join(',') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function CsvPreviewTable({ rows, headers }: { rows: Record<string, string>[]; headers: string[] }) {
  if (!rows.length) return null;
  // Fixed column width — wide enough to read, narrow enough to scroll cleanly
  const colW = 120;
  return (
    <div className="rounded border overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto max-h-44" style={{ fontSize: 11 }}>
        <table className="table-fixed text-left w-max" style={{ minWidth: headers.length * colW }}>
          <thead className="bg-muted/80 sticky top-0 z-10">
            <tr>
              {headers.map(h => (
                <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap border-b"
                    style={{ width: colW, minWidth: colW }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                {headers.map(h => (
                  <td key={h} className="px-2 py-1 truncate border-b border-border/40"
                      style={{ width: colW, maxWidth: colW }} title={row[h] ?? ''}>
                    {row[h] ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <p className="text-xs text-muted-foreground px-2 py-1 bg-muted/30 border-t">
          …and {rows.length - 10} more rows
        </p>
      )}
    </div>
  );
}

// ─── Locator CSV Import ───────────────────────────────────────────────────────

const LOCATOR_CSV_HEADERS = [
  'name', 'address',
  'meter_brand', 'meter_size', 'meter_serial', 'meter_installed_date',
  'gps_lat', 'gps_lng',
];

function LocatorCsvImportDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCsv(ev.target?.result as string);
      setRows(parsed);
      setErrors([]);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    const errs: string[] = [];
    rows.forEach((r, i) => { if (!r.name?.trim()) errs.push(`Row ${i + 1}: name is required`); });
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const payload = rows.map(r => ({
      plant_id: plantId,
      name: r.name.trim(),
      address: r.address || null,
      location_desc: r.address || null,
      meter_brand: r.meter_brand || null,
      meter_size: r.meter_size ? r.meter_size : null,
      meter_serial: r.meter_serial || null,
      meter_installed_date: r.meter_installed_date || null,
      gps_lat: r.gps_lat ? +r.gps_lat : null,
      gps_lng: r.gps_lng ? +r.gps_lng : null,
    }));
    const { error } = await supabase.from('locators').insert(payload);
    setBusy(false);
    if (error) { setErrors([error.message]); return; }
    toast.success(`${rows.length} locator(s) imported`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Locators from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadTemplate('locators_template.csv', LOCATOR_CSV_HEADERS)}>
              <FileDown className="h-3 w-3 mr-1" />Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>
          <div className="rounded-md bg-muted/40 border p-2">
            <p className="text-xs font-medium mb-1">Expected columns:</p>
            <p className="text-xs text-muted-foreground font-mono">{LOCATOR_CSV_HEADERS.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1"><strong>name</strong> is required. All others optional.</p>
          </div>
          <div>
            <Label className="text-xs font-medium">Select CSV file</Label>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 group-hover:bg-teal-600 text-white text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-teal-700 font-medium">{rows.length} row(s) ready</span>
                  : <span className="text-xs text-muted-foreground">No file chosen</span>}
              </label>
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{rows.length} row(s) parsed</p>
              <CsvPreviewTable rows={rows} headers={LOCATOR_CSV_HEADERS} />
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

// ─── Well CSV Import ──────────────────────────────────────────────────────────

const WELL_CSV_HEADERS = [
  'name', 'diameter', 'drilling_depth_m',
  'meter_brand', 'meter_size', 'meter_serial', 'meter_installed_date',
  'has_power_meter',
  'electric_meter_brand', 'electric_meter_size', 'electric_meter_serial', 'electric_meter_installed_date',
];

function WellCsvImportDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
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
    rows.forEach((r, i) => { if (!r.name?.trim()) errs.push(`Row ${i + 1}: name is required`); });
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const payload = rows.map(r => {
      const hasPower = r.has_power_meter?.toLowerCase() === 'true';
      const row: any = {
        plant_id: plantId,
        name: r.name.trim(),
        diameter: r.diameter || null,
        drilling_depth_m: r.drilling_depth_m ? +r.drilling_depth_m : null,
        meter_brand: r.meter_brand || null,
        meter_size: r.meter_size ? +r.meter_size : null,
        meter_serial: r.meter_serial || null,
        meter_installed_date: r.meter_installed_date || null,
        has_power_meter: hasPower,
        status: 'Active',
      };
      if (hasPower) {
        row.electric_meter_brand = r.electric_meter_brand || null;
        row.electric_meter_size = r.electric_meter_size || null;
        row.electric_meter_serial = r.electric_meter_serial || null;
        row.electric_meter_installed_date = r.electric_meter_installed_date || null;
      }
      return row;
    });
    const { error } = await supabase.from('wells').insert(payload as any);
    setBusy(false);
    if (error) { setErrors([error.message]); return; }
    toast.success(`${rows.length} well(s) imported`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Wells from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadTemplate('wells_template.csv', WELL_CSV_HEADERS)}>
              <FileDown className="h-3 w-3 mr-1" />Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>
          <div className="rounded-md bg-muted/40 border p-2">
            <p className="text-xs font-medium mb-1">Expected columns:</p>
            <p className="text-xs text-muted-foreground font-mono">{WELL_CSV_HEADERS.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1"><strong>name</strong> required. <strong>has_power_meter</strong>: true/false. Electric meter fields only needed if has_power_meter is true. Numeric: drilling_depth_m, meter_size.</p>
          </div>
          <div>
            <Label className="text-xs font-medium">Select CSV file</Label>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 group-hover:bg-teal-600 text-white text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-teal-700 font-medium">{rows.length} row(s) ready</span>
                  : <span className="text-xs text-muted-foreground">No file chosen</span>}
              </label>
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{rows.length} row(s) parsed</p>
              <CsvPreviewTable rows={rows} headers={WELL_CSV_HEADERS} />
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

// ─── Train CSV Import ─────────────────────────────────────────────────────────

// Train CSV helpers — dynamic column names that reflect the plant-wide component type.
// The housing field uses a single descriptive column name (no separate filter_housings column).
function getTrainCsvHeaders(
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
  ];
}

function TrainCsvImportDialog({ plantId, onClose,
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
          </div>
          <div>
            <Label className="text-xs font-medium">Select CSV file</Label>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 group-hover:bg-teal-600 text-white text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-teal-700 font-medium">{rows.length} row(s) ready</span>
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
