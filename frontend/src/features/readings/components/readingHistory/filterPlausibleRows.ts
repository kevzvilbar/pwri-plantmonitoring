/* eslint-disable @typescript-eslint/no-explicit-any */

function getVal(row: any): number | null {
  if (!row) return null;
  if (row.current_reading != null) return +row.current_reading;
  if (row.meter_reading_kwh != null) return +row.meter_reading_kwh;
  if (row.raw_meter_reading != null) return +row.raw_meter_reading;
  return null;
}

/**
 * Drops estimated (backfilled) readings that don't plausibly fit between
 * their chronological neighbors — e.g. an auto-generated estimate that's
 * lower than the reading before it and higher than the reading after it,
 * which can happen if a rollover/replacement was recorded slightly out of
 * order. `rawRows` must be sorted descending by `reading_datetime`
 * (newest first), matching `useReadingHistoryQuery`'s `.order(...,
 * { ascending: false })`.
 *
 * This assumes a cumulative meter: a real reading trends upward over time
 * (barring a rollover/replacement), so an estimate that breaks that trend
 * is implausible. That assumption does not hold for `isDirectMode`
 * entities (see InfoBanners) — each reading there is already a period
 * volume, which legitimately fluctuates up and down day to day. Passing
 * `isDirectMode: true` disables the check entirely rather than risk
 * silently discarding real, valid data: a locator/well configured for
 * direct-volume input was losing most of its estimated readings this way,
 * because a normal day-to-day dip or rise in volume looked exactly like
 * an implausible cumulative-meter reading to this filter.
 */
export function filterPlausibleRows(rawRows: any[] | null | undefined, isDirectMode: boolean): any[] {
  if (!rawRows || rawRows.length === 0) return [];
  if (isDirectMode) return rawRows;

  const valid: any[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (r.is_estimated && !r.is_meter_rollover && !r.is_meter_replacement) {
      const cur = getVal(r);
      if (cur != null) {
        const pred = rawRows[i + 1]; // older neighbor
        const succ = rawRows[i - 1]; // newer neighbor

        const predVal = getVal(pred);
        const succVal = getVal(succ);

        const violatesPred = predVal != null && !pred?.is_meter_rollover && !r.is_meter_replacement && cur <= predVal;
        const violatesSucc = succVal != null && !r.is_meter_rollover && !succ?.is_meter_replacement && cur >= succVal;

        if (violatesPred || violatesSucc) {
          continue;
        }
      }
    }
    valid.push(r);
  }
  return valid;
}
