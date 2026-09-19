/* eslint-disable @typescript-eslint/no-explicit-any */
export type HistoryModule = 'locator' | 'well' | 'blending' | 'power';
export const HISTORY_WINDOWS = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '60D', days: 60 },
] as const;
export interface HistoryEditState {
  id: string;
  datetime: string;          // "yyyy-MM-dd'T'HH:mm"
  value: string;             // primary numeric field
  value2?: string;           // secondary (power for well, or solar for power)
  value3?: string;           // tertiary (grid for power)
  value4?: string;           // TDS ppm (well)
  value5?: string;           // pressure psi (well)
  value6?: string;           // turbidity NTU (well)
  isMeterReplacement?: boolean;
  /** True only when is_meter_replacement was actually returned by the SELECT query.
   *  When false/undefined the column is absent from the schema cache and must be
   *  omitted from the UPDATE payload to avoid the PostgREST
   *  "relation 'well_readings' does not exist" error. */
  hasMeterReplacement?: boolean;
  /** power module only — which grid meter index `value` belongs to (0 = STP,
   *  matching the legacy meter_reading_kwh column). Captured at edit-start
   *  time from meterFilter so saveEdit writes to the right
   *  grid_meter_readings[idx] slot instead of always idx 0. */
  gridIdx?: number;
}

export const getGridMeterVal = (
  row: any,
  idx: number,
  rowIndex: number,
  allRows: any[]
): number | null => {
  if (!row) return null;
  const gmr = row.grid_meter_readings as Record<string, number> | null | undefined;
  const direct = gmr?.[String(idx)] ?? (idx === 0 ? row.meter_reading_kwh : null);
  if (direct != null && !isNaN(Number(direct))) return Number(direct);

  // Fallback interpolation for estimated rows where this meter is unpopulated
  if (row.is_estimated && allRows?.length) {
    const rowTime = new Date(row.reading_datetime).getTime();
    if (!isNaN(rowTime)) {
      // allRows is sorted descending by reading_datetime.
      // Search forward (j > rowIndex) for the nearest earlier row with a valid reading for idx
      let earlierVal: number | null = null;
      let earlierTime: number | null = null;
      for (let j = rowIndex + 1; j < allRows.length; j++) {
        const rj = allRows[j];
        const rjGmr = rj?.grid_meter_readings as Record<string, number> | null | undefined;
        const v = rjGmr?.[String(idx)] ?? (idx === 0 ? rj?.meter_reading_kwh : null);
        if (v != null && !isNaN(Number(v))) {
          earlierVal = Number(v);
          earlierTime = new Date(rj.reading_datetime).getTime();
          break;
        }
      }

      // Search backward (j < rowIndex) for the nearest later row with a valid reading for idx
      let laterVal: number | null = null;
      let laterTime: number | null = null;
      for (let j = rowIndex - 1; j >= 0; j--) {
        const rj = allRows[j];
        const rjGmr = rj?.grid_meter_readings as Record<string, number> | null | undefined;
        const v = rjGmr?.[String(idx)] ?? (idx === 0 ? rj?.meter_reading_kwh : null);
        if (v != null && !isNaN(Number(v))) {
          laterVal = Number(v);
          laterTime = new Date(rj.reading_datetime).getTime();
          break;
        }
      }

      if (
        earlierVal != null &&
        laterVal != null &&
        earlierTime != null &&
        laterTime != null &&
        laterTime > earlierTime
      ) {
        const fraction = (rowTime - earlierTime) / (laterTime - earlierTime);
        return Math.round((earlierVal + (laterVal - earlierVal) * fraction) * 10) / 10;
      }
    }
  }
  return null;
};

export interface ReadingHistoryProps {
  entityName: string;
  module: HistoryModule;
  entityId: string;
  plantId?: string;
  /** Current meter serial on the well/locator asset (well.meter_serial / locator.meter_serial).
   *  Passed through to ReplaceMeterDialog as "old serial" when a Repl. checkbox is checked.
   *  Only meaningful for module 'well' | 'locator'. */
  assetMeterSerial?: string | null;
  /** CT multiplier for meter-0 (fallback when gridMultipliers is absent). Defaults to 1. */
  multiplier?: number;
  /** Number of grid meters configured for this plant. Defaults to 1. */
  gridMeterCount?: number;
  /** Display labels for each grid meter (index-aligned). Falls back to "Grid Meter N". */
  gridMeterNames?: string[];
  /** Per-meter CT multipliers (index-aligned). Falls back to `multiplier` prop. */
  gridMultipliers?: number[];
  /** When set, scopes the power history to a single meter (solar or grid-N). */
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number };
  /** From locator.default_input_mode / well.default_input_mode.
   *  'direct' -> the entered value already IS the period's volume (no prior
   *  reading to diff against), so no Δ column is computed or shown — only
   *  meaningful for module 'locator' | 'well'. Defaults to 'raw' (the
   *  existing cumulative-meter behavior) so every other caller is unaffected. */
  defaultInputMode?: 'raw' | 'direct';
  /** From plant.default_solar_input_mode (Plants → Energy Sources → Solar
   *  reading input mode). 'direct' -> the value entered for solar already IS
   *  that period's kWh (e.g. read off an inverter's daily-yield display), not
   *  a cumulative odometer-style reading — so it must never be diffed against
   *  the previous day's value. Only meaningful for module 'power'. Defaults to
   *  'raw' (existing cumulative-meter behavior) so grid-only callers and
   *  plants without solar are unaffected. */
  solarInputMode?: 'raw' | 'direct';
  onClose: () => void;
}
