import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { type StatTone } from './types';
import { TrendBadge } from './StatCard';
import { InstrumentTile } from './InstrumentTile';

function nrwTone(pct: number | null, limitPct: number): StatTone {
  if (pct === null)            return undefined;
  if (pct < limitPct * 0.7)   return 'accent';
  if (pct < limitPct)         return 'warn';
  return 'danger';
}

function nrwFill(tone: StatTone): string {
  if (!tone) return 'hsl(var(--muted-foreground))';
  return `hsl(var(--${tone}))`;
}

interface Props {
  nrw:     number | null;
  yNrw:    number | null;
  onClick?: () => void;
  size?: 'default' | 'lg';
  className?: string;
}

export function NRWGaugeCard({ nrw, yNrw, onClick, size = 'default', className }: Props) {
  const selectedPlantId = useAppStore((s) => s.selectedPlantId);
  const thresholdScope  = selectedPlantId || 'global';
  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', thresholdScope],
    queryFn:  () => loadThresholds(thresholdScope),
    staleTime: 2 * 60_000,
  });

  const limitPct = thresholds?.nrw_pct_max ?? DEFAULT_THRESHOLDS.nrw_pct_max;
  const tone = nrwTone(nrw, limitPct);
  const fillColor = nrwFill(tone);

  const isLg = size === 'lg';
  const w = isLg ? 88 : 76;
  const h = isLg ? 48 : 42;
  const cx = isLg ? 44 : 38;
  const cy = isLg ? 39 : 34;
  const r = isLg ? 32 : 27;
  const strokeWidth = isLg ? 6 : 5;
  const arcLength = Math.PI * r;

  // True physical percentage scale (0% to 100%)
  const safeVal = Math.min(Math.max(nrw ?? 0, 0), 100);
  const offset = arcLength * (1 - safeVal / 100);

  // Compliance limit tick mark position on the physical 0–100 scale
  const safeLimit = Math.min(Math.max(limitPct, 0), 100);
  const limitAngleRad = ((180 - safeLimit * 1.8) * Math.PI) / 180;
  const tickR1 = r - strokeWidth / 2 - 2;
  const tickR2 = r + strokeWidth / 2 + 2;
  const tx1 = cx + tickR1 * Math.cos(limitAngleRad);
  const ty1 = cy - tickR1 * Math.sin(limitAngleRad);
  const tx2 = cx + tickR2 * Math.cos(limitAngleRad);
  const ty2 = cy - tickR2 * Math.sin(limitAngleRad);

  // Luminous beacon dot at the active arc tip
  const valAngleRad = ((180 - safeVal * 1.8) * Math.PI) / 180;
  const tipX = cx + r * Math.cos(valAngleRad);
  const tipY = cy - r * Math.sin(valAngleRad);

  // Trend vs yesterday
  const delta = nrw != null && yNrw != null && yNrw !== 0
    ? +((nrw - yNrw) / Math.abs(yNrw) * 100).toFixed(1)
    : null;

  return (
    <InstrumentTile
      tone={tone}
      clickable={!!onClick}
      onClick={onClick}
      className={cn('stat-card min-w-0', className)}
      aria-label={`NRW gauge: ${nrw ?? '—'}% (target < ${limitPct}%)`}
    >
      <div>
        {/* ── Header row: icon · LABEL (decluttered) ── */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <Activity className={cn('shrink-0', isLg ? 'h-4 w-4' : 'h-3.5 w-3.5', tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/80')} />
            <span className={cn('uppercase tracking-wide font-semibold truncate leading-none', tone === 'danger' ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground', isLg ? 'text-xs' : 'text-2xs')}>
              NRW
            </span>
          </div>
        </div>

        {/* ── Value & Gauge Row ── */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className={cn(
              'font-bold font-mono tabular-nums leading-none',
              isLg ? 'text-2xl sm:text-3xl' : 'text-2xl',
              tone === 'danger' ? 'text-rose-700 dark:text-rose-200' : 'text-foreground'
            )}>
              {nrw == null ? '—' : nrw}
              <span className={cn('font-sans font-normal ml-1.5', tone === 'danger' ? 'text-rose-600/80 dark:text-rose-300/80' : 'text-muted-foreground', isLg ? 'text-sm' : 'text-xs')}>%</span>
            </div>
          </div>

          {/* Precision SVG semi-donut telemetry arc */}
          <div className="shrink-0 -mb-1" aria-hidden>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible select-none">
              {/* Recessed background track with smooth rounded caps */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke={tone === 'danger' ? 'rgba(244, 63, 94, 0.2)' : 'hsl(var(--muted))'}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />

              {/* Active value arc */}
              {safeVal > 0 && (
                <path
                  d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                  fill="none"
                  stroke={fillColor}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={`${arcLength} ${arcLength}`}
                  strokeDashoffset={offset}
                  className="transition-all duration-500 ease-out"
                />
              )}

              {/* High-contrast compliance limit tick mark */}
              <line
                x1={tx1} y1={ty1}
                x2={tx2} y2={ty2}
                stroke={tone === 'danger' ? '#ffffff' : 'hsl(var(--foreground))'}
                strokeWidth={2}
                strokeLinecap="round"
                className={tone === 'danger' ? 'drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]' : ''}
              />

              {/* Beacon dot at tip of value arc */}
              {safeVal > 0 && (
                <circle
                  cx={tipX}
                  cy={tipY}
                  r={isLg ? 2.5 : 2}
                  fill="#ffffff"
                  stroke={fillColor}
                  strokeWidth={1.5}
                  className="drop-shadow-[0_0_2px_rgba(0,0,0,0.6)]"
                />
              )}

              {/* Subdued scale baseline labels (0 and 100) */}
              <text x={cx - r} y={cy + 7} textAnchor="middle" fontSize={7} fontFamily="var(--font-mono, monospace)" fill="currentColor" opacity={0.4} className="tabular-nums">0</text>
              <text x={cx + r} y={cy + 7} textAnchor="middle" fontSize={7} fontFamily="var(--font-mono, monospace)" fill="currentColor" opacity={0.4} className="tabular-nums">100</text>
            </svg>
          </div>
        </div>
      </div>

      {/* ── Below-value: decluttered metadata row (calc, limit, trend) ── */}
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <span
          className="text-3xs uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] font-mono bg-info/10 text-info border border-info/20 shrink-0"
          title="Calculated: (Raw Water - Billed Consumption) / Raw Water"
        >
          calc
        </span>
        <span className={cn('text-3xs shrink-0 font-mono', tone === 'danger' ? 'text-rose-700/80 dark:text-rose-300/80 font-medium' : 'text-muted-foreground/70')}>
          (limit {limitPct}%)
        </span>
        {delta !== null && (
          <TrendBadge delta={delta} invert />
        )}
      </div>
    </InstrumentTile>
  );
}
