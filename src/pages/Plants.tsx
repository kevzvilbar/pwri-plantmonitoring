"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StatusPill } from '@/components/StatusPill';
import { ChevronLeft, Plus, MapPin, Gauge, Wrench } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function Plants({ plantId }: { plantId?: string } = {}) {
  const id = plantId;
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const list = selectedPlantId ? plants?.filter(p => p.id === selectedPlantId) : plants;
  const router = useRouter();
  const navigate = (to: string) => router.push(to);

  if (id) return <PlantDetail plantId={id} />;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Plants</h1>
      </div>
      <div className="space-y-3">
        {list?.map((p) => (
          <Card key={p.id} onClick={() => navigate(`/plants/${p.id}`)} className="p-4 cursor-pointer hover:shadow-elev transition-all">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-xs text-muted-foreground">{p.address}</p>
              </div>
              <StatusPill tone={p.status === 'Active' ? 'accent' : 'muted'}>{p.status}</StatusPill>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
              <div><div className="text-muted-foreground">Capacity</div><div className="font-mono-num text-sm">{fmtNum(p.design_capacity_m3 ?? 0)} m³</div></div>
              <div><div className="text-muted-foreground">RO trains</div><div className="font-mono-num text-sm">{p.num_ro_trains}</div></div>
              <div><div className="text-muted-foreground">Geofence</div><div className="font-mono-num text-sm">{p.geofence_radius_m}m</div></div>
            </div>
          </Card>
        ))}
        {!list?.length && <Card className="p-6 text-center text-muted-foreground text-sm">No plants visible</Card>}
      </div>
    </div>
  );
}

