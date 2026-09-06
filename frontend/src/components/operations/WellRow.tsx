import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { useDraft } from '@/hooks/useDraft';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/StatusPill';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { ReasonDialog } from '@/components/ReasonDialog';
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
import { cn } from '@/lib/utils';
import {
  CalendarClock, MessageCircleOff, Pencil, X, History,
  AlertCircle, ArrowUpRight, Loader2, Zap,
} from 'lucide-react';
import { WELL_MAX_READINGS_PER_DAY, formatCooldown } from '@/pages/operations/shared';

export function WellRow({
  well, plantId, previousMeter, previousPower, previousDt, freshDt, avgVol, todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, canAutoApprove, isInSharedPowerGroup,
  sharedPower, gapReason, onGapReasonSaved, rowRef, pulsing,
}: {
  well: any; plantId: string;
  previousMeter: number | null; previousPower: number | null;
  previousDt: string | null; avgVol: number | null;
  freshDt?: string | null;
  todayReadings: any[]; userId: string | undefined;
  isBlending: boolean; onSaved: () => void;
  isManagerOrAdmin: boolean;
  canAutoApprove: boolean;
  isInSharedPowerGroup: boolean;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  pulsing?: boolean;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { activeOperator } = useAuth();

  const [reading, setReading]                   = useState('');
  const lastPrefilledMeter = useRef<string | null>(null);
  const [powerReading, setPowerReading]         = useState('');
  const [tdsReading, setTdsReading]             = useState('');
  const [ntuReading, setNtuReading]             = useState('');
  const [pressureReading, setPressureReading]   = useState('');
  const [editingId, setEditingId]               = useState<string | null>(null);
  const [editBefore, setEditBefore]             = useState<Record<string, unknown> | null>(null);
  const [editReason, setEditReason]             = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving]                     = useState(false);
  const [savingTds, setSavingTds]               = useState(false);
  const [savingNtu, setSavingNtu]               = useState(false);
  const [savingPressure, setSavingPressure]     = useState(false);
  const [savingPower, setSavingPower]           = useState(false);
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  const [sharedPowerReading, setSharedPowerReading] = useState('');
  const [savingSharedPower, setSavingSharedPower]   = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [customDt, setCustomDt]                 = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [gapDialogOpen, setGapDialogOpen]       = useState(false);
  const [gapSaving, setGapSaving]               = useState(false);
  const defaultRolloverMax = well.meter_rollover_max != null ? String(well.meter_rollover_max) : '99999';
  const [isRollover, setIsRollover]             = useState(false);
  const [rolloverMax, setRolloverMax]           = useState(defaultRolloverMax);
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);

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

  const cur        = +reading || 0;
  const meterChanged = reading !== '' && (previousMeter == null || cur !== previousMeter);
  const dailyVol   = meterChanged && previousMeter != null ? cur - previousMeter : null;
  const belowPrev  = previousMeter != null && cur > 0 && cur < previousMeter;
  const hoursElapsedWell = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const wellFlowRate = computeRate(dailyVol, hoursElapsedWell, undefined, true);
  const deviationWell = classifyDeviation(wellFlowRate, avgVol, SPIKE_MULTIPLIER);
  const highVol = deviationWell.tier !== 'ok';
  const anomalyRemarkRequired = deviationWell.tier !== 'ok' && !isAnomalyRemarkValid(anomalyRemark);
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= WELL_MAX_READINGS_PER_DAY;
  const showDedicatedPower = well.has_power_meter && !isInSharedPowerGroup;

  const odometerAlert: OdometerAlertState =
    !meterChanged ? 'neutral' :
    belowPrev     ? 'warn'    :
    highVol       ? 'warn'    :
    (+reading < 0) ? 'error'  :
    'ok';

  const [wellLastSavePending, setWellLastSavePending] = useState(false);

  const save = async () => {
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
  };

  const savePower = async () => {
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
  };

  const saveTds = async () => {
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
  };

  const saveNtu = async () => {
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
  };

  const savePressure = async () => {
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
  };

  const saveSharedPower = async () => {
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
  };

  const saveGapReason = async (category: string, detail: string) => {
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
  };

  return (
    <div
      ref={rowRef}
      className={cn(
        'instrument-housing overflow-hidden shadow-xs transition-all border border-border/80 rounded-2xl mb-3',
        pulsing ? 'ring-2 ring-accent ring-inset' : '',
      )}
      data-testid={`well-row-${well.id}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3 bg-muted/20 border-b border-border/60">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-bold text-foreground break-words">{well.name}</span>
          <MetaStrip
            primary={
              (() => {
                const fresh = lastReadingFreshness(freshDt);
                return (
                  <StatusPill tone={fresh.tone}>
                    <CalendarClock className="h-2.5 w-2.5" />
                    {fresh.label}
                  </StatusPill>
                );
              })()
            }
            alerts={[
              todayCount === 0 && !editingId && {
                tone: 'warn',
                icon: MessageCircleOff,
                label: gapReason ? reasonCategoryLabel(gapReason.reason_category) : 'Log gap reason',
                onClick: () => setGapDialogOpen(true),
                testId: `well-gap-reason-btn-${well.id}`,
              },
              lastToday?.is_estimated && {
                tone: 'warn',
                label: 'Estimated',
                title: 'Auto-backfilled reading — no manual operator entry on file.',
              },
              editingId && {
                tone: 'primary',
                label: 'Editing',
              },
              isBlending && {
                tone: 'accent',
                label: 'Blending',
              },
              well.has_power_meter && isInSharedPowerGroup && {
                tone: 'warn',
                icon: Zap,
                label: 'Shared Power',
              },
              dailyVol != null && {
                tone: dailyVol < 0 ? 'danger' : 'default',
                label: `Δ ${fmtNum(dailyVol)} m³`,
              },
            ].filter(Boolean)}
            overflow={[
              {
                icon: ArrowUpRight,
                label: 'Plant detail',
                onClick: () => navigate(`/plants/${plantId}?tab=wells&highlight=${well.id}`),
              },
            ].filter(Boolean)}
            maxVisible={4}
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <span className={cn('text-2xs font-mono-num font-semibold px-2 py-0.5 rounded-full border', atLimit ? 'text-warn bg-warn-soft border-warn/40' : 'text-muted-foreground bg-muted/60 border-border/50')}>
            {todayCount}/{WELL_MAX_READINGS_PER_DAY} today
          </span>

          <label className="cursor-pointer relative shrink-0">
            <span
              className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-full px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/80 hover:text-foreground transition-colors"
              onClick={(e) => {
                e.preventDefault();
                const el = dtInputRef.current;
                if (!el) return;
                if (typeof el.showPicker === 'function') {
                  try { el.showPicker(); } catch { el.focus(); }
                } else {
                  el.focus();
                }
              }}
            >
              {new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
            </span>
            <input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
          </label>

          <ControlCluster
            actions={[
              lastToday && !editingId && {
                icon: Pencil,
                title: `Edit last today reading (${fmtNum(lastToday.current_reading)})`,
                onClick: () => {
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
                },
              },
              editingId && {
                icon: X,
                title: 'Cancel edit',
                variant: 'danger',
                onClick: () => { setEditingId(null); setReading(''); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading(''); setEditBefore(null); setEditReason(''); setEditCustomReason(''); setCustomDt(format(new Date(), "yyyy-MM-dd'T'HH:mm")); },
              },
              isManagerOrAdmin && {
                icon: History,
                title: 'View reading history',
                onClick: () => setShowHistory(true),
              },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
        <div className="px-3.5 py-3 space-y-2.5">
          {isMobile ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-foreground">Water Meter</p>
                <span className="text-3xs text-muted-foreground">Swipe digits or tap Type</span>
              </div>
              <OdometerRollerInput
                value={reading}
                onChange={(v) => { setReading(v); setDraftWell({ value: v }); }}
                alertState={odometerAlert}
                disabled={saving || atLimit}
                testId={`well-meter-input-${well.id}`}
              />
              <div className="flex items-center justify-between text-xs px-1 py-0.5 rounded-md bg-muted/40 border border-border/40">
                <span className="text-muted-foreground text-2xs">
                  prev: <span className="font-mono-num font-semibold text-foreground">
                    {previousMeter != null ? fmtNum(previousMeter) : '—'}
                  </span>
                </span>
                {dailyVol != null && (
                  <span className={cn("font-mono-num font-bold text-2xs", dailyVol < 0 ? "text-destructive" : "text-primary")}>
                    Δ {fmtNum(dailyVol)} m³
                  </span>
                )}
              </div>
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason))}
                className={cn(
                  'w-full h-11 text-sm font-bold shadow-sm rounded-xl transition-all',
                  meterChanged
                    ? 'bg-primary hover:bg-primary/90 active:bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                )}
                title="Save water meter reading">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update Meter' : 'Save Water Meter'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0">Water Meter</p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={reading} onChange={e => { setReading(e.target.value); setShowAnomalyBanner(false); }}
                placeholder={previousMeter != null ? `Prev: ${fmtNum(previousMeter)}` : 'Enter reading'}
                className="h-8 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-ring/30 font-mono-num placeholder:text-muted-foreground/50"
                data-testid={`well-meter-input-${well.id}`}
              />
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason))}
                size="sm"
                className={cn(
                  'h-8 px-3.5 shrink-0 text-xs font-semibold shadow-sm transition-all',
                  meterChanged
                    ? 'bg-primary hover:bg-primary/90 active:bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                )}
                title="Save water meter reading">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          )}

          {editingId && (
            <div className="pt-1">
              <CorrectionReasonField
                reason={editReason} onReasonChange={setEditReason}
                customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
                label="Reason for this edit"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-2xs text-muted-foreground cursor-pointer select-none pt-1">
            <Checkbox
              checked={!!meterReplacePending}
              onCheckedChange={(v) => {
                if (v === true) setShowReplaceMeter(true);
                else setMeterReplacePending(null);
              }}
            />
            <span>Meter replaced</span>
            {meterReplacePending && <span className="text-primary font-bold">— logged</span>}
          </label>

          {showDedicatedPower && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0 flex items-center gap-1">
                <Zap className="h-3 w-3 text-warn" />Grid Meter
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={powerReading} onChange={e => setPowerReading(e.target.value)}
                placeholder={previousPower != null ? `Prev: ${fmtNum(previousPower)}` : 'kWh reading'}
                className="h-8 sm:h-7 flex-1 min-w-0 text-xs border-warn/60 bg-warn-soft/30 font-mono-num focus-visible:ring-warn/30 placeholder:text-muted-foreground/50"
                data-testid={`well-power-input-${well.id}`}
              />
              <Button
                onClick={savePower} disabled={savingPower || !powerReading}
                size="sm"
                className="h-8 sm:h-7 px-3 shrink-0 bg-warn hover:bg-warn/90 text-white text-xs font-semibold shadow-sm border-0"
                title="Save power meter reading">
                {savingPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {sharedPower && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0 flex items-center gap-1">
                <Zap className="h-3 w-3 text-warn" />Shared Power
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={sharedPowerReading} onChange={e => setSharedPowerReading(e.target.value)}
                placeholder={sharedPower.previousPower != null ? `Prev: ${fmtNum(sharedPower.previousPower)}` : 'kWh reading'}
                className="h-8 sm:h-7 flex-1 min-w-0 text-xs border-warn/60 bg-warn-soft/30 font-mono-num focus-visible:ring-warn/30 placeholder:text-muted-foreground/50"
                data-testid={`shared-power-input-${sharedPower.primaryWellId}`}
              />
              <Button
                onClick={saveSharedPower} disabled={savingSharedPower || !sharedPowerReading}
                size="sm"
                className="h-8 sm:h-7 px-3 shrink-0 bg-warn hover:bg-warn/90 text-white text-xs font-semibold shadow-sm border-0"
                title="Save shared power meter reading">
                {savingSharedPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}
        </div>

        <div className="px-3.5 py-3 space-y-2.5 bg-muted/10 sm:bg-transparent">
          <p className="text-3xs font-bold uppercase tracking-wider text-muted-foreground sm:hidden">
            Water Quality &amp; Pressure Telemetry
          </p>

          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">TDS</p>
            <div className="relative flex-1 min-w-0">
              <Input
                type="number" step="any" inputMode="decimal"
                value={tdsReading} onChange={e => setTdsReading(e.target.value)}
                placeholder="Enter TDS"
                className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
                data-testid={`well-tds-input-${well.id}`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">ppm</span>
            </div>
            <Button
              onClick={saveTds} disabled={savingTds || !tdsReading}
              size="sm" variant="outline"
              className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
              title="Save TDS reading">
              {savingTds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">NTU</p>
            <div className="relative flex-1 min-w-0">
              <Input
                type="number" step="any" inputMode="decimal"
                value={ntuReading} onChange={e => setNtuReading(e.target.value)}
                placeholder="Enter NTU"
                className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
                data-testid={`well-ntu-input-${well.id}`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">NTU</span>
            </div>
            <Button
              onClick={saveNtu} disabled={savingNtu || !ntuReading}
              size="sm" variant="outline"
              className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
              title="Save turbidity (NTU) reading">
              {savingNtu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">Pressure</p>
            <div className="relative flex-1 min-w-0">
              <Input
                type="number" step="any" inputMode="decimal"
                value={pressureReading} onChange={e => setPressureReading(e.target.value)}
                placeholder="Enter pressure"
                className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
                data-testid={`well-pressure-input-${well.id}`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">psi</span>
            </div>
            <Button
              onClick={savePressure} disabled={savingPressure || !pressureReading}
              size="sm" variant="outline"
              className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
              title="Save pressure reading">
              {savingPressure ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {reading && belowPrev && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Meter reading is below the previous value — possible meter rollback or data entry error.
            If the meter was replaced, check "Meter replaced" above instead.
          </span>
          <div className="pl-5 flex flex-wrap items-center gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-warn cursor-pointer">
              <Checkbox checked={isRollover} onCheckedChange={(v) => setIsRollover(v === true)} />
              This is a meter rollover (odometer wrapped around), not an error
            </label>
            {isRollover && (
              <span className="flex items-center gap-1.5">
                <span className="text-warn">Wrap point:</span>
                <Input
                  value={rolloverMax}
                  onChange={(e) => setRolloverMax(e.target.value)}
                  className="h-6 w-24 text-xs"
                  inputMode="numeric"
                />
                {well.meter_rollover_max == null && (
                  <span className="text-warn/70 text-2xs">(guess — confirm against the meter, or set it once in Edit Well)</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {reading && !belowPrev && highVol && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
        <AnomalyRemarkBanner
          result={deviationWell}
          label={well.name}
          unit="m3/hr"
          windowDays={10}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
        />
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="well"
          entityId={well.id}
          plantId={plantId}
          assetMeterSerial={well.meter_serial}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="well"
          assetId={well.id}
          plantId={plantId}
          oldSerial={well.meter_serial}
          onSuccess={(info) => {
            setMeterReplacePending(info ?? { newInitialReading: null, replacementId: null });
            if (info?.newInitialReading != null && (reading === '' || reading === previousMeter?.toFixed(2))) {
              setReading(String(info.newInitialReading));
            }
          }}
          onClose={() => setShowReplaceMeter(false)}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={`No reading today for "${well.name}" — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={(category, detail) => saveGapReason(category, detail)}
      />
    </div>
  );
}
