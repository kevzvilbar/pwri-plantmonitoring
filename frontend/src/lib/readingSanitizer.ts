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
 *    always supersedes an estimate on that calendar day.
 * 3. Prunes non-monotonic estimates on CUMULATIVE meters only (e.g. current_reading <= predecessor),
 *    which would produce negative deltas.
 *    IMPORTANT: Direct-mode / derived meters (e.g. HAMAS) measure daily volume directly, which
 *    naturally fluctuates up and down from day to day. They are never subject to cumulative
 *    monotonicity checks.
 */
export function sanitizeReadingsForEntity<T extends SanitizableReading>(
  readings: T[],
  isDirectMode = false,
): T[] {
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

      // Rule B: Monotonicity check against predecessor ONLY applies to cumulative meters.
      // Direct-mode / derived meters (like HAMAS) measure daily volume directly, which naturally
      // fluctuates up and down (e.g. 5200 -> 4800 is normal daily variation, not a backward meter).
      if (!isDirectMode) {
        const curVal = r.current_reading != null ? +r.current_reading
          : r.meter_reading_kwh != null ? +r.meter_reading_kwh
          : r.raw_meter_reading != null ? +r.raw_meter_reading
          : null;

        if (curVal != null && lastVal != null && !r.is_meter_replacement && !r.is_meter_rollover) {
          if (curVal <= lastVal) {
            // Backward estimate on a cumulative meter: drop corrupt estimate
            continue;
          }
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
 *
 * @param readings Raw reading rows
 * @param entityKeyField Column identifying the meter/locator (e.g. 'locator_id', 'well_id', 'meter_id')
 * @param directModeIds Set of entity IDs that operate in direct-volume / derived mode (e.g. HAMAS)
 */
export function sanitizeReadings<T extends SanitizableReading>(
  readings: T[],
  entityKeyField: string,
  directModeIds?: Set<string>,
): T[] {
  if (!readings || readings.length === 0) return [];

  const groups = new Map<string, T[]>();
  for (const r of readings) {
    const k = r[entityKeyField] ?? r.plant_id ?? '__';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const result: T[] = [];
  for (const [entityId, group] of groups.entries()) {
    const isDirect = directModeIds ? directModeIds.has(entityId) : false;
    result.push(...sanitizeReadingsForEntity(group, isDirect));
  }

  return result.sort(
    (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
  );
}
