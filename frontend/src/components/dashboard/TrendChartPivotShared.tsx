// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md).
// Shared by TrendChartTables.tsx (PivotTable/OverviewTable) and
// TrendChartDataSummaryPopup.tsx (DataSummaryPopup). TrendChart.tsx itself
// only uses buildEntityPivot/fillDateRange/fmtDateKey directly — see that
// file for where those three are still called from the main chart.
//
// resolveReadingDelta is not currently called anywhere (verified via repo
// search before this extraction) — kept as-is rather than removed, since
// this pass is a pure structural move with no behavior change. Worth a
// follow-up cleanup pass once test coverage exists to confirm it's safe to
// delete (see pwri-improvement-plan.md Phase 2).

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

/** Resolve a single reading row → delta volume (m³), clamped to 0. */
export function resolveReadingDelta(r: any): number {
  // Priority 1: daily_volume is the operator-entered / backend-cached delta.
  // It is ground truth. Treat 0 as a genuine zero reading (not "missing").
  // This avoids using a stale previous_reading stored in the DB.
  if (r.daily_volume != null) return Math.max(0, +r.daily_volume);
  // Priority 2: compute from cumulative meter readings.
  // NOTE: prefer the in-memory lastSeen map from buildEntityPivot (sequential)
  // over the DB-stored previous_reading when possible — see buildEntityPivot.
  if (r.current_reading != null && r.previous_reading != null)
    return Math.max(0, +r.current_reading - +r.previous_reading);
  return 0;
}

/**
 * Build a pivot:  dateKey (yyyy-MM-dd) → entityId → summed volume.
 * Readings must already be sorted by reading_datetime asc.
 * Returns the pivot map and the sorted set of unique date keys found.
 */
