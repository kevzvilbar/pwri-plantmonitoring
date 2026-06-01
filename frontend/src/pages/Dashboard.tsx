import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import type { PlantAlert } from '@/store/appStore';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// deltaCache sits in front of every raw-reading computation.
//   • Cache hit  → return the stored value instantly (no recomputation).
//   • Cache miss → compute from raw rows, populate cache, return computed value.
//   • Mutation   → Operations/ROTrains/Plants call flushDeltaCache(entityIds)
//                  which clears affected entries so the next render recomputes.
// hydrateFromStoredDeltas seeds the cache from DB-stored deltas (daily_volume,
// permeate_meter_delta) so that simple reads never recompute unnecessarily.
import { deltaCache, hydrateFromStoredDeltas, flushDeltaCache } from '@/lib/deltaCache';
import { usePlants } from '@/hooks/usePlants';
import { fmtNum, nrwColor } from '@/lib/calculations';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { format, subDays, startOfDay, parseISO, addDays } from 'date-fns';
import {
  Droplet, Activity, Zap, FlaskConical, AlertTriangle, Gauge, Thermometer,
  Waves, Cloud, Receipt, Banknote, LayoutGrid, ListCollapse, ExternalLink,
  ArrowUpRight, ArrowDownRight, Minus, CalendarDays,
  ShieldAlert,
} from 'lucide-react';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';
import { BlendingVolumeCard } from '@/components/BlendingVolumeCard';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { calc } from '@/lib/calculations';
import {
  StatCard, PerWellSourceCard, ClusterHeader,
} from '@/components/dashboard/StatCard';
import {
  ClusterCharts, TrendModal, InlineTrendChart,
} from '@/components/dashboard/TrendChart';
import {
  DashboardViewMode, VIEW_MODE_KEY, readSavedViewMode, pctDelta,
  OVERVIEW_CHART_METRICS, QUALITY_CHART_METRICS, COST_CHART_METRICS, ChartMetric,
} from '@/components/dashboard/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PlantHealthStrip }    from '@/components/dashboard/PlantHealthStrip';
import { NRWGaugeCard }        from '@/components/dashboard/NRWGaugeCard';
import { ReadingCoverageCard } from '@/components/dashboard/ReadingCoverageCard';
import { PMDueSoonCard }       from '@/components/dashboard/PMDueSoonCard';

// ─── DataSummaryModal ─────────────────────────────────────────────────────────
// Full-screen pivot-table popup. Rows = dates, columns = individual
// locators (consumption) or product meters (production). Non-retractable —
// closes only via the ✕ button or clicking outside the dialog.

