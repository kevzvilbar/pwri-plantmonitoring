import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDraft } from '@/hooks/useDraft';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { fmtNum, getCurrentPosition } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { evaluateReadingGuard, SPIKE_MULTIPLIER } from '@/lib/readingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { WELL_MAX_READINGS_PER_DAY, formatCooldown } from '@/pages/operations/shared';
import { CalendarClock, MessageCircleOff, Pencil, X, History, AlertCircle, ArrowUpRight, Loader2, Zap } from 'lucide-react';
import { OdometerRollerInput, type OdometerAlertState } from '@/components/OdometerRollerInput';

export interface UseWellRowActionsOptions {
  well: any;
  plantId: string;
  previousMeter: number | null;
  previousPower: number | null;
  previousDt: string | null;
  freshDt?: string | null;
  avgVol: number | null;
  todayReadings: any[];
  userId: string | undefined;
  isBlending: boolean;
  onSaved: () => void;
  isManagerOrAdmin: boolean;
  canAutoApprove: boolean;
  isInSharedPowerGroup: boolean;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  activeOperator?: any;
}

export function useWellRowActions({
  well, plantId, previousMeter, previousPower, previousDt, freshDt, avgVol,
  todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, canAutoApprove,
  isInSharedPowerGroup, sharedPower, gapReason, onGapReasonSaved, activeOperator,
}: UseWellRowActionsOptions) {
  const [reading, setReading] = useState('');
  const lastPrefilledMeter = useRef<string | null>(null);
  const [powerReading, setPowerReading] = useState('');
  const [tdsReading, setTdsReading] = useState('');
  const [ntuReading, setNtuReading] = useState('');
  const [pressureReading, setPressureReading] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBefore, setEditBefore] = useState<Record<string, unknown> | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingTds, setSavingTds] = useState(false);
  const [savingNtu, setSavingNtu] = useState(false);
  const [savingPressure, setSavingPressure] = useState(false);
  const [savingPower, setSavingPower] = useState(false);
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  const [sharedPowerReading, setSharedPowerReading] = useState('');
  const [savingSharedPower, setSavingSharedPower] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  const defaultRolloverMax = well.meter_rollover_max != null ? String(well.meter_rollover_max) : '99999';
  const [isRollover, setIsRollover] = useState(false);
  const [rolloverMax, setRolloverMax] = useState(defaultRolloverMax);
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);
  const [wellLastSavePending, setWellLastSavePending] = useState(false);

  const { draft: draftWell, setDraft: setDraftWell, clearDraft: clearDraftWell } =
    useDraft(`well-reading-${well.id}`, { value: '' });

  useEffect(() => {
    if (reading === '' && draftWell.value) setReading(draftWell.value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editingId || previousMeter == null) return;
    const expected = previousMeter.toFixed(2);
    if (reading === '' || reading === lastPrefilledMeter.current) {
      setReading(expected);
      lastPrefilledMeter.current = expected;
    }
  }, [previousMeter, reading, editingId]);

  const cur = useMemo(() => +reading || 0, [reading]);
  const meterChanged = useMemo(() => reading !== '' && (previousMeter == null || cur !== previousMeter), [reading, previousMeter, cur]);
  const dailyVol = useMemo(() => meterChanged && previousMeter != null ? cur - previousMeter : null, [meterChanged, previousMeter, cur]);
  const belowPrev = useMemo(() => previousMeter != null && cur > 0 && cur < previousMeter, [previousMeter, cur]);
  const hoursElapsedWell = useMemo(() => previousDt && reading ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000 : null, [previousDt, reading, customDt]);
  const wellFlowRate = useMemo(() => computeRate(dailyVol, hoursElapsedWell, undefined, true), [dailyVol, hoursElapsedWell]);
  const deviationWell = useMemo(() => classifyDeviation(wellFlowRate, avgVol, SPIKE_MULTIPLIER), [wellFlowRate, avgVol]);
  const highVol = useMemo(() => deviationWell.tier !== 'ok', [deviationWell]);
  const anomalyRemarkRequired = useMemo(() => deviationWell.tier !== 'ok' && !isAnomalyRemarkValid(anomalyRemark), [deviationWell, anomalyRemark]);
  const todayCount = todayReadings.length;
  const lastToday = todayReadings[0] ?? null;
  const atLimit = useMemo(() => !editingId && todayCount >= WELL_MAX_READINGS_PER_DAY, [editingId, todayCount]);
  const showDedicatedPower = well.has_power_meter && !isInSharedPowerGroup;

  const odometerAlert = useMemo<OdometerAlertState>(() => {
    if (!meterChanged) return 'neutral';
    if (belowPrev) return 'warn';
    if (highVol) return 'warn';
    if (+reading < 0) return 'error';
    return 'ok';
  }, [meterChanged, belowPrev, highVol, reading]);

  const save = useCallback(async () => {
    if (saving) return;
    if (!reading) { toast.error(`${well.name}: enter a meter reading`); return; }
    if (atLimit) { toast.error(`${well.name}: max ${WELL_MAX_READINGS_PER_DAY} readings/day reached`); return; }

    if (editingId && !isReasonComplete(editReason, editCustomReason)) {
      toast.error(`${well.name}: select a reason for this edit`);
      return;
    }

    if (!editingId && previousMeter != null && cur === previousMeter && !meterReplacePending) {
      if (hoursElapsedWell != null && hoursElapsedWell < 12) {
        toast.error(`${well.name}: this odometer reading (${fmtNum(cur, 1)}) was already recorded within the last 12 hours.`);
        return;
      }
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${well.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }

    let guardReason: 'backward' | 'spike' | null = null;

    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'well', well.id, plantId, userId, cur, new Date(customDt),
        !!meterReplacePending, false, avgVol, isRollover,
      );
      setSaving(false);

      if (guard.status === 'blocked' && guard.reason === 'cooldown') {
        toast.error(
          `${well.name}: cooldown — next reading available in ${formatCooldown(guard.minutesLeft)}.`,
          { duration: 6000 },
        );
        return;
      }
      if (guard.status === 'blocked' && guard.reason === 'duplicate') {
        toast.error(`${well.name}: ${guard.detail}`, { duration: 8000 });
        return;
      }
      if (guard.status === 'pending_review') {
        guardReason = guard.reason;
        toast.info(`${well.name}: ${guard.detail}`, { duration: 8000 });
      }
    }

    setSaving(true);
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    const rolloverMaxNum = isRollover ? Number(rolloverMax) : null;
    const rolloverDailyVol = isRollover && Number.isFinite(rolloverMaxNum) && previousMeter != null
      ? Math.max(0, (rolloverMaxNum as number) - previousMeter + cur)
      : null;

    const payload: any = {
      well_id: well.id, plant_id: plantId,
      current_reading: cur,
      daily_volume: isRollover ? rolloverDailyVol : (dailyVol != null ? dailyVol : null),
      is_meter_rollover: isRollover,
      meter_rollover_max: isRollover ? rolloverMaxNum : null,
      is_meter_replacement: !!meterReplacePending,
      power_meter_reading: showDedicatedPower && powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false, recorded_by: userId,
      reading_datetime: new Date(customDt).toISOString(),
    };
    if (tdsReading) payload.tds_ppm = +tdsReading;
    if (ntuReading) payload.turbidity_ntu = +ntuReading;
    if (pressureReading) payload.pressure_psi = +pressureReading;

    if (!editingId) {
      try {
        const dt = new Date(customDt);
        const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).toISOString();
        const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).toISOString();
        await supabase
          .from('well_readings')
          .delete()
          .eq('well_id', well.id)
          .eq('is_estimated', true)
          .gte('reading_datetime', dayStart)
          .lte('reading_datetime', dayEnd);
      } catch (err) {
        console.warn('[Operations] Failed to purge orphan estimate on same day:', err);
      }
    }

    const { data: savedRow, error } = editingId
      ? await (supabase.from('well_readings').update(payload).eq('id', editingId).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('well_readings').insert(payload).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      if (error.code === '23505') {
        toast.error(
          `${well.name}: a reading was already submitted for this time. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(friendlyError(error));
      }
      return;
    }

    if (editingId && editBefore) {
      const after: Record<string, unknown> = {
        current_reading: payload.current_reading,
        reading_datetime: payload.reading_datetime,
        daily_volume: payload.daily_volume ?? null,
        power_meter_reading: payload.power_meter_reading ?? null,
        is_meter_rollover: !!payload.is_meter_rollover,
        meter_rollover_max: payload.meter_rollover_max ?? null,
        is_meter_replacement: !!payload.is_meter_replacement,
      };
      if (payload.tds_ppm !== undefined) after.tds_ppm = payload.tds_ppm;
      if (payload.turbidity_ntu !== undefined) after.turbidity_ntu = payload.turbidity_ntu;
      if (payload.pressure_psi !== undefined) after.pressure_psi = payload.pressure_psi;
      await logReadingEdit({
        table_name: 'well_readings',
        record_id: editingId,
        plant_id: plantId,
        action: 'update',
        actor_user_id: userId ?? null,
        actor_label: `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
          || activeOperator?.username || null,
        changes: diffFields(editBefore, after),
        reason: resolveReason(editReason, editCustomReason),
      });
    }

    if (meterReplacePending?.replacementId && savedRow?.id) {
      await (supabase.from('well_meter_replacements' as any) as any)
        .update({ reading_id: savedRow.id })
        .eq('id', meterReplacePending.replacementId);
    }

    if (deviationWell.tier !== 'ok' && savedRow?.id) {
      void submitAnomalyRemark({
        table_name: 'well_readings',
        record_id: savedRow.id,
        plant_id: plantId,
        tier: deviationWell.tier,
        direction: deviationWell.direction!,
        deviation_pct: deviationWell.deviationPct!,
        flow_rate: deviationWell.rate,
        avg_flow_rate: deviationWell.avgRate,
        rate_unit: 'm3/hr',
        remark_text: anomalyRemark,
      });
    }
    setAnomalyRemark('');

    let isPending = savedRow?.norm_status === 'pending_review';

    let autoApproved = false;
    if (isPending && canAutoApprove && savedRow?.id) {
      const { error: autoErr } = await (supabase.rpc('fn_cascade_reading_correction', {
        p_table:       'well_readings',
        p_row_id:      savedRow.id,
        p_new_current: savedRow.current_reading,
        p_admin_id:    userId ?? null,
        p_reason:      `Auto-approved on entry — ${guardReason ?? 'flagged'} check bypassed for Manager/Admin, logged for tracing`,
      }) as any);
      if (!autoErr) { isPending = false; autoApproved = true; }
    }
    setWellLastSavePending(isPending);

    if (isPending) {
      toast.info(`${well.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else if (autoApproved) {
      toast.success(`${well.name}: saved — auto-approved (Manager/Admin), logged for tracing.`, { duration: 6000 });
    } else {
      const curr = savedRow?.current_reading;
      const prev = savedRow?.previous_reading;
      const vol  = savedRow?.daily_volume;
      toast.success(fmtSaveToast(well.name, editingId ? 'updated' : 'saved', curr, prev, vol), { duration: 5000 });
    }
    setReading(''); clearDraftWell(); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading('');
    setIsRollover(false); setRolloverMax(defaultRolloverMax);
    setMeterReplacePending(null); setShowReplaceMeter(false);
    if (editingId) {
      setEditBefore(null); setEditReason(''); setEditCustomReason('');
      setCustomDt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    }
    setEditingId(null); onSaved();
  }, [saving, reading, atLimit, editingId, editReason, editCustomReason, previousMeter, cur, hoursElapsedWell, meterReplacePending, anomalyRemarkRequired, anomalyRemark, userId, plantId, well, customDt, isRollover, rolloverMax, dailyVol, powerReading, tdsReading, ntuReading, pressureReading, showDedicatedPower, canAutoApprove, activeOperator, onSaved, defaultRolloverMax]);

  const savePower = useCallback(async () => {
    if (!powerReading) { toast.error(`${well.name}: enter a power reading`); return; }
    setSavingPower(true);
    const val = +powerReading;
    if (lastToday) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val }).eq('id', lastToday.id);
      setSavingPower(false);
      if (error) { toast.error(friendlyError(error)); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: well.id, plant_id: plantId,
        current_reading: previousMeter ?? 0, previous_reading: previousMeter,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingPower(false);
      if (error) { toast.error(friendlyError(error)); return; }
    }
    toast.success(`${well.name}: power saved`);
    setPowerReading(''); onSaved();
  }, [powerReading, well.name, well.id, plantId, lastToday, previousMeter, userId, customDt, onSaved]);

  const saveTds = useCallback(async () => {
    if (!tdsReading) { toast.error(`${well.name}: enter a TDS value`); return; }
    setSavingTds(true);
    const val = +tdsReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ tds_ppm: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          tds_ppm: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: TDS saved`);
      setTdsReading(''); onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
      console.error('saveTds error:', e);
    } finally { setSavingTds(false); }
  }, [tdsReading, well.name, well.id, plantId, lastToday, previousMeter, userId, customDt, onSaved]);

  const saveNtu = useCallback(async () => {
    if (!ntuReading) { toast.error(`${well.name}: enter a turbidity value`); return; }
    setSavingNtu(true);
    const val = +ntuReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ turbidity_ntu: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          turbidity_ntu: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: NTU saved`);
      setNtuReading(''); onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
      console.error('saveNtu error:', e);
    } finally { setSavingNtu(false); }
  }, [ntuReading, well.name, well.id, plantId, lastToday, previousMeter, userId, customDt, onSaved]);

  const savePressure = useCallback(async () => {
    if (!pressureReading) { toast.error(`${well.name}: enter a pressure value`); return; }
    setSavingPressure(true);
    const val = +pressureReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ pressure_psi: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          pressure_psi: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: pressure saved`);
      setPressureReading(''); onSaved();
    } catch (e) {
      toast.error(`Pressure save failed: ${friendlyError(e)}`);
      console.error('savePressure error:', e);
    } finally { setSavingPressure(false); }
  }, [pressureReading, well.name, well.id, plantId, lastToday, previousMeter, userId, customDt, onSaved]);

  const saveSharedPower = useCallback(async () => {
    if (!sharedPower || !sharedPowerReading) { toast.error(`${sharedPower?.groupName ?? 'Group'}: enter a power meter reading`); return; }
    setSavingSharedPower(true);
    const val = +sharedPowerReading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data: todayRecs } = await supabase
      .from('well_readings').select('id')
      .eq('well_id', sharedPower.primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false }).limit(1);
    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val }).eq('id', (todayRecs[0] as any).id);
      setSavingSharedPower(false);
      if (error) { toast.error(friendlyError(error)); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: sharedPower.primaryWellId, plant_id: plantId,
        current_reading: sharedPower.previousPower ?? 0,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingSharedPower(false);
      if (error) { toast.error(friendlyError(error)); return; }
    }
    toast.success(`${sharedPower.groupName}: power meter saved`);
    setSharedPowerReading(''); onSaved();
  }, [sharedPower, sharedPowerReading, well.id, plantId, userId, customDt, onSaved]);

  const saveGapReason = useCallback(async (category: string, detail: string) => {
    setGapSaving(true);
    const todayDateStr = format(new Date(), 'yyyy-MM-dd');
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: 'well', entity_id: well.id, plant_id: plantId,
        gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
        logged_by: userId ?? null,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${well.name}: reason logged`);
    setGapDialogOpen(false);
    onGapReasonSaved?.();
  }, [well.id, well.name, plantId, userId, onGapReasonSaved]);

  const onStartEdit = useCallback(() => {
    if (!lastToday) return;
    setEditingId(lastToday.id);
    setReading(String(lastToday.current_reading ?? ''));
    setPowerReading(lastToday.power_meter_reading != null ? String(lastToday.power_meter_reading) : '');
    setTdsReading(lastToday.tds_ppm != null ? String(lastToday.tds_ppm) : '');
    setNtuReading((lastToday as any).turbidity_ntu != null ? String((lastToday as any).turbidity_ntu) : '');
    setPressureReading(lastToday.pressure_psi != null ? String(lastToday.pressure_psi) : '');
    setCustomDt(format(new Date(lastToday.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditBefore({
      current_reading: lastToday.current_reading ?? null,
      reading_datetime: lastToday.reading_datetime ?? null,
      daily_volume: lastToday.daily_volume ?? null,
      power_meter_reading: lastToday.power_meter_reading ?? null,
      tds_ppm: lastToday.tds_ppm ?? null,
      turbidity_ntu: (lastToday as any).turbidity_ntu ?? null,
      pressure_psi: lastToday.pressure_psi ?? null,
      is_meter_rollover: !!lastToday.is_meter_rollover,
      meter_rollover_max: lastToday.meter_rollover_max ?? null,
      is_meter_replacement: !!lastToday.is_meter_replacement,
    });
  }, [lastToday]);

  const onCancelEdit = useCallback(() => {
    setEditingId(null); setReading(''); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading('');
    setEditBefore(null); setEditReason(''); setEditCustomReason('');
    setCustomDt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  }, []);

  return {
    reading, setReading, powerReading, setPowerReading,
    tdsReading, setTdsReading, ntuReading, setNtuReading,
    pressureReading, setPressureReading,
    editingId, setEditingId, editBefore, setEditBefore,
    editReason, setEditReason, editCustomReason, setEditCustomReason,
    saving, setSaving, savingTds, savingNtu, savingPressure, savingPower,
    anomalyRemark, setAnomalyRemark, showAnomalyBanner, setShowAnomalyBanner,
    sharedPowerReading, setSharedPowerReading, savingSharedPower, setSavingSharedPower,
    showHistory, setShowHistory, customDt, setCustomDt, dtInputRef,
    gapDialogOpen, setGapDialogOpen, gapSaving, setGapSaving,
    defaultRolloverMax, isRollover, setIsRollover, rolloverMax, setRolloverMax,
    showReplaceMeter, setShowReplaceMeter,
    meterReplacePending, setMeterReplacePending,
    wellLastSavePending, setWellLastSavePending,
    cur, meterChanged, dailyVol, belowPrev, hoursElapsedWell,
    wellFlowRate, deviationWell, highVol, anomalyRemarkRequired,
    todayCount, lastToday, atLimit, showDedicatedPower, odometerAlert,
    save, savePower, saveTds, saveNtu, savePressure, saveSharedPower, saveGapReason,
    onStartEdit, onCancelEdit,
  };
}
