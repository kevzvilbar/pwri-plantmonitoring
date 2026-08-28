import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { usePlantMeterConfig } from '../../plants/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { calc, ALERTS } from '@/lib/calculations';
import { evaluateROMeterSpike, computeROAverageFlowRate } from '@/lib/roReadingGuards';
import { getHourBucket } from '@/lib/hourlyReadingGuard';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ComputedInput } from '@/components/ComputedInput';
import { ExportButton } from '@/components/ExportButton';
import { Upload, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { RawWaterIcon, PermeateIcon, RejectIcon } from '@/components/icons/water-icons';
import { cn } from '@/lib/utils';
import { ImportROReadingsDialog } from '../../ro-trains';

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

export function PretreatmentAndROLog() {
  const qc = useQueryClient();
  // ── Use activeOperator, not user ──────────────────────────────────────────
  // On shared-email accounts (e.g. resourcespilipinaswater@gmail.com) user.id
  // is always the auth-owner (Reynan). activeOperator reflects whoever was
  // selected on the operator-picker screen or switched via OperatorSwitcher.
  const { activeOperator, isManager } = useAuth();
  const [showImport, setShowImport] = useState(false);
  const { selectedPlantId, addAlerts } = useAppStore();
  const { data: plants } = usePlants();

  // Persist plant + train selection across tab switches / browser-focus changes
  const [plantId, setPlantIdState] = useState<string>(() => {
    try { return sessionStorage.getItem('pretreat:plantId') ?? ''; } catch { return ''; }
  });
  const setPlantId = (v: string) => {
    try { sessionStorage.setItem('pretreat:plantId', v); } catch { /* ignore */ }
    setPlantIdState(v);
  };
  const [trainId, setTrainIdState] = useState<string>(() => {
    try { return sessionStorage.getItem('pretreat:trainId') ?? ''; } catch { return ''; }
  });
  const setTrainId = (v: string) => {
    try { sessionStorage.setItem('pretreat:trainId', v); } catch { /* ignore */ }
    setTrainIdState(v);
  };

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
  // One remark per meter — required whenever that meter's flow rate falls
  // outside ±50% of its own 10-day average (see flowRateGuards.ts). A single
  // save can flag more than one of the three meters at once, so these are
  // independent, not one shared field the way the other odometer pages need.
  const [anomalyRemarkFeed, setAnomalyRemarkFeed] = useState('');
  const [anomalyRemarkPerm, setAnomalyRemarkPerm] = useState('');
  const [anomalyRemarkRej, setAnomalyRemarkRej] = useState('');

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
    chlorine_residual_mg_l: '',
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

  // ── Deep-link from an alert/notification: /ro-trains?tab=pretreat-ro&plant=<id>&train=<id> ──
  // Takes priority over both sessionStorage and selectedPlantId — clicking an
  // alert for Train 3 should land on Train 3 even if this tab was last left
  // on a different train. Runs once per navigation (the params are stripped
  // from the URL right after, via replace) so it doesn't fight the operator
  // if they then manually pick a different plant/train.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const deepPlant = searchParams.get('plant');
    const deepTrain = searchParams.get('train');
    if (!deepPlant && !deepTrain) return;
    if (deepPlant) setPlantId(deepPlant);
    if (deepTrain) setTrainId(deepTrain);
    const sp = new URLSearchParams(searchParams);
    sp.delete('plant'); sp.delete('train');
    setSearchParams(sp, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const plant = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const isSynchronized = (plant as any)?.backwash_mode === 'synchronized';

  // ── Meter configuration — controls which inputs are shown to operators ──────
  // Reads from plant_meter_config (set by managers in Plants → Trains tab).
  // Safe defaults keep all fields visible if config not yet saved (backwards compat).
  // Pass selectedPlantId as a fallback so usePlantMeterConfig always receives a
  // non-null value on the first render (before the auto-select effect fires).
  // Without this, the hook would be called with null → then a real ID → causing
  // React error #300 if the hook has conditional logic keyed on the null check.
  const { config: meterCfg } = usePlantMeterConfig(plantId || selectedPlantId || null);
  const showPermeateMeter  = meterCfg.ro_has_permeate_meter;
  const showRejectMeter    = meterCfg.ro_has_reject_meter;
  const showPowerMeter     = meterCfg.ro_has_per_train_electricity;
  const productionLabel    = meterCfg.ro_production_source === 'permeate' ? 'Permeate / Production' : 'Permeate / Product';

  // Plant-wide filter housing type — drives labels & which section counts to show.
  // Falls back to per-train override if set, then plant-wide, then default.
  const plantFilterHousingType: 'Cartridge Filter' | 'Bag Filter' =
    (plant as any)?.filter_housing_type ?? 'Cartridge Filter';
  // Label for the cartridge / bag filter housing section
  const cartridgeHousingLabel =
    plantFilterHousingType === 'Bag Filter' ? 'Filter Housing (Pre-filter)' : 'Cartridge Housing (Pre-filter)';
  // Label for changed-element count (bag = "Bag Filters", cartridge = "Cartridges")
  const changedElementLabel =
    plantFilterHousingType === 'Bag Filter' ? 'Bag Filters Changed Today' : 'Cartridges Changed Today';

  const { data: trains } = useQuery({
    queryKey: ['pretreat-trains', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId).order('train_number')).data ?? []
      : [],
    enabled: !!plantId,
  });
  const train = useMemo(() => trains?.find((t: any) => t.id === trainId), [trains, trainId]);
  const isSecondaryTrain = (train as any)?.unit_type === 'secondary';
  const showFeedMeter    = !isSecondaryTrain && meterCfg.ro_has_feed_meter;

  // Auto-fill from the train's configured setpoint (Train Settings ->
  // EditTrainDialog) whenever the selected train changes or that value
  // loads. When it's set, the field below renders read-only, so there's no
  // "don't clobber what the user typed" concern the way syncMeterStart's
  // effect further down has to guard against — if it's configured, the user
  // was never able to type into this field in the first place.
  useEffect(() => {
    setHppTarget(train?.hpp_target_pressure_psi != null ? String(train.hpp_target_pressure_psi) : '');
  }, [train?.id, train?.hpp_target_pressure_psi]);

  // Parsed booster pump target config from Train Settings — same JSONB shape
  // 20260807_ro_trains_booster_pump_targets.sql and TrainDetail.tsx's
  // EditTrainDialog both use: { psi_mode: bool, targets: { "<unit>": number } }.
  const boosterConfig = useMemo(() => {
    const raw = train?.booster_pump_targets as any;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { psiMode: raw.psi_mode !== false, targets: (raw.targets ?? {}) as Record<string, number> };
    }
    return null;
  }, [train?.booster_pump_targets]);

  // Auto-fill configured pump targets whenever the selected train changes or
  // its config loads. Amp is deliberately left untouched here — it's a
  // per-reading measurement, not something a config value should ever
  // pre-fill. Same "no clobbering user input" non-concern as the HPP field
  // above: a pump with a configured target renders read-only below, so the
  // user was never able to type into it.
  useEffect(() => {
    if (!boosterConfig) return;
    setBoosters(prev => {
      const next = { ...prev };
      for (const [unitStr, value] of Object.entries(boosterConfig.targets)) {
        const u = Number(unitStr);
        const existing = next[u] || { hz: '', target: '', amp: '', psiMode: boosterConfig.psiMode };
        next[u] = {
          ...existing,
          psiMode: boosterConfig.psiMode,
          target: boosterConfig.psiMode ? String(value) : existing.target,
          hz: !boosterConfig.psiMode ? String(value) : existing.hz,
        };
      }
      return next;
    });
  }, [train?.id, boosterConfig]);

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

  // Pull the most recent RO train reading to auto-fill prev meter readings + duration.
  // Also fetches power_meter_curr (stored as power_meter_reading_kwh) so the delta can compute.
  const { data: prevRO } = useQuery({
    queryKey: ['ro-prev', trainId],
    enabled: !!trainId,
    queryFn: async () => (await supabase.from('ro_train_readings')
      .select('reading_datetime, power_meter_reading_kwh, feed_meter, permeate_meter, feed_meter_delta, permeate_meter_delta, reject_meter, reject_meter_delta')
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: false }).limit(1)).data?.[0] ?? null,
  });

  // 10-day rolling average flow rate (m³/hr) per meter — see
  // roReadingGuards.ts / flowRateGuards.ts. Replaces comparing this
  // reading's delta against only the single prior reading's delta: a rolling
  // average absorbs one unusually low or high prior reading instead of
  // anchoring the "is this a spike" check entirely on it.
  const { data: roHistory } = useQuery({
    queryKey: ['ro-history-10d', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 10);
      const { data } = await supabase.from('ro_train_readings')
        .select('reading_datetime, feed_meter, permeate_meter, reject_meter')
        .eq('train_id', trainId)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: true });
      return data ?? [];
    },
  });
  const avgFeedFlowRate = useMemo(() => computeROAverageFlowRate(
    (roHistory ?? []).filter((r: any) => r.feed_meter != null)
      .map((r: any) => ({ value: r.feed_meter, at: new Date(r.reading_datetime) })),
  ), [roHistory]);
  const avgPermFlowRate = useMemo(() => computeROAverageFlowRate(
    (roHistory ?? []).filter((r: any) => r.permeate_meter != null)
      .map((r: any) => ({ value: r.permeate_meter, at: new Date(r.reading_datetime) })),
  ), [roHistory]);
  const avgRejFlowRate = useMemo(() => computeROAverageFlowRate(
    (roHistory ?? []).filter((r: any) => r.reject_meter != null)
      .map((r: any) => ({ value: r.reject_meter, at: new Date(r.reading_datetime) })),
  ), [roHistory]);

  // Fetch sibling trains in the same shared power meter group (if any).
  // Used to warn the operator and to do volume-weighted kWh allocation on save.
  const sharedPowerGroup: string | null = (train as any)?.shared_power_meter_group ?? null;
  const { data: siblingTrains } = useQuery({
    queryKey: ['ro-power-siblings', plantId, sharedPowerGroup],
    enabled: !!plantId && !!sharedPowerGroup,
    queryFn: async () => {
      const { data } = await supabase
        .from('ro_trains')
        .select('id, train_number, name')
        .eq('plant_id', plantId)
        .eq('shared_power_meter_group', sharedPowerGroup!)
        .neq('id', trainId)
        .order('train_number');
      return (data ?? []) as any[];
    },
  });
  const isSharedPowerMeter = !!sharedPowerGroup;

  // Auto-compute duration (min) between current reading datetime and last reading datetime
  const autoDurationMin = useMemo(() => {
    if (!prevRO?.reading_datetime || !dt) return null;
    const diff = (new Date(dt).getTime() - new Date(prevRO.reading_datetime).getTime()) / 60000;
    return diff > 0 ? +diff.toFixed(1) : null;
  }, [prevRO, dt]);

  // Previous meter readings: feed is local-only (operator enters manually).
  // Permeate, reject, and power are persisted as odometer snapshots so the next
  // session auto-fills "previous reading" and delta computes without manual re-entry.
  // BUG FIX: prevRejMeter was hardcoded null — now reads from last saved DB row,
  // matching the same pattern as prevPermMeter and prevPowerMeter.
  const prevFeedMeter:  number | null = prevRO?.feed_meter    ?? null;
  const prevPermMeter: number | null = prevRO?.permeate_meter ?? null;
  const prevRejMeter:  number | null = prevRO?.reject_meter   ?? null;
  const prevPowerMeter: number | null = prevRO?.power_meter_reading_kwh ?? null;

  // ── Section-step gating: AFM/MMF must be opened before Booster Pumps ────────
  // Operators must interact with (not necessarily complete) AFM/MMF before they
  // can access Booster Pumps, and Booster Pumps before the rest of the form.
  // Both flags reset each time a new train is selected.
  const [afmSectionStarted, setAfmSectionStarted] = useState(false);
  const [boosterHppSectionStarted, setBoosterHppSectionStarted] = useState(false);
  const [cartridgeSectionStarted, setCartridgeSectionStarted] = useState(false);

  // ── In-flight save guard ─────────────────────────────────────────────────
  // Prevents a fast double-tap (or a slow network making the operator tap
  // "Save" again) from firing submit() twice concurrently, which previously
  // could insert duplicate/blank ro_train_readings + ro_pretreatment_readings
  // rows. submit() sets this true immediately and the Save button is
  // disabled while it's true — see submit() and the Save button below.
  const [isSaving, setIsSaving] = useState(false);

  // ── Missing-value override notes ─────────────────────────────────────────
  // Every field in each section is now required to proceed/save (previously
  // only a majority was required). When an operator genuinely cannot supply
  // a value (broken meter, sensor out for calibration, instrument not yet
  // installed, etc.) they may proceed anyway by entering a reason. The
  // reason input only appears after a blocked attempt (keeps the common
  // fully-filled case uncluttered) and is persisted with the reading so
  // it's auditable later — see `incomplete_reason` on both tables.
  const [afmReasonNeeded, setAfmReasonNeeded] = useState(false);
  const [afmIncompleteReason, setAfmIncompleteReason] = useState('');
  const [boosterReasonNeeded, setBoosterReasonNeeded] = useState(false);
  const [boosterIncompleteReason, setBoosterIncompleteReason] = useState('');
  const [housingReasonNeeded, setHousingReasonNeeded] = useState(false);
  const [housingIncompleteReason, setHousingIncompleteReason] = useState('');
  const [roReasonNeeded, setRoReasonNeeded] = useState(false);
  const [roIncompleteReason, setRoIncompleteReason] = useState('');

  // Per-AFM/MMF rows: independent backwash + reading + pressure
  const [afmmf, setAfmmf] = useState<Record<number, AfmRow>>({});
  const [boosters, setBoosters] = useState<Record<number, { hz: string; target: string; amp: string; psiMode: boolean }>>({});

  // Persisted psi/Hz mode preference — survives page reloads and re-opens.
  // Defaults to psi (true) on first visit; saved any time the user taps the toggle.
  const BOOSTER_MODE_KEY = 'pwri_booster_target_psi_mode';
  const [boosterPrefPsi, setBoosterPrefPsi] = useState<boolean>(() => {
    try { return localStorage.getItem(BOOSTER_MODE_KEY) !== 'false'; } catch { return true; }
  });
  const [housings, setHousings] = useState<Record<number, { inP: string; outP: string }>>({});
  // Cartridge / Bag Filter Housing (pre-filter) — driven by train.num_cartridge_filters.
  // Label comes from plant.filter_housing_type: 'Cartridge Filter' | 'Bag Filter'.
  const [cartridgeHousings, setCartridgeHousings] = useState<Record<number, { inP: string; outP: string }>>({});

  useEffect(() => {
    // Reset datetime to NOW each time the operator picks a different train.
    // Without this, dt stays frozen at page-load time, making the auto-computed
    // duration (now - lastReading) wrong when the page has been open a long time.
    setDt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setAfmSectionStarted(false); setBoosterHppSectionStarted(false); setCartridgeSectionStarted(false);
    setAfmReasonNeeded(false); setAfmIncompleteReason('');
    setBoosterReasonNeeded(false); setBoosterIncompleteReason('');
    setHousingReasonNeeded(false); setHousingIncompleteReason('');
    setRoReasonNeeded(false); setRoIncompleteReason('');
    setAfmmf({}); setBoosters({}); setHousings({}); setCartridgeHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setSyncMeterStart(''); setSyncMeterEnd('');

    // ── Restore offline state from sessionStorage for this train ─────────────
    // If the operator previously marked this train offline (with a reason and
    // start date) but hasn't entered an end time yet, those fields are persisted
    // in sessionStorage so they survive train-switching and page focus changes.
    // Only cleared when the offline period is formally resolved (offlineEnd saved).
    let restoredOffline = false;
    if (trainId) {
      try {
        const stored = sessionStorage.getItem(`pretreat:offline:${trainId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setTrainOnline(false);
          setOfflineStart(parsed.offlineStart ?? '');
          setOfflineReason(parsed.offlineReason ?? '');
          setOfflineReasonOther(parsed.offlineReasonOther ?? '');
          setOfflineEnd('');
          restoredOffline = true;
        }
      } catch { /* ignore storage errors */ }
    }
    if (!restoredOffline) {
      setTrainOnline(true); setOfflineStart(''); setOfflineEnd('');
      setOfflineReason(''); setOfflineReasonOther('');
    }

    setRoValues({
      feed_pressure_psi: '', reject_pressure_psi: '',
      feed_flow: '', permeate_flow: '', reject_flow: '',
      feed_tds: '', permeate_tds: '', reject_tds: '',
      feed_ph: '', permeate_ph: '', reject_ph: '',
      turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
      chlorine_residual_mg_l: '',
      feed_meter_curr: '',
      permeate_meter_curr: '',
      reject_meter_curr: '',
      power_meter_curr: '',
    });
  }, [trainId]);

  // ── Persist offline state to sessionStorage so it survives train-switching ──
  // Written any time the operator is in offline mode with a start date / reason.
  // The entry is keyed by trainId so multiple trains can each have their own
  // pending offline period stored simultaneously.
  useEffect(() => {
    if (!trainId) return;
    if (!trainOnline && offlineStart) {
      try {
        sessionStorage.setItem(
          `pretreat:offline:${trainId}`,
          JSON.stringify({ offlineStart, offlineReason, offlineReasonOther }),
        );
      } catch { /* ignore storage errors */ }
    }
  }, [trainId, trainOnline, offlineStart, offlineReason, offlineReasonOther]);

  // ── DB-status awareness — clear stale sessionStorage when train is back online ─
  // When the train record loads and the DB status is 'Running' or 'Maintenance',
  // any sessionStorage offline entry for this train is stale (the offline period
  // was resolved by a previous submission). Clear it and force the form online so
  // the operator isn't stuck seeing an old "Membrane Replacement / 01/01/2026"
  // entry for a train that is clearly running.
  //
  // Conversely, if the DB status IS 'Offline', we do NOT auto-lock the form —
  // that was the original bug. The sessionStorage restore (above, in trainId
  // useEffect) handles in-progress offline periods. A warning banner is shown
  // in the JSX below so the operator knows the train was last recorded offline.
  useEffect(() => {
    if (!train || !trainId) return;
    if (train.status !== 'Offline') {
      // Train is Running or Maintenance in the DB — any cached offline state is stale.
      try { sessionStorage.removeItem(`pretreat:offline:${trainId}`); } catch { /* ignore */ }
      setTrainOnline(true);
      setOfflineStart(''); setOfflineEnd('');
      setOfflineReason(''); setOfflineReasonOther('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [train?.id, train?.status]);

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

  // ── Water meter reading warnings ─────────────────────────────────────────
  // evaluateROMeterSpike (roReadingGuards.ts) is the same function the
  // Dashboard alert scan uses on rows already saved to the DB — using it
  // here too means a reading flagged at save-time and one flagged later by
  // the Dashboard scan (e.g. from a CSV import, which has no client guard)
  // agree on the exact same definition of "spike". mDurHr (elapsed hours,
  // already computed above for the flow-rate display) and the 10-day
  // rolling averages (avgFeedFlowRate/avgPermFlowRate/avgRejFlowRate,
  // fetched above) replace the old "vs. the single prior reading's delta"
  // comparison — see roReadingGuards.ts header for why.
  // Negative: current reading is below the previous odometer snapshot → rollback or typo.
  const feedNegWarn  = prevFeedMeter != null && !isNaN(feedCurr) && feedCurr < prevFeedMeter;
  const permNegWarn  = prevPermMeter != null && !isNaN(permCurr) && permCurr < prevPermMeter;
  const rejNegWarn   = prevRejMeter  != null && !isNaN(rejCurr)  && rejCurr  < prevRejMeter;
  const feedSpike = evaluateROMeterSpike('feed',     feedDelta, mDurHr, avgFeedFlowRate);
  const permSpike = evaluateROMeterSpike('permeate', permDelta, mDurHr, avgPermFlowRate);
  const rejSpike  = evaluateROMeterSpike('reject',   rejDelta,  mDurHr, avgRejFlowRate);
  // 'critical' preserves the exact old isSpike/highWarn meaning: beyond
  // ALERTS.ro_meter_spike_multiplier → auto pending_review on save (below).
  const feedHighWarn = !feedNegWarn && feedSpike.tier === 'critical';
  const permHighWarn = !permNegWarn && permSpike.tier === 'critical';
  const rejHighWarn  = !rejNegWarn  && rejSpike.tier === 'critical';
  // New, broader ±50% band — requires an operator remark before Save, but
  // doesn't by itself force pending_review (that's still 'critical' above).
  const feedNeedsRemark = !feedNegWarn && feedSpike.tier !== 'ok';
  const permNeedsRemark = !permNegWarn && permSpike.tier !== 'ok';
  const rejNeedsRemark  = !rejNegWarn  && rejSpike.tier !== 'ok';
  const anyNeedsRemark = feedNeedsRemark || permNeedsRemark || rejNeedsRemark;
  // Blocks Save until every flagged meter has its own remark filled in.
  const anomalyRemarksMissing =
    (feedNeedsRemark && !isAnomalyRemarkValid(anomalyRemarkFeed)) ||
    (permNeedsRemark && !isAnomalyRemarkValid(anomalyRemarkPerm)) ||
    (rejNeedsRemark  && !isAnomalyRemarkValid(anomalyRemarkRej));
  // True if ANY of the three meters look like a mis-key — gates the
  // pending_review flag + confirmation on save, below.
  const anyMeterSpike = feedHighWarn || permHighWarn || rejHighWarn;

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

  // ── Effective flow values: EM 3-way inference ──────────────────────────
  // Enter any 2 EM values → third is auto-computed. Enter all 3 to override.
  const emFeedFlow  = roValues.feed_flow     ? num(roValues.feed_flow)     : null;
  const emPermFlow  = roValues.permeate_flow ? num(roValues.permeate_flow) : null;
  const emRejFlow   = roValues.reject_flow   ? num(roValues.reject_flow)   : null;

  const emEntered = [emFeedFlow, emPermFlow, emRejFlow].filter(v => v !== null).length;

  // Infer the missing EM value when exactly 2 are entered
  const effFeedFlow: number | null = (() => {
    if (emFeedFlow !== null) return emFeedFlow;
    if (emEntered === 2 && emPermFlow !== null && emRejFlow !== null)
      return +((emPermFlow + emRejFlow).toFixed(2));
    return feedFlowMeter;
  })();
  const effPermFlow: number | null = (() => {
    if (emPermFlow !== null) return emPermFlow;
    if (emEntered === 2 && emFeedFlow !== null && emRejFlow !== null)
      return +((emFeedFlow - emRejFlow).toFixed(2));
    return permFlowMeter;
  })();
  const effRejFlow: number | null = (() => {
    if (emRejFlow !== null) return emRejFlow;
    if (emEntered === 2 && emFeedFlow !== null && emPermFlow !== null)
      return +((emFeedFlow - emPermFlow).toFixed(2));
    // BUG FIX #2: Only fall back to meter-derived values when NEITHER EM feed
    // nor EM permeate is entered (emEntered < 2). Mixing one EM value with one
    // meter-derived value (emEntered === 1) produces a reject figure from two
    // incompatible measurement sources and should be avoided.
    if (emEntered === 0) {
      if (feedFlowMeter !== null && permFlowMeter !== null)
        return +((feedFlowMeter - permFlowMeter).toFixed(2));
      return rejFlowMeter;
    }
    return rejFlowMeter;
  })();

  // Inferred flags (not user-typed, computed from the other two)
  // Also mark as inferred when the meter is disabled in plant config (always auto-computed).
  const emFeedInferred = !showFeedMeter || (emFeedFlow === null && emEntered === 2 && emPermFlow !== null && emRejFlow !== null);
  const emPermInferred = emPermFlow === null && emEntered === 2 && emFeedFlow !== null && emRejFlow !== null;
  // BUG FIX #3: was `emEntered >= 1` — that fired whenever ANY single EM value was
  // entered, even though reject is only properly inferred when exactly 2 EM values
  // are present (the 2-of-3 rule). Changed to `emEntered === 2`.
  const emRejInferred  = !showRejectMeter || (emRejFlow  === null && emEntered === 2 && effRejFlow !== null && !(emFeedFlow === null && emPermFlow === null));

  // Recovery uses effective flows (EM > meter-derived)
  // BUG FIX #4: Clamp to [0, 100] — a negative inferred permVol (e.g. operator typo
  // where permeate > feed) previously produced a negative recovery_pct written to DB.
  const recovery    = effPermFlow !== null && effFeedFlow !== null && effFeedFlow > 0
    ? +Math.min(100, Math.max(0, (effPermFlow / effFeedFlow) * 100)).toFixed(1) : null;
  // Salt Rejection = ((Feed TDS - Permeate TDS) / Feed TDS) x 100%
  const feedTds = num(roValues.feed_tds);
  const permTds = num(roValues.permeate_tds);
  const rejection   = feedTds != null && feedTds > 0 && permTds != null
    ? +( ((feedTds - permTds) / feedTds) * 100 ).toFixed(2) : null;
  // Salt Passage = (Permeate TDS / Feed TDS) x 100%
  const saltPassage = feedTds != null && feedTds > 0 && permTds != null
    ? +( (permTds / feedTds) * 100 ).toFixed(2) : null;
  const rejectFlow  = effRejFlow;

  const phWarn = num(roValues.permeate_ph) && (num(roValues.permeate_ph) < 6.5 || num(roValues.permeate_ph) > 8.5);
  const recWarn = recovery != null && (recovery < 65 || recovery > 75);
  const dpAlert = dp != null && dp >= ALERTS.dp_max;

  // Train is offline → block all RO parameter inputs until the offline period is
  // formally resolved by saving a record with a valid end time. Entering an end
  // time alone is NOT enough — the form stays locked until submit() succeeds and
  // calls setTrainOnline(true). This enforces "Once saved, Online view is available."
  const isOfflineBlocked = !trainOnline;
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
  // BUG FIX #5: `permVol && permVol > 0` relied on falsy coercion of null/0.
  // Explicit `permVol !== null && permVol > 0` is unambiguous and safe to refactor around.
  const secEnergy = pwrDelta !== null && permVol !== null && permVol > 0          // kWh/m³
    ? +(pwrDelta / permVol).toFixed(3) : null;

  const submit = async () => {
    // Re-entrancy guard: ignore a second call while the first is still
    // in-flight (double-tap, slow network + impatient re-tap, etc.).
    if (isSaving) return;
    if (!plantId || !trainId) { toast.error('Select plant and train'); return; }
    if (anomalyRemarksMissing) {
      toast.error('One or more meters are outside the normal range — add a remark for each before saving.');
      return;
    }
    setIsSaving(true);
    try {

    // ── Completeness guard (online trains only) ───────────────────────────────
    // Every key measurement field must be filled before saving. Two families of
    // fields are deliberately exempt from the 100% rule because the form is
    // built to auto-infer them from the other two in the set:
    //   • EM flow trio (feed/permeate/reject flow) — enter any 2 of 3.
    //   • Water-meter trio (feed/permeate/reject meter), among only the meters
    //     this plant actually has installed — leave at most one blank.
    // Anything still missing after that can only be saved by entering a reason
    // (roIncompleteReason, below) so the gap is deliberate and auditable rather
    // than silently blocked or silently faked with a junk value.
    // Offline records are exempt entirely: they only require offline reason + start time.
    if (trainOnline) {
      const directRequired: { label: string; value: string }[] = [
        { label: 'Feed TDS', value: roValues.feed_tds },
        { label: 'Permeate TDS', value: roValues.permeate_tds },
        { label: 'Reject TDS', value: roValues.reject_tds },
        { label: 'Feed pH', value: roValues.feed_ph },
        { label: 'Permeate pH', value: roValues.permeate_ph },
        { label: 'Reject pH', value: roValues.reject_ph },
        { label: 'Feed Pressure', value: roValues.feed_pressure_psi },
        { label: 'Reject Pressure', value: roValues.reject_pressure_psi },
        { label: 'Suction Pressure', value: roValues.suction_pressure_psi },
        { label: 'Product Temperature', value: roValues.temperature_c },
        { label: 'Product Turbidity', value: roValues.turbidity_ntu },
      ];
      const missingDirect = directRequired.filter((f) => f.value === '' || f.value == null);

      // EM flow trio — need at least 2 of 3 for the third to auto-compute.
      const emFilled = [roValues.feed_flow, roValues.permeate_flow, roValues.reject_flow]
        .filter((v) => v !== '' && v != null).length;
      const emIncomplete = emFilled < 2;

      // Water-meter trio — require all-but-one of the meters this plant has configured.
      const configuredMeters = [
        showFeedMeter     ? roValues.feed_meter_curr     : undefined,
        showPermeateMeter ? roValues.permeate_meter_curr : undefined,
        showRejectMeter   ? roValues.reject_meter_curr   : undefined,
      ].filter((v) => v !== undefined) as string[];
      const meterFilled = configuredMeters.filter((v) => v !== '' && v != null).length;
      const meterMinRequired = Math.max(0, configuredMeters.length - 1);
      const meterIncomplete = configuredMeters.length > 0 && meterFilled < meterMinRequired;

      if ((missingDirect.length > 0 || emIncomplete || meterIncomplete) && !roIncompleteReason.trim()) {
        setRoReasonNeeded(true);
        const parts = [
          ...missingDirect.map((f) => f.label),
          ...(emIncomplete ? ['Feed/Permeate/Reject Flow (need at least 2 of 3)'] : []),
          ...(meterIncomplete ? ['Water Meter reading(s)'] : []),
        ];
        toast.error(`Missing: ${parts.join(', ')}. Fill these in, or enter a reason below to proceed with missing values.`);
        return;
      }
    }

    // Offline validation
    if (!trainOnline) {
      if (!offlineStart) { toast.error('Please enter the time the train went offline.'); return; }
      if (!offlineReason) { toast.error('Please select a reason for the offline event.'); return; }
      if (offlineReason === 'Other' && !offlineReasonOther.trim()) { toast.error('Please specify the reason for offline.'); return; }
      // End time (if provided) must be in the past — can't mark a train as back online in the future
      if (offlineEnd && new Date(offlineEnd) > new Date()) {
        toast.error('"Back Online At" must be in the past. The train cannot come back online at a future time.');
        return;
      }
    }

    // ── Hourly cadence guard ───────────────────────────────────────────────
    // Plant policy: exactly one RO Train reading and one Pre-Treatment
    // reading per train per calendar hour — one entry somewhere in
    // 6:00–6:59, another in 7:00–7:59, and so on, regardless of the exact
    // minute it's keyed in at. (A 1-hour-per-train duplicate rule used to
    // live here and was later removed to let operators log multiple
    // readings per hour — this restores the stricter one-per-hour cadence.)
    // Checked against both tables up front, before either insert runs, since
    // this form always writes both from the same `dt` — if either table
    // already has an entry for this hour the whole save is rejected, so the
    // operator edits the existing entry (via the train's History tab)
    // instead of ending up with a half-saved, mismatched pair.
    const hourBucket = getHourBucket(dt);
    const trainLabel = train?.name ?? `Train ${train?.train_number ?? ''}`;

    const { data: existingROHour, error: roHourError } = await supabase
      .from('ro_train_readings')
      .select('id')
      .eq('train_id', trainId)
      .gte('reading_datetime', hourBucket.startISO)
      .lt('reading_datetime', hourBucket.endISO)
      .limit(1);
    if (roHourError) { toast.error(friendlyError(roHourError)); return; }
    if (existingROHour && existingROHour.length > 0) {
      toast.error(
        `${trainLabel} already has an RO Train reading between ${hourBucket.label}. ` +
        `Only one reading is allowed per hour — edit the existing entry, or change the reading time.`,
      );
      return;
    }

    const { data: existingPretreatHour, error: pretreatHourError } = await supabase
      .from('ro_pretreatment_readings')
      .select('id')
      .eq('train_id', trainId)
      .gte('reading_datetime', hourBucket.startISO)
      .lt('reading_datetime', hourBucket.endISO)
      .limit(1);
    if (pretreatHourError) { toast.error(friendlyError(pretreatHourError)); return; }
    if (existingPretreatHour && existingPretreatHour.length > 0) {
      toast.error(
        `${trainLabel} already has a Pre-Treatment reading between ${hourBucket.label}. ` +
        `Only one reading is allowed per hour — edit the existing entry, or change the reading time.`,
      );
      return;
    }

    // Save RO Train reading.
    // Confirmed DB columns in ro_train_readings (from original working code):
    //   feed_pressure_psi, reject_pressure_psi, feed_flow, permeate_flow, reject_flow,
    //   feed_tds, permeate_tds, reject_tds, feed_ph, permeate_ph, reject_ph,
    //   turbidity_ntu, temperature_c, suction_pressure_psi,
    //   dp_psi, recovery_pct, rejection_pct, salt_passage_pct, recorded_by.
    // Excluded (local-only, no DB column): feed_meter_curr, permeate_meter_curr,
    //   reject_meter_curr, power_meter_curr.
    // To save volume/power data, first confirm exact column names in your Supabase schema.
    // feed_meter_curr / permeate_meter_curr / reject_meter_curr are local-only calc helpers —
    // the DB stores computed delta volumes, not raw odometer readings.
    // power_meter_curr IS persisted as power_meter_reading_kwh so the next session can
    // auto-fill the "previous reading" and the delta can be computed without manual re-entry.
    const EXCLUDED_KEYS = new Set([
      'feed_meter_curr', 'permeate_meter_curr', 'reject_meter_curr', 'power_meter_curr',
      // New optional columns — excluded from generic spread and added conditionally below
      // so un-migrated DBs receive no null for an unknown column (Supabase schema-cache error).
      'chlorine_residual_mg_l',
    ]);
    // Note: permeate_meter_curr stays excluded from the generic roValues spread —
    // we persist it explicitly as permeate_meter below (the real DB column name).

    // ── Volume-weighted power allocation for shared meters ───────────────────
    // When this train shares a physical power meter with sibling trains
    // (shared_power_meter_group is set), we cannot attribute the full kWh delta
    // to this train — that would multiply-count the same consumption.
    // Instead we store the FULL meter delta + the raw reading on this train's
    // row and leave kWh attribution (÷ by number of running sibling trains) to
    // the reporting layer, which has access to all trains' permeate volumes.
    // The per-train secEnergy (kWh/m³) shown in the form is therefore an ESTIMATE
    // (full delta / this train's permeate) and is flagged as such in the UI.
    const roPayload: any = {
      train_id: trainId, plant_id: plantId, reading_datetime: new Date(dt).toISOString(),
      ...Object.fromEntries(
        Object.entries(roValues)
          .filter(([k]) => !EXCLUDED_KEYS.has(k))
          .map(([k, val]) => [k, val ? +val : null])
      ),
      // BUG FIX #1: roValues.feed_flow / permeate_flow are raw input strings — they are ''
      // when the value was inferred (not typed). The generic spread above maps '' → null,
      // silently discarding inferred values. Override with effFeedFlow / effPermFlow so
      // inferred values (from 2-of-3 EM logic or meter fallback) are always persisted.
      feed_flow:     effFeedFlow  ?? (roValues.feed_flow     ? +roValues.feed_flow     : null),
      permeate_flow: effPermFlow  ?? (roValues.permeate_flow ? +roValues.permeate_flow : null),
      reject_flow:   rejectFlow   ?? (roValues.reject_flow   ? +roValues.reject_flow   : null),
      dp_psi: dp,
      recovery_pct: recovery,
      rejection_pct: rejection,
      salt_passage_pct: saltPassage,
      // ── Meter odometer snapshots — only included when operator entered a value.
      // Conditional spread prevents Supabase schema-cache errors on un-migrated DBs
      // that don't yet have these columns (same pattern as chlorine_residual_mg_l).
      // When a value IS present we also persist prev + delta so the log table is
      // self-contained (no join or re-computation needed for display).
      ...(feedCurr && !isNaN(feedCurr) ? {
        feed_meter:       feedCurr,
        feed_meter_prev:  prevFeedMeter ?? null,
        feed_meter_delta: feedDelta     ?? null,
      } : {}),
      ...(permCurr && !isNaN(permCurr) ? {
        permeate_meter:       permCurr,
        permeate_meter_prev:  prevPermMeter ?? null,
        permeate_meter_delta: permDelta     ?? null,
      } : {}),
      ...(rejCurr && !isNaN(rejCurr) ? {
        reject_meter:       rejCurr,
        reject_meter_prev:  prevRejMeter ?? null,
        reject_meter_delta: rejDelta     ?? null,
      } : {}),
      // permeate_production_date is no longer written — the 00:20 cutoff rule has
      // been removed. Date attribution uses reading_datetime directly everywhere.
      // Power meter — persist raw reading so next session can auto-fill prevPowerMeter
      power_meter_reading_kwh: pwrCurr && !isNaN(pwrCurr) ? pwrCurr : null,
      // Delta & derived — null when prevPowerMeter not yet established (first reading)
      power_delta_kwh: pwrDelta,
      power_avg_kw: pwrKw,
      // kWh/m³ stored as-is; for shared meters this is the full-meter estimate,
      // not the train-allocated value. Attribution happens in reporting queries.
      specific_energy_kwh_m3: secEnergy,
      // Flag for reporting layer: if non-null, this train shares a power meter
      shared_power_meter_group: sharedPowerGroup ?? null,
      // ── New optional product-quality fields ──────────────────────────────────
      // Only included when the operator entered a value so un-migrated DBs that
      // don't yet have the column receive no null and no schema-cache error.
      ...(roValues.chlorine_residual_mg_l !== '' ? { chlorine_residual_mg_l: +roValues.chlorine_residual_mg_l } : {}),
      // Operator-supplied reason when one or more required RO fields were left
      // blank (broken meter, sensor down, etc.) — see completeness guard above.
      // Conditionally included (same pattern as chlorine_residual_mg_l) so
      // un-migrated DBs don't get a null write for an unknown column.
      //
      // Offline submissions fall through to the same field: every RO input is
      // locked while isOfflineBlocked (above), so roValues is all empty
      // strings and this row's metrics all save as null. Previously that
      // reason was written *only* to ro_trains.status (and, transiently, to
      // sessionStorage) — nothing on the row itself said why it was blank, so
      // it looked identical to a lost/failed save in TrainLogModal's history.
      ...(roIncompleteReason.trim() ? { incomplete_reason: roIncompleteReason.trim() }
        : !trainOnline ? { incomplete_reason: `Offline${offlineReasonFinal ? `: ${offlineReasonFinal}` : ''}` }
        : {}),
      // Flag for review when a feed/permeate/reject meter delta looks like a
      // mis-keyed spike (see anyMeterSpike above). The operator can still
      // save — this doesn't block them, since the meter really might be
      // right and the train just ran hard — but the row is marked so it
      // surfaces in the alert system instead of silently becoming the new
      // "previous reading" baseline for every reading after it.
      ...(anyMeterSpike ? { norm_status: 'pending_review' } : {}),
      recorded_by: activeOperator?.id,
    };
    const { data: savedRow, error: roError } = await (supabase
      .from('ro_train_readings')
      .insert(roPayload)
      .select('id,permeate_meter_delta,feed_meter_delta')
      .single() as any);
    if (roError) { toast.error(friendlyError(roError)); return; }

    // Surface the meter spike immediately — both a toast for the operator
    // who just saved it, and a PlantAlert pushed straight into the store so
    // it shows in the notification bell right away rather than waiting for
    // Dashboard's next 2-minute alert-scan refetch.
    if (anyMeterSpike) {
      const spikes = [
        feedHighWarn ? feedSpike : null,
        permHighWarn ? permSpike : null,
        rejHighWarn  ? rejSpike  : null,
      ].filter((s): s is NonNullable<typeof s> => !!s);
      toast.warning(`Saved, but flagged for review: ${spikes.map((s) => s.label).join(', ')} meter reading looks like a spike.`);
      addAlerts(spikes.map((s) => ({
        id:          `ro-meter-spike-save-${savedRow?.id ?? trainId}-${s.label}`,
        severity:    'critical' as const,
        title:       `${s.label} meter reading error`,
        description: `${train?.name ?? `Train ${train?.train_number ?? ''}`} — ${s.detail}`,
        source:      'RO Trains',
        plantId:     plantId!,
        timestamp:   Date.now(),
      })));
    }

    // Best-effort — the reading itself already saved successfully above,
    // this never blocks or rolls it back. See flowRateGuards.ts. One remark
    // per flagged meter (feed/permeate/reject are independent, unlike every
    // other odometer page which only ever has one meter per reading).
    if (savedRow?.id) {
      const toSubmit: { needsRemark: boolean; kind: 'feed' | 'permeate' | 'reject'; spike: typeof feedSpike; text: string }[] = [
        { needsRemark: feedNeedsRemark, kind: 'feed',      spike: feedSpike, text: anomalyRemarkFeed },
        { needsRemark: permNeedsRemark, kind: 'permeate',  spike: permSpike, text: anomalyRemarkPerm },
        { needsRemark: rejNeedsRemark,  kind: 'reject',    spike: rejSpike,  text: anomalyRemarkRej },
      ];
      for (const s of toSubmit) {
        if (!s.needsRemark) continue;
        void submitAnomalyRemark({
          table_name: 'ro_train_readings',
          record_id: savedRow.id,
          meter_kind: s.kind,
          plant_id: plantId!,
          tier: s.spike.tier as 'needs_remark' | 'critical',
          direction: s.spike.direction!,
          deviation_pct: s.spike.deviationPct!,
          flow_rate: s.spike.rate,
          avg_flow_rate: s.spike.avgRate,
          rate_unit: 'm3/hr',
          remark_text: s.text,
        });
      }
      setAnomalyRemarkFeed(''); setAnomalyRemarkPerm(''); setAnomalyRemarkRej('');
    }

    // ── Sync train status in DB only for manual overrides ────────────────────
    // Submitting a reading as Offline writes 'Offline' to the DB (hard lock).
    // Submitting as Online (trainOnline=true) when the DB still holds 'Offline'
    // clears it back to 'Running' so deriveTrainStatus's hard-lock rule no
    // longer applies and the 2-hr window governs automatically from here on.
    //
    // We do NOT gate the Running write on offlineEnd being set — the operator's
    // intent (toggling back to online and submitting) is sufficient authority to
    // resolve the offline period. offlineEnd is recorded for audit purposes only.
    if (!trainOnline) {
      // Only log a train_status_log row the moment the train actually
      // transitions to Offline — not on every subsequent submit while it
      // stays offline (this branch re-runs each time). Guarded the same
      // way the "coming back online" branch below already guards its own
      // ro_trains write, so exactly one Offline row and one Running row
      // bookend each shutdown, giving the shutdown-window renderer in
      // TrainLogModal a real start/end pair to read instead of nothing.
      if (train?.status !== 'Offline') {
        try {
          await supabase.from('train_status_log').insert({
            train_id: trainId, plant_id: plantId, status: 'Offline',
            reason: offlineReasonFinal || null,
            confirmed_by: activeOperator?.id ?? null,
            confirmed_at: offlineStart ? new Date(offlineStart).toISOString() : new Date().toISOString(),
          });
        } catch { /* best-effort — see ro_trains write below, which is authoritative */ }
      }
      await supabase.from('ro_trains').update({ status: 'Offline' }).eq('id', trainId);
    } else if (train?.status === 'Offline') {
      // Clear the offline hard-lock. Covers two cases:
      //   a) Operator explicitly resolves an offline period (entered offlineEnd).
      //   b) Brand-new train (default status='Offline') gets its first online reading.
      try {
        await supabase.from('train_status_log').insert({
          train_id: trainId, plant_id: plantId, status: 'Running',
          reason: null,
          confirmed_by: activeOperator?.id ?? null,
          confirmed_at: offlineEnd ? new Date(offlineEnd).toISOString() : new Date().toISOString(),
        });
      } catch { /* best-effort — see ro_trains write below, which is authoritative */ }
      await supabase.from('ro_trains').update({ status: 'Running' }).eq('id', trainId);
    }

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
          in_psi: bwOngoing ? null : pIn,
          out_psi: bwOngoing ? null : pOut,
          dp_psi: bwOngoing ? null : dp_psi,
        };
      });

    const booster_pumps = Object.entries(boosters).filter(([, v]) => v.hz || v.target || v.amp)
      .map(([k, v]) => ({
        unit: +k,
        target_pressure_psi: (!v.psiMode || v.psiMode === undefined) ? null : (v.target ? +v.target : null),
        target_hz: v.psiMode ? null : (v.hz ? +v.hz : null),
        hz_mode: !v.psiMode,
        amperage: v.amp ? +v.amp : null,
      }));
    const filter_housings = Object.entries(housings).filter(([, v]) => v.inP || v.outP)
      .map(([k, v]) => ({ unit: +k, in_psi: v.inP ? +v.inP : null, out_psi: v.outP ? +v.outP : null }));
    // Cartridge / Bag filter housings (pre-filter) — stored separately from AFM/MMF filter housings
    const cartridge_filter_housings = Object.entries(cartridgeHousings).filter(([, v]) => v.inP || v.outP)
      .map(([k, v]) => ({ unit: +k, in_psi: v.inP ? +v.inP : null, out_psi: v.outP ? +v.outP : null }));

    // Combine the three pretreatment step-gate override reasons (AFM/MMF, Booster
    // + HPP, Cartridge/Filter Housing) into one auditable note, labeled by section.
    const pretreatReasonParts = [
      afmIncompleteReason.trim()     ? `AFM/MMF: ${afmIncompleteReason.trim()}`         : null,
      boosterIncompleteReason.trim() ? `Booster/HPP: ${boosterIncompleteReason.trim()}` : null,
      housingIncompleteReason.trim() ? `Housing: ${housingIncompleteReason.trim()}`     : null,
    ].filter((p): p is string => p !== null);

    const { error: pretreatError } = await supabase.from('ro_pretreatment_readings').insert({
      plant_id: plantId, train_id: trainId,
      reading_datetime: new Date(dt).toISOString(),
      backwash_start: isSynchronized && syncBwOn && syncBwStart ? new Date(syncBwStart).toISOString() : null,
      backwash_end: isSynchronized && syncBwOn && syncBwEnd ? new Date(syncBwEnd).toISOString() : null,
      mmf_readings, booster_pumps, afm_units, filter_housings, cartridge_filter_housings,
      hpp_target_pressure_psi: hppTarget ? +hppTarget : null,
      bag_filters_changed: +bagsChanged || 0,
      remarks: remarks || null,
      // Conditionally included (same un-migrated-DB safety pattern as other
      // optional columns in this file) — omitted entirely when nothing was flagged.
      ...(pretreatReasonParts.length ? { incomplete_reason: pretreatReasonParts.join(' | ') }
        : !trainOnline ? { incomplete_reason: `Offline${offlineReasonFinal ? `: ${offlineReasonFinal}` : ''}` }
        : {}),
      recorded_by: activeOperator?.id,
    } as any);
    if (pretreatError) { toast.error(friendlyError(pretreatError)); return; }

    const pmDelta = (savedRow as any)?.permeate_meter_delta;
      const fmDelta = (savedRow as any)?.feed_meter_delta;
      const deltaStr = pmDelta != null ? ` · permeate +${Number(pmDelta).toLocaleString('en-PH',{maximumFractionDigits:1})} m³` : '';
      toast.success(`${train.name}: saved${deltaStr}`);
    setAfmmf({}); setBoosters({}); setHousings({}); setCartridgeHousings({});
    setSyncBwOn(false); setSyncBwStart(''); setSyncBwEnd('');
    setSyncMeterStart(''); setSyncMeterEnd('');
    setHppTarget(''); setBagsChanged('0'); setRemarks('');
    setAfmReasonNeeded(false); setAfmIncompleteReason('');
    setBoosterReasonNeeded(false); setBoosterIncompleteReason('');
    setHousingReasonNeeded(false); setHousingIncompleteReason('');
    setRoReasonNeeded(false); setRoIncompleteReason('');
    // BUG FIX: re-lock the step gates after every successful save (previously
    // only reset when switching trains — see the train-change useEffect above).
    // Leaving these true kept the fully-filled-in-appearance form (incl. the
    // Save button) visible right after a save, now with blank fields and no
    // re-validation — a second tap could submit an empty reading, and the
    // Cartridge/Bag Filter Housing required-fields check (below) would never
    // fire again for subsequent readings on the same train this session.
    setAfmSectionStarted(false); setBoosterHppSectionStarted(false); setCartridgeSectionStarted(false);
    // Offline state reset — only bring the train back online when the offline
    // period was formally resolved (an end time was entered). If offlineEnd is
    // blank the period is still open: keep trainOnline=false so the next
    // reading cannot accidentally flip the DB status back to Running.
    if (offlineEnd) {
      setTrainOnline(true); setOfflineStart(''); setOfflineEnd('');
      setOfflineReason(''); setOfflineReasonOther('');
      // Clear persisted offline state now that the period is formally resolved.
      try { sessionStorage.removeItem(`pretreat:offline:${trainId}`); } catch { /* ignore */ }
    }
    // When still offline (no end time), preserve offlineStart + reason so the
    // operator can see context for the ongoing downtime in subsequent readings.
    setRoValues({
      feed_pressure_psi: '', reject_pressure_psi: '',
      feed_flow: '', permeate_flow: '', reject_flow: '',
      feed_tds: '', permeate_tds: '', reject_tds: '',
      feed_ph: '', permeate_ph: '', reject_ph: '',
      turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
      chlorine_residual_mg_l: '',
      feed_meter_curr: '',
      permeate_meter_curr: '',
      reject_meter_curr: '',
      power_meter_curr: '',
    });
    // Invalidate in specific order: targeted keys first so mounted Dashboard/TrendChart/Overview
    // queries are individually marked stale, then a broad catch-all as a safety net for any
    // other mounted queries (e.g. future features). This also triggers the new permeate-
    // as-production queries added to Dashboard so the Production stat updates immediately.
    // RO Overview / spark
    qc.invalidateQueries({ queryKey: ['ro-overview'] });
    qc.invalidateQueries({ queryKey: ['ro-last-all'] });
    qc.invalidateQueries({ queryKey: ['ro-spark'] });
    qc.invalidateQueries({ queryKey: ['ro-prev'] });
    // Dashboard stat-cards
    qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-power-today'] });
    qc.invalidateQueries({ queryKey: ['dash-power-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
    qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
    qc.invalidateQueries({ queryKey: ['alerts-feed'] });
    // TrendChart series
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['trend-power'] });
    qc.invalidateQueries({ queryKey: ['trend-cost'] });
    // DataSummaryModal — explicit so the open modal refreshes immediately
    qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
    qc.invalidateQueries({ queryKey: ['dsm-ro-trains'] });
    // Broad catch-all — safety net for any other mounted queries
    qc.invalidateQueries();
    } finally {
      // Always clears — on success, on a validation `return`, and on a
      // thrown/network error alike — so the Save button never gets stuck
      // disabled and a genuine retry after a failure is still possible.
      setIsSaving(false);
    }
  };

  const f = (k: keyof typeof roValues) => ({ value: roValues[k], onChange: (e: any) => setRoValues({ ...roValues, [k]: e.target.value }) });

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <p className="text-sm text-muted-foreground">AFM/MMF, Boosters, Filter Housings & RO Vessel</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-3.5 w-3.5" /> Import RO CSV
          </Button>
          <ExportButton table="ro_pretreatment_readings" filters={plantId ? { plant_id: plantId } : undefined} />
        </div>
        {showImport && (
          <ImportROReadingsDialog
            plantId={plantId}
            userId={activeOperator?.id ?? null}
            meterConfig={{
              permeateIsProduction: meterCfg.permeate_is_production ?? false,
              // permeateCutoffTime removed — no longer used
            }}
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false);
              // Mirror the same invalidation set as manual submit() so the Dashboard,
              // TrendChart, and RO Overview all refresh after a CSV import.
              qc.invalidateQueries({ queryKey: ['ro-overview'] });
              qc.invalidateQueries({ queryKey: ['ro-last-all'] });
              qc.invalidateQueries({ queryKey: ['ro-spark'] });
              qc.invalidateQueries({ queryKey: ['ro-prev'] });
              // Dashboard stat-cards
              qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
              qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
              qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
              qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
              qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
              qc.invalidateQueries({ queryKey: ['dash-power-today'] });
              qc.invalidateQueries({ queryKey: ['dash-power-yest'] });
              qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
              qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
              qc.invalidateQueries({ queryKey: ['dash-chem'] });
              qc.invalidateQueries({ queryKey: ['alerts-feed'] });
              // TrendChart series
              qc.invalidateQueries({ queryKey: ['trend-ro'] });
              qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
              qc.invalidateQueries({ queryKey: ['trend-product'] });
              qc.invalidateQueries({ queryKey: ['trend-power'] });
              qc.invalidateQueries({ queryKey: ['trend-cost'] });
              // DataSummaryModal
              qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
              qc.invalidateQueries({ queryKey: ['dsm-ro-trains'] });
              qc.invalidateQueries();
            }}
          />
        )}
      </div>

      <Card className="p-3 space-y-3">
        {/* Plant + Train row — with online/offline toggle */}
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <div>
            <Label htmlFor="pretreat-plant">Plant</Label>
            <Select value={plantId} onValueChange={(v) => { setPlantId(v); setTrainId(''); }}>
              <SelectTrigger className="h-9" id="pretreat-plant"><SelectValue placeholder="Select Plant" /></SelectTrigger>
              <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pretreat-train">Train</Label>
            <Select value={trainId} onValueChange={setTrainId} disabled={!plantId}>
              <SelectTrigger className="h-9" id="pretreat-train"><SelectValue placeholder="Select Train" /></SelectTrigger>
              <SelectContent>{trains?.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.name ?? `Train ${t.train_number}`}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
        </div>

        {/* Online / Offline toggle — shown once a train is picked */}
        {train && (
          <div className={cn(
            'rounded-md border px-3 py-2.5 flex items-center gap-3 transition-colors',
            trainOnline
              ? 'border-accent bg-accent-soft'
              : 'border-danger bg-danger-soft'
          )}>
            <Checkbox
              id="train-online"
              checked={trainOnline}
              onCheckedChange={(c) => {
                if (!!c && !trainOnline) {
                  // Going from Offline → Online: end date is mandatory
                  if (!offlineEnd) {
                    toast.error('Please enter a "Back Online At" time before marking the train as Online.');
                    return;
                  }
                }
                setTrainOnline(!!c);
                if (c) { setOfflineStart(''); setOfflineEnd(''); setOfflineReason(''); setOfflineReasonOther(''); }
              }}
              className={cn('shrink-0 h-4 w-4', trainOnline ? 'data-[state=checked]:bg-accent data-[state=checked]:border-accent' : '')}
            />
            <div className="flex-1 min-w-0">
              <label htmlFor="train-online" className={cn(
                'text-sm font-semibold cursor-pointer select-none',
                trainOnline ? 'text-accent' : 'text-danger'
              )}>
                {trainOnline ? '● Online / Running' : '○ Offline / Not Running'}
              </label>
              {!trainOnline && (
                <p className="text-2xs text-danger mt-0.5">
                  RO parameters locked until offline period is resolved or train comes back online
                </p>
              )}
            </div>
          </div>
        )}

        {/* Warning banner: DB says this train is Offline but form is in online mode.
            Operator must explicitly uncheck Online + fill reason/start to log offline. */}
        {train && trainOnline && train.status === 'Offline' && (
          <div className="flex items-start gap-2 rounded-md border border-warn bg-warn-soft px-3 py-2">
            <AlertCircle className="h-4 w-4 text-warn mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-warn">Train last recorded as Offline</p>
              <p className="text-xs text-warn mt-0.5">
                The database shows this train was previously offline. If it has resumed, submit a reading as Online and it will clear automatically. If it is still offline, uncheck "Online / Running" above and fill in the offline details.
              </p>
            </div>
          </div>
        )}

        {/* Offline details — shown when train is marked offline */}
        {train && !trainOnline && (
          <div className="space-y-2.5 rounded-md border border-danger bg-danger-soft/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-danger">Offline Details</p>

            {/* Reason dropdown */}
            <div>
              <Label htmlFor="pretreat-reason-for-offline" className="text-xs text-muted-foreground">Reason for Offline <span className="text-danger">*</span></Label>
              <Select value={offlineReason} onValueChange={setOfflineReason}>
                <SelectTrigger className="h-9 mt-0.5 border-danger" id="pretreat-reason-for-offline">
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
                  <SelectItem value="Peak/Off-Peak Program">Peak/Off-Peak Program</SelectItem>
                  <SelectItem value="Other">Other (specify below)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Free-text for Other */}
            {offlineReason === 'Other' && (
              <div>
                <Label htmlFor="pretreat-specify-reason" className="text-xs text-muted-foreground">Specify reason <span className="text-danger">*</span></Label>
                <Input
                  value={offlineReasonOther}
                  onChange={e => setOfflineReasonOther(e.target.value)}
                  placeholder="Describe the reason…"
                  className="mt-0.5 border-danger"
                id="pretreat-specify-reason"/>
              </div>
            )}

            {/* Offline start / end times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="pretreat-offline-since" className="text-xs text-muted-foreground">
                  Offline Since <span className="text-danger">*</span>
                </Label>
                <Input
                  type="datetime-local"
                  value={offlineStart}
                  onChange={e => setOfflineStart(e.target.value)}
                  className="mt-0.5 w-full min-w-[200px] border-danger"
                id="pretreat-offline-since"/>
              </div>
              <div>
                <Label htmlFor="pretreat-back-online-at-leave-blank-if-still-offline" className="text-xs text-muted-foreground">
                  Back Online At
                  <span className="ml-1 text-2xs font-normal text-muted-foreground">(leave blank if still offline)</span>
                </Label>
                <Input
                  type="datetime-local"
                  value={offlineEnd}
                  onChange={e => setOfflineEnd(e.target.value)}
                  className="mt-0.5 w-full min-w-[200px] border-danger"
                id="pretreat-back-online-at-leave-blank-if-still-offline"/>
              </div>
            </div>

            {/* Status banner */}
            {!offlineEnd && offlineStart && (
              <div className="flex items-center gap-2 text-xs text-danger bg-danger-soft rounded px-2.5 py-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-danger animate-pulse shrink-0" />
                Train is currently offline — RO parameters cannot be logged until it comes back online.
              </div>
            )}
            {offlineEnd && offlineStart && (
              <div className="flex items-center gap-2 text-xs text-accent bg-accent-soft rounded px-2.5 py-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-accent shrink-0" />
                Offline period recorded — you may now log RO parameters for the resumed period.
              </div>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="pretreat-reading-date-amp-time">Reading Date &amp; Time</Label>
          <Input type="datetime-local" value={dt}
            onChange={isManager ? (e) => setDt(e.target.value) : undefined}
            readOnly={!isManager}
            className={cn(
              "h-10 w-full sm:max-w-[260px] min-w-[220px]",
              !isManager && "cursor-not-allowed opacity-60 bg-muted pointer-events-none"
            )} id="pretreat-reading-date-amp-time"/>
        </div>
        {plant && (
          <div className="text-xs text-muted-foreground">
            Backwash mode: <span className="font-semibold">{isSynchronized ? 'Synchronized (Whole Train at Once)' : 'Independent (Per Unit)'}</span>
          </div>
        )}
      </Card>

      {train && (
        <>
          {/* ── Offline gate: lock all parameter inputs when train is offline with no end time ── */}
          {isOfflineBlocked && (
            <Card className="p-4 border-danger bg-danger-soft">
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5">🔒</span>
                <div>
                  <p className="text-sm font-semibold text-danger">Train is currently offline</p>
                  <p className="text-xs text-danger mt-1">
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
                <Checkbox id="sync-bw" checked={syncBwOn} onCheckedChange={(c) => setSyncBwOn(!!c)} className="shrink-0 h-4 w-4" />
                <Label htmlFor="sync-bw" className="text-sm font-semibold cursor-pointer">Train Backwash Performed?</Label>
              </div>
              {syncBwOn && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="pretreat-started" className="text-xs text-muted-foreground">Started</Label>
                      <Input type="datetime-local" value={syncBwStart} onChange={(e) => setSyncBwStart(e.target.value)} className="w-full min-w-[220px]" id="pretreat-started"/>
                    </div>
                    <div>
                      <Label htmlFor="pretreat-ended" className="text-xs text-muted-foreground">Ended</Label>
                      <Input type="datetime-local" value={syncBwEnd} onChange={(e) => setSyncBwEnd(e.target.value)} className="w-full min-w-[220px]" id="pretreat-ended"/>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="pretreat-meter-reading-start" className="text-xs text-muted-foreground">Meter Reading Start</Label>
                      <Input type="number" step="any" value={syncMeterStart}
                        onChange={(e) => setSyncMeterStart(e.target.value)}
                        placeholder="From Previous Backwash End" id="pretreat-meter-reading-start"/>
                    </div>
                    <div>
                      <Label htmlFor="pretreat-meter-reading-end" className="text-xs text-muted-foreground">Meter Reading End</Label>
                      <Input type="number" step="any" value={syncMeterEnd} onChange={(e) => setSyncMeterEnd(e.target.value)} id="pretreat-meter-reading-end"/>
                    </div>
                  </div>
                  <p className="text-2xs text-muted-foreground">All AFM/MMF Units Share These Values During Backwash. Start Value Pre-Filled From Previous Backwash End — Edit If Needed.</p>
                </>
              )}
            </Card>
          )}

          {train.num_afm > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">AFM/MMF Units ({train.num_afm})</h4>
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
                            <Checkbox id={`bw-${u}`} checked={row.bw} onCheckedChange={(c) => setAfmmfField(u, { bw: !!c })} className="shrink-0 h-4 w-4" />
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
                                <Label htmlFor="pretreat-started-2" className="text-xs text-muted-foreground">Started</Label>
                                <Input type="datetime-local" value={row.bwStart}
                                  onChange={(e) => setAfmmfField(u, { bwStart: e.target.value })}
                                  className="w-full min-w-[220px]" id="pretreat-started-2"/>
                              </div>
                              <div>
                                <Label htmlFor="pretreat-ended-2" className="text-xs text-muted-foreground">Ended</Label>
                                <Input type="datetime-local" value={row.bwEnd}
                                  onChange={(e) => setAfmmfField(u, { bwEnd: e.target.value })}
                                  className="w-full min-w-[220px]" id="pretreat-ended-2"/>
                              </div>
                            </div>
                          )}
                          {isSynchronized ? (
                            <p className="text-2xs text-muted-foreground">
                              Train-Wide Backwash {syncBwStart || '—'} → {syncBwEnd || '—'} · Meter {syncMeterStart || '—'} → {syncMeterEnd || '—'}
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <Label htmlFor="pretreat-meter-reading-start-2" className="text-xs text-muted-foreground">Meter Reading Start</Label>
                                <Input type="number" step="any" value={meterStartValue}
                                  onChange={(e) => setAfmmfField(u, { meterStart: e.target.value })}
                                  placeholder={prevEnd != null ? String(prevEnd) : 'From Previous Backwash End'} id="pretreat-meter-reading-start-2"/>
                                {prevEnd != null && (
                                  <p className="text-2xs text-muted-foreground mt-0.5">Previous End: {prevEnd} (Editable)</p>
                                )}
                              </div>
                              <div>
                                <Label htmlFor="pretreat-meter-reading-end-2" className="text-xs text-muted-foreground">Meter Reading End</Label>
                                <Input type="number" step="any" value={row.meterEnd}
                                  onChange={(e) => setAfmmfField(u, { meterEnd: e.target.value })} id="pretreat-meter-reading-end-2"/>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        // No backwash → always-visible pressure In/Out (per unit)
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label htmlFor="pretreat-pressure-in-psi" className="text-xs text-muted-foreground">Pressure In (psi)</Label>
                            <Input type="number" step="any" value={row.pressureIn}
                              onChange={(e) => setAfmmfField(u, { pressureIn: e.target.value })} id="pretreat-pressure-in-psi"/>
                          </div>
                          <div>
                            <Label htmlFor="pretreat-pressure-out-psi" className="text-xs text-muted-foreground">Pressure Out (psi)</Label>
                            <Input type="number" step="any" value={row.pressureOut}
                              onChange={(e) => setAfmmfField(u, { pressureOut: e.target.value })} id="pretreat-pressure-out-psi"/>
                          </div>
                          <div>
                            <Label htmlFor="pretreat-pressure" className="text-xs text-muted-foreground">ΔPressure</Label>
                            <ComputedInput value={afmDp} className={dpWarn ? 'border-danger text-danger font-semibold' : 'text-foreground font-medium'} id="pretreat-pressure"/>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* ── Step gate: AFM/MMF must be fully filled (or reasoned) before Booster Pump + HPP section unlocks ── */}
              {!afmSectionStarted && (
                <div className="pt-1 border-t border-border/40">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full bg-primary hover:bg-primary/90 text-white gap-2"
                    onClick={() => {
                      // Guard: EVERY configured AFM/MMF unit must have its active field pair
                      // fully filled (both Pressure In & Out, or both Meter Start & End).
                      if (train.num_afm > 0) {
                        const filledUnits = Array.from({ length: train.num_afm }, (_, i) => i + 1).filter((u) => {
                          const row = afmmf[u];
                          if (!row) return false;
                          const bwOn = isSynchronized ? syncBwOn : row.bw;
                          const msVal = isSynchronized ? (row.meterStart || syncMeterStart) : row.meterStart;
                          const meVal = isSynchronized ? (row.meterEnd || syncMeterEnd) : row.meterEnd;
                          return bwOn ? !!(msVal && meVal) : !!(row.pressureIn && row.pressureOut);
                        }).length;
                        if (filledUnits < train.num_afm && !afmIncompleteReason.trim()) {
                          setAfmReasonNeeded(true);
                          toast.error(
                            `${filledUnits} of ${train.num_afm} AFM/MMF unit(s) complete. Fill in every field, or enter a reason below to proceed with missing values.`,
                          );
                          return;
                        }
                      }
                      setAfmSectionStarted(true);
                    }}
                  >
                    Proceed to Booster Pump and HPP →
                  </Button>
                  <p className="text-2xs text-muted-foreground text-center mt-1">
                    Fill in every AFM/MMF field above, or click to proceed if none apply.
                  </p>
                  {afmReasonNeeded && (
                    <div className="pt-1.5">
                      <Label htmlFor="pretreat-reason-for-missing-value-s-required-to-proceed" className="text-xs text-warn">
                        Reason for missing value(s) — required to proceed
                      </Label>
                      <Textarea
                        value={afmIncompleteReason}
                        onChange={(e) => setAfmIncompleteReason(e.target.value)}
                        placeholder="e.g. Unit 3 pressure gauge out of service, replacement pending"
                        className="text-xs"
                      id="pretreat-reason-for-missing-value-s-required-to-proceed"/>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* ── Booster Pumps + HPP — visible once AFM/MMF section has been acknowledged (or skipped) ── */}
          {(afmSectionStarted || train.num_afm === 0) && (() => {
            // Shared psi/Hz mode toggle — applies to all pumps at once
            const anyPsi = Object.values(boosters).some(b => b.psiMode !== false);
            const globalPsiMode = Object.keys(boosters).length === 0 ? boosterPrefPsi : anyPsi;
            const setGlobalMode = (psi: boolean) => {
              if (boosterConfig) return; // locked to the configured mode — see toggle buttons below
              // Persist preference so the next page open starts in the same mode
              setBoosterPrefPsi(psi);
              try { localStorage.setItem(BOOSTER_MODE_KEY, String(psi)); } catch { /* best-effort persist — ignore */ }
              const next: typeof boosters = {};
              Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).forEach(u => {
                const b = boosters[u] || { hz: '', target: '', amp: '', psiMode: boosterPrefPsi };
                next[u] = { ...b, psiMode: psi, hz: '', target: '' };
              });
              setBoosters(next);
            };
            return (
              <>
              {train.num_booster_pumps > 0 && (
              <Card className="p-3 space-y-2.5">
                {/* Header row: title left, psi/Hz toggle right */}
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Booster Pumps ({train.num_booster_pumps})
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Target</span>
                    <div className={cn(
                      'flex rounded-full border border-border overflow-hidden text-xs font-semibold',
                      boosterConfig && 'opacity-60',
                    )}>
                      <button
                        type="button"
                        onClick={() => setGlobalMode(true)}
                        disabled={!!boosterConfig}
                        title={boosterConfig ? 'Mode is set in Train Settings' : undefined}
                        className={cn(
                          'px-3 py-1 transition-colors',
                          boosterConfig && 'cursor-not-allowed',
                          globalPsiMode
                            ? 'bg-primary text-white'
                            : 'bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >psi</button>
                      <button
                        type="button"
                        onClick={() => setGlobalMode(false)}
                        disabled={!!boosterConfig}
                        title={boosterConfig ? 'Mode is set in Train Settings' : undefined}
                        className={cn(
                          'px-3 py-1 transition-colors',
                          boosterConfig && 'cursor-not-allowed',
                          !globalPsiMode
                            ? 'bg-primary text-white'
                            : 'bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >Hz</button>
                    </div>
                  </div>
                </div>

                {/* Column headers */}
                <div className="grid grid-cols-[72px_1fr_1fr_1fr] gap-x-3 gap-y-0 items-end">
                  <div />
                  <div className="text-xs text-muted-foreground font-medium text-center">psi</div>
                  <div className="text-xs text-muted-foreground font-medium text-center">Hz</div>
                  <div className="text-xs text-muted-foreground font-medium text-center">Amperage (A)</div>
                </div>

                {/* Pump rows */}
                <div className="space-y-2">
                  {Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).map((u) => {
                    const b = boosters[u] || { hz: '', target: '', amp: '', psiMode: boosterPrefPsi };
                    const psiMode = b.psiMode !== false;
                    const pumpConfigured = boosterConfig?.targets[String(u)] != null;
                    const setB = (patch: Partial<typeof b>) =>
                      setBoosters({ ...boosters, [u]: { ...b, ...patch } });
                    return (
                      <div key={u} className="grid grid-cols-[72px_1fr_1fr_1fr] gap-x-3 items-center">
                        <span className="text-sm font-semibold text-foreground">Pump {u}</span>
                        {/* psi input */}
                        <Input
                          type="number" step="any"
                          value={psiMode ? b.target : ''}
                          disabled={!psiMode || pumpConfigured}
                          readOnly={pumpConfigured}
                          placeholder={psiMode ? 'Enter psi' : '—'}
                          title={pumpConfigured ? 'Set in Train Settings' : undefined}
                          className={cn(
                            'text-center placeholder:text-2xs placeholder:text-muted-foreground/40 rounded-lg',
                            !psiMode && 'opacity-35 cursor-not-allowed bg-muted/30',
                            psiMode && pumpConfigured && 'bg-muted/40'
                          )}
                          onChange={(e) => setB({ target: e.target.value })}
                        />
                        {/* Hz input */}
                        <Input
                          type="number" step="any"
                          value={!psiMode ? b.hz : ''}
                          disabled={psiMode || pumpConfigured}
                          readOnly={pumpConfigured}
                          placeholder={!psiMode ? 'Enter Hz' : '—'}
                          title={pumpConfigured ? 'Set in Train Settings' : undefined}
                          className={cn(
                            'text-center placeholder:text-2xs placeholder:text-muted-foreground/40 rounded-lg',
                            psiMode && 'opacity-35 cursor-not-allowed bg-muted/30',
                            !psiMode && pumpConfigured && 'bg-muted/40'
                          )}
                          onChange={(e) => setB({ hz: e.target.value })}
                        />
                        {/* Amperage */}
                        <Input
                          type="number" step="any"
                          value={b.amp}
                          placeholder="Enter A"
                          className="text-center placeholder:text-2xs placeholder:text-muted-foreground/40 rounded-lg"
                          onChange={(e) => setB({ amp: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Mode hint */}
                <p className="text-3xs text-muted-foreground/50 italic">
                  {boosterConfig
                    ? `${globalPsiMode ? 'psi' : 'Hz'} mode — set in Train Settings, applies to all pumps on this train.`
                    : globalPsiMode ? 'psi mode — Hz column locked. Tap psi/Hz to switch.' : 'Hz mode — psi column locked. Tap psi/Hz to switch.'}
                </p>
              </Card>
              )}

              {/* HPP card — always shown in this section */}
              <Card className="p-3 space-y-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">High-Pressure Pump</h4>
                <div>
                  <Label htmlFor="pretreat-hpp-target-pressure-psi" className="text-xs text-muted-foreground">HPP Target Pressure (psi)</Label>
                  {train?.hpp_target_pressure_psi != null ? (
                    <>
                      <Input type="number" step="any" value={hppTarget} readOnly disabled
                        className="font-mono-num bg-muted/40" id="pretreat-hpp-target-pressure-psi"/>
                      <p className="text-2xs text-muted-foreground mt-1">
                        Set in Train Settings — applies to every reading until changed there.
                      </p>
                    </>
                  ) : (
                    <Input type="number" step="any" value={hppTarget} onChange={(e) => setHppTarget(e.target.value)} />
                  )}
                </div>
              </Card>

              {/* ── Step gate: Booster + HPP must be fully filled (or reasoned) before Cartridge Housing unlocks ── */}
              {!boosterHppSectionStarted && (
                <Card className="p-3">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full bg-primary hover:bg-primary/90 text-white gap-2"
                    onClick={() => {
                      // Guard: EVERY Booster Pump + HPP field must be filled — HPP target,
                      // plus for each pump the active column (psi target OR Hz, whichever
                      // mode is toggled — the other column is disabled) and amperage.
                      const totalFields = 1 + train.num_booster_pumps * 2; // HPP + (target/hz + amp) per pump
                      let filledCount = hppTarget ? 1 : 0;
                      Array.from({ length: train.num_booster_pumps }, (_, i) => i + 1).forEach((u) => {
                        const b = boosters[u];
                        const psiMode = b?.psiMode !== false;
                        if (psiMode ? b?.target : b?.hz) filledCount++;
                        if (b?.amp) filledCount++;
                      });
                      if (filledCount < totalFields && !boosterIncompleteReason.trim()) {
                        setBoosterReasonNeeded(true);
                        toast.error(
                          `${filledCount} of ${totalFields} Booster Pump & HPP field(s) complete. Fill in every field, or enter a reason below to proceed with missing values.`,
                        );
                        return;
                      }
                      setBoosterHppSectionStarted(true);
                    }}
                  >
                    Proceed to Cartridge Housing / Bag Filter →
                  </Button>
                  <p className="text-2xs text-muted-foreground text-center mt-1">
                    Fill in every Booster Pump & HPP field above to proceed.
                  </p>
                  {boosterReasonNeeded && (
                    <div className="pt-1.5">
                      <Label htmlFor="pretreat-reason-for-missing-value-s-required-to-proceed-2" className="text-xs text-warn">
                        Reason for missing value(s) — required to proceed
                      </Label>
                      <Textarea
                        value={boosterIncompleteReason}
                        onChange={(e) => setBoosterIncompleteReason(e.target.value)}
                        placeholder="e.g. Pump 2 ammeter not yet installed"
                        className="text-xs"
                      id="pretreat-reason-for-missing-value-s-required-to-proceed-2"/>
                    </div>
                  )}
                </Card>
              )}
              </>
            );
          })()}

          {/* ── Section 3: Cartridge / Bag Filter Housings ─────────────────────────
              Visible once Booster Pumps + HPP section has been acknowledged.
              Contains Cartridge/Bag Filter pre-filter housings and AFM Filter Housings. */}
          {boosterHppSectionStarted && (
          <>
          {/* ── Cartridge / Bag Filter Housing (Pre-filter) ──────────────────
              Driven by train.num_cartridge_filters; label by plant.filter_housing_type.
              These are the pre-filter housings before the HPP/RO membrane — distinct from
              the AFM/MMF multi-media Filter Housings below. */}
          {(train.num_cartridge_filters ?? 0) > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                {cartridgeHousingLabel} ({train.num_cartridge_filters}) <span className="text-danger">*</span>
              </h4>
              {Array.from({ length: train.num_cartridge_filters }, (_, i) => i + 1).map((u) => {
                const inP  = +(cartridgeHousings[u]?.inP  ?? '');
                const outP = +(cartridgeHousings[u]?.outP ?? '');
                const cfDp = cartridgeHousings[u]?.inP && cartridgeHousings[u]?.outP
                  ? (inP - outP).toFixed(2) : '';
                const cfDpWarn = cfDp !== '' && +cfDp >= 25; // 25 psi DP = typical cartridge/bag replacement threshold
                return (
                  <div key={u} className="grid grid-cols-4 gap-2 items-end">
                    <div className="text-xs font-medium pb-2">Housing {u}</div>
                    <div>
                      <Label htmlFor="pretreat-pressure-in-psi-2" className="text-xs text-muted-foreground">Pressure In (psi)</Label>
                      <Input
                        type="number" step="any"
                        value={cartridgeHousings[u]?.inP ?? ''}
                        onChange={(e) => setCartridgeHousings({
                          ...cartridgeHousings,
                          [u]: { ...(cartridgeHousings[u] || { outP: '' }), inP: e.target.value },
                        })}
                      id="pretreat-pressure-in-psi-2"/>
                    </div>
                    <div>
                      <Label htmlFor="pretreat-pressure-out-psi-2" className="text-xs text-muted-foreground">Pressure Out (psi)</Label>
                      <Input
                        type="number" step="any"
                        value={cartridgeHousings[u]?.outP ?? ''}
                        onChange={(e) => setCartridgeHousings({
                          ...cartridgeHousings,
                          [u]: { ...(cartridgeHousings[u] || { inP: '' }), outP: e.target.value },
                        })}
                      id="pretreat-pressure-out-psi-2"/>
                    </div>
                    <div>
                      <Label htmlFor="pretreat-pressure-2" className={cn('text-xs', cfDpWarn ? 'text-warn' : 'text-muted-foreground')}>
                        ΔPressure{cfDpWarn ? ' ⚠' : ''}
                      </Label>
                      <ComputedInput value={cfDp} className={cfDpWarn ? 'border-warn text-warn-foreground font-semibold' : 'text-foreground font-medium'} id="pretreat-pressure-2"/>
                    </div>
                  </div>
                );
              })}
              <div className="pt-1">
                <Label htmlFor="pretreat-field" className="text-xs text-muted-foreground">{changedElementLabel}</Label>
                <Input type="number" min="0" value={bagsChanged} onChange={(e) => setBagsChanged(e.target.value)} id="pretreat-field"/>
              </div>
            </Card>
          )}

          {/* ── AFM/MMF Filter Housings ── secondary filter housings (Cartridge Filter plants only) */}
          {(train.num_filter_housings ?? 0) > 0 && (
            <Card className="p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Filter Housings ({train.num_filter_housings})</h4>
              {Array.from({ length: train.num_filter_housings }, (_, i) => i + 1).map((u) => {
                const inP = +(housings[u]?.inP ?? '');
                const outP = +(housings[u]?.outP ?? '');
                const housingDp = housings[u]?.inP && housings[u]?.outP ? (inP - outP).toFixed(2) : '';
                return (
                  <div key={u} className="grid grid-cols-4 gap-2 items-center">
                    <div className="text-xs font-medium self-center">Housing {u}</div>
                    <div>
                      <Label htmlFor="pretreat-in-psi" className="text-xs text-muted-foreground">In (psi)</Label>
                      <Input type="number" step="any" value={housings[u]?.inP ?? ''}
                        onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { outP: '' }), inP: e.target.value } })} id="pretreat-in-psi"/>
                    </div>
                    <div>
                      <Label htmlFor="pretreat-out-psi" className="text-xs text-muted-foreground">Out (psi)</Label>
                      <Input type="number" step="any" value={housings[u]?.outP ?? ''}
                        onChange={(e) => setHousings({ ...housings, [u]: { ...(housings[u] || { inP: '' }), outP: e.target.value } })} id="pretreat-out-psi"/>
                    </div>
                    <div>
                      <Label htmlFor="pretreat-pressure-3" className="text-xs text-muted-foreground">ΔPressure</Label>
                      <ComputedInput value={housingDp} className="text-foreground font-medium" id="pretreat-pressure-3"/>
                    </div>
                  </div>
                );
              })}
              {/* Only show changed-element field here when there are no cartridge/bag filter housings
                  (avoids duplicate input when both sections are visible). */}
              {!(train.num_cartridge_filters > 0) && (
                <div className="pt-2">
                  <Label htmlFor="pretreat-field-2" className="text-xs text-muted-foreground">{changedElementLabel}</Label>
                  <Input type="number" min="0" value={bagsChanged} onChange={(e) => setBagsChanged(e.target.value)} id="pretreat-field-2"/>
                </div>
              )}
            </Card>
          )}

          {/* ── Step gate: Cartridge / Filter Housing must be acknowledged before RO Vessels unlocks ── */}
          {!cartridgeSectionStarted && (
            <Card className="p-3">
              <Button
                type="button"
                size="sm"
                className="w-full bg-primary hover:bg-primary/90 text-white gap-2"
                onClick={() => {
                  // Guard: EVERY configured housing must have BOTH Pressure In & Out filled.
                  const totalHousings = (train.num_cartridge_filters ?? 0) + (train.num_filter_housings ?? 0);
                  if (totalHousings > 0) {
                    let filledHousings = 0;
                    Array.from({ length: train.num_cartridge_filters ?? 0 }, (_, i) => i + 1).forEach((u) => {
                      if (cartridgeHousings[u]?.inP && cartridgeHousings[u]?.outP) filledHousings++;
                    });
                    Array.from({ length: train.num_filter_housings ?? 0 }, (_, i) => i + 1).forEach((u) => {
                      if (housings[u]?.inP && housings[u]?.outP) filledHousings++;
                    });
                    if (filledHousings < totalHousings && !housingIncompleteReason.trim()) {
                      setHousingReasonNeeded(true);
                      toast.error(
                        `${filledHousings} of ${totalHousings} housing(s) complete. Fill in every field, or enter a reason below to proceed with missing values.`,
                      );
                      return;
                    }
                  }
                  setCartridgeSectionStarted(true);
                }}
              >
                Proceed to RO Vessels →
              </Button>
              <p className="text-2xs text-muted-foreground text-center mt-1">
                {(train.num_cartridge_filters ?? 0) + (train.num_filter_housings ?? 0) === 0
                  ? 'No housings configured — click to proceed to RO Vessels.'
                  : 'Fill in In & Out pressure for every housing above to proceed.'}
              </p>
              {housingReasonNeeded && (
                <div className="pt-1.5">
                  <Label htmlFor="pretreat-reason-for-missing-value-s-required-to-proceed-3" className="text-xs text-warn">
                    Reason for missing value(s) — required to proceed
                  </Label>
                  <Textarea
                    value={housingIncompleteReason}
                    onChange={(e) => setHousingIncompleteReason(e.target.value)}
                    placeholder="e.g. Housing 2 gauge unreadable, being replaced"
                    className="text-xs"
                  id="pretreat-reason-for-missing-value-s-required-to-proceed-3"/>
                </div>
              )}
            </Card>
          )}
          </>
          )}

          {/* ── Section 4: RO Vessel — visible once Cartridge Housing section has been acknowledged ── */}
          {cartridgeSectionStarted && (
          <>
          <Card className="p-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">RO Vessel</h4>

            {/* Column headers */}
            <div className={`grid gap-2 ${[showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length === 3 ? 'grid-cols-3' : [showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {showFeedMeter && (
              <div className="flex items-center gap-1.5 rounded-md bg-info-soft border border-info px-2 py-1.5">
                <RawWaterIcon className="h-3.5 w-3.5 text-info shrink-0" aria-hidden />
                <span className="text-xs font-semibold text-info">Feed / Raw</span>
              </div>
              )}
              {showPermeateMeter && (
              <div className="flex items-center gap-1.5 rounded-md bg-accent-soft border border-accent px-2 py-1.5">
                <PermeateIcon className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden />
                <span className="text-xs font-semibold text-accent">{productionLabel}</span>
              </div>
              )}
              {showRejectMeter && (
              <div className="flex items-center gap-1.5 rounded-md bg-muted border border-border px-2 py-1.5">
                <RejectIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                <span className="text-xs font-semibold text-muted-foreground">Reject / Concentrate</span>
              </div>
              )}
            </div>

            {/* ── Water Meter ─────────────────────────────────────────────── */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Water Meter</p>
                <p className="text-2xs text-muted-foreground/60 italic">
                  {(!showFeedMeter || !showRejectMeter) ? 'Missing meter auto-inferred' : 'Leave one stream blank — it will be inferred'}
                </p>
              </div>
              {/* Auto-computed duration from datetime diff */}
              <div className="flex items-center gap-2 mb-1">
                <Label htmlFor="pretreat-duration-min" className="text-xs text-muted-foreground shrink-0">Duration (min)</Label>
                <ComputedInput
                  value={autoDurationMin != null ? String(autoDurationMin) : ''}
                  className="h-7 text-xs w-28"
                id="pretreat-duration-min"/>
                {autoDurationMin == null && (
                  <span className="text-2xs text-muted-foreground/60 italic">— no prior reading found</span>
                )}
              </div>
              {/* Inferred-meter notice banner */}
              {(!showFeedMeter || !showRejectMeter) && (
                <div className="rounded-md bg-info-soft border border-info px-2.5 py-1.5 text-2xs text-info mb-1">
                  {!showFeedMeter && showPermeateMeter && showRejectMeter && 'Feed meter disabled — feed volume auto-inferred as permeate + reject.'}
                  {showFeedMeter && !showRejectMeter && 'Reject meter disabled — reject volume auto-inferred as feed − permeate.'}
                  {!showFeedMeter && !showRejectMeter && 'Feed and reject meters disabled — only permeate logged.'}
                </div>
              )}
              {/* current / prev (auto) / Δ / flow columns — only configured meters */}
              <div className={`grid gap-2 ${[showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length === 3 ? 'grid-cols-3' : [showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {/* Feed */}
                {showFeedMeter && (
                <div className="space-y-1">
                  <div>
                    <Label htmlFor="pretreat-previous-feed-meter-reading" className="text-xs text-muted-foreground">Previous Feed Meter Reading</Label>
                    {prevFeedMeter != null
                      ? <ComputedInput value={String(prevFeedMeter)} className="text-foreground font-semibold bg-muted/40" id="pretreat-previous-feed-meter-reading"/>
                      : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
                          <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
                        </div>
                    }
                  </div>
                  <div>
                    <Label htmlFor="pretreat-feed-meter-reading" className="text-xs text-muted-foreground">Feed Meter Reading</Label>
                    <Input type="number" step="any" {...f('feed_meter_curr')} placeholder="Input current feed reading" className={cn(
                      "placeholder:text-2xs placeholder:text-muted-foreground/50",
                      feedNegWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
                      !feedNegWarn && feedSpike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
                      !feedNegWarn && feedSpike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
                    )} id="pretreat-feed-meter-reading"/>
                    {feedNegWarn && (
                      <p className="text-xs text-danger flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Reading ({feedCurr}) is below previous ({prevFeedMeter}) — meter rollback or typo.
                      </p>
                    )}
                    {feedNeedsRemark && (
                      <div className="mt-1">
                        <AnomalyRemarkBanner
                          result={feedSpike}
                          label="Feed"
                          unit="m3/hr"
                          windowDays={10}
                          remark={anomalyRemarkFeed}
                          onRemarkChange={setAnomalyRemarkFeed}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pretreat-feed-volume-m" className={cn('text-xs', feedInferred ? 'text-info' : 'text-muted-foreground')}>
                      Feed Volume{feedInferred ? ' (inferred)' : ''} (m³)
                    </Label>
                    <ComputedInput value={feedVol != null ? String(feedVol) : ''} className={feedInferred ? 'border-info text-info font-medium' : 'text-foreground font-medium'} id="pretreat-feed-volume-m"/>
                  </div>
                  <div>
                    <Label htmlFor="pretreat-feed-flowrate-m-hr" className="text-xs text-muted-foreground">Feed Flowrate (m³/hr)</Label>
                    <ComputedInput value={feedFlowMeter != null ? String(feedFlowMeter) : ''} className="text-foreground font-medium" id="pretreat-feed-flowrate-m-hr"/>
                  </div>
                </div>
                )}
                {/* Permeate */}
                {showPermeateMeter && (
                <div className="space-y-1">
                  <div>
                    <Label htmlFor="pretreat-previous-permeate-meter-reading" className="text-xs text-muted-foreground">Previous Permeate Meter Reading</Label>
                    {prevPermMeter != null
                      ? <ComputedInput value={String(prevPermMeter)} className="text-foreground font-semibold bg-muted/40" id="pretreat-previous-permeate-meter-reading"/>
                      : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
                          <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
                        </div>
                    }
                  </div>
                  <div>
                    <Label htmlFor="pretreat-permeate-meter-reading" className="text-xs text-muted-foreground">Permeate Meter Reading</Label>
                    <Input type="number" step="any" {...f('permeate_meter_curr')} placeholder="Input current permeate reading" className={cn(
                      "placeholder:text-2xs placeholder:text-muted-foreground/50",
                      permNegWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
                      !permNegWarn && permSpike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
                      !permNegWarn && permSpike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
                    )} id="pretreat-permeate-meter-reading"/>
                    {permNegWarn && (
                      <p className="text-xs text-danger flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Reading ({permCurr}) is below previous ({prevPermMeter}) — meter rollback or typo.
                      </p>
                    )}
                    {permNeedsRemark && (
                      <div className="mt-1">
                        <AnomalyRemarkBanner
                          result={permSpike}
                          label="Permeate"
                          unit="m3/hr"
                          windowDays={10}
                          remark={anomalyRemarkPerm}
                          onRemarkChange={setAnomalyRemarkPerm}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pretreat-m" className={cn('text-xs', permInferred ? 'text-info' : 'text-muted-foreground')}>
                      {meterCfg.ro_production_source === 'permeate' ? 'Production (Permeate)' : 'Permeate Volume'}{permInferred ? ' (inferred)' : ''} (m³)
                    </Label>
                    <ComputedInput value={permVol != null ? String(permVol) : ''} className={permInferred ? 'border-info text-info font-medium' : 'text-foreground font-medium'} id="pretreat-m"/>
                  </div>
                  <div>
                    <Label htmlFor="pretreat-permeate-flowrate-m-hr" className="text-xs text-muted-foreground">Permeate Flowrate (m³/hr)</Label>
                    <ComputedInput value={permFlowMeter != null ? String(permFlowMeter) : ''} className="text-foreground font-medium" id="pretreat-permeate-flowrate-m-hr"/>
                  </div>
                </div>
                )}
                {/* Reject */}
                {showRejectMeter && (
                <div className="space-y-1">
                  <div>
                    <Label htmlFor="pretreat-previous-reject-meter-reading" className="text-xs text-muted-foreground">Previous Reject Meter Reading</Label>
                    {prevRejMeter != null
                      ? <ComputedInput value={String(prevRejMeter)} className="text-foreground font-semibold bg-muted/40" id="pretreat-previous-reject-meter-reading"/>
                      : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
                          <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
                        </div>
                    }
                  </div>
                  <div>
                    <Label htmlFor="pretreat-reject-meter-reading" className="text-xs text-muted-foreground">Reject Meter Reading</Label>
                    <Input type="number" step="any" {...f('reject_meter_curr')} placeholder="Input current reject reading" className={cn(
                      "placeholder:text-2xs placeholder:text-muted-foreground/50",
                      rejNegWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
                      !rejNegWarn && rejSpike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
                      !rejNegWarn && rejSpike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
                    )} id="pretreat-reject-meter-reading"/>
                    {rejNegWarn && (
                      <p className="text-xs text-danger flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Reading ({rejCurr}) is below previous ({prevRejMeter}) — meter rollback or typo.
                      </p>
                    )}
                    {rejNeedsRemark && (
                      <div className="mt-1">
                        <AnomalyRemarkBanner
                          result={rejSpike}
                          label="Reject"
                          unit="m3/hr"
                          windowDays={10}
                          remark={anomalyRemarkRej}
                          onRemarkChange={setAnomalyRemarkRej}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pretreat-reject-volume-m" className={cn('text-xs', rejInferred ? 'text-info' : 'text-muted-foreground')}>
                      Reject Volume{rejInferred ? ' (inferred)' : ''} (m³)
                    </Label>
                    <ComputedInput value={rejVol != null ? String(rejVol) : ''} className={rejInferred ? 'border-info text-info font-medium' : 'text-foreground font-medium'} id="pretreat-reject-volume-m"/>
                  </div>
                  <div>
                    <Label htmlFor="pretreat-reject-flowrate-m-hr" className="text-xs text-muted-foreground">Reject Flowrate (m³/hr)</Label>
                    <ComputedInput value={rejFlowMeter != null ? String(rejFlowMeter) : ''} className="text-foreground font-medium" id="pretreat-reject-flowrate-m-hr"/>
                  </div>
                </div>
                )}
              </div>
            </div>

            {/* ── Pressure row ────────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Pressure (psi)</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <div>
                    <Label htmlFor="pretreat-suction" className="text-xs text-muted-foreground">Suction</Label>
                    <Input type="number" step="any" {...f('suction_pressure_psi')}
                      placeholder="Suction pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-suction"/>
                  </div>
                  <div>
                    <Label htmlFor="pretreat-feed" className="text-xs text-muted-foreground">Feed</Label>
                    <Input type="number" step="any" {...f('feed_pressure_psi')}
                      placeholder="Feed pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-feed"/>
                  </div>
                </div>
                <div className="flex flex-col justify-end">
                  <Label htmlFor="pretreat-p-feed-reject" className="text-xs text-muted-foreground">ΔP (feed − reject)</Label>
                  <ComputedInput value={dp ?? ''} className={dpAlert ? 'border-danger text-danger font-semibold' : 'text-foreground font-medium'} id="pretreat-p-feed-reject"/>
                </div>
                <div className="flex flex-col justify-end">
                  <Label htmlFor="pretreat-reject" className="text-xs text-muted-foreground">Reject</Label>
                  <Input type="number" step="any" {...f('reject_pressure_psi')}
                    placeholder="Reject pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-reject"/>
                </div>
              </div>
            </div>

            {/* ── EM flow override ────────────────────────────────────────── */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">
                  Electromagnetic Flowmeter (m³/hr)
                </p>
                <p className="text-2xs text-muted-foreground/60 italic">
                  {emEntered === 0 && 'Enter any two — third auto-computes'}
                  {emEntered === 1 && 'Enter one more — third will be computed'}
                  {emEntered === 2 && 'One value computed from the other two'}
                  {emEntered === 3 && 'All three manually entered'}
                </p>
              </div>
              <div className={`grid gap-2 ${[showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length === 3 ? 'grid-cols-3' : [showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {/* Feed EM */}
                {showFeedMeter && (
                <div className="space-y-1">
                  <Label htmlFor="pretreat-feed-flowrate" className={cn('text-xs', emFeedInferred ? 'text-info' : 'text-muted-foreground')}>
                    Feed Flowrate{emFeedInferred ? ' (computed)' : ''}
                  </Label>
                  {emFeedInferred ? (
                    <ComputedInput
                      value={effFeedFlow != null ? String(effFeedFlow) : ''}
                      className="border-info text-info font-semibold"
                    />
                  ) : (
                    <Input type="number" step="any" {...f('feed_flow')}
                      placeholder={feedFlowMeter != null ? `≈ ${feedFlowMeter} (meter)` : 'EM reading'}
                      className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-feed-flowrate"/>
                  )}
                </div>
                )}
                {/* Permeate EM */}
                {showPermeateMeter && (
                <div className="space-y-1">
                  <Label htmlFor="pretreat-field-3" className={cn('text-xs', emPermInferred ? 'text-info' : 'text-muted-foreground')}>
                    {meterCfg.ro_production_source === 'permeate' ? 'Production Flowrate' : 'Permeate Flowrate'}{emPermInferred ? ' (computed)' : ''}
                  </Label>
                  {emPermInferred ? (
                    <ComputedInput
                      value={effPermFlow != null ? String(effPermFlow) : ''}
                      className="border-info text-info font-semibold"
                    />
                  ) : (
                    <Input type="number" step="any" {...f('permeate_flow')}
                      placeholder={permFlowMeter != null ? `≈ ${permFlowMeter} (meter)` : 'EM reading'}
                      className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-field-3"/>
                  )}
                  <div className="mt-1">
                    <Label htmlFor="pretreat-recovery" className={cn('text-xs', recWarn ? 'text-warn' : 'text-muted-foreground')}>
                      Recovery %{recWarn ? ' ⚠' : ''}
                    </Label>
                    <ComputedInput value={recovery != null ? String(recovery) : ''} className={recWarn ? 'border-warn text-warn-foreground font-semibold' : 'text-foreground font-medium'} id="pretreat-recovery"/>
                  </div>
                </div>
                )}
                {/* Reject EM */}
                {showRejectMeter && (
                <div className="space-y-1">
                  <Label htmlFor="pretreat-reject-flowrate" className={cn('text-xs', emRejInferred ? 'text-info' : 'text-muted-foreground')}>
                    Reject Flowrate{emRejInferred ? ' (computed)' : ''}
                  </Label>
                  {emRejInferred ? (
                    <ComputedInput
                      value={effRejFlow != null ? String(effRejFlow) : ''}
                      className="border-info text-info font-semibold"
                    />
                  ) : (
                    <Input type="number" step="any" {...f('reject_flow')}
                      placeholder={rejFlowMeter != null ? `≈ ${rejFlowMeter} (meter)` : 'EM reading'}
                      className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-reject-flowrate"/>
                  )}
                </div>
                )}
              </div>
            </div>

            {/* ── TDS row ──────────────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">TDS (ppm)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="pretreat-feed-tds" className="text-xs text-muted-foreground">Feed TDS</Label><Input type="number" step="any" {...f('feed_tds')} id="pretreat-feed-tds"/></div>
                <div><Label htmlFor="pretreat-permeate-tds" className="text-xs text-muted-foreground">Permeate TDS</Label><Input type="number" step="any" {...f('permeate_tds')} id="pretreat-permeate-tds"/></div>
                <div><Label htmlFor="pretreat-reject-tds" className="text-xs text-muted-foreground">Reject TDS</Label><Input type="number" step="any" {...f('reject_tds')} id="pretreat-reject-tds"/></div>
              </div>
              {/* Rejection + Salt Passage in their own row below TDS inputs */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <Label htmlFor="pretreat-salt-rejection" className="text-xs text-muted-foreground">Salt Rejection %</Label>
                  <ComputedInput value={rejection ?? ''} className="text-foreground font-medium" id="pretreat-salt-rejection"/>
                </div>
                <div>
                  <Label htmlFor="pretreat-salt-passage" className="text-xs text-muted-foreground">Salt Passage %</Label>
                  <ComputedInput value={saltPassage ?? ''} className="text-foreground font-medium" id="pretreat-salt-passage"/>
                </div>
              </div>
            </div>

            {/* ── pH row ───────────────────────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">pH</p>
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="pretreat-feed-ph" className="text-xs text-muted-foreground">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} id="pretreat-feed-ph"/></div>
                <div><Label htmlFor="pretreat-permeate-ph" className="text-xs text-muted-foreground">Permeate pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} id="pretreat-permeate-ph"/></div>
                <div><Label htmlFor="pretreat-reject-ph" className="text-xs text-muted-foreground">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} id="pretreat-reject-ph"/></div>
              </div>
            </div>

            {/* ── Product quality / ambient ────────────────────────────────── */}
            <div className="space-y-0.5">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Product Quality</p>
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="pretreat-product-turbidity-ntu" className="text-xs text-muted-foreground">Product Turbidity (NTU)</Label><Input type="number" step="any" {...f('turbidity_ntu')} id="pretreat-product-turbidity-ntu"/></div>
                <div><Label htmlFor="pretreat-product-temperature-c" className="text-xs text-muted-foreground">Product Temperature (°C)</Label><Input type="number" step="any" {...f('temperature_c')} id="pretreat-product-temperature-c"/></div>
                <div><Label htmlFor="pretreat-product-chlorine-residual-mg-l" className="text-xs text-muted-foreground">Product Chlorine Residual (mg/L)</Label><Input type="number" step="any" min="0" {...f('chlorine_residual_mg_l')} id="pretreat-product-chlorine-residual-mg-l"/></div>
              </div>
            </div>
          </Card>

          {/* ── Power Meter ──────────────────────────────────────────────────── */}
          {/* Show when per-train electricity meter is enabled in meter config.
              When disabled, plant-level power is tracked via Operations → Power tab instead. */}
          {showPowerMeter && (
          <Card className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Power Meter (per train)</h4>
              <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/70">
                <span>Duration:</span>
                <span className="font-mono font-medium">{autoDurationMin != null ? `${autoDurationMin} min` : '—'}</span>
              </div>
            </div>

            {/* Shared meter warning banner */}
            {isSharedPowerMeter && (
              <div className="rounded-md bg-warn-soft border border-warn px-2.5 py-2 text-xs text-warn space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold">
                  <span>⚡ Shared power meter</span>
                  <span className="font-mono text-2xs bg-warn-soft px-1.5 py-0.5 rounded">
                    group: {sharedPowerGroup}
                  </span>
                </div>
                <p className="opacity-80">
                  This train shares one physical meter with{' '}
                  {siblingTrains?.length
                    ? siblingTrains.map((t: any) => `Train ${t.train_number}${t.name ? ` (${t.name})` : ''}`).join(', ')
                    : 'other trains in this group'}.
                  Enter the <strong>same meter reading</strong> on each train.
                  The full kWh delta is saved here — volume-weighted allocation happens in reports.
                </p>
                <p className="opacity-60 italic">
                  Specific energy shown below is an estimate (full meter ÷ this train's permeate only).
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="pretreat-prev-reading-kwh" className="text-xs text-muted-foreground">
                  Prev reading (kWh){prevPowerMeter != null ? ' — auto' : ' — enter manually (first reading)'}
                </Label>
                <ComputedInput value={prevPowerMeter != null ? String(prevPowerMeter) : ''} className="text-foreground font-medium" id="pretreat-prev-reading-kwh"/>
              </div>
              <div>
                <Label htmlFor="pretreat-current-reading-kwh" className="text-xs text-muted-foreground">Current reading (kWh)</Label>
                <Input type="number" step="any" {...f('power_meter_curr')} placeholder="e.g. 12456.8" id="pretreat-current-reading-kwh"/>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="pretreat-consumption-kwh" className="text-xs text-muted-foreground">Δ Consumption (kWh)</Label>
                <ComputedInput value={pwrDelta ?? ''} className="text-foreground font-medium" id="pretreat-consumption-kwh"/>
              </div>
              <div>
                <Label htmlFor="pretreat-avg-power-kw" className="text-xs text-muted-foreground">Avg power (kW)</Label>
                <ComputedInput value={pwrKw ?? ''} className="text-foreground font-medium" id="pretreat-avg-power-kw"/>
              </div>
              <div>
                <Label htmlFor="pretreat-specific-energy-kwh-m" className={cn('text-xs', isSharedPowerMeter ? 'text-warn' : 'text-muted-foreground')}>
                  Specific energy (kWh/m³){isSharedPowerMeter ? ' ≈ est.' : ''}
                </Label>
                <ComputedInput
                  value={secEnergy ?? ''}
                  className={isSharedPowerMeter ? 'border-warn text-warn font-medium' : 'text-foreground font-medium'}
                id="pretreat-specific-energy-kwh-m"/>
              </div>
            </div>
          </Card>
          )}
          {!showPowerMeter && (
          <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            ⚡ Per-train power meter not configured for this plant — energy consumption is tracked plant-wide in the <strong className="font-medium">Power tab</strong>.
          </div>
          )}

          <Card className="p-3 space-y-2">
            <Label htmlFor="pretreat-remarks" className="text-xs text-muted-foreground">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any observations..." id="pretreat-remarks"/>
          </Card>
          </>
          )}

        </>
        )}

        {/* ── Save button ────────────────────────────────────────────────────────
            Shown in two situations:
            1. Train is offline — operator has filled reason + start time and wants
               to record the offline event (no RO parameters needed).
            2. Train is online and all step sections have been acknowledged —
               normal end-of-form save.
            Placed outside both the isOfflineBlocked gate and the step gate so it
            is always reachable regardless of which path the operator took. */}
        {roReasonNeeded && trainOnline && (
          <Card className="p-3 border-warn bg-warn-soft/50">
            <Label htmlFor="pretreat-reason-for-missing-ro-vessel-value-s-required-to-sa" className="text-xs text-warn">
              Reason for missing RO Vessel value(s) — required to save
            </Label>
            <Textarea
              value={roIncompleteReason}
              onChange={(e) => setRoIncompleteReason(e.target.value)}
              placeholder="e.g. Turbidity meter offline for recalibration, vendor on-site tomorrow"
              className="text-xs"
            id="pretreat-reason-for-missing-ro-vessel-value-s-required-to-sa"/>
          </Card>
        )}
        {train && (!trainOnline || cartridgeSectionStarted) && (
          <Button onClick={submit} disabled={isSaving || anomalyRemarksMissing} className="w-full h-12 text-base font-semibold gap-2">
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSaving ? 'Saving…' : !trainOnline ? 'Save Offline Record' : 'Save Pre-Treatment & RO Reading'}
          </Button>
        )}
      </>
      )}

      {!train && plantId && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Select a train to log pre-treatment and RO data</Card>
      )}
    </div>
  );
}
