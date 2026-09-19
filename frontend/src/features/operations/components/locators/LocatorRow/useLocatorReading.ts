import { useState, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { useDraft } from '@/hooks/useDraft';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { evaluateReadingGuard, SPIKE_MULTIPLIER, formatCooldown } from '@/lib/readingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { format } from 'date-fns';
import { fmtNum, getCurrentPosition, isOffLocation } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  insertDerivedOverrideRows, HAMAS_OVERRIDE_SCHEMA, HAMAS_OVERRIDE_TEMPLATE_ROW,
  syncDerivedLocatorMirrors,
} from '@/data/mutations/locators';
import { validateDerivedOverrideRow } from '@/lib/readingValidation';

interface UseLocatorReadingOptions {
  locator: any;
  plantId: string;
  previous: number | null;
  previousDt: string | null;
  latestReading?: any | null;
  todayReadings: any[];
  avgVol: number | null;
  userId: string | undefined;
  onSaved: () => void;
  isManagerOrAdmin: boolean;
  maxReadingsPerDay?: number;
}

export function useLocatorReading({
  locator, plantId, previous, previousDt, latestReading, todayReadings,
  avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay = 3,
}: UseLocatorReadingOptions) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { user } = useAuth();
  const actorLabel = user?.email ?? 'Unknown user';

  const [reading, setReading] = useState('');
  const lastPrefilledLoc = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBefore, setEditBefore] = useState<Record<string, unknown> | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  const [lastSavePending, setLastSavePending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [cooldownAvailableAt, setCooldownAvailableAt] = useState<Date | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<any | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [recalcSaving, setRecalcSaving] = useState(false);
  const [importOverrideOpen, setImportOverrideOpen] = useState(false);

  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`loc-reading-${locator.id}`, { value: '' });

  useEffect(() => {
    if (reading === '' && draftReading.value) setReading(draftReading.value);
  }, []);

  const locInputMode: 'raw' | 'direct' = locator.default_input_mode === 'direct' ? 'direct' : 'raw';

  useEffect(() => {
    if (locInputMode !== 'raw' || previous == null || editingId) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledLoc.current) {
      setReading(expected);
      lastPrefilledLoc.current = expected;
    }
  }, [previous, locInputMode, editingId, reading]);

  const startEdit = (readingRow: any) => {
    if (!readingRow) return;
    setEditingId(readingRow.id);
    setReading(String(readingRow.current_reading));
    if (readingRow.reading_datetime) {
      setCustomDt(new Date(readingRow.reading_datetime).toISOString().slice(0, 16));
    }
    setAnomalyRemark(readingRow.anomaly_remark ?? '');
    setShowAnomalyBanner(false);
    setEditBefore({
      current_reading: readingRow.current_reading ?? null,
      reading_datetime: readingRow.reading_datetime ?? null,
      daily_volume: readingRow.daily_volume ?? null,
      is_meter_replacement: !!readingRow.is_meter_replacement,
      is_estimated: !!readingRow.is_estimated,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setReading(previous != null ? previous.toFixed(2) : '');
    setCustomDt(new Date().toISOString().slice(0, 16));
    setAnomalyRemark('');
    setShowAnomalyBanner(false);
    setEditBefore(null); setEditReason(''); setEditCustomReason('');
  };

  const cur = +reading || 0;
  const readingChanged = reading !== '' && (previous == null || cur !== previous || editingId != null);
  const dailyVol = locInputMode === 'direct'
    ? (reading ? +reading : null)
    : (readingChanged && previous != null ? cur - previous : null);
  const belowPrev = locInputMode === 'raw' && previous != null && cur > 0 && cur < previous;
  const hoursElapsedLoc = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const currentFlowRateLoc = locInputMode === 'raw' ? computeRate(dailyVol, hoursElapsedLoc, undefined, true) : null;
  const deviationLoc = locInputMode === 'raw'
    ? classifyDeviation(currentFlowRateLoc, avgVol, SPIKE_MULTIPLIER)
    : { tier: 'ok' as const, direction: null, rate: null, avgRate: null, deviationPct: null };
  const highVol = deviationLoc.tier !== 'ok';
  const anomalyRemarkRequired = deviationLoc.tier !== 'ok' && !isAnomalyRemarkValid(anomalyRemark);
  const todayCount = todayReadings.length;
  const atLimit = !editingId && todayCount >= maxReadingsPerDay;
  const freshness = lastReadingFreshness(previousDt);

  const odometerAlert: 'neutral' | 'warn' | 'error' | 'ok' =
    !readingChanged   ? 'neutral' :
    belowPrev         ? 'warn'    :
    highVol           ? 'warn'    :
    (+reading < 0 && locInputMode === 'raw') ? 'error' :
    'ok';

  const handleCorrectionRequest = () => {
    if (!latestReading) return;
    setCorrectionTarget({
      id:              latestReading.id,
      sourceTable:     'locator_readings',
      plantId,
      entityName:      locator.name,
      currentReading:  latestReading.current_reading,
      previousReading: latestReading.previous_reading ?? null,
      dailyVolume:     latestReading.daily_volume ?? null,
      readingDatetime: latestReading.reading_datetime,
    });
  };

  const save = async () => {
    if (saving) return;
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) { toast.error(`${locator.name}: max ${maxReadingsPerDay} readings/day reached`); return; }
    if (locInputMode === 'direct' && +reading <= 0) { toast.error(`${locator.name}: enter a positive volume`); return; }

    if (editingId && !isReasonComplete(editReason, editCustomReason)) {
      toast.error(`${locator.name}: select a reason for this edit`);
      return;
    }

    if (!editingId && locInputMode === 'raw' && previous != null && cur === previous && !overrideOpen) {
      if (hoursElapsedLoc != null && hoursElapsedLoc < 12) {
        toast.error(`${locator.name}: this odometer reading (${fmtNum(cur, 2)}) was already recorded within the last 12 hours.`);
        return;
      }
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${locator.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }

    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'locator', locator.id, plantId, userId,
        cur,
        new Date(customDt), false, false, avgVol, false, locInputMode,
      );
      setSaving(false);

      if (guard.status === 'blocked' && guard.reason === 'cooldown') {
        setCooldownMinutes(guard.minutesLeft);
        setCooldownAvailableAt(guard.availableAt);
        toast.error(
          `${locator.name}: cooldown — next reading available in ${formatCooldown(guard.minutesLeft)}.`,
          { duration: 6000 },
        );
        return;
      }
      if (guard.status === 'blocked' && guard.reason === 'duplicate') {
        toast.error(`${locator.name}: ${guard.detail}`, { duration: 8000 });
        return;
      }
      if (guard.status === 'pending_review') {
        toast.info(`${locator.name}: ${guard.detail}`, { duration: 8000 });
      }
    }

    setSaving(true);
    let gps_lat: number | null = null, gps_lng: number | null = null, off = false;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (gps_lat != null && gps_lng != null && locator.gps_lat && locator.gps_lng)
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    const payload: any = {
      locator_id: locator.id, plant_id: plantId,
      current_reading: cur,
      gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
      reading_datetime: new Date(customDt).toISOString(),
      is_estimated: false,
      is_meter_replacement: false,
    };

    if (!editingId) {
      try {
        const dt = new Date(customDt);
        const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).toISOString();
        const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).toISOString();
        await supabase
          .from('locator_readings')
          .delete()
          .eq('locator_id', locator.id)
          .eq('is_estimated', true)
          .gte('reading_datetime', dayStart)
          .lte('reading_datetime', dayEnd);
      } catch (err) {
        console.warn('[Operations] Failed to purge orphan estimate on same day:', err);
      }
    }

    const { data: savedRow, error } = editingId
      ? await (supabase.from('locator_readings').update(payload).eq('id', editingId).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('locator_readings').insert(payload).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      if (error.code === '23505') {
        toast.error(
          `${locator.name}: a reading was already submitted for this time. Check the log before resubmitting.`,
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
        is_estimated: !!payload.is_estimated,
        is_meter_replacement: !!payload.is_meter_replacement,
      };
      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: editingId,
        plant_id: plantId,
        action: 'update',
        actor_user_id: userId ?? null,
        actor_label: actorLabel,
        changes: diffFields(editBefore, after),
        reason: resolveReason(editReason, editCustomReason),
      });
    }

    const isPending = savedRow?.norm_status === 'pending_review';
    setLastSavePending(isPending);
    setCooldownMinutes(0);
    setCooldownAvailableAt(null);

    if (isPending) {
      toast.info(`${locator.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else {
      const curr = savedRow?.current_reading;
      const prev = savedRow?.previous_reading;
      const vol  = savedRow?.daily_volume;
      toast.success(fmtSaveToast(locator.name, editingId ? 'updated' : 'saved', curr, prev, vol), { duration: 5000 });
    }

    if (deviationLoc.tier !== 'ok' && isAnomalyRemarkValid(anomalyRemark) && savedRow?.id) {
      void submitAnomalyRemark({
        table_name: 'locator_readings',
        record_id: savedRow.id,
        plant_id: plantId,
        tier: deviationLoc.tier,
        direction: deviationLoc.direction!,
        deviation_pct: deviationLoc.deviationPct ?? 0,
        flow_rate: deviationLoc.rate,
        avg_flow_rate: deviationLoc.avgRate,
        rate_unit: 'm3/hr',
        remark_text: anomalyRemark,
      });
    }
    setAnomalyRemark('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 500);
    setReading(''); clearDraftReading(); setEditingId(null); onSaved();
    setEditBefore(null); setEditReason(''); setEditCustomReason('');
  };

  const recalcNow = async () => {
    setRecalcSaving(true);
    try {
      const p_date = format(new Date(), 'yyyy-MM-dd');
      const { error } = await (supabase.rpc as any)('fn_sweep_derived_meters', { p_date, p_lookback_days: 3 });
      if (error) throw error;
      toast.success(`${locator.name}: recalculated.`);
      qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
      qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
      qc.invalidateQueries({ queryKey: ['reading-history', 'locator', locator.id] });
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setRecalcSaving(false);
    }
  };

  const saveOverride = async (value: number, reason: string) => {
    setOverrideSaving(true);
    try {
      const before = latestReading
        ? { current_reading: latestReading.current_reading, is_estimated: latestReading.is_estimated }
        : {};
      const payload: any = {
        locator_id: locator.id, plant_id: plantId,
        current_reading: value, previous_reading: 0, is_estimated: false,
        recorded_by: userId,
      };
      const { data: savedRow, error } = latestReading?.id
        ? await supabase.from('locator_readings').update(payload).eq('id', latestReading.id).select().single()
        : await supabase.from('locator_readings').insert({ ...payload, reading_datetime: new Date().toISOString() }).select().single();
      if (error) throw error;

      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: (savedRow as any)?.id ?? null,
        plant_id: plantId,
        actor_user_id: userId ?? null,
        actor_label: actorLabel,
        changes: { ...diffFields(before, { current_reading: value, is_estimated: false }), override_reason: { old: null, new: reason } },
        reason,
      });

      try {
        await syncDerivedLocatorMirrors(
          locator.id,
          (savedRow as any)?.reading_datetime ?? new Date().toISOString(),
          value,
        );
      } catch (mirrorErr: any) {
        console.error('[saveOverride] mirror sync failed:', mirrorErr);
        toast.warning(`${locator.name}: override saved, but mirror sync failed — the other plant's meter may be out of date until the next sweep.`);
      }

      toast.success(`${locator.name}: override saved.`);
      setOverrideOpen(false);
      qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
      qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
      qc.invalidateQueries({ queryKey: ['reading-history', 'locator', locator.id] });
      qc.invalidateQueries({ queryKey: ['product-meter-readings'] });
      qc.invalidateQueries({ queryKey: ['product-meter-dash'] });
      onSaved();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setOverrideSaving(false);
    }
  };

  return {
    reading, setReading, editingId, setEditingId, saving, setSaving,
    customDt, setCustomDt, anomalyRemark, setAnomalyRemark,
    showAnomalyBanner, setShowAnomalyBanner,
    lastSavePending, justSaved,
    cooldownMinutes, cooldownAvailableAt,
    correctionTarget, setCorrectionTarget,
    locInputMode, readingChanged, dailyVol, belowPrev,
    deviationLoc, highVol, anomalyRemarkRequired,
    atLimit, freshness, odometerAlert,
    actorLabel,
    startEdit, cancelEdit, save,
    handleCorrectionRequest,
    overrideOpen, setOverrideOpen,
    overrideSaving, recalcSaving, importOverrideOpen, setImportOverrideOpen,
    saveOverride, recalcNow,
    draftReading, setDraftReading, clearDraftReading,
    isMobile,
    editReason, setEditReason,
    editCustomReason, setEditCustomReason,
  };
}
