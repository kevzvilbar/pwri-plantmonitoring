import { format } from 'date-fns';
import { interpolateMissingGridMeterReadings } from '../TrendChartPivotShared';

export interface PowerTariffRow {
  plant_id?: string | null;
  effective_date?: string | null;
  rate_per_kwh?: number | string | null;
  [key: string]: unknown;
}

export interface PowerTrendRow {
  plant_id?: string | null;
  reading_datetime: string;
  meter_reading_kwh?: number | null;
  grid_meter_readings?: Record<string, number> | null;
  multiplier?: number | null;
  daily_grid_kwh?: number | null;
  daily_consumption_kwh?: number | null;
  daily_solar_kwh?: number | null;
  is_meter_replacement?: boolean | null;
  is_estimated?: boolean | null;
  [key: string]: unknown;
}

export interface TrendDayAccumulator {
  kwh: number;
  solarKwh: number;
  _solarKwhForCost: number;
  _powerCostPeso: number;
  _hasTariff: boolean;
  _meterReplacements: string[];
  [key: string]: unknown;
}

/**
 * Builds a lookup function for the ₱/kWh tariff rate for a plant on a given date.
 */
export function buildTariffsLookup(powerTariffs: PowerTariffRow[] | undefined) {
  const tariffsByPlant = new Map<string, { effectiveDate: string; ratePerKwh: number }[]>();
  (powerTariffs ?? []).forEach((t) => {
    if (!t.plant_id || t.rate_per_kwh == null || !t.effective_date) return;
    if (!tariffsByPlant.has(t.plant_id)) tariffsByPlant.set(t.plant_id, []);
    tariffsByPlant.get(t.plant_id)!.push({
      effectiveDate: t.effective_date,
      ratePerKwh: +t.rate_per_kwh,
    });
  });
  tariffsByPlant.forEach((arr) => arr.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)));

  return function getRateForDay(plantId: string, dateKey: string): number | null {
    const tariffs = tariffsByPlant.get(plantId);
    if (!tariffs || tariffs.length === 0) return null;
    let rate: number | null = null;
    for (const t of tariffs) {
      if (t.effectiveDate <= dateKey) rate = t.ratePerKwh;
      else break;
    }
    return rate;
  };
}

export interface ProcessPowerTrendParams {
  powerReadings: PowerTrendRow[] | undefined;
  powerConfigMap?: Map<string, number[]>;
  billMultiplierMap?: Map<string, number>;
  plantNames?: Map<string, string>;
  startISO: string;
  startKey: string;
  endKey: string;
  metric: string;
  getRateForDay: (plantId: string, dateKey: string) => number | null;
  ensure: (key: string, sortKey: number) => TrendDayAccumulator;
}

