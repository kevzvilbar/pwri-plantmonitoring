/**
 * DataSummaryModal.tsx
 *
 * Full-screen pivot-table modal — rows = dates, columns = individual
 * locators (consumption) or product/RO meters (production).
 * Extracted from Dashboard.tsx (§4 item 2 decomposition).
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import {
  Droplet, Activity, Receipt, Gauge, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import { deltaCache, hydrateFromStoredDeltas } from '@/lib/deltaCache';
import { sanitizeReadings } from '@/lib/readingSanitizer';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { DataSummaryFilters } from './DataSummaryFilters';
import { DataSummaryTable } from './DataSummaryTable';
import { DataSummaryStats } from './DataSummaryStats';

// ─── DataSummaryModal ─────────────────────────────────────────────────────────
// Full-screen pivot-table popup. Rows = dates, columns = individual
// locators (consumption) or product meters (production). Non-retractable —
// closes only via the ✕ button or clicking outside the dialog.

export type SummaryTab = 'both' | 'production' | 'consumption' | 'current';

/**
 * Replacement-aware delta pivot — mirrors TrendChart.tsx `computeEntityDeltas`.
 *
 * ── HYBRID STRATEGY (Tier 1 → Tier 2 → Tier 3) ──────────────────────────────
 * Tier 1: Per (entity, date) pair the function first checks `deltaCache`.
 *         If a fresh entry exists it is used directly — no row-walking needed.
 * Tier 2: Cache miss → walk raw readings and derive the delta mathematically.
 *         The result is written back to `deltaCache` for the current session.
 * Tier 3: Raw fallback — `hydrateFromStoredDeltas` is called by the query's
 *         `onSuccess` handler to pre-seed the cache from DB stored values
 *         (daily_volume, permeate_meter_delta) before this function runs.
 *         If the stored value is stale (was invalidated by a mutation), the
 *         cache entry is absent and Tier 2 takes over automatically.
 *
 * Groups readings by entityKeyField, walks them chronologically per entity:
 *   • is_meter_replacement row     → delta 0, set afterRepl flag
 *   • first row after replacement  → delta 0, clear flag
 *   • normal row w/ dailyVolumeField → use that value (clamped ≥ 0)
 *   • normal row w/o dailyVolumeField → current − last (clamped ≥ 0)
 *   • no predecessor yet (first in range) → current − previous_reading (DB field)
 *
 * Returns Map<dateKey yyyy-MM-dd, Map<entityKey, summed volume>>.
 * After building the full pivot, populates deltaCache for the session.
 */
/**
 * Identical to computePivotFromReadings but NEVER reads from or writes to
 * deltaCache. Used by the Dashboard stat-card useMemos (consumption,
 * production, rawWaterVol, etc.) so their transient single-day computations
 * cannot poison the shared cache that DataSummaryModal relies on for its
 * multi-day pivot.
 *
 * Without this isolation the stat card would write a delta derived from an
 * open-ended "today" query (or a partial date window) into deltaCache, and
 * when the modal later computed the same (entityKey, dateKey) pair it would
 * hit that stale/wrong cached value instead of recomputing from its own
 * correctly-bounded raw data — producing the discrepancy visible in the
 * "Prod. vs Consum." vs "Consumption" tabs.
 */
