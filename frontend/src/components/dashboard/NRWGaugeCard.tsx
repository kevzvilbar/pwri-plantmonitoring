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

  const pieData = [
    { name: 'NRW',  value: displayVal       },
    { name: 'rest', value: 100 - displayVal },
  ];

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
        <PieChart width={88} height={48}>
          <Pie
            data={pieData}
            cx={44}
            cy={46}
            startAngle={180}
            endAngle={0}
            innerRadius={27}
            outerRadius={40}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={fillColor}  />
            <Cell fill={trackColor} />
          </Pie>
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