export function buildEntityPivot(
  readings: any[],
  entityField: string,
  // IDs (e.g. locator_id) whose default_input_mode = 'direct' — current_reading
  // already IS the period's volume for these, so daily_volume/diff math must be
  // skipped. Mirrors EntityHistoryChart.tsx's isDirectMode branch. Safe to pass
  // the same locator-ID set to well/meter pivots too — no ID collision risk.
  directModeIds?: Set<string>,
): { pivot: Map<string, Map<string, number>>; dateKeys: string[] } {
  const pivot = new Map<string, Map<string, number>>();
  // Sequential lastSeen: tracks the actual last current_reading per entity so
  // we never rely on a potentially stale previous_reading stored in the DB.
  // Readings must be sorted asc by reading_datetime for this to be correct.
  const lastSeen = new Map<string, number>();

  readings.forEach((r) => {
    if (r.is_meter_replacement) {
      // Reset sequential tracking on meter replacement so the new meter's
      // first reading doesn't produce a huge delta vs the old meter.
      const entityId = r[entityField] ?? '__';
      lastSeen.delete(entityId);
      return;
    }

    const dateKey  = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    const entityId = r[entityField] ?? '__';

    let vol: number;
    if (directModeIds?.has(entityId)) {
      // Direct mode: current_reading already IS the period's volume — no
      // diff, no dependence on daily_volume/previous_reading.
      vol = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (lastSeen.has(entityId) && r.current_reading != null) {
      // SELF-HEAL (checked before daily_volume — mirrors the identical fix in
      // TrendChart.tsx's computeEntityDeltas and DataSummaryModal.tsx's
      // computePivotFromReadings(NoCache), all patched together for the
      // Coke/Parkmall Aug 7–10 incident): once a predecessor for this entity
      // has already been walked sequentially within this window, always diff
      // live against it rather than trusting a stored daily_volume/
      // previous_reading. Those DB columns are written once at insert time
      // and nothing cascades an update to them when an earlier reading is
      // later edited/deleted/replaced — a downstream row can be left
      // pointing at a now-stale predecessor indefinitely, which is what
      // produced the Coke/Parkmall bug (a single day's delta growing into a
      // cumulative-looking total). This function wasn't touched by that fix
      // since it moved to its own file in the TrendChart extraction shortly
      // before — same bug, same fix, applied here too.
      vol = Math.max(0, +r.current_reading - lastSeen.get(entityId)!);
      lastSeen.set(entityId, +r.current_reading);
    } else if (r.daily_volume != null) {
      // Ground-truth operator/cached delta — no walked predecessor yet
      // (first row for this entity in the window), so this is the correct
      // source: it may legitimately span >1 day if readings were skipped
      // before the window.
      vol = Math.max(0, +r.daily_volume);
      // Keep lastSeen in sync so a subsequent null-daily_volume row can delta
      // correctly against this reading.
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (r.current_reading != null) {
      const prev = r.previous_reading != null ? +r.previous_reading : null; // DB fallback (may be stale) — no lastSeen yet, handled above
      vol = prev != null ? Math.max(0, +r.current_reading - prev) : 0;
      lastSeen.set(entityId, +r.current_reading);
    } else {
      vol = 0;
    }

    if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
    pivot.get(dateKey)!.set(entityId, (pivot.get(dateKey)!.get(entityId) ?? 0) + vol);
  });

  const dateKeys = Array.from(pivot.keys()).sort();
  return { pivot, dateKeys };
}

/** Fill every calendar day between startIso and endIso (yyyy-MM-dd strings). */
export function fillDateRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso   + 'T00:00:00');
  while (cur <= end) {
    dates.push(format(cur, 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Format a yyyy-MM-dd key for display as "MMM d" */
export function fmtDateKey(key: string): string {
  return format(new Date(key + 'T00:00:00'), 'MMM d');
}

export type DSMTab = 'overview' | 'production' | 'consumption';

// ─── CSS class helpers (avoids repetition) ──────────────────────────────────
// z-index scheme for the single shared scroll container (see PivotTable/
// OverviewTable in TrendChartTables.tsx — header and body now live in one
// <table> inside one overflow-auto div, header pinned via sticky top-0,
// rather than two separately-scrolling divs that could drift out of sync):
//   z-10 — body's sticky left/right columns (Date, Total), above plain cells
//   z-20 — header's plain sticky-top cells, above the body columns scrolling under them
//   z-30 — header's corner cells (sticky on top *and* left/right at once),
//          above the plain header cells scrolling under them
export const TH = 'px-2 py-2 text-center text-2xs font-semibold text-muted-foreground border-b border-border align-bottom sticky top-0 z-20 bg-muted/95';
export const TH_DATE = 'px-3 py-2 text-left text-2xs font-semibold text-muted-foreground whitespace-nowrap border-b border-border sticky left-0 top-0 z-30 bg-muted/95 w-[72px] min-w-[72px]';
export const TH_TOTAL = 'px-2 py-2 text-center text-2xs font-bold border-b border-l border-border sticky right-0 top-0 z-30 bg-primary-soft/95 text-primary align-bottom w-[80px] min-w-[80px]';
export const TD = 'px-2 py-1.5 text-center font-mono-num tabular-nums text-xs';
export const TD_TOTAL_ROW = 'px-2 py-1.5 text-center font-semibold font-mono-num tabular-nums text-xs text-primary';
export const TD_TOTAL_COL = 'px-2 py-1.5 text-center font-semibold font-mono-num tabular-nums text-xs text-primary sticky right-0 z-10 border-l border-border w-[80px] min-w-[80px]';

export function fmtV(v: number | null | undefined, dec = 1) {
  if (v == null || v === 0) return <span className="text-muted-foreground/40">—</span>;
  return v.toLocaleString(undefined, { maximumFractionDigits: dec });
}

const GAP_ENTITY_TYPE_LABEL: Record<'well' | 'locator' | 'ro_train', 'Well' | 'Locator' | 'RO Train'> = {
  well: 'Well', locator: 'Locator', ro_train: 'RO Train',
};
// Underlying table for each entity type — used to resolve plant_id when
// retroactively logging a gap reason from the Data Summary pivot (see
// PivotTable in TrendChartTables.tsx). reading_gap_reasons.plant_id is
// NOT NULL, but locator_readings/well_readings rows don't reliably carry it
// (see useTrendChartQueries.ts's "locator_readings has no plant_id column"
// note), so we look it up directly from the entity's own row instead of
// threading a plant map through every layer between here and TrendChart.tsx.
export const GAP_ENTITY_TABLE: Record<'well' | 'locator' | 'ro_train', string> = {
  well: 'wells', locator: 'locators', ro_train: 'ro_trains',
};
const GAP_DOWN_STATUSES = new Set(['Inactive', 'Offline', 'Maintenance']);

export type GapReasonHit = { category: string; detail: string | null; source: 'gap' | 'status' };

/**
 * Looks up "why is this cell blank" for the Data Summary pivot — checks an
 * explicit per-day reading_gap_reasons entry first, then falls back to
 * whether the entity was Offline/Inactive/Maintenance (per
 * entity_status_audit_log) on that date.
 */
export function useGapReasonLookup(
  entityType: 'well' | 'locator' | 'ro_train' | undefined,
  entities: { id: string; label: string }[],
  _dates: string[],
): {
  getReason: (entityId: string, dateKey: string) => GapReasonHit | null;
  /** Call after writing a new reading_gap_reasons row (see PivotTable's
   *  retroactive logging dialog) so the new icon appears immediately instead
   *  of waiting for this query's next natural refetch. */
  refetchReasons: () => void;
} {
  const queryClient = useQueryClient();
  const entityIds = useMemo(() => entities.map((e) => e.id).sort(), [entities]);
  const entityIdsKey = entityIds.join(',');
  const gapReasonsQueryKey = ['pivot-gap-reasons', entityType, entityIdsKey];

  const { data: gapReasons } = useQuery({
    queryKey: gapReasonsQueryKey,
    enabled: !!entityType && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('entity_type', entityType)
        .in('entity_id', entityIds);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const { data: statusLog } = useQuery({
    queryKey: ['pivot-status-log', entityType, entityIdsKey],
    enabled: !!entityType && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_status_audit_log' as any)
        .select('*')
        .eq('entity_type', GAP_ENTITY_TYPE_LABEL[entityType!])
        .in('entity_id', entityIds)
        .order('timestamp', { ascending: true });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const getReason = useMemo(() => {
    const gapMap = new Map<string, any>();
    (gapReasons ?? []).forEach((g: any) => { gapMap.set(`${g.entity_id}|${g.gap_date}`, g); });

    // Reconstruct Offline/Inactive/Maintenance intervals per entity from the
    // transition log: each "down" transition opens an interval that runs
    // until that entity's next transition (or now, if still ongoing).
    const intervalsByEntity = new Map<string, Array<{ start: number; end: number; category: string | null; detail: string | null }>>();
    const rowsByEntity = new Map<string, any[]>();
    (statusLog ?? []).forEach((row: any) => {
      if (!rowsByEntity.has(row.entity_id)) rowsByEntity.set(row.entity_id, []);
      rowsByEntity.get(row.entity_id)!.push(row);
    });
    rowsByEntity.forEach((rows, entityId) => {
      const intervals: Array<{ start: number; end: number; category: string | null; detail: string | null }> = [];
      rows.forEach((row, i) => {
        if (!GAP_DOWN_STATUSES.has(row.to_status)) return;
        const start = new Date(row.timestamp).getTime();
        const next = rows[i + 1];
        const end = next ? new Date(next.timestamp).getTime() : Date.now();
        intervals.push({ start, end, category: row.reason_category ?? null, detail: row.reason_detail ?? null });
      });
      intervalsByEntity.set(entityId, intervals);
    });

    return (entityId: string, dateKey: string): GapReasonHit | null => {
      const gap = gapMap.get(`${entityId}|${dateKey}`);
      if (gap) return { category: gap.reason_category, detail: gap.reason_detail ?? null, source: 'gap' };

      const intervals = intervalsByEntity.get(entityId);
      if (intervals && intervals.length) {
        const dayStart = new Date(dateKey + 'T00:00:00').getTime();
        const dayEnd = new Date(dateKey + 'T23:59:59').getTime();
        const hit = intervals.find((iv) => iv.start <= dayEnd && iv.end >= dayStart);
        if (hit && hit.category) return { category: hit.category, detail: hit.detail, source: 'status' };
      }
      return null;
    };
  }, [gapReasons, statusLog]);

  const refetchReasons = () => {
    queryClient.invalidateQueries({ queryKey: gapReasonsQueryKey });
  };

  return { getReason, refetchReasons };
}
