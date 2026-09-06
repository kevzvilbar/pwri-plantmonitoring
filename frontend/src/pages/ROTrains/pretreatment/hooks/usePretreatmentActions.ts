import { useState } from 'react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { getHourBucket, isOfflineRORecord } from '@/lib/hourlyReadingGuard';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { calc, ALERTS } from '@/lib/calculations';
import { STANDARD_OFFLINE_REASONS, getUnitReasonText } from '../types';

export interface PretreatmentActionsOptions {
  plantId: string;
  trainId: string;
  train: any;
  trainOnline: boolean;
  confirmBackOnline: boolean;
  dt: string;
  roValues: Record<string, string>;
  roIncompleteReason: string;
  setRoIncompleteReason: (v: string) => void;
  setRoReasonNeeded: (v: boolean) => void;
  anomalyRemarksMissing: boolean;
  offlineStart: string;
  offlineReason: string;
  offlineReasonOther: string;
  offlineEnd: string;
  setTrainOnline: (v: boolean) => void;
  setOfflineStart: (v: string) => void;
  setOfflineEnd: (v: string) => void;
  setOfflineReason: (v: string) => void;
  setOfflineReasonOther: (v: string) => void;
  setRoValues: (v: any) => void;
  afmmf: Record<number, any>;
  boosters: Record<number, any>;
  housings: Record<number, any>;
  cartridgeHousings: Record<number, any>;
  isSynchronized: boolean;
  showFeedMeter: boolean;
  showPermeateMeter: boolean;
  showRejectMeter: boolean;
  syncBwOn: boolean;
  syncBwStart: string;
  syncBwEnd: string;
  syncMeterStart: string;
  syncMeterEnd: string;
  setAfmmf: (v: Record<number, any>) => void;
  setBoosters: (v: Record<number, any>) => void;
  setHousings: (v: Record<number, any>) => void;
  setCartridgeHousings: (v: Record<number, any>) => void;
  setSyncBwOn: (v: boolean) => void;
  setSyncBwStart: (v: string) => void;
  setSyncBwEnd: (v: string) => void;
  setSyncMeterStart: (v: string) => void;
  setSyncMeterEnd: (v: string) => void;
  boosterPrefPsi: boolean;
  hppTarget: string;
  setHppTarget: (v: string) => void;
  bagsChanged: string;
  setBagsChanged: (v: string) => void;
  remarks: string;
  setRemarks: (v: string) => void;
  afmUnitReasons: Record<number, { reason: string; custom: string }>;
  boosterUnitReasons: Record<number, { reason: string; custom: string }>;
  hppUnitReason: { reason: string; custom: string };
  cartridgeUnitReasons: Record<number, { reason: string; custom: string }>;
  housingUnitReasons: Record<number, { reason: string; custom: string }>;
  setAfmReasonNeeded: (v: boolean) => void;
  setAfmUnitReasons: (v: Record<number, { reason: string; custom: string }>) => void;
  setBoosterReasonNeeded: (v: boolean) => void;
  setBoosterUnitReasons: (v: Record<number, { reason: string; custom: string }>) => void;
  setHppUnitReason: (v: { reason: string; custom: string }) => void;
  setHousingReasonNeeded: (v: boolean) => void;
  setCartridgeUnitReasons: (v: Record<number, { reason: string; custom: string }>) => void;
  setHousingUnitReasons: (v: Record<number, { reason: string; custom: string }>) => void;
  setAfmSectionStarted: (v: boolean) => void;
  setBoosterHppSectionStarted: (v: boolean) => void;
  setCartridgeSectionStarted: (v: boolean) => void;
  setConfirmBackOnline: (v: boolean) => void;
  setAnomalyRemarkFeed: (v: string) => void;
  setAnomalyRemarkPerm: (v: string) => void;
  setAnomalyRemarkRej: (v: string) => void;
  anomalyRemarkFeed: string;
  anomalyRemarkPerm: string;
  anomalyRemarkRej: string;
  numAfm: number;
  numBoosterPumps: number;
  numCartridgeFilters: number;
  numFilterHousings: number;
  feedCurr: number | null;
  permCurr: number | null;
  rejCurr: number | null;
  prevFeedMeter: number | null;
  prevPermMeter: number | null;
  prevRejMeter: number | null;
  feedDelta: number | null;
  permDelta: number | null;
  rejDelta: number | null;
  effFeedFlow: number | null;
  effPermFlow: number | null;
  rejectFlow: number | null;
  recovery: number | null;
  rejection: number | null;
  saltPassage: number | null;
  dp: number | null;
  pwrCurr: number | null;
  prevPowerMeter: number | null;
  pwrDelta: number | null;
  pwrKw: number | null;
  secEnergy: number | null;
  sharedPowerGroup: string | null;
  feedHighWarn: boolean;
  permHighWarn: boolean;
  rejHighWarn: boolean;
  feedSpike: any;
  permSpike: any;
  rejSpike: any;
  feedNeedsRemark: boolean;
  permNeedsRemark: boolean;
  rejNeedsRemark: boolean;
  anyMeterSpike: boolean;
  mDurHr: number | null;
  qc: any;
  activeOperator: any;
  addAlerts: (alerts: any[]) => void;
  supabase: any;
}

