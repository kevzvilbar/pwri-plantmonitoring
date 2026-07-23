import { useEffect } from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ALERTS } from '@/lib/calculations';
import { cn } from '@/lib/utils';

const GEO_FONT = "'DM Sans', 'Outfit', ui-sans-serif, system-ui, sans-serif";

function useDMSans() {
  useEffect(() => {
    const id = 'dm-sans-link';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap';
    document.head.appendChild(link);
  }, []);
}

// ── Colour ramp — mirrors nrwColor() thresholds from calculations.ts ─────────
function nrwHex(pct: number | null): string {
  if (pct === null)                       return '#6b7280'; // muted
  if (pct < ALERTS.nrw_green_max)        return '#22c55e'; // green-500
  if (pct < ALERTS.nrw_amber_max)        return '#f59e0b'; // amber-500
  return '#f43f5e';                                         // rose-500
}

function nrwTextCls(pct: number | null): string {
  if (pct === null)                       return 'text-muted-foreground';
  if (pct < ALERTS.nrw_green_max)        return 'text-emerald-600 dark:text-emerald-400';
  if (pct < ALERTS.nrw_amber_max)        return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

interface Props {
  nrw:     number | null;
  yNrw:    number | null;
  onClick?: () => void;
}

export function NRWGaugeCard({ nrw, yNrw, onClick }: Props) {
  useDMSans();
  const isDark     = typeof window !== 'undefined' && window.document.documentElement.classList.contains('dark');
  const trackColor = isDark ? '#374151' : '#e5e7eb';
  const fillColor  = nrwHex(nrw);
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
    : delta > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';

  return (
    <Card
      className={cn(
        'stat-card min-w-0 h-full p-3 flex items-center gap-3',
        'bg-gradient-to-br',
        nrw === null      ? '' :
        nrw < ALERTS.nrw_green_max ? 'from-emerald-50/60 to-transparent border-emerald-200/60 dark:from-emerald-950/25 dark:border-emerald-900/40' :
        nrw < ALERTS.nrw_amber_max ? 'from-amber-50/70  to-transparent border-amber-200/70  dark:from-amber-950/25 dark:border-amber-900/40' :
                                     'from-rose-50/70   to-transparent border-rose-200/70   dark:from-rose-950/30 dark:border-rose-900/50',
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
            className={cn('text-xl font-semibold leading-none', nrwTextCls(nrw))}
            style={{ fontFamily: GEO_FONT, fontFeatureSettings: '"tnum"' }}
          >
            {nrw == null ? '—' : nrw}
            <span className="text-xs font-sans text-muted-foreground ml-0.5">%</span>
          </span>

          {TrendIcon && delta !== null && (
            <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium', trendCls)}
              title="vs yesterday"
            >
              <TrendIcon className="h-3 w-3" />
              {Math.abs(delta)}%
            </span>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
          NRW
          <span className="ml-1 text-[9.5px] opacity-60">
            (limit {ALERTS.nrw_green_max}%)
          </span>
        </div>

        {/* Threshold bands legend — compact */}
        <div className="flex items-center gap-2 mt-1.5">
          <Activity className="h-3 w-3 text-muted-foreground/50 shrink-0" aria-hidden />
          <span className="text-[9.5px] text-muted-foreground/60 font-medium tracking-wide uppercase">calc</span>
        </div>
      </div>
    </Card>
  );
}
