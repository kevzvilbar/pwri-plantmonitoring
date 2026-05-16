import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { fmtNum, nrwColor } from '@/lib/calculations';
import { StatusPill } from '@/components/StatusPill';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { format, subDays, startOfDay } from 'date-fns';
import {
  Droplet, Activity, Zap, FlaskConical, AlertTriangle, Gauge, Thermometer,
  Waves, Cloud, Receipt, Banknote, LayoutGrid, ListCollapse, ExternalLink,
  ArrowUpRight, ArrowDownRight, Minus, CalendarDays,
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

// ─── DataSummaryModal ─────────────────────────────────────────────────────────
// Full-screen pivot-table popup. Rows = dates, columns = individual
// locators (consumption) or product meters (production). Non-retractable —
// closes only via the ✕ button or clicking outside the dialog.

type SummaryTab = 'both' | 'production' | 'consumption';

/**
 * Replacement-aware delta pivot — mirrors TrendChart.tsx `computeEntityDeltas`.
 * Groups readings by entityKeyField, walks them chronologically per entity and:
 *   • is_meter_replacement row     → delta 0, set afterRepl flag
 *   • first row after replacement  → delta 0, clear flag
 *   • normal row w/ dailyVolumeField → use that value (clamped ≥ 0)
 *   • normal row w/o dailyVolumeField → current − last (clamped ≥ 0)
 *   • no predecessor yet (first in range) → current − previous_reading (DB field)
 *     This fixes the "millions delta" bug: without a prior row in the fetched
 *     window, the cumulative meter value would be treated as the day's consumption.
 *     Using the stored previous_reading gives the actual single-interval delta.
 *
 * Returns Map<dateKey yyyy-MM-dd, Map<entityKey, summed volume>>.
 * Estimated rows (is_estimated=true) are included in the pivot normally;
 * the DataSummaryModal renders them with a distinct visual indicator.
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
      let delta = 0;
      if (dailyVolumeField && r[dailyVolumeField] != null) {
        // daily_volume is GENERATED ALWAYS as (current_reading - previous_reading).
        // For the very first row in the fetched window (no lastReading yet), this
        // value correctly represents THAT reading's interval — which may span
        // multiple days if readings were skipped. Use it as-is (it's already the
        // correct single-interval delta stored at insert time), clamped ≥ 0.
        delta = Math.max(0, +r[dailyVolumeField]);
        lastReading.set(entityKey, +r.current_reading);
      } else if (!lastReading.has(entityKey)) {
        // FIX: No daily_volume and no prior row in range.
        // Use the stored previous_reading field (written by Operations.tsx at insert
        // time) instead of treating the full cumulative meter value as today's delta.
        // This prevents the "millions" spike when the date range starts mid-history.
        if (r.previous_reading != null && r.current_reading != null)
          delta = Math.max(0, +r.current_reading - +r.previous_reading);
        lastReading.set(entityKey, +r.current_reading);
      } else {
        // Normal: subtract the last seen reading. Clamp for meter rollbacks.
        delta = Math.max(0, +r.current_reading - lastReading.get(entityKey)!);
        lastReading.set(entityKey, +r.current_reading);
      }
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
    const pivot = computePivotFromReadings(consReadings ?? [], 'locator_id', 'daily_volume');

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
    const pivot = computePivotFromReadings(prodReadings ?? [], 'meter_id', 'daily_volume');

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
  // We read permeate_meter_delta + permeate_production_date DIRECTLY from the DB
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

  // RO readings — use permeate_meter_delta (pre-validated, corrected by recalculateTrainDeltas)
  // and permeate_production_date (cutoff-aware day label). Never use permeate_meter (cumulative).
  const { data: roMeterReadings, isLoading: roLoading } = useQuery({
    queryKey: ['dsm-ro-readings', permeateIsProductionPlantIds, fromStr, toStr],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [] as any[];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter_delta,permeate_production_date')
        .in('plant_id', permeateIsProductionPlantIds)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0)
        .gte('permeate_production_date', fromStr)
        .lte('permeate_production_date', toStr);
      return (data ?? []) as any[];
    },
    enabled: open && permeateIsProductionPlantIds.length > 0,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });

  // RO production pivot — simple SUM of permeate_meter_delta per permeate_production_date per train.
  // NO cumulative-delta recomputation: the stored delta is already correct (maintained by
  // recalculateTrainDeltas), so we just group and sum.
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

    // Accumulate deltas — each hourly reading contributes its pre-stored delta
    (roMeterReadings ?? []).forEach((r: any) => {
      const dateKey  = r.permeate_production_date as string;
      const trainKey = r.train_id as string;
      const delta    = +(r.permeate_meter_delta ?? 0);
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
            { key: 'both',        label: 'Prod. vs Consum.', icon: <Activity className="h-3 w-3" /> },
            { key: 'production',  label: 'Production',       icon: <Droplet  className="h-3 w-3" /> },
            { key: 'consumption', label: 'Consumption',      icon: <Receipt  className="h-3 w-3" /> },
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

        {/* ── Body: pivot table or Prod. vs Consum. comparison ── */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">Loading…</div>
          )}

          {/* ── "Prod. vs Consum." combined comparison tab ── */}
          {!isLoading && tab === 'both' && (() => {
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
              <table className="w-full text-[11px] border-collapse" data-testid="dsm-both-table">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-muted/95 backdrop-blur-sm">
                    <th className="sticky left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">Date</th>
                    <th className="px-3 py-2 text-right font-semibold text-primary whitespace-nowrap border-b border-border min-w-[110px]">Production (m³)</th>
                    <th className="px-3 py-2 text-right font-semibold text-highlight whitespace-nowrap border-b border-border min-w-[120px]">Consumption (m³)</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[100px]">Balance (m³)</th>
                    <th className="sticky right-0 z-30 bg-teal-50/95 dark:bg-teal-950/60 px-3 py-2 text-right font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-l border-border min-w-[80px]">NRW %</th>
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
                        <td className={['sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums border-l border-border', isEven ? 'bg-background' : 'bg-muted/10', nrw != null && nrw > 20 ? 'text-rose-600' : nrw != null ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground/40'].join(' ')}>{nrw != null ? `${nrw}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}

          {/* ── Production / Consumption detail tabs ── */}
          {!isLoading && tab !== 'both' && entities.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              No {tab === 'consumption' ? 'locators' : useRoProd ? 'RO trains' : 'product meters'} found.
            </div>
          )}
          {!isLoading && tab !== 'both' && entities.length > 0 && dates.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              No readings in this date range.
            </div>
          )}
          {!isLoading && tab !== 'both' && entities.length > 0 && dates.length > 0 && (
            <table className="w-full text-[11px] border-collapse" data-testid="dsm-pivot-table">
              <thead className="sticky top-0 z-20">
                {/* Entity name header row */}
                <tr className="bg-muted/95 backdrop-blur-sm">
                  <th className="sticky left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">
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
                        className="px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[90px]"
                        title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                      >
                        <div className="truncate max-w-[110px] mx-auto font-mono-num">{label}</div>
                        {sublabel && (
                          <div className="text-[9px] font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                        )}
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-30 bg-teal-50/95 dark:bg-teal-950/60 px-3 py-2 text-right font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap border-b border-l border-border min-w-[90px]">
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
          )}
        </div>

        {/* ── Footer legend ── */}
        <div className="px-5 py-2 border-t shrink-0 flex items-center gap-4 text-[10px] text-muted-foreground bg-muted/20">
          {tab === 'both' && <><Activity className="h-3 w-3 text-primary" /> Production vs Consumption — daily totals (m³) · NRW % = (Prod − Cons) ÷ Prod</>}
          {tab === 'consumption' && <><Receipt className="h-3 w-3 text-highlight" /> Consumption — delta volume (m³) per locator per day</>}
          {tab === 'production' && (
            useRoProd
              ? <><Droplet className="h-3 w-3 text-primary" /> Production — summed permeate_meter_delta (m³) per RO train per production day</>
              : <><Droplet className="h-3 w-3 text-primary" /> Production — delta volume (m³) per product meter per day</>
          )}
          {tab !== 'both' && estimatedKeys.size > 0 && (
            <span className="flex items-center gap-1 ml-3 text-amber-600 dark:text-amber-400">
              <span className="font-bold text-[10px]">~</span>
              Auto-estimated (Poly. Regression deg. 3) — hover cell for details
            </span>
          )}
          <span className="ml-auto">
            {tab === 'both' && `${(useRoProd ? roProdPivot : prodPivot).dates.length} days in range`}
            {tab === 'consumption' && `${entities.length} locators · ${dates.length} days`}
            {tab === 'production' && (
              useRoProd
                ? `${roProdPivot.entities.length} RO trains · ${roProdPivot.dates.length} days`
                : `${entities.length} meters · ${dates.length} days`
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

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
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', _locatorIds)
        .gte('reading_datetime', today)
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
      const { data } = await supabase
        .from('well_readings')
        .select('well_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', _wellIds)
        .gte('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      return (data ?? []) as any[];
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
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', today)
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
  const { data: plantMeterConfigs } = useQuery({
    queryKey: ['dash-plant-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id,permeate_is_production,permeate_cutoff_time')
        .in('plant_id', plantIds);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000, // config rarely changes — cache for 1 min
  });

  // Plant IDs that use the RO permeate meter as their production source
  const permeateProductionPlantIds = useMemo(
    () => (plantMeterConfigs ?? [])
      .filter((c: any) => c.permeate_is_production)
      .map((c: any) => c.plant_id as string),
    [plantMeterConfigs],
  );

  // Today's production from RO permeate meter deltas
  // (only for plants where permeate_is_production = true)
  // permeate_production_date is the calendar day the reading counts toward — set by
  // ROTrains.tsx submit() and the CSV importer via getPermeateDayLabel().
  const { data: todayRoPermeate } = useQuery({
    queryKey: ['dash-ro-permeate-today', permeateProductionPlantIds, _localDateStr],
    queryFn: async () => {
      if (!permeateProductionPlantIds.length) return [] as any[];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('plant_id,train_number,permeate_meter_delta,permeate_production_date')
        .in('plant_id', permeateProductionPlantIds)
        .eq('permeate_production_date', _localDateStr)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      return (data ?? []) as any[];
    },
    enabled: permeateProductionPlantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // Yesterday's RO permeate production (for trend delta on the Production stat card)
  const { data: yRoPermeate } = useQuery({
    queryKey: ['dash-ro-permeate-yest', permeateProductionPlantIds, _yesterdayKey],
    queryFn: async () => {
      if (!permeateProductionPlantIds.length) return [] as any[];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('plant_id,permeate_meter_delta,permeate_production_date')
        .in('plant_id', permeateProductionPlantIds)
        .eq('permeate_production_date', _yesterdayKey)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      return (data ?? []) as any[];
    },
    enabled: permeateProductionPlantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // Power readings — today first, fall back to most-recent per plant if today is empty.
  // powerIsStale is set when the displayed value came from a prior day.
  const { data: todayPowerRaw } = useQuery({
    queryKey: ['dash-power-today', plantIds, today],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], isStale: false };
      const { data: todayData } = await supabase
        .from('power_readings')
        .select('daily_consumption_kwh,plant_id,reading_datetime')
        .in('plant_id', plantIds)
        .gte('reading_datetime', today);
      if ((todayData ?? []).length) return { rows: todayData!, isStale: false };
      // Fallback: latest reading per plant
      const { data: recent } = await supabase
        .from('power_readings')
        .select('daily_consumption_kwh,plant_id,reading_datetime')
        .in('plant_id', plantIds)
        .order('reading_datetime', { ascending: false })
        .limit(plantIds.length * 5);
      const latestByPlant = new Map<string, any>();
      (recent ?? []).forEach((r: any) => {
        if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r);
      });
      return { rows: Array.from(latestByPlant.values()), isStale: true };
    },
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const todayPower   = todayPowerRaw?.rows ?? [];
  const powerIsStale = todayPowerRaw?.isStale ?? false;
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
    queryFn: async () => plantIds.length
      ? (await supabase.from('power_readings').select('daily_consumption_kwh')
          .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  const { data: latestRO } = useQuery({
    queryKey: ['dash-ro-recent', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('ro_train_readings')
          .select('permeate_tds,feed_tds,dp_psi,recovery_pct,permeate_ph,turbidity_ntu,plant_id,train_number,reading_datetime')
          .in('plant_id', plantIds).gte('reading_datetime', subDays(new Date(), 1).toISOString())
          .order('reading_datetime', { ascending: false })).data ?? []
      : [],
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  // Today's production cost (chem + power).
  // If no row exists for today's date, fall back to the latest available row per
  // plant so the dashboard never displays ₱0 when real data exists.
  // `costDataDate` + `costIsStale` drive the "as of MMM d" badge in the cluster header.
  const { data: todayCostsRaw } = useQuery({
    queryKey: ['dash-costs-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], costDataDate: null as string | null };
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const { data: todayData } = await supabase
        .from('production_costs')
        .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
        .in('plant_id', plantIds)
        .eq('cost_date', todayStr);
      if ((todayData ?? []).length) return { rows: todayData!, costDataDate: todayStr };
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
      return { rows, costDataDate: rows[0]?.cost_date ?? null };
    },
    enabled: plantIds.length > 0,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const todayCosts   = todayCostsRaw?.rows ?? [];
  const costDataDate = todayCostsRaw?.costDataDate ?? null;
  const costIsStale  = costDataDate != null && costDataDate !== format(new Date(), 'yyyy-MM-dd');
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
    computePivotFromReadings(todayWells ?? [], 'well_id', 'daily_volume'), _todayKey,
  ), [todayWells, _todayKey]);

  // RO permeate contribution to production (plants with permeate_is_production = true).
  // Summed separately and added to the product-meter total so NRW and PV ratio
  // stay accurate even when the plant has no separate product_meter_readings rows.
  const roPermeateProduction = useMemo(
    () => (todayRoPermeate ?? []).reduce((s: number, r: any) => s + (r.permeate_meter_delta ?? 0), 0),
    [todayRoPermeate],
  );
  const yRoPermeateProduction = useMemo(
    () => (yRoPermeate ?? []).reduce((s: number, r: any) => s + (r.permeate_meter_delta ?? 0), 0),
    [yRoPermeate],
  );

  // Production = product meter readings delta + RO permeate delta (if permeate_is_production)
  const production = useMemo(() =>
    pivotDayTotal(
      computePivotFromReadings(todayProductMeters ?? [], 'meter_id', 'daily_volume'), _todayKey,
    ) + roPermeateProduction,
  [todayProductMeters, _todayKey, roPermeateProduction]);

  const consumption = useMemo(() => pivotDayTotal(
    computePivotFromReadings(todayLocators ?? [], 'locator_id', 'daily_volume'), _todayKey,
  ), [todayLocators, _todayKey]);

  const kwh = (todayPower ?? []).reduce((s: number, r: any) => s + (r.daily_consumption_kwh ?? 0), 0);

  // NRW uses Production (product meter output) vs Consumption (locator billed)
  const nrw = calc.nrw(production, consumption);
  const pv = calc.pvRatio(kwh, production);

  const yRawWaterVol = useMemo(() => pivotDayTotal(
    computePivotFromReadings(yWells ?? [], 'well_id', 'daily_volume'), _yesterdayKey,
  ), [yWells, _yesterdayKey]);

  const yProduction = useMemo(() =>
    pivotDayTotal(
      computePivotFromReadings(yProductMeters ?? [], 'meter_id', 'daily_volume'), _yesterdayKey,
    ) + yRoPermeateProduction,
  [yProductMeters, _yesterdayKey, yRoPermeateProduction]);

  const yConsumption = useMemo(() => pivotDayTotal(
    computePivotFromReadings(yLocators ?? [], 'locator_id', 'daily_volume'), _yesterdayKey,
  ), [yLocators, _yesterdayKey]);

  const yKwh = (yPower ?? []).reduce((s: number, r: any) => s + (r.daily_consumption_kwh ?? 0), 0);
  const dProduction = pctDelta(production, yProduction);
  const dConsumption = pctDelta(consumption, yConsumption);
  const dRawWater = pctDelta(rawWaterVol, yRawWaterVol);
  const dKwh = pctDelta(kwh, yKwh);

  const nrwBreached = nrw != null && nrw > 20;
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
      rows.push(r);
    });
    rows.sort((a, b) => {
      // Sort by plant_id then train_number for stable rendering across re-renders.
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return (a.train_number ?? 0) - (b.train_number ?? 0);
    });
    return rows;
  }, [latestRO]);

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
  // Lookup helper for plant codes inside per-train rows. Falls back to the
  // raw plant_id when the plant list hasn't loaded yet so we never render
  // a blank label.
  const plantCodeById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.code ?? p.name ?? p.id));
    return m;
  }, [plants]);

  // Costs aggregate (today or most-recent fallback).
  // Use null when the table has no rows at all (no data ever entered) so the
  // stat cards can render '—' instead of the misleading ₱0.
  const hasCostData    = todayCosts.length > 0;
  const chemCost       = hasCostData ? todayCosts.reduce((s, r: any) => s + (+r.chem_cost  || 0), 0) : null;
  const powerCost      = hasCostData ? todayCosts.reduce((s, r: any) => s + (+r.power_cost || 0), 0) : null;
  const productionCost = hasCostData ? (chemCost! + powerCost!) : null;

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
  (latestRO ?? []).forEach((r: any) => {
    if (r.dp_psi >= 40) localAlerts.push({ tone: 'danger', text: `DP alert: ${r.dp_psi} psi` });
    if (r.permeate_tds >= 600) localAlerts.push({ tone: 'danger', text: `TDS alert: ${r.permeate_tds} ppm` });
    if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) localAlerts.push({ tone: 'warn', text: `pH out of range: ${r.permeate_ph}` });
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
  const feedAlerts = feed?.alerts ?? [];

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {selectedPlantId ? visiblePlants?.[0]?.name : `All plants (${plants?.length ?? 0})`} · Today
            {' · Production '}
            <span className="font-mono-num text-foreground">{fmtNum(production)}</span>
            <span className="ml-0.5">m³</span>
          </p>
        </div>
        {/* View-mode toggle. Three layouts; choice persists to localStorage.
            Tooltip on each option spells out what it does so the icons aren't
            cryptic. The control is intentionally compact — sits in the page
            header, not the cluster headers, so switching modes never moves it. */}
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && persistViewMode(v as DashboardViewMode)}
          className="h-8 shrink-0"
          data-testid="dashboard-view-mode"
        >
          <ToggleGroupItem
            value="inline"
            className="h-7 px-2 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title="Inline — all trend graphs visible directly on the dashboard, just scroll"
            aria-label="Inline view"
          >
            <LayoutGrid className="h-3 w-3 mr-1" /> Inline
          </ToggleGroupItem>
          <ToggleGroupItem
            value="sections"
            className="h-7 px-2 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title="Sections — click any KPI card to fold/unfold its trend chart inline (recommended)"
            aria-label="Sections view"
          >
            <ListCollapse className="h-3 w-3 mr-1" /> Sections
          </ToggleGroupItem>
          <ToggleGroupItem
            value="popup"
            className="h-7 px-2 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title="Dialog — click a KPI card to open its trend chart in a full-screen dialog"
            aria-label="Dialog view"
          >
            <ExternalLink className="h-3 w-3 mr-1" /> Dialog
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* NRW threshold alert banner */}
      {nrwBreached && (
        <div
          className="flex items-start gap-2 rounded-lg border border-rose-300/70 bg-gradient-to-r from-rose-50 to-rose-100/40 px-3 py-2 dark:from-rose-950/40 dark:to-rose-900/20 dark:border-rose-900/60 cursor-pointer hover:shadow-sm transition-shadow"
          onClick={handleMetricClick('nrw', 'NRW trend')}
          data-testid="nrw-banner"
          role="button"
        >
          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-rose-700 dark:text-rose-300">
              NRW Water Loss above threshold — {nrw}%
            </div>
            <div className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
              Limit is 20%. Tap to open the NRW trend and investigate.
            </div>
          </div>
        </div>
      )}

      {/* ─── Cluster 1: Overview ─── */}
      {/* Order matches the spec (2026-07): Production Cost · Locators
          Consumption · NRW · Raw Water · Blending. Raw Water and
          Blending are now two separate tiles (previously combined in a
          single card) per user request. Production volume (m³) is
          surfaced in the page subheader so the underlying NRW math
          stays visible without spending a card on it. */}
      <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Banknote} accent="text-accent" label="Production Cost"
          size="lg" calc
          calcTooltip={
            costIsStale && costDataDate
              ? `Production Cost = Power + Chem (latest data: ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d, yyyy')})`
              : 'Production Cost = Power Cost + Chemical Cost (today)'
          }
          value={productionCost == null ? '—' : `₱${fmtNum(productionCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={Receipt} accent="text-highlight" label="Locators Consumption" value={fmtNum(consumption)} unit="m³"
          trend={dConsumption}
          onClick={handleMetricClick('production', 'Production vs Consumption')} />
        <StatCard icon={Activity} label="NRW" value={nrw == null ? '—' : nrw} unit="%" tone={nrwColor(nrw)}
          size="lg" calc threshold="20%"
          calcTooltip="NRW % = (Production − Locator Consumption) ÷ Production × 100"
          onClick={handleMetricClick('nrw', 'NRW Trend')} />
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
        <StatCard icon={Gauge} label="Feed TDS" value={avgFeedTds ?? '—'} unit="ppm" />
        <StatCard icon={FlaskConical} accent="text-accent" label="Product TDS" value={avgPermTds ?? '—'} unit="ppm"
          onClick={handleMetricClick('tds', 'Permeate TDS Trend')} />
        {/* Raw TDS · per well source — aggregate value above, list below */}
        <PerWellSourceCard
          icon={Gauge}
          label="Raw TDS"
          unit="ppm"
          aggregate={avgFeedTds}
          rows={roByTrain}
          field="feed_tds"
          plantCodeById={plantCodeById}
          testId="raw-tds-per-well-source"
        />
        <PerWellSourceCard
          icon={Cloud}
          label="Raw NTU"
          unit="NTU"
          aggregate={avgTurb}
          rows={roByTrain}
          field="turbidity_ntu"
          plantCodeById={plantCodeById}
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
        <StatCard icon={Zap} accent="text-chart-6" label="Power Cost"
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

      {/* ─── Cluster 4: Plant Health ─────────────────────────────────────── */}
      <ClusterHeader icon={Activity} title="Plant Health Trend" accent="text-emerald-500" subtitle="RO trains" />
      <InlineTrendChart metric="plantHealth" title="Plant Health Trend" plantIds={plantIds} compact={viewMode === 'inline'} />

      <Card className="p-3" data-testid="alerts-card">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-danger" />
          <h2 className="text-sm font-semibold">Active Alerts</h2>
          <span className="text-[10px] text-muted-foreground">
            {feedAlerts.length + localAlerts.length} active
          </span>
          {(feedAlerts.length + localAlerts.length) > 0 && <span className="pulse-dot ml-auto" />}
        </div>

        {/* Unified feed — downtime, blending, recovery */}
        {feedAlerts.length > 0 && (
          <div className="space-y-1.5 mb-2" data-testid="alerts-feed-list">
            {feedAlerts.slice(0, 8).map((a, i) => {
              const tone = a.severity === 'high' ? 'danger'
                : a.severity === 'medium' ? 'warn'
                : a.severity === 'low' ? 'accent'
                : 'info' as const;
              const kindLabel = a.kind === 'downtime' ? 'Downtime'
                : a.kind === 'blending' ? 'Blending'
                : 'Recovery';
              return (
                <button
                  key={`feed-${i}`}
                  className="w-full text-left flex items-start gap-2 text-xs hover:bg-muted/40 rounded px-1 py-1"
                  onClick={() => {
                    if (a.kind === 'downtime') setDowntimeOpen(true);
                  }}
                  data-testid={`alert-row-${a.kind}-${i}`}
                >
                  <StatusPill tone={tone as any}>{kindLabel}</StatusPill>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.title}</div>
                    {a.detail && <div className="text-muted-foreground truncate">{a.detail}</div>}
                  </div>
                  <span className="font-mono-num text-[10px] text-muted-foreground shrink-0 mt-0.5">{a.date}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Live-computed RO / chem / train gap alerts */}
        {localAlerts.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t">
            {localAlerts.slice(0, 5).map((a, i) => (
              <div key={`${a.tone}-${a.text}-${i}`} className="flex items-center gap-2 text-sm">
                <StatusPill tone={a.tone}>{a.tone}</StatusPill>
                <span className="text-xs">{a.text}</span>
              </div>
            ))}
          </div>
        )}

        {feedAlerts.length === 0 && localAlerts.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">All clear — no alerts</p>
        )}
      </Card>

      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-2">Chemical stock</h2>
        <div className="space-y-2.5">
          {(chemInv ?? []).slice(0, 8).map((c: any) => {
            const pct = c.low_stock_threshold ? Math.min(100, (c.current_stock / (c.low_stock_threshold * 4)) * 100) : 0;
            return (
              <div key={c.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{c.chemical_name}</span>
                  <span className="font-mono-num">{c.current_stock} {c.unit}</span>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
            );
          })}
          {!chemInv?.length && <p className="text-sm text-muted-foreground py-2 text-center">No inventory yet</p>}
        </div>
      </Card>

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
