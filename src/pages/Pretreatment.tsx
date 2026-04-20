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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ComputedInput } from '@/components/ComputedInput';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function Pretreatment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [trainId, setTrainId] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [bwStart, setBwStart] = useState('');
  const [bwEnd, setBwEnd] = useState('');
  const [hppTarget, setHppTarget] = useState('');
  const [bagsChanged, setBagsChanged] = useState('0');
  const [remarks, setRemarks] = useState('');

  useEffect(() => { if (selectedPlantId && !plantId) setPlantId(selectedPlantId); }, [selectedPlantId]);

  const { data: trains } = useQuery({
    queryKey: ['pretreat-trains', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const train = useMemo(() => trains?.find((t: any) => t.id === trainId), [trains, trainId]);

  const [mmf, setMmf] = useState<Record<number, string>>({});
  const [boosters, setBoosters] = useState<Record<number, { target: string; amp: string }>>({});
  const [afms, setAfms] = useState<Record<number, { inlet: string; outlet: string }>>({});
  const [housings, setHousings] = useState<Record<number, { inP: string; outP: string }>>({});

  useEffect(() => {
    setMmf({}); setBoosters({}); setAfms({}); setHousings({});
  }, [trainId]);

  const submit = async () => {
    if (!plantId || !trainId) { toast.error('Select plant and train'); return; }
    const mmf_readings = Object.entries(mmf).filter(([, v]) => v).map(([k, v]) => ({ unit: +k, reading: +v }));
    const booster_pumps = Object.entries(boosters).filter(([, v]) => v.target || v.amp)
      .map(([k, v]) => ({ unit: +k, target_pressure_psi: v.target ? +v.target : null, amperage: v.amp ? +v.amp : null }));
    const afm_units = Object.entries(afms).filter(([, v]) => v.inlet || v.outlet)
      .map(([k, v]) => ({ unit: +k, inlet_psi: v.inlet ? +v.inlet : null, outlet_psi: v.outlet ? +v.outlet : null }));
    const filter_housings = Object.entries(housings).filter(([, v]) => v.inP || v.outP)
      .map(([k, v]) => ({ unit: +k, in_psi: v.inP ? +v.inP : null, out_psi: v.outP ? +v.outP : null }));

    const { error } = await supabase.from('ro_pretreatment_readings').insert({
      plant_id: plantId, train_id: trainId,
      reading_datetime: new Date(dt).toISOString(),
      backwash_start: bwStart ? new Date(bwStart).toISOString() : null,
      backwash_end: bwEnd ? new Date(bwEnd).toISOString() : null,
      mmf_readings, booster_pumps, afm_units, filter_housings,
      hpp_target_pressure_psi: hppTarget ? +hppTarget : null,
      bag_filters_changed: +bagsChanged || 0,
      remarks: remarks || null,
      recorded_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Pre-treatment reading saved');
    setMmf({}); setBoosters({}); setAfms({}); setHousings({});
    setBwStart(''); setBwEnd(''); setHppTarget(''); setBagsChanged('0'); setRemarks('');
    qc.invalidateQueries({ queryKey: ['pretreat'] });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">RO Pre-Treatment</h1>
        <p className="text-sm text-muted-foreground">MMF, Boosters, AFM, Filter Housings</p>
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
        </div>
      </Card>

      {train && (
        <>
          <Card className="p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Backwash window</h4>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Started</Label><Input type="datetime-local" value={bwStart} onChange={(e) => setBwStart(e.target.value)} /></div>
              <div><Label className="text-xs">Ended</Label><Input type="datetime-local" value={bwEnd} onChange={(e) => setBwEnd(e.target.value)} /></div>
            </div>
          </Card>

          {train.num_afm > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">MMF readings ({train.num_afm})</h4>
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: train.num_afm }, (_, i) => i + 1).map((u) => (
                  <div key={u}>
                    <Label className="text-xs">MMF {u}</Label>
                    <Input type="number" step="any" value={mmf[u] ?? ''}
                      onChange={(e) => setMmf({ ...mmf, [u]: e.target.value })} />
                  </div>
                ))}
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

          {train.num_afm > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">AFM units ({train.num_afm})</h4>
              {Array.from({ length: train.num_afm }, (_, i) => i + 1).map((u) => {
                const inP = +(afms[u]?.inlet ?? '');
                const outP = +(afms[u]?.outlet ?? '');
                const dp = afms[u]?.inlet && afms[u]?.outlet ? (inP - outP).toFixed(2) : '';
                return (
                  <div key={u} className="grid grid-cols-4 gap-2 items-end">
                    <div className="text-xs font-medium pt-2">AFM {u}</div>
                    <div>
                      <Label className="text-xs">Inlet psi</Label>
                      <Input type="number" step="any" value={afms[u]?.inlet ?? ''}
                        onChange={(e) => setAfms({ ...afms, [u]: { ...(afms[u] || { outlet: '' }), inlet: e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-xs">Outlet psi</Label>
                      <Input type="number" step="any" value={afms[u]?.outlet ?? ''}
                        onChange={(e) => setAfms({ ...afms, [u]: { ...(afms[u] || { inlet: '' }), outlet: e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-xs">DP (auto)</Label>
                      <ComputedInput value={dp} />
                    </div>
                  </div>
                );
              })}
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

          <Button onClick={submit} className="w-full">Save pre-treatment reading</Button>
        </>
      )}

      {!train && plantId && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Select a train to log pre-treatment data</Card>
      )}
    </div>
  );
}
