import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, Calendar, Droplet, Activity } from 'lucide-react';
import { DataState } from '@/components/DataState';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum, calc, nrwColor, ALERTS } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';

// Same palette as the plant-wide NRW chart in components/dashboard/TrendChart.tsx.
// Both import from lib/chartColors.ts (a neutral shared module, not a reach into
// Dashboard internals) so the two charts can't silently drift apart.
import { C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_BLEND_PCT, C_BLEND_VOLUME } from '@/lib/chartColors';

export interface HistoryRow { date: string; consumption: number; reading?: number; }

/** A locator "supplied" by a mother/product meter — i.e. one of its siblings
 *  per AssignLocatorsDialog's product_meter_id link. Used to overlay the
 *  siblings' combined consumption and derive a meter-level NRW% alongside
 *  the mother meter's own Historical Consumption chart. */
export interface SiblingLocator {
  id: string;
  name: string;
  /** locator.default_input_mode — 'direct' means current_reading already IS
   *  the period's volume (e.g. a derived/residual locator like HAMAS). */
  defaultInputMode?: 'raw' | 'direct';
}

export function EntityHistoryChart({
  entityId,
  entityType,
  entityName,
  defaultInputMode = 'raw',
  siblingLocators,
  isBlendingWell,
}: {
  entityId: string;
  entityType: 'locator' | 'well' | 'product_meter';
  entityName: string;
  /** From locator.default_input_mode / well.default_input_mode, or
   *  product_meters.is_derived for entityType === 'product_meter'. 'direct'
   *  means current_reading already IS the period's volume (e.g. HAMAS) —
   *  chart that value directly instead of Math.max(0, current - previous),
   *  which clamps every ordinary day-to-day dip to zero and silently
   *  discards it from the Total/Avg stats. Defaults to 'raw'. */
  defaultInputMode?: 'raw' | 'direct';
  /** Only meaningful for entityType === 'product_meter'. The locators this
   *  mother meter supplies (AssignLocatorsDialog). When present, the chart
   *  overlays the siblings' combined daily consumption and a meter-level
   *  NRW% — same formula as the plant-wide Dashboard NRW (calc.nrw), scoped
   *  to just this meter and its own siblings. */
  siblingLocators?: SiblingLocator[];
  /** Only meaningful for entityType === 'well'. True when this well is
   *  tagged in blending_wells (Plants → Wells "Blending" toggle). When set,
   *  the chart overlays this well's own blending_events volume alongside
   *  its raw-water consumption, plus a % of raw output diverted to
   *  blending — same overlay pattern as siblingLocators above, just scoped
   *  to a single well's own two series instead of a meter + its locators. */
  isBlendingWell?: boolean;
}) {
  const isDirectMode = (
    (entityType === 'locator' || entityType === 'well') && defaultInputMode === 'direct'
  ) || (
    // Product meters (e.g. Mambaling's HAMAS, mirrored from SRP's derived
    // HAMAS locator) don't use default_input_mode — their equivalent flag is
    // product_meters.is_derived, which the caller maps onto this same
    // defaultInputMode='direct' contract. See ProductMeters.tsx's
    // EntityHistoryChart invocation.
    entityType === 'product_meter' && defaultInputMode === 'direct'
  );
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const hasSiblings = entityType === 'product_meter' && !!siblingLocators?.length;
  const hasBlending = entityType === 'well' && !!isBlendingWell;
  const siblingIds = useMemo(() => (siblingLocators ?? []).map(l => l.id), [siblingLocators]);
  const siblingModeById = useMemo(() => {
    const map = new Map<string, 'raw' | 'direct'>();
    (siblingLocators ?? []).forEach(l => map.set(l.id, l.defaultInputMode === 'direct' ? 'direct' : 'raw'));
    return map;
  }, [siblingLocators]);

  const { data: rows = [], isLoading, error, refetch } = useQuery<HistoryRow[]>({
    queryKey: ['entity-history', entityType, entityId, range, defaultInputMode],
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      let raw: any[] = [];

      if (entityType === 'locator') {
        const { data, error: sbError } = await supabase
          .from('locator_readings')
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('locator_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        // Was: error discarded here — a genuine fetch failure (RLS, network,
        // bad query) rendered identically to "no readings in this period".
        if (sbError) throw sbError;
        raw = data ?? [];
      } else if (entityType === 'well') {
        const { data, error: sbError } = await supabase
          .from('well_readings')
          // Fix: include daily_volume so stored delta is preferred over live current-previous calc
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('well_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = data ?? [];
      } else {
        const { data, error: sbError } = await supabase
          .from('product_meter_readings' as any)
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('meter_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = (data ?? []) as any[];
      }

      // `raw` is already ordered ascending by reading_datetime, so a single
      // running `last` value is enough to walk the chain — no Map needed
      // since this query is always scoped to one entity.
      let last: number | null = null;
      return raw.map((r: any) => {
        const dateStr = r.reading_datetime?.slice(0, 10) ?? '';
        let consumption = 0;
        if (isDirectMode) {
          // current_reading already IS the period's volume — no diff, no
          // clamping. (daily_volume / previous_reading aren't meaningful
          // here and are ignored.)
          consumption = r.current_reading != null ? +r.current_reading : 0;
        } else if (last != null && r.current_reading != null) {
          // SELF-HEAL (checked before daily_volume): a predecessor has
          // already been walked within this fetched window, so diff live
          // against it instead of trusting the row's stored daily_volume.
          // daily_volume/previous_reading are written once at insert time
          // and nothing cascades an update to them when an earlier reading
          // is later edited/deleted/replaced — a downstream row can be left
          // pointing at a stale predecessor indefinitely. That's what made
          // the "Mother Meter" bars climb across Aug 7-10 for Coke/Parkmall
          // instead of showing each day's real volume — same root cause and
          // fix as DataSummaryModal.tsx / TrendChart.tsx.
          consumption = Math.max(0, +r.current_reading - last);
        } else if (r.daily_volume != null && +r.daily_volume > 0) {
          // First row for this entity within the fetched window — no walked
          // predecessor to diff against locally. Fall back to the stored
          // daily_volume (may legitimately span >1 day if readings were
          // skipped before the window).
          consumption = +r.daily_volume;
        } else if (r.current_reading != null && r.previous_reading != null) {
          consumption = Math.max(0, +r.current_reading - +r.previous_reading);
        }
        if (r.current_reading != null) last = +r.current_reading;
        return { date: dateStr, consumption: +consumption.toFixed(2), reading: r.current_reading != null ? +r.current_reading : undefined };
      }).filter(r => r.date);
    },
    staleTime: 60_000,
  });

  // Aggregate by date (sum consumption for multi-reading days)
  const aggregated = useMemo<HistoryRow[]>(() => {
    const map = new Map<string, HistoryRow>();
    rows.forEach(r => {
      if (map.has(r.date)) {
        map.get(r.date)!.consumption += r.consumption;
        if (r.reading != null) map.get(r.date)!.reading = r.reading;
      } else {
        map.set(r.date, { ...r });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  // ─── Sibling locators (this mother meter's AssignLocatorsDialog picks) ──────
  // One batched query across all sibling locator_readings for the same range,
  // aggregated to a per-date total exactly like `aggregated` above but summed
  // across locators instead of kept per-entity. Each locator's own raw/direct
  // input mode is honored (siblingModeById) so a mixed group (e.g. a normal
  // metered zone alongside a direct-input bulk zone) totals correctly.
  const { data: siblingRows = [], isLoading: siblingsLoading } = useQuery<{ date: string; consumption: number }[]>({
    queryKey: ['entity-history-siblings', entityId, range, siblingIds.join(',')],
    enabled: hasSiblings,
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id, reading_datetime, current_reading, previous_reading, daily_volume')
        .in('locator_id', siblingIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });

      return (data ?? []).map((r: any) => {
        const dateStr = r.reading_datetime?.slice(0, 10) ?? '';
        const isDirect = siblingModeById.get(r.locator_id) === 'direct';
        let consumption = 0;
        if (isDirect) {
          consumption = r.current_reading != null ? +r.current_reading : 0;
        } else if (r.daily_volume != null && +r.daily_volume > 0) {
          consumption = +r.daily_volume;
        } else if (r.current_reading != null && r.previous_reading != null) {
          consumption = Math.max(0, +r.current_reading - +r.previous_reading);
        }
        return { date: dateStr, consumption };
      }).filter(r => r.date);
    },
    staleTime: 60_000,
  });

  // Sum across all siblings per date (a day may have several locators reporting)
  const siblingByDate = useMemo(() => {
    const map = new Map<string, number>();
    siblingRows.forEach(r => map.set(r.date, (map.get(r.date) ?? 0) + r.consumption));
    return map;
  }, [siblingRows]);

  const totalSiblingConsumption = useMemo(
    () => siblingRows.reduce((s, r) => s + r.consumption, 0),
    [siblingRows],
  );

  // ─── This well's own blending_events (Operations → Blending) ───────────────
  // A blending well is still metered normally (well_readings, the bars this
  // chart already draws) — blending_events is a *separate* log of how much
  // of that same well's raw output was diverted into the product line via
  // blending on a given day. Same table BlendingVolumeCard.tsx reads for the
  // plant-wide rollup, just scoped here to one well_id.
  const { data: blendingRows = [], isLoading: blendingLoading } = useQuery<{ date: string; volume: number }[]>({
    queryKey: ['entity-history-blending', entityId, range],
    enabled: hasBlending,
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('blending_events' as any)
        .select('event_date, volume_m3')
        .eq('well_id', entityId)
        .gte('event_date', since);
      if (error) return [];
      return (data ?? [])
        .map((r: any) => ({ date: String(r.event_date ?? '').slice(0, 10), volume: Number(r.volume_m3) || 0 }))
        .filter((r: any) => r.date);
    },
    staleTime: 60_000,
  });

  // Sum across a day (a well can log more than one blending event on the same date)
  const blendingByDate = useMemo(() => {
    const map = new Map<string, number>();
    blendingRows.forEach(r => map.set(r.date, (map.get(r.date) ?? 0) + r.volume));
    return map;
  }, [blendingRows]);

  const totalBlendingVolume = useMemo(
    () => blendingRows.reduce((s, r) => s + r.volume, 0),
    [blendingRows],
  );

  // Chart data: mother meter's own dates, each with its siblings' total for
  // that same date (0 when siblings had no reading that day) and a per-day
  // NRW% — same calc.nrw(production, consumption) the plant-wide Dashboard
  // NRW chart uses, just scoped to this one meter and its own siblings.
  // For a blending well, the same shape carries blendedVolume (that day's
  // blending_events total) and blendedPct — the share of that day's raw
  // output that was diverted to blending, not a loss/NRW-style formula.
  const chartData = useMemo(() => {
    if (hasSiblings) {
      return aggregated.map(r => {
        const siblingTotal = +(siblingByDate.get(r.date) ?? 0).toFixed(2);
        return { ...r, siblingTotal, nrw: calc.nrw(r.consumption, siblingTotal) };
      });
    }
    if (hasBlending) {
      return aggregated.map(r => {
        const blendedVolume = +(blendingByDate.get(r.date) ?? 0).toFixed(2);
        const blendedPct = r.consumption > 0 ? +((blendedVolume / r.consumption) * 100).toFixed(1) : null;
        return { ...r, blendedVolume, blendedPct };
      });
    }
    return aggregated;
  }, [aggregated, hasSiblings, siblingByDate, hasBlending, blendingByDate]);

  // Period NRW% — totals across the whole selected range, mirroring how the
  // Readings/Total/Avg-day stats above are also period aggregates rather
  // than a per-day average of an already-noisy daily ratio.
  const periodNrw = hasSiblings ? calc.nrw(
    aggregated.reduce((s, r) => s + r.consumption, 0),
    totalSiblingConsumption,
  ) : null;

  const exportCSV = () => {
    if (!aggregated.length) { toast.error('No data to export'); return; }
    const header = hasSiblings
      ? 'date,consumption_m3,reading,locators_total_m3,nrw_pct'
      : hasBlending
      ? 'date,raw_water_m3,reading,blended_m3,blended_pct'
      : 'date,consumption_m3,reading';
    const lines = ((hasSiblings || hasBlending) ? chartData : aggregated).map((r: any) =>
      hasSiblings
        ? `${r.date},${r.consumption},${r.reading ?? ''},${r.siblingTotal ?? ''},${r.nrw ?? ''}`
        : hasBlending
        ? `${r.date},${r.consumption},${r.reading ?? ''},${r.blendedVolume ?? ''},${r.blendedPct ?? ''}`
        : `${r.date},${r.consumption},${r.reading ?? ''}`
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityName.replace(/\s+/g, '_')}_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const totalConsumption = aggregated.reduce((s, r) => s + r.consumption, 0);
  const avgConsumption = aggregated.length ? totalConsumption / aggregated.length : 0;

  // Period % blended — totals across the whole selected range (same reasoning
  // as periodNrw below: a ratio of period totals, not an average of noisy
  // daily ratios that would overweight low-volume days).
  const periodBlendedPct = hasBlending && totalConsumption > 0
    ? +((totalBlendingVolume / totalConsumption) * 100).toFixed(1)
    : null;

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.name}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span>
            {p.dataKey === 'nrw' || p.dataKey === 'blendedPct' ? '%' : ' m³'}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Historical Consumption</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Range pills */}
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${
                  range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{r === 'all' ? 'All' : `${r}d`}</button>
            ))}
          </div>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={exportCSV}
            title="Export to CSV"
          >
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {aggregated.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">Readings</div>
            <div className="font-mono font-semibold text-base">{aggregated.length}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">Total</div>
            <div className="font-mono font-semibold text-base">{fmtNum(totalConsumption)}</div>
            <div className="text-muted-foreground text-3xs">m³</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg/day</div>
            <div className="font-mono font-semibold text-base">{fmtNum(avgConsumption)}</div>
            <div className="text-muted-foreground text-3xs">m³</div>
          </div>
        </div>
      )}

      {/* Sibling locators total + meter-level NRW% — same calc.nrw() the
          plant-wide Dashboard NRW card uses, scoped to this meter's own
          assigned locators (AssignLocatorsDialog). */}
      {hasSiblings && aggregated.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">
              Locators Total {siblingsLoading && <Loader2 className="inline h-2.5 w-2.5 animate-spin ml-0.5" />}
            </div>
            <div className="font-mono font-semibold text-base" style={{ color: C_CONSUMPTION }}>
              {fmtNum(totalSiblingConsumption)}
            </div>
            <div className="text-muted-foreground text-3xs">m³ · {siblingLocators!.length} locator{siblingLocators!.length !== 1 ? 's' : ''}</div>
          </div>
          <div className={`rounded-lg p-2 text-center bg-muted/40`}>
            <div className="text-muted-foreground text-2xs uppercase tracking-wide flex items-center justify-center gap-1">
              <Activity className="h-2.5 w-2.5 opacity-60" /> NRW
            </div>
            <div
              className="font-mono font-semibold text-base"
              style={{ color: periodNrw == null ? undefined : `hsl(var(--${nrwColor(periodNrw)}))` }}
            >
              {periodNrw == null ? '—' : periodNrw}
              <span className="text-2xs font-sans text-muted-foreground ml-0.5">%</span>
            </div>
            <div className="text-muted-foreground text-3xs">limit {ALERTS.nrw_green_max}%</div>
          </div>
        </div>
      )}

      {/* This well's blended volume + % of its raw output diverted to
          blending (blending_events, Operations → Blending), scoped to this
          one well — not a loss/NRW formula, just blended ÷ raw output. */}
      {hasBlending && aggregated.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">
              Blended Total {blendingLoading && <Loader2 className="inline h-2.5 w-2.5 animate-spin ml-0.5" />}
            </div>
            <div className="font-mono font-semibold text-base" style={{ color: C_BLEND_VOLUME }}>
              {fmtNum(totalBlendingVolume)}
            </div>
            <div className="text-muted-foreground text-3xs">m³</div>
          </div>
          <div className="rounded-lg p-2 text-center bg-muted/40">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide flex items-center justify-center gap-1">
              <Droplet className="h-2.5 w-2.5 opacity-60" /> % Blended
            </div>
            <div className="font-mono font-semibold text-base" style={{ color: C_BLEND_PCT }}>
              {periodBlendedPct == null ? '—' : periodBlendedPct}
              <span className="text-2xs font-sans text-muted-foreground ml-0.5">%</span>
            </div>
            <div className="text-muted-foreground text-3xs">of raw output</div>
          </div>
        </div>
      )}

      {/* Chart */}
      <DataState
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        isEmpty={aggregated.length === 0}
        emptyTitle="No readings in this period"
      >
        {hasSiblings ? (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / chartData.length))}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)} // show MM-DD
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                  height={36}
                />
                <YAxis
                  yAxisId="vol"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  width={38}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tick={{ fontSize: 9, fill: C_NRW }}
                  width={30}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={customTooltip} />
                <Legend wrapperStyle={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em', paddingTop: 4 }} />
                <Bar yAxisId="vol" dataKey="consumption" fill={C_PRODUCTION} name="Mother Meter" radius={[2,2,0,0]} />
                <Bar yAxisId="vol" dataKey="siblingTotal" fill={C_CONSUMPTION} name="Locators Total" radius={[2,2,0,0]} />
                <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke={C_NRW} strokeWidth={2} dot={{ r: 2.5, fill: C_NRW, strokeWidth: 0 }} name="NRW %" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : hasBlending ? (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / chartData.length))}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)} // show MM-DD
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                  height={36}
                />
                <YAxis
                  yAxisId="vol"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  width={38}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tick={{ fontSize: 9, fill: C_BLEND_PCT }}
                  width={30}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={customTooltip} />
                <Legend wrapperStyle={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em', paddingTop: 4 }} />
                <Bar yAxisId="vol" dataKey="consumption" fill={C_RAWWATER} name="Raw Water" radius={[2,2,0,0]} />
                <Bar yAxisId="vol" dataKey="blendedVolume" fill={C_BLEND_VOLUME} name="Blended" radius={[2,2,0,0]} />
                <Line yAxisId="pct" type="monotone" dataKey="blendedPct" stroke={C_BLEND_PCT} strokeWidth={2} dot={{ r: 2.5, fill: C_BLEND_PCT, strokeWidth: 0 }} name="% Blended" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregated} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / aggregated.length))}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)} // show MM-DD
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                  height={36}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  width={38}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
                />
                <Tooltip content={customTooltip} />
                <Bar dataKey="consumption" fill="hsl(174, 72%, 40%)" name="Consumption" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </DataState>
    </div>
  );
}

// ─── MeterDetailSheet ─────────────────────────────────────────────────────────
// A button that expands into a Dialog showing meter details.
// Used in LocatorDetail, WellDetail, etc. as a replacement for inline meter rows.

export function MeterDetailButton({
  label,
  icon,
  fields,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  fields: { label: string; value: string | null | undefined }[];
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const filledCount = fields.filter(f => f.value && f.value !== '—').length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors group text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <span className="text-sm font-medium truncate">{label}</span>
          {filledCount > 0 && (
            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-primary-soft text-primary font-medium shrink-0">
              {filledCount} field{filledCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 -rotate-90" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {icon}
              <span>{label}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {fields.map((f, i) => (
                <div key={i} className={f.label === 'Installed' ? 'col-span-2' : ''}>
                  <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">{f.label}</div>
                  <div className="font-mono-num font-medium">{f.value || '—'}</div>
                </div>
              ))}
            </div>
            {children && <div className="pt-2 border-t">{children}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

