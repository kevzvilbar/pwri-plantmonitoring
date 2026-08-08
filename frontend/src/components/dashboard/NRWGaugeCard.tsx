import { PieChart, Pie, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ALERTS } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { TONE_BG, TONE_ICON, type StatTone } from './types';

// Same numeral typeface as StatCard/ComplianceRadarCard/CostSunburst —
// declared once as the `font-numeral` Tailwind token (tailwind.config.ts)
// and loaded via the single app-wide @import in index.css.

// ── Colour ramp — mirrors nrwColor() thresholds from calculations.ts ─────────
// Resolves to the same StatTone used by every other KPI card, so the gauge's
// green/amber/rose bands stay in lockstep with TONE_BG/TONE_ICON below and
// with the theme (light/dark, alt brand themes) instead of a hardcoded ramp.
function nrwTone(pct: number | null): StatTone {
  if (pct === null)                return undefined;
  if (pct < ALERTS.nrw_green_max) return 'accent';
  if (pct < ALERTS.nrw_amber_max) return 'warn';
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
// corresponds to ALERTS.nrw_green_max, independent of the current value.
function polarPoint(cx: number, cy: number, r: number, pct: number) {
  const angleRad = ((180 - (pct / 100) * 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy - r * Math.sin(angleRad) };
}

interface Props {
  nrw:     number | null;
  yNrw:    number | null;
  onClick?: () => void;
}

export function NRWGaugeCard({ nrw, yNrw, onClick }: Props) {
  const tone       = nrwTone(nrw);
  const trackColor = 'hsl(var(--muted))';
  const fillColor  = nrwFill(tone);
  const displayVal = Math.min(Math.max(nrw ?? 0, 0), 100);

  // Gauge geometry — shared by both Pie layers and the threshold tick below
  // so they always line up exactly.
  const cx = 44, cy = 46, innerRadius = 27, outerRadius = 40;
  // Ring is 13px thick; ~half that gives a full pill-shaped rounded cap
  // without the two ends colliding into a lozenge at low values.
  const cornerRadius = 6;

  // Threshold tick — marks ALERTS.nrw_green_max on the ring so the compliance
  // limit is visible at a glance, not just in the "(limit N%)" text below.
  const limitPct = ALERTS.nrw_green_max;
  const tickInner = polarPoint(cx, cy, innerRadius - 3, limitPct);
  const tickOuter = polarPoint(cx, cy, outerRadius + 3, limitPct);

  // Trend vs yesterday
  const delta = nrw != null && yNrw != null && yNrw !== 0
    ? +((nrw - yNrw) / Math.abs(yNrw) * 100).toFixed(1)
    : null;

  const TrendIcon = delta === null ? null : Math.abs(delta) < 0.5 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const trendCls  = delta === null ? '' : Math.abs(delta) < 0.5
    ? 'text-muted-foreground'
    : delta > 0 ? 'text-danger' : 'text-accent';

  return (
    <Card
      className={cn(
        'stat-card min-w-0 h-full p-3 flex items-center gap-3',
        tone ? TONE_BG[tone] : '',
        onClick ? 'cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all' : 'cursor-default',
      )}
      onClick={onClick}
      aria-label={`NRW gauge: ${nrw ?? '—'}% (target < ${ALERTS.nrw_green_max}%)`}
    >
      {/* Half-donut gauge — slightly larger on wider (mobile full-row) layout */}
      <div className="shrink-0" aria-hidden>
        {/*
          margin explicitly zeroed: PieChart defaults to a hidden 5px margin
          on every side, which shifts the *effective* cx/cy by +5/+5 without
          changing the numbers you write here. On this 88×48 canvas that
          pushes the true circle center past the chart's own clip rect
          (bottom edge lands ~8px outside it), silently slicing the bottom
          off both arc feet — invisible with flat edges, but it flattens the
          rounded caps right where they're most visible, and at low % values
          clips the value-arc's rounded dot into a flat-bottomed blob.
        */}
        <PieChart width={88} height={48} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          {/* Track — full-width background arc, rounded caps at both feet
              so the ring reads as one continuous pill rather than a flat-cut
              band. Drawn first so the value arc layers cleanly on top. */}
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

          {/* Value — a second, independent arc layered on top instead of a
              second slice of the same pie. Two slices sharing one pie would
              each get their own rounded corners at the seam between them,
              leaving a visible notch; an overlapping arc avoids that and
              gives a clean single rounded cap at the value's leading edge. */}
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

          {/* Threshold tick — quiet reference line at the compliance limit,
              independent of the current value/tone so it stays put as the
              value moves past it. */}
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

      {/* Labels */}
      <div className="min-w-0 flex-1">
        {/* Value + trend */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span
            className={cn('text-xl font-semibold leading-none font-numeral', tone ? TONE_ICON[tone] : 'text-muted-foreground')}
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {nrw == null ? '—' : nrw}
            <span className="text-xs font-sans text-muted-foreground ml-0.5">%</span>
          </span>

          {TrendIcon && delta !== null && (
            <span className={cn('inline-flex items-center gap-0.5 text-2xs font-medium', trendCls)}
              title="vs yesterday"
            >
              <TrendIcon className="h-3 w-3" />
              {Math.abs(delta)}%
            </span>
          )}
        </div>

        <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
          NRW
          <span className="ml-1 text-3xs opacity-60">
            (limit {ALERTS.nrw_green_max}%)
          </span>
        </div>

        {/* Threshold bands legend — compact */}
        <div className="flex items-center gap-2 mt-1.5">
          <Activity className="h-3 w-3 text-muted-foreground/50 shrink-0" aria-hidden />
          <span className="text-3xs text-muted-foreground/60 font-medium tracking-wide uppercase">calc</span>
        </div>
      </div>
    </Card>
  );
}
