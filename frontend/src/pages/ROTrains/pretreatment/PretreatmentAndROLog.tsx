import { useState, useMemo, useEffect, useRef } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { calc, ALERTS } from '@/lib/calculations';
import { evaluateROMeterSpike, computeROAverageFlowRate } from '@/lib/roReadingGuards';
import { getHourBucket, isOfflineRORecord } from '@/lib/hourlyReadingGuard';
import { isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ComputedInput } from '@/components/ComputedInput';
import { DateTimePicker } from '@/components/ui/date-picker';
import { ExportButton } from '@/components/ExportButton';
import { Upload, AlertTriangle, Loader2, Building2, Gauge, Power, ShieldAlert, Lock, CheckCircle2, Clock, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImportROReadingsDialog } from '../../ro-trains';

import { AfmRow, STANDARD_OFFLINE_REASONS } from './types';
import { OfflineWarningNotice, OfflineDetailsPanel, OfflineLockedCard } from './components/OfflineTrainBanner';
import { AfmMmfSection } from './components/AfmMmfSection';
import { BoosterPumpSection } from './components/BoosterPumpSection';
import { PretreatmentSection } from './components/PretreatmentSection';
import { RoVesselSection } from './components/RoVesselSection';
import { usePretreatmentActions } from './hooks/usePretreatmentActions';