export function computePivotFromReadingsNoCache(
  readings: any[],
  entityKeyField: string,
  dailyVolumeField: string | null,
  // IDs (e.g. locator_id) whose default_input_mode = 'direct' — current_reading
  // already IS the period's volume for these, so daily_volume/diff math must be
  // skipped entirely. Mirrors EntityHistoryChart.tsx's isDirectMode branch.
  // Safe to pass the same locator-ID set to well/meter pivots too: those IDs
  // never collide with locator IDs, so it's a no-op for other entity types.
  directModeIds?: Set<string>,
): Map<string, Map<string, number>> {
  const byEntity = new Map<string, any[]>();
  const cleanReadings = sanitizeReadings(readings, entityKeyField, directModeIds);
  cleanReadings.forEach((r) => {
    const k = r[entityKeyField] ?? '__';
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(r);
  });
  const pivot = new Map<string, Map<string, number>>();
  byEntity.forEach((rows, entityKey) => {
    const isDirect = directModeIds?.has(entityKey) ?? false;
    const sorted = rows; // already sorted and sanitized by sanitizeReadings
    const lastReading = new Map<string, number>();
    const afterRepl   = new Set<string>();
    sorted.forEach((r) => {
      const isMR    = !!r.is_meter_replacement;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      if (isMR) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.add(entityKey);
        return;
      }
      if (afterRepl.has(entityKey)) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.delete(entityKey);
        return;
      }
      let delta = 0;
      if (isDirect) {
        // Direct mode: current_reading already IS the period's volume — no
        // diff, no dependence on the DB's daily_volume/previous_reading.
        delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
        lastReading.set(entityKey, +r.current_reading);
      } else if (lastReading.has(entityKey)) {
        // SELF-HEAL (checked before dailyVolumeField): once a predecessor for
        // this entity has already been walked within the fetched window,
        // always diff live against it instead of trusting the row's stored
        // daily_volume/previous_reading. Those DB columns are written once at
        // insert time and nothing cascades an update to them when an earlier
        // reading is later edited/deleted/replaced — a downstream row can be
        // left pointing at a now-stale predecessor indefinitely. That's what
        // produced the Coke/Parkmall Aug 7–10 "wrong calculation": those
        // rows' stored previous_reading was frozen at the Aug 5 reading, so
        // daily_volume (current − frozen Aug 5 value) grew into a cumulative
        // total each day instead of a single day's delta. The History
        // dialogs (ReadingHistoryDialog.tsx / ProductSection.tsx) already
        // recompute live from the adjacent row for the exact same reason —
        // this mirrors that fix here so the Data Summary modal self-heals too.
        delta = +r.current_reading - lastReading.get(entityKey)!;
        lastReading.set(entityKey, +r.current_reading);
      } else if (dailyVolumeField && r[dailyVolumeField] != null) {
        // First row for this entity within the fetched window — no walked
        // predecessor to diff against locally, so fall back to the stored
        // daily_volume (may legitimately span >1 day if readings were
        // skipped before the window). Preserve negative if meter dropped.
        delta = +r[dailyVolumeField];
        lastReading.set(entityKey, +r.current_reading);
      } else {
        if (r.previous_reading != null && r.current_reading != null)
          delta = +r.current_reading - +r.previous_reading;
        lastReading.set(entityKey, +r.current_reading);
      }
      const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
      pivot.get(dateKey)!.set(entityKey, prev + delta);
    });
  });
  return pivot;
}

/**
 * Replacement-aware delta pivot — mirrors TrendChart.tsx `computeEntityDeltas`.
 *
 * ── HYBRID STRATEGY (Tier 1 → Tier 2 → Tier 3) ──────────────────────────────
 * Tier 1: Per (entity, date) pair the function first checks `deltaCache`.
 *         If a fresh entry exists it is used directly — no row-walking needed.
 * Tier 2: Cache miss → walk raw readings and derive the delta mathematically.
 *         The result is written back to `deltaCache` for the current session.
 * Tier 3: Raw fallback — `hydrateFromStoredDeltas` is called by the query's
 *         `onSuccess` handler to pre-seed the cache from DB stored values
 *         (daily_volume, permeate_meter_delta) before this function runs.
 *         If the stored value is stale (was invalidated by a mutation), the
 *         cache entry is absent and Tier 2 takes over automatically.
 *
 * Groups readings by entityKeyField, walks them chronologically per entity:
 *   • is_meter_replacement row     → delta 0, set afterRepl flag
 *   • first row after replacement  → delta 0, clear flag
 *   • normal row w/ dailyVolumeField → use that value (clamped ≥ 0)
 *   • normal row w/o dailyVolumeField → current − last (clamped ≥ 0)
 *   • no predecessor yet (first in range) → current − previous_reading (DB field)
 *
 * Returns Map<dateKey yyyy-MM-dd, Map<entityKey, summed volume>>.
 * After building the full pivot, populates deltaCache for the session.
 */
