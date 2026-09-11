import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Activity, Droplet, MapPin } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { MarqueeText } from './MarqueeText';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';

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

function statBarColor(active: number, total: number) {
  if (total === 0) return { bar: 'bg-muted', textColor: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border/40' };
  const r = active / total;
  if (r >= 0.75) return { bar: 'bg-primary', textColor: 'text-primary', bg: 'bg-primary-soft', border: 'border-primary' };
  if (r >= 0.4)  return { bar: 'bg-info', textColor: 'text-info', bg: 'bg-info-soft', border: 'border-info' };
  return { bar: 'bg-danger', textColor: 'text-danger', bg: 'bg-danger-soft', border: 'border-danger' };
}

function plantHealthScore(wells: { active: number; total: number }, locators: { active: number; total: number }, trains: { active: number; total: number }) {
  const scores = [
    wells.total    > 0 ? Math.round((wells.active    / wells.total)    * 100) : 0,
    locators.total > 0 ? Math.round((locators.active / locators.total) * 100) : 0,
    trains.total   > 0 ? Math.round((trains.active   / trains.total)   * 100) : 0,
  ];
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
          <span className={`text-3xs font-mono font-bold px-1.5 py-0.5 rounded-md ${colors.textColor} ${colors.bg} border ${colors.border}`}>
            {p}%
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/70 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: total > 0 ? `${p}%` : '0%' }}
        />
      </div>
    </div>
  );
}

function MetricRingGroup({ wells, locators, trains, size = 68 }: {
  wells: { active: number; total: number };
  locators: { active: number; total: number };
  trains: { active: number; total: number };
  size?: number;
}) {
  const uid = useId();
  const pct = (m: { active: number; total: number }) => m.total > 0 ? Math.round((m.active / m.total) * 100) : 0;
  const overall = Math.round((pct(wells) + pct(locators) + pct(trains)) / 3);

  const layers = [
    { key: 'trains',   label: 'RO Trains', icon: <ROTrainIcon className="h-3 w-3" />, value: trains,   hueVar: '--kpi-ro' },
    { key: 'locators', label: 'Locators',  icon: <MapPin className="h-3 w-3" />,       value: locators, hueVar: '--kpi-locator' },
    { key: 'wells',    label: 'Wells',     icon: <Droplet className="h-3 w-3" />,      value: wells,    hueVar: '--kpi-wells' },
  ];

  const strokeW = Math.max(3.5, Math.round(size * 0.075));
  const gap = Math.max(2, Math.round(strokeW * 0.55));
  const cx = size / 2, cy = size / 2;

  return (
    <div className="flex items-center justify-center shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`Overall plant health ${overall} percent. RO Trains ${pct(trains)} percent, Locators ${pct(locators)} percent, Wells ${pct(wells)} percent.`}>
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
              <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeW}
                stroke="currentColor" className="text-muted/30" />
              <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeW}
                stroke={`url(#ringGrad-${uid}-${l.key})`}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={circ / 4}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
              />
            </g>
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: Math.round(size * 0.22), fontWeight: 900, fill: 'hsl(var(--foreground))', fontFamily: 'monospace' }}>
          {overall}%
        </text>
        <text x={cx} y={cy + Math.round(size * 0.16)} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: Math.max(6.5, Math.round(size * 0.08)), fontWeight: 700, letterSpacing: '0.08em', fill: 'hsl(var(--muted-foreground))' }}>
          HEALTH
        </text>
      </svg>
    </div>
  );
}

export type PlantCardProps = {
  plant: any;
  summaryCounts: any;
  index: number;
  onNavigate: (path: string) => void;
  onInspect: (plant: any) => void;
  isManager: boolean;
};

export function PlantCard({ plant, summaryCounts, index, onNavigate, onInspect, isManager }: PlantCardProps) {
  const wells    = summaryCounts?.wells?.[plant.id]    ?? { active: 0, total: 0 };
  const locators = summaryCounts?.locators?.[plant.id] ?? { active: 0, total: 0 };
  const trains   = summaryCounts?.trains?.[plant.id]   ?? { active: 0, total: 0 };
  const isActive = plant.status === 'Active';
  const plantColor = getPlantColor(plant, index);
  const score = plantHealthScore(wells, locators, trains);

  const wPct = wells.total > 0 ? Math.round((wells.active / wells.total) * 100) : 0;
  const lPct = locators.total > 0 ? Math.round((locators.active / locators.total) * 100) : 0;
  const tPct = trains.total > 0 ? Math.round((trains.active / trains.total) * 100) : 0;

  let incidentFlag: { text: string; tone: string } | null = null;
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
      className="group relative flex overflow-hidden rounded-2xl border border-border/70 bg-card hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      style={{ ['--plant-color' as any]: plantColor }}
      onClick={() => onNavigate(`/plants/${plant.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(`/plants/${plant.id}`); }
      }}
      data-testid={`plant-card-${plant.id}`}
    >
      {/* Left colored facility accent line */}
      <div
        className="w-1.5 shrink-0 transition-all duration-200 group-hover:w-2"
        style={{ backgroundColor: plantColor }}
      />

      {/* Desktop Layout: strictly aligned columns */}
      <div className="hidden md:flex flex-1 min-w-0 p-3.5 pr-4 items-center justify-between gap-4">
        {/* Column 1: Plant Identity & Status (Fixed width) */}
        <div className="w-[200px] lg:w-[220px] shrink-0 space-y-1.5 min-w-0">
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
              <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs ${
                incidentFlag.tone === 'danger'
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
              }`}>
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
            <div className="h-1.5 w-full bg-muted/80 rounded-full overflow-hidden">
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
            <div className="h-1.5 w-full bg-muted/80 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-teal-500 transition-all duration-500" style={{ width: `${lPct}%` }} />
            </div>
          </div>

          {/* RO Trains */}
          <div className="flex flex-col justify-between gap-1.5 pl-3.5">
            <div className="flex items-center justify-between text-3xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1 text-foreground font-semibold">
                <ROTrainIcon className="h-3 w-3 text-violet-500" /> RO Trains
              </span>
              <span className={`font-mono text-xs font-bold ${tPct === 0 ? 'text-rose-600 dark:text-rose-400' : 'text-violet-600 dark:text-violet-400'}`}>
                {tPct}%
              </span>
            </div>
            <div className="font-mono text-xs font-bold text-foreground leading-none">
              {trains.active}<span className="text-muted-foreground font-normal text-3xs">/{trains.total}</span>
            </div>
            <div className="h-1.5 w-full bg-muted/80 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${tPct === 0 ? 'bg-rose-500' : 'bg-violet-500'}`}
                style={{ width: `${tPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Column 4: Concentric Health Meter (Fixed width) */}
        <div className="w-[84px] shrink-0 flex items-center justify-center border-l border-border/50 pl-3">
          <MetricRingGroup wells={wells} locators={locators} trains={trains} size={68} />
        </div>

        {/* Column 5: Actions (Fixed) */}
        <div className="shrink-0 flex items-center gap-1.5 pl-2 border-l border-border/50">
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
                <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs ${
                  incidentFlag.tone === 'danger'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
                }`}>
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
            <PlantStatRow icon={<ROTrainIcon className="h-3 w-3 text-violet-500" />} label="RO trains" active={trains.active} total={trains.total} />
          </div>
        </div>
      </div>
    </div>
  );
}