type SummaryTab = 'both' | 'production' | 'consumption' | 'current';

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
function computePivotFromReadingsNoCache(
  readings: any[],
  entityKeyField: string,
  dailyVolumeField: string | null,
): Map<string, Map<string, number>> {
  const byEntity = new Map<string, any[]>();
  readings.forEach((r) => {
    const k = r[entityKeyField] ?? '__';
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(r);
  });
  const pivot = new Map<string, Map<string, number>>();
  byEntity.forEach((rows, entityKey) => {
    const sorted = [...rows].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
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
      if (dailyVolumeField && r[dailyVolumeField] != null) {
        // Clamp to 0: a negative daily_volume is a corrupt stored value
        // (e.g. partial write, rollback). Matches TrendChart's buildEntityPivot
        // and the computeEntityDeltas fix — all three paths must be consistent.
        delta = Math.max(0, +r[dailyVolumeField]);
        lastReading.set(entityKey, +r.current_reading);
      } else if (!lastReading.has(entityKey)) {
        if (r.previous_reading != null && r.current_reading != null)
          delta = +r.current_reading - +r.previous_reading;
        lastReading.set(entityKey, +r.current_reading);
      } else {
        delta = +r.current_reading - lastReading.get(entityKey)!;
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
): Map<string, Map<string, number>> {
  const byEntity = new Map<string, any[]>();
  readings.forEach((r) => {
    const k = r[entityKeyField] ?? '__';
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(r);
  });
  const pivot = new Map<string, Map<string, number>>();
  byEntity.forEach((rows, entityKey) => {
    const sorted = [...rows].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
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
      if (dailyVolumeField && r[dailyVolumeField] != null) {
        // daily_volume is GENERATED ALWAYS as (current_reading - previous_reading).
        // For the very first row in the fetched window (no lastReading yet), this
        // value correctly represents THAT reading's interval — which may span
        // multiple days if readings were skipped. Use it as-is (it's already the
        // correct single-interval delta stored at insert time), clamped ≥ 0.
        // Clamp: a negative value means the stored delta is corrupt (bad write,
        // rollback, etc.) — treat as 0 rather than propagating a huge negative.
        delta = Math.max(0, +r[dailyVolumeField]);
        lastReading.set(entityKey, +r.current_reading);
      } else if (!lastReading.has(entityKey)) {
        // FIX: No daily_volume and no prior row in range.
        // Use the stored previous_reading field (written by Operations.tsx at insert
        // time) instead of treating the full cumulative meter value as today's delta.
        // This prevents the "millions" spike when the date range starts mid-history.
        if (r.previous_reading != null && r.current_reading != null)
          delta = +r.current_reading - +r.previous_reading;
        lastReading.set(entityKey, +r.current_reading);
      } else {
        // Normal: subtract the last seen reading. Pass through negatives.
        delta = +r.current_reading - lastReading.get(entityKey)!;
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
function pivotDayTotal(pivot: Map<string, Map<string, number>>, dateKey: string): number {
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
  if (pct > 0) return <ArrowUpRight className="h-3 w-3 text-emerald-500" />;
  return <ArrowDownRight className="h-3 w-3 text-rose-500" />;
}

function pctLabel(pct: number | null) {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

interface DataSummaryModalProps {
  open: boolean;
  onClose: () => void;
  plantIds: string[];
  plantCodeById: Map<string, string>;
}

function DataSummaryModal({ open, onClose, plantIds, plantCodeById }: DataSummaryModalProps) {
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
        .from('locators').select('id,name,code,plant_id')
        .in('plant_id', plantIds).eq('status', 'Active');
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });

  const locatorIds = useMemo(() => (locators ?? []).map((l: any) => l.id), [locators]);

  const { data: consReadings, isLoading: consLoading } = useQuery({
    queryKey: ['dsm-cons-readings', locatorIds, fromStr, toStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings')
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
        .select('id,name,plant_id').in('plant_id', plantIds);
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  const meterIds = useMemo(() => (productMeters ?? []).map((m: any) => m.id), [productMeters]);

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
    const pivot = computePivotFromReadingsNoCache(consReadings ?? [], 'locator_id', 'daily_volume');

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
  }, [locators, consReadings, plantCodeById, fromStr, toStr]);

  const prodPivot = useMemo(() => {
    const sortedMeters = [...(productMeters ?? [])].sort((a, b) => {
      const pa = plantCodeById.get(a.plant_id) ?? '';
      const pb = plantCodeById.get(b.plant_id) ?? '';
      return pa.localeCompare(pb) || (a.name ?? '').localeCompare(b.name ?? '');
    });
    const pivot = computePivotFromReadingsNoCache(prodReadings ?? [], 'meter_id', 'daily_volume');

    const estimatedKeys = new Set<string>();
    (prodReadings ?? []).forEach((r: any) => {
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
  }, [productMeters, prodReadings, plantCodeById, fromStr, toStr]);

  // ── RO permeate production (plants with permeate_is_production = true) ─────
  // This is the path that respects recalculateTrainDeltas.
  // We read permeate_meter_delta DIRECTLY from the DB
  // instead of re-deriving deltas from permeate_meter (cumulative), which caused
  // the "millions delta" spike seen when the first row in the date range had no
  // prior reading and its cumulative value was treated as a single-day delta.
  const { data: modalMeterConfigs, isLoading: configLoading } = useQuery({
    queryKey: ['dsm-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id,permeate_is_production')
        .in('plant_id', plantIds);
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });

  const permeateIsProductionPlantIds = useMemo(
    () => (modalMeterConfigs ?? [])
      .filter((c: any) => c.permeate_is_production)
      .map((c: any) => c.plant_id as string),
    [modalMeterConfigs],
  );

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
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('plant_id', permeateIsProductionPlantIds)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      return (data ?? []) as any[];
    },
    enabled: open && permeateIsProductionPlantIds.length > 0,
    staleTime: 0,
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
    const sortedTrains = [...(roTrainsMeta ?? [])].sort((a, b) => {
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
    (roMeterReadings ?? []).forEach((r: any) => {
      const dateKey  = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      const trainKey = r.train_id as string;
      // Tier-1: prefer cache (may have been updated by a recent mutation-triggered recompute)
      const cached = deltaCache.get(trainKey, dateKey);
      const delta  = cached !== null ? cached : Math.max(0, +(r.permeate_meter_delta ?? 0));
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      pivot.get(dateKey)!.set(trainKey, (pivot.get(dateKey)!.get(trainKey) ?? 0) + delta);
    });

    return { dates: allDates, entities: sortedTrains, pivot };
  }, [roTrainsMeta, roMeterReadings, plantCodeById, fromStr, toStr]);

  // For the 'both' (Prod. vs Consum.) tab we need daily totals from both sides.
  //
  // BUG FIX — race condition:
  // modalMeterConfigs can be `undefined` on the very first render after the modal
  // opens, even though `configLoading` is already `false` (TanStack Query sets
  // isPending=true only after the query key resolves to "loading" state, but
  // there is a 1-tick gap where the query hasn't been scheduled yet).
  // If we evaluate `useRoProd` while configs are undefined we get an empty
  // permeateIsProductionPlantIds array → useRoProd = false → the "Prod. vs
  // Consum." tab renders using prodPivot (product meters) while the
  // "Production" detail tab correctly uses roProdPivot (RO trains) once data
  // arrives.  This caused the two tabs to show different production numbers.
  //
  // Fix: treat configs as "not yet ready" until the array is defined, and
  // block rendering (isLoading=true) until then.
  const configsReady = !configLoading && modalMeterConfigs !== undefined;
  const useRoProd    = configsReady && permeateIsProductionPlantIds.length > 0;

  const prodDataLoading = !configsReady
    || (useRoProd ? (roLoading || trainsLoading) : (metersLoading || prodLoading));
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
    : useRoProd
      ? { ...roProdPivot, estimatedKeys: new Set<string>() }
      : prodPivot;

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
    const activePivot = useRoProd ? roProdPivot : prodPivot;
    return activePivot.entities.reduce(
      (s: number, e: any) =>
        s + activePivot.dates.reduce((ds: number, d: string) => ds + (activePivot.pivot.get(d)?.get(e.id) ?? 0), 0),
      0,
    );
  }, [useRoProd, roProdPivot, prodPivot]);

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

  // Active current-readings pivot for the 'current' tab
  const currentPivotData = currentSide === 'production'
    ? (useRoProd ? roCurrentPivot : prodCurrentPivot)
    : consCurrentPivot;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="data-summary-modal"
      >
        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Data Summary
            </DialogTitle>

            {/* Date range picker */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <input
                type="date"
                value={fromStr}
                max={toStr}
                onChange={(e) => e.target.value && setFromStr(e.target.value)}
                className="bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <span>→</span>
              <input
                type="date"
                value={toStr}
                min={fromStr}
                max={todayStr}
                onChange={(e) => e.target.value && setToStr(e.target.value)}
                className="bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>
        </DialogHeader>

        {/* ── Option toggles: Prod. vs Consum. / Production / Consumption ── */}
        <div className="flex border-b shrink-0 px-5 bg-muted/20">
          {([
            { key: 'both',        label: 'Prod. vs Consum.',  icon: <Activity className="h-3 w-3" /> },
            { key: 'production',  label: 'Production',        icon: <Droplet  className="h-3 w-3" /> },
            { key: 'consumption', label: 'Consumption',       icon: <Receipt  className="h-3 w-3" /> },
            { key: 'current',     label: 'Current Readings',  icon: <Gauge    className="h-3 w-3" /> },
          ] as { key: SummaryTab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={[
                'px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <span className="flex items-center gap-1.5">{icon}{label}</span>
            </button>
          ))}
        </div>

        {/* ── Current-Readings side toggle — OUTSIDE the scroll container so
             sticky thead is never displaced when scrolling horizontally. ── */}
        {!isLoading && tab === 'current' && (
          <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/10 shrink-0">
            <span className="text-[10px] text-muted-foreground mr-1">Show:</span>
            {(['consumption', 'production'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setCurrentSide(s)}
                className={[
                  'px-2.5 py-0.5 text-[10px] rounded-full border transition-colors',
                  currentSide === s
                    ? 'bg-primary text-primary-foreground border-primary font-semibold'
                    : 'border-border text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {s === 'consumption' ? 'Consumption' : (useRoProd ? 'Production (RO)' : 'Production')}
              </button>
            ))}
          </div>
        )}

        {/* ── Body: pivot table or Prod. vs Consum. comparison ── */}
        {/* Each tab renders its own overflow-auto container so horizontal scroll
            state resets on every tab switch — preventing the carry-over misalignment
            that occurred when a wide Production table left a scroll offset that was
            then inherited by the narrower Prod. vs Consum. or Current tabs. */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">Loading…</div>
          )}

          {/* ── "Prod. vs Consum." combined comparison tab — own scroll context ── */}
          {!isLoading && tab === 'both' && (
          <div className="flex-1 overflow-auto min-h-0">
          {(() => {
            // Use the production pivot as the single canonical date list (fromStr→toStr).
            // Avoid a union that can gain phantom dates if the two pivot memos recompute
            // at slightly different times or have readings outside the selected range.
            const activeProdPivot = useRoProd ? roProdPivot : prodPivot;
            // Canonical date list: production pivot dates (same fromStr→toStr as cons pivot).
            const allDates = activeProdPivot.dates;

            // ── Entity-filtered sums — MUST match detail-tab rowTotals exactly ──────────
            // Do NOT use pivotDayTotal (which sums raw map values including any orphan
            // train_ids not present in entities). Instead mirror the rowTotals formula:
            //   entities.reduce((s, e) => s + (pivot.get(date)?.get(e.id) ?? 0), 0)
            // This guarantees "Prod. vs Consum." totals == "Production" / "Consumption"
            // row totals for every date.
            const prodEntities = activeProdPivot.entities;
            const consEntities = consPivot.entities;
            const rows = [...allDates].reverse().map((date) => {
              const prod = prodEntities.reduce((s: number, e: any) => s + (activeProdPivot.pivot.get(date)?.get(e.id) ?? 0), 0);
              const cons = consEntities.reduce((s: number, e: any) => s + (consPivot.pivot.get(date)?.get(e.id) ?? 0), 0);
              const bal  = prod - cons;
              const nrw  = prod > 0 ? +((bal / prod) * 100).toFixed(1) : null;
              return { date, prod, cons, bal, nrw };
            });
            // Use the tab-independent memos so the TOTAL row always matches
            // the grand totals shown in the "Production" and "Consumption" detail tabs.
            const totProd = prodGrandTotal;
            const totCons = consGrandTotal;
            const totBal  = totProd - totCons;
            const totNRW  = totProd > 0 ? +((totBal / totProd) * 100).toFixed(1) : null;
            return (
              <table className="min-w-full text-[11px] border-collapse" data-testid="dsm-both-table">
                <thead>
                  <tr className="bg-muted/95 backdrop-blur-sm">
                    <th className="sticky top-0 left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">Date</th>
                    <th className="sticky top-0 z-20 bg-muted/95 px-3 py-2 text-right font-semibold text-primary whitespace-nowrap border-b border-border min-w-[110px]">Production (m³)</th>
                    <th className="sticky top-0 z-20 bg-muted/95 px-3 py-2 text-right font-semibold text-highlight whitespace-nowrap border-b border-border min-w-[120px]">Consumption (m³)</th>
                    <th className="sticky top-0 z-20 bg-muted/95 px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[100px]">Balance (m³)</th>
                    <th className="sticky top-0 right-0 z-30 bg-teal-50/95 dark:bg-teal-950/60 px-3 py-2 text-right font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-l border-border min-w-[80px]">NRW %</th>
                  </tr>
                  <tr className="bg-teal-50/60 dark:bg-teal-950/20">
                    <td className="sticky left-0 z-30 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 font-semibold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-r border-border text-[10px]">TOTAL</td>
                    <td className="px-3 py-1.5 text-right font-semibold font-mono-num text-primary border-b border-border tabular-nums">{totProd > 0 ? totProd.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-semibold font-mono-num text-highlight border-b border-border tabular-nums">{totCons > 0 ? totCons.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                    <td className={['px-3 py-1.5 text-right font-semibold font-mono-num border-b border-border tabular-nums', totBal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'].join(' ')}>{totBal !== 0 ? totBal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                    <td className="sticky right-0 z-30 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 text-right font-bold font-mono-num text-teal-700 dark:text-teal-300 border-b border-l border-border tabular-nums">{totNRW != null ? `${totNRW}%` : '—'}</td>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ date, prod, cons, bal, nrw }, di) => {
                    const isEven = di % 2 === 0;
                    return (
                      <tr key={date} className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}>
                        <td className={['sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border', isEven ? 'bg-background' : 'bg-muted/10'].join(' ')}>{format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num tabular-nums text-primary">{prod > 0 ? prod.toLocaleString(undefined, { maximumFractionDigits: 1 }) : <span className="text-muted-foreground/40">—</span>}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num tabular-nums text-highlight">{cons > 0 ? cons.toLocaleString(undefined, { maximumFractionDigits: 1 }) : <span className="text-muted-foreground/40">—</span>}</td>
                        <td className={['px-3 py-1.5 text-right font-mono-num tabular-nums', bal > 0 ? 'text-emerald-600 dark:text-emerald-400' : bal < 0 ? 'text-rose-600' : 'text-muted-foreground/40'].join(' ')}>{prod > 0 || cons > 0 ? bal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                        <td className={['sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums border-l border-border', isEven ? 'bg-background' : 'bg-muted/10', nrw != null && nrw > 10 ? 'text-rose-600' : nrw != null ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground/40'].join(' ')}>{nrw != null ? `${nrw}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
          </div>
          )}

          {/* ── Production / Consumption detail tabs ── */}
          {!isLoading && (tab === 'production' || tab === 'consumption') && entities.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              No {tab === 'consumption' ? 'locators' : useRoProd ? 'RO trains' : 'product meters'} found.
            </div>
          )}
          {!isLoading && (tab === 'production' || tab === 'consumption') && entities.length > 0 && dates.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              No readings in this date range.
            </div>
          )}
          {!isLoading && (tab === 'production' || tab === 'consumption') && entities.length > 0 && dates.length > 0 && (
            <div className="flex-1 overflow-auto min-h-0">
            <table className="min-w-full text-[11px] border-collapse" data-testid="dsm-pivot-table">
              <thead>
                {/* Entity name header row */}
                <tr className="bg-muted/95 backdrop-blur-sm">
                  <th className="sticky top-0 left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">
                    Date
                  </th>
                  {entities.map((e, i) => {
                    // RO train columns: "RO{train_number}" header; product meter / locator: name/code
                    const isRoTrain = tab === 'production' && useRoProd;
                    const label = isRoTrain
                      ? `RO${e.train_number ?? i + 1}`
                      : (e.name ?? e.code ?? `#${i + 1}`);
                    const sublabel = plantCodeById.get(e.plant_id) ?? '';
                    return (
                      <th
                        key={e.id}
                        className="sticky top-0 z-20 bg-muted/95 px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[90px]"
                        title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                      >
                        <div className="truncate max-w-[110px] mx-auto font-mono-num">{label}</div>
                        {sublabel && (
                          <div className="text-[9px] font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                        )}
                      </th>
                    );
                  })}
                  <th className="sticky top-0 right-0 z-30 bg-teal-50/95 dark:bg-teal-950/60 px-3 py-2 text-right font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-l border-border min-w-[90px]">
                    {tab === 'production' ? 'Total Prod. (m³)' : 'Total (m³)'}
                  </th>
                </tr>

                {/* Column totals sub-header */}
                <tr className="bg-teal-50/60 dark:bg-teal-950/20">
                  <td className="sticky left-0 z-30 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 font-semibold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-r border-border text-[10px]">
                    TOTAL
                  </td>
                  {colTotals.map((tot, i) => (
                    <td key={entities[i].id} className="px-2 py-1.5 text-center font-semibold font-mono-num text-teal-700 dark:text-teal-300 border-b border-border tabular-nums">
                      {tot > 0 ? tot.toLocaleString(undefined, { maximumFractionDigits: 1 }) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                  ))}
                  <td className="sticky right-0 z-30 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 text-right font-bold font-mono-num text-teal-700 dark:text-teal-300 border-b border-l border-border tabular-nums">
                    {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              </thead>

              <tbody>
                {[...dates].reverse().map((date, di) => {
                  const rowVols = entities.map((e) => pivot.get(date)?.get(e.id) ?? null);
                  const rowTot = rowTotals[dates.length - 1 - di];
                  const isEven = di % 2 === 0;
                  return (
                    <tr
                      key={date}
                      className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}
                    >
                      <td className={[
                        'sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border',
                        isEven ? 'bg-background' : 'bg-muted/10',
                      ].join(' ')}>
                        {format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}
                      </td>
                      {rowVols.map((vol, ei) => {
                        const entityId = entities[ei].id;
                        const estKey = `${date}__${entityId}`;
                        const isEst = estimatedKeys.has(estKey);
                        return (
                          <td
                            key={entityId}
                            className={[
                              "px-2 py-1.5 text-right font-mono-num tabular-nums border-border",
                              isEst ? "bg-amber-50/60 dark:bg-amber-950/20" : "",
                            ].join(" ")}
                            title={isEst ? "Auto-estimated via Polynomial Regression (degree 3) — no reading was recorded for this day. Value will be replaced when actual data is entered." : undefined}
                          >
                            {vol != null && vol > 0 ? (
                              <span className="inline-flex items-center gap-0.5">
                                {isEst && (
                                  <span className="text-amber-500 dark:text-amber-400 text-[9px] font-bold leading-none" aria-label="estimated">~</span>
                                )}
                                {vol.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={[
                        'sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums border-l border-border',
                        tab === 'consumption' ? 'text-highlight' : 'text-primary',
                        isEven ? 'bg-background' : 'bg-muted/10',
                      ].join(' ')}>
                        {rowTot > 0 ? rowTot.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* ── Inline Current Readings section (same entities, raw meter values) ── */}
            {(() => {
              const inlineCurrPivot = tab === 'consumption'
                ? consCurrentPivot
                : (useRoProd ? roCurrentPivot : prodCurrentPivot);
              const icEntities = inlineCurrPivot.entities;
              const icDates    = inlineCurrPivot.dates;
              const icPivot    = inlineCurrPivot.pivot;

              const icEntityLatest: (number | null)[] = icEntities.map((e: any) => {
                for (const d of [...icDates].reverse()) {
                  const v = icPivot.get(d)?.get(e.id);
                  if (v != null) return v;
                }
                return null;
              });

              return (
                <>
                  {/* Section divider — labels the second table clearly */}
                  <div className="flex items-center gap-2 px-3 py-2 border-t-2 border-border/60 bg-muted/30">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-semibold text-muted-foreground">Current Readings</span>
                    <span className="text-[10px] text-muted-foreground/60">— latest raw meter value per entity per day (absolute, not delta)</span>
                  </div>

                  <table className="min-w-full text-[11px] border-collapse" data-testid="dsm-current-inline-table">
                    <thead>
                      {/* ── Column header row ── */}
                      <tr className="bg-muted/90 backdrop-blur-sm">
                        <th className="sticky left-0 z-20 bg-muted/90 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">
                          Date
                        </th>
                        {icEntities.map((e: any, i: number) => {
                          const isRoTrain = tab === 'production' && useRoProd;
                          const label    = isRoTrain ? `RO${e.train_number ?? i + 1}` : (e.name ?? e.code ?? `#${i + 1}`);
                          const sublabel = plantCodeById.get(e.plant_id) ?? '';
                          return (
                            <th
                              key={e.id}
                              className="bg-muted/90 px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[90px]"
                              title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                            >
                              <div className="truncate max-w-[110px] mx-auto font-mono-num">{label}</div>
                              {sublabel && (
                                <div className="text-[9px] font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                              )}
                            </th>
                          );
                        })}
                        <th className="sticky right-0 z-20 bg-teal-50/95 dark:bg-teal-950/60 px-3 py-2 text-right font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-l border-border min-w-[80px]">
                          Coverage
                        </th>
                      </tr>

                      {/* ── LATEST sub-header row ── */}
                      <tr className="bg-teal-50/60 dark:bg-teal-950/20">
                        <td className="sticky left-0 z-20 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 text-[10px] font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-r border-border">
                          LATEST
                        </td>
                        {icEntityLatest.map((val, i) => (
                          <td
                            key={icEntities[i].id}
                            className="px-2 py-1.5 text-center text-[10px] font-semibold font-mono-num tabular-nums text-teal-700 dark:text-teal-300 border-b border-border"
                          >
                            {val != null
                              ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                        <td className="sticky right-0 z-20 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 text-right text-[10px] font-bold text-teal-700 dark:text-teal-300 border-b border-l border-border tabular-nums">
                          {icEntities.length} entities
                        </td>
                      </tr>
                    </thead>

                    <tbody>
                      {[...icDates].reverse().map((date: string, di: number) => {
                        const isEven      = di % 2 === 0;
                        const rowVals     = icEntities.map((e: any) => icPivot.get(date)?.get(e.id) ?? null);
                        const reported    = rowVals.filter((v) => v != null).length;
                        const total       = icEntities.length;
                        const coveragePct = total > 0 ? Math.round((reported / total) * 100) : 0;
                        const coverageColor =
                          coveragePct === 100 ? 'text-emerald-600 dark:text-emerald-400' :
                          coveragePct >= 50   ? 'text-amber-600 dark:text-amber-400'    :
                                                'text-rose-500 dark:text-rose-400';
                        return (
                          <tr
                            key={date}
                            className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}
                          >
                            <td className={[
                              'sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border',
                              isEven ? 'bg-background' : 'bg-muted/10',
                            ].join(' ')}>
                              {format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}
                            </td>
                            {rowVals.map((val, ei) => (
                              <td
                                key={icEntities[ei].id}
                                className="px-2 py-1.5 text-right font-mono-num tabular-nums border-border"
                                title={val != null ? `Raw meter reading: ${val.toLocaleString(undefined, { maximumFractionDigits: 3 })} m³` : undefined}
                              >
                                {val != null
                                  ? <span className="text-foreground">{val.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                  : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            ))}
                            <td
                              className={[
                                'sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums text-[10px] border-l border-border',
                                isEven ? 'bg-background' : 'bg-muted/10',
                                coverageColor,
                              ].join(' ')}
                              title={`${reported} of ${total} entities reported on this date`}
                            >
                              {reported > 0 ? `${reported}/${total}` : <span className="text-muted-foreground/40">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              );
            })()}

            </div>
          )}

          {/* ── Current Readings tab — own scroll context ── */}
          {!isLoading && tab === 'current' && (
          <div className="flex-1 overflow-auto min-h-0">
          {(() => {
            const crEntities = currentPivotData.entities;
            const crDates    = currentPivotData.dates;
            const crPivot    = currentPivotData.pivot;

            if (crEntities.length === 0) return (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                No entities found for current readings.
              </div>
            );
            if (crDates.length === 0) return (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                No readings in this date range.
              </div>
            );

            // Per-entity: most-recent non-null reading across the date range
            const entityLatest: (number | null)[] = crEntities.map((e: any) => {
              let latest: number | null = null;
              for (const d of [...crDates].reverse()) {
                const v = crPivot.get(d)?.get(e.id);
                if (v != null) { latest = v; break; }
              }
              return latest;
            });

            return (
              <table className="min-w-full text-[11px] border-collapse" data-testid="dsm-current-table">
                <thead>
                  {/* ── Row 1: column labels ── */}
                  <tr className="bg-muted/95 backdrop-blur-sm">
                    <th className="sticky top-0 left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[110px]">
                      Date
                    </th>
                    {crEntities.map((e: any, i: number) => {
                      const isRoTrain = currentSide === 'production' && useRoProd;
                      const label    = isRoTrain ? `RO${e.train_number ?? i + 1}` : (e.name ?? e.code ?? `#${i + 1}`);
                      const sublabel = plantCodeById.get(e.plant_id) ?? '';
                      return (
                        <th
                          key={e.id}
                          className="sticky top-0 z-20 bg-muted/95 px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[110px]"
                          title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                        >
                          <div className="truncate max-w-[120px] mx-auto">{label}</div>
                          {sublabel && (
                            <div className="text-[9px] font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                          )}
                        </th>
                      );
                    })}
                    {/* Coverage header — sticky right */}
                    <th className="sticky top-0 right-0 z-30 bg-teal-50/95 dark:bg-teal-950/60 px-3 py-2 text-right font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-l border-border min-w-[80px]">
                      Coverage
                    </th>
                  </tr>

                  {/* ── Row 2: LATEST sub-header ── */}
                  <tr className="bg-teal-50/60 dark:bg-teal-950/20">
                    <td className="sticky top-0 left-0 z-30 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 text-[10px] font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-r border-border">
                      LATEST
                    </td>
                    {entityLatest.map((val, i) => (
                      <td
                        key={crEntities[i].id}
                        className="px-2 py-1.5 text-center text-[10px] font-semibold font-mono-num tabular-nums text-teal-700 dark:text-teal-300 border-b border-border"
                      >
                        {val != null
                          ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    <td className="sticky right-0 z-30 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-1.5 text-right text-[10px] font-bold text-teal-700 dark:text-teal-300 border-b border-l border-border tabular-nums">
                      {crEntities.length} entities
                    </td>
                  </tr>
                </thead>

                <tbody>
                  {[...crDates].reverse().map((date: string, di: number) => {
                    const isEven      = di % 2 === 0;
                    const rowVals     = crEntities.map((e: any) => crPivot.get(date)?.get(e.id) ?? null);
                    const reported    = rowVals.filter((v) => v != null).length;
                    const total       = crEntities.length;
                    const coveragePct = total > 0 ? Math.round((reported / total) * 100) : 0;
                    const coverageColor =
                      coveragePct === 100 ? 'text-emerald-600 dark:text-emerald-400' :
                      coveragePct >= 50   ? 'text-amber-600 dark:text-amber-400'    :
                                            'text-rose-500 dark:text-rose-400';

                    return (
                      <tr
                        key={date}
                        className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}
                      >
                        {/* Date cell */}
                        <td className={[
                          'sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border',
                          isEven ? 'bg-background' : 'bg-muted/10',
                        ].join(' ')}>
                          {format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}
                        </td>

                        {/* Entity cells */}
                        {rowVals.map((val, ei) => (
                          <td
                            key={crEntities[ei].id}
                            className="px-2 py-1.5 text-right font-mono-num tabular-nums border-border"
                            title={val != null ? `Raw meter reading: ${val.toLocaleString(undefined, { maximumFractionDigits: 3 })} m³` : undefined}
                          >
                            {val != null
                              ? <span className="text-foreground">{val.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}

                        {/* Coverage cell — sticky right */}
                        <td
                          className={[
                            'sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums text-[10px] border-l border-border',
                            isEven ? 'bg-background' : 'bg-muted/10',
                            coverageColor,
                          ].join(' ')}
                          title={`${reported} of ${total} entities reported on this date`}
                        >
                          {reported > 0 ? `${reported}/${total}` : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
          </div>
          )}
        </div>

        {/* ── Footer legend ── */}
        <div className="px-5 py-2 border-t shrink-0 flex items-center gap-4 text-[10px] text-muted-foreground bg-muted/20">
          {tab === 'both' && <><Activity className="h-3 w-3 text-primary" /> Production vs Consumption — daily totals (m³) · NRW % = (Prod − Cons) ÷ Prod</>}
          {tab === 'consumption' && <><Receipt className="h-3 w-3 text-highlight" /> Consumption — delta volume (m³) per locator · Current Readings — raw meter values per locator per day</>}
          {tab === 'production' && (
            useRoProd
              ? <><Droplet className="h-3 w-3 text-primary" /> Production — permeate_meter_delta (m³) per RO train · Current Readings — raw permeate meter per train per day</>
              : <><Droplet className="h-3 w-3 text-primary" /> Production — delta volume (m³) per product meter · Current Readings — raw meter values per meter per day</>
          )}
          {(tab === 'production' || tab === 'consumption') && estimatedKeys.size > 0 && (
            <span className="flex items-center gap-1 ml-3 text-amber-600 dark:text-amber-400">
              <span className="font-bold text-[10px]">~</span>
              Auto-estimated (Poly. Regression deg. 3) — hover cell for details
            </span>
          )}
          {tab === 'current' && (
            <><Gauge className="h-3 w-3 text-muted-foreground" /> Current Readings — latest raw meter value per entity per day (absolute, not delta)</>
          )}
          <span className="ml-auto">
            {tab === 'both' && `${(useRoProd ? roProdPivot : prodPivot).dates.length} days in range`}
            {tab === 'consumption' && `${entities.length} locators · ${dates.length} days`}
            {tab === 'production' && (
              useRoProd
                ? `${roProdPivot.entities.length} RO trains · ${roProdPivot.dates.length} days`
                : `${entities.length} meters · ${dates.length} days`
            )}
            {tab === 'current' && `${currentPivotData.entities.length} entities · ${currentPivotData.dates.length} days`}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

// ── Permeate production helpers ──────────────────────────────────────────────
// Returns the ISO date string (YYYY-MM-DD, local) that a permeate reading
// should be attributed to, honouring the optional daily cut-off time.
//
// Rule: readings at or before the cut-off time on date D belong to day D.
// Readings AFTER the cut-off on date D belong to day D+1.
// When cutoff is disabled (or null) the natural calendar date is used.
//
// Example (cutoff 00:20):
//   May 4 00:05  → May 4  (before cut-off, still "today")
//   May 4 00:21  → May 5  (after cut-off, first reading of next day's period)
//   May 3 23:00  → May 4  wait — that's wrong. Let me re-read the rule.
// Correct rule from UI: "May 4 = readings from May 3 00:21 to May 4 00:20"


export default function Dashboard() {
  // Use fine-grained selectors so Dashboard only re-renders when selectedPlantId
  // changes — NOT when addAlerts updates plantAlerts in the store.
  // Without selectors, every addAlerts() call would re-render Dashboard →
  // re-run the useEffect → call addAlerts() again → infinite loop (React #185).
  const selectedPlantId = useAppStore((s) => s.selectedPlantId);
  const addAlerts       = useAppStore((s) => s.addAlerts);
  const removeAlerts    = useAppStore((s) => s.removeAlerts);
  const { data: plants } = usePlants();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // ── Enhancement ⑥: open incident count for the compliance badge ───────────
  const { data: openIncidentCount = 0 } = useQuery<number>({
    queryKey: ['open-incidents-count', selectedPlantId],
    queryFn: async () => {
      let q = supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Open');
      if (selectedPlantId) q = (q as any).eq('plant_id', selectedPlantId);
      const { count } = await q;
      return count ?? 0;
    },
    staleTime: 2 * 60_000,
  });

  // View mode controls how trend graphs surface on the dashboard.
  // See `components/dashboard/types.ts` for definitions. Lazy-init
  // from localStorage so the user's preference survives reload
  // without a flash of "inline".
  // Default to 'sections' so clicking a KPI card expands its chart inline.
  // Falls back to whatever was saved in localStorage from a previous visit.
  const [viewMode, setViewMode] = useState<DashboardViewMode>(() => {
    try {
      const v = window.localStorage.getItem(VIEW_MODE_KEY) as DashboardViewMode | null;
      if (v === 'inline' || v === 'sections' || v === 'popup') return v;
    } catch { /* Safari private / quota */ }
    return 'sections';
  });
  // In `sections` mode, this holds the metric key whose chart is
  // currently fold-open. Single-open behaviour — clicking another KPI
  // auto-collapses the previous. `inline` mode shows everything;
  // `popup` mode never sets this (it routes through `modal` instead).
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const persistViewMode = (m: DashboardViewMode) => {
    setViewMode(m);
    setExpandedMetric(null);
    setModal(null);
    try { window.localStorage.setItem(VIEW_MODE_KEY, m); } catch (err) {
      // Safari private mode / quota errors — view-mode just won't persist.
      // eslint-disable-next-line no-console
      console.warn('[Dashboard] could not persist view mode preference:', err);
    }
  };
  // Returns the click handler for chart-bearing KPI cards. Behaviour:
  //   • sections → toggle this metric's collapsible chart (single-open, default)
  //   • popup    → open the TrendModal in a dialog
  //   • inline   → auto-switch to sections mode and expand the clicked metric
  //                (inline already shows charts; clicking gives a focused view)
  const handleMetricClick = (metric: string, title: string): (() => void) => {
    return () => {
      if (viewMode === 'sections') {
        setExpandedMetric((prev) => (prev === metric ? null : metric));
      } else if (viewMode === 'popup') {
        setModal({ metric, title });
      } else {
        // inline → switch to sections so the chart collapses into a focused view
        persistViewMode('sections');
        setExpandedMetric(metric);
      }
    };
  };

  const visiblePlants = useMemo(
    () => (selectedPlantId ? plants?.filter((p) => p.id === selectedPlantId) : plants),
    [plants, selectedPlantId],
  );
  const plantIds = visiblePlants?.map((p) => p.id) ?? [];

  // Bug 4 fix: build today/yesterday boundaries in UTC using the local calendar date,
  // so that readings entered at e.g. 08:00 PST (= 00:00 UTC) are not pushed into yesterday.
  // We construct YYYY-MM-DD from local time and then parse it as a UTC midnight to avoid
  // the double-offset problem that startOfDay(new Date()).toISOString() causes in UTC+8.
  const _localDateStr = format(new Date(), 'yyyy-MM-dd');          // local calendar date
  const _yesterdayKey = format(subDays(new Date(), 1), 'yyyy-MM-dd'); // promoted here so permeate queries can use it
  const today     = new Date(_localDateStr + 'T00:00:00').toISOString();   // local midnight → ISO
  const yesterday = new Date(format(subDays(new Date(), 1), 'yyyy-MM-dd') + 'T00:00:00').toISOString();

  // ----- Today aggregates from raw tables -----
  //
  // IMPORTANT: locator_readings and well_readings do NOT have a plant_id column.
  // Filtering them with .in('plant_id', plantIds) returns zero rows — which is
  // why the stat cards were showing 0 m³. We must first resolve the entity IDs
  // (locator_id / well_id) for this plant, then query by those IDs.

  const { data: _locatorIds } = useQuery({
    queryKey: ['dash-locator-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data } = await supabase
        .from('locators').select('id').in('plant_id', plantIds).eq('status', 'Active');
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: plantIds.length > 0,
  });

  const { data: _wellIds } = useQuery({
    queryKey: ['dash-well-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data } = await supabase.from('wells').select('id').in('plant_id', plantIds);
      return (data ?? []).map((w: any) => w.id as string);
    },
    enabled: plantIds.length > 0,
  });

  const { data: todayLocators } = useQuery({
    queryKey: ['dash-loc-today', _locatorIds, today],
    queryFn: async () => {
      if (!_locatorIds?.length) return [];
      // FIX: Added .lte upper bound so the query is strictly scoped to the
      // current calendar day. Without it, any reading timestamped after
      // midnight (e.g. timezone drift, future-dated rows) would be included
      // and computePivotFromReadings would treat the full cumulative meter
      // value as a single-day delta — producing the "-898,003" spike seen
      // in the Prod. vs Consum. tab.
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', _locatorIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: (_locatorIds?.length ?? 0) > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  const { data: todayWells } = useQuery({
    queryKey: ['dash-wells-today', _wellIds, today],
    queryFn: async () => {
      if (!_wellIds?.length) return [];
      // FIX: Bounded to current calendar day — mirrors the todayLocators fix.
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      // Try to fetch quality columns (tds_ppm, turbidity_ntu) — these are optional
      // migration columns that may not exist in all environments yet. Fall back to
      // base columns only if PostgREST returns a schema-cache error.
      const { data, error } = await (supabase
        .from('well_readings') as any)
        .select('well_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,tds_ppm,turbidity_ntu')
        .in('well_id', _wellIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (!error) return (data ?? []) as any[];
      // Fallback: base columns without quality fields
      const { data: fallback } = await supabase
        .from('well_readings')
        .select('well_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', _wellIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      return (fallback ?? []) as any[];
    },
    enabled: (_wellIds?.length ?? 0) > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // Production = sum of Product Meter deltas (treated/distributed water)
  const { data: todayProductMeters } = useQuery({
    queryKey: ['dash-product-meters-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters } = await (supabase.from('product_meters' as any) as any)
        .select('id').in('plant_id', plantIds);
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) return [];
      // FIX: Bounded to current calendar day — mirrors the todayLocators fix.
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // ── Plant meter configs — detect which plants use RO permeate as production ──
  // When permeate_is_production=true the permeate meter delta in ro_train_readings
  // IS the production figure; those rows must be included in the Dashboard production
  // total and the NRW / PV-ratio calculations that depend on it.
  //
  // FIX: Select permeate_is_production as a direct column (mirrors DataSummaryModal)
  // in addition to the config JSONB blob. The original query only read the blob and
  // checked row.config?.permeate_is_production which was undefined when the flag is
  // stored as a real column, causing permeateProductionPlantIds to always be empty.
  const { data: plantMeterConfigs } = useQuery({
    queryKey: ['dash-plant-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000, // config rarely changes — cache for 1 min
  });

  // Plant IDs that use the RO permeate meter as their production source.
  // Checks all three possible locations where the flag can be stored:
  //   1. Top-level column  permeate_is_production (primary — matches DataSummaryModal)
  //   2. JSONB config blob config.permeate_is_production (legacy path)
  //   3. JSONB config blob config.ro_production_source === 'permeate' (Plants.tsx radio)
  const permeateProductionPlantIds = useMemo(() => {
    return (plantMeterConfigs ?? [])
      .filter((row: any) =>
        row.permeate_is_production === true ||
        row.config?.permeate_is_production === true ||
        row.config?.ro_production_source === 'permeate'
      )
      .map((row: any) => row.plant_id as string);
  }, [plantMeterConfigs]);

  // ── Step 1: Resolve RO train IDs for permeate-production plants ─────────────
  // CRITICAL FIX (mirrors TrendChart.tsx line 1070):
  // ro_train_readings does NOT have a plant_id column. Querying it with
  // .in('plant_id', ...) always returns 0 rows — the root cause of Production
  // Volume showing 0 despite permeate data existing. Must first resolve train IDs
  // from ro_trains, then filter ro_train_readings by train_id.
  const { data: _permeateTrainMeta } = useQuery({
    queryKey: ['dash-permeate-train-ids', permeateProductionPlantIds],
    queryFn: async () => {
      if (!permeateProductionPlantIds.length) return { ids: [] as string[], trainPlantMap: new Map<string, string>() };
      const { data } = await supabase
        .from('ro_trains')
        .select('id, plant_id')
        .in('plant_id', permeateProductionPlantIds);
      const rows = data ?? [];
      const trainPlantMap = new Map<string, string>();
      rows.forEach((t: any) => trainPlantMap.set(t.id as string, t.plant_id as string));
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap };
    },
    enabled: permeateProductionPlantIds.length > 0,
    staleTime: 60_000,
  });
  const _permeateTrainIds      = _permeateTrainMeta?.ids ?? [];
  const _permeateTrainPlantMap = _permeateTrainMeta?.trainPlantMap ?? new Map<string, string>();

  // ── Step 2: Fetch today's permeate readings filtered by train_id ─────────────
  const { data: todayRoPermeate } = useQuery({
    queryKey: ['dash-ro-permeate-today', _permeateTrainIds, _localDateStr],
    queryFn: async () => {
      if (!_permeateTrainIds.length) return [] as any[];
      const windowStart = new Date(_localDateStr + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', _permeateTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      // Attach plant_id via the trainPlantMap so downstream code can group by plant if needed
      return (data ?? []).map((r: any) => ({
        ...r,
        plant_id: _permeateTrainPlantMap.get(r.train_id) ?? null,
      }));
    },
    enabled: _permeateTrainIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // Yesterday's RO permeate — same two-step pattern.
  const _dayBeforeYesterdayKey = useMemo(
    () => format(subDays(new Date(_yesterdayKey), 1), 'yyyy-MM-dd'),
    [_yesterdayKey],
  );
  const { data: yRoPermeate } = useQuery({
    queryKey: ['dash-ro-permeate-yest', _permeateTrainIds, _yesterdayKey],
    queryFn: async () => {
      if (!_permeateTrainIds.length) return [] as any[];
      const windowStart = new Date(_yesterdayKey + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_yesterdayKey + 'T23:59:59').toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', _permeateTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      return (data ?? []).map((r: any) => ({
        ...r,
        plant_id: _permeateTrainPlantMap.get(r.train_id) ?? null,
      }));
    },
    enabled: _permeateTrainIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // Power readings — today first, fall back to most-recent per plant if today is empty.
  // powerIsStale is set when the displayed value came from a prior day.
  // Fetches raw meter fields (meter_reading_kwh, grid_meter_readings) so the kWh stat
  // can be computed from raw readings first — matching the "Last 7 readings" panel
  // instead of relying on the potentially-stale stored daily_consumption_kwh.
  const { data: todayPowerRaw } = useQuery({
    queryKey: ['dash-power-today', plantIds, today],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], prevRows: [] as any[], isStale: false };
      const { data: todayData } = await supabase
        .from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds)
        .gte('reading_datetime', today);
      // Fetch the most-recent row BEFORE today for each plant (delta baseline)
      const prevRows: any[] = [];
      await Promise.all(plantIds.map(async (pid) => {
        const { data } = await supabase
          .from('power_readings')
          .select('meter_reading_kwh,grid_meter_readings,plant_id,reading_datetime')
          .eq('plant_id', pid).lt('reading_datetime', today)
          .order('reading_datetime', { ascending: false }).limit(1);
        if (data?.[0]) prevRows.push(data[0]);
      }));
      if ((todayData ?? []).length) return { rows: todayData!, prevRows, isStale: false };
      // Fallback: latest reading per plant
      const { data: recent } = await supabase
        .from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds)
        .order('reading_datetime', { ascending: false })
        .limit(plantIds.length * 5);
      const latestByPlant = new Map<string, any>();
      (recent ?? []).forEach((r: any) => {
        if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r);
      });
      return { rows: Array.from(latestByPlant.values()), prevRows, isStale: true };
    },
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const todayPower   = todayPowerRaw?.rows ?? [];
  const powerIsStale = todayPowerRaw?.isStale ?? false;
  // Per-plant CT multiplier arrays — needed for kWh delta computation
  const { data: dashPowerConfigMap } = useQuery({
    queryKey: ['dash-power-config', plantIds],
    queryFn: async () => {
      const map = new Map<string, number[]>();
      try {
        const { data } = await (supabase.from('plant_power_config' as any) as any)
          .select('plant_id,grid_meter_multipliers').in('plant_id', plantIds);
        for (const cfg of (data ?? []) as any[]) {
          const mArr = cfg.grid_meter_multipliers;
          if (Array.isArray(mArr) && mArr.length > 0)
            map.set(cfg.plant_id, mArr.map((v: any) => +v > 0 ? +v : 1));
        }
      } catch { /* plant_power_config may not exist */ }
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 120_000,
  });
  // ----- Yesterday aggregates (for trend deltas on highlighted KPIs) -----
  const { data: yLocators } = useQuery({
    queryKey: ['dash-loc-yest', _locatorIds, yesterday, today],
    queryFn: async () => {
      if (!_locatorIds?.length) return [];
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', _locatorIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: (_locatorIds?.length ?? 0) > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const { data: yWells } = useQuery({
    queryKey: ['dash-wells-yest', _wellIds, yesterday, today],
    queryFn: async () => {
      if (!_wellIds?.length) return [];
      const { data } = await supabase
        .from('well_readings')
        .select('well_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', _wellIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: (_wellIds?.length ?? 0) > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // Yesterday product meters for production trend delta
  const { data: yProductMeters } = useQuery({
    queryKey: ['dash-product-meters-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters } = await (supabase.from('product_meters' as any) as any)
        .select('id').in('plant_id', plantIds);
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const { data: yPower } = useQuery({
    queryKey: ['dash-power-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], prevRows: [] as any[] };
      const { data: rows } = await supabase.from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today);
      // Fetch pre-yesterday baseline rows for delta computation
      const prevRows: any[] = [];
      await Promise.all(plantIds.map(async (pid) => {
        const { data } = await supabase.from('power_readings')
          .select('meter_reading_kwh,grid_meter_readings,plant_id,reading_datetime')
          .eq('plant_id', pid).lt('reading_datetime', yesterday)
          .order('reading_datetime', { ascending: false }).limit(1);
        if (data?.[0]) prevRows.push(data[0]);
      }));
      return { rows: rows ?? [], prevRows };
    },
    enabled: plantIds.length > 0,
  });
  // ── Step 1: Resolve all RO train IDs + metadata for the selected plants ─────
  // BUG FIX (same root cause as permeate path, line ~1007):
  // ro_train_readings does NOT have a plant_id column.  Any query that uses
  // .in('plant_id', plantIds) on that table returns 0 rows, which is why Feed
  // TDS, Product TDS, Recovery, and Raw NTU all showed "—" on the dashboard.
  // Fix: two-step query that mirrors the pattern already used by the permeate
  // production path (_permeateTrainMeta + todayRoPermeate above).
  //   Step 1 — resolve (train_id, plant_id, train_number) from ro_trains.
  //   Step 2 — query ro_train_readings filtered by train_id, then reattach
  //             plant_id and train_number from the lookup map.
  const { data: _qualityTrainMeta } = useQuery({
    queryKey: ['dash-quality-train-meta', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { ids: [] as string[], metaMap: new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null }>() };
      const { data } = await (supabase.from('ro_trains' as any) as any)
        .select('id, plant_id, train_number, name, well_id')
        .in('plant_id', plantIds);
      const rows = (data ?? []) as any[];
      const metaMap = new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null }>();
      rows.forEach((t: any) => metaMap.set(t.id as string, {
        plant_id:     t.plant_id,
        train_number: t.train_number ?? null,
        train_name:   t.name ?? null,
        well_id:      t.well_id ?? null,
      }));
      return { ids: rows.map((t: any) => t.id as string), metaMap };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });
  const _qualityTrainIds   = _qualityTrainMeta?.ids    ?? [];
  const _qualityTrainMeta2 = _qualityTrainMeta?.metaMap ?? new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null }>();

  // ── Well-name lookup for "PER WELL SOURCE" labels ────────────────────────────
  // Fetched once per plant selection. When an ro_trains row has well_id set,
  // roByTrain resolves the label as: well.name → train.name → RO{train_number}.
  const { data: _wellNamesByTrainWell } = useQuery({
    queryKey: ['dash-well-names-for-trains', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Map<string, string>();
      const { data } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((w: any) => map.set(w.id as string, w.name as string));
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });

  // ── Step 2: Fetch latest quality readings filtered by train_id ───────────────
  // Selects only the quality-relevant columns (no cumulative meter columns needed here).
  // Reattaches plant_id + train_number from the lookup map so roByTrain dedup and
  // PerWellSourceCard (plantCodeById) both work correctly.
  const { data: latestRO } = useQuery({
    queryKey: ['dash-ro-recent', _qualityTrainIds],
    queryFn: async () => {
      if (!_qualityTrainIds.length) return [] as any[];
      const since = subDays(new Date(), 1).toISOString();
      const { data, error } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_tds,feed_tds,dp_psi,recovery_pct,permeate_ph,turbidity_ntu,reading_datetime')
        .in('train_id', _qualityTrainIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`ro_train_readings (quality): ${error.message}`);
      // Reattach plant_id + train_number + train_name + well_id from the ro_trains
      // lookup so downstream consumers (roByTrain, PerWellSourceCard, expandRows) keep working.
      return (data ?? []).map((r: any) => {
        const meta = _qualityTrainMeta2.get(r.train_id);
        return {
          ...r,
          plant_id:     meta?.plant_id     ?? null,
          train_number: meta?.train_number ?? null,
          train_name:   meta?.train_name   ?? null,
          well_id:      meta?.well_id      ?? null,
        };
      });
    },
    enabled: _qualityTrainIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // ── Permeate fallback for production ─────────────────────────────────────────
  // When the selected plants have no product meter readings today AND are not
  // configured as permeate_is_production, the Production Volume card shows 0.
  // In that case the best available signal is the sum of today's permeate_meter_delta
  // across all RO trains — essentially "how much treated water left the membranes."
  // This query reuses _qualityTrainIds (already fetched for quality stats) and
  // is only enabled when needed (no product meters returned today).
  const productMetersHaveData = (todayProductMeters?.length ?? 0) > 0;
  const { data: todayAllPermeate } = useQuery({
    queryKey: ['dash-all-permeate-today', _qualityTrainIds, _localDateStr],
    queryFn: async () => {
      if (!_qualityTrainIds.length) return [] as any[];
      const windowStart = new Date(_localDateStr + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', _qualityTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      return (data ?? []) as any[];
    },
    // Only fetch when there are no product meter readings — avoids a redundant
    // round-trip when product meters are working correctly.
    enabled: !productMetersHaveData && _qualityTrainIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // ── FIX: StatCard cost sources now mirror TrendChart's productionCost computation ──
  // Previous: StatCard read production_costs.power_cost (stale legacy column)
  //           and production_costs.chem_cost only (missed chemical_dosing_logs).
  // Now:      Power cost  → power_tariffs.rate_per_kwh × kWh (same as chart)
  //           Chem cost   → production_costs.chem_cost + chemical_dosing_logs (same as chart)
  // If no row exists for today's date, fall back to the latest available row per
  // plant so the dashboard never displays ₱0 when real data exists.
  // `costDataDate` + `costIsStale` drive the "as of MMM d" badge in the cluster header.
  const { data: todayCostsRaw } = useQuery({
    queryKey: ['dash-costs-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return {
        rows: [] as any[], costDataDate: null as string | null,
        tariffByPlant: new Map<string, number>(), dashDosingPeso: 0,
      };
      const todayStr = format(new Date(), 'yyyy-MM-dd');

      // Fetch production_costs, power_tariffs, dosing logs, and chemical prices in parallel
      const [prodCostRes, tariffRes, dosingRes, pricesRes] = await Promise.all([
        supabase.from('production_costs')
          .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
          .in('plant_id', plantIds)
          .eq('cost_date', todayStr),
        // Latest effective tariff per plant (ordered DESC → first per plant = most recent ≤ today)
        supabase.from('power_tariffs')
          .select('plant_id,effective_date,rate_per_kwh')
          .in('plant_id', plantIds)
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
        // Today's dosing log entries (matches TrendChart's chemical cost accumulation)
        supabase.from('chemical_dosing_logs')
          .select('log_datetime,calculated_cost,plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg')
          .in('plant_id', plantIds)
          // FIX: use UTC ISO strings so timestamptz comparisons are correct for UTC+8
          .gte('log_datetime', new Date(todayStr + 'T00:00:00').toISOString())
          .lte('log_datetime', new Date(todayStr + 'T23:59:59').toISOString()),
        // Current prices for live fallback when calculated_cost is absent
        supabase.from('chemical_prices')
          .select('chemical_name,unit_price')
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
      ]);

      // Build tariff map: plant_id → latest ₱/kWh rate (results ordered DESC, first per plant wins)
      const tariffByPlant = new Map<string, number>();
      for (const t of (tariffRes.data ?? []) as any[]) {
        if (!tariffByPlant.has(t.plant_id)) tariffByPlant.set(t.plant_id, +t.rate_per_kwh);
      }

      // Chemical cost from dosing logs (mirrors TrendChart lines 1398–1410)
      // FIX: Also store the base chemical name without unit suffix so that names
      // stored as e.g. 'Chlorine (kg)' are found when DOSING_KEYS looks up 'Chlorine'.
      // This mirrors TrendChart's priceMap logic (same base-stripping) so stat card
      // and chart always use the same live fallback cost when calculated_cost = 0.
      const priceMap: Record<string, number> = {};
      for (const p of (pricesRes.data ?? []) as any[]) {
        if (!(p.chemical_name in priceMap)) priceMap[p.chemical_name] = +p.unit_price;
        const base = (p.chemical_name as string).replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(base in priceMap)) priceMap[base] = +p.unit_price;
      }
      const DOSING_KEYS = [
        { key: 'chlorine_kg',    name: 'Chlorine'     },
        { key: 'smbs_kg',        name: 'SMBS'         },
        { key: 'anti_scalant_l', name: 'Anti Scalant' },
        { key: 'soda_ash_kg',    name: 'Soda Ash'     },
      ];
      let dashDosingPeso = 0;
      for (const r of (dosingRes.data ?? []) as any[]) {
        const stored = +r.calculated_cost || 0;
        const live   = DOSING_KEYS.reduce((s, c) => s + (+r[c.key] || 0) * (priceMap[c.name] ?? 0), 0);
        dashDosingPeso += stored > 0 ? stored : live;
      }

      if ((prodCostRes.data ?? []).length) {
        return { rows: prodCostRes.data!, costDataDate: todayStr, tariffByPlant, dashDosingPeso };
      }
      // Fallback: latest cost row per plant
      const { data: recent } = await supabase
        .from('production_costs')
        .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
        .in('plant_id', plantIds)
        .order('cost_date', { ascending: false })
        .limit(plantIds.length * 3);
      const latestByPlant = new Map<string, any>();
      (recent ?? []).forEach((r: any) => {
        if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r);
      });
      const rows = Array.from(latestByPlant.values());
      return { rows, costDataDate: rows[0]?.cost_date ?? null, tariffByPlant, dashDosingPeso };
    },
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const todayCosts       = todayCostsRaw?.rows ?? [];
  const costDataDate     = todayCostsRaw?.costDataDate ?? null;
  const costIsStale      = costDataDate != null && costDataDate !== format(new Date(), 'yyyy-MM-dd');
  // Per-plant tariff rates and dosing ₱ total — consumed by computePowerKwh and chemCost below
  const dashTariffByPlant = todayCostsRaw?.tariffByPlant ?? new Map<string, number>();
  const dashDosingPeso    = todayCostsRaw?.dashDosingPeso ?? 0;
  // Latest daily summary fallback per plant (today first, else latest)
  const { data: dailySummary } = useQuery({
    queryKey: ['dash-summary-recent', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('daily_plant_summary').select('*').in('plant_id', plantIds)
          .order('summary_date', { ascending: false }).limit(plantIds.length * 5)).data ?? []
      : [],
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // ── Stat card aggregates ────────────────────────────────────────────────────
  // Uses computePivotFromReadings (same replacement-aware logic as TrendChart)
  // so meter-replacement spikes don't inflate today's totals.
  const _todayKey = format(new Date(), 'yyyy-MM-dd');
  // _yesterdayKey is defined earlier (line ~565) so the permeate-production queries can use it.

  const rawWaterVol = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(todayWells ?? [], 'well_id', 'daily_volume'), _todayKey,
  ), [todayWells, _todayKey]);

  // RO permeate contribution to production — applies cut-off bucketing and date-range
  // guard per plant before summing. Only readings whose attributed production date
  // equals the target day (today / yesterday) are included.
  // RO permeate production — uses simple local-date bucketing (same as Data Summary modal).
  // The old cutoff / displaceToNearestBoundary logic has been removed system-wide:
  // every reading is attributed to the calendar day it was actually recorded.
  // This matches the values shown in the Data Summary table exactly.
  const roPermeateProduction = useMemo(() =>
    (todayRoPermeate ?? []).reduce((s: number, r: any) => {
      const dateKey = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      if (dateKey !== _localDateStr) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0),
  [todayRoPermeate, _localDateStr]);

  const yRoPermeateProduction = useMemo(() =>
    (yRoPermeate ?? []).reduce((s: number, r: any) => {
      const dateKey = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      if (dateKey !== _yesterdayKey) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0),
  [yRoPermeate, _yesterdayKey]);

  // Production = product meter delta  +  RO permeate delta (permeate_is_production plants).
  // Fallback: when neither source has data today, sum permeate_meter_delta across
  // ALL trains for the selected plants — "how much treated water left the membranes."
  // This ensures the Production Volume card never shows 0 just because product meters
  // haven't been configured or haven't been read yet today.
  const production = useMemo(() => {
    // FIX: Use no-cache variant so the stat-card computation does not write
    // transient single-day deltas into deltaCache, which would be picked up
    // by DataSummaryModal's multi-day pivot and produce wrong totals.
    const meterTotal = pivotDayTotal(
      computePivotFromReadingsNoCache(todayProductMeters ?? [], 'meter_id', 'daily_volume'), _todayKey,
    );
    const combined = meterTotal + roPermeateProduction;
    if (combined > 0) return combined;

    // Fallback path: use permeate_meter_delta for trains NOT already counted via
    // the permeate_is_production path (to avoid double-counting).
    const fallbackTotal = (todayAllPermeate ?? []).reduce((s: number, r: any) => {
      const trainPlantId = _qualityTrainMeta2.get(r.train_id)?.plant_id;
      // Skip trains already included in roPermeateProduction
      if (trainPlantId && permeateProductionPlantIds.includes(trainPlantId)) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0);
    return fallbackTotal;
  }, [todayProductMeters, _todayKey, roPermeateProduction, todayAllPermeate, _qualityTrainMeta2, permeateProductionPlantIds]);

  const consumption = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(todayLocators ?? [], 'locator_id', 'daily_volume'), _todayKey,
  ), [todayLocators, _todayKey]);

  // Compute daily grid kWh from raw meter readings. Priority order mirrors TrendChart exactly:
  //   1. Raw JSONB multi-meter delta × per-meter CT multiplier
  //   2. Single-meter delta × multArr[0]
  //   3. daily_grid_kwh   (already post-multiplication — use as-is)
  //   4. daily_consumption_kwh × multArr[0]  (raw delta; mult must be applied)
  // FIX: Previously priorities 3 & 4 were swapped AND daily_consumption_kwh was used
  // without the CT multiplier, causing the StatCard to show e.g. 8 kWh / ₱86 when
  // the chart (which applies the multiplier correctly) shows the actual 19,200 kWh.
  // Both paths now share identical logic so StatCard and chart always agree.
  // Also returns powerCostPeso = kWh × tariff (same formula as chart) when
  // tariffByPlant is supplied.
  function computePowerKwh(
    currentRows: any[],
    prevRows: any[],
    configMap: Map<string, number[]> | undefined,
    tariffByPlant?: Map<string, number>, // per-plant ₱/kWh rate from power_tariffs
  ): { kwh: number; powerCostPeso: number | null } {
    const prevByPlant = new Map<string, any>();
    for (const p of prevRows) prevByPlant.set(p.plant_id, p);
    let totalKwh = 0;
    let totalCostPeso = 0;
    let hasTariff = false;
    for (const r of currentRows) {
      if (r.is_meter_replacement) continue;
      const pid      = r.plant_id;
      const prev     = prevByPlant.get(pid);
      const multArr  = configMap?.get(pid) ?? [1];
      const rGmr     = r.grid_meter_readings as Record<string, number> | null | undefined;
      const pGmr     = prev?.grid_meter_readings as Record<string, number> | null | undefined;
      let kwh = 0;
      // FIX: Track whether we had raw meter data to compute a delta from.
      // When a raw delta IS computable but comes out negative (meter anomaly / rollover),
      // the chart treats the reading as invalid (gridKwh < 0 → skipped, no fallback).
      // The stat card must mirror that: only use the stored daily_consumption_kwh fallback
      // when no raw baseline existed at all, NOT when the delta was computed but negative.
      // This prevents a stale/partial daily_consumption_kwh from inflating cost when the
      // operator's cumulative meter reading regressed (e.g. a wrong value entered today).
      let rawDeltaAttempted = false;

      if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
        // Priority 1: multi-meter JSONB delta × per-meter CT multiplier
        rawDeltaAttempted = true;
        let sum = 0;
        for (const k of Object.keys(rGmr)) {
          const mi    = parseInt(k, 10);
          const mMult = multArr[mi] ?? multArr[0] ?? 1;
          if (pGmr[k] != null) sum += (rGmr[k] - pGmr[k]) * mMult;
        }
        if (sum >= 0) kwh = sum;
      } else if (prev?.meter_reading_kwh != null && r.meter_reading_kwh != null) {
        // Priority 2: single-meter delta × multiplierArr[0]
        rawDeltaAttempted = true;
        const delta = +r.meter_reading_kwh - +prev.meter_reading_kwh;
        if (delta >= 0) kwh = delta * (multArr[0] ?? 1);
      }

      // Priority 3 & 4: stored daily totals — fallback ONLY when no raw readings were
      // available (rawDeltaAttempted = false).  Do NOT use when the delta was computable
      // but negative: that indicates a meter anomaly and must show '—', same as the chart.
      // Order mirrors TrendChart (lines 1933-1937):
      //   • daily_grid_kwh        — stored post-multiplication (already × CT ratio). Use as-is.
      //   • daily_consumption_kwh — stored as the raw meter delta (NOT multiplied at save time,
      //                             e.g. Δ = 8 while actual = 8 × 2400 = 19,200 kWh).
      //                             Must apply multArr[0] to match the chart's computation and
      //                             the Operations "Last 7 readings" panel.
      if (kwh === 0 && !rawDeltaAttempted) {
        if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
          kwh = +r.daily_grid_kwh;
        else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
          kwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
      }
      totalKwh += kwh;

      // Accumulate ₱ cost per plant: kWh × tariff rate (same formula as chart)
      const rate = tariffByPlant?.get(pid) ?? null;
      if (rate != null && kwh > 0) {
        totalCostPeso += kwh * rate;
        hasTariff = true;
      }
    }
    return { kwh: totalKwh, powerCostPeso: hasTariff ? totalCostPeso : null };
  }

  const { kwh, powerCostPeso: todayPowerCostPeso } = computePowerKwh(
    todayPower, todayPowerRaw?.prevRows ?? [], dashPowerConfigMap, dashTariffByPlant,
  );

  // NRW uses Production (product meter output) vs Consumption (locator billed)
  const nrw = calc.nrw(production, consumption);
  const pv = calc.pvRatio(kwh, production);

  const yRawWaterVol = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(yWells ?? [], 'well_id', 'daily_volume'), _yesterdayKey,
  ), [yWells, _yesterdayKey]);

  const yProduction = useMemo(() =>
    pivotDayTotal(
      // FIX: Use no-cache variant — see production useMemo comment above.
      computePivotFromReadingsNoCache(yProductMeters ?? [], 'meter_id', 'daily_volume'), _yesterdayKey,
    ) + yRoPermeateProduction,
  [yProductMeters, _yesterdayKey, yRoPermeateProduction]);

  const yConsumption = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(yLocators ?? [], 'locator_id', 'daily_volume'), _yesterdayKey,
  ), [yLocators, _yesterdayKey]);

  const { kwh: yKwh } = computePowerKwh(yPower?.rows ?? [], yPower?.prevRows ?? [], dashPowerConfigMap);
  const dProduction = pctDelta(production, yProduction);
  const dConsumption = pctDelta(consumption, yConsumption);
  const dRawWater = pctDelta(rawWaterVol, yRawWaterVol);
  const dKwh = pctDelta(kwh, yKwh);
  const yNrw = calc.nrw(yProduction, yConsumption);

  const nrwBreached = nrw != null && nrw > 10;
  // Bug 5: RO averages are now computed after roByTrain useMemo below (deduped per train).

  // Per-train latest snapshot — group `latestRO` by (plant_id, train_number)
  // and keep the most recent row per train (the query is already ordered
  // reading_datetime DESC, so the first row we encounter per key wins).
  // Used by the "Raw TDS / Raw NTU per train" breakdown lists in Quality.
  // Note: TDS and NTU are recorded at the RO-train level in this schema,
  // not the well level — we surface them here labelled as "Train N" with
  // the plant code so the user knows what they're looking at.
  const roByTrain = useMemo(() => {
    const seen = new Set<string>();
    const rows: any[] = [];
    (latestRO as any[] | undefined ?? []).forEach((r) => {
      const key = `${r.plant_id}__${r.train_number ?? '?'}`;
      if (seen.has(key)) return;
      seen.add(key);
      // Label priority: linked well name → ro_trains.name → RO{train_number}.
      // Well name is only available once _wellNamesByTrainWell has loaded; until
      // then the row renders with train_name and updates on the next memo run.
      const wellName = r.well_id ? (_wellNamesByTrainWell?.get(r.well_id) ?? null) : null;
      rows.push({ ...r, train_name: wellName ?? r.train_name });
    });
    rows.sort((a, b) => {
      // Sort by plant_id then train_number for stable rendering across re-renders.
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return (a.train_number ?? 0) - (b.train_number ?? 0);
    });
    return rows;
  }, [latestRO, _wellNamesByTrainWell]);

  // ── wellsByQuality ─────────────────────────────────────────────────────────
  // Per-well quality snapshot derived from todayWells (well_readings.tds_ppm /
  // turbidity_ntu). These drive the "PER WELL SOURCE" Raw TDS and Raw NTU cards
  // so the names and values match exactly what operators enter in Operations.
  // Deduplication: latest reading per well (todayWells is ordered ASC so last = latest).
  const wellsByQuality = useMemo(() => {
    const latestByWell = new Map<string, any>();
    (todayWells as any[] | undefined ?? []).forEach((r) => {
      // Keep overwriting — last entry per well_id is the most recent (ASC order).
      if (r.tds_ppm != null || r.turbidity_ntu != null) {
        latestByWell.set(r.well_id as string, r);
      }
    });
    const rows: any[] = [];
    latestByWell.forEach((r) => {
      const wellName = _wellNamesByTrainWell?.get(r.well_id as string) ?? null;
      rows.push({
        ...r,
        // Alias well_id so PerWellSourceCard key logic uses it
        well_id: r.well_id,
        // Map well name into train_name so the shared PerWellSourceCard rowLabel works
        train_name: wellName ?? `Well ${String(r.well_id).slice(-4)}`,
      });
    });
    rows.sort((a, b) => {
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return String(a.train_name).localeCompare(String(b.train_name));
    });
    return rows;
  }, [todayWells, _wellNamesByTrainWell]);

  // Bug 5 fix: recompute RO averages from deduplicated roByTrain so trains with more
  // readings per 24h window don't inflate/skew the aggregate values.
  const avgPermTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.permeate_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgFeedTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.feed_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgRecovery = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.recovery_pct ?? 0), 0) / roByTrain.length).toFixed(1)
    : null;
  const avgTurb = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / roByTrain.length).toFixed(2)
    : null;

  // Per-well raw water quality averages — sourced from well_readings (entered in
  // Operations) rather than ro_train_readings so names and values match Operations.
  const wellsWithTds  = wellsByQuality.filter((r) => r.tds_ppm != null);
  const wellsWithNtu  = wellsByQuality.filter((r) => r.turbidity_ntu != null);
  const avgRawTds = wellsWithTds.length
    ? +(wellsWithTds.reduce((s, r) => s + (r.tds_ppm ?? 0), 0) / wellsWithTds.length).toFixed(0)
    : null;
  const avgRawTurb = wellsWithNtu.length
    ? +(wellsWithNtu.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / wellsWithNtu.length).toFixed(2)
    : null;
  // Lookup helper for plant codes inside per-train rows. Falls back to the
  // raw plant_id when the plant list hasn't loaded yet so we never render
  // a blank label.
  const plantCodeById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.code ?? p.name ?? p.id));
    return m;
  }, [plants]);

  // ── Cost aggregates (aligned with TrendChart productionCost computation) ──────
  // Power cost:  kwh × tariff rate (from power_tariffs — same formula as chart)
  //              was: production_costs.power_cost (stale legacy column the chart ignores)
  // Chemical:    production_costs.chem_cost (today only) + today's chemical_dosing_logs
  //              was: production_costs.chem_cost only (missed dosing log entries)
  // Show '—' when no data has ever been entered (both sources empty) to avoid ₱0 mislead.
  //
  // IMPORTANT: When costIsStale (fallback row is from a prior date), we deliberately
  // skip production_costs.chem_cost because that row's value belongs to a different day.
  // Today's chemical cost is then sourced from dashDosingPeso (today's dosing logs) only.
  // This prevents stale/accumulated chem_cost values from inflating the stat card total.
  const hasCostData = todayCosts.length > 0;

  // Chemical cost: only include production_costs.chem_cost when the row is for TODAY.
  // Stale fallback rows are excluded — their chem_cost belongs to a prior day's total.
  const prodCostsChem = costIsStale
    ? 0
    : todayCosts.reduce((s, r: any) => s + (+r.chem_cost || 0), 0);
  const chemCostTotal = prodCostsChem + dashDosingPeso;
  const chemCost      = (chemCostTotal > 0) ? chemCostTotal
    : hasCostData ? null  // row exists but all-zero — still show '—'
    : null;

  // Power cost: todayPowerCostPeso is from computePowerKwh (kwh × tariff per plant).
  // Falls back to null when no tariff rate has been configured yet.
  const powerCost = todayPowerCostPeso != null ? +todayPowerCostPeso.toFixed(0) : null;

  // Total: show when at least one component is available
  const productionCost = (chemCost != null || powerCost != null)
    ? (chemCost ?? 0) + (powerCost ?? 0)
    : null;

  // Pull latest daily_plant_summary per plant (for blending, downtime, raw water)
  const latestPerPlant = useMemo(() => {
    const m = new Map<string, any>();
    (dailySummary ?? []).forEach((r: any) => { if (!m.has(r.plant_id)) m.set(r.plant_id, r); });
    return Array.from(m.values());
  }, [dailySummary]);
  const blending = latestPerPlant.reduce((s, r: any) => s + (+r.blending_m3 || 0), 0);
  const rawWater = latestPerPlant.reduce((s, r: any) => s + (+r.raw_water_consumption_m3 || 0), 0);



  const { data: chemInv } = useQuery({
    queryKey: ['dash-chem', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('chemical_inventory').select('*').in('plant_id', plantIds)).data ?? []
      : [],
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  const trainGaps = useTrainAutoOffline(plantIds);

  // Legacy RO/chem alerts (still useful, live-computed)
  const localAlerts: { tone: 'danger' | 'warn'; text: string }[] = [];
  trainGaps.forEach((g) => localAlerts.push({ tone: 'warn', text: `Train ${g.train_number} no reading ${g.hours_gap.toFixed(1)}h — auto-flagged Offline` }));
  // Collapse to latest-per-train before local alert banners (same reason as useEffect)
  const _localROPerTrain = new Map<string, any>();
  (latestRO ?? []).forEach((r: any) => {
    const k = String(r.train_id ?? r.train_number ?? 'unknown');
    if (!_localROPerTrain.has(k)) _localROPerTrain.set(k, r);
  });
  _localROPerTrain.forEach((r: any) => {
    if (r.dp_psi > 40)                localAlerts.push({ tone: 'danger', text: `DP alert: ${r.dp_psi} psi` });
    else if (r.dp_psi >= 35)          localAlerts.push({ tone: 'warn',   text: `DP approaching limit: ${r.dp_psi} psi` });
    if (r.permeate_tds >= 600)        localAlerts.push({ tone: 'danger', text: `TDS alert: ${r.permeate_tds} ppm` });
    else if (r.permeate_tds >= 500)   localAlerts.push({ tone: 'warn',   text: `TDS approaching limit: ${r.permeate_tds} ppm` });
    if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) localAlerts.push({ tone: 'warn', text: `pH out of range: ${r.permeate_ph}` });
    if (r.recovery_pct != null && r.recovery_pct < 70) localAlerts.push({ tone: 'warn', text: `Low recovery: ${r.recovery_pct.toFixed(1)}%` });
  });
  (chemInv ?? []).forEach((c: any) => {
    if (c.current_stock < c.low_stock_threshold) localAlerts.push({ tone: 'warn', text: `Low stock: ${c.chemical_name}` });
  });

  // Unified alerts feed (downtime / blending / recovery) served from backend
  const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
  const { data: feed } = useQuery<{ count: number; alerts: any[] }>({
    queryKey: ['alerts-feed', selectedPlantId],
    queryFn: async () => {
      try {
        const qs = new URLSearchParams({ days: '30' });
        if (selectedPlantId) qs.set('plant_id', selectedPlantId);
        const res = await fetch(`${BASE}/api/alerts/feed?${qs.toString()}`);
        if (!res.ok) return { count: 0, alerts: [] };
        return res.json();
      } catch {
        return { count: 0, alerts: [] };
      }
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // Memoised so the `?? []` fallback doesn't produce a new array reference on
  // every render — which would re-fire the alert-push useEffect each tick.
  const feedAlerts = useMemo(() => feed?.alerts ?? [], [feed]);

  // ── Push all live alerts into the TopBar notification bell ─────────────────
  // Converts trainGap / RO quality / low-stock / feed alerts into PlantAlert
  // objects and upserts them into the global Zustand store.  TopBar reads the
  // store and shows each alert in the bell dropdown with the plant name
  // prefixed — visible to multi-plant users so they know which site fired.
  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  useEffect(() => {
    const storeAlerts: PlantAlert[] = [];

    // Train gap warnings — plant_id comes from TrainGap directly
    trainGaps.forEach((g) => {
      storeAlerts.push({
        id:          `train-gap-${g.train_id}`,
        severity:    'warning',
        title:       `Train ${g.train_number} — no reading`,
        description: `No reading in ${g.hours_gap.toFixed(1)}h — auto-flagged Offline`,
        source:      'RO Trains',
        plantId:     g.plant_id,
        timestamp:   Date.now(),
      });
    });

    // NRW threshold alert — fired when today's NRW exceeds the 10% limit
    if (nrwBreached && nrw != null) {
      storeAlerts.push({
        id:          'nrw-threshold',
        severity:    'critical',
        title:       `NRW Water Loss: ${nrw}%`,
        description: `Non-revenue water is above the 10% threshold — inspect for leaks or meter inaccuracies.`,
        source:      'NRW',
        plantId:     selectedPlantId ?? '',
        timestamp:   Date.now(),
      });
    } else {
      // NRW is back within range — clear any previous NRW alert automatically
      removeAlerts(['nrw-threshold']);
    }

    // RO quality threshold alerts — latestRO returns ALL readings in the past
    // 24 h (ordered DESC), so we must first collapse to ONE row per train_id
    // (the most-recent reading) before generating alerts. Without this step
    // every historical reading for a train would produce its own duplicate alert.
    const latestPerTrain = new Map<string, any>();
    (latestRO ?? []).forEach((r: any) => {
      const key = String(r.train_id ?? r.train_number ?? 'unknown');
      if (!latestPerTrain.has(key)) latestPerTrain.set(key, r); // first = most recent (query ordered DESC)
    });

    // DP: critical if > 40 psi, warning if 35–40 psi (approaching limit)
    // TDS: critical if >= 600 ppm, warning if 500–599 ppm
    // Recovery: warning if < 70%
    latestPerTrain.forEach((r: any) => {
      const pid        = r.plant_id ?? selectedPlantId ?? '';
      const trainLabel = r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : 'Train');
      const dp = r.dp_psi ?? 0;
      if (dp > 40) {
        storeAlerts.push({
          id:          `dp-${r.train_id}-${r.train_number}`,
          severity:    'critical',
          title:       `DP alert: ${dp} psi`,
          description: `${trainLabel} — differential pressure above 40 psi (current: ${dp} psi)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
        });
      } else if (dp >= 35) {
        storeAlerts.push({
          id:          `dp-warn-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `DP approaching limit: ${dp} psi`,
          description: `${trainLabel} — differential pressure at ${dp} psi (limit: 40 psi)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
        });
      }
      const tds = r.permeate_tds ?? 0;
      if (tds >= 600) {
        storeAlerts.push({
          id:          `tds-${r.train_id}-${r.train_number}`,
          severity:    'critical',
          title:       `TDS alert: ${tds} ppm`,
          description: `${trainLabel} — permeate TDS exceeded 600 ppm`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
        });
      } else if (tds >= 500) {
        storeAlerts.push({
          id:          `tds-warn-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `TDS approaching limit: ${tds} ppm`,
          description: `${trainLabel} — permeate TDS at ${tds} ppm (limit: 600 ppm)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
        });
      }
      if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) {
        storeAlerts.push({
          id:          `ph-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `pH out of range: ${r.permeate_ph}`,
          description: `${trainLabel} — pH outside 6.5–8.5 safe range`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
        });
      }
      if (r.recovery_pct != null && r.recovery_pct < 70) {
        storeAlerts.push({
          id:          `recovery-${r.train_id}-${r.train_number}`,
          severity:    'warning',
          title:       `Low recovery: ${r.recovery_pct.toFixed(1)}%`,
          description: `${trainLabel} — recovery rate below 70% (current: ${r.recovery_pct.toFixed(1)}%)`,
          source:      'RO Trains',
          plantId:     pid,
          timestamp:   Date.now(),
        });
      }
    });

    // Low chemical stock
    (chemInv ?? []).forEach((c: any) => {
      if ((c.current_stock ?? 0) < (c.low_stock_threshold ?? 0)) {
        storeAlerts.push({
          id:          `stock-${c.id}`,
          severity:    'warning',
          title:       `Low stock: ${c.chemical_name}`,
          description: `Current: ${c.current_stock} ${c.unit ?? ''} — below threshold ${c.low_stock_threshold}`,
          source:      'Chemical Inventory',
          plantId:     c.plant_id ?? selectedPlantId ?? '',
          timestamp:   Date.now(),
        });
      }
    });

    // Backend feed alerts (downtime / blending / recovery)
    feedAlerts.forEach((a: any, i: number) => {
      storeAlerts.push({
        id:          `feed-${a.kind ?? 'alert'}-${i}-${a.title}`,
        severity:    a.severity === 'high' ? 'critical' : a.severity === 'medium' ? 'warning' : 'info',
        title:       a.title ?? 'Alert',
        description: a.detail ?? '',
        source:      a.kind === 'downtime' ? 'Downtime' : a.kind === 'blending' ? 'Blending' : 'Recovery',
        plantId:     a.plant_id ?? selectedPlantId ?? '',
        timestamp:   a.date ? new Date(a.date).getTime() : Date.now(),
      });
    });

    // Deduplicate storeAlerts by ID — keep last write (most severe value wins
    // if the same key was pushed more than once by different code paths).
    if (storeAlerts.length > 0) {
      const dedupedMap = new Map<string, PlantAlert>();
      storeAlerts.forEach((a) => dedupedMap.set(a.id, a));
      addAlerts(Array.from(dedupedMap.values()));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainGaps, latestRO, chemInv, feedAlerts, selectedPlantId, nrw, nrwBreached]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2 sm:space-y-3 animate-fade-in">
      {/* ① Plant health strip — per-plant status dots + last reading time */}
      <PlantHealthStrip plantIds={plantIds} />

      {/* Header — always a single row: title left, view-toggle right */}
      <div className="flex flex-row items-center justify-between gap-2">

        {/* Left: title + compliance badge + subtitle */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight leading-none">Dashboard</h1>
            {/* ⑥ Open incidents badge */}
            {openIncidentCount > 0 && (
              <button
                onClick={() => navigate('/incidents')}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-soft text-danger border border-danger/20 text-[10px] font-semibold hover:bg-danger/10 transition-colors"
                title={`${openIncidentCount} open incident${openIncidentCount > 1 ? 's' : ''} — click to view`}
              >
                <ShieldAlert className="h-3 w-3" aria-hidden />
                {openIncidentCount} open
              </button>
            )}
          </div>
        </div>

        {/* Right: quick actions + view toggle.
            On mobile: scrolls horizontally so nothing wraps or overflows.
            Labels are hidden on xs (<640 px) to save space — icons + tooltips
            carry the meaning on narrow screens. */}
        <div className="flex items-center gap-2 shrink-0">

          {/* View-mode toggle — icon + label on sm+, icon-only on mobile */}
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && persistViewMode(v as DashboardViewMode)}
            className="h-8 shrink-0"
            data-testid="dashboard-view-mode"
          >
            <ToggleGroupItem
              value="inline"
              className="h-8 px-2 text-[11px] gap-1 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              title="Inline — all trend graphs visible directly on the dashboard, just scroll"
              aria-label="Inline view"
            >
              <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Inline</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="sections"
              className="h-8 px-2 text-[11px] gap-1 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              title="Sections — click any KPI card to fold/unfold its trend chart inline"
              aria-label="Sections view"
            >
              <ListCollapse className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Sections</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="popup"
              className="h-8 px-2 text-[11px] gap-1 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              title="Dialog — click a KPI card to open its trend chart in a full-screen dialog"
              aria-label="Dialog view"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Dialog</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* ─── Cluster 1: Overview ─── */}
      {/* Order (updated): Production Volume · Locators Consumption · NRW
          · Raw Water · Blending. Production Cost has been moved to the
          Production Cost (Power + Chemical) cluster where it sits alongside
          Power Cost, Chemical Cost, and PV Ratio. Production Volume is now
          surfaced here so operators can see today's output at a glance. */}
      <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Droplet} accent="text-primary" label="Production Volume"
          value={fmtNum(production)} unit="m³" trend={dProduction}
          onClick={handleMetricClick('production', 'Production vs Consumption')} />
        <StatCard icon={Receipt} accent="text-highlight" label="Locators Consumption" value={fmtNum(consumption)} unit="m³"
          trend={dConsumption}
          onClick={handleMetricClick('production', 'Production vs Consumption')} />
        {/* ③ NRW — full-width on mobile so the gauge has room; auto-fits on sm+ */}
        <div className="col-span-2 sm:col-span-1">
          <NRWGaugeCard
            nrw={nrw}
            yNrw={yNrw}
            onClick={handleMetricClick('nrw', 'NRW Trend')}
          />
        </div>
        <StatCard icon={Droplet} accent="text-primary" label="Raw Water"
          value={fmtNum(rawWaterVol)} unit="m³" trend={dRawWater}
          onClick={handleMetricClick('rawwater', 'Raw Water (m³)')} />
        <StatCard icon={Waves} accent="text-violet-600" label="Blending"
          value={fmtNum(blending)} unit="m³" />
      </div>
      <ClusterCharts metrics={OVERVIEW_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="overview" />

      {/* ─── Cluster 2: Quality ─── */}
      {/* Spec order: Feed TDS · Product TDS · Raw TDS (per well source) ·
          Raw NTU (per well source). The Raw TDS / NTU tiles surface the
          aggregate headline plus a small breakdown labelled "per well
          source" — see PerWellSourceCard for the schema caveat (these
          are physically measured at the RO feed manifold which BLENDS
          multiple well sources, so each row represents one source line). */}
      <ClusterHeader icon={FlaskConical} title="Quality" accent="text-accent" subtitle="RO output" />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {/* Feed TDS — expandable per-train breakdown (chevron, hidden by default) */}
        <StatCard
          icon={Gauge}
          label="Feed TDS"
          value={avgFeedTds ?? '—'}
          unit="ppm"
          expandRows={roByTrain.map((r) => ({
            label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
            value: r.feed_tds != null ? Math.round(r.feed_tds) : null,
          }))}
          expandUnit="ppm"
        />
        {/* Product TDS — expandable per-train breakdown (chevron, hidden by default) */}
        <StatCard
          icon={FlaskConical}
          accent="text-accent"
          label="Product TDS"
          value={avgPermTds ?? '—'}
          unit="ppm"
          onClick={handleMetricClick('tds', 'Permeate TDS Trend')}
          expandRows={roByTrain.map((r) => ({
            label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
            value: r.permeate_tds != null ? Math.round(r.permeate_tds) : null,
          }))}
          expandUnit="ppm"
        />
        {/* Raw TDS — per-well breakdown from well_readings.tds_ppm (Operations data) */}
        <PerWellSourceCard
          icon={Gauge}
          label="Raw TDS"
          unit="ppm"
          aggregate={avgRawTds}
          rows={wellsByQuality}
          field="tds_ppm"
          plantCodeById={plantCodeById}
          multiPlant={plantIds.length > 1}
          testId="raw-tds-per-well-source"
        />
        {/* Raw NTU — per-well breakdown from well_readings.turbidity_ntu (Operations data) */}
        <PerWellSourceCard
          icon={Cloud}
          label="Raw NTU"
          unit="NTU"
          aggregate={avgRawTurb}
          rows={wellsByQuality}
          field="turbidity_ntu"
          plantCodeById={plantCodeById}
          multiPlant={plantIds.length > 1}
          testId="raw-ntu-per-well-source"
          decimals={2}
        />
        <StatCard icon={Thermometer} label="Recovery" value={avgRecovery ?? '—'} unit="%"
          onClick={handleMetricClick('recovery', 'Recovery Trendline')} />
      </div>
      <ClusterCharts metrics={QUALITY_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="quality" />

      {/* ─── Cluster 3: Production Cost (Power + Chemical) ─── */}
      {/* Spec order: Power Cost · Chemical Cost · Power kWh · PV Ratio.
          The header subtitle shows "Today" normally or "as of MMM d" when
          cost data was pulled from the most-recent fallback (no today entry). */}
      <ClusterHeader
        icon={Zap}
        title="Production Cost (Power + Chemical)"
        accent="text-chart-6"
        subtitle={
          costIsStale && costDataDate
            ? `as of ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d')}`
            : 'Today'
        }
      />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Banknote} accent="text-accent" label="Total Production Cost"
          calc
          calcTooltip={
            costIsStale && costDataDate
              ? `Production Cost = (kWh × tariff rate) + Chemical Cost (latest data: ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d, yyyy')})`
              : 'Production Cost = Power Cost (kWh × ₱/kWh) + Chemical Cost (today)'
          }
          value={productionCost == null ? '—' : `₱${fmtNum(productionCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={Zap} accent="text-chart-6" label="Power Cost"
          calc
          calcTooltip="Power Cost = Power kWh × tariff rate (₱/kWh) from power_tariffs — same formula as chart"
          value={powerCost == null ? '—' : `₱${fmtNum(powerCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={FlaskConical} accent="text-highlight" label="Chemical Cost"
          value={chemCost == null ? '—' : `₱${fmtNum(chemCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={Zap} accent="text-chart-6" label="Power kWh"
          value={powerIsStale || kwh > 0 ? fmtNum(kwh) : '—'}
          unit={kwh > 0 ? 'kWh' : undefined}
          trend={dKwh}
          onClick={handleMetricClick('kwh', 'Power Consumption & Energy Mix')} />
        <StatCard icon={Zap} accent="text-chart-6" label="PV Ratio" value={pv == null ? '—' : pv} unit="kWh/m³"
          calc threshold="1.2"
          calcTooltip="PV Ratio = Power kWh ÷ Production m³ (lower is more efficient)"
          onClick={handleMetricClick('pv', 'PV Ratio Trend')} />
      </div>
      <ClusterCharts
        metrics={[
          ...COST_CHART_METRICS.filter((m: ChartMetric) => m.metric !== 'kwh'),
          { metric: 'kwh', title: 'Power Consumption & Energy Mix' },
        ] as ChartMetric[]}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        plantIds={plantIds}
        clusterId="cost"
      />

      {/* ─── Cluster 4: Plant Health + Blending Volume ───────────────────── */}
      <ClusterHeader icon={Activity} title="Plant Health Trend" accent="text-emerald-500" subtitle="RO trains" />
      <InlineTrendChart metric="plantHealth" title="Plant Health Trend" plantIds={plantIds} compact={viewMode === 'inline'} />

      {/* Blending Volume sits immediately below the trend chart in the same cluster.
          Alerts have moved to the TopBar notification bell (see useEffect above). */}
      {/* ④ Reading coverage  +  ⑤ PM due soon — side-by-side on sm+ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ReadingCoverageCard plantIds={plantIds} />
        <PMDueSoonCard       plantIds={plantIds} />
      </div>

      <BlendingVolumeCard plantIds={plantIds} />

      <TrendModal open={!!modal} onClose={() => setModal(null)} metric={modal?.metric ?? ''} title={modal?.title ?? ''} plantIds={plantIds} />
      <DowntimeEventsModal
        open={downtimeOpen}
        onClose={() => setDowntimeOpen(false)}
        plantId={selectedPlantId || undefined}
        plantName={selectedPlantId ? visiblePlants?.[0]?.name : 'All plants'}
      />
      <DataSummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        plantIds={plantIds}
        plantCodeById={plantCodeById}
      />
    </div>
  );
}