export function usePretreatmentActions(opts: PretreatmentActionsOptions) {
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (isSaving) return;
    if (!opts.plantId || !opts.trainId) { toast.error('Select plant and train'); return; }
    if (opts.trainOnline && opts.train?.status === 'Offline' && !opts.confirmBackOnline) {
      toast.error('This train is still marked Offline in the database. Confirm it has actually resumed (checkbox above the form) before saving as Online.');
      return;
    }
    if (opts.anomalyRemarksMissing) {
      toast.error('One or more meters are outside the normal range — add a remark for each before saving.');
      return;
    }
    setIsSaving(true);
    try {
      if (opts.trainOnline) {
        const directRequired: { label: string; value: string }[] = [
          { label: 'Feed TDS', value: opts.roValues.feed_tds },
          { label: 'Permeate TDS', value: opts.roValues.permeate_tds },
          { label: 'Reject TDS', value: opts.roValues.reject_tds },
          { label: 'Feed pH', value: opts.roValues.feed_ph },
          { label: 'Permeate pH', value: opts.roValues.permeate_ph },
          { label: 'Reject pH', value: opts.roValues.reject_ph },
          { label: 'Feed Pressure', value: opts.roValues.feed_pressure_psi },
          { label: 'Reject Pressure', value: opts.roValues.reject_pressure_psi },
          { label: 'Suction Pressure', value: opts.roValues.suction_pressure_psi },
          { label: 'Product Temperature', value: opts.roValues.temperature_c },
          { label: 'Product Turbidity', value: opts.roValues.turbidity_ntu },
        ];
        const missingDirect = directRequired.filter((f) => f.value === '' || f.value == null);

        const emFilled = [opts.roValues.feed_flow, opts.roValues.permeate_flow, opts.roValues.reject_flow]
          .filter((v) => v !== '' && v != null).length;
        const emIncomplete = emFilled < 2;

        const configuredMeters = [
          opts.showFeedMeter !== false ? opts.roValues.feed_meter_curr : undefined,
          opts.showPermeateMeter !== false ? opts.roValues.permeate_meter_curr : undefined,
          opts.showRejectMeter !== false ? opts.roValues.reject_meter_curr : undefined,
        ].filter((v) => v !== undefined) as string[];
        const meterFilled = configuredMeters.filter((v) => v !== '' && v != null).length;
        const meterMinRequired = Math.max(0, configuredMeters.length - 1);
        const meterIncomplete = configuredMeters.length > 0 && meterFilled < meterMinRequired;

        if ((missingDirect.length > 0 || emIncomplete || meterIncomplete) && !opts.roIncompleteReason.trim()) {
          opts.setRoReasonNeeded(true);
          const parts = [
            ...missingDirect.map((f) => f.label),
            ...(emIncomplete ? ['Feed/Permeate/Reject Flow (need at least 2 of 3)'] : []),
            ...(meterIncomplete ? ['Water Meter reading(s)'] : []),
          ];
          toast.error(`Missing: ${parts.join(', ')}. Fill these in, or enter a reason below to proceed with missing values.`);
          return;
        }
      }

      if (!opts.trainOnline) {
        if (!opts.offlineStart) { toast.error('Please enter the time the train went offline.'); return; }
        if (!opts.offlineReason) { toast.error('Please select a reason for the offline event.'); return; }
        if (opts.offlineReason === 'Other' && !opts.offlineReasonOther.trim()) { toast.error('Please specify the reason for offline.'); return; }
        if (opts.offlineEnd && new Date(opts.offlineEnd) > new Date()) {
          toast.error('"Back Online At" must be in the past. The train cannot come back online at a future time.');
          return;
        }
      }

      const isOfflineExempt = !opts.trainOnline || opts.train?.status === 'Offline' || opts.confirmBackOnline || !!opts.offlineStart || !!opts.offlineEnd;

      if (!isOfflineExempt) {
        const hourBucket = getHourBucket(opts.dt);
        const trainLabel = opts.train?.name ?? `Train ${opts.train?.train_number ?? ''}`;

        const { data: existingROHour, error: roHourError } = await opts.supabase
          .from('ro_train_readings')
          .select('id, incomplete_reason, feed_flow, permeate_flow')
          .eq('train_id', opts.trainId)
          .gte('reading_datetime', hourBucket.startISO)
          .lt('reading_datetime', hourBucket.endISO);

        if (roHourError) { toast.error(friendlyError(roHourError)); return; }

        const activeROEntries = (existingROHour ?? []).filter((r: any) => !isOfflineRORecord(r));

        if (activeROEntries.length > 0) {
          toast.error(
            `${trainLabel} already has an active RO Train reading between ${hourBucket.label}. ` +
            `Only one operational reading is allowed per hour — edit the existing entry, or change the reading time.`,
          );
          return;
        }

        const { data: existingPretreatHour, error: pretreatHourError } = await opts.supabase
          .from('ro_pretreatment_readings')
          .select('id, hpp_target_pressure_psi, bag_filters_changed')
          .eq('train_id', opts.trainId)
          .gte('reading_datetime', hourBucket.startISO)
          .lt('reading_datetime', hourBucket.endISO);

        if (pretreatHourError) { toast.error(friendlyError(pretreatHourError)); return; }

        const activePretreatEntries = (existingPretreatHour ?? []).filter(
          (r: any) => r.hpp_target_pressure_psi != null || r.bag_filters_changed != null
        );

        if (activePretreatEntries.length > 0) {
          toast.error(
            `${trainLabel} already has a Pre-Treatment reading between ${hourBucket.label}. ` +
            `Only one operational reading is allowed per hour — edit the existing entry, or change the reading time.`,
          );
          return;
        }
      }

      const EXCLUDED_KEYS = new Set([
        'feed_meter_curr', 'permeate_meter_curr', 'reject_meter_curr', 'power_meter_curr',
        'chlorine_residual_mg_l',
      ]);

      const roPayload: any = {
        train_id: opts.trainId, plant_id: opts.plantId, reading_datetime: new Date(opts.dt).toISOString(),
        ...Object.fromEntries(
          Object.entries(opts.roValues)
            .filter(([k]) => !EXCLUDED_KEYS.has(k))
            .map(([k, val]) => [k, val ? +val : null])
        ),
        feed_flow:     opts.effFeedFlow  ?? (opts.roValues.feed_flow     ? +opts.roValues.feed_flow     : null),
        permeate_flow: opts.effPermFlow  ?? (opts.roValues.permeate_flow ? +opts.roValues.permeate_flow : null),
        reject_flow:   opts.rejectFlow   ?? (opts.roValues.reject_flow   ? +opts.roValues.reject_flow   : null),
        dp_psi: opts.dp,
        recovery_pct: opts.recovery,
        rejection_pct: opts.rejection,
        salt_passage_pct: opts.saltPassage,
        ...(opts.feedCurr && !isNaN(opts.feedCurr) ? {
          feed_meter:       opts.feedCurr,
          feed_meter_prev:  opts.prevFeedMeter ?? null,
          feed_meter_delta: opts.feedDelta     ?? null,
        } : {}),
        ...(opts.permCurr && !isNaN(opts.permCurr) ? {
          permeate_meter:       opts.permCurr,
          permeate_meter_prev:  opts.prevPermMeter ?? null,
          permeate_meter_delta: opts.permDelta     ?? null,
        } : {}),
        ...(opts.rejCurr && !isNaN(opts.rejCurr) ? {
          reject_meter:       opts.rejCurr,
          reject_meter_prev:  opts.prevRejMeter ?? null,
          reject_meter_delta: opts.rejDelta     ?? null,
        } : {}),
        power_meter_reading_kwh: opts.pwrCurr && !isNaN(opts.pwrCurr) ? opts.pwrCurr : null,
        power_delta_kwh: opts.pwrDelta,
        power_avg_kw: opts.pwrKw,
        specific_energy_kwh_m3: opts.secEnergy,
        shared_power_meter_group: opts.sharedPowerGroup ?? null,
        ...(opts.roValues.chlorine_residual_mg_l !== '' ? { chlorine_residual_mg_l: +opts.roValues.chlorine_residual_mg_l } : {}),
        ...(opts.roIncompleteReason.trim() ? { incomplete_reason: opts.roIncompleteReason.trim() }
          : !opts.trainOnline ? { incomplete_reason: `Offline${opts.offlineReason ? `: ${opts.offlineReason}` : ''}` }
          : {}),
        ...(opts.anyMeterSpike ? { norm_status: 'pending_review' } : {}),
        recorded_by: opts.activeOperator?.id,
      };

      const { data: savedRow, error: roError } = await (opts.supabase
        .from('ro_train_readings')
        .insert(roPayload)
        .select('id,permeate_meter_delta,feed_meter_delta')
        .single() as any);
      if (roError) {
        if (roError.code === '23505') {
          toast.error(
            `${opts.train?.name ?? `Train ${opts.train?.train_number ?? ''}`}: a reading was already submitted for this exact timestamp. Check the log before resubmitting.`,
            { duration: 8000 },
          );
        } else {
          toast.error(friendlyError(roError));
        }
        return;
      }

      if (opts.anyMeterSpike) {
        const spikes = [
          opts.feedHighWarn ? opts.feedSpike : null,
          opts.permHighWarn ? opts.permSpike : null,
          opts.rejHighWarn  ? opts.rejSpike  : null,
        ].filter((s): any => !!s);
        toast.warning(`Saved, but flagged for review: ${spikes.map((s: any) => s.label).join(', ')} meter reading looks like a spike.`);
        opts.addAlerts(spikes.map((s: any) => ({
          id:          `ro-meter-spike-save-${savedRow?.id ?? opts.trainId}-${s.label}`,
          severity:    'critical' as const,
          title:       `${s.label} meter reading error`,
          description: `${opts.train?.name ?? `Train ${opts.train?.train_number ?? ''}`} — ${s.detail}`,
          source:      'RO Trains',
          plantId:     opts.plantId!,
          timestamp:   Date.now(),
        })));
      }

      if (savedRow?.id) {
        const toSubmit: { needsRemark: boolean; kind: 'feed' | 'permeate' | 'reject'; spike: any; text: string }[] = [
          { needsRemark: opts.feedNeedsRemark, kind: 'feed',      spike: opts.feedSpike, text: opts.anomalyRemarkFeed },
          { needsRemark: opts.permNeedsRemark, kind: 'permeate',  spike: opts.permSpike, text: opts.anomalyRemarkPerm },
          { needsRemark: opts.rejNeedsRemark,  kind: 'reject',    spike: opts.rejSpike,  text: opts.anomalyRemarkRej },
        ];
        for (const s of toSubmit) {
          if (!s.needsRemark) continue;
          void submitAnomalyRemark({
            table_name: 'ro_train_readings',
            record_id: savedRow.id,
            meter_kind: s.kind,
            plant_id: opts.plantId!,
            tier: s.spike.tier as 'needs_remark' | 'critical',
            direction: s.spike.direction!,
            deviation_pct: s.spike.deviationPct!,
            flow_rate: s.spike.rate,
            avg_flow_rate: s.spike.avgRate,
            rate_unit: 'm3/hr',
            remark_text: s.text,
          });
        }
        opts.setAnomalyRemarkFeed(''); opts.setAnomalyRemarkPerm(''); opts.setAnomalyRemarkRej('');
      }

      if (!opts.trainOnline) {
        if (opts.train?.status !== 'Offline') {
          try {
            await opts.supabase.from('train_status_log').insert({
              train_id: opts.trainId, plant_id: opts.plantId, status: 'Offline',
              reason: opts.offlineReason || null,
              confirmed_by: opts.activeOperator?.id ?? null,
              confirmed_at: opts.offlineStart ? new Date(opts.offlineStart).toISOString() : new Date().toISOString(),
            });
          } catch { /* best-effort */ }
        }
        await opts.supabase.from('ro_trains').update({ status: 'Offline' }).eq('id', opts.trainId);
      } else if (opts.train?.status === 'Offline') {
        try {
          await opts.supabase.from('train_status_log').insert({
            train_id: opts.trainId, plant_id: opts.plantId, status: 'Running',
            reason: null,
            confirmed_by: opts.activeOperator?.id ?? null,
            confirmed_at: opts.offlineEnd ? new Date(opts.offlineEnd).toISOString() : new Date().toISOString(),
          });
        } catch { /* best-effort */ }
        await opts.supabase.from('ro_trains').update({ status: 'Running' }).eq('id', opts.trainId);
      }

      const rowsArr = Object.values(opts.afmmf);
      const mmf_readings = opts.isSynchronized
        ? (opts.syncBwOn && (opts.syncMeterStart || opts.syncMeterEnd)
            ? Array.from({ length: opts.numAfm }, (_, i) => i + 1).map((u) => ({
                unit: u,
                meter_start: opts.syncMeterStart ? +opts.syncMeterStart : null,
                meter_end: opts.syncMeterEnd ? +opts.syncMeterEnd : null,
              }))
            : [])
        : rowsArr.filter((r) => r.bw && (r.meterStart || r.meterEnd))
            .map((r) => ({
              unit: r.unit,
              meter_start: r.meterStart ? +r.meterStart : null,
              meter_end: r.meterEnd ? +r.meterEnd : null,
            }));

      const afm_units = Array.from({ length: opts.numAfm }, (_, i) => i + 1).map((u) => {
        const r = opts.afmmf[u] || { unit: u, bw: false, bwStart: '', bwEnd: '', meterStart: '', meterEnd: '', pressureIn: '', pressureOut: '' };
        const pIn = r.pressureIn ? +r.pressureIn : null;
        const pOut = r.pressureOut ? +r.pressureOut : null;
        const dp_psi = pIn !== null && pOut !== null ? +(pIn - pOut).toFixed(2) : null;
        const bwOngoing = opts.isSynchronized ? opts.syncBwOn : r.bw;
        const reasonTxt = getUnitReasonText(opts.afmUnitReasons[u]);
        return {
          unit: u,
          backwash_start: bwOngoing
            ? (opts.isSynchronized
                ? (opts.syncBwStart ? new Date(opts.syncBwStart).toISOString() : null)
                : (r.bwStart ? new Date(r.bwStart).toISOString() : null))
            : null,
          backwash_end: bwOngoing
            ? (opts.isSynchronized
                ? (opts.syncBwEnd ? new Date(opts.syncBwEnd).toISOString() : null)
                : (r.bwEnd ? new Date(r.bwEnd).toISOString() : null))
            : null,
          in_psi: bwOngoing ? null : pIn,
          out_psi: bwOngoing ? null : pOut,
          dp_psi: bwOngoing ? null : dp_psi,
          ...(reasonTxt ? { reason: reasonTxt } : {}),
        };
      });

      const booster_pumps = Array.from({ length: opts.numBoosterPumps }, (_, i) => i + 1).map((u) => {
        const v = opts.boosters[u] || { hz: '', target: '', amp: '', psiMode: opts.boosterPrefPsi };
        const reasonTxt = getUnitReasonText(opts.boosterUnitReasons[u]);
        return {
          unit: u,
          target_pressure_psi: (!v.psiMode || v.psiMode === undefined) ? null : (v.target ? +v.target : null),
          target_hz: v.psiMode ? null : (v.hz ? +v.hz : null),
          hz_mode: !v.psiMode,
          amperage: v.amp ? +v.amp : null,
          ...(reasonTxt ? { reason: reasonTxt } : {}),
        };
      });

      const filter_housings = Array.from({ length: opts.numFilterHousings ?? 0 }, (_, i) => i + 1).map((u) => {
        const v = opts.housings[u] || { inP: '', outP: '' };
        const reasonTxt = getUnitReasonText(opts.housingUnitReasons[u]);
        return {
          unit: u,
          in_psi: v.inP ? +v.inP : null,
          out_psi: v.outP ? +v.outP : null,
          ...(reasonTxt ? { reason: reasonTxt } : {}),
        };
      });

      const cartridge_filter_housings = Array.from({ length: opts.numCartridgeFilters ?? 0 }, (_, i) => i + 1).map((u) => {
        const v = opts.cartridgeHousings[u] || { inP: '', outP: '' };
        const reasonTxt = getUnitReasonText(opts.cartridgeUnitReasons[u]);
        return {
          unit: u,
          in_psi: v.inP ? +v.inP : null,
          out_psi: v.outP ? +v.outP : null,
          ...(reasonTxt ? { reason: reasonTxt } : {}),
        };
      });

      const afmReasonList = Array.from({ length: opts.numAfm }, (_, i) => i + 1)
        .map(u => {
          const txt = getUnitReasonText(opts.afmUnitReasons[u]);
          return txt ? `MMF ${u}: ${txt}` : null;
        }).filter((p): p is string => p !== null);

      const boosterReasonList = Array.from({ length: opts.numBoosterPumps }, (_, i) => i + 1)
        .map(u => {
          const txt = getUnitReasonText(opts.boosterUnitReasons[u]);
          return txt ? `Booster ${u}: ${txt}` : null;
        }).filter((p): p is string => p !== null);

      const hppReasonTxt = getUnitReasonText(opts.hppUnitReason);
      if (hppReasonTxt && !(opts.train?.hpp_target_pressure_psi != null || opts.hppTarget)) {
        boosterReasonList.push(`HPP: ${hppReasonTxt}`);
      }

      const cartridgeReasonList = Array.from({ length: opts.numCartridgeFilters ?? 0 }, (_, i) => i + 1)
        .map(u => {
          const txt = getUnitReasonText(opts.cartridgeUnitReasons[u]);
          return txt ? `Housing ${u}: ${txt}` : null;
        }).filter((p): p is string => p !== null);

      const filterHousingReasonList = Array.from({ length: opts.numFilterHousings ?? 0 }, (_, i) => i + 1)
        .map(u => {
          const txt = getUnitReasonText(opts.housingUnitReasons[u]);
          return txt ? `Filter Housing ${u}: ${txt}` : null;
        }).filter((p): p is string => p !== null);

      const pretreatReasonParts = [
        afmReasonList.length ? afmReasonList.join('; ') : null,
        boosterReasonList.length ? boosterReasonList.join('; ') : null,
        cartridgeReasonList.length ? cartridgeReasonList.join('; ') : null,
        filterHousingReasonList.length ? filterHousingReasonList.join('; ') : null,
      ].filter((p): p is string => p !== null);

      const { error: pretreatError } = await opts.supabase.from('ro_pretreatment_readings').insert({
        plant_id: opts.plantId, train_id: opts.trainId,
        reading_datetime: new Date(opts.dt).toISOString(),
        backwash_start: opts.isSynchronized && opts.syncBwOn && opts.syncBwStart ? new Date(opts.syncBwStart).toISOString() : null,
        backwash_end: opts.isSynchronized && opts.syncBwOn && opts.syncBwEnd ? new Date(opts.syncBwEnd).toISOString() : null,
        mmf_readings, booster_pumps, afm_units, filter_housings, cartridge_filter_housings,
        hpp_target_pressure_psi: opts.hppTarget ? +opts.hppTarget : null,
        bag_filters_changed: +opts.bagsChanged || 0,
        remarks: opts.remarks || null,
        ...(pretreatReasonParts.length ? { incomplete_reason: pretreatReasonParts.join(' | ') }
          : !opts.trainOnline ? { incomplete_reason: `Offline${opts.offlineReason ? `: ${opts.offlineReason}` : ''}` }
          : {}),
        recorded_by: opts.activeOperator?.id,
      } as any);
      if (pretreatError) { toast.error(friendlyError(pretreatError)); return; }

      const pmDelta = (savedRow as any)?.permeate_meter_delta;
      const fmDelta = (savedRow as any)?.feed_meter_delta;
      const deltaStr = pmDelta != null ? ` · permeate +${Number(pmDelta).toLocaleString('en-PH',{maximumFractionDigits:1})} m³` : '';
      toast.success(`${opts.train.name}: saved${deltaStr}`);
      opts.setAfmmf({}); opts.setBoosters({}); opts.setHousings({}); opts.setCartridgeHousings({});
      opts.setSyncBwOn(false); opts.setSyncBwStart(''); opts.setSyncBwEnd('');
      opts.setSyncMeterStart(''); opts.setSyncMeterEnd('');
      opts.setHppTarget(''); opts.setBagsChanged('0'); opts.setRemarks('');
      opts.setAfmReasonNeeded(false); opts.setAfmUnitReasons({});
      opts.setBoosterReasonNeeded(false); opts.setBoosterUnitReasons({}); opts.setHppUnitReason({ reason: '', custom: '' });
      opts.setHousingReasonNeeded(false); opts.setCartridgeUnitReasons({}); opts.setHousingUnitReasons({});
      opts.setRoReasonNeeded(false); opts.setRoIncompleteReason('');
      opts.setAfmSectionStarted(false); opts.setBoosterHppSectionStarted(false); opts.setCartridgeSectionStarted(false);
      if (opts.offlineEnd) {
        opts.setTrainOnline(true); opts.setOfflineStart(''); opts.setOfflineEnd('');
        opts.setOfflineReason(''); opts.setOfflineReasonOther('');
      }
      opts.setConfirmBackOnline(false);
      opts.setRoValues({
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
      opts.qc.invalidateQueries({ queryKey: ['ro-overview'] });
      opts.qc.invalidateQueries({ queryKey: ['ro-last-all'] });
      opts.qc.invalidateQueries({ queryKey: ['ro-spark'] });
      opts.qc.invalidateQueries({ queryKey: ['ro-prev'] });
      opts.qc.invalidateQueries({ queryKey: ['train-hourly-gaps'] });
      opts.qc.invalidateQueries({ queryKey: ['train-latest-status-log', opts.trainId] });
      opts.qc.invalidateQueries({ queryKey: ['train-status-log', opts.trainId] });
      opts.qc.invalidateQueries({ queryKey: ['trains'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-power-today'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-power-yest'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
      opts.qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
      opts.qc.invalidateQueries({ queryKey: ['alerts-feed'] });
      opts.qc.invalidateQueries({ queryKey: ['trend-ro'] });
      opts.qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
      opts.qc.invalidateQueries({ queryKey: ['trend-product'] });
      opts.qc.invalidateQueries({ queryKey: ['trend-power'] });
      opts.qc.invalidateQueries({ queryKey: ['trend-cost'] });
      opts.qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
      opts.qc.invalidateQueries({ queryKey: ['dsm-ro-trains'] });
      opts.qc.invalidateQueries();
    } finally {
      setIsSaving(false);
    }
  };

  return { submit, isSaving, setIsSaving };
}
