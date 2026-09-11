import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Activity, Droplet, MapPin } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { FadingAddressText } from '../FadingAddressText';
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
  if (total === 0) return { bar: 'bg-muted', textColor: 'text-muted-foreground', bg: 'bg-muted/40', border: 'border-border/40', dot: 'hsl(var(--muted-foreground))' };
  const r = active / total;
  if (r >= 0.75) return { bar: 'bg-primary',  textColor: 'text-primary',  bg: 'bg-primary-soft',  border: 'border-primary',  dot: 'hsl(var(--primary))' };
  if (r >= 0.4)  return { bar: 'bg-info',   textColor: 'text-info',    bg: 'bg-info-soft',    border: 'border-info',    dot: 'hsl(var(--info))' };
  return                { bar: 'bg-danger',   textColor: 'text-danger',    bg: 'bg-danger-soft',    border: 'border-danger',    dot: 'hsl(var(--danger))' };
}

function plantHealthScore(wells: { active: number; total: number }, locators: { active: number; total: number }, trains: { active: number; total: number }) {
  const scores = [
    wells.total    > 0 ? Math.round((wells.active    / wells.total)    * 100) : 0,
    locators.total > 0 ? Math.round((locators.active / locators.total) * 100) : 0,
    trains.total   > 0 ? Math.round((trains.active   / trains.total)   * 100) : 0,
  ];
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function sparklinePath(seed: number, w = 72, h = 20) {
  const vals = [
    Math.max(15, seed - 14), Math.max(20, seed - 6), Math.max(25, seed - 12),
    Math.max(22, seed - 4), Math.max(28, seed - 8), Math.max(32, seed - 2), seed,
  ];
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => ({
    x: Number(((i / (vals.length - 1)) * w).toFixed(1)),
    y: Number((h - ((v - min) / range) * (h - 6) - 3).toFixed(1)),
  }));

  // Build cubic bezier curve for ultra-smooth rendering
  let line = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    const cp1x = (curr.x + (next.x - curr.x) / 2).toFixed(1);
    const cp1y = curr.y.toFixed(1);
    const cp2x = (curr.x + (next.x - curr.x) / 2).toFixed(1);
    const cp2y = next.y.toFixed(1);
    line += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
  }
  const fill = `${line} L ${w},${h} L 0,${h} Z`;
  const lastPt = pts[pts.length - 1];
  return { line, fill, lastPt };
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

  const layers = [
    { key: 'trains',   label: 'RO Trains', icon: <ROTrainIcon className="h-3 w-3" />, value: trains,   hueVar: '--kpi-ro' },
    { key: 'locators', label: 'Locators',  icon: <MapPin className="h-3 w-3" />,       value: locators, hueVar: '--kpi-locator' },
    { key: 'wells',    label: 'Wells',     icon: <Droplet className="h-3 w-3" />,      value: wells,    hueVar: '--kpi-wells' },
  ];

  const strokeW = Math.max(4, Math.round(size * 0.075));
  const gap = Math.max(2, Math.round(strokeW * 0.55));
  const cx = size / 2, cy = size / 2;
  const showCaption = size >= 75;

  return (
    <div className="flex items-center gap-4 shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`Overall health ${overall} percent. RO Trains ${pct(trains)} percent, Locators ${pct(locators)} percent, Wells ${pct(wells)} percent.`}>
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
                stroke="currentColor" className="text-muted/40" />
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
        <text x={cx} y={cy - (showCaption ? size * 0.06 : 0)} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: size * 0.22, fontWeight: 800, fill: 'hsl(var(--foreground))', fontFamily: 'monospace' }}>
          {overall}%
        </text>
        {showCaption && (
          <text x={cx} y={cy + size * 0.16} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: size * 0.065, fontWeight: 700, letterSpacing: '0.08em', fill: 'hsl(var(--muted-foreground))' }}>
            HEALTH
          </text>
        )}
      </svg>

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