export function processPowerReadingsForTrend({
  powerReadings,
  powerConfigMap,
  billMultiplierMap,
  plantNames,
  startISO,
  startKey,
  endKey,
  metric,
  getRateForDay,
  ensure,
}: ProcessPowerTrendParams): void {
  const rawSorted = [...(powerReadings ?? [])].sort(
    (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
  ) as PowerTrendRow[];
  const sorted = interpolateMissingGridMeterReadings(rawSorted);

  const prevGridMeter = new Map<string, number | null>();
  const prevGridReadings = new Map<string, Record<string, number>>();
  const afterGridRepl = new Set<string>();

  for (const r of sorted) {
    const pid = r.plant_id ?? '__';
    const isMR = !!r.is_meter_replacement;
    const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
    const rGmr = r.grid_meter_readings as Record<string, number> | null | undefined;

    if (isMR) {
      if (gridCurrent != null) prevGridMeter.set(pid, gridCurrent);
      const replBaselines = { ...(prevGridReadings.get(pid) ?? {}) };
      if (rGmr) {
        for (const [k, v] of Object.entries(rGmr)) {
          if (v != null && Number.isFinite(+v)) replBaselines[k] = +v;
        }
      }
      if (gridCurrent != null) replBaselines['0'] = gridCurrent;
      prevGridReadings.set(pid, replBaselines);
      afterGridRepl.add(pid);

      const dt = new Date(r.reading_datetime);
      if (dt >= new Date(startISO)) {
        const dateKey = format(dt, 'yyyy-MM-dd');
        if (dateKey >= startKey && dateKey <= endKey) {
          const key = format(dt, 'MMM d');
          const row = ensure(key, dt.getTime());
          const entityName = plantNames?.get(pid) ?? pid ?? 'Plant';
          const label = `${entityName} Power Meter`;
          if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
        }
      }
      continue;
    }

    let gridKwh = 0;
    const multArr: number[] = powerConfigMap?.get(pid) ?? [
      +(r.multiplier ?? 0) > 0 ? +r.multiplier! : (billMultiplierMap?.get(pid) ?? 1),
    ];

    if (!afterGridRepl.has(pid)) {
      const pGmr = prevGridReadings.get(pid) ?? null;
      const pMeter = prevGridMeter.get(pid) ?? null;

      if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
        let total = 0;
        for (const k of Object.keys(rGmr)) {
          const mi = parseInt(k, 10);
          const mMult = multArr[mi] ?? multArr[0] ?? 1;
          const currVal = rGmr[k];
          const prevVal = pGmr[k];
          if (currVal != null && prevVal != null) {
            const d = (currVal - prevVal) * mMult;
            if (d >= 0) total += d;
          }
        }
        gridKwh = total;
      } else if (pMeter != null && gridCurrent != null) {
        const rawDelta = gridCurrent - pMeter;
        if (rawDelta >= 0) gridKwh = rawDelta * (multArr[0] ?? 1);
      }

      if (gridKwh === 0) {
        if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
          gridKwh = +r.daily_grid_kwh;
        else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
          gridKwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
      }
    }
    afterGridRepl.delete(pid);
    if (gridCurrent != null) prevGridMeter.set(pid, gridCurrent);
    const currentBaselines = { ...(prevGridReadings.get(pid) ?? {}) };
    if (rGmr) {
      for (const [k, v] of Object.entries(rGmr)) {
        if (v != null && Number.isFinite(+v)) currentBaselines[k] = +v;
      }
    }
    if (gridCurrent != null && currentBaselines['0'] == null) {
      currentBaselines['0'] = gridCurrent;
    }
    prevGridReadings.set(pid, currentBaselines);

    const dt = new Date(r.reading_datetime);
    if (dt < new Date(startISO)) continue;
    const dateKey = format(dt, 'yyyy-MM-dd');
    if (dateKey < startKey || dateKey > endKey) continue;

    const key = format(dt, 'MMM d');
    if (gridKwh > 0) {
      const row = ensure(key, dt.getTime());
      row.kwh += gridKwh;
    }

    if (metric === 'productionCost' && gridKwh > 0) {
      const rate = getRateForDay(pid, dateKey);
      if (rate != null) {
        const row = ensure(key, dt.getTime());
        const solarForCost = (r.daily_solar_kwh != null)
          ? Math.max(0, +r.daily_solar_kwh) : 0;
        row._solarKwhForCost += solarForCost;
        row._powerCostPeso += gridKwh * rate;
        row._hasTariff = true;
      }
    }
  }

  // Accumulate daily_solar_kwh per day for the (Grid+Solar) PV ratio line
  (powerReadings ?? []).forEach((r) => {
    if (r.daily_solar_kwh == null || r.is_meter_replacement) return;
    const solarVal = +r.daily_solar_kwh;
    if (solarVal <= 0) return;
    const dt = new Date(r.reading_datetime);
    if (dt < new Date(startISO)) return;
    const dateKey = format(dt, 'yyyy-MM-dd');
    if (dateKey < startKey || dateKey > endKey) return;
    const key = format(dt, 'MMM d');
    const row = ensure(key, dt.getTime());
    row.solarKwh += solarVal;
  });
}
