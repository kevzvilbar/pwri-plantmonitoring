import { type QueryClient } from '@tanstack/react-query';
import { type SupabaseClient } from '@supabase/supabase-js';
import { classifyDeviation } from '@/lib/flowRateGuards';

export interface UsePowerSubmitOptions {
  plantId: string | null;
  configLoading: boolean;
  configMultiplierArr: (number | string)[] | null | undefined;
  toast: {
    error: (message: string) => void;
    info: (message: string) => void;
    success: (message: string) => void;
  };
  getSolarLabel: (idx: number) => string;
  getGridLabel: (idx: number) => string;
  prevGrid: number | null;
  prevRow: any;
  dt: string;
  fmtNum: (num: number, digits: number) => string;
  findExistingReading: (opts: {
    table: string;
    entityCol: string;
    entityId: string;
    datetime: Date;
    windowKind: string;
  }) => Promise<string | null>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  deltaGrid: number | null;
  deltaSolar: number | null;
  effectiveMultiplier: number;
  supabase: SupabaseClient;
  gridMeterReadings: string[];
  solarMeterReadings: string[];
  showSolar: boolean;
  solarInputMode: 'raw' | 'direct';
  gridMeterCount: number;
  getLatestGridReading: (meterIdx: number) => number | null;
  setGridMeterReadings: (fn: (prev: string[]) => string[]) => void;
  setSolarMeterReadings: (fn: (prev: string[]) => string[]) => void;
  setReading: (val: string) => void;
  setSolarReading: (val: string) => void;
  setPowerAnomaly: (
    val:
      | { result: ReturnType<typeof classifyDeviation>; kind: 'grid' | 'solar'; idx: number }
      | null
  ) => void;
  setAnomalyRemark: (val: string) => void;
  setSavingMeter: (val: string | null) => void;
  powerAnomaly: { result: ReturnType<typeof classifyDeviation>; kind: 'grid' | 'solar'; idx: number } | null;
  anomalyRemark: string;
  avgPowerRate: number | null;
  computeRate: (volume: number, hours: number | undefined, points?: unknown[], strict?: boolean) => number;
  classifyDeviation: (rate: number, avg: number | null | undefined, multiplier: number) => ReturnType<typeof classifyDeviation>;
  ALERTS: { power_spike_multiplier: number };
  isAnomalyRemarkValid: (remark: string) => boolean;
  submitAnomalyRemark: (opts: any) => Promise<any>;
  invalidatePowerDash: (qc: QueryClient) => void;
  qc: QueryClient;
  friendlyError: (error: unknown) => string;
  user: { id: string } | null;
}

