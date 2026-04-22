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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/StatusPill';
import { calc, fmtNum, ALERTS } from '@/lib/calculations';
import { findExistingReading } from '@/lib/duplicateCheck';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ComputedInput } from '@/components/ComputedInput';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';

export default function ROTrains() {
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RO Trains & Pre-Treatment</h1>
          <p className="text-sm text-muted-foreground">Train logs, AFM/MMF, CIP, and pre-treatment readings</p>
        </div>
      </div>
      <Tabs defaultValue="overview">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pretreat-ro">Pre-Treatment & RO</TabsTrigger>
          <TabsTrigger value="cip">CIP</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-3"><Overview /></TabsContent>
        <TabsContent value="pretreat-ro" className="mt-3"><PretreatmentAndROLog /></TabsContent>
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

type AfmRow = { unit: number; bw: boolean; bwStart: string; bwEnd: string; reading: string; pressureIn: string; pressureOut: string };

function PretreatmentAndROLog() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // Plant-wide synchronized backwash window (only used when plant.backwash_mode = 'synchronized')
  const [syncBwOn, setSyncBwOn] = useState(false);
  const [syncBwStart, setSyncBwStart] = useState('');
  const [syncBwEnd, setSyncBwEnd] = useState('');

  const [hppTarget, setHppTarget] = useState('');
  const [bagsChanged, setBagsChanged] = useState('0');
  const [remarks, setRemarks] = useState('');

  // RO Train readings
  const [roValues, setRoValues] = useState({
    feed_pressure_psi: '', reject_pressure_psi: '',
    feed_flow: '', permeate_flow: '',
    feed_tds: '', permeate_tds: '', reject_tds: '',
    feed_ph: '', permeate_ph: '', reject_ph: '',
    turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
  });

  useEffect(() => { if (selectedPlantId && !plantId) setPlantId(selectedPlantId); }, [selectedPlantId]);

  const plant = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const isSynchronized = (plant as any)?.backwash_mode === 'synchronized';

  const { data: trains } = useQuery({
    queryKey: ['pretreat-trains', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? []
      : [],
    enabled: !!plantId,
  });
  const train = useMemo(() => trains?.find((t: any) => t.id === trainId), [trains, trainId]);

  // Per-AFM/MMF rows: independent backwash + reading + pressure
  const [afmmf, setAfmmf] = useState<Record<number, AfmRow>>({});
  const [boosters, setBoosters] = useState<Record<number, { target: string; amp: string }>>({});
  const [housings, setHousings] = useState<Record<number, { inP: string; outP: string }>>({});

  useEffect(() => {
    setAfmmf({}); setBoosters({}); setHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setRoValues({
      feed_pressure_psi: '', reject_pressure_psi: '',
      feed_flow: '', permeate_flow: '',
      feed_tds: '', permeate_tds: '', reject_tds: '',
      feed_ph: '', permeate_ph: '', reject_ph: '',
      turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
    });
  }, [trainId]);

  const setAfmmfField = (u: number, patch: Partial<AfmRow>) => setAfmmf((p) => ({
    ...p,
    [u]: { unit: u, bw: false, bwStart: '', bwEnd: '', reading: '', pressureIn: '', pressureOut: '', ...(p[u] ?? {}), ...patch },
  }));

  // RO calculations
  const num = (s: string) => s ? +s : NaN;
  const dp = calc.pressureDiff(num(roValues.feed_pressure_psi), num(roValues.reject_pressure_psi));
  const recovery = calc.recovery(num(roValues.permeate_flow), num(roValues.feed_flow));
  const rejection = calc.rejection(num(roValues.permeate_tds), num(roValues.reject_tds));
  const saltPassage = calc.saltPassage(num(roValues.permeate_tds), num(roValues.reject_tds));
  const rejectFlow = calc.rejectFlow(num(roValues.feed_flow), num(roValues.permeate_flow));

  const phWarn = num(roValues.permeate_ph) && (num(roValues.permeate_ph) < 6.5 || num(roValues.permeate_ph) > 8.5);
  const recWarn = recovery != null && (recovery < 65 || recovery > 75);
  const dpAlert = dp != null && dp >= ALERTS.dp_max;

  const submit = async () => {
    if (!plantId || !trainId) { toast.error('Select plant and train'); return; }

    // Check for duplicate RO reading
    const dup = await findExistingReading({
      table: 'ro_train_readings', entityCol: 'train_id', entityId: trainId,
      datetime: new Date(dt), windowKind: 'hour',
    });
    if (dup) {
      toast.error('A reading already exists for this train within this hour. Edit it from the Overview tab to avoid duplicates.');
      return;
    }

    // Save RO Train reading
    const roPayload: any = {
      train_id: trainId, plant_id: plantId, reading_datetime: new Date(dt).toISOString(),
      ...Object.fromEntries(Object.entries(roValues).map(([k, val]) => [k, val ? +val : null])),
      reject_flow: rejectFlow, dp_psi: dp, recovery_pct: recovery, rejection_pct: rejection, salt_passage_pct: saltPassage,
      recorded_by: user?.id,
    };
    const { error: roError } = await supabase.from('ro_train_readings').insert(roPayload);
    if (roError) { toast.error(`RO reading error: ${roError.message}`); return; }

    // Save pre-treatment reading
    const mmf_readings = Object.values(afmmf).filter((r) => r.reading)
      .map((r) => ({ unit: r.unit, reading: +r.reading }));
    const afm_units = Object.values(afmmf)
      .filter((r) => r.bw && (r.bwStart || r.bwEnd))
      .map((r) => ({
        unit: r.unit,
        backwash_start: r.bwStart ? new Date(r.bwStart).toISOString() : null,
        backwash_end: r.bwEnd ? new Date(r.bwEnd).toISOString() : null,
      }));
    const afm_pressures = Object.values(afmmf)
      .filter((r) => r.pressureIn || r.pressureOut)
      .map((r) => {
        const pIn = r.pressureIn ? +r.pressureIn : null;
        const pOut = r.pressureOut ? +r.pressureOut : null;
        const deltaP = pIn !== null && pOut !== null ? +(pIn - pOut).toFixed(2) : null;
        return { unit: r.unit, pressure_in_psi: pIn, pressure_out_psi: pOut, dp_psi: deltaP };
      });
    const booster_pumps = Object.entries(boosters).filter(([, v]) => v.target || v.amp)
      .map(([k, v]) => ({ unit: +k, target_pressure_psi: v.target ? +v.target : null, amperage: v.amp ? +v.amp : null }));
    const filter_housings = Object.entries(housings).filter(([, v]) => v.inP || v.outP)
      .map(([k, v]) => ({ unit: +k, in_psi: v.inP ? +v.inP : null, out_psi: v.outP ? +v.outP : null }));

    const { error: pretreatError } = await supabase.from('ro_pretreatment_readings').insert({
      plant_id: plantId, train_id: trainId,
      reading_datetime: new Date(dt).toISOString(),
      backwash_start: isSynchronized && syncBwOn && syncBwStart ? new Date(syncBwStart).toISOString() : null,
      backwash_end: isSynchronized && syncBwOn && syncBwEnd ? new Date(syncBwEnd).toISOString() : null,
      mmf_readings, booster_pumps, afm_units, filter_housings, afm_pressures,
      hpp_target_pressure_psi: hppTarget ? +hppTarget : null,
      bag_filters_changed: +bagsChanged || 0,
      remarks: remarks || null,
      recorded_by: user?.id,
    });
    if (pretreatError) { toast.error(`Pre-treatment error: ${pretreatError.message}`); return; }

    toast.success('Pre-treatment & RO reading saved');
    setAfmmf({}); setBoosters({}); setHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setHppTarget(''); setBagsChanged('0'); setRemarks('');
    setRoValues({
      feed_pressure_psi: '', reject_pressure_psi: '',
      feed_flow: '', permeate_flow: '',
      feed_tds: '', permeate_tds: '', reject_tds: '',
      feed_ph: '', permeate_ph: '', reject_ph: '',
      turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
    });
    qc.invalidateQueries();
  };

  const f = (k: keyof typeof roValues) => ({ value: roValues[k], onChange: (e: any) => setRoValues({ ...roValues, [k]: e.target.value }) });

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <p className="text-sm text-muted-foreground">AFM/MMF, Boosters, Filter Housings & RO Vessel</p>
        <ExportButton table="ro_pretreatment_readings" filters={plantId ? { plant_id: plantId } : undefined} />
      </div>

      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Plant</Label>
            <Select value={plantId} onValueChange={(v) => { setPlantId(v); setTrainId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
              <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Train</Label>
            <Select value={trainId} onValueChange={setTrainId} disabled={!plantId}>
              <SelectTrigger><SelectValue placeholder="Select train" /></SelectTrigger>
              <SelectContent>{trains?.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.name ?? `Train ${t.train_number}`}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Reading date & time</Label>
            <Input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />
          </div>
          {plant && (
            <div className="col-span-2 text-[11px] text-muted-foreground">
              Backwash mode: <span className="font-semibold">{isSynchronized ? 'Synchronized (whole train at once)' : 'Independent (per unit)'}</span>
            </div>
          )}
        </div>
      </Card>

      {train && (
        <>
          {isSynchronized && (
            <Card className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="sync-bw" checked={syncBwOn} onCheckedChange={(c) => setSyncBwOn(!!c)} />
                <Label htmlFor="sync-bw" className="text-sm font-semibold cursor-pointer">Train backwash performed?</Label>
              </div>
              {syncBwOn && (
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Started</Label><Input type="datetime-local" value={syncBwStart} onChange={(e) => setSyncBwStart(e.target.value)} /></div>
                  <div><Label className="text-xs">Ended</Label><Input type="datetime-local" value={syncBwEnd} onChange={(e) => setSyncBwEnd(e.target.value)} /></div>
                </div>
              )}
            </Card>
          )}

          {train.num_afm > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">AFM/MMF units ({train.num_afm})</h4>
              <div className="space-y-2">
                {Array.from({ length: train.num_afm }, (_, i) => i + 1).map((u) => {
                  const row = afmmf[u] ?? { unit: u, bw: false, bwStart: '', bwEnd: '', reading: '', pressureIn: '', pressureOut: '' };
                  const pIn = row.pressureIn ? +row.pressureIn : null;
                  const pOut = row.pressureOut ? +row.pressureOut : null;
                  const afmDp = pIn !== null && pOut !== null ? (pIn - pOut).toFixed(2) : '';
                  const dpWarn = afmDp && +afmDp >= 40;
                  return (
                    <Collapsible key={u} className="border rounded-md">
                      <div className="flex items-center justify-between p-2 gap-2">
                        <div className="text-sm font-medium">AFM/MMF {u}</div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" step="any" placeholder="Reading"
                            value={row.reading} className="h-8 w-24"
                            onChange={(e) => setAfmmfField(u, { reading: e.target.value })}
                          />
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 px-2">
                              Details <ChevronDown className="h-3 w-3 ml-1" />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>
                      <CollapsibleContent className="border-t p-2 space-y-3 bg-muted/30">
                        {/* Pressure readings */}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground">Pressure</Label>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-xs">P. In (psi)</Label>
                              <Input type="number" step="any" value={row.pressureIn}
                                onChange={(e) => setAfmmfField(u, { pressureIn: e.target.value })} />
                            </div>
                            <div>
                              <Label className="text-xs">P. Out (psi)</Label>
                              <Input type="number" step="any" value={row.pressureOut}
                                onChange={(e) => setAfmmfField(u, { pressureOut: e.target.value })} />
                            </div>
                            <div>
                              <Label className="text-xs">DP (auto)</Label>
                              <ComputedInput value={afmDp} className={dpWarn ? 'border-danger text-danger' : ''} />
                            </div>
                          </div>
                        </div>

                        {/* Backwash section */}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-muted-foreground">Backwash</Label>
                          {!isSynchronized && (
                            <div className="flex items-center gap-2">
                              <Checkbox id={`bw-${u}`} checked={row.bw} onCheckedChange={(c) => setAfmmfField(u, { bw: !!c })} />
                              <Label htmlFor={`bw-${u}`} className="text-xs cursor-pointer">Backwash done for this unit?</Label>
                            </div>
                          )}
                          {(isSynchronized || row.bw) && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Started</Label>
                                <Input type="datetime-local" value={isSynchronized ? syncBwStart : row.bwStart}
                                  disabled={isSynchronized}
                                  onChange={(e) => setAfmmfField(u, { bwStart: e.target.value })} />
                              </div>
                              <div>
                                <Label className="text-xs">Ended</Label>
                                <Input type="datetime-local" value={isSynchronized ? syncBwEnd : row.bwEnd}
                                  disabled={isSynchronized}
                                  onChange={(e) => setAfmmfField(u, { bwEnd: e.target.value })} />
                              </div>
                            </div>
                          )}
                          {isSynchronized && (
                            <p className="text-[10px] text-muted-foreground">Window controlled by the train-level backwash above.</p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </Card>
          )}

          {train.num_booster_pumps > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Booster pumps ({train.num_booster_pumps})</h4>
              {Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).map((u) => (
                <div key={u} className="grid grid-cols-3 gap-2 items-end">
                  <div className="text-xs font-medium pt-2">Pump {u}</div>
                  <div>
                    <Label className="text-xs">Target psi</Label>
                    <Input type="number" step="any" value={boosters[u]?.target ?? ''}
                      onChange={(e) => setBoosters({ ...boosters, [u]: { ...(boosters[u] || { amp: '' }), target: e.target.value } })} />
                  </div>
                  <div>
                    <Label className="text-xs">Amperage</Label>
                    <Input type="number" step="any" value={boosters[u]?.amp ?? ''}
                      onChange={(e) => setBoosters({ ...boosters, [u]: { ...(boosters[u] || { target: '' }), amp: e.target.value } })} />
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card className="p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">High-pressure pump</h4>
            <div>
              <Label className="text-xs">HPP target pressure (psi)</Label>
              <Input type="number" step="any" value={hppTarget} onChange={(e) => setHppTarget(e.target.value)} />
            </div>
          </Card>

          {train.num_filter_housings > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Filter housings ({train.num_filter_housings})</h4>
              {Array.from({ length: train.num_filter_housings }, (_, i) => i + 1).map((u) => {
                const inP = +(housings[u]?.inP ?? '');
                const outP = +(housings[u]?.outP ?? '');
                const housingDp = housings[u]?.inP && housings[u]?.outP ? (inP - outP).toFixed(2) : '';
                return (
                  <div key={u} className="grid grid-cols-4 gap-2 items-end">
                    <div className="text-xs font-medium pt-2">Housing {u}</div>
                    <div>
                      <Label className="text-xs">IN psi</Label>
                      <Input type="number" step="any" value={housings[u]?.inP ?? ''}
                        onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { outP: '' }), inP: e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-xs">OUT psi</Label>
                      <Input type="number" step="any" value={housings[u]?.outP ?? ''}
                        onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { inP: '' }), outP: e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-xs">DP (auto)</Label>
                      <ComputedInput value={housingDp} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2">
                <Label className="text-xs">Bag filters changed today</Label>
                <Input type="number" min="0" value={bagsChanged} onChange={(e) => setBagsChanged(e.target.value)} />
              </div>
            </Card>
          )}

          {/* RO Vessel Section */}
          <Card className="p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">RO Vessel</h4>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Suction psi</Label><Input type="number" step="any" {...f('suction_pressure_psi')} /></div>
              <div><Label className="text-xs">Feed psi</Label><Input type="number" step="any" {...f('feed_pressure_psi')} /></div>
              <div><Label className="text-xs">Reject psi</Label><Input type="number" step="any" {...f('reject_pressure_psi')} /></div>
              <div><Label className="text-xs">DP psi (auto)</Label><ComputedInput value={dp ?? ''} className={dpAlert ? 'border-danger text-danger font-semibold' : ''} /></div>
              <div><Label className="text-xs">Feed flow</Label><Input type="number" step="any" {...f('feed_flow')} /></div>
              <div><Label className="text-xs">Permeate flow</Label><Input type="number" step="any" {...f('permeate_flow')} /></div>
              <div><Label className="text-xs">Reject flow (auto)</Label><ComputedInput value={rejectFlow ?? ''} /></div>
              <div><Label className="text-xs">Recovery % (auto)</Label><ComputedInput value={recovery ?? ''} className={recWarn ? 'border-warn text-warn-foreground' : ''} /></div>
              <div><Label className="text-xs">Feed TDS</Label><Input type="number" step="any" {...f('feed_tds')} /></div>
              <div><Label className="text-xs">Perm TDS</Label><Input type="number" step="any" {...f('permeate_tds')} /></div>
              <div><Label className="text-xs">Reject TDS</Label><Input type="number" step="any" {...f('reject_tds')} /></div>
              <div><Label className="text-xs">Rejection % (auto)</Label><ComputedInput value={rejection ?? ''} /></div>
              <div><Label className="text-xs">Salt pass % (auto)</Label><ComputedInput value={saltPassage ?? ''} /></div>
              <div><Label className="text-xs">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} /></div>
              <div><Label className="text-xs">Perm pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} /></div>
              <div><Label className="text-xs">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} /></div>
              <div><Label className="text-xs">Turbidity NTU</Label><Input type="number" step="any" {...f('turbidity_ntu')} /></div>
              <div><Label className="text-xs">Temp C</Label><Input type="number" step="any" {...f('temperature_c')} /></div>
            </div>
          </Card>

          <Card className="p-3 space-y-2">
            <Label className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any observations..." />
          </Card>

          <Button onClick={submit} className="w-full h-12 text-base">Save Pre-Treatment & RO Reading</Button>
        </>
      )}

      {!train && plantId && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Select a train to log pre-treatment and RO data</Card>
      )}
    </div>
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
            <div>Train {c.ro_trains?.train_number} - {c.start_datetime && format(new Date(c.start_datetime), 'MMM d, HH:mm')}</div>
            <div className="text-muted-foreground">SLS {c.sls_g ?? 0}g - HCl {c.hcl_l ?? 0}L - NaOH {c.caustic_soda_kg ?? 0}kg</div>
          </div>
        ))}
        {!history?.length && <p className="text-xs text-muted-foreground">No CIP records</p>}
      </Card>
    </div>
  );
}