function computePivotFromReadings(
  readings: any[],
  entityKeyField: string,
  dailyVolumeField: string | null,
  // See computePivotFromReadingsNoCache above — same semantics.
  directModeIds?: Set<string>,
): Map<string, Map<string, number>> {
  const byEntity = new Map<string, any[]>();
  const cleanReadings = sanitizeReadings(readings, entityKeyField, directModeIds);
  cleanReadings.forEach((r) => {
    const k = r[entityKeyField] ?? '__';
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(r);
  });
  const pivot = new Map<string, Map<string, number>>();
  byEntity.forEach((rows, entityKey) => {
    const isDirect = directModeIds?.has(entityKey) ?? false;
    const sorted = rows; // already sorted and sanitized by sanitizeReadings
    const lastReading = new Map<string, number>();
    const afterRepl   = new Set<string>();
    sorted.forEach((r) => {
      const isMR    = !!r.is_meter_replacement;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      if (isMR) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.add(entityKey);
        return;
      }
      if (afterRepl.has(entityKey)) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.delete(entityKey);
        return;
      }

      if (isDirect) {
        // Direct mode: current_reading already IS the period's volume.
        // Bypass deltaCache entirely — a cached/stored entry may have been
        // seeded (via hydrateFromStoredDeltas) from the DB's diff-based
        // daily_volume before the DB-side fix, so trusting it here would
        // reproduce the same bug. Write the correct value back afterwards
        // so later lookups for this entity+date get the right number too.
        const delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
        lastReading.set(entityKey, +r.current_reading);
        deltaCache.set(entityKey, dateKey, delta, 'computed');
        const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
        pivot.get(dateKey)!.set(entityKey, prev + delta);
        return;
      }

      // ── HYBRID: Tier-1 cache check ─────────────────────────────────────────
      // If the delta for this entity+date is already cached (either from a
      // previous computation this session or seeded from the stored DB column
      // via hydrateFromStoredDeltas), use it directly and skip row-walking.
      const cachedDelta = deltaCache.get(entityKey, dateKey);
      if (cachedDelta !== null) {
        // Still advance the lastReading cursor so subsequent rows compute correctly.
        if (r.current_reading != null) lastReading.set(entityKey, +r.current_reading);
        const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
        pivot.get(dateKey)!.set(entityKey, prev + cachedDelta);
        return;
      }
      // ── HYBRID: Tier-2 raw computation (cache miss) ───────────────────────

      let delta = 0;
      if (lastReading.has(entityKey)) {
        // SELF-HEAL (checked before dailyVolumeField — see the identical fix
        // and full explanation in computePivotFromReadingsNoCache above): a
        // predecessor for this entity has already been walked in this
        // window, so diff live against it rather than trusting a stored
        // daily_volume that may have gone stale after an earlier
        // edit/delete/replacement was never cascaded downstream.
        delta = +r.current_reading - lastReading.get(entityKey)!;
        lastReading.set(entityKey, +r.current_reading);
      } else if (dailyVolumeField && r[dailyVolumeField] != null) {
        // daily_volume is GENERATED ALWAYS as (current_reading - previous_reading).
        // For the very first row in the fetched window (no lastReading yet), this
        // value correctly represents THAT reading's interval — which may span
        // multiple days if readings were skipped. Use it as-is (it's already the
        // correct single-interval delta stored at insert time).
        delta = +r[dailyVolumeField];
        lastReading.set(entityKey, +r.current_reading);
      } else {
        // No daily_volume and no prior row in range.
        // Use the stored previous_reading field (written by Operations.tsx at insert
        // time) instead of treating the full cumulative meter value as today's delta.
        // This prevents the "millions" spike when the date range starts mid-history.
        if (r.previous_reading != null && r.current_reading != null)
          delta = +r.current_reading - +r.previous_reading;
        lastReading.set(entityKey, +r.current_reading);
      }
      // Populate the cache for subsequent renders / pivots in this session.
      deltaCache.set(entityKey, dateKey, delta, 'computed');

      // Final accumulation guard.
      const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
      pivot.get(dateKey)!.set(entityKey, prev + delta);
    });
  });
  return pivot;
}

/** Sum all entity values in a pivot for one date key. */
export function pivotDayTotal(pivot: Map<string, Map<string, number>>, dateKey: string): number {
  let total = 0;
  pivot.get(dateKey)?.forEach((v) => { total += v; });
  return total;
}

function summaryPctDelta(today: number, yesterday: number): number | null {
  if (!yesterday) return null;
  return +((((today - yesterday) / yesterday) * 100).toFixed(1));
}

function DeltaIcon({ pct }: { pct: number | null }) {
  if (pct == null) return <Minus className="h-3 w-3 text-muted-foreground" />;
  if (pct > 0) return <ArrowUpRight className="h-3 w-3 text-accent" />;
  return <ArrowDownRight className="h-3 w-3 text-danger" />;
}

