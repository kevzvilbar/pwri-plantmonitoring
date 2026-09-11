import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { Activity } from 'lucide-react';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { TONE_BG, TONE_ICON, type StatTone } from './types';
import { TrendBadge } from './StatCard';

// Same numeral typeface as StatCard/ComplianceRadarCard/CostSunburst —
// declared once as the `font-numeral` Tailwind token (tailwind.config.ts)
// and loaded via the single app-wide @import in index.css.

// ── Colour ramp ──────────────────────────────────────────────────────────
// Was hardcoded to ALERTS.nrw_green_max/nrw_amber_max (calculations.ts) —
// a completely separate, non-editable 13%/16% ramp that had nothing to do
// with the "NRW Pct Max" an admin actually sets on the Compliance page's
// Thresholds tab (global default 20%, overridable per plant — e.g. 8% for
// SRP). This gauge would keep showing "(limit 13%)" and coloring off that
// stale number even for a plant with its own configured override. Now
// banded the same way ComplianceRadarCard already bands its axes off the
// one real `nrw_pct_max` threshold: accent below 70% of it, warn from
// there up to the limit, danger at/over — so the two compliance-driven
// widgets on this dashboard always agree.
function nrwTone(pct: number | null, limitPct: number): StatTone {
  if (pct === null)            return undefined;
  if (pct < limitPct * 0.7)   return 'accent';
  if (pct < limitPct)         return 'warn';
  return 'danger';
}

// Recharts' `fill` prop needs a resolved color, not a Tailwind class — read
// the same CSS custom properties the tokens above are built from so the
// donut segment always matches nrwTone()'s tone.
function nrwFill(tone: StatTone): string {
  if (!tone) return 'hsl(var(--muted-foreground))';
  return `hsl(var(--${tone}))`;
}

// Maps a 0–100 gauge value to its angle on the arc (matches the Pie props
// below: startAngle=180 at the left foot, sweeping to endAngle=0 at the
// right foot) and that angle to an (x, y) point at a given radius — used to
// place the threshold tick mark at the exact spot on the ring that
// corresponds to the compliance-configured limit, independent of the
// current value.
function polarPoint(cx: number, cy: number, r: number, pct: number) {
  const angleRad = ((180 - (pct / 100) * 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy - r * Math.sin(angleRad) };
}

interface Props {
  nrw:     number | null;
  yNrw:    number | null;
  onClick?: () => void;
  size?: 'default' | 'lg';
  className?: string;
}

export function NRWGaugeCard({ nrw, yNrw, onClick, size = 'default', className }: Props) {
  // Same scope convention the Compliance page itself uses (Compliance.tsx:
  // `thresholdScope = scope === 'plant' ? plantId : 'global'`) — a specific
  // plant selected on the dashboard reads that plant's override if one
  // exists, "All Plants" reads the global default. loadThresholds() is the
  // exact function the Compliance page and ComplianceRadarCard already call,
  // so this can't drift from what the Thresholds tab actually has saved.
  const selectedPlantId = useAppStore((s) => s.selectedPlantId);
  const thresholdScope  = selectedPlantId || 'global';
  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', thresholdScope],
    queryFn:  () => loadThresholds(thresholdScope),
    staleTime: 2 * 60_000,
  });
  // DEFAULT_THRESHOLDS.nrw_pct_max (20%) only while the query is still
  // in flight on first load — the same fallback loadThresholds() itself
  // uses internally if the read fails, so there's no moment where this
  // shows a number that isn't one of "the real saved value" or "the same
  // documented default everything else falls back to."
  const limitPct = thresholds?.nrw_pct_max ?? DEFAULT_THRESHOLDS.nrw_pct_max;

  const tone       = nrwTone(nrw, limitPct);
  const trackColor = 'hsl(var(--muted))';
  const fillColor  = nrwFill(tone);
  const displayVal = Math.min(Math.max(nrw ?? 0, 0), 100);

  const isLg = size === 'lg';
  // Gauge geometry — compact or prominent half-donut placed cleanly on the right
  const cx = isLg ? 44 : 38;
  const cy = isLg ? 44 : 38;
  const innerRadius = isLg ? 26 : 22;
  const outerRadius = isLg ? 40 : 34;
  const cornerRadius = 5;

  const tickInner = polarPoint(cx, cy, innerRadius - 2.5, Math.min(limitPct, 100));
  const tickOuter = polarPoint(cx, cy, outerRadius + 2.5, Math.min(limitPct, 100));

  // Trend vs yesterday
  const delta = nrw != null && yNrw != null && yNrw !== 0
    ? +((nrw - yNrw) / Math.abs(yNrw) * 100).toFixed(1)
    : null;

  return (
    <Card
      className={cn(
        'stat-card min-w-0 h-full flex flex-col justify-between transition-colors hover:border-border',
        isLg ? 'p-3.5 sm:p-4' : 'p-3.5',
        tone ? TONE_BG[tone] : '',
        onClick ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
      onClick={onClick}
      aria-label={`NRW gauge: ${nrw ?? '—'}% (target < ${limitPct}%)`}
    >
      {/* ── Header row: icon · LABEL · limit · calc pill ── */}
      <div className="flex items-center justify-between gap-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <Activity className={cn('shrink-0', isLg ? 'h-4 w-4' : 'h-3.5 w-3.5', 'text-muted-foreground/80')} />
          <span className={cn('uppercase tracking-wide font-semibold truncate leading-none text-muted-foreground', isLg ? 'text-xs' : 'text-2xs')}>
            NRW
          </span>
          <span className="text-3xs text-muted-foreground/60 shrink-0 font-mono">
            (limit {limitPct}%)
          </span>
        </div>
        <span
          className="text-3xs uppercase tracking-wider px-1 py-0.5 rounded font-mono bg-info/10 text-info border border-info/20 shrink-0"
          title="Calculated: (Raw Water - Billed Consumption) / Raw Water"
        >
          calc
        </span>
      </div>

      {/* ── Value & Gauge Row ── */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('font-bold font-mono tabular-nums text-foreground leading-none', isLg ? 'text-2xl sm:text-3xl' : 'text-2xl')}>
            {nrw == null ? '—' : nrw}
            <span className={cn('font-sans font-normal text-muted-foreground ml-1.5', isLg ? 'text-sm' : 'text-xs')}>%</span>
          </div>
          {delta !== null && (
            <div className="mt-1.5">
              <TrendBadge delta={delta} invert />
            </div>
          )}
        </div>

        {/* Half-donut gauge */}
        <div className="shrink-0 -mb-1" aria-hidden>
          <PieChart width={isLg ? 88 : 76} height={isLg ? 48 : 42} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={[{ name: 'track', value: 100 }]}
              cx={cx}
              cy={cy}
              startAngle={180}
              endAngle={0}
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              cornerRadius={cornerRadius}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={trackColor} />
            </Pie>

            <Pie
              data={[{ name: 'NRW', value: displayVal }]}
              cx={cx}
              cy={cy}
              startAngle={180}
              endAngle={180 - (displayVal / 100) * 180}
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              cornerRadius={cornerRadius}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={fillColor} />
            </Pie>

            <line
              x1={tickInner.x} y1={tickInner.y}
              x2={tickOuter.x} y2={tickOuter.y}
              stroke="hsl(var(--foreground))"
              strokeOpacity={0.45}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </PieChart>
        </div>
      </div>
    </Card>
  );
}
