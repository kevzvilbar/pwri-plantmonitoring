import { useState, useEffect, useMemo } from 'react';
import { Lamp } from '@/components/ui/Lamp';
import { TrendBadge } from './StatCard';
import { fmtNum } from '@/lib/calculations';
import { usePlants } from '@/hooks/usePlants';
import { useFleetStatus } from '@/hooks/useFleetStatus';
import { useNow } from '@/hooks/useNow';
import { describeFreshness } from '@/shared/freshness';
import { format } from 'date-fns';
import {
  History, ShieldAlert, Building2,
  Droplets, Gauge, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PlantPulseHeroProps {
  plantIds: string[];
  selectedPlantName: string;
  openIncidentCount?: number;
  /** Timestamp of the latest known reading. Pass `null` when unknown. */
  lastReadingAt?: Date | null;
  production: number | null;
  dProduction: number | null;
  rawWaterVol?: number | null;
  recovery?: number | null;
  specificPower?: number | null;
  chartData?: any[];
  onOpenDowntime: () => void;
  onSelectPlant?: (plantId: string) => void;
  onViewIncidents?: () => void;
}

export function PlantPulseHero({
  plantIds,
  selectedPlantName,
  openIncidentCount = 0,
  lastReadingAt,
  production,
  dProduction,
  rawWaterVol,
  recovery,
  specificPower,
  chartData,
  onOpenDowntime,
  onSelectPlant,
  onViewIncidents,
}: PlantPulseHeroProps) {
  const { data: plants } = usePlants();
  const [timeStr, setTimeStr] = useState('');

  // Tick every 30 s so "X min ago" advances without a refetch (P4-5)
  const now = useNow(30_000);
  // Map timestamp → { label, tone } using shared freshness thresholds (P4-2)
  const freshness = describeFreshness(lastReadingAt ?? null, now.getTime());

  // Live PHT Clock updated every 10 seconds
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(format(now, 'hh:mm a') + ' PHT');
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Filtered plant list (kept for onSelectPlant drill-down below).
  // Memoized so the fleet hook receives a referentially stable id array
  // (its TanStack key is derived from the joined ids).
  const activePlants = useMemo(
    () => (plants ?? []).filter((p) => !plantIds.length || plantIds.includes(p.id)),
    [plants, plantIds],
  );

  const heroPlantIds = useMemo(
    () => (activePlants.length ? activePlants.map((p) => p.id) : plantIds),
    [activePlants, plantIds],
  );

  // Single shared fleet snapshot (wells ∪ locators) — same data the
  // PlantHealthStrip chips render, so hero lamps can never disagree.
  const { counts: fleetCounts } = useFleetStatus(heroPlantIds);

  return (
    <div className="rounded-xl sm:rounded-2xl p-0.5 bg-gradient-to-b from-primary/25 via-primary/10 to-transparent border border-primary/30 shadow-lg shadow-black/20">
      <div
        style={{ background: 'var(--gradient-stat)' }}
        className="hero-arrival rounded-[10px] sm:rounded-[14px] text-white px-3.5 py-2.5 sm:px-4 sm:py-3 relative overflow-hidden shadow-inner border border-white/10"
      >
        {/* Decorative ambient blurred glow orbs */}
        <div className="pointer-events-none absolute -top-20 -left-20 w-48 h-48 bg-primary/20 rounded-full blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -right-20 w-48 h-48 bg-accent/15 rounded-full blur-3xl" aria-hidden />

        {/* ── Top Bar: Title, Facility Badge, Incident Flag, Downtime & View Toggle ── */}
        <div className="relative z-10 flex flex-row items-center justify-between gap-2 pb-2 border-b border-white/10 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>PWRI Operations Telemetry</span>
            </h1>
            <span className="px-2 py-0.5 rounded-full text-3xs font-semibold bg-black/40 text-white/90 border border-primary/40 flex items-center gap-1 font-mono shadow-xs">
              <Building2 className="h-2.5 w-2.5 text-primary-foreground" />
              {selectedPlantName}
            </span>
            {openIncidentCount > 0 && (
              <button
                type="button"
                onClick={onViewIncidents}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-500/40 text-3xs font-semibold hover:bg-rose-900/80 transition-colors shadow-xs"
                title={`${openIncidentCount} open incident${openIncidentCount > 1 ? 's' : ''} — click to view`}
              >
                <ShieldAlert className="h-2.5 w-2.5 text-rose-400" aria-hidden />
                <span>{openIncidentCount} open incident{openIncidentCount > 1 ? 's' : ''}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenDowntime}
              className="h-6.5 text-3xs px-2.5 gap-1 font-medium bg-white/10 hover:bg-white/20 border-white/20 text-white shadow-xs rounded-md"
            >
              <History className="h-3 w-3 text-white/80" />
              <span>Downtime Log</span>
            </Button>
            {/* View-mode control lives in the sticky DashboardSectionNav bar — single source. */}
          </div>
        </div>

        {/* ── Main Hero Row: Headline Metric · Live Pulse Status · 7-Day Sparkline · Fleet Lamps ── */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-2.5 lg:gap-3 items-center pt-2">
          {/* Left: Headline Metric & Status */}
          <div className="md:col-span-4 space-y-0.5">
            <div className="flex items-baseline gap-1.5">
              <span className="readout-num text-2xl sm:text-3xl font-bold leading-none text-white tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                {fmtNum(production)}
              </span>
              <span className="text-xs sm:text-sm font-sans font-normal text-white/70">m³</span>
            </div>
            
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-3xs uppercase tracking-wider font-semibold text-white/80">
                Today's Production
              </span>
              {dProduction !== null && <TrendBadge delta={dProduction} />}
            </div>

                        <div className="text-3xs text-slate-300/90 flex items-center gap-1 pt-0.5 font-mono tabular-nums">
              {/* Lamp pulses only when data is truly fresh */}
              <Lamp
                tone={freshness.tone === 'fresh' ? 'live' : freshness.tone === 'aging' ? 'warn' : 'muted'}
                pulse={freshness.tone === 'fresh'}
                size={5}
              />
              <span className={
                freshness.tone === 'fresh'   ? 'text-emerald-400 font-semibold'
                : freshness.tone === 'aging' ? 'text-amber-400 font-semibold'
                : freshness.tone === 'stale' ? 'text-rose-400 font-semibold'
                : 'text-white/50'
              }>
                {freshness.label}
              </span>
              <span className="text-white/30">&bull;</span>
              <span>24h ({timeStr || '—'})</span>
            </div>
          </div>

          {/* Middle: Live Plant Efficiency Trio */}
          <div className="md:col-span-5 flex items-center justify-between bg-black/40 border border-white/15 rounded-lg py-1.5 px-3 backdrop-blur-md shadow-inner divide-x divide-white/10">
            {/* Raw Inflow */}
            <div className="flex-1 px-2 first:pl-0">
              <div className="flex items-center gap-1 mb-0.5">
                <Droplets className="h-3 w-3 text-sky-400 shrink-0" />
                <span className="text-3xs font-mono font-semibold uppercase tracking-wider text-white/75">
                  Raw Inflow
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-sm sm:text-base font-bold text-white tracking-tight">
                  {rawWaterVol != null ? fmtNum(rawWaterVol) : '—'}
                </span>
                <span className="text-3xs font-mono text-white/60">m³</span>
              </div>
            </div>

            {/* RO Recovery */}
            <div className="flex-1 px-2">
              <div className="flex items-center gap-1 mb-0.5">
                <Gauge className="h-3 w-3 text-emerald-400 shrink-0" />
                <span className="text-3xs font-mono font-semibold uppercase tracking-wider text-white/75">
                  Recovery
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-sm sm:text-base font-bold text-emerald-400 tracking-tight">
                  {recovery != null ? `${recovery.toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>

            {/* Specific Energy */}
            <div className="flex-1 px-2 last:pr-0">
              <div className="flex items-center gap-1 mb-0.5">
                <Zap className="h-3 w-3 text-amber-400 shrink-0" />
                <span className="text-3xs font-mono font-semibold uppercase tracking-wider text-white/75">
                  Spec. Energy
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-sm sm:text-base font-bold text-white tracking-tight">
                  {specificPower != null ? specificPower.toFixed(2) : '—'}
                </span>
                <span className="text-3xs font-mono text-white/60">kWh/m³</span>
              </div>
            </div>
          </div>

          {/* Right: Fleet Health Status Lamps */}
          <div className="md:col-span-3 flex md:flex-col justify-start md:justify-center md:items-end gap-1 text-3xs font-mono">
            <div className="flex items-center gap-1.5 bg-black/40 border border-white/15 rounded-lg px-2.5 py-1.5 backdrop-blur-md shadow-inner">
              <span className="flex items-center gap-1">
                <Lamp tone="good" size={5} />
                <span className="font-semibold text-white">{fleetCounts.online}</span>
                <span className="text-slate-300">online</span>
              </span>
              <span className="text-white/20">|</span>
              <span className="flex items-center gap-1">
                <Lamp tone="warn" size={5} />
                <span className="font-semibold text-white">{fleetCounts.stale}</span>
                <span className="text-slate-300">stale</span>
              </span>
              {fleetCounts.offline > 0 && (
                <>
                  <span className="text-white/20">|</span>
                  <span className="flex items-center gap-1">
                    <Lamp tone="muted" size={5} />
                    <span className="font-semibold text-white">{fleetCounts.offline}</span>
                    <span className="text-slate-300">off</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