function MetricChip({ icon, label, active, total, colorCls, pct, plantColor }: {
  icon: ReactNode;
  label: string;
  active: number;
  total: number;
  colorCls: string;
  pct: number;
  plantColor: string;
}) {
  return (
    <div className="group/chip flex flex-col justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/30 transition-all duration-200 p-2.5 min-w-[100px] flex-1 shadow-2xs">
      <div className="flex items-center justify-between text-3xs font-bold uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">{icon} {label}</span>
        <span
          className="font-mono text-3xs font-bold px-1.5 py-0.5 rounded border bg-background/50 shadow-2xs"
          style={{ color: plantColor, borderColor: `color-mix(in srgb, ${plantColor} 30%, transparent)` }}
        >
          {pct}%
        </span>
      </div>
      <div className="font-mono text-sm font-bold text-foreground leading-none">
        {active}<span className="text-muted-foreground font-normal text-xs">/{total}</span>
      </div>
      <div className="h-1.5 w-full bg-muted/70 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${colorCls}`} style={{ width: `${pct}%` }} />
      </div>
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

  const sp = sparklinePath(score, 72, 20);

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
      className="group relative flex overflow-hidden rounded-2xl border border-border/70 bg-card hover:border-[var(--plant-color)]/60 hover:shadow-lg hover:shadow-[var(--plant-color)]/5 transition-all duration-300 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      style={{ ['--plant-color' as any]: plantColor }}
      onClick={() => onNavigate(`/plants/${plant.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(`/plants/${plant.id}`); }
      }}
      data-testid={`plant-card-${plant.id}`}
    >
      <div
        className="w-1.5 shrink-0 bg-gradient-to-b from-[var(--plant-color)] via-[var(--plant-color)] to-[var(--plant-color)]/40 transition-all duration-300 group-hover:w-2.5 group-hover:shadow-[0_0_12px_var(--plant-color)]"
        style={{ backgroundColor: plantColor }}
      />

      <div className="hidden md:flex flex-1 min-w-0 p-3.5 pr-4 items-center justify-between gap-4">
        {/* Capacity pod with smooth sparkline and live beacon */}
        <div className="flex flex-col justify-center items-center px-3 py-2 rounded-xl bg-gradient-to-b from-muted/30 via-muted/15 to-transparent border border-border/50 shrink-0 min-w-[96px] text-center relative group-hover:border-[var(--plant-color)]/40 transition-colors">
          <span className="text-3xs uppercase font-extrabold tracking-widest text-muted-foreground/80">
            Capacity
          </span>
          <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight leading-none my-1" style={{ color: plantColor }}>
            {fmtNum(plant.design_capacity_m3 ?? 0)}
          </div>
          <span className="text-3xs font-bold font-mono px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground mb-1">
            MLD CAP
          </span>
          <div className="relative w-[72px] h-[20px]">
            <svg className="w-[72px] h-[20px] overflow-visible" viewBox="0 0 72 20">
              <defs>
                <linearGradient id={`sparkGrad-${plant.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={plantColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={plantColor} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <path d={sp.fill} fill={`url(#sparkGrad-${plant.id})`} />
              <path d={sp.line} fill="none" stroke={plantColor} strokeWidth={1.8} strokeLinecap="round" />
              <circle cx={sp.lastPt.x} cy={sp.lastPt.y} r={2} fill={plantColor} />
              <circle cx={sp.lastPt.x} cy={sp.lastPt.y} r={4} fill={plantColor} fillOpacity={0.4} className="animate-ping" />
            </svg>
          </div>
        </div>

        {/* Facility Info & Status */}
        <div className="min-w-[170px] max-w-[220px] shrink-0 space-y-1.5">
          <h2 className="font-bold text-base leading-tight truncate text-foreground group-hover:text-primary transition-colors tracking-tight">
            {plant.name}
          </h2>
          <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <FadingAddressText address={plant.address || 'Unassigned'} />
          </div>
          <div>
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
              <span className="inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shadow-2xs">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Active Nominal
              </span>
            )}
          </div>
        </div>

        {/* Subsystems (Wells, Locators, RO Trains) */}
        <div className="flex items-stretch gap-2.5 flex-1 min-w-0">
          <MetricChip
            icon={<Droplet className="h-3.5 w-3.5 text-sky-500" />}
            label="Wells"
            active={wells.active}
            total={wells.total}
            pct={wPct}
            colorCls="bg-gradient-to-r from-sky-500 to-sky-400"
            plantColor={plantColor}
          />
          <MetricChip
            icon={<MapPin className="h-3.5 w-3.5 text-teal-500" />}
            label="Locators"
            active={locators.active}
            total={locators.total}
            pct={lPct}
            colorCls="bg-gradient-to-r from-teal-500 to-teal-400"
            plantColor={plantColor}
          />
          <MetricChip
            icon={<ROTrainIcon className="h-3.5 w-3.5 text-violet-500" />}
            label="RO Trains"
            active={trains.active}
            total={trains.total}
            pct={tPct}
            colorCls={tPct === 0 ? 'bg-rose-500' : 'bg-gradient-to-r from-violet-500 to-violet-400'}
            plantColor={plantColor}
          />
        </div>

        {/* Action button & Manager menu */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 gap-1.5 rounded-xl border-border/70 transition-all shadow-2xs"
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

        {/* Health Radial Gauge */}
        <div className="flex items-center justify-center pl-1 shrink-0">
          <MetricRingGroup wells={wells} locators={locators} trains={trains} size={80} />
        </div>
      </div>

      <div className="md:hidden flex-1 min-w-0 p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-bold text-base leading-tight truncate">{plant.name}</h2>
            <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              <FadingAddressText address={plant.address || 'Unassigned'} />
            </div>
            <div>
              {incidentFlag ? (
                <span className={`inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full border ${
                  incidentFlag.tone === 'danger'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
                }`}>
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {incidentFlag.text}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
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

        <div className="grid gap-3" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <div className="border-r border-border/50 pr-3 flex flex-col justify-center min-w-[70px] text-center">
            <span className="text-xl font-black font-mono" style={{ color: plantColor }}>
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
