import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { TONE_BG, TONE_ICON, type StatTone } from './types';

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
}

export function NRWGaugeCard({ nrw, yNrw, onClick }: Props) {
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

  // Gauge geometry — shared by both Pie layers and the threshold tick below
  // so they always line up exactly.
  const cx = 44, cy = 46, innerRadius = 27, outerRadius = 40;
  // Ring is 13px thick; ~half that gives a full pill-shaped rounded cap
  // without the two ends colliding into a lozenge at low values.
  const cornerRadius = 6;

  // Threshold tick — marks the compliance limit on the ring so it's visible
  // at a glance, not just in the "(limit N%)" text below. Clamped into the
  // gauge's own 0–100 domain: a plant can configure nrw_pct_max above 100
  // (unusual, but the input doesn't forbid it), which would otherwise place
  // the tick past the right foot at an angle the arc never reaches.
  const tickInner = polarPoint(cx, cy, innerRadius - 3, Math.min(limitPct, 100));
  const tickOuter = polarPoint(cx, cy, outerRadius + 3, Math.min(limitPct, 100));

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
      aria-label={`NRW gauge: ${nrw ?? '—'}% (target < ${limitPct}%)`}
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
            (limit {limitPct}%)
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
