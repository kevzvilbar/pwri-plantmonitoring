import { ChevronLeft, MapPin, Pencil, Droplets, Zap, Building2, Sun, Gauge } from 'lucide-react';
import { ROTrainIcon, GridPylonIcon } from '@/components/icons/water-icons';
import { Button } from '@/components/ui/button';
import { Lamp } from '@/components/ui/Lamp';
import { fmtNum } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { loadThresholds } from '@/pages/Compliance';
import { describeFreshness } from '@/shared/freshness';
import { useNow } from '@/hooks/useNow';
import { ProductMetersStat } from './config/ProductMeters';

interface PlantHeroBannerProps {
  plant: any;
  trainCounts?: { active: number; total: number };
  /** Latest reading across RO trains, wells, locators and product meters. `null` = unknown. */
  lastReadingAt?: Date | null;
  isManager?: boolean;
  onEdit: () => void;
  onBack: () => void;
  deleteButton?: React.ReactNode;
}

export function PlantHeroBanner({
  plant,
  trainCounts,
  lastReadingAt = null,
  isManager,
  onEdit,
  onBack,
  deleteButton,
}: PlantHeroBannerProps) {
  // Tick every 30 s so the freshness label advances without a refetch (P4-5).
  const now = useNow(30_000);
  // P4-3: map the per-plant reading timestamp to { label, tone } with the
  // shared thresholds — the same helper PlantListHeader uses.
  const freshness = describeFreshness(lastReadingAt ?? null, now.getTime());

  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', plant?.id || 'global'],
    queryFn: () => loadThresholds(plant?.id || 'global'),
    enabled: !!plant?.id,
    staleTime: 60_000,
  });

  const isOnline = plant.status === 'Active';
  const trainOnlinePct = trainCounts && trainCounts.total > 0
    ? Math.round((trainCounts.active / trainCounts.total) * 100)
    : null;

  return (
    <div className="space-y-3">
      {/* ── Breadcrumb & Top Command Bar ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors group"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>All Facilities</span>
          <span className="text-border">/</span>
          <span className="text-foreground">{plant.name}</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-muted-foreground hidden sm:inline">
            ID: {plant.id.slice(0, 8)}
          </span>
          {isManager && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                data-testid="edit-plant-info-btn"
                className="h-7 px-2.5 gap-1.5 text-xs font-medium bg-card shadow-2xs"
              >
                <Pencil className="h-3 w-3 text-primary" />
                <span>Edit Facility</span>
              </Button>
              {deleteButton}
            </div>
          )}
        </div>
      </div>

      {/* ── Facility Cockpit Hero (Impeccable: crisp 1px border, solid slate-900) ── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 text-white p-4 sm:p-5 relative overflow-hidden space-y-4 shadow-sm">
        {/* Top Row: Facility Tag + Name + Status Badge + Live Clock */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Building2 className="h-5 w-5 text-teal-400 shrink-0" />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-3xs font-mono font-bold px-2 py-0.5 rounded-md bg-slate-800 text-teal-300 border border-teal-500/30 uppercase tracking-wider">
                FACILITY COCKPIT
              </span>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {plant.name}
              </h1>
              <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-md border ${
                isOnline
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-950/80 text-amber-300 border-amber-500/40'
              }`}>
                {/* The admin-set facility status, stated plainly. It does not
                    pulse: a pulse in this hero now means one thing only —
                    the reading above is fresh. */}
                <Lamp tone={isOnline ? 'good' : 'warn'} size={6} />
                <span>{plant.status}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <p className="text-2xs text-slate-400 items-center gap-1.5 hidden md:flex">
              <MapPin className="h-3.5 w-3.5 text-teal-400/80 shrink-0" />
              <span className="truncate max-w-[260px]">{plant.address || 'Address unassigned'}</span>
            </p>
            <div className="flex items-center gap-2 font-mono text-2xs text-slate-300 self-start sm:self-auto tabular-nums">
              <Lamp
                tone={
                  freshness.tone === 'fresh' ? 'live'
                  : freshness.tone === 'aging' ? 'warn'
                  : freshness.tone === 'stale' ? 'danger'
                  : 'muted'
                }
                pulse={freshness.tone === 'fresh'}
                size={6}
              />
              <span className={
                freshness.tone === 'fresh' ? 'text-emerald-300 font-semibold'
                : freshness.tone === 'aging' ? 'text-amber-300 font-semibold'
                : freshness.tone === 'stale' ? 'text-rose-300 font-semibold'
                : 'text-slate-400 font-semibold'
              }>
                {freshness.tone === 'fresh' ? 'Live Telemetry'
                  : freshness.tone === 'unknown' ? 'No recent readings'
                  : freshness.tone === 'aging' ? 'Aging Data'
                  : 'Stale Data'}
              </span>
              {/* Unknown means there is no age to print: describeFreshness
                  returns "No recent readings" as the label too, and saying it
                  twice reads like a stutter. */}
              {freshness.tone !== 'unknown' && (
                <>
                  <span className="text-white/30">&bull;</span>
                  <span>{freshness.label}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Main Hero Metrics Grid (4 Pillars) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Pillar 1: Peak Extraction Capacity */}
          <div className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1.5">
            <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-teal-200/90">
              <Droplets className="h-3 w-3 text-cyan-400" />
              <span>Peak Extraction Capacity</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="readout-num readout-glow text-3xl sm:text-4xl font-bold font-mono-num text-white leading-none">
                {plant.design_capacity_m3 ? fmtNum(plant.design_capacity_m3) : '—'}
              </span>
              {plant.design_capacity_m3 && (
                <span className="text-sm font-sans font-medium text-slate-300">
                  MLD <span className="text-2xs opacity-80 font-mono">({fmtNum(plant.design_capacity_m3 * 1000)} m³/d)</span>
                </span>
              )}
            </div>
            <div className="text-3xs text-slate-400">Peak abstraction throughput</div>
          </div>

          {/* Pillar 2: RO Fleet Operational Ratio */}
          <div className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1.5">
            <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-teal-200/90">
              <ROTrainIcon className="h-3 w-3 text-teal-400" />
              <span>RO Trains Operational</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="readout-num text-3xl sm:text-4xl font-bold font-mono-num text-white leading-none">
                {trainCounts ? `${trainCounts.active}` : (plant.num_ro_trains ?? '—')}
              </span>
              {trainCounts && (
                <span className="text-sm font-mono text-slate-300">
                  / {trainCounts.total} units
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-3xs text-slate-300 font-mono">
              <Lamp
                tone={trainOnlinePct === 100 ? 'good' : (trainOnlinePct ?? 0) > 0 ? 'warn' : 'danger'}
                pulse={trainOnlinePct === 100}
                size={6}
              />
              <span>
                {trainCounts && trainCounts.total > 0
                  ? `${trainOnlinePct}% fleet online`
                  : 'Train telemetry online'}
              </span>
            </div>
          </div>

          {/* Pillar 3: Distribution Meters */}
          <div className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1.5">
            <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-teal-200/90">
              <Gauge className="h-3 w-3 text-amber-400" />
              <span>Distribution Meters</span>
            </div>
            <ProductMetersStat plantId={plant.id} variant="hero" />
            <div className="text-3xs text-slate-400">Offtake & bulk consumption</div>
          </div>

          {/* Pillar 4: Power Mix */}
          <div className="p-3.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1.5">
            <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-teal-200/90">
              <Zap className="h-3 w-3 text-emerald-400" />
              <span>Power Mix</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap min-h-[38px]">
              {plant.has_solar && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-2xs font-mono font-medium bg-amber-950/80 text-amber-300 border border-amber-500/40">
                  <Sun className="h-3 w-3 text-amber-400" />
                  <span>Solar{plant.solar_capacity_kw ? ` · ${plant.solar_capacity_kw} kW` : ''}</span>
                </span>
              )}
              {plant.has_grid !== false && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-2xs font-mono font-medium bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
                  <GridPylonIcon className="h-3 w-3 text-cyan-400" />
                  <span>Grid Connected</span>
                </span>
              )}
              {!plant.has_solar && plant.has_grid === false && (
                <span className="text-slate-400 italic text-2xs">No source configured</span>
              )}
            </div>
            <div className="text-3xs text-slate-400">Grid / Solar telemetry</div>
          </div>
        </div>

        {/* Bottom Strip: System Benchmark specs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2 rounded-md bg-slate-800/40 border border-slate-700/40 text-2xs text-slate-300 font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-3xs uppercase tracking-wider font-semibold text-teal-300">
              System Benchmarks:
            </span>
            <span>Target Recovery: <strong className="text-white">{thresholds?.recovery_pct_min != null ? `${thresholds.recovery_pct_min}% – 75%` : '65% – 75%'}</strong></span>
            <span className="text-white/20 hidden sm:inline">&bull;</span>
            <span>Permeate TDS: <strong className="text-white">&le; {thresholds?.permeate_tds_max ?? 500} ppm</strong></span>
          </div>
          <p className="text-3xs text-slate-400 flex items-center gap-1.5 md:hidden">
            <MapPin className="h-3 w-3 text-teal-400/80 shrink-0" />
            <span className="truncate">{plant.address || 'Address unassigned'}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

