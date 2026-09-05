import { format } from 'date-fns';

/**
 * Common shape for reading rows processed by pivot tables and delta walks.
 */
export interface SanitizableReading {
  reading_datetime: string;
  current_reading?: number | string | null;
  meter_reading_kwh?: number | string | null;
  raw_meter_reading?: number | string | null;
  is_estimated?: boolean | null;
  is_meter_replacement?: boolean | null;
  is_meter_rollover?: boolean | null;
  norm_status?: string | null;
  [key: string]: any;
}

/**
 * Sanitizes a chronological sequence of readings for a SINGLE entity:
 * 1. Prunes retracted rows (`norm_status === 'retracted'`).
 * 2. Prunes any auto-backfill estimate (`is_estimated = true`) on any calendar day
 *    where at least one confirmed human reading (`!is_estimated`) exists. A human reading
 *    always supersedes an estimate.
 * 3. Prunes any auto-backfill estimate that violates monotonicity against its predecessor
 *    (e.g. current_reading <= predecessor), which would produce non-positive or negative deltas.
 */
export function sanitizeReadingsForEntity<T extends SanitizableReading>(readings: T[]): T[] {
  if (!readings || readings.length === 0) return [];

  const nonRetracted = readings.filter((r) => r.norm_status !== 'retracted');
  if (nonRetracted.length === 0) return [];

  // Sort ascending by timestamp
  const sorted = [...nonRetracted].sort(
    (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
  );

  // 1. Identify calendar dates with at least one human reading
  const humanDates = new Set<string>();
  for (const r of sorted) {
    if (!r.is_estimated) {
      humanDates.add(format(new Date(r.reading_datetime), 'yyyy-MM-dd'));
    }
  }

  // 2. Walk and filter out orphan/invalid estimates
  const sanitized: T[] = [];
  let lastVal: number | null = null;

  for (const r of sorted) {
    const isEst = !!r.is_estimated;
    const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');

    if (isEst) {
      // Rule A: If a human reading exists on this date, drop the orphan estimate
      if (humanDates.has(dateKey)) {
        continue;
      }

      // Rule B: Monotonicity check against predecessor
      const curVal = r.current_reading != null ? +r.current_reading
        : r.meter_reading_kwh != null ? +r.meter_reading_kwh
        : r.raw_meter_reading != null ? +r.raw_meter_reading
        : null;

      if (curVal != null && lastVal != null && !r.is_meter_replacement && !r.is_meter_rollover) {
        if (curVal <= lastVal) {
          // Backward estimate: drop corrupt estimate
          continue;
        }
      }
    }

    sanitized.push(r);

    const v = r.current_reading != null ? +r.current_reading
      : r.meter_reading_kwh != null ? +r.meter_reading_kwh
      : r.raw_meter_reading != null ? +r.raw_meter_reading
      : null;

    if (v != null && !r.is_meter_replacement) {
      lastVal = v;
    }
  }

  return sanitized;
}

/**
 * Sanitizes a multi-entity readings collection by grouping per entityKeyField,
 * sanitizing each entity group, and returning the combined sorted list.
 */
export function sanitizeReadings<T extends SanitizableReading>(
  readings: T[],
  entityKeyField: string,
): T[] {
  if (!readings || readings.length === 0) return [];

  const groups = new Map<string, T[]>();
  for (const r of readings) {
    const k = r[entityKeyField] ?? r.plant_id ?? '__';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const result: T[] = [];
  for (const group of groups.values()) {
    result.push(...sanitizeReadingsForEntity(group));
  }

  return result.sort(
    (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
  );
}

