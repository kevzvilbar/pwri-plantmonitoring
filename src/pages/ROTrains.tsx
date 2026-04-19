import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { StatusPill } from '@/components/StatusPill';
import { calc, fmtNum, ALERTS } from '@/lib/calculations';
import { findExistingReading } from '@/lib/duplicateCheck';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function ROTrains() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">RO Trains</h1>
      <Tabs defaultValue="overview">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
          <TabsTrigger value="afm">AFM</TabsTrigger>
          <TabsTrigger value="cip">CIP</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-3"><Overview /></TabsContent>
        <TabsContent value="log" className="mt-3"><TrainLog /></TabsContent>
        <TabsContent value="afm" className="mt-3"><AFMLog /></TabsContent>
        <TabsContent value="cip" className="mt-3"><CIPLog /></TabsContent>
      </Tabs>
    </div>
  );
}

function PlantPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>{plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Overview() {
  const [plantId, setPlantId] = useState('');
  const { data: trains } = useQuery({
    queryKey: ['ro-overview', plantId],
    queryFn: async () => plantId ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? [] : [],
    enabled: !!plantId,
  });

  return (
    <div className="space-y-3">
      <div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
      <div className="space-y-2">
        {trains?.map((t: any) => <TrainCard key={t.id} train={t} />)}
        {plantId && !trains?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No trains</Card>}
      </div>
    </div>
  );
}

function TrainCard({ train }: { train: any }) {
  const { data: last } = useQuery({
    queryKey: ['ro-last', train.id],
    queryFn: async () => (await supabase.from('ro_train_readings').select('*').eq('train_id', train.id).order('reading_datetime', { ascending: false }).limit(1)).data?.[0],
  });
  const tone = train.status === 'Running' ? 'accent' : train.status === 'Maintenance' ? 'warn' : 'muted';
  return (
    <Card className="p-3">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-medium text-sm">Train {train.train_number}</div>
          <div className="text-xs text-muted-foreground">Recovery: <span className="font-mono-num">{last?.recovery_pct ?? '—'}%</span> · Perm TDS: <span className="font-mono-num">{last?.permeate_tds ?? '—'}</span></div>
        </div>
        <StatusPill tone={tone}>{train.status}</StatusPill>
      </div>
    </Card>
  );
}

function TrainLog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [v, setV] = useState({
    feed_pressure_psi: '', reject_pressure_psi: '',
    feed_flow: '', permeate_flow: '',
    feed_tds: '', permeate_tds: '', reject_tds: '',
    feed_ph: '', permeate_ph: '', reject_ph: '',
    turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
  });

  const { data: trains } = useQuery({
    queryKey: ['ro-trains-pick', plantId],
    queryFn: async () => plantId ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? [] : [],
    enabled: !!plantId,
  });

  const num = (s: string) => s ? +s : NaN;
  const dp = calc.pressureDiff(num(v.feed_pressure_psi), num(v.reject_pressure_psi));
  const recovery = calc.recovery(num(v.permeate_flow), num(v.feed_flow));
  const rejection = calc.rejection(num(v.permeate_tds), num(v.reject_tds));
  const saltPassage = calc.saltPassage(num(v.permeate_tds), num(v.reject_tds));
  const rejectFlow = calc.rejectFlow(num(v.feed_flow), num(v.permeate_flow));

  const phWarn = num(v.permeate_ph) && (num(v.permeate_ph) < 6.5 || num(v.permeate_ph) > 8.5);
  const recWarn = recovery != null && (recovery < 65 || recovery > 75);
  const dpAlert = dp != null && dp >= ALERTS.dp_max;

  const submit = async () => {
    if (!trainId) { toast.error('Select train'); return; }
    const dup = await findExistingReading({
      table: 'ro_train_readings', entityCol: 'train_id', entityId: trainId,
      datetime: new Date(dt), windowKind: 'hour',
    });
    if (dup) {
      toast.error('A reading already exists for this train within this hour. Edit it from the Overview tab to avoid duplicates.');
      return;
    }
    const payload: any = {
      train_id: trainId, plant_id: plantId, reading_datetime: new Date(dt).toISOString(),
      ...Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ? +val : null])),
      reject_flow: rejectFlow, dp_psi: dp, recovery_pct: recovery, rejection_pct: rejection, salt_passage_pct: saltPassage,
      recorded_by: user?.id,
    };
    const { error } = await supabase.from('ro_train_readings').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success('Train log saved');
    setV({ feed_pressure_psi: '', reject_pressure_psi: '', feed_flow: '', permeate_flow: '', feed_tds: '', permeate_tds: '', reject_tds: '', feed_ph: '', permeate_ph: '', reject_ph: '', turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '' });
    qc.invalidateQueries();
  };

  const f = (k: keyof typeof v) => ({ value: v[k], onChange: (e: any) => setV({ ...v, [k]: e.target.value }) });

  return (
    <Card className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Plant</Label><PlantPicker value={plantId} onChange={(p) => { setPlantId(p); setTrainId(''); }} /></div>
        <div><Label>Train</Label>
          <Select value={trainId} onValueChange={setTrainId}>
            <SelectTrigger><SelectValue placeholder="Train" /></SelectTrigger>
            <SelectContent>{trains?.map((t: any) => <SelectItem key={t.id} value={t.id}>Train {t.train_number}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Date & time</Label><Input type="datetime-local" {...{value: dt, onChange: e => setDt(e.target.value)}} /></div>

      <section>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">RO Vessel</h4>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Suction psi</Label><Input type="number" step="any" {...f('suction_pressure_psi')} /></div>
          <div><Label className="text-xs">Feed psi</Label><Input type="number" step="any" {...f('feed_pressure_psi')} /></div>
          <div><Label className="text-xs">Reject psi</Label><Input type="number" step="any" {...f('reject_pressure_psi')} /></div>
          <div><Label className="text-xs">DP psi (auto)</Label><Input value={dp ?? ''} readOnly className={dpAlert ? 'border-danger text-danger font-semibold' : ''} /></div>
          <div><Label className="text-xs">Feed flow</Label><Input type="number" step="any" {...f('feed_flow')} /></div>
          <div><Label className="text-xs">Permeate flow</Label><Input type="number" step="any" {...f('permeate_flow')} /></div>
          <div><Label className="text-xs">Reject flow (auto)</Label><Input value={rejectFlow ?? ''} readOnly /></div>
          <div><Label className="text-xs">Recovery % (auto)</Label><Input value={recovery ?? ''} readOnly className={recWarn ? 'border-warn text-warn-foreground' : ''} /></div>
          <div><Label className="text-xs">Feed TDS</Label><Input type="number" step="any" {...f('feed_tds')} /></div>
          <div><Label className="text-xs">Perm TDS</Label><Input type="number" step="any" {...f('permeate_tds')} /></div>
          <div><Label className="text-xs">Reject TDS</Label><Input type="number" step="any" {...f('reject_tds')} /></div>
          <div><Label className="text-xs">Rejection % (auto)</Label><Input value={rejection ?? ''} readOnly /></div>
          <div><Label className="text-xs">Salt pass % (auto)</Label><Input value={saltPassage ?? ''} readOnly /></div>
          <div><Label className="text-xs">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} /></div>
          <div><Label className="text-xs">Perm pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} /></div>
          <div><Label className="text-xs">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} /></div>
          <div><Label className="text-xs">Turbidity NTU</Label><Input type="number" step="any" {...f('turbidity_ntu')} /></div>
          <div><Label className="text-xs">Temp °C</Label><Input type="number" step="any" {...f('temperature_c')} /></div>
        </div>
      </section>

      <Button onClick={submit} className="w-full">Save train log</Button>
    </Card>
  );
}

