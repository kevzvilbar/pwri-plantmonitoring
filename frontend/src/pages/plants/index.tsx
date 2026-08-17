import { useState, useEffect, useMemo, useRef, useId, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, Settings2, Search } from 'lucide-react';
// Icon-audit fix: RO Trains now uses the purpose-built ROTrainIcon everywhere
// on this page (RO util indicator, MetricChip, PlantStatRow, tab bar) instead
// of the generic Wrench, which this file was also using for unrelated things
// like "Edit" and "Replace Meter" elsewhere in the app.
import { ROTrainIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { STALE_READING_HOURS } from '@/lib/format';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


import { CollapsibleSection, SummaryCount, GridPylonIcon, usePlantMeterConfig, logPlantEdit } from './shared';
import { LocatorsList }  from './locators/LocatorsList';
import { WellsList }     from './wells/WellsList';
import { TrainsList }    from './trains/TrainsList';
import { PlantMeterConfigCard, CIPChemicalsSection } from './config/MeterConfig';
import { ProductMetersCard, ProductMetersStat }      from './config/ProductMeters';
import { PowerMetersCard }                           from './config/PowerMeters';
import { BackwashModeCard, EnergySourceCard, EnergySourceInline } from './config/Appearance';

export default function Plants() {
  const { id } = useParams();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isManager, profile, user: currentUser } = useAuth();

  // Non-managers only see plants they are assigned to.
  // Managers/Admins see all plants. Sign-up uses its own direct query, unaffected.
  const visiblePlants = isManager
    ? plants
    : plants?.filter(p => profile?.plant_assignments?.includes(p.id));

  const list = selectedPlantId
    ? visiblePlants?.filter(p => p.id === selectedPlantId)
    : visiblePlants;
  const navigate = useNavigate();

  // Summary counts: active/total per plant for Wells, Locators, RO Trains.
  //
  // "Active" here means "commissioned AND actually reporting data" for all
  // three metrics — not just "commissioned". Trains already worked this way
  // (status !== 'Maintenance' AND a reading in the last 2h). Wells and
  // locators used to count as active purely from their `status` column,
  // which is a manual, admin-set commissioning flag (see toggleWellStatus /
  // logStatusChange in WellsList.tsx) that has nothing to do with whether
  // the meter is still reporting — so a plant whose wells/locators had gone
  // completely silent for days still showed 100% healthy here, because
  // nobody had manually flipped anything to Inactive. Fixed by requiring a
  // reading inside STALE_READING_HOURS too, read from well_readings_latest /
  // locator_readings_latest — the same views and the same cutoff the
  // per-row "Last reading" freshness badges in WellsList/LocatorsList use,
  // so this ring and those badges can never disagree with each other.
  const { data: summaryCounts } = useQuery({
    queryKey: ['plants-summary-counts'],
    queryFn: async () => {
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      const staleCutoff = new Date(Date.now() - STALE_READING_HOURS * 60 * 60 * 1000).toISOString();

      const [
        wellsRes, locatorsRes, trainsRes, recentReadingsRes,
        wellLatestRes, locatorLatestRes,
      ] = await Promise.all([
        supabase.from('wells').select('id, plant_id, status'),
        supabase.from('locators').select('id, plant_id, status'),
        supabase.from('ro_trains').select('id, plant_id, status'),
        // Only fetch train_ids that have had a reading in the last 2 hours
        supabase.from('ro_train_readings')
          .select('train_id')
          .gte('reading_datetime', twoHoursAgo),
        // One row per well/locator (most recent reading only) — cheap
        // enough to fetch in full and filter client-side against the
        // staleness cutoff below. Not in the generated Database types (same
        // as WellsList.tsx/LocatorsList.tsx's use of these same views), so
        // the cast is confined to these two lines rather than repeated in
        // every callback below.
        (supabase.from('well_readings_latest' as any) as any).select('well_id, reading_datetime'),
        (supabase.from('locator_readings_latest' as any) as any).select('locator_id, reading_datetime'),
      ]);

      // Set of train IDs with a recent (<=2h) reading
      const recentSet = new Set((recentReadingsRes.data ?? []).map((r: any) => r.train_id));

      const wellLatest    = (wellLatestRes.data    ?? []) as { well_id: string; reading_datetime: string }[];
      const locatorLatest = (locatorLatestRes.data ?? []) as { locator_id: string; reading_datetime: string }[];

      // well_id / locator_id -> still-fresh (<=STALE_READING_HOURS) reading?
      const freshWellSet = new Set(
        wellLatest.filter((r) => r.reading_datetime >= staleCutoff).map((r) => r.well_id),
      );
      const freshLocatorSet = new Set(
        locatorLatest.filter((r) => r.reading_datetime >= staleCutoff).map((r) => r.locator_id),
      );

      type Summary = Record<string, { active: number; total: number }>;
      const tally = (
        rows: { id: string; plant_id: string; status: string }[],
        freshSet: Set<string>,
      ): Summary => {
        const out: Summary = {};
        rows.forEach((r) => {
          if (!out[r.plant_id]) out[r.plant_id] = { active: 0, total: 0 };
          out[r.plant_id].total++;
          if (r.status === 'Active' && freshSet.has(r.id)) out[r.plant_id].active++;
        });
        return out;
      };

      // Trains use the same 2-hour data rule as ROTrains.tsx deriveTrainStatus:
      //   Maintenance => Maintenance (hard lock) | recent data => Running | else Offline
      const trainTally: Summary = {};
      for (const t of (trainsRes.data ?? []) as any[]) {
        if (!trainTally[t.plant_id]) trainTally[t.plant_id] = { active: 0, total: 0 };
        trainTally[t.plant_id].total++;
        const isRunning = t.status !== 'Maintenance' && recentSet.has(t.id);
        if (isRunning) trainTally[t.plant_id].active++;
      }

      return {
        wells:    tally(wellsRes.data    ?? [], freshWellSet),
        locators: tally(locatorsRes.data ?? [], freshLocatorSet),
        trains:   trainTally,
      };
    },
    // Re-check every minute so the 2-hr / 48-hr windows flip automatically
    refetchInterval: 60_000,
  });

  // ── Search / filter state ─────────────────────────────────────────────────
  // IMPORTANT: These useState calls MUST stay above the `if (id) return` early
  // return below. Moving them after it caused React error #300 ("rendered fewer
  // hooks than expected") because navigating list → detail changed the hook count
  // within the same component instance. All hooks must be called unconditionally.
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [addPlantBusy, setAddPlantBusy] = useState(false);
  const qc = useQueryClient();

  const doAddPlant = async (form: AddPlantFormData) => {
    if (!form.name.trim()) { toast.error('Plant name is required.'); return; }
    setAddPlantBusy(true);
    const { data, error } = await supabase.from('plants').insert({
      name: form.name.trim(),
      address: form.address.trim() || null,
      design_capacity_m3: form.design_capacity_m3 === '' ? null : Number(form.design_capacity_m3),
      filter_housing_type: form.filter_housing_type,
      filter_media_type: form.filter_media_type,
    }).select('id').single();
    setAddPlantBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Plant added');
    await logPlantEdit({
      plant_id: data!.id,
      user_id: currentUser?.id ?? null,
      field_changed: 'created',
      old_value: null,
      new_value: form.name.trim(),
      timestamp: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ['plants'] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    setShowAddPlant(false);
    navigate(`/plants/${data!.id}`);
  };

  if (id) return <PlantDetail plantId={id} />;

  // ── Derived header stats ──────────────────────────────────────────────────
  const totalCapacity = list?.reduce((s, p) => s + (p.design_capacity_m3 ?? 0), 0) ?? 0;
  const activePlants  = list?.filter(p => p.status === 'Active').length ?? 0;

  // RO train utilisation across all visible plants
  const allTrainCounts = Object.values(summaryCounts?.trains ?? {});
  const totalTrainsActive = allTrainCounts.reduce((s, c) => s + c.active, 0);
  const totalTrainsTotal  = allTrainCounts.reduce((s, c) => s + c.total,  0);
  const roUtilPct = totalTrainsTotal > 0
    ? Math.round((totalTrainsActive / totalTrainsTotal) * 100)
    : 0;

  // ── Per-plant health score (average of wells/locators/trains utilisation) ─
  function plantHealthScore(wells: { active: number; total: number }, locators: { active: number; total: number }, trains: { active: number; total: number }) {
    const scores = [
      wells.total    > 0 ? Math.round((wells.active    / wells.total)    * 100) : 0,
      locators.total > 0 ? Math.round((locators.active / locators.total) * 100) : 0,
      trains.total   > 0 ? Math.round((trains.active   / trains.total)   * 100) : 0,
    ];
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  // Average health across all listed plants
  const avgHealth = list?.length
    ? Math.round(
        list.reduce((sum, p) => {
          const w = summaryCounts?.wells?.[p.id]    ?? { active: 0, total: 0 };
          const l = summaryCounts?.locators?.[p.id] ?? { active: 0, total: 0 };
          const t = summaryCounts?.trains?.[p.id]   ?? { active: 0, total: 0 };
          return sum + plantHealthScore(w, l, t);
        }, 0) / list.length,
      )
    : 0;

  // ── Per-plant identity colours (teal-cyan palette) ───────────────────────
  // Each plant gets a unique colour that drives: left accent strip, capacity
  // block tint, capacity number, and health ring — all from one value.
  // Falls back to a round-robin palette for plants not in the map.
  const PLANT_COLOR_MAP: Record<string, string> = {
    'Guizo':     'hsl(var(--plant-1))',
    'Mambaling': 'hsl(var(--plant-2))',
    'SRP':       'hsl(var(--plant-3))',
    'Umapad':    'hsl(var(--plant-4))',
  };
  const PLANT_COLOR_PALETTE = [
    'hsl(var(--plant-1))', 'hsl(var(--plant-2))', 'hsl(var(--plant-3))',
    'hsl(var(--plant-4))', 'hsl(var(--plant-5))', 'hsl(var(--plant-6))',
  ];

  function getPlantColor(plant: any, index: number): string {
    if ((plant as any).color) return (plant as any).color;
    return PLANT_COLOR_MAP[plant.name] ?? PLANT_COLOR_PALETTE[index % PLANT_COLOR_PALETTE.length];
  }

  // ── Colour helpers ────────────────────────────────────────────────────────
  // Metric chip semantics: ≥75% teal (good), 40–74% sky (mid), <40% red (danger)
  function statBarColor(active: number, total: number): { bar: string; textColor: string; bg: string; border: string; dot: string } {
    if (total === 0) return { bar: 'bg-muted', textColor: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border/40', dot: 'hsl(var(--muted-foreground))' };
    const r = active / total;
    if (r >= 0.75) return { bar: 'bg-primary',  textColor: 'text-primary',  bg: 'bg-primary-soft',  border: 'border-primary',  dot: 'hsl(var(--primary))' };
    if (r >= 0.4)  return { bar: 'bg-info',   textColor: 'text-info',    bg: 'bg-info-soft',    border: 'border-info',    dot: 'hsl(var(--info))' };
    return                { bar: 'bg-danger',   textColor: 'text-danger',    bg: 'bg-danger-soft',    border: 'border-danger',    dot: 'hsl(var(--danger))' };
  }

  function roUtilColors(pct: number) {
    if (pct >= 75) return { text: 'text-primary', bg: 'bg-primary-soft', border: 'border-primary' };
    if (pct >= 40) return { text: 'text-info',   bg: 'bg-info-soft',   border: 'border-info'   };
    return               { text: 'text-danger',   bg: 'bg-danger-soft',   border: 'border-danger'   };
  }

  // ── Sub-components (defined inside Plants so they share scope) ────────────

  function PlantStatRow({ icon, label, active, total }: { icon: ReactNode; label: string; active: number; total: number }) {
    const p      = total > 0 ? Math.round((active / total) * 100) : 0;
    const colors = statBarColor(active, total);
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground font-medium">
            {icon}{label}
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-medium text-foreground">
              {active}<span className="text-muted-foreground font-normal">/{total}</span>
            </span>
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${colors.textColor} ${colors.bg} border ${colors.border}`}>
              {p}%
            </span>
          </span>
        </div>
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
            style={{ width: total > 0 ? `${p}%` : '0%' }}
          />
        </div>
      </div>
    );
  }

  // ── Plant radial gauge — Wells / Locators / RO Trains as ONE concentric
  // radial-bar chart instead of three side-by-side rings. Layers read
  // outer → inner: RO Trains → Locators → Wells, with the plant's combined
  // score in the centre (same average as plantHealthScore, above). Colour
  // still comes from the --kpi-wells / --kpi-locator / --kpi-ro CSS vars,
  // so it stays in sync with dark mode and any future theme swap.
  //
  // Below 64px three bands stop being legible, so it falls back to a single
  // status-coloured ring — at that size the per-metric numbers are already
  // shown next to it via MetricChip / PlantStatRow, so nothing is lost.
  function MetricRingGroup({ wells, locators, trains, size = 56, showLegend = false }: {
    wells: { active: number; total: number };
    locators: { active: number; total: number };
    trains: { active: number; total: number };
    size?: number;
    showLegend?: boolean;
  }) {
    const uid = useId();
    const pct = (m: { active: number; total: number }) => m.total > 0 ? Math.round((m.active / m.total) * 100) : 0;
    const overall = Math.round((pct(wells) + pct(locators) + pct(trains)) / 3);

    // ── Compact fallback (<64px): one combined ring, status-coloured ──
    if (size < 64) {
      const color = overall >= 75 ? 'hsl(var(--primary))' : overall >= 40 ? 'hsl(var(--info))' : 'hsl(var(--danger))';
      const strokeW = 4;
      const cx = size / 2, cy = size / 2;
      const r = cx - strokeW - 1;
      const circ = 2 * Math.PI * r;
      const dash = (overall / 100) * circ;
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0"
          role="img" aria-label={`Overall plant health ${overall} percent`}>
          <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeW} stroke="currentColor" className="text-muted/50" />
          <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeW} stroke={color}
            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4}
            strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 9, fontWeight: 700, fill: color }}>{overall}%</text>
        </svg>
      );
    }

    // Layer order, outer → inner. Add a fourth entry here if another
    // trackable metric ever joins wells/locators/trains in summaryCounts.
    const layers = [
      { key: 'trains',   label: 'RO Trains', icon: <ROTrainIcon className="h-3 w-3" />, value: trains,   hueVar: '--kpi-ro' },
      { key: 'locators', label: 'Locators',  icon: <MapPin className="h-3 w-3" />,       value: locators, hueVar: '--kpi-locator' },
      { key: 'wells',    label: 'Wells',     icon: <Droplet className="h-3 w-3" />,      value: wells,    hueVar: '--kpi-wells' },
    ];

    const strokeW = Math.max(4, Math.round(size * 0.075));
    const gap = Math.max(2, Math.round(strokeW * 0.55));
    const cx = size / 2, cy = size / 2;
    const showCaption = size >= 80;

    return (
      <div className="flex items-center gap-4 shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={`Overall ${overall} percent. RO Trains ${pct(trains)} percent, Locators ${pct(locators)} percent, Wells ${pct(wells)} percent.`}>
          <defs>
            {layers.map((l) => (
              <linearGradient key={l.key} id={`ringGrad-${uid}-${l.key}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={`hsl(var(${l.hueVar}) / 0.6)`} />
                <stop offset="100%" stopColor={`hsl(var(${l.hueVar}))`} />
              </linearGradient>
            ))}
          </defs>
          {layers.map((l, i) => {
            const r = cx - strokeW / 2 - 2 - i * (strokeW + gap);
            const circ = 2 * Math.PI * r;
            const p = pct(l.value);
            const dash = (p / 100) * circ;
            return (
              <g key={l.key}>
                {/* Track */}
                <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeW}
                  stroke="currentColor" className="text-muted/40" />
                {/* Progress arc */}
                <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeW}
                  stroke={`url(#ringGrad-${uid}-${l.key})`}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={circ / 4}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{ transition: 'stroke-dasharray 0.6s ease', filter: `drop-shadow(0 0 3px hsl(var(${l.hueVar}) / 0.4))` }}
                />
              </g>
            );
          })}
          <text x={cx} y={cy - (showCaption ? size * 0.05 : 0)} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: size * 0.2, fontWeight: 800, fill: 'hsl(var(--foreground))' }}>
            {overall}%
          </text>
          {showCaption && (
            <text x={cx} y={cy + size * 0.16} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: size * 0.062, fontWeight: 700, letterSpacing: '0.08em', fill: 'hsl(var(--muted-foreground))' }}>
              OVERALL
            </text>
          )}
        </svg>

        {/* Optional legend — skip where MetricChip/PlantStatRow already show these numbers */}
        {showLegend && size >= 96 && (
          <div className="flex flex-col gap-2.5" style={{ minWidth: 120 }}>
            {layers.map((l) => {
              const p = pct(l.value);
              return (
                <div key={l.key} className="flex items-center gap-2 text-xs">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: `hsl(var(${l.hueVar}))` }} />
                  {l.icon}
                  <span className="flex-1 truncate text-muted-foreground">{l.label}</span>
                  <span className="font-mono font-semibold text-foreground">{l.value.active}/{l.value.total}</span>
                  <span className="font-bold text-right" style={{ color: `hsl(var(${l.hueVar}))`, width: 36 }}>{p}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const filteredList = list?.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const roColors = roUtilColors(roUtilPct);

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Plants</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {list?.length ?? 0} plant{(list?.length ?? 0) !== 1 ? 's' : ''} · {activePlants} active
          </p>
        </div>

        {/* Summary pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Total capacity */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 bg-background text-xs">
            <Droplet className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground">Total capacity</span>
            <span className="font-semibold text-foreground">{fmtNum(totalCapacity)} MLD</span>
          </div>

          {/* RO util — colour-coded */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${roColors.bg} ${roColors.border}`}>
            <ROTrainIcon className={`h-3.5 w-3.5 shrink-0 ${roColors.text}`} />
            <span className={roColors.text}>RO train util.</span>
            <span className={`font-semibold ${roColors.text}`}>{roUtilPct}%</span>
          </div>

          {/* Avg plant health */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
            avgHealth >= 75
              ? 'bg-primary-soft border-primary'
              : avgHealth >= 40
                ? 'bg-info-soft border-info'
                : 'bg-danger-soft border-danger'
          }`}>
            <TrendingUp className={`h-3.5 w-3.5 shrink-0 ${
              avgHealth >= 75 ? 'text-primary'
              : avgHealth >= 40 ? 'text-info'
              : 'text-danger'
            }`} />
            <span className={
              avgHealth >= 75 ? 'text-primary'
              : avgHealth >= 40 ? 'text-info'
              : 'text-danger'
            }>
              Avg. health
            </span>
            <span className={`font-semibold ${
              avgHealth >= 75 ? 'text-primary'
              : avgHealth >= 40 ? 'text-info'
              : 'text-danger'
            }`}>
              {avgHealth}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Search + filter bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
            <Search className="h-3.5 w-3.5" aria-hidden />
          </span>
          <input
            type="text"
            placeholder="Search plants…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {(['all', 'Active', 'Inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`h-8 px-3 rounded-md text-xs font-medium transition-colors border ${
              statusFilter === f
                ? 'bg-primary text-white border-primary'
                : 'bg-background text-muted-foreground border-border/60 hover:bg-muted/60'
            }`}
          >
            {f === 'all' ? `All (${list?.length ?? 0})` : f}
          </button>
        ))}
        {isManager && (
          <Button size="sm" className="h-8 ml-auto gap-1.5" onClick={() => setShowAddPlant(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add Plant
          </Button>
        )}
      </div>

      {/* ── Plant list ── */}
      <div className="stagger-grid space-y-2.5">
        {filteredList?.map((p, idx) => {
          const wells    = summaryCounts?.wells?.[p.id]    ?? { active: 0, total: 0 };
          const locators = summaryCounts?.locators?.[p.id] ?? { active: 0, total: 0 };
          const trains   = summaryCounts?.trains?.[p.id]   ?? { active: 0, total: 0 };
          const isActive = p.status === 'Active';
          const plantColor = getPlantColor(p, idx);

          // ── Metric chip — no box background, semantic colour on text+dot only ──
          function MetricChip({ icon, label, active, total }: { icon: ReactNode; label: string; active: number; total: number }) {
            const colors = statBarColor(active, total);
            const pct = total > 0 ? Math.round((active / total) * 100) : 0;
            return (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-muted/20 p-3 min-w-[90px] flex-1">
                <div className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {icon}
                  {label}
                </div>
                <div className="font-mono text-base font-bold leading-none" style={{ color: plantColor }}>
                  {active}
                  <span className="text-muted-foreground font-normal text-sm">/{total}</span>
                </div>
                <div className="flex items-center gap-1 text-xs font-semibold">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: colors.dot }} />
                  <span className={colors.textColor}>{pct}%</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className="group relative flex overflow-hidden rounded-xl border border-border/60 bg-card hover:shadow-md transition-all duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              style={{ ['--plant-color' as any]: plantColor }}
              onClick={() => navigate(`/plants/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/plants/${p.id}`); }
              }}
              data-testid={`plant-card-${p.id}`}
            >
              {/* Left accent stripe — plant identity colour */}
              <div className="w-1 shrink-0 transition-all duration-200 group-hover:w-[5px]" style={{ backgroundColor: plantColor }} />

              {/* ── DESKTOP layout (md+) ── */}
              <div className="hidden md:flex flex-1 min-w-0">

                {/* Capacity block — no box background, just the coloured text */}
                <div className="flex flex-col justify-center items-center m-3 shrink-0 w-[100px]">
                  <div
                    className="text-5xl font-bold leading-none tracking-tight"
                    style={{ color: plantColor }}
                  >
                    {fmtNum(p.design_capacity_m3 ?? 0)}
                  </div>
                  <div className="text-xs font-semibold mt-1 uppercase tracking-wider" style={{ color: plantColor }}>
                    MLD
                  </div>
                  <div className="text-2xs font-medium text-muted-foreground mt-0.5 uppercase tracking-widest">
                    CAPACITY
                  </div>
                </div>

                {/* Right section: name/address top → chips + Active + health bottom */}
                <div className="flex-1 min-w-0 flex flex-col py-3 pr-4 pl-1">

                  {/* Name + address — top of right section */}
                  <div className="mb-auto min-w-0">
                    <h2 className="font-bold text-lg leading-tight truncate">{p.name}</h2>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.address}</span>
                    </p>
                  </div>

                  {/* Bottom row: chips + Active/dots + health ring — all vertically aligned */}
                  <div className="flex items-stretch gap-2 mt-3">
                    <MetricChip icon={<Droplet  className="h-3 w-3" />} label="Wells"     active={wells.active}    total={wells.total}    />
                    <MetricChip icon={<MapPin  className="h-3 w-3" />} label="Locators"  active={locators.active} total={locators.total} />
                    <MetricChip icon={<ROTrainIcon  className="h-3 w-3" />} label="RO Trains" active={trains.active}   total={trains.total}   />

                    {/* Active status + menu — inline with chips, no box */}
                    <div
                      className="flex flex-col items-center justify-center gap-1 px-1 shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      <span className={`text-sm font-medium whitespace-nowrap ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                        {p.status}
                      </span>
                      {isManager && (
                        <DeleteEntityMenu
                          kind="plant"
                          id={p.id}
                          label={p.name}
                          canSoftDelete={isActive}
                          canHardDelete
                          invalidateKeys={[['plants']]}
                          compact
                        />
                      )}
                    </div>

                    {/* Metric rings — Wells / Locators / RO Trains coverage */}
                    <div className="flex items-center justify-center pl-1 shrink-0">
                      <MetricRingGroup wells={wells} locators={locators} trains={trains} size={88} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── MOBILE layout (< md): original compact stat-bar design ── */}
              <div className="md:hidden flex-1 min-w-0 p-4">
                {/* Top row: name + address + status + menu */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-base leading-tight">{p.name}</h2>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.address}</span>
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                      isActive
                        ? 'bg-primary-soft text-primary border-primary'
                        : 'bg-muted text-muted-foreground border-border/60'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isActive ? plantColor : undefined, opacity: isActive ? 1 : 0.4 }} />
                      {p.status}
                    </span>
                    {isManager && (
                      <DeleteEntityMenu
                        kind="plant"
                        id={p.id}
                        label={p.name}
                        canSoftDelete={isActive}
                        canHardDelete
                        invalidateKeys={[['plants']]}
                        compact
                      />
                    )}
                  </div>
                </div>

                {/* Body: capacity | stat bars | health ring */}
                <div className="grid gap-3 items-center" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                  <div className="border-r border-border/50 pr-3 flex flex-col justify-center min-w-[72px]">
                    <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Capacity</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-semibold leading-none" style={{ color: plantColor }}>
                        {fmtNum(p.design_capacity_m3 ?? 0)}
                      </span>
                      <span className="text-xs text-muted-foreground">MLD</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 min-w-0">
                    <PlantStatRow icon={<Droplet  className="h-3 w-3" />} label="Wells"     active={wells.active}    total={wells.total}    />
                    <PlantStatRow icon={<MapPin  className="h-3 w-3" />} label="Locators"  active={locators.active} total={locators.total} />
                    <PlantStatRow icon={<ROTrainIcon  className="h-3 w-3" />} label="RO trains" active={trains.active}   total={trains.total}   />
                  </div>
                  <div className="hidden sm:flex items-end pl-2">
                    <MetricRingGroup wells={wells} locators={locators} trains={trains} size={34} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Empty state: no plants visible at all */}
        {!list?.length && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border/60">
            <Droplet className="h-8 w-8 opacity-30" />
            <span>No plants visible</span>
          </div>
        )}

        {/* Empty state: search/filter returned nothing */}
        {!!list?.length && !filteredList?.length && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border/60">
            <Search className="h-8 w-8 opacity-30" strokeWidth={1.5} aria-hidden />
            <span>No plants match your search</span>
            <button
              className="text-xs text-primary underline underline-offset-2 hover:no-underline"
              onClick={() => { setSearch(''); setStatusFilter('all'); }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <AddPlantDialog
        open={showAddPlant}
        onOpenChange={setShowAddPlant}
        onSubmit={doAddPlant}
        loading={addPlantBusy}
      />
    </div>
  );
}

