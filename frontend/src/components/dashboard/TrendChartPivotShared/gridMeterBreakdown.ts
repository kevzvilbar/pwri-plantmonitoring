import { format } from 'date-fns';
import { interpolateMissingGridMeterReadings } from './gridMeterInterpolation';
export { interpolateMissingGridMeterReadings } from './gridMeterInterpolation';

export interface GridPowerReadingRow {
  plant_id?: string | null;
  reading_datetime: string;
  meter_reading_kwh?: number | null;
  grid_meter_readings?: Record<string, number> | null;
  daily_grid_kwh?: number | null;
  daily_consumption_kwh?: number | null;
  multiplier?: number | null;
  is_meter_replacement?: boolean | null;
  is_estimated?: boolean | null;
}

export interface GridMeterColumn {
  key: string;
  label: string;
  title?: string;
}

export interface GridMeterDayRow {
  dateKey: string;
  values: Record<string, number>;
  total: number;
}

export interface GridMeterBreakdown {
  dates: string[];
  columns: GridMeterColumn[];
  byDate: Map<string, GridMeterDayRow>;
  hasUnattributed: boolean;
  multiPlant: boolean;
}

export const GRID_METER_OTHER_KEY = '__other__';

export function computeGridMeterBreakdown(
  readings: GridPowerReadingRow[],
  opts: {
    powerConfigMap?: Map<string, number[]>;
    billMultiplierMap?: Map<string, number>;
    plantNames?: Map<string, string>;
    gridMeterMeta?: Map<string, { names: string[]; count: number }>;
    fromMs?: number | null;
    toMs?: number | null;
  } = {},
): GridMeterBreakdown {
  const { powerConfigMap, billMultiplierMap, plantNames, gridMeterMeta, fromMs, toMs } = opts;

  const rawSorted = [...readings].sort(
    (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
  );
  const sorted = interpolateMissingGridMeterReadings(rawSorted);

  const plantOrder: string[] = [];
  const plantSeen = new Set<string>();
  const plantMaxIdx = new Map<string, number>();
  for (const r of sorted) {
    const pid = r.plant_id ?? '__';
    if (!plantSeen.has(pid)) { plantSeen.add(pid); plantOrder.push(pid); }
    const gmr = r.grid_meter_readings;
    if (gmr) {
      for (const k of Object.keys(gmr)) {
        const mi = parseInt(k, 10);
        if (Number.isFinite(mi)) plantMaxIdx.set(pid, Math.max(plantMaxIdx.get(pid) ?? 0, mi));
      }
    }
  }

  const meterCountFor = (pid: string): number =>
    Math.max(1, gridMeterMeta?.get(pid)?.count ?? 0, (plantMaxIdx.get(pid) ?? -1) + 1);

  const meterLabelFor = (pid: string, mi: number): string => {
    const names = gridMeterMeta?.get(pid)?.names;
    const count = meterCountFor(pid);
    return names?.[mi] || (count === 1 ? 'Grid Meter' : `Grid Meter ${mi + 1}`);
  };

  const byDate = new Map<string, GridMeterDayRow>();
  const daySort = new Map<string, number>();
  const prevGridMeter = new Map<string, number | null>();
  const prevGridReadings = new Map<string, Record<string, number>>();
  const afterGridRepl = new Set<string>();

  for (const r of sorted) {
    const pid = r.plant_id ?? '__';
    const isMR = !!r.is_meter_replacement;
    const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
    let rGmr = r.grid_meter_readings ? { ...r.grid_meter_readings } : null;
    if (gridCurrent != null) {
      if (!rGmr) rGmr = {};
      if (rGmr['0'] == null) rGmr['0'] = gridCurrent;
    }

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
      continue;
    }

    let gridKwh = 0;
    const meterDeltas = new Map<string, number>();
    const multArr: number[] = powerConfigMap?.get(pid) ?? [
      +(r.multiplier ?? 0) > 0 ? +r.multiplier : (billMultiplierMap?.get(pid) ?? 1),
    ];

    if (!afterGridRepl.has(pid)) {
      const pGmr   = prevGridReadings.get(pid) ?? null;
      const pMeter = prevGridMeter.get(pid) ?? null;

      if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
        for (const k of Object.keys(rGmr)) {
          const mi = parseInt(k, 10);
          if (!Number.isFinite(mi)) continue;
          const mMult = multArr[mi] ?? multArr[0] ?? 1;
          const currVal = rGmr[k];
          const prevVal = pGmr[k];
          if (currVal != null && prevVal != null) {
            const rawD = (currVal - prevVal) * mMult;
            const d = Math.round(rawD * 1000) / 1000;
            if (d >= 0) {
              gridKwh = Math.round((gridKwh + d) * 1000) / 1000;
              const colKey = `${pid}#${mi}`;
              meterDeltas.set(colKey, Math.round(((meterDeltas.get(colKey) ?? 0) + d) * 1000) / 1000);
            }
          }
        }
      }

      if (gridKwh === 0 && pMeter != null && gridCurrent != null) {
        const rawD = (gridCurrent - pMeter) * (multArr[0] ?? 1);
        const d = Math.round(rawD * 1000) / 1000;
        if (d >= 0) {
          gridKwh = d;
          meterDeltas.set(`${pid}#0`, gridKwh);
        }
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
    if (gridCurrent != null && currentBaselines['0'] == null) currentBaselines['0'] = gridCurrent;
    prevGridReadings.set(pid, currentBaselines);

    if (gridKwh <= 0) continue;
    const t = new Date(r.reading_datetime).getTime();
    if (fromMs != null && t < fromMs) continue;
    if (toMs != null && t > toMs) continue;

    const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    let row = byDate.get(dateKey);
    if (!row) {
      row = { dateKey, values: {}, total: 0 };
      byDate.set(dateKey, row);
    }
    daySort.set(dateKey, Math.max(daySort.get(dateKey) ?? 0, t));
    row.total += gridKwh;
    meterDeltas.forEach((v, k) => { row.values[k] = (row.values[k] ?? 0) + v; });
  }

  let hasUnattributed = false;
  for (const row of byDate.values()) {
    const known = Object.entries(row.values)
      .filter(([k]) => k !== GRID_METER_OTHER_KEY)
      .reduce((s, [, v]) => s + v, 0);
    const residual = row.total - known;
    if (Math.abs(residual) > 0.05) {
      row.values[GRID_METER_OTHER_KEY] = residual;
      hasUnattributed = true;
    }
  }

  const multiPlant = plantOrder.length > 1;
  const columns: GridMeterColumn[] = [];
  for (const pid of plantOrder) {
    const count = meterCountFor(pid);
    for (let mi = 0; mi < count; mi++) {
      const label = meterLabelFor(pid, mi);
      const plantName = plantNames?.get(pid);
      columns.push(multiPlant
        ? { key: `${pid}#${mi}`, label: `${(plantName ?? 'Plant').split(' ')[0]} · ${label}`, title: `${plantName ?? 'Plant'} — ${label}` }
        : { key: `${pid}#${mi}`, label, title: label });
    }
  }

  return {
    dates: [...byDate.keys()].sort((a, b) => (daySort.get(a) ?? 0) - (daySort.get(b) ?? 0)),
    columns,
    byDate,
    hasUnattributed,
    multiPlant,
  };
}
