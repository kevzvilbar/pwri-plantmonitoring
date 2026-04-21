import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ComputedInput } from '@/components/ComputedInput';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { ExportButton } from '@/components/ExportButton';
import { toast } from 'sonner';
import { format } from 'date-fns';

type AfmRow = { unit: number; bw: boolean; bwStart: string; bwEnd: string; reading: string };

export default function Pretreatment() {
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

  // Per-AFM/MMF rows: independent backwash + reading
  const [afmmf, setAfmmf] = useState<Record<number, AfmRow>>({});
  const [boosters, setBoosters] = useState<Record<number, { target: string; amp: string }>>({});
  const [housings, setHousings] = useState<Record<number, { inP: string; outP: string }>>({});

  useEffect(() => {
    setAfmmf({}); setBoosters({}); setHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
  }, [trainId]);

  const setAfmmfField = (u: number, patch: Partial<AfmRow>) => setAfmmf((p) => ({
    ...p,
    [u]: { unit: u, bw: false, bwStart: '', bwEnd: '', reading: '', ...(p[u] ?? {}), ...patch },
  }));

  const submit = async () => {
    if (!plantId || !trainId) { toast.error('Select plant and train'); return; }

    const mmf_readings = Object.values(afmmf).filter((r) => r.reading)
      .map((r) => ({ unit: r.unit, reading: +r.reading }));
    const afm_units = Object.values(afmmf)
      .filter((r) => r.bw && (r.bwStart || r.bwEnd))
      .map((r) => ({
        unit: r.unit,
        backwash_start: r.bwStart ? new Date(r.bwStart).toISOString() : null,
        backwash_end: r.bwEnd ? new Date(r.bwEnd).toISOString() : null,
      }));
    const booster_pumps = Object.entries(boosters).filter(([, v]) => v.target || v.amp)
      .map(([k, v]) => ({ unit: +k, target_pressure_psi: v.target ? +v.target : null, amperage: v.amp ? +v.amp : null }));
    const filter_housings = Object.entries(housings).filter(([, v]) => v.inP || v.outP)
      .map(([k, v]) => ({ unit: +k, in_psi: v.inP ? +v.inP : null, out_psi: v.outP ? +v.outP : null }));

    const { error } = await supabase.from('ro_pretreatment_readings').insert({
      plant_id: plantId, train_id: trainId,
      reading_datetime: new Date(dt).toISOString(),
      backwash_start: isSynchronized && syncBwOn && syncBwStart ? new Date(syncBwStart).toISOString() : null,
      backwash_end: isSynchronized && syncBwOn && syncBwEnd ? new Date(syncBwEnd).toISOString() : null,
      mmf_readings, booster_pumps, afm_units, filter_housings,
      hpp_target_pressure_psi: hppTarget ? +hppTarget : null,
      bag_filters_changed: +bagsChanged || 0,
      remarks: remarks || null,
      recorded_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Pre-treatment reading saved');
    setAfmmf({}); setBoosters({}); setHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setHppTarget(''); setBagsChanged('0'); setRemarks('');
    qc.invalidateQueries({ queryKey: ['pretreat'] });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RO Pre-Treatment</h1>
          <p className="text-sm text-muted-foreground">AFM/MMF, Boosters, Filter Housings</p>
        </div>
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
                  const row = afmmf[u] ?? { unit: u, bw: false, bwStart: '', bwEnd: '', reading: '' };
                  return (
                    <Collapsible key={u} className="border rounded-md">
                      <div className="flex items-center justify-between p-2 gap-2">
                        <div className="text-sm font-medium">AFM/MMF {u}</div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" step="any" placeholder="Reading"
                            value={row.reading} className="h-8 w-28"
                            onChange={(e) => setAfmmfField(u, { reading: e.target.value })}
                          />
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 px-2">
                              BW <ChevronDown className="h-3 w-3" />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>
                      <CollapsibleContent className="border-t p-2 space-y-2 bg-muted/30">
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
                const dp = housings[u]?.inP && housings[u]?.outP ? (inP - outP).toFixed(2) : '';
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
                      <ComputedInput value={dp} />
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

          <Card className="p-3 space-y-2">
            <Label className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any observations..." />
          </Card>

          <Button onClick={submit} className="w-full h-12 text-base">Save pre-treatment reading</Button>
        </>
      )}

      {!train && plantId && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Select a train to log pre-treatment data</Card>
      )}
    </div>
  );
}
