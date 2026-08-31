/**
 * downtimeRowMerger.ts
 *
 * Groups contiguous offline/empty reading rows into unified Downtime Spans
 * to prevent repetitive walls of empty dashes in train and plant operator logs,
 * while preserving full auditability and individual row editability when expanded.
 */
import { format } from 'date-fns';

export interface OfflineSpan {
  id: string;
  kind: 'offline-span';
  startAt: string;
  endAt: string;
  durationMs: number;
  rows: any[];
  operators: {
    id: string;
    name: string;
    initials: string;
  }[];
  reasons: string[];
  combinedReasonText: string;
}

export type LogDisplayItem<T = any> =
  | { kind: 'reading'; row: T }
  | { kind: 'offline-span'; span: OfflineSpan }
  | { kind: 'banner'; segment: any }
  | { kind: 'gap'; gap: any; existingReason: any };

/**
 * Determines whether a given reading row represents an offline/empty check-in.
 * A row is considered offline/empty if:
 * 1. `incomplete_reason` starts with 'offline' or contains offline keywords, OR
 * 2. For Pre-Treatment rows: HPP, AFM/MMF backwash/pressures, Boosters, and Filter Housings
 *    are all unrecorded/empty.
 * 3. For RO rows: All active production flows (feed_flow, permeate_flow, reject_flow) are null/0
 *    AND major operational sensors (pressures, TDS) are null/unrecorded.
 */
export function isOfflineReadingRow(row: any): boolean {
  if (!row) return false;

  const reason = (row.incomplete_reason ?? '').trim().toLowerCase();
  if (reason.startsWith('offline')) return true;

  // Check whether this is a Pre-treatment row (has pretreatment-specific properties)
  const isPretreatRow =
    'hpp_target_pressure_psi' in row ||
    'afm_units' in row ||
    'booster_pumps' in row ||
    'filter_housings' in row ||
    'cartridge_filter_housings' in row ||
    'bag_filters_changed' in row ||
    'mmf_readings' in row;

  if (isPretreatRow) {
    const hasHpp = row.hpp_target_pressure_psi != null && row.hpp_target_pressure_psi !== '';
    const hasBagFilters = row.bag_filters_changed != null && row.bag_filters_changed !== '';

    let hasAfmData = false;
    if (Array.isArray(row.afm_units)) {
      hasAfmData = row.afm_units.some((u: any) =>
        (u?.pressureIn != null && u?.pressureIn !== '') ||
        (u?.pressureOut != null && u?.pressureOut !== '') ||
        (u?.in_psi != null && u?.in_psi !== '') ||
        (u?.out_psi != null && u?.out_psi !== '') ||
        (u?.dp_psi != null && u?.dp_psi !== '') ||
        u?.bw === true ||
        u?.backwash_on === true ||
        (u?.meterStart != null && u?.meterStart !== '') ||
        (u?.meterEnd != null && u?.meterEnd !== '')
      );
    }

    let hasBoosterData = false;
    if (row.booster_pumps && typeof row.booster_pumps === 'object') {
      const boosterValues = Array.isArray(row.booster_pumps) ? row.booster_pumps : Object.values(row.booster_pumps);
      hasBoosterData = boosterValues.some((b: any) =>
        (b?.hz != null && b?.hz !== '' && b?.hz !== 0) ||
        (b?.amp != null && b?.amp !== '' && b?.amp !== 0) ||
        (b?.target != null && b?.target !== '' && b?.target !== 0) ||
        (b?.amperage != null && b?.amperage !== '' && b?.amperage !== 0) ||
        (b?.target_hz != null && b?.target_hz !== '' && b?.target_hz !== 0) ||
        (b?.target_pressure_psi != null && b?.target_pressure_psi !== '' && b?.target_pressure_psi !== 0)
      );
    }

    let hasHousingData = false;
    const housings = row.cartridge_filter_housings || row.filter_housings;
    if (housings && typeof housings === 'object') {
      const housingValues = Array.isArray(housings) ? housings : Object.values(housings);
      hasHousingData = housingValues.some((h: any) =>
        (h?.inP != null && h?.inP !== '') ||
        (h?.outP != null && h?.outP !== '') ||
        (h?.in_psi != null && h?.in_psi !== '') ||
        (h?.out_psi != null && h?.out_psi !== '') ||
        (h?.deltaP != null && h?.deltaP !== '') ||
        (h?.dp_psi != null && h?.dp_psi !== '')
      );
    }

    let hasMmfData = false;
    if (Array.isArray(row.mmf_readings) && row.mmf_readings.length > 0) {
      hasMmfData = row.mmf_readings.some((m: any) =>
        m?.meter_start != null || m?.meter_end != null || m?.delta != null
      );
    }

    if (hasHpp || hasBagFilters || hasAfmData || hasBoosterData || hasHousingData || hasMmfData) {
      return false;
    }

    return true;
  }

  // RO train readings:
  // Check if all production flows are missing/zero
  const hasNoFlow =
    (row.feed_flow == null || row.feed_flow === 0) &&
    (row.permeate_flow == null || row.permeate_flow === 0) &&
    (row.reject_flow == null || row.reject_flow === 0);

  // Check if primary sensor telemetry is unrecorded
  const hasNoSensors =
    row.feed_pressure_psi == null &&
    row.reject_pressure_psi == null &&
    row.feed_tds == null &&
    row.permeate_tds == null;

  // If there is zero flow, zero sensors, and no meter replacement flag, it's an empty check-in
  if (hasNoFlow && hasNoSensors && !row.is_meter_replacement) {
    return true;
  }

  return false;
}