export function PretreatmentAndROLog() {
  const qc = useQueryClient();
  // ── Use activeOperator, not user ──────────────────────────────────────────
  // On shared-email accounts (e.g. resourcespilipinaswater@gmail.com) user.id
  // is always the auth-owner (Reynan). activeOperator reflects whoever was
  // selected on the operator-picker screen or switched via OperatorSwitcher.
  const { activeOperator, isManager } = useAuth();
  const [showImport, setShowImport] = useState(false);
  const { selectedPlantId, setSelectedPlantId, addAlerts } = useAppStore();
  const { data: plants } = usePlants();

  // Persist plant + train selection across tab switches / browser-focus changes
  const [plantId, setPlantIdState] = useState<string>(() => {
    try { return selectedPlantId || sessionStorage.getItem('pretreat:plantId') || ''; } catch { return ''; }
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
  // Explicit "yes, this is really back online" acknowledgment — required
  // before a normal save is allowed to clear a DB status of 'Offline'.
  // trainOnline itself defaults to true on a fresh page load/session even
  // when the DB says Offline (see the DB-status-awareness effect below,
  // which deliberately does NOT flip trainOnline to false — auto-locking
  // the form that way was the original bug). That means "checked" alone
  // isn't evidence of an operator decision; it might just be the default.
  // This flag tracks whether an operator actually made that call this
  // session, either by ticking the confirmation box in the warning banner,
  // or by completing the explicit Offline→Online toggle (which already
  // requires entering a Back Online At time — see the checkbox handler).
  const [confirmBackOnline, setConfirmBackOnline] = useState(false);

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

  // ── Sync with global plant selector (TopBar) ───────────────────────────────
  // Whenever selectedPlantId in the TopBar changes, immediately switch this page's
  // active plant and clear train selection so the page reflects the new plant.
  const lastSyncedPlantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlantId || selectedPlantId === lastSyncedPlantRef.current) return;
    lastSyncedPlantRef.current = selectedPlantId;
    setPlantId(selectedPlantId);
    setTrainId('');
  }, [selectedPlantId]);

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

  // ── Unclosed Offline Record & User Accountability ──────────────────────────
  // Queries the most recent event from train_status_log to maintain context,
  // visibility of reason & start time, and display who previously set the train offline.
  const { data: latestStatusLog } = useQuery({
    queryKey: ['train-latest-status-log', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('train_status_log')
        .select('id, train_id, plant_id, status, reason, confirmed_by, confirmed_at')
        .eq('train_id', trainId)
        .order('confirmed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;

      let operatorInfo: { username?: string | null; full_name?: string | null } | null = null;
      if (data.confirmed_by) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('username, first_name, last_name')
          .eq('id', data.confirmed_by)
          .maybeSingle();
        if (profile) {
          const fn = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
          operatorInfo = {
            username: profile.username ? `@${profile.username}` : null,
            full_name: fn || profile.username || 'Operator',
          };
        }
      }
      return { ...data, operator: operatorInfo };
    },
    staleTime: 10_000,
  });

  // ── Section-step gating: AFM/MMF must be opened before Booster Pumps ────────
  // Operators must interact with (not necessarily complete) AFM/MMF before they
  // can access Booster Pumps, and Booster Pumps before the rest of the form.
  // Both flags reset each time a new train is selected.
  const [afmSectionStarted, setAfmSectionStarted] = useState(false);
  const [boosterHppSectionStarted, setBoosterHppSectionStarted] = useState(false);
  const [cartridgeSectionStarted, setCartridgeSectionStarted] = useState(false);

  // ── In-flight save guard ─────────────────────────────────────────────────

  // ── Missing-value override notes (per-unit and section-level) ─────────────
  // Every unit/field in each section is now required to proceed/save. When an
  // operator cannot supply a value, they must provide a reason for each
  // specific unit with missing data.
  const [afmReasonNeeded, setAfmReasonNeeded] = useState(false);
  const [afmUnitReasons, setAfmUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});

  const [boosterReasonNeeded, setBoosterReasonNeeded] = useState(false);
  const [boosterUnitReasons, setBoosterUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});
  const [hppUnitReason, setHppUnitReason] = useState<{ reason: string; custom: string }>({ reason: '', custom: '' });

  const [housingReasonNeeded, setHousingReasonNeeded] = useState(false);
  const [cartridgeUnitReasons, setCartridgeUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});
  const [housingUnitReasons, setHousingUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});

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
    setAfmReasonNeeded(false); setAfmUnitReasons({});
    setBoosterReasonNeeded(false); setBoosterUnitReasons({}); setHppUnitReason({ reason: '', custom: '' });
    setHousingReasonNeeded(false); setCartridgeUnitReasons({}); setHousingUnitReasons({});
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

  // ── Sync trainOnline to the train's real DB status & unclosed offline record ──
  const statusSyncedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!train || train.id !== trainId) return;
    if (statusSyncedForRef.current === train.id) return;
    statusSyncedForRef.current = train.id;

    let hasRestoredOffline = false;
    try { hasRestoredOffline = !!sessionStorage.getItem(`pretreat:offline:${trainId}`); } catch { /* ignore */ }
    if (hasRestoredOffline) return;

    setTrainOnline(train.status !== 'Offline');
  }, [train, trainId]);

  // ── Sync unclosed offline event details from database ───────────────────────
  // If the train is currently offline, ensure the reason and start time remain
  // visible on the interface to prevent loss of context.
  useEffect(() => {
    if (!trainId || !latestStatusLog) return;
    if (latestStatusLog.status === 'Offline') {
      setTrainOnline(false);
      setOfflineStart((prev) => prev || (latestStatusLog.confirmed_at ? format(new Date(latestStatusLog.confirmed_at), "yyyy-MM-dd'T'HH:mm") : ''));
      if (latestStatusLog.reason) {
        setOfflineReason((prev) => {
          if (prev) return prev;
          if (STANDARD_OFFLINE_REASONS.includes(latestStatusLog.reason!)) {
            return latestStatusLog.reason!;
          }
          setOfflineReasonOther(latestStatusLog.reason!);
          return 'Other';
        });
      }
    }
  }, [trainId, latestStatusLog]);

  // ── Persist offline state to sessionStorage so it survives train-switching ──
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
      // No longer relevant once the DB itself isn't Offline (either the
      // save that needed it already went through and flipped the status,
      // or something else resolved it) — moot either way, but reset it
      // so it doesn't linger true for a stale reason if this train later
      // gets auto-flagged Offline again this same session.
      setConfirmBackOnline(false);
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

  const f = (k: keyof typeof roValues) => ({ value: roValues[k], onChange: (e: any) => setRoValues({ ...roValues, [k]: e.target.value }) });

  const {
    submit,
    isSaving: hookIsSaving,
    setIsSaving,
  } = usePretreatmentActions({
    plantId,
    trainId,
    train,
    trainOnline,
    confirmBackOnline,
    dt,
    roValues,
    roIncompleteReason,
    setRoIncompleteReason,
    setRoReasonNeeded,
    anomalyRemarksMissing,
    offlineStart,
    offlineReason,
    offlineReasonOther,
    offlineEnd,
    setTrainOnline,
    setOfflineStart,
    setOfflineEnd,
    setOfflineReason,
    setOfflineReasonOther,
    setRoValues,
    afmmf,
    boosters,
    housings,
    cartridgeHousings,
    isSynchronized,
    showFeedMeter,
    showPermeateMeter,
    showRejectMeter,
    syncBwOn,
    syncBwStart,
    syncBwEnd,
    syncMeterStart,
    syncMeterEnd,
    setAfmmf,
    setBoosters,
    setHousings,
    setCartridgeHousings,
    setSyncBwOn,
    setSyncBwStart,
    setSyncBwEnd,
    setSyncMeterStart,
    setSyncMeterEnd,
    boosterPrefPsi,
    hppTarget,
    setHppTarget,
    bagsChanged,
    setBagsChanged,
    remarks,
    setRemarks,
    afmUnitReasons,
    boosterUnitReasons,
    hppUnitReason,
    cartridgeUnitReasons,
    housingUnitReasons,
    setAfmReasonNeeded,
    setAfmUnitReasons,
    setBoosterReasonNeeded,
    setBoosterUnitReasons,
    setHppUnitReason,
    setHousingReasonNeeded,
    setCartridgeUnitReasons,
    setHousingUnitReasons,
    setAfmSectionStarted,
    setBoosterHppSectionStarted,
    setCartridgeSectionStarted,
    setConfirmBackOnline,
    setAnomalyRemarkFeed,
    setAnomalyRemarkPerm,
    setAnomalyRemarkRej,
    anomalyRemarkFeed,
    anomalyRemarkPerm,
    anomalyRemarkRej,
    numAfm: train?.num_afm ?? 0,
    numBoosterPumps: train?.num_booster_pumps ?? 0,
    numCartridgeFilters: train?.num_cartridge_filters ?? 0,
    numFilterHousings: train?.num_filter_housings ?? 0,
    feedCurr: feedCurr,
    permCurr: permCurr,
    rejCurr: rejCurr,
    prevFeedMeter,
    prevPermMeter,
    prevRejMeter,
    feedDelta,
    permDelta,
    rejDelta,
    effFeedFlow,
    effPermFlow,
    rejectFlow,
    recovery,
    rejection,
    saltPassage,
    dp,
    pwrCurr,
    prevPowerMeter,
    pwrDelta,
    pwrKw,
    secEnergy,
    sharedPowerGroup,
    feedHighWarn,
    permHighWarn,
    rejHighWarn,
    feedSpike,
    permSpike,
    rejSpike,
    feedNeedsRemark,
    permNeedsRemark,
    rejNeedsRemark,
    anyMeterSpike,
    mDurHr,
    qc,
    activeOperator,
    addAlerts,
    supabase,
  });

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

      <Card className="p-4 space-y-4 border-border/80 shadow-xs">
        {/* Plant + Train Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pretreat-plant" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
              <Building2 className="h-3.5 w-3.5 text-primary" /> Plant
            </Label>
            <Select
              value={plantId}
              onValueChange={(v) => {
                lastSyncedPlantRef.current = v;
                setPlantId(v);
                setTrainId('');
                setSelectedPlantId(v);
              }}
            >
              <SelectTrigger className="h-9 font-medium" id="pretreat-plant">
                <SelectValue placeholder="Select Plant" />
              </SelectTrigger>
              <SelectContent>
                {plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pretreat-train" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
              <Gauge className="h-3.5 w-3.5 text-primary" /> Train
            </Label>
            <Select value={trainId} onValueChange={setTrainId} disabled={!plantId}>
              <SelectTrigger className="h-9 font-medium" id="pretreat-train">
                <SelectValue placeholder="Select Train" />
              </SelectTrigger>
              <SelectContent>
                {trains?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name ?? `Train ${t.train_number}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="pretreat-reading-date-amp-time" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" /> Reading Timestamp
              </Label>
              {isManager ? (
                <span className="text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  Manager Edit
                </span>
              ) : (
                <span className="text-3xs font-medium text-muted-foreground">
                  Current Hour
                </span>
              )}
            </div>
            <DateTimePicker
              value={dt}
              onChange={isManager ? (val) => setDt(val) : undefined}
              disabled={!isManager}
              placeholder="Select reading timestamp..."
              size="default"
              className={cn(
                "w-full font-mono-num",
                !isManager && "cursor-not-allowed opacity-80 bg-muted/30"
              )}
              id="pretreat-reading-date-amp-time"
            />
          </div>
        </div>

        {/* Online / Offline Status Segmented Bar — shown once a train is picked */}
        {train && (
          <div className="pt-2 border-t border-border/50">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!trainOnline) {
                    if (!offlineEnd) {
                      toast.error('Please enter a "Back Online At" time before marking the train as Online.');
                      return;
                    }
                    setConfirmBackOnline(true);
                  }
                  setTrainOnline(true);
                  setOfflineStart('');
                  setOfflineEnd('');
                  setOfflineReason('');
                  setOfflineReasonOther('');
                }}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border text-left transition-all',
                  trainOnline
                    ? 'border-accent bg-accent-soft/70 shadow-xs ring-1 ring-accent/30'
                    : 'border-border/60 bg-muted/20 hover:bg-muted/40 opacity-70'
                )}
              >
                <div className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all',
                  trainOnline ? 'bg-accent text-accent-foreground shadow-sm' : 'bg-muted text-muted-foreground'
                )}>
                  <Power className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold uppercase tracking-wider', trainOnline ? 'text-accent' : 'text-muted-foreground')}>
                      Operational / Running
                    </span>
                    {trainOnline && <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />}
                  </div>
                  <p className="text-2xs text-muted-foreground truncate">
                    Ready to log RO pressures, TDS, flows & backwash
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTrainOnline(false);
                }}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border text-left transition-all',
                  !trainOnline
                    ? 'border-danger bg-danger-soft/80 shadow-xs ring-1 ring-danger/30'
                    : 'border-border/60 bg-muted/20 hover:bg-muted/40 opacity-70'
                )}
              >
                <div className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all',
                  !trainOnline ? 'bg-danger text-danger-foreground shadow-sm' : 'bg-muted text-muted-foreground'
                )}>
                  <ShieldAlert className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold uppercase tracking-wider', !trainOnline ? 'text-danger font-semibold' : 'text-muted-foreground')}>
                      Offline / Not Running
                    </span>
                    {!trainOnline && <span className="inline-block h-2 w-2 rounded-full bg-danger animate-pulse" />}
                  </div>
                  <p className="text-2xs text-muted-foreground truncate">
                    Log downtime event, maintenance, trip or outage
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Warning banner: DB says this train is Offline but form is in online mode */}
        {train && (
          <OfflineWarningNotice
            trainOnline={trainOnline}
            dbStatus={train.status}
            confirmBackOnline={confirmBackOnline}
            onConfirmBackOnline={setConfirmBackOnline}
          />
        )}

        {/* Offline Details Panel — shown when train is marked offline */}
        {train && !trainOnline && (
          <OfflineDetailsPanel
            offlineReason={offlineReason}
            offlineReasonOther={offlineReasonOther}
            offlineStart={offlineStart}
            offlineEnd={offlineEnd}
            latestStatusLog={latestStatusLog}
            onOfflineReasonChange={setOfflineReason}
            onOfflineReasonOtherChange={setOfflineReasonOther}
            onOfflineStartChange={setOfflineStart}
            onOfflineEndChange={setOfflineEnd}
          />
        )}

        {plant && (
          <div className="flex items-center justify-between text-2xs text-muted-foreground pt-1 border-t border-border/30">
            <span>Plant Backwash Architecture:</span>
            <span className="font-semibold text-foreground px-2 py-0.5 rounded bg-muted/40 border border-border/40">
              {isSynchronized ? 'Synchronized (Whole Train at Once)' : 'Independent (Per Unit)'}
            </span>
          </div>
        )}
      </Card>

      {train && (
        <>
          {/* ── Offline gate: lock all parameter inputs when train is offline with no end time ── */}
          {isOfflineBlocked && (
            <OfflineLockedCard
              offlineReasonFinal={offlineReasonFinal}
              offlineStart={offlineStart}
              latestStatusLog={latestStatusLog}
            />
          )}

          {!isOfflineBlocked && (
          <>
          <AfmMmfSection
            train={train}
            isSynchronized={isSynchronized}
            afmmf={afmmf}
            setAfmmfField={setAfmmfField}
            syncBwOn={syncBwOn}
            setSyncBwOn={setSyncBwOn}
            syncBwStart={syncBwStart}
            setSyncBwStart={setSyncBwStart}
            syncBwEnd={syncBwEnd}
            setSyncBwEnd={setSyncBwEnd}
            syncMeterStart={syncMeterStart}
            setSyncMeterStart={setSyncMeterStart}
            syncMeterEnd={syncMeterEnd}
            setSyncMeterEnd={setSyncMeterEnd}
            prevMeterEndByUnit={prevMeterEndByUnit}
            afmSectionStarted={afmSectionStarted}
            setAfmSectionStarted={setAfmSectionStarted}
            afmReasonNeeded={afmReasonNeeded}
            setAfmReasonNeeded={setAfmReasonNeeded}
            afmUnitReasons={afmUnitReasons}
            setAfmUnitReasons={setAfmUnitReasons}
          />
          {(afmSectionStarted || train.num_afm === 0) && (
            <BoosterPumpSection
              train={train}
              numBoosterPumps={train.num_booster_pumps}
              boosters={boosters}
              setBoosters={setBoosters}
              boosterConfig={boosterConfig}
              boosterPrefPsi={boosterPrefPsi}
              setBoosterPrefPsi={setBoosterPrefPsi}
              BOOSTER_MODE_KEY={BOOSTER_MODE_KEY}
              hppTarget={hppTarget}
              setHppTarget={setHppTarget}
              bagsChanged={bagsChanged}
              setBagsChanged={setBagsChanged}
              boosterHppSectionStarted={boosterHppSectionStarted}
              setBoosterHppSectionStarted={setBoosterHppSectionStarted}
              boosterReasonNeeded={boosterReasonNeeded}
              setBoosterReasonNeeded={setBoosterReasonNeeded}
              boosterUnitReasons={boosterUnitReasons}
              setBoosterUnitReasons={setBoosterUnitReasons}
              hppUnitReason={hppUnitReason}
              setHppUnitReason={setHppUnitReason}
            />
          )}
          {boosterHppSectionStarted && (
            <PretreatmentSection
              train={train}
              numCartridgeFilters={train.num_cartridge_filters}
              numFilterHousings={train.num_filter_housings}
              cartridgeHousings={cartridgeHousings}
              setCartridgeHousings={setCartridgeHousings}
              housings={housings}
              setHousings={setHousings}
              cartridgeHousingLabel={cartridgeHousingLabel}
              changedElementLabel={changedElementLabel}
              bagsChanged={bagsChanged}
              setBagsChanged={setBagsChanged}
              cartridgeSectionStarted={cartridgeSectionStarted}
              setCartridgeSectionStarted={setCartridgeSectionStarted}
              housingReasonNeeded={housingReasonNeeded}
              setHousingReasonNeeded={setHousingReasonNeeded}
              cartridgeUnitReasons={cartridgeUnitReasons}
              setCartridgeUnitReasons={setCartridgeUnitReasons}
              housingUnitReasons={housingUnitReasons}
              setHousingUnitReasons={setHousingUnitReasons}
            />
          )}
          {cartridgeSectionStarted && (
            <RoVesselSection
              train={train}
              showFeedMeter={showFeedMeter}
              showPermeateMeter={showPermeateMeter}
              showRejectMeter={showRejectMeter}
              showPowerMeter={showPowerMeter}
              isSharedPowerMeter={isSharedPowerMeter}
              sharedPowerGroup={sharedPowerGroup}
              siblingTrains={siblingTrains}
              roValues={roValues}
              onFieldChange={f}
              autoDurationMin={autoDurationMin}
              prevFeedMeter={prevFeedMeter}
              prevPermMeter={prevPermMeter}
              prevRejMeter={prevRejMeter}
              feedNegWarn={feedNegWarn}
              permNegWarn={permNegWarn}
              rejNegWarn={rejNegWarn}
              feedSpike={feedSpike}
              permSpike={permSpike}
              rejSpike={rejSpike}
              feedNeedsRemark={feedNeedsRemark}
              permNeedsRemark={permNeedsRemark}
              rejNeedsRemark={rejNeedsRemark}
              anomalyRemarkFeed={anomalyRemarkFeed}
              setAnomalyRemarkFeed={setAnomalyRemarkFeed}
              anomalyRemarkPerm={anomalyRemarkPerm}
              setAnomalyRemarkPerm={setAnomalyRemarkPerm}
              anomalyRemarkRej={anomalyRemarkRej}
              setAnomalyRemarkRej={setAnomalyRemarkRej}
              feedInferred={feedInferred}
              permInferred={permInferred}
              rejInferred={rejInferred}
              effFeedFlow={effFeedFlow}
              effPermFlow={effPermFlow}
              effRejFlow={effRejFlow}
              permVol={permVol}
              rejVol={rejVol}
              feedVol={feedVol}
              feedFlowMeter={feedFlowMeter}
              permFlowMeter={permFlowMeter}
              rejFlowMeter={rejFlowMeter}
              recovery={recovery}
              recWarn={recWarn}
              dp={dp}
              dpAlert={dpAlert}
              pwrDelta={pwrDelta}
              pwrKw={pwrKw}
              secEnergy={secEnergy}
              prevPowerMeter={prevPowerMeter}
              productionLabel={productionLabel}
              remarks={remarks}
              setRemarks={setRemarks}
              meterCfg={meterCfg}
              emEntered={emEntered}
              emFeedInferred={emFeedInferred}
              emPermInferred={emPermInferred}
              emRejInferred={emRejInferred}
              phWarn={phWarn}
              rejection={rejection}
              saltPassage={saltPassage}
            />
          )}
          </>
          )}{train && (!trainOnline || cartridgeSectionStarted) && (
          <Button onClick={submit} disabled={hookIsSaving || anomalyRemarksMissing} className="w-full h-12 text-base font-semibold gap-2">
            {hookIsSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {hookIsSaving ? 'Saving…' : !trainOnline ? 'Save Offline Record' : 'Save Pre-Treatment & RO Reading'}
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