function PlantDetail({ plantId }: { plantId: string }) {
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  const { data: plants } = usePlants();
  const plant = plants?.find(p => p.id === plantId);

  const [tab, setTab] = useState<'locators' | 'wells' | 'trains'>('locators');

  if (!plant) return <div>Plant not found.</div>;

  return (
    <div className="space-y-3 animate-fade-in">
      <button onClick={() => navigate('/plants')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All plants
      </button>
      <Card className="p-4 bg-gradient-stat text-topbar-foreground">
        <h1 className="text-lg font-semibold">{plant.name}</h1>
        <p className="text-xs text-topbar-muted flex items-center gap-1"><MapPin className="h-3 w-3" /> {plant.address}</p>
        <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
          <div><div className="opacity-70">Capacity</div><div className="font-mono-num text-base">{fmtNum(plant.design_capacity_m3 ?? 0)} m³</div></div>
          <div><div className="opacity-70">RO trains</div><div className="font-mono-num text-base">{plant.num_ro_trains}</div></div>
          <div><div className="opacity-70">Status</div><div className="text-sm font-semibold">{plant.status}</div></div>
        </div>
      </Card>

      <BackwashModeCard plant={plant} />

      <div className="grid grid-cols-3 gap-2">
        {(['locators', 'wells', 'trains'] as const).map((t) => (
          <Button key={t} variant={tab === t ? 'default' : 'outline'} size="sm" onClick={() => setTab(t)} className="capitalize">{t}</Button>
        ))}
      </div>

      {tab === 'locators' && <LocatorsList plantId={plantId} />}
      {tab === 'wells' && <WellsList plantId={plantId} />}
      {tab === 'trains' && <TrainsList plantId={plantId} />}
    </div>
  );
}

function BackwashModeCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [mode, setMode] = useState<'independent' | 'synchronized'>(plant.backwash_mode ?? 'independent');
  const save = async (next: 'independent' | 'synchronized') => {
    setMode(next);
    const { error } = await supabase.from('plants').update({ backwash_mode: next }).eq('id', plant.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Backwash mode set to ${next}`);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">AFM/MMF backwash mode</div>
          <div className="text-[11px] text-muted-foreground">
            {mode === 'synchronized' ? 'All units on a train backwash together (e.g. Guizo).' : 'Each unit backwashes independently.'}
          </div>
        </div>
        <div className="flex gap-1">
          {(['independent', 'synchronized'] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'}
              disabled={!isManager} onClick={() => save(m)} className="capitalize">
              {m}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function LocatorsList({ plantId }: { plantId: string }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const { data: locators } = useQuery({
    queryKey: ['locators', plantId],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('*').eq('plant_id', plantId).order('name');
      return data ?? [];
    },
  });

  if (detail) return <LocatorDetail locatorId={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Locators ({locators?.length ?? 0})</h3>
        {isManager && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3 w-3 mr-1" />Add</Button>}
      </div>
      {locators?.map((l: any) => (
        <Card key={l.id} className="p-3 cursor-pointer hover:shadow-elev" onClick={() => setDetail(l.id)}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-sm">{l.name}</div>
              <div className="text-xs text-muted-foreground">{l.meter_brand} {l.meter_size} · SN {l.meter_serial ?? '—'}</div>
            </div>
            <StatusPill tone={l.status === 'Active' ? 'accent' : 'muted'}>{l.status}</StatusPill>
          </div>
        </Card>
      ))}
      {adding && <AddLocatorDialog plantId={plantId} onClose={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['locators', plantId] }); }} />}
    </div>
  );
}

function AddLocatorDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', location_desc: '', address: '', meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '', gps_lat: '', gps_lng: '' });
  const submit = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    const { error } = await supabase.from('locators').insert({
      plant_id: plantId, name: form.name, location_desc: form.location_desc || null, address: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Locator added'); onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add locator</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Location</Label><Input value={form.location_desc} onChange={e => setForm({ ...form, location_desc: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div><Label>Size</Label><Input value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} /></div>
            <div><Label>Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>GPS lat</Label><Input value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} /></div>
            <div><Label>GPS lng</Label><Input value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} /></div>
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
  const { data: wells } = useQuery({
    queryKey: ['wells', plantId],
    queryFn: async () => (await supabase.from('wells').select('*').eq('plant_id', plantId).order('name')).data ?? [],
  });
  const [detail, setDetail] = useState<string | null>(null);
  if (detail) return <WellDetail wellId={detail} onBack={() => setDetail(null)} />;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Wells ({wells?.length ?? 0})</h3>
      {wells?.map((w: any) => (
        <Card key={w.id} className="p-3 cursor-pointer hover:shadow-elev" onClick={() => setDetail(w.id)}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-sm">{w.name}</div>
              <div className="text-xs text-muted-foreground">{w.diameter ?? '—'} · {w.drilling_depth_m ?? '—'} m</div>
            </div>
            <StatusPill tone={w.status === 'Active' ? 'accent' : 'muted'}>{w.status}</StatusPill>
          </div>
        </Card>
      ))}
      {!wells?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No wells yet</Card>}
    </div>
  );
}

function WellDetail({ wellId, onBack }: { wellId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [editHydraulicOpen, setEditHydraulicOpen] = useState(false);
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
        <div className="text-xs text-muted-foreground">{well.diameter ?? '—'}</div>
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
          <div>Drilling depth: <span className="font-mono-num">{well.drilling_depth_m ?? '—'} m</span></div>
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
                  <span className="font-medium">{p.date_gathered}</span> · SWL {p.static_water_level_m ?? '—'}m · PWL {p.pumping_water_level_m ?? '—'}m · HP {p.motor_hp ?? '—'}
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>
      <Card className="p-3">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-semibold">Active meter</h4>
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
    </div>
  );
}

function EditHydraulicDialog({ well, latest, onClose }: { well: any; latest: any; onClose: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    date_gathered: format(new Date(), 'yyyy-MM-dd'),
    drilling_depth_m: well.drilling_depth_m ?? '',
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
    });
    if (error) { toast.error(error.message); return; }
    // Persist drilling depth on the well master record (one canonical value)
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

function TrainsList({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const { data: trains } = useQuery({
    queryKey: ['ro-trains', plantId],
    queryFn: async () => (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? [],
  });
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">RO Trains ({trains?.length ?? 0})</h3>
      {trains?.map((t: any) => (
        <Card key={t.id} className="p-3">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-sm">Train {t.train_number} {t.name && `· ${t.name}`}</div>
              <div className="text-xs text-muted-foreground">AFM {t.num_afm} · BP {t.num_booster_pumps} · HPP {t.num_hp_pumps} · CF {t.num_cartridge_filters}</div>
            </div>
            <StatusPill tone={t.status === 'Running' ? 'accent' : t.status === 'Maintenance' ? 'warn' : 'muted'}>{t.status}</StatusPill>
          </div>
          <Button size="sm" variant="link" className="px-0 mt-1" onClick={() => navigate('/ro-trains')}>Open log →</Button>
        </Card>
      ))}
      {!trains?.length && <Card className="p-4 text-center text-xs text-muted-foreground">No trains yet</Card>}
    </div>
  );
}
