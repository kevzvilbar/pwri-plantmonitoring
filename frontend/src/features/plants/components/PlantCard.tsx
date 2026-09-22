import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Activity, Droplet, MapPin } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { MarqueeText } from './MarqueeText';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { cn } from '@/lib/utils';
import { describeFreshness } from '@/shared/freshness';
import { useNow } from '@/hooks/useNow';

function statBarColor(active: number, total: number) {
  if (total === 0) return { bar: 'bg-muted-foreground/30', textColor: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border/40' };
  const r = active / total;
  if (r >= 0.75) return { bar: 'bg-primary', textColor: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' };
  if (r >= 0.4)  return { bar: 'bg-info', textColor: 'text-info', bg: 'bg-info/10', border: 'border-info/20' };
  return { bar: 'bg-danger', textColor: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' };
}

function plantHealthScore(
  wells: { active: number; total: number },
  locators: { active: number; total: number },
  trains: { active: number; total: number }
) {
  const scores: number[] = [];
  if (wells.total > 0) scores.push(Math.round((wells.active / wells.total) * 100));
  if (locators.total > 0) scores.push(Math.round((locators.active / locators.total) * 100));
  if (trains.total > 0) scores.push(Math.round((trains.active / trains.total) * 100));
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function PlantStatRow({ icon, label, active, total }: { icon: ReactNode; label: string; active: number; total: number }) {
  const p      = total > 0 ? Math.round((active / total) * 100) : 0;
  const colors = statBarColor(active, total);
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-3xs uppercase tracking-wider text-muted-foreground font-semibold">
          {icon}{label}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-mono font-bold text-foreground">
            {active}<span className="text-muted-foreground font-normal">/{total}</span>
          </span>
          <span className={cn('text-3xs font-mono font-bold px-1.5 py-0.5 rounded-md border', colors.textColor, colors.bg, colors.border)}>
            {p}%
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/80 dark:bg-muted/50 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
          style={{ width: total > 0 ? `${p}%` : '0%' }}
        />
      </div>
    </div>
  );
}

/** Precision circular health meter with high-contrast calibration */
function HealthGauge({ score, size = 64 }: { score: number; size?: number }) {
  const uid = useId();
  const strokeW = 4;
  const radius = (size - strokeW) / 2 - 2;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  const cx = size / 2;
  const cy = size / 2;

  let gradStart = '#10b981'; // emerald-500
  let gradEnd   = '#06b6d4'; // cyan-500

  if (score < 50) {
    gradStart = '#f43f5e'; // rose-500
    gradEnd   = '#e11d48'; // rose-600
  } else if (score < 75) {
    gradStart = '#f59e0b'; // amber-500
    gradEnd   = '#d97706'; // amber-600
  } else if (score < 90) {
    gradStart = '#0284c7'; // sky-600
    gradEnd   = '#06b6d4'; // cyan-500
  }

  return (
    <div className="flex items-center justify-center shrink-0" title={`Overall Health: ${score}%`}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Overall plant health: ${score}%`}
        className="overflow-visible select-none"
      >
        <defs>
          <linearGradient id={`healthGrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradStart} />
            <stop offset="100%" stopColor={gradEnd} />
          </linearGradient>
        </defs>
        {/* Track background */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeW}
          className="text-muted/30 dark:text-muted/20"
          stroke="currentColor"
        />
        {/* Value arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeW}
          stroke={`url(#healthGrad-${uid})`}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
        <text
          x={cx}
          y={cy - 3}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground font-mono font-bold"
          style={{ fontSize: 15 }}
        >
          {score}%
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground font-bold"
          style={{ fontSize: 7, letterSpacing: '0.12em' }}
        >
          HEALTH
        </text>
      </svg>
    </div>
  );
}

export type PlantCardProps = {
  plant: any;
  summaryCounts: any;
  lastReadingAt?: Date | null;
  index: number;
  onNavigate: (path: string) => void;
  onInspect: (plant: any) => void;
  isManager: boolean;
};

export function PlantCard({ plant, summaryCounts, onNavigate, onInspect, isManager }: PlantCardProps) {
export function PlantCard({ plant, summaryCounts, lastReadingAt, onNavigate, onInspect, isManager }: PlantCardProps) {
  const now = useNow(30_000);
  const freshness = describeFreshness(lastReadingAt, now.getTime());
  const wells    = summaryCounts?.wells?.[plant.id]    ?? { active: 0, total: 0 };
  const locators = summaryCounts?.locators?.[plant.id] ?? { active: 0, total: 0 };
  const trains   = summaryCounts?.trains?.[plant.id]   ?? { active: 0, total: 0 };
  const isActive = plant.status === 'Active';
  const score = plantHealthScore(wells, locators, trains);

  const wPct = wells.total > 0 ? Math.round((wells.active / wells.total) * 100) : 0;
  const lPct = locators.total > 0 ? Math.round((locators.active / locators.total) * 100) : 0;
  const tPct = trains.total > 0 ? Math.round((trains.active / trains.total) * 100) : 0;

  let incidentFlag: { text: string; tone: 'danger' | 'warn' } | null = null;
  if (trains.total > 0 && trains.active === 0) {
    incidentFlag = { text: 'RO Trains Offline', tone: 'danger' };
  } else if (wPct < 45 && wells.total > 0) {
    incidentFlag = { text: 'Low Well Inflow', tone: 'danger' };
  } else if (score < 75) {
    incidentFlag = { text: 'Subsystem Watch', tone: 'warn' };
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border/70 bg-card/90 dark:bg-card/75 backdrop-blur-xs',
        'hover:bg-card hover:border-border hover:shadow-xs transition-all duration-200 cursor-pointer',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
      )}
      onClick={() => onNavigate(`/plants/${plant.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(`/plants/${plant.id}`); }
      }}
      data-testid={`plant-card-${plant.id}`}
    >
      {/* Desktop Layout: strictly aligned columns */}
      <div className="hidden md:flex min-w-0 p-3.5 lg:p-4 items-center justify-between gap-4 lg:gap-6">
        {/* Column 1: Plant Identity & Status (Fixed width) */}
        <div className="w-[190px] lg:w-[215px] shrink-0 space-y-1.5 min-w-0">
          <MarqueeText
            text={plant.name}
            className="font-bold text-base text-foreground group-hover:text-primary transition-colors tracking-tight leading-snug"
          />
          <MarqueeText
            text={plant.address || 'Unassigned'}
            icon={<MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
            className="text-xs text-muted-foreground font-medium"
          />
          <div className="pt-0.5">
            {incidentFlag ? (
              <span className={cn(
                'inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs',
                incidentFlag.tone === 'danger'
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
              )}>
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {incidentFlag.text}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Active Nominal
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-3xs font-mono text-muted-foreground pt-0.5">
            <span className={cn(
              'h-1.5 w-1.5 rounded-full shrink-0',
              freshness.tone === 'fresh' ? 'bg-emerald-500'
              : freshness.tone === 'aging' ? 'bg-amber-500'
              : freshness.tone === 'stale' ? 'bg-rose-500'
              : 'bg-muted-foreground/40',
            )} />
            <span className="truncate">{freshness.label}</span>
          </div>
        </div>

        {/* Column 2: Design Capacity (Fixed width) */}
        <div className="w-[115px] lg:w-[125px] shrink-0 border-l border-border/50 pl-4 space-y-0.5 flex flex-col justify-center">
          <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Capacity</div>
          <div className="text-xl font-black font-mono tracking-tight text-foreground leading-tight">
            {fmtNum(plant.design_capacity_m3 ?? 0)}
            <span className="text-xs font-bold text-muted-foreground font-sans ml-1">MLD</span>
          </div>
          <div className="text-3xs font-mono text-muted-foreground font-medium truncate">
            {fmtNum((plant.design_capacity_m3 ?? 0) * 1000)} m³/d
          </div>
        </div>

        {/* Column 3: Integrated Subsystems Telemetry Strip */}
        <div className="flex-1 min-w-0 bg-muted/30 dark:bg-muted/15 border border-border/50 rounded-xl p-2.5 px-3.5 grid grid-cols-3 gap-3 divide-x divide-border/40">
          {/* Wells */}
          <div className="flex flex-col justify-between gap-1.5">
            <div className="flex items-center justify-between text-3xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground font-semibold">
                <Droplet className="h-3 w-3 text-sky-500" /> Wells
              </span>
              <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">{wPct}%</span>
            </div>
            <div className="font-mono text-xs font-bold text-foreground leading-none">
              {wells.active}<span className="text-muted-foreground font-normal text-3xs">/{wells.total}</span>
            </div>
            <div className="h-1.5 w-full bg-muted/80 dark:bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${wPct}%` }} />
            </div>
          </div>

          {/* Locators */}
          <div className="flex flex-col justify-between gap-1.5 pl-3.5">
            <div className="flex items-center justify-between text-3xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground font-semibold">
                <MapPin className="h-3 w-3 text-teal-500" /> Locators
              </span>
              <span className="font-mono text-xs font-bold text-teal-600 dark:text-teal-400">{lPct}%</span>
            </div>
            <div className="font-mono text-xs font-bold text-foreground leading-none">
              {locators.active}<span className="text-muted-foreground font-normal text-3xs">/{locators.total}</span>
            </div>
            <div className="h-1.5 w-full bg-muted/80 dark:bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-teal-500 transition-all duration-500" style={{ width: `${lPct}%` }} />
            </div>
          </div>

          {/* RO Trains */}
          <div className="flex flex-col justify-between gap-1.5 pl-3.5">
            <div className="flex items-center justify-between text-3xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground font-semibold">
                <ROTrainIcon className="h-3 w-3 text-indigo-500 dark:text-indigo-400" /> RO Trains
              </span>
              <span className={cn(
                'font-mono text-xs font-bold',
                tPct === 0 ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400',
              )}>
                {tPct}%
              </span>
            </div>
            <div className="font-mono text-xs font-bold text-foreground leading-none">
              {trains.active}<span className="text-muted-foreground font-normal text-3xs">/{trains.total}</span>
            </div>
            <div className="h-1.5 w-full bg-muted/80 dark:bg-muted/50 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', tPct === 0 ? 'bg-rose-500' : 'bg-indigo-500')}
                style={{ width: `${tPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Column 4: Calibrated Health Meter (Fixed width) */}
        <div className="w-[84px] shrink-0 flex items-center justify-center border-l border-border/50 pl-3">
          <HealthGauge score={score} size={64} />
        </div>

        {/* Column 5: Actions (Fixed) */}
        <div className="shrink-0 flex items-center gap-1.5 pl-3 border-l border-border/50">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 gap-1.5 rounded-lg border-border/70 transition-all shadow-2xs"
            onClick={(e) => {
              e.stopPropagation();
              onInspect(plant);
            }}
          >
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>Inspect</span>
          </Button>

          {isManager && (
            <div onClick={e => e.stopPropagation()}>
              <DeleteEntityMenu
                kind="plant"
                id={plant.id}
                label={plant.name}
                canSoftDelete={isActive}
                canHardDelete
                invalidateKeys={[['plants']]}
                compact
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden flex-1 min-w-0 p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <MarqueeText
              text={plant.name}
              className="font-bold text-base leading-tight text-foreground"
            />
            <MarqueeText
              text={plant.address || 'Unassigned'}
              icon={<MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
              className="text-xs text-muted-foreground font-medium"
            />
            <div className="pt-0.5">
              {incidentFlag ? (
                <span className={cn(
                  'inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs',
                  incidentFlag.tone === 'danger'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
                )}>
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                  {incidentFlag.text}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active Nominal
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-3xs font-mono text-muted-foreground pt-0.5">
              <span className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                freshness.tone === 'fresh' ? 'bg-emerald-500'
                : freshness.tone === 'aging' ? 'bg-amber-500'
                : freshness.tone === 'stale' ? 'bg-rose-500'
                : 'bg-muted-foreground/40',
              )} />
              <span className="truncate">{freshness.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs gap-1 rounded-lg border-border/70"
              onClick={() => onInspect(plant)}
            >
              <Activity className="h-3 w-3 text-primary" />
              Inspect
            </Button>
            {isManager && (
              <DeleteEntityMenu
                kind="plant"
                id={plant.id}
                label={plant.name}
                canSoftDelete={isActive}
                canHardDelete
                invalidateKeys={[['plants']]}
                compact
              />
            )}
          </div>
        </div>

        <div className="grid gap-3 pt-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <div className="border-r border-border/50 pr-3 flex flex-col justify-center min-w-[70px] text-center">
            <span className="text-xl font-black font-mono text-foreground">
              {fmtNum(plant.design_capacity_m3 ?? 0)}
            </span>
            <span className="text-3xs text-muted-foreground uppercase font-bold tracking-wider mt-0.5">MLD CAP</span>
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <PlantStatRow icon={<Droplet className="h-3 w-3 text-sky-500" />} label="Wells" active={wells.active} total={wells.total} />
            <PlantStatRow icon={<MapPin className="h-3 w-3 text-teal-500" />} label="Locators" active={locators.active} total={locators.total} />
            <PlantStatRow icon={<ROTrainIcon className="h-3 w-3 text-indigo-500" />} label="RO trains" active={trains.active} total={trains.total} />
          </div>
        </div>
      </div>
    </div>
  );
}
