import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fmtNum } from '@/lib/calculations';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { ALERTS } from '@/lib/calculations';
import { findExistingReading } from '@/lib/duplicateCheck';
import { isAnomalyRemarkValid, submitAnomalyRemark } from '@/lib/anomalyRemarks';
import { friendlyError } from '@/lib/supabaseErrors';
import { invalidatePowerDash } from '../../shared';
import { usePowerSubmit } from './usePowerSubmit';
import type { UsePowerSubmitOptions } from './usePowerSubmit';

export function usePowerFormActions(state: ReturnType<typeof import('./usePowerFormState').usePowerFormState>) {
  const {
    plantId, configLoading, configMultiplierArr,
    getSolarLabel, getGridLabel,
    prevGrid, prevRow, dt,
    reading, solarReading,
    editingId, setEditingId,
    deltaGrid, deltaSolar,
    effectiveMultiplier,
    gridMeterReadings, solarMeterReadings,
    showSolar, solarInputMode,
    gridMeterCount, solarMeterCount,
    getLatestGridReading,
    setGridMeterReadings, setSolarMeterReadings,
    setReading, setSolarReading, setDt,
    setPowerAnomaly, setAnomalyRemark,
    setSavingMeter,
    powerAnomaly, anomalyRemark,
    avgPowerRate, user,
    isAdmin, isManager, isDataAnalyst,
  } = state;

  const qc = useQueryClient();

  const submitMeterOpts: UsePowerSubmitOptions = {
    plantId,
    configLoading,
    configMultiplierArr,
    toast: { error: toast.error, info: toast.info, success: toast.success },
    getSolarLabel,
    getGridLabel,
    prevGrid,
    prevRow,
    dt,
    fmtNum,
    findExistingReading,
    editingId,
    setEditingId,
    deltaGrid,
    deltaSolar,
    effectiveMultiplier,
    supabase,
    gridMeterReadings,
    solarMeterReadings,
    showSolar,
    solarInputMode,
    gridMeterCount,
    getLatestGridReading,
    setGridMeterReadings,
    setSolarMeterReadings,
    setReading,
    setSolarReading,
    setPowerAnomaly,
    setAnomalyRemark,
    setSavingMeter,
    powerAnomaly,
    anomalyRemark,
    avgPowerRate,
    computeRate: computeRate as any,
    classifyDeviation,
    ALERTS,
    isAnomalyRemarkValid,
    submitAnomalyRemark,
    invalidatePowerDash,
    qc,
    friendlyError,
    user,
  };

  const { submitMeter } = usePowerSubmit(submitMeterOpts);

  const submit = async () => {
    if (!plantId || !reading) return;
    if (configLoading) {
      toast.error('Meter config still loading — please wait a moment before saving.');
      return;
    }
    const computedDailyGrid = deltaGrid != null ? deltaGrid * effectiveMultiplier : null;
    const computedDailySolar = showSolar && deltaSolar != null ? deltaSolar : null;
    const payload: any = {
      plant_id: plantId,
      reading_datetime: new Date(dt).toISOString(),
      meter_reading_kwh: +reading,
      recorded_by: user?.id,
    };
    if (editingId) {
      try {
        const { data: existingRow } = await supabase
          .from('power_readings')
          .select('grid_meter_readings')
          .eq('id', editingId)
          .maybeSingle();
        const existing = (existingRow?.grid_meter_readings as Record<string, number> | null) ?? {};
        payload.grid_meter_readings = { ...existing, '0': +reading };
      } catch {
        payload.grid_meter_readings = { '0': +reading };
      }
    } else {
      payload.grid_meter_readings = { '0': +reading };
    }
    if (showSolar && solarReading) payload.solar_meter_reading = +solarReading;
    if (computedDailyGrid != null) payload.daily_grid_kwh = computedDailyGrid;
    if (showSolar && computedDailySolar != null) payload.daily_solar_kwh = computedDailySolar;
    if (deltaGrid != null) payload.daily_consumption_kwh = deltaGrid * effectiveMultiplier;
    const runQuery = () => editingId
      ? supabase.from('power_readings').update(payload).eq('id', editingId)
      : supabase.from('power_readings').insert(payload);
    let { error } = await runQuery();
    if (error && (
      error.message.includes('daily_solar_kwh') ||
      error.message.includes('daily_grid_kwh') ||
      error.message.includes('solar_meter_reading') ||
      error.message.includes('multiplier')
    )) {
      delete payload.daily_solar_kwh; delete payload.daily_grid_kwh;
      delete payload.solar_meter_reading; delete payload.multiplier;
      ({ error } = await runQuery());
    }
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(editingId ? 'Updated' : 'Power reading saved');
    setReading(''); setSolarReading(''); setEditingId(null);
    setGridMeterReadings(['', '', '', '', '']);
    setSolarMeterReadings(['', '', '', '', '']);
    invalidatePowerDash(qc);
  };

  const startEdit = (r: any) => {
    setReading(String(r.meter_reading_kwh));
    setSolarReading(r.solar_meter_reading != null ? String(r.solar_meter_reading) : '');
    const gmr = (r.grid_meter_readings as Record<string, number> | null) ?? {};
    setGridMeterReadings(prev => {
      const next = prev.map(() => '');
      next[0] = gmr['0'] != null ? String(gmr['0']) : String(r.meter_reading_kwh);
      for (let i = 1; i < prev.length; i++) {
        if (gmr[String(i)] != null) next[i] = String(gmr[String(i)]);
      }
      return next;
    });
    setSolarMeterReadings(prev => { const next = [...prev]; next[0] = r.solar_meter_reading != null ? String(r.solar_meter_reading) : ''; return next; });
    setDt(format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditingId(r.id);
    toast.info('Editing power reading');
  };

  const saveMultiplierToConfig = async (val: number) => {
    if (!plantId || !(isAdmin || isManager || isDataAnalyst)) return;
    try {
      const existingArr = Array.isArray(configMultiplierArr) ? [...configMultiplierArr] : [];
      existingArr[0] = val;
      await supabase.from('plant_power_config' as any)
        .upsert(
          { plant_id: plantId, grid_meter_multipliers: existingArr, updated_at: new Date().toISOString() },
          { onConflict: 'plant_id' }
        );
      qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
    } catch { /* non-critical */ }
  };

  const handlePlantChange = useCallback((v: string) => {
    state.setPlantId(v);
    setEditingId(null);
    state.setMultiplierInput('');
    setReading('');
    setSolarReading('');
    setGridMeterReadings(['', '', '', '', '']);
    setSolarMeterReadings(['', '', '', '', '']);
  }, [state]);

  const displayHistory = useMemo(() => {
    if (!state.history?.length) return [];
    return state.history.map((r: any, i: number) => {
      const pred = state.history[i + 1] ?? null;
      const deltaKwh = (() => {
        const rGmr = r.grid_meter_readings as Record<string, number> | null | undefined;
        const pGmr = pred?.grid_meter_readings as Record<string, number> | null | undefined;
        if (rGmr && pGmr && Object.keys(rGmr).length > 1) {
          let total = 0;
          for (const k of Object.keys(rGmr)) {
            if (pGmr[k] != null) total += rGmr[k] - pGmr[k];
          }
          return total;
        }
        return pred != null ? r.meter_reading_kwh - pred.meter_reading_kwh : (r.daily_consumption_kwh ?? null);
      })();
      const deltaSolarKwh = (pred?.solar_meter_reading != null && r.solar_meter_reading != null)
        ? r.solar_meter_reading - pred.solar_meter_reading
        : (r.daily_solar_kwh ?? null);
      const deltaGridKwh = state.showSolar && deltaKwh != null
        ? deltaKwh * state.effectiveMultiplier
        : (r.daily_grid_kwh != null ? r.daily_grid_kwh : deltaKwh);
      return { ...r, _deltaKwh: deltaKwh, _deltaSolar: deltaSolarKwh, _deltaGrid: deltaGridKwh };
    });
  }, [state.history, state.showSolar, state.effectiveMultiplier]);

  return {
    submitMeter,
    submit,
    startEdit,
    saveMultiplierToConfig,
    handlePlantChange,
    displayHistory,
  };
}

