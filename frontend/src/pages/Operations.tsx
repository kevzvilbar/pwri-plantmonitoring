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
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { findExistingReading } from '@/lib/duplicateCheck';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Waves } from 'lucide-react';

const MAX_READINGS_PER_DAY = 3;
const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';

// ---- Blending wells list (Mongo-backed) ----
function useBlendingWells(plantId: string) {
  return useQuery<{ wells: { well_id: string }[] }>({
    queryKey: ['blending-wells', plantId],
    queryFn: async () => {
      const qs = plantId ? `?plant_id=${encodeURIComponent(plantId)}` : '';
      const res = await fetch(`${BASE}/api/blending/wells${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!plantId,
  });
}

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

// ---------- LOCATOR (row-per-locator quick entry) ----------

function LocatorReadingForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [plantId, setPlantId] = useState('');

  const { data: locators } = useQuery({
    queryKey: ['op-locators', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('locators').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  // Fetch last 30 days of readings once, compute previous/today per locator client-side
  const { data: recentReadings } = useQuery({
    queryKey: ['op-loc-recent', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('locator_readings')
        .select('*')
        .eq('plant_id', plantId)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })).data ?? [];
    },
    enabled: !!plantId,
  });

  const { latestByLocator, todayByLocator, avgByLocator } = useMemo(() => {
    const latest: Record<string, any> = {};
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const volsByLocator: Record<string, number[]> = {};

    recentReadings?.forEach((r: any) => {
      if (!latest[r.locator_id]) latest[r.locator_id] = r;
      if (new Date(r.reading_datetime) >= startOfDay) {
        (today[r.locator_id] ||= []).push(r);
      }
      if (r.daily_volume != null && r.daily_volume > 0) {
        (volsByLocator[r.locator_id] ||= []).push(r.daily_volume);
      }
    });
    for (const [k, v] of Object.entries(volsByLocator)) {
      avgs[k] = v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
    }
    return { latestByLocator: latest, todayByLocator: today, avgByLocator: avgs };
  }, [recentReadings]);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label>Plant</Label>
        <PlantSelector value={plantId} onChange={setPlantId} />
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium flex items-center justify-between">
            <span>Active locators</span>
            <span className="text-muted-foreground">{locators?.length ?? 0} total</span>
          </div>
          {locators?.length ? (
            <ul className="divide-y">
              {locators.map((l: any) => (
                <li key={l.id}>
                  <LocatorRow
                    locator={l}
                    plantId={plantId}
                    previous={latestByLocator[l.id]?.current_reading ?? null}
                    todayReadings={todayByLocator[l.id] ?? []}
                    avgVol={avgByLocator[l.id] ?? null}
                    userId={user?.id}
                    onSaved={() => qc.invalidateQueries()}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No active locators for this plant</p>
          )}
        </Card>
      )}
    </div>
  );
}

function LocatorRow({
  locator, plantId, previous, todayReadings, avgVol, userId, onSaved,
}: {
  locator: any; plantId: string; previous: number | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
}) {
  const [reading, setReading] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cur = +reading || 0;
  const dailyVol = previous != null && reading ? cur - previous : null;
  const belowPrev = previous != null && cur > 0 && cur < previous;
  const highVol = avgVol != null && dailyVol != null && dailyVol > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday = todayReadings[0] ?? null;
  const atLimit = !editingId && todayCount >= MAX_READINGS_PER_DAY;

  const save = async () => {
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) {
      toast.error(`${locator.name}: max ${MAX_READINGS_PER_DAY} readings/day reached`);
      return;
    }
    if (belowPrev && !window.confirm(`${locator.name}: reading below previous — save anyway?`)) return;
    if (!belowPrev && highVol && !window.confirm(`${locator.name}: volume unusually high — save anyway?`)) return;

    setSaving(true);
    let gps_lat = null, gps_lng = null, off = false;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (locator.gps_lat && locator.gps_lng) {
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
      }
    } catch { /* ignore */ }

    const payload: any = {
      locator_id: locator.id, plant_id: plantId,
      current_reading: cur, previous_reading: previous,
      gps_lat, gps_lng, off_location_flag: off,
      recorded_by: userId,
    };

    const { error } = editingId
      ? await supabase.from('locator_readings').update(payload).eq('id', editingId)
      : await supabase.from('locator_readings').insert(payload);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${locator.name}: ${editingId ? 'updated' : 'saved'}`);
    setReading(''); setEditingId(null);
    onSaved();
  };

  const editLastToday = () => {
    if (!lastToday) return;
    setEditingId(lastToday.id);
    setReading(String(lastToday.current_reading));
  };

  const cancelEdit = () => { setEditingId(null); setReading(''); };

  return (
    <div className="p-3 flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-[140px]">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate">{locator.name}</div>
          {lastToday?.off_location_flag && (
            <StatusPill tone="warn"><MapPin className="h-3 w-3" /> off</StatusPill>
          )}
          {editingId && <span className="text-[10px] uppercase tracking-wide text-highlight">editing</span>}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          prev: <span className="font-mono-num">{previous == null ? '—' : fmtNum(previous)}</span>
          {dailyVol != null && (
            <> · Δ <span className="font-mono-num">{fmtNum(dailyVol)} m³</span></>
          )}
          <span className="mx-1">·</span>
          <span className={atLimit ? 'text-warn-foreground' : ''}>
            {todayCount}/{MAX_READINGS_PER_DAY} today
          </span>
        </div>
      </div>

      <Input
        type="number"
        step="any"
        inputMode="decimal"
        value={reading}
        onChange={(e) => setReading(e.target.value)}
        placeholder="Reading"
        className="w-28 sm:w-32 shrink-0"
      />

      <Button
        onClick={save}
        disabled={saving || !reading || atLimit}
        size="sm"
        className="shrink-0"
      >
        {saving ? '...' : editingId ? 'Update' : 'Save'}
      </Button>

      {lastToday && !editingId && (
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={editLastToday}
          title={`Edit last today reading (${fmtNum(lastToday.current_reading)})`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      {editingId && (
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={cancelEdit}
          title="Cancel edit"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}

      {reading && (belowPrev || highVol) && (
        <div className="w-full text-xs text-warn-foreground bg-warn-soft px-2 py-1 rounded">
          {belowPrev ? 'Below previous' : 'Volume unusually high vs. avg'}
        </div>
      )}
    </div>
  );
}

// ---------- WELL (row-per-well quick entry) ----------

function WellReadingForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const plantName = plants?.find((p: any) => p.id === plantId)?.name;

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-well-recent', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('well_readings')
        .select('*')
        .eq('plant_id', plantId)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })).data ?? [];
    },
    enabled: !!plantId,
  });

  const { latestByWell, todayByWell } = useMemo(() => {
    const latest: Record<string, any> = {};
    const today: Record<string, any[]> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    recentReadings?.forEach((r: any) => {
      if (!latest[r.well_id]) latest[r.well_id] = r;
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.well_id] ||= []).push(r);
    });
    return { latestByWell: latest, todayByWell: today };
  }, [recentReadings]);

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingSet = useMemo(
    () => new Set((blendingData?.wells ?? []).map((w) => w.well_id)),
    [blendingData],
  );

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label>Plant</Label>
        <PlantSelector value={plantId} onChange={setPlantId} />
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium flex items-center justify-between">
            <span>Active wells</span>
            <span className="text-muted-foreground">{wells?.length ?? 0} total</span>
          </div>
          {wells?.length ? (
            <ul className="divide-y">
              {wells.map((w: any) => (
                <li key={w.id}>
                  <WellRow
                    well={w}
                    plantId={plantId}
                    plantName={plantName}
                    previousMeter={latestByWell[w.id]?.current_reading ?? null}
                    previousPower={latestByWell[w.id]?.power_meter_reading ?? null}
                    todayReadings={todayByWell[w.id] ?? []}
                    userId={user?.id}
                    isBlending={blendingSet.has(w.id)}
                    onSaved={() => qc.invalidateQueries()}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No active wells for this plant</p>
          )}
        </Card>
      )}
    </div>
  );
}

