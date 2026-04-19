import { useState, useEffect, useMemo } from 'react';
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { findExistingReading, countReadingsToday } from '@/lib/duplicateCheck';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil } from 'lucide-react';

const MAX_READINGS_PER_DAY = 3;

export default function Operations() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Operations</h1>
      <Tabs defaultValue="locator">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="locator">Locator</TabsTrigger>
          <TabsTrigger value="well">Well</TabsTrigger>
          <TabsTrigger value="power">Power</TabsTrigger>
        </TabsList>
        <TabsContent value="locator" className="mt-3"><LocatorReadingForm /></TabsContent>
        <TabsContent value="well" className="mt-3"><WellReadingForm /></TabsContent>
        <TabsContent value="power" className="mt-3"><PowerForm /></TabsContent>
      </Tabs>
    </div>
  );
}

function PlantSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

function LocatorReadingForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [locatorId, setLocatorId] = useState('');
  const [reading, setReading] = useState('');
  const [remarks, setRemarks] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<null | string>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);

  const { data: locators } = useQuery({
    queryKey: ['op-locators', plantId],
    queryFn: async () => plantId ? (await supabase.from('locators').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? [] : [],
    enabled: !!plantId,
  });

  const { data: lastReading } = useQuery({
    queryKey: ['op-loc-last', locatorId],
    queryFn: async () => locatorId ? (await supabase.from('locator_readings').select('*').eq('locator_id', locatorId).order('reading_datetime', { ascending: false }).limit(30)).data ?? [] : [],
    enabled: !!locatorId,
  });

  const previous = lastReading?.[0]?.current_reading ?? null;
  const avg = useMemo(() => {
    if (!lastReading?.length) return null;
    const vols = lastReading.map((r: any) => r.daily_volume).filter((v: any) => v != null && v > 0);
    return vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : null;
  }, [lastReading]);
  const cur = +reading || 0;
  const dailyVol = previous != null ? cur - previous : null;

  const { data: todays } = useQuery({
    queryKey: ['op-loc-today', plantId],
    queryFn: async () => {
      const start = new Date(); start.setHours(0,0,0,0);
      return plantId ? (await supabase.from('locator_readings').select('*,locators(name)').eq('plant_id', plantId).gte('reading_datetime', start.toISOString()).order('reading_datetime', { ascending: false })).data ?? [] : [];
    },
    enabled: !!plantId,
  });

  const doSave = async (payload: any, idToUpdate?: string | null) => {
    let error;
    if (idToUpdate) {
      ({ error } = await supabase.from('locator_readings').update(payload).eq('id', idToUpdate));
    } else {
      ({ error } = await supabase.from('locator_readings').insert(payload));
    }
    if (error) { toast.error(error.message); return; }
    toast.success(idToUpdate ? 'Reading updated' : 'Reading saved');
    setReading(''); setRemarks(''); setEditingId(null);
    qc.invalidateQueries();
  };

  const handleSave = async () => {
    if (!locatorId || !reading) { toast.error('Select locator and enter reading'); return; }
    const locator = locators?.find((l: any) => l.id === locatorId);

    // Max readings per day check (only on insert)
    if (!editingId) {
      const cnt = await countReadingsToday({ table: 'locator_readings', entityCol: 'locator_id', entityId: locatorId, date: new Date() });
      if (cnt >= MAX_READINGS_PER_DAY) {
        toast.error(`Max ${MAX_READINGS_PER_DAY} readings/day reached for this locator. Edit an existing reading instead.`);
        return;
      }
    }

    let warning = null;
    if (previous != null && cur < previous) warning = 'Current reading below previous — verify before saving';
    else if (avg && dailyVol != null && dailyVol > avg * ALERTS.avg_multiplier_warn) warning = 'Volume unusually high — verify';

    let off = false;
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (locator?.gps_lat && locator?.gps_lng) {
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
      }
    } catch { /* ignore */ }

    const payload: any = {
      locator_id: locatorId, plant_id: plantId, current_reading: cur, previous_reading: previous,
      gps_lat, gps_lng, off_location_flag: off, recorded_by: user?.id, remarks: remarks || null,
    };
    if (warning) { setPendingPayload(payload); setConfirmOpen(warning); }
    else doSave(payload, editingId);
  };

  const startEdit = (r: any) => {
    setLocatorId(r.locator_id);
    setReading(String(r.current_reading));
    setRemarks(r.remarks ?? '');
    setEditingId(r.id);
    toast.info('Editing reading — save to update');
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div><Label>Plant</Label><PlantSelector value={plantId} onChange={(v) => { setPlantId(v); setLocatorId(''); setEditingId(null); }} /></div>
        <div><Label>Locator</Label>
          <Select value={locatorId} onValueChange={(v) => { setLocatorId(v); setEditingId(null); }}>
            <SelectTrigger><SelectValue placeholder={plantId ? "Select locator" : "Select plant first"} /></SelectTrigger>
            <SelectContent>{locators?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Current meter reading {editingId && <span className="text-xs text-highlight">(editing)</span>}</Label>
          <Input type="number" step="any" value={reading} onChange={e => setReading(e.target.value)} placeholder="Raw meter value" />
          {locatorId && (
            <div className="mt-2 text-xs space-y-0.5">
              <div className="text-muted-foreground">Previous: <span className="font-mono-num">{previous == null ? '—' : fmtNum(previous)}</span> · Avg vol: <span className="font-mono-num">{avg ? fmtNum(avg) : '—'}</span> m³</div>
              {dailyVol != null && <div>Daily volume: <span className="font-mono-num font-semibold">{fmtNum(dailyVol)} m³</span></div>}
              {previous != null && cur > 0 && cur < previous && <div className="text-warn-foreground bg-warn-soft p-1.5 rounded">⚠ Below previous</div>}
              {avg && dailyVol != null && dailyVol > avg * ALERTS.avg_multiplier_warn && <div className="text-warn-foreground bg-warn-soft p-1.5 rounded">⚠ Volume unusually high</div>}
            </div>
          )}
        </div>
        <div><Label>Remarks</Label><Input value={remarks} onChange={e => setRemarks(e.target.value)} /></div>
        <div className="flex gap-2">
          <Button onClick={handleSave} className="flex-1">{editingId ? 'Update reading' : 'Save reading'}</Button>
          {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setReading(''); setRemarks(''); }}>Cancel</Button>}
        </div>
      </Card>

      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Today's readings</h4>
        {todays?.length ? todays.map((r: any) => (
          <div key={r.id} className="flex justify-between items-center text-xs py-1.5 border-t">
            <span className="flex-1 truncate">{r.locators?.name}</span>
            <span className="font-mono-num mr-2">{fmtNum(r.daily_volume)} m³</span>
            {r.off_location_flag && <StatusPill tone="warn"><MapPin className="h-3 w-3" /> off</StatusPill>}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-1" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )) : <p className="text-xs text-muted-foreground">No readings today</p>}
      </Card>

      <AlertDialog open={!!confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm save</AlertDialogTitle><AlertDialogDescription>{confirmOpen}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { doSave(pendingPayload, editingId); setConfirmOpen(null); }}>Save anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WellReadingForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [wellId, setWellId] = useState('');
  const [reading, setReading] = useState('');
  const [powerReading, setPowerReading] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId ? (await supabase.from('wells').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? [] : [],
    enabled: !!plantId,
  });
  const { data: lastReading } = useQuery({
    queryKey: ['op-well-last', wellId],
    queryFn: async () => wellId ? (await supabase.from('well_readings').select('*').eq('well_id', wellId).order('reading_datetime', { ascending: false }).limit(1)).data ?? [] : [],
    enabled: !!wellId,
  });
  const { data: todays } = useQuery({
    queryKey: ['op-well-today', plantId],
    queryFn: async () => {
      const start = new Date(); start.setHours(0,0,0,0);
      return plantId ? (await supabase.from('well_readings').select('*,wells(name)').eq('plant_id', plantId).gte('reading_datetime', start.toISOString()).order('reading_datetime', { ascending: false })).data ?? [] : [];
    },
    enabled: !!plantId,
  });

  const well = wells?.find((w: any) => w.id === wellId);
  const previous = lastReading?.[0]?.current_reading ?? null;
  const cur = +reading || 0;
  const dailyVol = previous != null ? cur - previous : null;

  const handleSave = async () => {
    if (!wellId || !reading) { toast.error('Fill required fields'); return; }

    if (!editingId) {
      const cnt = await countReadingsToday({ table: 'well_readings', entityCol: 'well_id', entityId: wellId, date: new Date() });
      if (cnt >= MAX_READINGS_PER_DAY) {
        toast.error(`Max ${MAX_READINGS_PER_DAY} readings/day reached for this well. Edit an existing reading instead.`);
        return;
      }
    }

    if (previous != null && cur < previous) {
      if (!confirm('Reading below previous — save anyway?')) return;
    }
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
    } catch {}
    const payload: any = {
      well_id: wellId, plant_id: plantId, current_reading: cur, previous_reading: previous,
      power_meter_reading: powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false, recorded_by: user?.id,
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from('well_readings').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('well_readings').insert(payload));
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Well reading updated' : 'Well reading saved');
    setReading(''); setPowerReading(''); setEditingId(null);
    qc.invalidateQueries();
  };

  const startEdit = (r: any) => {
    setWellId(r.well_id);
    setReading(String(r.current_reading ?? ''));
    setPowerReading(r.power_meter_reading != null ? String(r.power_meter_reading) : '');
    setEditingId(r.id);
    toast.info('Editing reading');
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div><Label>Plant</Label><PlantSelector value={plantId} onChange={(v) => { setPlantId(v); setWellId(''); setEditingId(null); }} /></div>
        <div><Label>Well</Label>
          <Select value={wellId} onValueChange={(v) => { setWellId(v); setEditingId(null); }}>
            <SelectTrigger><SelectValue placeholder={plantId ? "Select well" : "Select plant first"} /></SelectTrigger>
            <SelectContent>{wells?.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Current meter reading {editingId && <span className="text-xs text-highlight">(editing)</span>}</Label>
          <Input type="number" step="any" value={reading} onChange={e => setReading(e.target.value)} placeholder="Raw meter value" />
          {wellId && (
            <div className="mt-1 text-xs text-muted-foreground">Previous: <span className="font-mono-num">{previous ?? '—'}</span> {dailyVol != null && <>· Vol: <span className="font-mono-num">{fmtNum(dailyVol)} m³</span></>}</div>
          )}
        </div>
        {well?.has_power_meter && (
          <div>
            <Label>Power meter reading</Label>
            <Input type="number" step="any" value={powerReading} onChange={e => setPowerReading(e.target.value)} placeholder="Raw kWh meter value" />
            <p className="text-xs text-muted-foreground mt-0.5">Daily kWh = current − previous</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSave} className="flex-1">{editingId ? 'Update reading' : 'Save reading'}</Button>
          {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setReading(''); setPowerReading(''); }}>Cancel</Button>}
        </div>
      </Card>

      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Today's readings</h4>
        {todays?.length ? todays.map((r: any) => (
          <div key={r.id} className="flex justify-between items-center text-xs py-1.5 border-t">
            <span className="flex-1 truncate">{r.wells?.name}</span>
            <span className="font-mono-num mr-2">{fmtNum(r.daily_volume)} m³</span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )) : <p className="text-xs text-muted-foreground">No readings today</p>}
      </Card>
    </div>
  );
}

function PowerForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [reading, setReading] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: history } = useQuery({
    queryKey: ['op-power', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_readings').select('*').eq('plant_id', plantId).order('reading_datetime', { ascending: false }).limit(7)).data ?? [] : [],
    enabled: !!plantId,
  });
  const previous = history?.find((r: any) => r.id !== editingId)?.meter_reading_kwh ?? null;
  const daily = previous != null && reading ? +reading - previous : null;

  const submit = async () => {
    if (!plantId || !reading) return;

    // Same-day duplicate check (only on insert)
    if (!editingId) {
      const dup = await findExistingReading({
        table: 'power_readings', entityCol: 'plant_id', entityId: plantId,
        datetime: new Date(dt), windowKind: 'day',
      });
      if (dup) {
        if (!confirm('A power reading already exists for this plant today. Edit it instead?')) return;
        setEditingId(dup);
      }
    }

    const payload: any = {
      plant_id: plantId, reading_datetime: new Date(dt).toISOString(),
      meter_reading_kwh: +reading, recorded_by: user?.id,
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from('power_readings').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('power_readings').insert(payload));
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Updated' : 'Power reading saved');
    setReading(''); setEditingId(null);
    qc.invalidateQueries();
  };

  const startEdit = (r: any) => {
    setReading(String(r.meter_reading_kwh));
    setDt(format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditingId(r.id);
    toast.info('Editing power reading');
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div><Label>Plant</Label><PlantSelector value={plantId} onChange={(v) => { setPlantId(v); setEditingId(null); }} /></div>
        <div><Label>Date & time</Label><Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} /></div>
        <div>
          <Label>Meter reading {editingId && <span className="text-xs text-highlight">(editing)</span>}</Label>
          <Input type="number" step="any" value={reading} onChange={e => setReading(e.target.value)} placeholder="Raw kWh meter value" />
          {previous != null && <div className="mt-1 text-xs text-muted-foreground">Previous: <span className="font-mono-num">{fmtNum(previous)}</span> {daily != null && <>· Daily: <span className="font-mono-num">{fmtNum(daily)} kWh</span></>}</div>}
        </div>
        <div className="flex gap-2">
          <Button onClick={submit} className="flex-1">{editingId ? 'Update' : 'Save'}</Button>
          {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setReading(''); }}>Cancel</Button>}
        </div>
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Last 7 readings</h4>
        {history?.length ? history.map((r: any) => (
          <div key={r.id} className="flex justify-between items-center text-xs py-1.5 border-t">
            <span className="flex-1">{format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm')}</span>
            <span className="font-mono-num mr-2">{fmtNum(r.daily_consumption_kwh ?? 0)} kWh</span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )) : <p className="text-xs text-muted-foreground">No readings</p>}
      </Card>
    </div>
  );
}