function pctLabel(pct: number | null) {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export interface DataSummaryModalProps {
  open: boolean;
  onClose: () => void;
  plantIds: string[];
  plantCodeById: Map<string, string>;
}

export function DataSummaryModal({ open, onClose, plantIds, plantCodeById }: DataSummaryModalProps) {
  const [tab, setTab] = useState<SummaryTab>('both');
  // Which side to show in the Current Readings tab: production or consumption
  const [currentSide, setCurrentSide] = useState<'consumption' | 'production'>('consumption');

  // Date range: default last 7 days
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [fromStr, setFromStr] = useState<string>(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [toStr,   setToStr]   = useState<string>(todayStr);

  const startISO = new Date(fromStr + 'T00:00:00').toISOString();
  const endISO   = new Date(toStr   + 'T23:59:59').toISOString();

  // ── Locators (meta) ────────────────────────────────────────────────────────
  const { data: locators, isLoading: locatorsLoading } = useQuery({
    queryKey: ['dsm-locators', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase
        .from('locators').select('id,name,code,plant_id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
    staleTime: 30_000,  // FIX (egress): matched to this query's own 30s refetchInterval (while modal is open) instead of 0 (always stale)
    refetchInterval: open ? 30_000 : false,
  });

  const locatorIds = useMemo(() => (locators ?? []).map((l: any) => l.id), [locators]);

  // Locators to treat as "direct volume" for pivot purposes — either the
  // manager-configured default_input_mode='direct' toggle, OR any is_derived
  // (residual/mirrored) locator such as the SRP↔Mambaling HAMAS pair: its
  // current_reading is a computed residual or a manual override, never a
  // cumulative meter value, whether the sweep (fn_sweep_derived_meters, which
  // always writes previous_reading=0) or a human wrote it. See
  // computePivotFromReadingsNoCache above and EntityHistoryChart.tsx.
  const directLocatorIds = useMemo(
    () => new Set(
      (locators ?? [])
        .filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true)
        .map((l: any) => l.id),
    ),
    [locators],
  );

  const { data: consReadings, isLoading: consLoading } = useQuery({
    queryKey: ['dsm-cons-readings', locatorIds, fromStr, toStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings_clean' as any)
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: open && locatorIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  // ── Product meters (meta) ──────────────────────────────────────────────────
  const { data: productMeters, isLoading: metersLoading } = useQuery({
    queryKey: ['dsm-product-meters', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id,name,plant_id,is_derived').in('plant_id', plantIds);
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  const meterIds = useMemo(() => (productMeters ?? []).map((m: any) => m.id), [productMeters]);

  // Product meters to treat as "direct volume" for pivot purposes — is_derived
  // mirrored meters such as Mambaling's "HAMAS" (mirrored from SRP's derived
  // "HAMAS (Mambaling)" locator, see directLocatorIds above).
  // fn_sweep_derived_meters_for_date() writes each day's already-computed
  // volume straight into current_reading and pins previous_reading at 0, so
  // every row stands alone by design — self-heal-diffing consecutive rows'
  // current_reading (the default computePivotFromReadingsNoCache behavior
  // once a predecessor has been walked) produces a bogus, often-negative
  // delta on any day the value dips versus the day before, instead of that
  // day's true volume. That's exactly what was making HAMAS's Production
  // column show ~half its days blank and the rest a fraction of its real
  // volume. See computePivotFromReadingsNoCache above and
  // ProductSection.tsx's ProductMeterHistoryDialog, which already displays
  // these meters' current_reading as-is for the same reason.
  const directMeterIds = useMemo(
    () => new Set((productMeters ?? []).filter((m: any) => m.is_derived === true).map((m: any) => m.id)),
    [productMeters],
  );

  const { data: prodReadings, isLoading: prodLoading } = useQuery({
    queryKey: ['dsm-prod-readings', meterIds, fromStr, toStr],
    queryFn: async () => {
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('meter_id', meterIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: open && meterIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  // ── Plant meter config (production source) — must be declared before
  // prodPivot below, which reads productExcludedPlantIds to filter out
  // exclusive-permeate plants' product meters.
  const { data: modalMeterConfigs, isLoading: configLoading } = useQuery({
    queryKey: ['dsm-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id,permeate_is_production,config')
        .in('plant_id', plantIds);
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
    staleTime: 30_000,  // FIX (egress): matched to this query's own 30s refetchInterval (while modal is open) instead of 0 (always stale)
    refetchInterval: open ? 30_000 : false,
  });

  // Plants whose RO permeate delta should be pulled in as (part of) production.
  // permeate_is_production is a DB-trigger-maintained mirror of
  // config.permeate_is_production (fn_sync_permeate_is_production fires on every
  // write — see the plant_meter_config migration), so the two can never
  // legitimately disagree; checking both is just harmless redundancy for rows
  // written before that trigger existed.
  //
  // ro_production_source is deliberately NOT part of this check. It describes
  // the *intended* mode, not whether permeate is currently active — a plant can
  // have ro_production_source: 'both' while permeate_is_production is off (see
  // MeterConfig.tsx's own "⚠ permeate switch off" warning badge for this exact,
  // valid, intentional state, e.g. a temporary pause). Treating
  // ro_production_source as a fallback here was a bug introduced in an earlier
  // pass: it silently overrode that explicit "off" and re-activated permeate
  // production the admin had just paused.
  const permeateIsProductionPlantIds = useMemo(
    () => (modalMeterConfigs ?? [])
      .filter((c: any) => c.permeate_is_production === true || c.config?.permeate_is_production === true)
      .map((c: any) => c.plant_id as string),
    [modalMeterConfigs],
  );

  // Plants in EXCLUSIVE permeate mode (ro_production_source === 'permeate') AND
  // where permeate is actually active right now — their product meter reads the
  // SAME water as the permeate meter, so it must be excluded from the pivot to
  // avoid double-counting. Requiring permeate_is_production here too matters:
  // without it, a plant with ro_production_source: 'permeate' but the switch
  // paused would lose its product meter AND get no permeate credit — zero
  // production shown, which is worse than double-counting.
  // Mirrors the equivalent split in TrendChart.tsx / Dashboard.tsx.
  const productExcludedPlantIds = useMemo(
    () => new Set<string>(
      (modalMeterConfigs ?? [])
        .filter((c: any) =>
          c.config?.ro_production_source === 'permeate' &&
          (c.permeate_is_production === true || c.config?.permeate_is_production === true))
        .map((c: any) => c.plant_id as string),
    ),
    [modalMeterConfigs],
  );

  // ── Build pivot: rows = dates, columns = entities ──────────────────────────
  // computePivotFromReadings mirrors TrendChart computeEntityDeltas so
  // meter-replacement rows and their successors are correctly zeroed.
  // Build pivot + estimated-key set together so the table can mark auto-filled cells.
  const consPivot = useMemo(() => {
    const sortedLocs = [...(locators ?? [])].sort((a, b) => {
      const pa = plantCodeById.get(a.plant_id) ?? '';
      const pb = plantCodeById.get(b.plant_id) ?? '';
      return pa.localeCompare(pb) || (a.name ?? '').localeCompare(b.name ?? '');
    });
    const pivot = computePivotFromReadingsNoCache(consReadings ?? [], 'locator_id', 'daily_volume', directLocatorIds);

    // Track which (dateKey, locatorId) cells come from estimated rows so the
    // table can render them with a distinct "~" indicator and tooltip.
    const estimatedKeys = new Set<string>();
    (consReadings ?? []).forEach((r: any) => {
      if (r.is_estimated) {
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        estimatedKeys.add(`${dk}__${r.locator_id}`);
      }
    });

    // Fill every date in the selected range — not just dates that have readings.
    const allDates: string[] = [];
    const cur = new Date(fromStr + 'T00:00:00');
    const end = new Date(toStr   + 'T00:00:00');
    while (cur <= end) {
      allDates.push(format(cur, 'yyyy-MM-dd'));
      cur.setDate(cur.getDate() + 1);
    }
    return { dates: allDates, entities: sortedLocs, pivot, estimatedKeys };
  }, [locators, consReadings, plantCodeById, fromStr, toStr, directLocatorIds]);

  const prodPivot = useMemo(() => {
    // Drop meters belonging to plants in EXCLUSIVE permeate mode — their
    // product meter reads the same water the RO permeate meter already
    // counts, so including both here would double-count that plant's output.
    const includedMeters = (productMeters ?? []).filter(
      (m: any) => !productExcludedPlantIds.has(m.plant_id),
    );
    const includedMeterIds = new Set(includedMeters.map((m: any) => m.id));
    const sortedMeters = [...includedMeters]
      .map((m: any) => ({ ...m, _source: 'meter' as const }))
      .sort((a, b) => {
        const pa = plantCodeById.get(a.plant_id) ?? '';
        const pb = plantCodeById.get(b.plant_id) ?? '';
        return pa.localeCompare(pb) || (a.name ?? '').localeCompare(b.name ?? '');
      });
    const includedReadings = (prodReadings ?? []).filter((r: any) => includedMeterIds.has(r.meter_id));
    const pivot = computePivotFromReadingsNoCache(includedReadings, 'meter_id', 'daily_volume', directMeterIds);

    const estimatedKeys = new Set<string>();
    includedReadings.forEach((r: any) => {
      if (r.is_estimated) {
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        estimatedKeys.add(`${dk}__${r.meter_id}`);
      }
    });

    // Fill every date in the selected range — not just dates with readings.
    const allDates2: string[] = [];
    const cur2 = new Date(fromStr + 'T00:00:00');
    const end2 = new Date(toStr   + 'T00:00:00');
    while (cur2 <= end2) {
      allDates2.push(format(cur2, 'yyyy-MM-dd'));
      cur2.setDate(cur2.getDate() + 1);
    }
    return { dates: allDates2, entities: sortedMeters, pivot, estimatedKeys };
  }, [productMeters, prodReadings, plantCodeById, fromStr, toStr, productExcludedPlantIds, directMeterIds]);

  // ── RO permeate production (plants with permeate_is_production = true) ─────
  // This is the path that respects recalculateTrainDeltas.
  // We read permeate_meter_delta DIRECTLY from the DB
  // instead of re-deriving deltas from permeate_meter (cumulative), which caused
  // the "millions delta" spike seen when the first row in the date range had no
  // prior reading and its cumulative value was treated as a single-day delta.
  // RO train meta — for column headers (train_number, plant_id)
  const { data: roTrainsMeta, isLoading: trainsLoading } = useQuery({
    queryKey: ['dsm-ro-trains', permeateIsProductionPlantIds],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [] as any[];
      const { data } = await supabase
        .from('ro_trains')
        .select('id,train_number,plant_id')
        .in('plant_id', permeateIsProductionPlantIds)
        .order('train_number');
      return (data ?? []) as any[];
    },
    enabled: open && permeateIsProductionPlantIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  // RO readings — permeate_meter_delta (pre-validated) + reading_datetime for date bucketing.
  // The 00:20 cutoff rule and permeate_production_date have been removed system-wide.
  // Every reading is attributed to the calendar day it was actually recorded, so
  // Production and Prod vs Consum tables always show the same per-date totals.
  const { data: roMeterReadings, isLoading: roLoading } = useQuery({
    queryKey: ['dsm-ro-readings', permeateIsProductionPlantIds, fromStr, toStr],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [] as any[];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter_delta,reading_datetime,is_estimated')
        .in('plant_id', permeateIsProductionPlantIds)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      return (data ?? []) as any[];
    },
    enabled: open && permeateIsProductionPlantIds.length > 0,
    staleTime: 30_000,  // FIX (egress): matched to this query's own 30s refetchInterval (while modal is open) instead of 0 (always stale)
    refetchInterval: open ? 30_000 : false,
  });

  // RO production pivot — summed permeate_meter_delta per calendar date per train.
  // ── HYBRID STRATEGY ─────────────────────────────────────────────────────────
  // Tier 1 (backend shortcut): roMeterReadings already carries permeate_meter_delta
  //   from the DB.  We call hydrateFromStoredDeltas to seed deltaCache from these
  //   stored values before accumulating — so on subsequent renders the main
  //   Dashboard stat-card query can use the cache without re-fetching.
  // Tier 2 (raw fallback): If a delta entry was invalidated (e.g. a row was
  //   deleted or re-inserted via Operations/ROTrains), deltaCache.get() returns
  //   null and we fall back to the stored permeate_meter_delta value from this
  //   row — ensuring the pivot is always self-consistent with the raw DB rows
  //   returned in this query.
  // Tier 3: Full recalculation from cumulative meter values is handled by
  //   computeRoPermPivot (called from the DataSummaryModal which fetches raw
  //   permeate_meter columns).  Dashboard stat cards use this lighter pivot.
  const roProdPivot = useMemo(() => {
    const sortedTrains = [...(roTrainsMeta ?? [])]
      .map((t: any) => ({ ...t, _source: 'ro' as const }))
      .sort((a, b) => {
        const pa = plantCodeById.get(a.plant_id) ?? '';
        const pb = plantCodeById.get(b.plant_id) ?? '';
        return pa.localeCompare(pb) || (a.train_number ?? 0) - (b.train_number ?? 0);
      });

    const pivot = new Map<string, Map<string, number>>();

    // Enumerate every date in the selected range so empty days show as "—"
    const allDates: string[] = [];
    const cur = new Date(fromStr + 'T00:00:00');
    const end = new Date(toStr   + 'T00:00:00');
    while (cur <= end) {
      const dk = format(cur, 'yyyy-MM-dd');
      allDates.push(dk);
      pivot.set(dk, new Map());
      cur.setDate(cur.getDate() + 1);
    }

    // ── HYBRID: Tier-1 hydrate cache from stored deltas ───────────────────────
    // Seed deltaCache from the stored permeate_meter_delta column so that the
    // main Dashboard stat queries (dash-ro-permeate-today / yest) can check the
    // cache and avoid recomputing from raw meter values this session.
    hydrateFromStoredDeltas(
      roMeterReadings ?? [],
      'train_id',
      'permeate_meter_delta',
      'reading_datetime',
    );

    // Accumulate: check cache first, fall back to stored delta.
    const estimatedKeys = new Set<string>();
    (roMeterReadings ?? []).forEach((r: any) => {
      const dateKey  = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      const trainKey = r.train_id as string;
      if (r.is_estimated) {
        estimatedKeys.add(`${dateKey}__${trainKey}`);
      }
      // Tier-1: prefer cache (may have been updated by a recent mutation-triggered recompute)
      const cached = deltaCache.get(trainKey, dateKey);
      const delta  = cached !== null ? cached : +(r.permeate_meter_delta ?? 0);
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      pivot.get(dateKey)!.set(trainKey, (pivot.get(dateKey)!.get(trainKey) ?? 0) + delta);
    });

    return { dates: allDates, entities: sortedTrains, pivot, estimatedKeys };
  }, [roTrainsMeta, roMeterReadings, plantCodeById, fromStr, toStr]);

  // BUG FIX — race condition:
  // modalMeterConfigs can be `undefined` on the very first render after the modal
  // opens, even though `configLoading` is already `false` (TanStack Query sets
  // isPending=true only after the query key resolves to "loading" state, but
  // there is a 1-tick gap where the query hasn't been scheduled yet).
  // Treat configs as "not yet ready" until the array is defined, and block
  // rendering (isLoading=true) until then, so the merged pivot below never
  // briefly renders with an incomplete plant list.
  const configsReady = !configLoading && modalMeterConfigs !== undefined;

  // ── Combined production pivot ───────────────────────────────────────────
  // Merges product-meter entities (prodPivot already excludes plants in
  // EXCLUSIVE permeate mode — see productExcludedPlantIds above) with
  // RO-train entities (only fetched for plants with permeate_is_production
  // = true) into ONE entity list + ONE pivot map. A plant in 'both' mode
  // therefore shows its product meter column AND its RO train column(s)
  // side by side, with Total Prod. summing across all of them — matching
  // Dashboard.tsx's stat-card math instead of switching sources wholesale.
  const combinedProdPivot = useMemo(() => {
    const entities = [...prodPivot.entities, ...roProdPivot.entities];
    const dates = prodPivot.dates; // same fromStr→toStr range as roProdPivot
    const pivot = new Map<string, Map<string, number>>();
    dates.forEach((d) => {
      const merged = new Map<string, number>();
      prodPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      roProdPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      pivot.set(d, merged);
    });
    const mergedEstimated = new Set<string>([...prodPivot.estimatedKeys, ...roProdPivot.estimatedKeys]);
    return { dates, entities, pivot, estimatedKeys: mergedEstimated };
  }, [prodPivot, roProdPivot]);

  const hasRoEntities    = combinedProdPivot.entities.some((e: any) => e._source === 'ro');
  const hasMeterEntities = combinedProdPivot.entities.some((e: any) => e._source === 'meter');

  const prodDataLoading = !configsReady || metersLoading || prodLoading || roLoading || trainsLoading;
  const isLoading = tab === 'consumption'
    ? (locatorsLoading || consLoading)
    : tab === 'production'
      ? prodDataLoading
      : tab === 'current'
        ? (locatorsLoading || consLoading || prodDataLoading)
        : (locatorsLoading || consLoading || prodDataLoading);

  // Active pivot data for the detail tabs
  const { dates, entities, pivot, estimatedKeys } = tab === 'consumption'
    ? consPivot
    : combinedProdPivot;

  const entityIdField = 'id';

  // Column totals (sum per entity across all dates)
  const colTotals = useMemo(() =>
    entities.map((e) =>
      dates.reduce((s, d) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
    ),
  [entities, dates, pivot]);

  // Row totals (sum per date across all entities)
  const rowTotals = useMemo(() =>
    dates.map((d) =>
      entities.reduce((s, e) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
    ),
  [entities, dates, pivot]);

  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  // ── Tab-independent grand totals for the "Prod. vs Consum." comparison tab ──
  // These always mirror the detail-tab grandTotal formula (colTotals sum), but are
  // computed from the dedicated production and consumption pivots regardless of
  // which tab is currently active. This guarantees that the TOTAL row in
  // "Prod. vs Consum." shows exactly the same numbers as the "Production" and
  // "Consumption" detail tabs — no independent recomputation in the IIFE.
  const prodGrandTotal = useMemo(() => {
    return combinedProdPivot.entities.reduce(
      (s: number, e: any) =>
        s + combinedProdPivot.dates.reduce((ds: number, d: string) => ds + (combinedProdPivot.pivot.get(d)?.get(e.id) ?? 0), 0),
      0,
    );
  }, [combinedProdPivot]);

  const consGrandTotal = useMemo(
    () =>
      consPivot.entities.reduce(
        (s: number, e: any) =>
          s + consPivot.dates.reduce((ds: number, d: string) => ds + (consPivot.pivot.get(d)?.get(e.id) ?? 0), 0),
        0,
      ),
    [consPivot],
  );

  // ── Current readings pivots (raw absolute meter values) ──────────────────────
  // For each (date, entity) we keep only the LATEST reading recorded that day
  // (highest reading_datetime), since a day can have multiple readings.
  const consCurrentPivot = useMemo(() => {
    const latestTime = new Map<string, number>();
    const pivot = new Map<string, Map<string, number>>();
    (consReadings ?? []).forEach((r: any) => {
      if (r.current_reading == null) return;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const key     = `${dateKey}__${r.locator_id}`;
      const t       = new Date(r.reading_datetime).getTime();
      if (!latestTime.has(key) || t > latestTime.get(key)!) {
        latestTime.set(key, t);
        if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
        pivot.get(dateKey)!.set(r.locator_id, +r.current_reading);
      }
    });
    return { dates: consPivot.dates, entities: consPivot.entities, pivot };
  }, [consReadings, consPivot.dates, consPivot.entities]);

  const prodCurrentPivot = useMemo(() => {
    const latestTime = new Map<string, number>();
    const pivot = new Map<string, Map<string, number>>();
    (prodReadings ?? []).forEach((r: any) => {
      if (r.current_reading == null) return;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const key     = `${dateKey}__${r.meter_id}`;
      const t       = new Date(r.reading_datetime).getTime();
      if (!latestTime.has(key) || t > latestTime.get(key)!) {
        latestTime.set(key, t);
        if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
        pivot.get(dateKey)!.set(r.meter_id, +r.current_reading);
      }
    });
    return { dates: prodPivot.dates, entities: prodPivot.entities, pivot };
  }, [prodReadings, prodPivot.dates, prodPivot.entities]);

  // RO trains: fetch permeate_meter (cumulative) for the current-readings view.
  // Separate query so the main roProdPivot (delta-based) is unaffected.
  const { data: roCurrentReadings } = useQuery({
    queryKey: ['dsm-ro-current', permeateIsProductionPlantIds, fromStr, toStr],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [] as any[];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter,reading_datetime')
        .in('plant_id', permeateIsProductionPlantIds)
        .not('permeate_meter', 'is', null)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      return (data ?? []) as any[];
    },
    enabled: open && (tab === 'current' || tab === 'production') && permeateIsProductionPlantIds.length > 0,
  });

  const roCurrentPivot = useMemo(() => {
    const latestTime = new Map<string, number>();
    const pivot = new Map<string, Map<string, number>>();
    (roCurrentReadings ?? []).forEach((r: any) => {
      if (r.permeate_meter == null) return;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      const key     = `${dateKey}__${r.train_id}`;
      const t       = new Date(r.reading_datetime).getTime();
      if (!latestTime.has(key) || t > latestTime.get(key)!) {
        latestTime.set(key, t);
        if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
        pivot.get(dateKey)!.set(r.train_id, +r.permeate_meter);
      }
    });
    return { dates: roProdPivot.dates, entities: roProdPivot.entities, pivot };
  }, [roCurrentReadings, roProdPivot.dates, roProdPivot.entities]);

  // Combined current-readings pivot — same merge as combinedProdPivot, but for
  // raw (absolute) meter values instead of daily deltas.
  const combinedProdCurrentPivot = useMemo(() => {
    const entities = [...prodCurrentPivot.entities, ...roCurrentPivot.entities];
    const dates = prodCurrentPivot.dates;
    const pivot = new Map<string, Map<string, number>>();
    dates.forEach((d) => {
      const merged = new Map<string, number>();
      prodCurrentPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      roCurrentPivot.pivot.get(d)?.forEach((v, k) => merged.set(k, v));
      pivot.set(d, merged);
    });
    return { dates, entities, pivot };
  }, [prodCurrentPivot, roCurrentPivot]);

  // Active current-readings pivot for the 'current' tab
  const currentPivotData = currentSide === 'production'
    ? combinedProdCurrentPivot
    : consCurrentPivot;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="data-summary-modal"
      >
        <DataSummaryFilters
          fromStr={fromStr}
          toStr={toStr}
          setFromStr={setFromStr}
          setToStr={setToStr}
          tab={tab}
          setTab={setTab}
          currentSide={currentSide}
          setCurrentSide={setCurrentSide}
          isLoading={isLoading}
        />
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <DataSummaryTable
            tab={tab}
            isLoading={isLoading}
            consPivot={consPivot}
            prodPivot={prodPivot}
            combinedProdPivot={combinedProdPivot}
            consCurrentPivot={consCurrentPivot}
            prodCurrentPivot={prodCurrentPivot}
            combinedProdCurrentPivot={combinedProdCurrentPivot}
            currentPivotData={currentPivotData}
            colTotals={colTotals}
            rowTotals={rowTotals}
            grandTotal={grandTotal}
            prodGrandTotal={prodGrandTotal}
            consGrandTotal={consGrandTotal}
            plantCodeById={plantCodeById}
            hasRoEntities={hasRoEntities}
            hasMeterEntities={hasMeterEntities}
            currentSide={currentSide}
          />
        </div>
        <DataSummaryStats
          tab={tab}
          combinedProdPivot={combinedProdPivot}
          consPivot={consPivot}
          currentPivotData={currentPivotData}
          entities={entities}
          dates={dates}
          estimatedKeys={estimatedKeys}
          hasRoEntities={hasRoEntities}
          hasMeterEntities={hasMeterEntities}
          plantIds={plantIds}
          modalMeterConfigs={modalMeterConfigs}
          configLoading={configLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