function AFMLog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');
  const [unit, setUnit] = useState('1');
  const [mode, setMode] = useState<'Running' | 'Backwash'>('Running');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [v, setV] = useState({ inlet: '', outlet: '', start: '', end: '', initial: '', final: '' });

  const { data: trains } = useQuery({
    queryKey: ['ro-trains-afm', plantId],
    queryFn: async () => plantId ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId)).data ?? [] : [],
    enabled: !!plantId,
  });
  const train = trains?.find((t: any) => t.id === trainId);
  const dp = mode === 'Running' ? calc.pressureDiff(+v.inlet, +v.outlet) : null;
  const vol = mode === 'Backwash' && v.initial && v.final ? +v.final - +v.initial : null;

  const submit = async () => {
    if (!trainId) return;
    const { error } = await supabase.from('afm_readings').insert({
      train_id: trainId, plant_id: plantId, afm_unit_number: +unit, mode,
      reading_datetime: new Date(dt).toISOString(),
      inlet_pressure_psi: mode === 'Running' && v.inlet ? +v.inlet : null,
      outlet_pressure_psi: mode === 'Running' && v.outlet ? +v.outlet : null,
      dp_psi: dp,
      backwash_start: mode === 'Backwash' && v.start ? new Date(v.start).toISOString() : null,
      backwash_end: mode === 'Backwash' && v.end ? new Date(v.end).toISOString() : null,
      meter_initial: v.initial ? +v.initial : null, meter_final: v.final ? +v.final : null,
      backwash_volume: vol, recorded_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('AFM saved');
    setV({ inlet: '', outlet: '', start: '', end: '', initial: '', final: '' });
    qc.invalidateQueries();
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Plant</Label><PlantPicker value={plantId} onChange={(p) => { setPlantId(p); setTrainId(''); }} /></div>
        <div><Label>Train</Label>
          <Select value={trainId} onValueChange={setTrainId}>
            <SelectTrigger><SelectValue placeholder="Train" /></SelectTrigger>
            <SelectContent>{trains?.map((t: any) => <SelectItem key={t.id} value={t.id}>Train {t.train_number}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>AFM unit #</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: train?.num_afm || 1 }, (_, i) => <SelectItem key={i+1} value={String(i+1)}>Unit {i+1}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Mode</Label>
          <Select value={mode} onValueChange={(v: any) => setMode(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Running">Running</SelectItem><SelectItem value="Backwash">Backwash</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Date & time</Label><Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} /></div>
      {mode === 'Running' ? (
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">Inlet psi</Label><Input type="number" step="any" value={v.inlet} onChange={e => setV({ ...v, inlet: e.target.value })} /></div>
          <div><Label className="text-xs">Outlet psi</Label><Input type="number" step="any" value={v.outlet} onChange={e => setV({ ...v, outlet: e.target.value })} /></div>
          <div><Label className="text-xs">DP (auto)</Label><Input value={dp ?? ''} readOnly className={dp != null && dp >= 40 ? 'border-danger text-danger' : ''} /></div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Start</Label><Input type="datetime-local" value={v.start} onChange={e => setV({ ...v, start: e.target.value })} /></div>
          <div><Label className="text-xs">End</Label><Input type="datetime-local" value={v.end} onChange={e => setV({ ...v, end: e.target.value })} /></div>
          <div><Label className="text-xs">Initial</Label><Input type="number" step="any" value={v.initial} onChange={e => setV({ ...v, initial: e.target.value })} /></div>
          <div><Label className="text-xs">Final</Label><Input type="number" step="any" value={v.final} onChange={e => setV({ ...v, final: e.target.value })} /></div>
          <div className="col-span-2 text-xs">Volume: <span className="font-mono-num">{vol ?? '—'}</span></div>
        </div>
      )}
      <Button onClick={submit} className="w-full">Save AFM</Button>
    </Card>
  );
}

function CIPLog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');
  const [v, setV] = useState({ start: '', end: '', sls: '', hcl: '', caustic: '', remarks: '' });

  const { data: trains } = useQuery({
    queryKey: ['cip-trains', plantId],
    queryFn: async () => plantId ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId)).data ?? [] : [],
    enabled: !!plantId,
  });
  const { data: history } = useQuery({
    queryKey: ['cip-history', plantId],
    queryFn: async () => plantId ? (await supabase.from('cip_logs').select('*,ro_trains(train_number)').eq('plant_id', plantId).order('start_datetime', { ascending: false }).limit(10)).data ?? [] : [],
    enabled: !!plantId,
  });

  const submit = async () => {
    if (!trainId) return;
    const { error } = await supabase.from('cip_logs').insert({
      train_id: trainId, plant_id: plantId,
      start_datetime: v.start ? new Date(v.start).toISOString() : null,
      end_datetime: v.end ? new Date(v.end).toISOString() : null,
      sls_g: v.sls ? +v.sls : null, hcl_l: v.hcl ? +v.hcl : null, caustic_soda_kg: v.caustic ? +v.caustic : null,
      conducted_by: user?.id, remarks: v.remarks || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('CIP logged'); qc.invalidateQueries();
    setV({ start: '', end: '', sls: '', hcl: '', caustic: '', remarks: '' });
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Plant</Label><PlantPicker value={plantId} onChange={(p) => { setPlantId(p); setTrainId(''); }} /></div>
          <div><Label>Train</Label>
            <Select value={trainId} onValueChange={setTrainId}>
              <SelectTrigger><SelectValue placeholder="Train" /></SelectTrigger>
              <SelectContent>{trains?.map((t: any) => <SelectItem key={t.id} value={t.id}>Train {t.train_number}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Start</Label><Input type="datetime-local" value={v.start} onChange={e => setV({ ...v, start: e.target.value })} /></div>
          <div><Label>End</Label><Input type="datetime-local" value={v.end} onChange={e => setV({ ...v, end: e.target.value })} /></div>
          <div><Label>SLS (g)</Label><Input type="number" step="any" value={v.sls} onChange={e => setV({ ...v, sls: e.target.value })} /></div>
          <div><Label>HCl (L)</Label><Input type="number" step="any" value={v.hcl} onChange={e => setV({ ...v, hcl: e.target.value })} /></div>
          <div className="col-span-2"><Label>Caustic soda (kg)</Label><Input type="number" step="any" value={v.caustic} onChange={e => setV({ ...v, caustic: e.target.value })} /></div>
          <div className="col-span-2"><Label>Remarks</Label><Input value={v.remarks} onChange={e => setV({ ...v, remarks: e.target.value })} /></div>
        </div>
        <Button onClick={submit} className="w-full">Save CIP</Button>
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Recent CIP</h4>
        {history?.map((c: any) => (
          <div key={c.id} className="text-xs py-1.5 border-t">
            <div>Train {c.ro_trains?.train_number} · {c.start_datetime && format(new Date(c.start_datetime), 'MMM d, HH:mm')}</div>
            <div className="text-muted-foreground">SLS {c.sls_g ?? 0}g · HCl {c.hcl_l ?? 0}L · NaOH {c.caustic_soda_kg ?? 0}kg</div>
          </div>
        ))}
        {!history?.length && <p className="text-xs text-muted-foreground">No CIP records</p>}
      </Card>
    </div>
  );
}
