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
import { ExportButton } from '@/components/ExportButton';
import { cn } from '@/lib/utils';

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
  // One-shot seed: see PlantPick in Chemicals.tsx for the same pattern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    queryFn: async () => {
      const { data } = await supabase
        .from('ro_train_readings')
        .select('*')
        .eq('train_id', train.id)
        .order('reading_datetime', { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
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

type AfmRow = {
  unit: number;
  bw: boolean;
  bwStart: string;
  bwEnd: string;
  meterStart: string;
  meterEnd: string;
  pressureIn: string;
  pressureOut: string;
};

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
  const [syncMeterStart, setSyncMeterStart] = useState('');
  const [syncMeterEnd, setSyncMeterEnd] = useState('');

  const [hppTarget, setHppTarget] = useState('');
  const [bagsChanged, setBagsChanged] = useState('0');
  const [remarks, setRemarks] = useState('');

  // RO Train online/offline status
  const [trainOnline, setTrainOnline] = useState(true);
  const [offlineStart, setOfflineStart] = useState('');
  const [offlineEnd, setOfflineEnd] = useState('');
  const [offlineReason, setOfflineReason] = useState('');
  const [offlineReasonOther, setOfflineReasonOther] = useState('');

  // RO Train readings
  const [roValues, setRoValues] = useState({
    feed_pressure_psi: '', reject_pressure_psi: '',
    feed_flow: '', permeate_flow: '', reject_flow: '',
    feed_tds: '', permeate_tds: '', reject_tds: '',
    feed_ph: '', permeate_ph: '', reject_ph: '',
    turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
    feed_meter_curr: '',
    permeate_meter_curr: '',
    reject_meter_curr: '',
    power_meter_curr: '',
  });

  // One-shot seed: when the global selectedPlantId resolves and this
  // page hasn't picked a plant yet, default to it. Re-seeding on
  // plantId change is undesirable (would clobber the user's choice),
  // so plantId is intentionally omitted from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Pull the most recent pre-treatment reading for this train so we can default
  // the new form's "Meter Reading Start" to the previous backwash end value.
  const { data: prevPretreat } = useQuery({
    queryKey: ['pretreat-prev', trainId],
    enabled: !!trainId,
    queryFn: async () => (await supabase.from('ro_pretreatment_readings')
      .select('mmf_readings').eq('train_id', trainId)
      .order('reading_datetime', { ascending: false }).limit(1)).data?.[0] ?? null,
  });
  const prevMeterEndByUnit: Record<number, number | null> = useMemo(() => {
    const out: Record<number, number | null> = {};
    const arr = (prevPretreat?.mmf_readings ?? []) as any[];
    for (const r of arr) {
      if (r?.unit != null) out[+r.unit] = r.meter_end ?? null;
    }
    return out;
  }, [prevPretreat]);

  // Pull the most recent RO train reading to auto-fill prev meter readings + duration
  const { data: prevRO } = useQuery({
    queryKey: ['ro-prev', trainId],
    enabled: !!trainId,
    queryFn: async () => (await supabase.from('ro_train_readings')
      .select('reading_datetime, feed_meter_curr, permeate_meter_curr, reject_meter_curr, power_meter_curr')
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: false }).limit(1)).data?.[0] ?? null,
  });

  // Auto-compute duration (min) between current reading datetime and last reading datetime
  const autoDurationMin = useMemo(() => {
    if (!prevRO?.reading_datetime || !dt) return null;
    const diff = (new Date(dt).getTime() - new Date(prevRO.reading_datetime).getTime()) / 60000;
    return diff > 0 ? +diff.toFixed(1) : null;
  }, [prevRO, dt]);

  // Previous meter readings come from last reading's curr values (read-only, auto-filled)
  const prevFeedMeter  = prevRO?.feed_meter_curr     ?? null;
  const prevPermMeter  = prevRO?.permeate_meter_curr ?? null;
  const prevRejMeter   = prevRO?.reject_meter_curr   ?? null;
  const prevPowerMeter = prevRO?.power_meter_curr     ?? null;

  // Per-AFM/MMF rows: independent backwash + reading + pressure
  const [afmmf, setAfmmf] = useState<Record<number, AfmRow>>({});
  const [boosters, setBoosters] = useState<Record<number, { target: string; amp: string }>>({});
  const [housings, setHousings] = useState<Record<number, { inP: string; outP: string }>>({});

  useEffect(() => {
    setAfmmf({}); setBoosters({}); setHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setSyncMeterStart(''); setSyncMeterEnd('');
    setTrainOnline(true); setOfflineStart(''); setOfflineEnd('');
    setOfflineReason(''); setOfflineReasonOther('');
    setRoValues({
      feed_pressure_psi: '', reject_pressure_psi: '',
      feed_flow: '', permeate_flow: '', reject_flow: '',
      feed_tds: '', permeate_tds: '', reject_tds: '',
      feed_ph: '', permeate_ph: '', reject_ph: '',
      turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
      feed_meter_curr: '',
      permeate_meter_curr: '',
      reject_meter_curr: '',
      power_meter_curr: '',
    });
  }, [trainId]);

  // Prefill the synchronized shared meter start when we discover the
  // previous backwash end value. Intentionally NOT depending on
  // `syncMeterStart` — re-running when the user types into the field
  // would overwrite their input. The `syncMeterStart === ''` guard
  // already prevents over-writes for the initial seed case.
  useEffect(() => {
    if (!isSynchronized) return;
    const firstUnit = Object.keys(prevMeterEndByUnit)[0];
    const v = firstUnit != null ? prevMeterEndByUnit[+firstUnit] : null;
    if (v != null && syncMeterStart === '') setSyncMeterStart(String(v));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevMeterEndByUnit, isSynchronized]);

  const setAfmmfField = (u: number, patch: Partial<AfmRow>) => setAfmmf((p) => ({
    ...p,
    [u]: {
      unit: u, bw: false, bwStart: '', bwEnd: '',
      meterStart: '', meterEnd: '', pressureIn: '', pressureOut: '',
      ...(p[u] ?? {}), ...patch,
    },
  }));

  // RO calculations
  const num = (s: string) => s ? +s : NaN;
  const dp = calc.pressureDiff(num(roValues.feed_pressure_psi), num(roValues.reject_pressure_psi));

  // ── Water meter derived flow rates (m³/hr) ──────────────────────────────
  // Duration: auto from datetime diff; prev readings: auto from last session's curr
  const mDur   = autoDurationMin ?? NaN;
  const mDurHr = !isNaN(mDur) && mDur > 0 ? mDur / 60 : null;

  const feedCurr = num(roValues.feed_meter_curr);
  const permCurr = num(roValues.permeate_meter_curr);
  const rejCurr  = num(roValues.reject_meter_curr);

  const feedDelta  = !isNaN(feedCurr) && prevFeedMeter != null ? feedCurr - prevFeedMeter : null;
  const permDelta  = !isNaN(permCurr) && prevPermMeter != null ? permCurr - prevPermMeter : null;
  const rejDelta   = !isNaN(rejCurr)  && prevRejMeter  != null ? rejCurr  - prevRejMeter  : null;

  // Dynamic filling: any one missing = sum/diff of the other two (requires at least two streams entered)
  const feedVol  = feedDelta  ?? (permDelta !== null && rejDelta  !== null ? +(permDelta  + rejDelta ).toFixed(3) : null);
  const permVol  = permDelta  ?? (feedDelta !== null && rejDelta  !== null ? +(feedDelta  - rejDelta ).toFixed(3) : null);
  const rejVol   = rejDelta   ?? (feedDelta !== null && permDelta !== null ? +(feedDelta  - permDelta).toFixed(3) : null);

  const feedFlowMeter  = feedVol  !== null && mDurHr ? +(feedVol  / mDurHr).toFixed(2) : null;
  const permFlowMeter  = permVol  !== null && mDurHr ? +(permVol  / mDurHr).toFixed(2) : null;
  const rejFlowMeter   = rejVol   !== null && mDurHr ? +(rejVol   / mDurHr).toFixed(2) : null;

  // True if the volume was inferred (not directly entered)
  const feedInferred = feedDelta === null && feedVol !== null;
  const permInferred = permDelta === null && permVol !== null;
  const rejInferred  = rejDelta  === null && rejVol  !== null;

  // ── Effective flow values: EM takes priority, then meter-derived ─────────
  // EM inputs (feed_flow, permeate_flow, reject_flow) allow direct override.
  // If EM not provided, fall back to meter-derived rate.
  const emFeedFlow  = roValues.feed_flow     ? num(roValues.feed_flow)     : null;
  const emPermFlow  = roValues.permeate_flow ? num(roValues.permeate_flow) : null;
  const emRejFlow   = roValues.reject_flow   ? num(roValues.reject_flow)   : null;

  const effFeedFlow = emFeedFlow  ?? feedFlowMeter;
  const effPermFlow = emPermFlow  ?? permFlowMeter;
  const effRejFlow  = emRejFlow   ?? rejFlowMeter ?? (effFeedFlow !== null && effPermFlow !== null ? +(effFeedFlow - effPermFlow).toFixed(2) : null);

  // Recovery uses effective flows (EM > meter-derived)
  const recovery    = effPermFlow !== null && effFeedFlow !== null && effFeedFlow > 0
    ? +((effPermFlow / effFeedFlow) * 100).toFixed(1) : null;
  const rejection   = calc.rejection(num(roValues.permeate_tds), num(roValues.reject_tds));
  const saltPassage = calc.saltPassage(num(roValues.permeate_tds), num(roValues.reject_tds));
  // rejectFlow shown in EM section: if user typed it, show as-is; else compute
  const rejectFlow  = effRejFlow;

  const phWarn = num(roValues.permeate_ph) && (num(roValues.permeate_ph) < 6.5 || num(roValues.permeate_ph) > 8.5);
  const recWarn = recovery != null && (recovery < 65 || recovery > 75);
  const dpAlert = dp != null && dp >= ALERTS.dp_max;

  // Train is offline and no end time entered → block all RO parameter inputs
  const isOfflineBlocked = !trainOnline && !offlineEnd;
  const offlineReasonFinal = offlineReason === 'Other' ? offlineReasonOther : offlineReason;

  // ── Power meter ──────────────────────────────────────────────────────────
  // Duration reuses the same auto-computed interval; prev reading from last session
  const pwrDurHr = mDurHr;  // same time window as water meter
  const pwrCurr  = num(roValues.power_meter_curr);
  const pwrDelta = !isNaN(pwrCurr) && prevPowerMeter != null
    ? +(pwrCurr - prevPowerMeter).toFixed(3)
    : null;
  const pwrKw    = pwrDelta !== null && pwrDurHr ? +(pwrDelta / pwrDurHr).toFixed(2) : null;  // avg kW
  // Specific energy uses effective permeate volume (meter-derived preferred for volumetric accuracy)
  const secEnergy = pwrDelta !== null && permVol && permVol > 0                               // kWh/m³
    ? +(pwrDelta / permVol).toFixed(3) : null;

  const submit = async () => {
    if (!plantId || !trainId) { toast.error('Select plant and train'); return; }

    // Offline validation
    if (!trainOnline) {
      if (!offlineStart) { toast.error('Please enter the time the train went offline.'); return; }
      if (!offlineReason) { toast.error('Please select a reason for the offline event.'); return; }
      if (offlineReason === 'Other' && !offlineReasonOther.trim()) { toast.error('Please specify the reason for offline.'); return; }
    }

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
      // Auto-filled prev readings and duration stored alongside curr for record completeness
      feed_meter_prev: prevFeedMeter, permeate_meter_prev: prevPermMeter, reject_meter_prev: prevRejMeter,
      power_meter_prev: prevPowerMeter, meter_duration_min: autoDurationMin,
      reject_flow: rejectFlow ?? (roValues.reject_flow ? +roValues.reject_flow : null),
      dp_psi: dp, recovery_pct: recovery, rejection_pct: rejection, salt_passage_pct: saltPassage,
      train_online: trainOnline,
      offline_since: !trainOnline && offlineStart ? new Date(offlineStart).toISOString() : null,
      offline_until: !trainOnline && offlineEnd   ? new Date(offlineEnd).toISOString()   : null,
      offline_reason: !trainOnline ? offlineReasonFinal || null : null,
      recorded_by: user?.id,
    };
    const { error: roError } = await supabase.from('ro_train_readings').insert(roPayload);
    if (roError) { toast.error(`RO reading error: ${roError.message}`); return; }

    // Save pre-treatment reading
    // mmf_readings keeps per-unit meter start/end (synchronized = shared values across all units)
    const rowsArr = Object.values(afmmf);
    const mmf_readings = isSynchronized
      ? (syncBwOn && (syncMeterStart || syncMeterEnd)
          ? Array.from({ length: train.num_afm }, (_, i) => i + 1).map((u) => ({
              unit: u,
              meter_start: syncMeterStart ? +syncMeterStart : null,
              meter_end: syncMeterEnd ? +syncMeterEnd : null,
            }))
          : [])
      : rowsArr.filter((r) => r.bw && (r.meterStart || r.meterEnd))
          .map((r) => ({
            unit: r.unit,
            meter_start: r.meterStart ? +r.meterStart : null,
            meter_end: r.meterEnd ? +r.meterEnd : null,
          }));

    // Merge backwash + inlet/outlet pressures into the single afm_units jsonb column
    const afm_units = rowsArr
      .filter((r) => r.bw || r.pressureIn || r.pressureOut)
      .map((r) => {
        const pIn = r.pressureIn ? +r.pressureIn : null;
        const pOut = r.pressureOut ? +r.pressureOut : null;
        const dp_psi = pIn !== null && pOut !== null ? +(pIn - pOut).toFixed(2) : null;
        const bwOngoing = isSynchronized ? syncBwOn : r.bw;
        return {
          unit: r.unit,
          backwash_start: bwOngoing
            ? (isSynchronized
                ? (syncBwStart ? new Date(syncBwStart).toISOString() : null)
                : (r.bwStart ? new Date(r.bwStart).toISOString() : null))
            : null,
          backwash_end: bwOngoing
            ? (isSynchronized
                ? (syncBwEnd ? new Date(syncBwEnd).toISOString() : null)
                : (r.bwEnd ? new Date(r.bwEnd).toISOString() : null))
            : null,
          inlet_psi: bwOngoing ? null : pIn,
          outlet_psi: bwOngoing ? null : pOut,
          dp_psi: bwOngoing ? null : dp_psi,
        };
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
      mmf_readings, booster_pumps, afm_units, filter_housings,
      hpp_target_pressure_psi: hppTarget ? +hppTarget : null,
      bag_filters_changed: +bagsChanged || 0,
      remarks: remarks || null,
      recorded_by: user?.id,
    });
    if (pretreatError) { toast.error(`Pre-treatment error: ${pretreatError.message}`); return; }

    toast.success('Pre-treatment & RO reading saved');
    setAfmmf({}); setBoosters({}); setHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setSyncMeterStart(''); setSyncMeterEnd('');
    setHppTarget(''); setBagsChanged('0'); setRemarks('');
    // Reset offline state (train reverts to online after a successful save)
    setTrainOnline(true); setOfflineStart(''); setOfflineEnd(''); setOfflineReason(''); setOfflineReasonOther('');
    setRoValues({
      feed_pressure_psi: '', reject_pressure_psi: '',
      feed_flow: '', permeate_flow: '', reject_flow: '',
      feed_tds: '', permeate_tds: '', reject_tds: '',
      feed_ph: '', permeate_ph: '', reject_ph: '',
      turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
      feed_meter_curr: '',
      permeate_meter_curr: '',
      reject_meter_curr: '',
      power_meter_curr: '',
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
        {/* Plant + Train row — with online/offline toggle */}
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <div>
            <Label>Plant</Label>
            <Select value={plantId} onValueChange={(v) => { setPlantId(v); setTrainId(''); }}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select Plant" /></SelectTrigger>
              <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Train</Label>
            <Select value={trainId} onValueChange={setTrainId} disabled={!plantId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select Train" /></SelectTrigger>
              <SelectContent>{trains?.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.name ?? `Train ${t.train_number}`}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
        </div>

        {/* Online / Offline toggle — shown once a train is picked */}
        {train && (
          <div className={cn(
            'rounded-md border px-2.5 py-2 flex items-center gap-2.5 transition-colors',
            trainOnline
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
              : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
          )}>
            <Checkbox
              id="train-online"
              checked={trainOnline}
              onCheckedChange={(c) => {
                setTrainOnline(!!c);
                if (!!c) { setOfflineStart(''); setOfflineEnd(''); setOfflineReason(''); setOfflineReasonOther(''); }
              }}
              className={trainOnline ? 'data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600' : ''}
            />
            <div className="flex-1 min-w-0">
              <label htmlFor="train-online" className={cn(
                'text-sm font-semibold cursor-pointer select-none',
                trainOnline ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-400'
              )}>
                {trainOnline ? '● Online / Running' : '○ Offline / Not Running'}
              </label>
              {!trainOnline && (
                <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">
                  RO parameters locked until offline period is resolved or train comes back online
                </p>
              )}
            </div>
          </div>
        )}

        {/* Offline details — shown when train is marked offline */}
        {train && !trainOnline && (
          <div className="space-y-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">Offline Details</p>

            {/* Reason dropdown */}
            <div>
              <Label className="text-xs">Reason for Offline <span className="text-red-500">*</span></Label>
              <Select value={offlineReason} onValueChange={setOfflineReason}>
                <SelectTrigger className="h-9 mt-0.5 border-red-200 dark:border-red-700">
                  <SelectValue placeholder="Select reason…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Scheduled Maintenance">Scheduled Maintenance</SelectItem>
                  <SelectItem value="Membrane Replacement">Membrane Replacement</SelectItem>
                  <SelectItem value="CIP In Progress">CIP In Progress</SelectItem>
                  <SelectItem value="Power Outage">Power Outage</SelectItem>
                  <SelectItem value="High Pressure Trip">High Pressure Trip</SelectItem>
                  <SelectItem value="Low Feed Flow">Low Feed Flow</SelectItem>
                  <SelectItem value="Instrumentation Fault">Instrumentation Fault</SelectItem>
                  <SelectItem value="Pump Failure">Pump Failure</SelectItem>
                  <SelectItem value="Feedwater Quality Issue">Feedwater Quality Issue</SelectItem>
                  <SelectItem value="Operator Shutdown">Operator Shutdown</SelectItem>
                  <SelectItem value="Other">Other (specify below)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Free-text for Other */}
            {offlineReason === 'Other' && (
              <div>
                <Label className="text-xs">Specify reason <span className="text-red-500">*</span></Label>
                <Input
                  value={offlineReasonOther}
                  onChange={e => setOfflineReasonOther(e.target.value)}
                  placeholder="Describe the reason…"
                  className="mt-0.5 border-red-200 dark:border-red-700"
                />
              </div>
            )}

            {/* Offline start / end times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">
                  Offline Since <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="datetime-local"
                  value={offlineStart}
                  onChange={e => setOfflineStart(e.target.value)}
                  className="mt-0.5 w-full min-w-[200px] border-red-200 dark:border-red-700"
                />
              </div>
              <div>
                <Label className="text-xs">
                  Back Online At
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">(leave blank if still offline)</span>
                </Label>
                <Input
                  type="datetime-local"
                  value={offlineEnd}
                  onChange={e => setOfflineEnd(e.target.value)}
                  className="mt-0.5 w-full min-w-[200px] border-red-200 dark:border-red-700"
                />
              </div>
            </div>

            {/* Status banner */}
            {!offlineEnd && offlineStart && (
              <div className="flex items-center gap-2 text-[11px] text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 rounded px-2.5 py-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                Train is currently offline — RO parameters cannot be logged until it comes back online.
              </div>
            )}
            {offlineEnd && offlineStart && (
              <div className="flex items-center gap-2 text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded px-2.5 py-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                Offline period recorded — you may now log RO parameters for the resumed period.
              </div>
            )}
          </div>
        )}

        {!trainOnline ? null : (
        <div>
          <Label>Reading Date &amp; Time</Label>
          <Input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)}
            className="h-9 w-full sm:max-w-[240px] min-w-[200px]" />
        </div>
        )}
        {plant && (
          <div className="text-[11px] text-muted-foreground">
            Backwash mode: <span className="font-semibold">{isSynchronized ? 'Synchronized (Whole Train at Once)' : 'Independent (Per Unit)'}</span>
          </div>
        )}
      </Card>

      {train && (
        <>
          {/* ── Offline gate: lock all parameter inputs when train is offline with no end time ── */}
          {isOfflineBlocked && (
            <Card className="p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
              <div className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">🔒</span>
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Train is currently offline</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    No RO parameters can be logged while the train is offline and no "Back Online At" time has been entered.
                    Enter the time the train came back online above, or mark the train as Online to continue logging.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {!isOfflineBlocked && (
          <>
          {isSynchronized && (
            <Card className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="sync-bw" checked={syncBwOn} onCheckedChange={(c) => setSyncBwOn(!!c)} />
                <Label htmlFor="sync-bw" className="text-sm font-semibold cursor-pointer">Train Backwash Performed?</Label>
              </div>
              {syncBwOn && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Started</Label>
                      <Input type="datetime-local" value={syncBwStart} onChange={(e) => setSyncBwStart(e.target.value)} className="w-full min-w-[220px]" />
                    </div>
                    <div>
                      <Label className="text-xs">Ended</Label>
                      <Input type="datetime-local" value={syncBwEnd} onChange={(e) => setSyncBwEnd(e.target.value)} className="w-full min-w-[220px]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Meter Reading Start</Label>
                      <Input type="number" step="any" value={syncMeterStart}
                        onChange={(e) => setSyncMeterStart(e.target.value)}
                        placeholder="From Previous Backwash End" />
                    </div>
                    <div>
                      <Label className="text-xs">Meter Reading End</Label>
                      <Input type="number" step="any" value={syncMeterEnd} onChange={(e) => setSyncMeterEnd(e.target.value)} />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">All AFM/MMF Units Share These Values During Backwash. Start Value Pre-Filled From Previous Backwash End — Edit If Needed.</p>
                </>
              )}
            </Card>
          )}

          {train.num_afm > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">AFM/MMF Units ({train.num_afm})</h4>
              <div className="space-y-2">
                {Array.from({ length: train.num_afm }, (_, i) => i + 1).map((u) => {
                  const row = afmmf[u] ?? { unit: u, bw: false, bwStart: '', bwEnd: '', meterStart: '', meterEnd: '', pressureIn: '', pressureOut: '' };
                  const pIn = row.pressureIn ? +row.pressureIn : null;
                  const pOut = row.pressureOut ? +row.pressureOut : null;
                  const afmDp = pIn !== null && pOut !== null ? (pIn - pOut).toFixed(2) : '';
                  const dpWarn = afmDp && +afmDp >= 40;
                  // backwash ongoing? in synchronized mode it's the train-wide checkbox; in independent it's per-unit
                  const bwOngoing = isSynchronized ? syncBwOn : row.bw;
                  const prevEnd = prevMeterEndByUnit[u];
                  const meterStartValue = row.meterStart !== '' ? row.meterStart : (prevEnd != null ? String(prevEnd) : '');
                  return (
                    <div key={u} className="border rounded-md p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">AFM/MMF {u}</div>
                        {!isSynchronized && (
                          <div className="flex items-center gap-2">
                            <Checkbox id={`bw-${u}`} checked={row.bw} onCheckedChange={(c) => setAfmmfField(u, { bw: !!c })} />
                            <Label htmlFor={`bw-${u}`} className="text-xs cursor-pointer">Backwash On</Label>
                          </div>
                        )}
                      </div>

                      {bwOngoing ? (
                        // Backwash ongoing → show meter start/end (+ time for independent mode); pressure hidden
                        <div className="space-y-2 bg-muted/30 rounded p-2">
                          {!isSynchronized && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Started</Label>
                                <Input type="datetime-local" value={row.bwStart}
                                  onChange={(e) => setAfmmfField(u, { bwStart: e.target.value })}
                                  className="w-full min-w-[220px]" />
                              </div>
                              <div>
                                <Label className="text-xs">Ended</Label>
                                <Input type="datetime-local" value={row.bwEnd}
                                  onChange={(e) => setAfmmfField(u, { bwEnd: e.target.value })}
                                  className="w-full min-w-[220px]" />
                              </div>
                            </div>
                          )}
                          {isSynchronized ? (
                            <p className="text-[10px] text-muted-foreground">
                              Train-Wide Backwash {syncBwStart || '—'} → {syncBwEnd || '—'} · Meter {syncMeterStart || '—'} → {syncMeterEnd || '—'}
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Meter Reading Start</Label>
                                <Input type="number" step="any" value={meterStartValue}
                                  onChange={(e) => setAfmmfField(u, { meterStart: e.target.value })}
                                  placeholder={prevEnd != null ? String(prevEnd) : 'From Previous Backwash End'} />
                                {prevEnd != null && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">Previous End: {prevEnd} (Editable)</p>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs">Meter Reading End</Label>
                                <Input type="number" step="any" value={row.meterEnd}
                                  onChange={(e) => setAfmmfField(u, { meterEnd: e.target.value })} />
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        // No backwash → always-visible pressure In/Out (per unit)
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">Pressure In (psi)</Label>
                            <Input type="number" step="any" value={row.pressureIn}
                              onChange={(e) => setAfmmfField(u, { pressureIn: e.target.value })} />
                          </div>
                          <div>
                            <Label className="text-xs">Pressure Out (psi)</Label>
                            <Input type="number" step="any" value={row.pressureOut}
                              onChange={(e) => setAfmmfField(u, { pressureOut: e.target.value })} />
                          </div>
                          <div>
                            <Label className="text-xs">ΔPressure</Label>
                            <ComputedInput value={afmDp} className={dpWarn ? 'border-danger text-danger' : ''} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {train.num_booster_pumps > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Booster Pumps ({train.num_booster_pumps})</h4>
              {Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).map((u) => (
                <div key={u} className="grid grid-cols-3 gap-2 items-center">
                  <div className="text-xs font-medium self-center">Pump {u}</div>
                  <div>
                    <Label className="text-xs">Target Pressure (psi)</Label>
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
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">High-Pressure Pump</h4>
            <div>
              <Label className="text-xs">HPP Target Pressure (psi)</Label>
              <Input type="number" step="any" value={hppTarget} onChange={(e) => setHppTarget(e.target.value)} />
            </div>
          </Card>

          {train.num_filter_housings > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Filter Housings ({train.num_filter_housings})</h4>
              {Array.from({ length: train.num_filter_housings }, (_, i) => i + 1).map((u) => {
                const inP = +(housings[u]?.inP ?? '');
                const outP = +(housings[u]?.outP ?? '');
                const housingDp = housings[u]?.inP && housings[u]?.outP ? (inP - outP).toFixed(2) : '';
                return (
                  <div key={u} className="grid grid-cols-4 gap-2 items-center">
                    <div className="text-xs font-medium self-center">Housing {u}</div>
                    <div>
                      <Label className="text-xs">In (psi)</Label>
                      <Input type="number" step="any" value={housings[u]?.inP ?? ''}
                        onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { outP: '' }), inP: e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-xs">Out (psi)</Label>
                      <Input type="number" step="any" value={housings[u]?.outP ?? ''}
                        onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { inP: '' }), outP: e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-xs">ΔPressure</Label>
                      <ComputedInput value={housingDp} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2">
                <Label className="text-xs">Bag Filters Changed Today</Label>
                <Input type="number" min="0" value={bagsChanged} onChange={(e) => setBagsChanged(e.target.value)} />
              </div>
            </Card>
          )}

          {/* RO Vessel Section — tri-column process flow: Feed → Permeate → Reject */}
          <Card className="p-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">RO Vessel</h4>

            {/* Column headers */}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center gap-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-2 py-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">Feed / Raw</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Permeate / Product</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Reject / Concentrate</span>
              </div>
            </div>

            {/* ── Water Meter ─────────────────────────────────────────────── */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Water Meter</p>
                <p className="text-[10px] text-muted-foreground/60 italic">Leave one stream blank — it will be inferred</p>
              </div>
              {/* Auto-computed duration from datetime diff */}
              <div className="flex items-center gap-2 mb-1">
                <Label className="text-[11px] text-muted-foreground shrink-0">Duration (min)</Label>
                <ComputedInput
                  value={autoDurationMin != null ? String(autoDurationMin) : ''}
                  className="h-7 text-xs w-28"
                />
                {autoDurationMin == null && (
                  <span className="text-[10px] text-muted-foreground/60 italic">— no prior reading found</span>
                )}
              </div>
              {/* current / prev (auto) / Δ / flow columns */}
              <div className="grid grid-cols-3 gap-2">
                {/* Feed */}
                <div className="space-y-1">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Prev reading (auto)</Label>
                    <ComputedInput value={prevFeedMeter != null ? String(prevFeedMeter) : ''} />
                  </div>
                  <div><Label className="text-[11px] text-muted-foreground">Current reading</Label><Input type="number" step="any" {...f('feed_meter_curr')} /></div>
                  <div>
                    <Label className={cn('text-[11px]', feedInferred ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')}>
                      Δ Volume{feedInferred ? ' (inferred)' : ''} (m³)
                    </Label>
                    <ComputedInput value={feedVol != null ? String(feedVol) : ''} className={feedInferred ? 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : ''} />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Flow rate (m³/hr)</Label>
                    <ComputedInput value={feedFlowMeter ?? ''} />
                  </div>
                </div>
                {/* Permeate */}
                <div className="space-y-1">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Prev reading (auto)</Label>
                    <ComputedInput value={prevPermMeter != null ? String(prevPermMeter) : ''} />
                  </div>
                  <div><Label className="text-[11px] text-muted-foreground">Current reading</Label><Input type="number" step="any" {...f('permeate_meter_curr')} /></div>
                  <div>
                    <Label className={cn('text-[11px]', permInferred ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')}>
                      Δ Volume{permInferred ? ' (inferred)' : ''} (m³)
                    </Label>
                    <ComputedInput value={permVol != null ? String(permVol) : ''} className={permInferred ? 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : ''} />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Flow rate (m³/hr)</Label>
                    <ComputedInput value={permFlowMeter ?? ''} />
                  </div>
                </div>
                {/* Reject */}
                <div className="space-y-1">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Prev reading (auto)</Label>
                    <ComputedInput value={prevRejMeter != null ? String(prevRejMeter) : ''} />
                  </div>
                  <div><Label className="text-[11px] text-muted-foreground">Current reading</Label><Input type="number" step="any" {...f('reject_meter_curr')} /></div>
                  <div>
                    <Label className={cn('text-[11px]', rejInferred ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')}>
                      Δ Volume{rejInferred ? ' (inferred)' : ''} (m³)
                    </Label>
                    <ComputedInput value={rejVol != null ? String(rejVol) : ''} className={rejInferred ? 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : ''} />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Flow rate (m³/hr)</Label>
                    <ComputedInput value={rejFlowMeter ?? ''} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Pressure row ────────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Pressure (psi)</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Suction</Label>
                    <Input type="number" step="any" {...f('suction_pressure_psi')}
                      placeholder="Suction pressure" className="placeholder:text-[10px] placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Feed</Label>
                    <Input type="number" step="any" {...f('feed_pressure_psi')}
                      placeholder="Feed pressure" className="placeholder:text-[10px] placeholder:text-muted-foreground/50" />
                  </div>
                </div>
                <div className="flex flex-col justify-end">
                  <Label className="text-[11px] text-muted-foreground">ΔP (feed − reject)</Label>
                  <ComputedInput value={dp ?? ''} className={dpAlert ? 'border-danger text-danger font-semibold' : ''} />
                </div>
                <div className="flex flex-col justify-end">
                  <Label className="text-[11px] text-muted-foreground">Reject</Label>
                  <Input type="number" step="any" {...f('reject_pressure_psi')}
                    placeholder="Reject pressure" className="placeholder:text-[10px] placeholder:text-muted-foreground/50" />
                </div>
              </div>
            </div>

            {/* ── EM flow override ────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">
                Electromagnetic Flowmeter (m³/hr) <span className="normal-case font-normal">— enter direct reading if available; otherwise meter-derived rate is used</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Feed flow</Label>
                  <Input type="number" step="any" {...f('feed_flow')}
                    placeholder={feedFlowMeter != null ? `≈ ${feedFlowMeter} (meter)` : 'EM reading'} />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Permeate flow</Label>
                  <Input type="number" step="any" {...f('permeate_flow')}
                    placeholder={permFlowMeter != null ? `≈ ${permFlowMeter} (meter)` : 'EM reading'} />
                  <div className="mt-1.5">
                    <Label className="text-[11px] text-muted-foreground">Recovery %</Label>
                    <ComputedInput value={recovery ?? ''} className={recWarn ? 'border-warn text-warn-foreground' : ''} />
                  </div>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Reject flow</Label>
                  <Input type="number" step="any" {...f('reject_flow')}
                    placeholder={rejFlowMeter != null ? `≈ ${rejFlowMeter} (meter)` : 'EM or computed'} />
                  {rejectFlow !== null && !roValues.reject_flow && (
                    <div className="mt-1">
                      <ComputedInput value={`${rejectFlow} m³/hr`} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── TDS row ──────────────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">TDS (ppm)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-[11px] text-muted-foreground">Feed TDS</Label><Input type="number" step="any" {...f('feed_tds')} /></div>
                <div><Label className="text-[11px] text-muted-foreground">Permeate TDS</Label><Input type="number" step="any" {...f('permeate_tds')} /></div>
                <div><Label className="text-[11px] text-muted-foreground">Reject TDS</Label><Input type="number" step="any" {...f('reject_tds')} /></div>
              </div>
              {/* Rejection + Salt Passage in their own row below TDS inputs */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Rejection %</Label>
                  <ComputedInput value={rejection ?? ''} />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Salt Passage %</Label>
                  <ComputedInput value={saltPassage ?? ''} />
                </div>
              </div>
            </div>

            {/* ── pH row ───────────────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">pH</p>
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-[11px] text-muted-foreground">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} /></div>
                <div><Label className="text-[11px] text-muted-foreground">Permeate pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} /></div>
                <div><Label className="text-[11px] text-muted-foreground">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} /></div>
              </div>
            </div>

            {/* ── Product quality / ambient ────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Product Quality</p>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[11px] text-muted-foreground">Product Turbidity (NTU)</Label><Input type="number" step="any" {...f('turbidity_ntu')} /></div>
                <div><Label className="text-[11px] text-muted-foreground">Product Temperature (°C)</Label><Input type="number" step="any" {...f('temperature_c')} /></div>
              </div>
            </div>
          </Card>

          {/* ── Power Meter ──────────────────────────────────────────────────── */}
          <Card className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Power Meter</h4>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <span>Duration:</span>
                <span className="font-mono font-medium">{autoDurationMin != null ? `${autoDurationMin} min` : '—'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Prev reading (kWh) — auto</Label>
                <ComputedInput value={prevPowerMeter != null ? String(prevPowerMeter) : ''} />
              </div>
              <div><Label className="text-[11px] text-muted-foreground">Current reading (kWh)</Label><Input type="number" step="any" {...f('power_meter_curr')} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Δ Consumption (kWh)</Label>
                <ComputedInput value={pwrDelta ?? ''} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Avg power (kW)</Label>
                <ComputedInput value={pwrKw ?? ''} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Specific energy (kWh/m³)</Label>
                <ComputedInput value={secEnergy ?? ''} />
              </div>
            </div>
          </Card>

          <Card className="p-3 space-y-2">
            <Label className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any observations..." />
          </Card>

          <Button onClick={submit} className="w-full h-12 text-base">Save Pre-Treatment & RO Reading</Button>
          </>
          )}
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
          <div className="col-span-2 sm:col-span-1">
            <Label>Start Date &amp; Time</Label>
            <Input
              type="datetime-local"
              value={v.start}
              onChange={e => setV({ ...v, start: e.target.value })}
              className="w-full sm:min-w-[220px]"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label>End Date &amp; Time</Label>
            <Input
              type="datetime-local"
              value={v.end}
              onChange={e => setV({ ...v, end: e.target.value })}
              className="w-full sm:min-w-[220px]"
            />
          </div>
          <div><Label>SLS (g)</Label><Input type="number" step="any" value={v.sls} onChange={e => setV({ ...v, sls: e.target.value })} /></div>
          <div><Label>HCl (L)</Label><Input type="number" step="any" value={v.hcl} onChange={e => setV({ ...v, hcl: e.target.value })} /></div>
          <div className="col-span-2"><Label>Caustic Soda (kg)</Label><Input type="number" step="any" value={v.caustic} onChange={e => setV({ ...v, caustic: e.target.value })} /></div>
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