function WellRow({
  well, plantId, plantName, previousMeter, previousPower, todayReadings, userId,
  isBlending, onSaved,
}: {
  well: any; plantId: string; plantName?: string;
  previousMeter: number | null; previousPower: number | null;
  todayReadings: any[];
  userId: string | undefined;
  isBlending: boolean;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [reading, setReading] = useState('');
  const [powerReading, setPowerReading] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingBlend, setTogglingBlend] = useState(false);

  const toggleBlending = async () => {
    // Bypass wells are required to have a meter reading recorded so the
    // injected volume can be computed (previous_reading → current_reading).
    if (!isBlending && previousMeter == null) {
      toast.error(`${well.name}: Record A Meter Reading First So Injected Volume Can Be Computed.`);
      return;
    }
    setTogglingBlend(true);
    try {
      const res = await fetch(`${BASE}/api/blending/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId ?? '' },
        body: JSON.stringify({
          well_id: well.id,
          plant_id: plantId,
          well_name: well.name,
          plant_name: plantName,
          is_blending: !isBlending,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(isBlending
        ? `${well.name}: Bypass Removed`
        : `${well.name}: Marked As Bypass Well — Injects To Product Water`);
      qc.invalidateQueries({ queryKey: ['blending-wells', plantId] });
    } catch (e: any) {
      toast.error(`Bypass Toggle Failed: ${e.message || e}`);
    } finally {
      setTogglingBlend(false);
    }
  };

  const cur = +reading || 0;
  const dailyVol = previousMeter != null && reading ? cur - previousMeter : null;
  const belowPrev = previousMeter != null && cur > 0 && cur < previousMeter;
  const todayCount = todayReadings.length;
  const lastToday = todayReadings[0] ?? null;
  const atLimit = !editingId && todayCount >= MAX_READINGS_PER_DAY;

  const save = async () => {
    if (!reading) { toast.error(`${well.name}: enter a meter reading`); return; }
    if (atLimit) {
      toast.error(`${well.name}: max ${MAX_READINGS_PER_DAY} readings/day reached`);
      return;
    }
    if (belowPrev && !window.confirm(`${well.name}: meter below previous — save anyway?`)) return;

    setSaving(true);
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
    } catch { /* ignore */ }

    const payload: any = {
      well_id: well.id, plant_id: plantId,
      current_reading: cur, previous_reading: previousMeter,
      power_meter_reading: powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false,
      recorded_by: userId,
    };

    const { error } = editingId
      ? await supabase.from('well_readings').update(payload).eq('id', editingId)
      : await supabase.from('well_readings').insert(payload);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    // Blending audit: if this well is tagged as Blending and volume > 0,
    // log a blending event so it surfaces under Dashboard → Alerts.
    const dailyVolAtSave = previousMeter != null ? cur - previousMeter : null;
    if (isBlending && dailyVolAtSave != null && dailyVolAtSave > 0) {
      try {
        await fetch(`${BASE}/api/blending/audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            well_id: well.id, plant_id: plantId,
            well_name: well.name, plant_name: plantName,
            event_date: new Date().toISOString().slice(0, 10),
            volume_m3: dailyVolAtSave,
          }),
        });
      } catch { /* non-fatal */ }
    }
    toast.success(`${well.name}: ${editingId ? 'updated' : 'saved'}`);
    setReading(''); setPowerReading(''); setEditingId(null);
    onSaved();
  };

  const editLastToday = () => {
    if (!lastToday) return;
    setEditingId(lastToday.id);
    setReading(String(lastToday.current_reading ?? ''));
    setPowerReading(lastToday.power_meter_reading != null ? String(lastToday.power_meter_reading) : '');
  };

  const cancelEdit = () => { setEditingId(null); setReading(''); setPowerReading(''); };

  return (
    <div className="p-3 flex flex-wrap items-center gap-2" data-testid={`well-row-${well.id}`}>
      <div className="min-w-0 flex-1 basis-[140px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-sm font-medium truncate">{well.name}</div>
          {well.has_power_meter && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">kWh</span>
          )}
          {isBlending && (
            <Badge
              className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100 font-normal"
              data-testid={`blending-badge-${well.id}`}
              title="Marked As Bypass Well — Injects Directly To Product Water"
            >
              <Waves className="h-3 w-3 mr-1" /> Bypass
            </Badge>
          )}
          {editingId && <span className="text-[10px] uppercase tracking-wide text-highlight">Editing</span>}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          prev: <span className="font-mono-num">{previousMeter == null ? '—' : fmtNum(previousMeter)}</span>
          {dailyVol != null && (
            <> · Δ <span className="font-mono-num">{fmtNum(dailyVol)} m³</span></>
          )}
          <span className="mx-1">·</span>
          <span className={atLimit ? 'text-warn-foreground' : ''}>
            {todayCount}/{MAX_READINGS_PER_DAY} today
          </span>
        </div>
      </div>

      <Input
        type="number"
        step="any"
        inputMode="decimal"
        value={reading}
        onChange={(e) => setReading(e.target.value)}
        placeholder="Meter"
        className="w-24 sm:w-28 shrink-0"
      />

      {well.has_power_meter && (
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          value={powerReading}
          onChange={(e) => setPowerReading(e.target.value)}
          placeholder="Power"
          className="w-24 sm:w-28 shrink-0"
          title={`Previous power: ${previousPower == null ? '—' : fmtNum(previousPower)}`}
        />
      )}

      <Button
        onClick={save}
        disabled={saving || !reading || atLimit}
        size="sm"
        className="shrink-0"
      >
        {saving ? '...' : editingId ? 'Update' : 'Save'}
      </Button>

      {lastToday && !editingId && (
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={editLastToday}
          title={`Edit last today reading (${fmtNum(lastToday.current_reading)})`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      {editingId && (
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={cancelEdit}
          title="Cancel edit"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* Mark As Bypass Well toggle */}
      <div className="flex flex-col items-center shrink-0">
        <span
          className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none mb-0.5"
          data-testid={`bypass-toggle-label-${well.id}`}
        >
          Mark as Bypass
        </span>
        <Button
          variant={isBlending ? 'default' : 'outline'}
          size="sm"
          className={`h-8 ${isBlending ? 'bg-violet-600 hover:bg-violet-600/90' : ''}`}
          onClick={toggleBlending}
          disabled={togglingBlend}
          title={isBlending ? 'Remove Bypass Tag' : 'Mark As Bypass Well (Injects To Product Water)'}
          data-testid={`blending-toggle-${well.id}`}
        >
          <Waves className="h-3.5 w-3.5 mr-1" />
          {isBlending ? 'Bypass On' : 'Mark As Bypass'}
        </Button>
      </div>

      {reading && belowPrev && (
        <div className="w-full text-xs text-warn-foreground bg-warn-soft px-2 py-1 rounded">
          Meter below previous
        </div>
      )}
    </div>
  );
}

// ---------- POWER (unchanged plant-level form) ----------

function PowerForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [reading, setReading] = useState('');
  const [solarKwh, setSolarKwh] = useState('');
  const [gridKwh, setGridKwh] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [editingId, setEditingId] = useState<string | null>(null);

  const plant = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const showSolar = !!plant?.has_solar;
  const showGrid = plant?.has_grid !== false; // default true

  const { data: history } = useQuery({
    queryKey: ['op-power', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_readings').select('*').eq('plant_id', plantId).order('reading_datetime', { ascending: false }).limit(7)).data ?? [] : [],
    enabled: !!plantId,
  });
  const previous = history?.find((r: any) => r.id !== editingId)?.meter_reading_kwh ?? null;
  const daily = previous != null && reading ? +reading - previous : null;

  const submit = async () => {
    if (!plantId || !reading) return;

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
    if (showSolar || showGrid) {
      payload.daily_solar_kwh = solarKwh ? +solarKwh : 0;
      payload.daily_grid_kwh = gridKwh ? +gridKwh : 0;
    }
    let error;
    if (editingId) {
      ({ error } = await supabase.from('power_readings').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('power_readings').insert(payload));
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Updated' : 'Power reading saved');
    setReading(''); setSolarKwh(''); setGridKwh(''); setEditingId(null);
    qc.invalidateQueries();
  };

  const startEdit = (r: any) => {
    setReading(String(r.meter_reading_kwh));
    setSolarKwh(r.daily_solar_kwh != null ? String(r.daily_solar_kwh) : '');
    setGridKwh(r.daily_grid_kwh != null ? String(r.daily_grid_kwh) : '');
    setDt(format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditingId(r.id);
    toast.info('Editing power reading');
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div><Label>Plant</Label><PlantSelector value={plantId} onChange={(v) => { setPlantId(v); setEditingId(null); }} /></div>
        <div>
          <Label>Date &amp; Time</Label>
          <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} className="h-10 w-full sm:max-w-[260px] min-w-[220px]" />
        </div>
        <div>
          <Label>Meter Reading {editingId && <span className="text-xs text-highlight">(editing)</span>}</Label>
          <Input type="number" step="any" value={reading} onChange={e => setReading(e.target.value)} placeholder="Raw kWh meter value" data-testid="power-meter-input" />
          {previous != null && <div className="mt-1 text-xs text-muted-foreground">Previous: <span className="font-mono-num">{fmtNum(previous)}</span> {daily != null && <>· Daily: <span className="font-mono-num">{fmtNum(daily)} kWh</span></>}</div>}
        </div>

        {(showSolar || showGrid) && (
          <details className="rounded-md border bg-muted/30 px-3 py-2" open={showSolar}>
            <summary className="text-xs font-medium cursor-pointer flex items-center gap-2">
              Energy Source Breakdown
              <span className="text-[10px] text-muted-foreground">
                {showSolar && showGrid ? 'Solar + Grid' : showSolar ? 'Solar only' : 'Grid only'}
              </span>
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {showSolar && (
                <div>
                  <Label className="text-xs">Daily Solar (kWh)</Label>
                  <Input
                    type="number" step="any" value={solarKwh}
                    onChange={e => setSolarKwh(e.target.value)}
                    placeholder="kWh from solar"
                    data-testid="power-solar-input"
                  />
                </div>
              )}
              {showGrid && (
                <div>
                  <Label className="text-xs">Daily Grid (kWh)</Label>
                  <Input
                    type="number" step="any" value={gridKwh}
                    onChange={e => setGridKwh(e.target.value)}
                    placeholder="kWh from grid"
                    data-testid="power-grid-input"
                  />
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Optional. Leave blank if you only have a single combined meter — the system
              treats the daily delta as Grid by default.
            </p>
          </details>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} className="flex-1">{editingId ? 'Update' : 'Save'}</Button>
          {editingId && <Button variant="ghost" onClick={() => { setEditingId(null); setReading(''); setSolarKwh(''); setGridKwh(''); }}>Cancel</Button>}
        </div>
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Last 7 readings</h4>
        {history?.length ? history.map((r: any) => (
          <div key={r.id} className="flex justify-between items-center text-xs py-1.5 border-t">
            <span className="flex-1">{format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm')}</span>
            <span className="font-mono-num mr-2">{fmtNum(r.daily_consumption_kwh ?? 0)} kWh</span>
            {(r.daily_solar_kwh > 0 || r.daily_grid_kwh > 0) && (
              <span className="font-mono-num mr-2 text-[10px] text-muted-foreground">
                ☀{fmtNum(r.daily_solar_kwh ?? 0)} · ⚡{fmtNum(r.daily_grid_kwh ?? 0)}
              </span>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )) : <p className="text-xs text-muted-foreground">No readings</p>}
      </Card>
    </div>
  );
}