function PlantDetail({ plantId }: { plantId: string }) {
  const navigate = useNavigate();
  const { data: plants } = usePlants();
  const { isManager, user } = useAuth();
  const qc = useQueryClient();
  const plant = plants?.find(p => p.id === plantId);

  // URL-synced tab (mirrors pages/operations/index.tsx's pattern) so a link
  // from Operations — "Open this locator in Plant detail" — has somewhere
  // reliable to land, and so the tab survives a refresh or the back button.
  type PlantTab = 'locators' | 'wells' | 'product' | 'trains' | 'power' | 'configuration';
  const VALID_PLANT_TABS = new Set<PlantTab>(['locators', 'wells', 'product', 'trains', 'power', 'configuration']);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as PlantTab | null;
  const [tab, setTabState] = useState<PlantTab>(urlTab && VALID_PLANT_TABS.has(urlTab) ? urlTab : 'locators');
  useEffect(() => {
    if (urlTab && VALID_PLANT_TABS.has(urlTab) && urlTab !== tab) setTabState(urlTab);
  }, [urlTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (next: PlantTab) => {
    setTabState(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    // Switching tabs by hand clears any pending highlight from a previous link.
    sp.delete('highlight');
    setSearchParams(sp, { replace: true });
  };
  // Which card to scroll to and briefly highlight after landing here via a
  // cross-navigation link (currently only Locators sends one — see
  // LocatorSection.tsx's "Plant detail" button).
  const highlightId = searchParams.get('highlight');
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: '', address: '', capacity: '' });

  // RO Train active/total count for this plant — uses the same 2-hr data rule as the Overview tab
  const { data: trainCounts } = useQuery({
    queryKey: ['ro-trains-count', plantId],
    queryFn: async () => {
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      const { data: trains } = await supabase
        .from('ro_trains').select('id, status').eq('plant_id', plantId);
      const total = trains?.length ?? 0;
      if (!total) return { active: 0, total: 0 };
      const trainIds = trains!.map((t: any) => t.id);
      const { data: recentReadings } = await supabase
        .from('ro_train_readings')
        .select('train_id')
        .in('train_id', trainIds)
        .gte('reading_datetime', twoHoursAgo);
      const recentSet = new Set((recentReadings ?? []).map((r: any) => r.train_id));
      const active = trains!.filter((t: any) =>
        t.status !== 'Maintenance' && recentSet.has(t.id)
      ).length;
      return { active, total };
    },
  });

  if (!plant) return <div>Plant not found.</div>;

  const openInfoEdit = () => {
    setInfoForm({
      name: plant.name ?? '',
      address: plant.address ?? '',
      capacity: plant.design_capacity_m3 != null ? String(plant.design_capacity_m3) : '',
    });
    setEditingInfo(true);
  };

  const saveInfo = async () => {
    setInfoSaving(true);
    const payload: Record<string, any> = {};
    const changes: { field: string; old: string | null; next: string | null }[] = [];

    if (infoForm.name.trim() !== (plant.name ?? '')) {
      changes.push({ field: 'name', old: plant.name ?? null, next: infoForm.name.trim() || null });
      payload.name = infoForm.name.trim() || null;
    }
    if (infoForm.address.trim() !== (plant.address ?? '')) {
      changes.push({ field: 'address', old: plant.address ?? null, next: infoForm.address.trim() || null });
      payload.address = infoForm.address.trim() || null;
    }
    const newCap = infoForm.capacity ? parseFloat(infoForm.capacity) : null;
    if (newCap !== (plant.design_capacity_m3 ?? null)) {
      changes.push({ field: 'design_capacity_m3', old: plant.design_capacity_m3 != null ? String(plant.design_capacity_m3) : null, next: newCap != null ? String(newCap) : null });
      payload.design_capacity_m3 = newCap;
    }

    if (!Object.keys(payload).length) { setEditingInfo(false); setInfoSaving(false); return; }

    const { error } = await supabase.from('plants').update(payload as any).eq('id', plant.id);
    setInfoSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }

    // Audit each changed field
    const now = new Date().toISOString();
    await Promise.all(
      changes.map((c) =>
        logPlantEdit({
          plant_id: plant.id,
          user_id: user?.id ?? null,
          field_changed: c.field,
          old_value: c.old,
          new_value: c.next,
          timestamp: now,
        }),
      ),
    );

    toast.success('Plant details updated');
    setEditingInfo(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
    qc.invalidateQueries({ queryKey: ['ro-trains-count', plantId] });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Back nav */}
      <button onClick={() => navigate('/plants')}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ChevronLeft className="h-4 w-4" /> All plants
      </button>

      {/* Hero card */}
      <Card className="p-4 bg-gradient-stat text-topbar-foreground overflow-hidden">

        {/* Top row: Name/address (left) + Status pill + Edit + Delete (right) */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Name + address */}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight">{plant.name}</h1>
            <p className="text-xs opacity-60 flex items-center gap-1 mt-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{plant.address}</span>
            </p>
          </div>

          {/* Status pill + Edit + Delete — now in normal flow, never overlaps */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <span className={[
              'text-xs font-semibold px-3 py-1 rounded-full border',
              plant.status === 'Active'
                ? 'bg-accent/20 text-accent border-accent/30'
                : 'bg-warn/20 text-warn border-warn/30',
            ].join(' ')}>
              Status: <span className="font-bold">{plant.status}</span>
            </span>
            {isManager && (
              <Button size="sm" variant="ghost"
                onClick={openInfoEdit}
                data-testid="edit-plant-info-btn"
                className="h-8 gap-1.5 bg-white/15 hover:bg-white/25 text-white border border-white/30 rounded-lg text-xs font-medium">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            {isManager && (
              // text-[0px] here isn't a body/label text size (not part of the
              // text-3xs/2xs type scale) — it's a mobile-collapse trick that
              // visually hides the button label below `sm:`, replaced by
              // sm:text-xs above that breakpoint. Icon stays visible either way.
              <div className="flex items-center justify-center [&>button]:bg-white/15 [&>button]:hover:bg-white/25 [&>button]:text-white [&>button]:border [&>button]:border-white/30 [&>button]:rounded-lg [&_svg]:text-white [&>button]:h-8 [&>button]:w-8 [&>button]:p-0 [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center [&>button]:text-[0px] [&>button]:sm:w-auto [&>button]:sm:px-3 [&>button]:sm:text-xs [&>button]:sm:gap-1.5">
                <DeleteEntityMenu
                  kind="plant" id={plant.id} label={plant.name}
                  canSoftDelete={plant.status === 'Active'} canHardDelete
                  invalidateKeys={[['plants']]} onDeleted={() => navigate('/plants')}
                />
              </div>
            )}
          </div>
        </div>

        {/* Stats: Capacity / RO Trains / Product Meters */}
        <div className="grid grid-cols-3 gap-4 mt-4 text-xs">
          <div>
            <div className="opacity-50 text-2xs uppercase tracking-widest mb-1">Capacity</div>
            <div className="font-mono-num text-lg font-bold">{fmtNum(plant.design_capacity_m3 ?? 0)} MLD</div>
          </div>
          <div>
            <div className="opacity-50 text-2xs uppercase tracking-widest mb-1">RO Trains</div>
            <div className="font-mono-num text-lg font-bold">
              {trainCounts ? (
                <>
                  <span className={
                    trainCounts.active === trainCounts.total && trainCounts.total > 0
                      ? 'text-accent'
                      : trainCounts.active === 0 && trainCounts.total > 0
                        ? 'text-warn' : ''
                  }>{trainCounts.active}</span>
                  <span className="opacity-40 font-normal text-base">/{trainCounts.total}</span>
                </>
              ) : (plant.num_ro_trains ?? '—')}
            </div>
            <div className="opacity-40 text-2xs mt-0.5">active / total</div>
          </div>
          <div>
            <div className="opacity-50 text-2xs uppercase tracking-widest mb-1">Product Meters</div>
            <ProductMetersStat plantId={plant.id} />
          </div>
        </div>

        {/* Energy Sources */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <EnergySourceInline plant={plant} />
        </div>
      </Card>

      {/* Plant Configuration Settings — promoted to its own tab (Section 7.2); see the
          'configuration' tab content further down instead of always-visible here. */}

      {/* Edit Plant Info Dialog */}
      {editingInfo && (
        <Dialog open onOpenChange={(o) => { if (!o && !infoSaving) setEditingInfo(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Plant Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs">Plant Name</Label>
                <Input
                  value={infoForm.name}
                  onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                  placeholder="e.g. SRP"
                  data-testid="edit-plant-name"
                />
              </div>
              <div>
                <Label className="text-xs">Address</Label>
                <Input
                  value={infoForm.address}
                  onChange={(e) => setInfoForm({ ...infoForm, address: e.target.value })}
                  placeholder="e.g. South Road Properties, Cebu City"
                  data-testid="edit-plant-address"
                />
              </div>
              <div>
                <Label className="text-xs">Capacity (MLD)</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={infoForm.capacity}
                  onChange={(e) => setInfoForm({ ...infoForm, capacity: e.target.value })}
                  placeholder="e.g. 4200"
                  data-testid="edit-plant-capacity"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingInfo(false)} disabled={infoSaving}>Cancel</Button>
              <Button onClick={saveInfo} disabled={infoSaving} data-testid="save-plant-info-btn">
                {infoSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="grid grid-cols-6 gap-0.5 p-1 bg-muted rounded-lg w-full">
        {([
          { id: 'locators', label: 'Locators', short: 'LOC', icon: <MapPin className="h-3.5 w-3.5" /> },
          { id: 'wells', label: 'Wells', short: 'WELL', icon: <Droplet className="h-3.5 w-3.5" /> },
          { id: 'product', label: 'Product', short: 'PROD', icon: <Gauge className="h-3.5 w-3.5" /> },
          { id: 'trains', label: 'Trains', short: 'RO', icon: <ROTrainIcon className="h-3.5 w-3.5" /> },
          { id: 'power', label: 'Power', short: 'PWR', icon: <Zap className="h-3.5 w-3.5" /> },
          { id: 'configuration', label: 'Configuration', short: 'CONFIG', icon: <Settings2 className="h-3.5 w-3.5" /> },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'py-1.5 px-1 flex flex-col sm:flex-row items-center justify-center gap-1 text-xs font-medium rounded-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-0',
              tab === t.id
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t.icon}
            <span className="hidden sm:inline truncate">{t.label}</span>
            <span className="sm:hidden text-3xs font-semibold tracking-wide">{t.short}</span>
          </button>
        ))}
      </div>

      <div className={tab === 'locators' ? undefined : 'hidden'}><LocatorsList plantId={plantId} highlightId={tab === 'locators' ? highlightId : null} /></div>
      <div className={tab === 'wells'    ? undefined : 'hidden'}><WellsList plantId={plantId} highlightId={tab === 'wells' ? highlightId : null} /></div>
      <div className={tab === 'product'  ? undefined : 'hidden'}><ProductMetersCard plant={plant} highlightId={tab === 'product' ? highlightId : null} /></div>
      <div className={tab === 'trains'   ? undefined : 'hidden'}>
        <TrainsList plantId={plantId} />
      </div>
      <div className={tab === 'power'    ? undefined : 'hidden'}><PowerMetersCard plant={plant} /></div>
      <div className={tab === 'configuration' ? undefined : 'hidden'}><PlantMeterConfigCard plant={plant} /></div>
    </div>
  );
}

// ─── Add Plant ──────────────────────────────────────────────────────────────
// Deliberately minimal, matching AddTrainDialog's philosophy: the fields other
// parts of the app assume are always set (name, filter_housing_type,
// filter_media_type — see the Plant interface in hooks/usePlants.ts, neither
// filter field is optional there) plus the two most-referenced identifying
// fields (address, design_capacity_m3). Solar/grid, backwash mode, GPS,
// geofence, and RO train setup are all configured after creation via the
// existing Plant Config / Energy Source / Add RO Train flows — same
// "quick add, configure details later" split AddTrainDialog already uses.
export interface AddPlantFormData {
  name: string;
  address: string;
  design_capacity_m3: number | '';
  filter_housing_type: 'Cartridge Filter' | 'Bag Filter';
  filter_media_type: 'AFM' | 'MMF';
}

function AddPlantDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (form: AddPlantFormData) => void;
  loading: boolean;
}) {
  const blank = (): AddPlantFormData => ({
    name: '', address: '', design_capacity_m3: '',
    filter_housing_type: 'Cartridge Filter', filter_media_type: 'AFM',
  });
  const [form, setForm] = useState<AddPlantFormData>(blank);

  useEffect(() => {
    if (open) setForm(blank());
  }, [open]);

  const canSubmit = form.name.trim().length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Plant</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Plant Name</Label>
            <Input placeholder="e.g. Mambaling WTP" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onSubmit(form); }} />
          </div>
          <div>
            <Label>Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input placeholder="e.g. Brgy. San Isidro, Iloilo City" value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div>
            <Label>Design Capacity <span className="text-muted-foreground text-xs">(optional, MLD)</span></Label>
            <Input type="number" min={0} step="0.1" placeholder="e.g. 5.0"
              value={form.design_capacity_m3}
              onChange={e => setForm(f => ({
                ...f, design_capacity_m3: e.target.value === '' ? '' : Number(e.target.value),
              }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Filter Housing</Label>
              <Select value={form.filter_housing_type}
                onValueChange={(v: 'Cartridge Filter' | 'Bag Filter') =>
                  setForm(f => ({ ...f, filter_housing_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cartridge Filter">Cartridge Filter</SelectItem>
                  <SelectItem value="Bag Filter">Bag Filter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Filter Media</Label>
              <Select value={form.filter_media_type}
                onValueChange={(v: 'AFM' | 'MMF') => setForm(f => ({ ...f, filter_media_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AFM">AFM</SelectItem>
                  <SelectItem value="MMF">MMF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-2xs text-muted-foreground">
            Wells, locators, RO trains, and energy source are all added after the plant is created.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={() => onSubmit(form)} disabled={!canSubmit}>
            {loading ? 'Adding…' : 'Add Plant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
