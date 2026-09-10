import { useState, useEffect, useRef, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fmtNum, ALERTS } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { resolveBlendingDateContext } from '@/lib/blendingBackdate';
import { latestRaw } from '@/lib/blendingRawCache';
import { computeRate, classifyDeviation, MIN_ELAPSED_DAYS } from '@/lib/flowRateGuards';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { invalidateWellDash } from '../../../pages/operations/shared';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import type { BlendingRowProps } from './types';

export type { BlendingRowProps } from './types';
export type BlendingRowLogic = ReturnType<typeof useBlendingRow>;

function getBlendingRawKey(wellId: string) { return `blending-raw-${wellId}`; }

function readPersistedRaw(wellId: string): { reading: number; date: string } | null {
  try {
    const v = localStorage.getItem(getBlendingRawKey(wellId));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function persistRaw(wellId: string, reading: number, date: string) {
  try { localStorage.setItem(getBlendingRawKey(wellId), JSON.stringify({ reading, date })); } catch { /* best-effort persist — ignore */ }
}

export function useBlendingRow(props: BlendingRowProps) {
  const { well, plantId, plantName, todayVolume, previousVolume, previousDate, avgVol, dbLatestRaw, userId, gapReason, onGapReasonSaved, onSaved } = props;
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [volume, setVolumeRaw] = useState('');
  const lastPrefilledBlend = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [justSaved, setJustSaved] = useState(false);
  const setVolume = (v: string) => { setVolumeRaw(v); setJustSaved(false); };

  const [prevRawReading, setPrevRawReading] = useState<{ reading: number; date: string } | null>(
    () => readPersistedRaw(well.id),
  );

  useEffect(() => {
    const src = latestRaw(prevRawReading, dbLatestRaw)?.reading ?? null;
    if (src == null) return;
    const expected = src.toFixed(2);
    if (volume === '' || volume === lastPrefilledBlend.current) {
      setVolumeRaw(expected);
      lastPrefilledBlend.current = expected;
    }
  }, [prevRawReading, dbLatestRaw, volume]);

  useEffect(() => {
    if (dbLatestRaw && (!prevRawReading || dbLatestRaw.date > prevRawReading.date)) {
      setPrevRawReading(dbLatestRaw);
      persistRaw(well.id, dbLatestRaw.reading, dbLatestRaw.date);
    }
  }, [dbLatestRaw, prevRawReading, well.id]);

  const eventDate = customDt.slice(0, 10);
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const isBackdated = eventDate !== todayDateStr;

  const { data: backdatedContext, isLoading: backdatedContextLoading } = useQuery({
    queryKey: ['blending-backdated-context', well.id, eventDate],
    enabled: isBackdated,
    queryFn: async () => {
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('raw_meter_reading, event_date, is_estimated')
        .eq('well_id', well.id)
        .lte('event_date', eventDate)
        .not('raw_meter_reading', 'is', null)
        .order('event_date', { ascending: false })
        .limit(2);
      if (error) return { existingForDate: null, predecessor: null };
      return resolveBlendingDateContext((data ?? []) as { raw_meter_reading: number; event_date: string; is_estimated?: boolean }[], eventDate);
    },
    staleTime: 15_000,
  });

  const { data: backdatedGapReason } = useQuery({
    queryKey: ['blending-gap-reason-for-date', well.id, eventDate],
    enabled: isBackdated,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'blending')
        .eq('entity_id', well.id)
        .eq('gap_date', eventDate)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 15_000,
  });

  const effectiveGapReason = isBackdated ? backdatedGapReason : gapReason;
  const hasReadingForSelectedDate = isBackdated ? !!backdatedContext?.existingForDate : todayVolume > 0;

  const prevCumulative: number | null = isBackdated
    ? (backdatedContext?.predecessor?.reading ?? null)
    : (latestRaw(prevRawReading, dbLatestRaw)?.reading ?? previousVolume ?? null);

  const deltaRaw = volume !== ''
    ? prevCumulative != null ? +volume - prevCumulative : null
    : null;

  const isBaselineRaw = prevCumulative == null && volume !== '' && +volume > 0;
  const volumeChanged = volume !== '' && (isBaselineRaw || (deltaRaw != null && deltaRaw > 0));

  const blendBelowPrev = deltaRaw != null && deltaRaw < 0;
  const prevDateStr = isBackdated
    ? (backdatedContext?.predecessor?.date ?? null)
    : (latestRaw(prevRawReading, dbLatestRaw)?.date ?? previousDate ?? null);
  const daysElapsedBlend = prevDateStr
    ? (new Date(`${eventDate}T00:00:00`).getTime() - new Date(`${prevDateStr}T00:00:00`).getTime()) / 86_400_000
    : null;
  const blendRate = computeRate(deltaRaw, daysElapsedBlend, MIN_ELAPSED_DAYS);
  const deviationBlend = classifyDeviation(blendRate, avgVol ?? null, ALERTS.blending_spike_multiplier);
  const blendHighVol = deviationBlend.tier !== 'ok';
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  const anomalyRemarkRequired = blendHighVol && !isAnomalyRemarkValid(anomalyRemark);

  const isEstimatedForDate = isBackdated
    ? !!backdatedContext?.existingForDate?.is_estimated
    : (hasReadingForSelectedDate ? !!dbLatestRaw?.is_estimated : false);
  const chipState: 'pending' | 'ready' | 'logged' | 'estimated' =
    isEstimatedForDate ? 'estimated'
    : (hasReadingForSelectedDate || justSaved) ? 'logged'
    : volumeChanged ? 'ready'
    : 'pending';

  let previewLine: React.ReactNode = null;
  if (volume !== '' && deltaRaw != null) {
    previewLine = (
      <>Δ <span className={`font-semibold ${deltaRaw >= 0 ? 'text-kpi-ro' : 'text-destructive'}`}>{fmtNum(deltaRaw)} m³</span> will be saved</>
    );
  } else if (isBaselineRaw) {
    previewLine = (
      <>First reading — <span className="font-semibold text-kpi-ro">{fmtNum(+volume)} m³</span> will be saved as baseline</>
    );
  }

  const save = async () => {
    if (prevCumulative != null && +volume === prevCumulative) {
      toast.error(`${well.name}: this odometer reading (${fmtNum(+volume, 2)}) is identical to the previous reading. Same reading within 12 hours cannot be saved.`);
      return;
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${well.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }
    const storeVol = deltaRaw != null ? deltaRaw : +volume;

    if (!volume || !(storeVol > 0)) {
      if (deltaRaw != null && deltaRaw <= 0) {
        toast.error(`${well.name}: current reading must be greater than the previous (${fmtNum(prevCumulative!)})`);
      } else {
        toast.error(`${well.name}: enter a positive blending volume`);
      }
      return;
    }
    if (blendBelowPrev) toast.info(`${well.name}: reading below previous — saved anyway`);
    setSaving(true);
    try {
      const { data: savedId, error } = await supabase.rpc('fn_blending_upsert_reading' as any, {
        p_well_id: well.id, p_plant_id: plantId, p_well_name: well.name, p_plant_name: plantName,
        p_event_date: eventDate, p_reading_datetime: new Date(customDt).toISOString(),
        p_raw_meter_reading: +volume,
        p_previous_reading: isBackdated ? null : prevCumulative,
        p_update_previous_reading: false,
      });
      if (error) throw error;

      if (blendHighVol && savedId) {
        void submitAnomalyRemark({
          table_name: 'blending_events',
          record_id: savedId,
          plant_id: plantId,
          tier: deviationBlend.tier as 'needs_remark' | 'critical',
          direction: deviationBlend.direction!,
          deviation_pct: deviationBlend.deviationPct!,
          flow_rate: deviationBlend.rate,
          avg_flow_rate: deviationBlend.avgRate,
          rate_unit: 'm3/day',
          remark_text: anomalyRemark,
        });
      }
      setAnomalyRemark('');

      const cachedDate = latestRaw(prevRawReading, dbLatestRaw)?.date ?? null;
      if (!cachedDate || eventDate >= cachedDate) {
        persistRaw(well.id, +volume, eventDate);
        setPrevRawReading({ reading: +volume, date: eventDate });
        lastPrefilledBlend.current = null;
      }

      toast.success(`${well.name}: meter reading saved${deltaRaw != null ? ` (Δ ${fmtNum(deltaRaw)} m³)` : ''}`);
      setVolume('');
      setJustSaved(true);

      invalidateWellDash(qc, [well.id]);
      qc.invalidateQueries({ queryKey: ['blending-backdated-context', well.id] });
      qc.invalidateQueries({ queryKey: ['blending-gap-reason-for-date', well.id, eventDate] });
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setSaving(false); }
  };

  const saveGapReason = async (category: string, detail: string) => {
    setGapSaving(true);
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: 'blending', entity_id: well.id, plant_id: plantId,
        gap_date: eventDate, reason_category: category, reason_detail: detail || null,
        logged_by: userId ?? null,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${well.name}: reason logged`);
    setGapDialogOpen(false);
    qc.invalidateQueries({ queryKey: ['blending-gap-reason-for-date', well.id, eventDate] });
    onGapReasonSaved?.();
  };

  return {
    well, plantId, props,
    isMobile, qc,
    volume, setVolume, setVolumeRaw, saving, showHistory, setShowHistory,
    gapDialogOpen, setGapDialogOpen, gapSaving, customDt, setCustomDt, dtInputRef,
    justSaved, prevRawReading, setPrevRawReading,
    backdatedContext, backdatedContextLoading, backdatedGapReason,
    effectiveGapReason, hasReadingForSelectedDate, prevCumulative, deltaRaw,
    isBaselineRaw, volumeChanged, blendBelowPrev, prevDateStr, daysElapsedBlend,
    blendRate, deviationBlend, blendHighVol, anomalyRemark, setAnomalyRemark,
    showAnomalyBanner, setShowAnomalyBanner, anomalyRemarkRequired,
    isEstimatedForDate, chipState, previewLine, save, saveGapReason,
    eventDate, todayDateStr, isBackdated,
    todayVolume, previousVolume, previousDate, avgVol, dbLatestRaw, userId, gapReason,
    onGapReasonSaved, onSaved,
  };
}