export function usePowerSubmit(opts: UsePowerSubmitOptions) {
  const {
    plantId,
    configLoading,
    configMultiplierArr,
    toast,
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
    computeRate,
    classifyDeviation,
    ALERTS,
    isAnomalyRemarkValid,
    submitAnomalyRemark,
    invalidatePowerDash,
    qc,
    friendlyError,
    user,
  } = opts;

  // Save a single meter reading independently
  const submitMeter = async (kind: 'solar' | 'grid', idx: number) => {
    if (!plantId) return;
    // Guard: block grid saves when the CT-multiplier config is unavailable.
    //
    // Two failure modes are handled here:
    //   1. configLoading === true  → query is still in-flight; effectiveMultiplier
    //      would use the local-input fallback (or 1) instead of the DB value.
    //   2. configLoading === false but configMultiplierArr is null / empty → the
    //      query settled without a usable multiplier (no plant_power_config row, or
    //      grid_meter_multipliers is null/[]). effectiveMultiplier falls back to
    //      (+multiplierInput || 1) which stores the raw delta instead of (delta × CT).
    //
    // Previously only case 1 was caught, so readings saved when the config had no
    // row would silently store the raw meter delta as daily_grid_kwh, causing the
    // Dashboard chart to display the unscaled value (e.g. 11 kWh) while the history
    // table (which recomputes rawDelta × configMult on-the-fly) showed the correct
    // scaled value (e.g. 12,720 kWh). Now both cases are blocked explicitly.
    if (kind === 'grid') {
      if (configLoading) {
        toast.error('Meter config still loading — please wait a moment before saving.');
        return;
      }
      if (!Array.isArray(configMultiplierArr) || configMultiplierArr.length === 0) {
        toast.error(
          'CT multiplier not configured for this plant. ' +
          'Set it under Plants → Power → CT Multiplier before saving grid readings, ' +
          'or enter it manually in the multiplier field above.',
        );
        return;
      }
    }
    const meterKey = `${kind}-${idx}`;
    const val = kind === 'solar' ? (solarMeterReadings[idx] ?? '') : (gridMeterReadings[idx] ?? '');
    if (!val) { toast.error(`Enter a reading for ${kind === 'solar' ? getSolarLabel(idx) : getGridLabel(idx)}`); return; }

    // Redundancy Guard (12 hours): identical odometer reading within 12h cannot be saved
    if (kind === 'grid' && idx === 0 && prevGrid != null && +val === prevGrid) {
      const hoursElapsed = prevRow?.reading_datetime
        ? (new Date(dt).getTime() - new Date(prevRow.reading_datetime).getTime()) / 3_600_000
        : null;
      if (hoursElapsed != null && hoursElapsed < 12) {
        toast.error(`Grid meter: this odometer reading (${fmtNum(+val, 1)}) was already recorded within the last 12 hours.`);
        return;
      }
    }

    setSavingMeter(meterKey);

    // FIX (multi-meter collision): use a local `rowId` so we can resolve an existing
    // today-row and immediately proceed to save — no second click required.
    // The old pattern (setEditingId + early return) meant meter-2 would switch to
    // edit mode on click-1 and then OVERWRITE meter_reading_kwh on click-2, clobbering
    // whatever meter-1 had saved.  Now we fall through and merge into the existing row.
    let rowId: string | null = editingId;

    if (kind === 'grid' && !rowId) {
      const dup = await findExistingReading({
        table: 'power_readings', entityCol: 'plant_id', entityId: plantId,
        datetime: new Date(dt), windowKind: 'day',
      });
      if (dup) {
        rowId = dup;
        setEditingId(dup);
        // Don't return — fall through and patch only this meter's key in the existing row.
        toast.info(`Today's power reading found — saving ${getGridLabel(idx)} into existing row.`);
      }
    }

    // Compute deltas for the primary meter only.
    // BUG A FIX: removed the `showSolar &&` guard — computedDailyGrid must be
    // computed for grid-only plants too.  Previously it was always null when
    // showSolar === false, so the else-if partial path (below) never wrote
    // daily_grid_kwh and the Plants chart read the raw unscaled delta from
    // daily_consumption_kwh instead of the CT-multiplied effective kWh.
    const computedDailyGrid  = kind === 'grid'  && idx === 0 && deltaGrid  != null ? deltaGrid  * effectiveMultiplier : null;
    // In raw mode: delta is computed from prevSolar vs current solar meter reading
    // In direct mode: the user IS entering the delta — no prev needed, don't use deltaSolar
    const computedDailySolar = kind === 'solar' && idx === 0 && showSolar && solarInputMode === 'raw' && deltaSolar != null ? deltaSolar : null;

    const payload: any = {
      plant_id: plantId,
      reading_datetime: new Date(dt).toISOString(),
      recorded_by: user?.id,
    };

    if (kind === 'grid') {
      // ── JSONB merge: read the existing grid_meter_readings so we only patch this
      // meter's key, leaving all other meters' readings intact.
      let mergedGridReadings: Record<string, number> = { [String(idx)]: +val };
      if (rowId) {
        try {
          const { data: existingRow } = await supabase
            .from('power_readings')
            .select('grid_meter_readings')
            .eq('id', rowId)
            .maybeSingle();
          const existing = (existingRow?.grid_meter_readings as Record<string, number> | null) ?? {};
          mergedGridReadings = { ...existing, [String(idx)]: +val };
        } catch { /* non-critical — proceed with single-key payload */ }
      }
      payload.grid_meter_readings = mergedGridReadings;

      // meter_reading_kwh: kept for backward compatibility with dashboards, CSV importer,
      // cost pages, and trend charts that still read this column.
      // Only update it for meter 0; secondary meters live only in grid_meter_readings.
      if (idx === 0) payload.meter_reading_kwh = +val;

      // Compute daily_grid_kwh as the sum of (Δ per meter × per-meter CT multiplier).
      // Previous per-meter readings are resolved per meter index from history,
      // so missing readings on the immediate previous day do not erase baselines.
      const prevMeters: Record<string, number> = (() => {
        const map: Record<string, number> = {};
        for (let mi = 0; mi < gridMeterCount; mi++) {
          const v = getLatestGridReading(mi);
          if (v != null) map[String(mi)] = v;
        }
        return map;
      })();

      let totalDailyGrid = 0;
      let allMetersPresent = true;
      let computedMeterCount = 0;
      for (let mi = 0; mi < gridMeterCount; mi++) {
        const curr = mergedGridReadings[String(mi)];
        const prev = prevMeters[String(mi)];
        if (curr != null && prev != null) {
          const mMult = Array.isArray(configMultiplierArr) && +configMultiplierArr[mi] > 0
            ? +configMultiplierArr[mi]
            : effectiveMultiplier;
          const delta = (curr - prev) * mMult;
          if (delta >= 0) {
            totalDailyGrid += delta;
            computedMeterCount++;
          }
        } else {
          allMetersPresent = false;
        }
      }
      if (computedMeterCount > 0) {
        payload.daily_grid_kwh       = totalDailyGrid;
        payload.daily_consumption_kwh = totalDailyGrid;
      } else if (allMetersPresent) {
        payload.daily_grid_kwh       = totalDailyGrid;
        payload.daily_consumption_kwh = totalDailyGrid;
      } else if (idx === 0 && deltaGrid != null) {
        // Partial data fallback: only meter-0 is available
        const partialKwh = computedDailyGrid ?? deltaGrid * effectiveMultiplier;
        payload.daily_grid_kwh        = partialKwh;
        payload.daily_consumption_kwh = partialKwh;
      }
    }
    if (kind === 'solar') {
      // Only include meter_reading_kwh from grid if the user has actually entered one —
      // writing 0 would corrupt the cumulative grid meter sequence.
      const gridVal = gridMeterReadings[0];
      if (gridVal && +gridVal > 0) payload.meter_reading_kwh = +gridVal;
      if (solarInputMode === 'direct') {
        // Direct daily kWh: store only daily_solar_kwh, do NOT touch solar_meter_reading
        // (writing a raw meter value would corrupt the cumulative sequence)
        payload.daily_solar_kwh = +val;
      } else {
        // Raw cumulative meter: store solar_meter_reading and auto-compute daily_solar_kwh
        payload.solar_meter_reading = +val;
        // Only attach daily_solar_kwh when delta is actually computable (prev exists)
        if (idx === 0 && computedDailySolar != null) payload.daily_solar_kwh = computedDailySolar;
      }
    }

    // Flow-rate anomaly check — Power previously had no save-time guard at
    // all (see flowRateGuards.ts). Only runs once daily_consumption_kwh is
    // actually finalized in this payload (grid: all meters present; solar:
    // delta computable) — a partial-data save has nothing meaningful to
    // compare yet. Two-step: if this reading is outside the normal band and
    // the operator hasn't written a remark yet, stop here (before touching
    // the DB) and show the banner below instead of saving; clicking Save
    // again after typing a remark proceeds.
    if (payload.daily_consumption_kwh != null && prevRow?.reading_datetime) {
      const hoursElapsed = (new Date(dt).getTime() - new Date(prevRow.reading_datetime).getTime()) / 3_600_000;
      const rate = computeRate(payload.daily_consumption_kwh, hoursElapsed, undefined, true);
      const result = classifyDeviation(rate, avgPowerRate, ALERTS.power_spike_multiplier);
      if (result.tier !== 'ok' && !isAnomalyRemarkValid(anomalyRemark)) {
        setPowerAnomaly({ result, kind, idx });
        setSavingMeter(null);
        toast.error(`${kind === 'grid' ? getGridLabel(idx) : getSolarLabel(idx)}: this reading is outside the normal range — add a remark before saving.`);
        return;
      }
    } else if (powerAnomaly) {
      setPowerAnomaly(null);
    }

    const runQuery = () => rowId
      ? supabase.from('power_readings').update(payload).eq('id', rowId).select('id')
      : supabase.from('power_readings').insert(payload).select('id');

    let { data: savedRows, error } = await runQuery();
    if (error && (
      error.message.includes('daily_solar_kwh') ||
      error.message.includes('daily_grid_kwh') ||
      error.message.includes('solar_meter_reading') ||
      error.message.includes('multiplier') ||
      error.message.includes('grid_meter_readings')
    )) {
      // Column may not exist yet in older DBs — retry without optional columns
      delete payload.daily_solar_kwh;
      delete payload.daily_grid_kwh;
      delete payload.solar_meter_reading;
      delete payload.multiplier;
      delete payload.grid_meter_readings;
      ({ data: savedRows, error } = await runQuery());
    }

    setSavingMeter(null);
    if (error) { toast.error(friendlyError(error)); return; }

    // Best-effort — the reading itself already saved successfully above,
    // this never blocks or rolls it back. See flowRateGuards.ts.
    if (powerAnomaly && savedRows?.[0]?.id) {
      const { result } = powerAnomaly;
      void submitAnomalyRemark({
        table_name: 'power_readings',
        record_id: savedRows[0].id,
        plant_id: plantId,
        tier: result.tier as 'needs_remark' | 'critical',
        direction: result.direction!,
        deviation_pct: result.deviationPct!,
        flow_rate: result.rate ?? 0,
        avg_flow_rate: result.avgRate ?? 0,
        rate_unit: 'kwh/hr',
        remark_text: anomalyRemark,
      });
    }
    setPowerAnomaly(null);
    setAnomalyRemark('');

    const label = kind === 'solar' ? getSolarLabel(idx) : getGridLabel(idx);
    toast.success(`${label}: reading saved`);

    // Clear only the saved meter's input
    if (kind === 'grid') {
      setGridMeterReadings(prev => { const next = [...prev]; next[idx] = ''; return next; });
      if (idx === 0) setReading('');
    } else {
      setSolarMeterReadings(prev => { const next = [...prev]; next[idx] = ''; return next; });
      if (idx === 0) setSolarReading('');
    }
    invalidatePowerDash(qc);
  };

  return { submitMeter };
}