/** Formats duration between two ISO dates or milliseconds */
export function formatSpanDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Groups an already-merged list of log items (readings, banners, gaps)
 * by collapsing contiguous sequences of 2 or more offline readings into unified OfflineSpans.
 */
export function groupLogItemsWithOfflineSpans<T extends { id?: string; reading_datetime?: string; recorded_by?: string; _operatorName?: string; incomplete_reason?: string | null }>(
  items: ({ kind: 'reading'; row: T } | { kind: 'banner'; segment: any } | { kind: 'gap'; gap: any; existingReason: any })[],
  minConsecutiveToMerge = 2,
): LogDisplayItem<T>[] {
  if (!items || items.length === 0) return [];

  const result: LogDisplayItem<T>[] = [];
  let currentOfflineBatch: T[] = [];

  const flushBatch = () => {
    if (currentOfflineBatch.length === 0) return;

    if (currentOfflineBatch.length < minConsecutiveToMerge) {
      // Not enough consecutive rows to justify merging — output as individual reading rows
      for (const row of currentOfflineBatch) {
        result.push({ kind: 'reading', row });
      }
    } else {
      // Build a unified OfflineSpan
      const timestamps = currentOfflineBatch
        .map((r) => (r.reading_datetime ? new Date(r.reading_datetime).getTime() : 0))
        .filter((t) => t > 0);

      const minTime = Math.min(...timestamps);
      const maxTime = Math.max(...timestamps);

      const startAt = new Date(minTime).toISOString();
      const endAt = new Date(maxTime).toISOString();
      const durationMs = Math.max(0, maxTime - minTime);

      // Extract distinct operators
      const opMap = new Map<string, { id: string; name: string; initials: string }>();
      for (const r of currentOfflineBatch) {
        const opId = r.recorded_by ?? 'unknown';
        const opName = r._operatorName ?? 'Unknown';
        const initials =
          opName !== 'Unknown'
            ? opName
                .split(' ')
                .map((n: string) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()
            : '?';
        if (!opMap.has(opId)) {
          opMap.set(opId, { id: opId, name: opName, initials });
        }
      }

      // Extract distinct reasons in chronological order
      const sortedByTime = [...currentOfflineBatch].sort((a, b) =>
        (a.reading_datetime ?? '').localeCompare(b.reading_datetime ?? ''),
      );

      const distinctReasons: string[] = [];
      for (const r of sortedByTime) {
        const raw = (r.incomplete_reason ?? '').trim();
        const cleaned = raw.replace(/^offline[:\s-]*/i, '').trim();
        const displayReason = cleaned || (raw ? raw : 'Shutdown / No flow');
        if (displayReason && !distinctReasons.includes(displayReason)) {
          distinctReasons.push(displayReason);
        }
      }

      const combinedReasonText =
        distinctReasons.length > 0 ? distinctReasons.join(' → ') : 'Offline';

      const firstId = currentOfflineBatch[0]?.id ?? 'start';
      const lastId = currentOfflineBatch[currentOfflineBatch.length - 1]?.id ?? 'end';

      const span: OfflineSpan = {
        id: `span-${firstId}-${lastId}`,
        kind: 'offline-span',
        startAt,
        endAt,
        durationMs,
        rows: currentOfflineBatch,
        operators: Array.from(opMap.values()),
        reasons: distinctReasons,
        combinedReasonText,
      };

      result.push({ kind: 'offline-span', span });
    }

    currentOfflineBatch = [];
  };

  for (const item of items) {
    if (item.kind === 'reading' && isOfflineReadingRow(item.row)) {
      currentOfflineBatch.push(item.row);
    } else {
      flushBatch();
      result.push(item as LogDisplayItem<T>);
    }
  }

  flushBatch();
  return result;
}

