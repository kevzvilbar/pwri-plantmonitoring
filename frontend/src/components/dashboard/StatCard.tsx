import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/StatusPill';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { StatTone, TONE_BG, TONE_ICON } from './types';
import { InstrumentTile } from './InstrumentTile';
import { cn } from '@/lib/utils';

// ── Technical mono numerals for KPI readouts — matches all dashboard cards ──
// JetBrains Mono / IBM Plex Mono with clean tabular figures. Declared once as
// the `font-numeral` Tailwind token (tailwind.config.ts) and configured in
// index.css — see those files rather than re-declaring it here.

// Re-triggers a CSS animation on the readout whenever the underlying value
// actually changes. Background sync refreshes telemetry silently — without
// this, an updated KPI is invisible (impeccable /animate: motion must make
// state change legible). Returns a counter; render the readout with
// `key={tick}` so it remounts and `.animate-value-tick` restarts. The first
// render never ticks: initial paint is arrival, not a change.
function useValueTick(value: unknown): number {
  const [tick, setTick] = useState(0);
  const prevRef = useRef(value);
  useEffect(() => {
    if (!Object.is(prevRef.current, value)) {
      prevRef.current = value;
      setTick((t) => t + 1);
    }
  }, [value]);
  return tick;
}

// Concise inline trend indicator with tabular numbers (no jitter, no floating pills)
// Renders nothing when `delta` is null or non-finite.
export function TrendBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null || !Number.isFinite(delta)) return null;
  const abs = Math.abs(delta);
  const Icon = abs < 0.5 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const isPositive = invert ? delta < 0 : delta > 0;
  const cls = abs < 0.5
    ? 'text-muted-foreground'
    : isPositive ? 'text-accent' : 'text-danger';

  // Anomaly / low-baseline recovery framing: when abs(delta) >= 300%,
  // render in magnitude mode (e.g. +52× vs prev day) so it doesn't look like a counter overflow.
  const mult = Math.round(abs / 100);
  const text = abs < 0.5
    ? '0.0%'
    : abs >= 300
      ? `${delta > 0 ? '+' : '-'}${mult}× vs prev day (low baseline)`
      : `${delta > 0 ? '+' : '-'}${abs.toFixed(1)}% vs prev day`;

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold font-mono tabular-nums ${cls}`} title="vs previous day">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </span>
  );
}

// Per-train (or per-entity) breakdown row type.
// `value` is null when the entity has no reading for this metric.
export type ExpandRow = { label: string; value: string | number | null };

// Standard KPI tile used across the dashboard clusters. Housed panel
// with 1px hairline border, subtle edge-light, and glowing tabular mono readout.
export function StatCard({
  icon: Icon, label, value, unit, tone, onClick, accent, calc, threshold,
  size = 'default', trend = null, calcTooltip,
  expandRows, expandUnit, subtext, badge, className,
}: {
  icon: any; label: string; value: any; unit?: string;
  tone?: StatTone; onClick?: () => void; accent?: string;
  calc?: boolean; threshold?: string;
  size?: 'compact' | 'default' | 'lg' | 'hero';
  trend?: number | null;
  calcTooltip?: string;
  // Optional per-train breakdown revealed by a chevron toggle (hidden by default).
  expandRows?: ExpandRow[];
  // Unit appended to each row value; defaults to the card's own `unit`.
  expandUnit?: string;
  subtext?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const valueTick = useValueTick(value);

  const liveRows    = (expandRows ?? []).filter((r) => r.value != null);
  const showExpand  = liveRows.length >= 2;
  const rowUnit     = expandUnit ?? unit ?? '';

  const isHero    = size === 'hero';
  const isLg      = size === 'lg' || isHero;
  const isCompact = size === 'compact';
  const toneBg    = tone ? TONE_BG[tone] : '';
  const calcBg    = !tone && calc ? 'border-l-2 border-l-info' : '';
  // Icons are strictly bare and monochromatic adjacent to the label, letting the raw numerical value command primary visual focus.
  // Color is reserved strictly for semantic alarm/warning tones (warn/danger).
  const iconCls   = (tone === 'warn' || tone === 'danger') ? TONE_ICON[tone] : 'text-muted-foreground/80';

  return (
    <InstrumentTile
      className={cn('stat-card min-w-0 h-full', className)}
      onClick={onClick}
      tone={tone}
      edgeLight={accent as any}
    >
      <div>
        {/* ── Header row: icon · LABEL (uppercase) · badges/expand (decluttered) ── */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <Icon className={cn('shrink-0', isHero ? 'h-4 w-4' : isLg ? 'h-4 w-4' : 'h-3.5 w-3.5', iconCls)} />
            <span className={cn('uppercase tracking-wide font-semibold truncate leading-none text-muted-foreground', isHero ? 'text-xs' : isLg ? 'text-xs' : isCompact ? 'text-3xs' : 'text-2xs')}>
              {label}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {badge}
            {tone && <StatusPill tone={tone} />}
            {showExpand && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="h-5 w-5 flex items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title={expanded ? 'Hide breakdown' : 'Show per-train breakdown'}
                aria-label={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* ── Value row ──
            key={valueTick} remounts the readout when the value actually changes,
            restarting the tick so background-sync updates are legible. */}
        <div
          key={valueTick}
          className={cn(
            'mt-2 leading-none whitespace-nowrap overflow-hidden text-ellipsis font-mono tabular-nums',
            tone === 'danger'
              ? 'text-rose-700 dark:text-rose-200'
              : tone === 'warn'
              ? 'text-amber-700 dark:text-amber-200'
              : 'text-foreground',
            isHero ? 'text-3xl sm:text-4xl font-bold' : isLg ? 'text-2xl sm:text-3xl font-bold' : isCompact ? 'text-xl font-bold' : 'text-2xl font-bold',
            valueTick > 0 ? 'animate-value-tick' : ''
          )}
        >
          {value}
          {unit && (
            <span
              className={cn(
                'font-sans font-normal ml-1.5',
                tone === 'danger'
                  ? 'text-rose-600/80 dark:text-rose-300/80'
                  : tone === 'warn'
                  ? 'text-amber-600/80 dark:text-amber-300/80'
                  : 'text-muted-foreground',
                isHero ? 'text-base sm:text-lg' : isLg ? 'text-sm' : 'text-xs'
              )}
            >
              {unit}
            </span>
          )}
        </div>
      </div>

      {/* ── Below-value: decluttered metadata row (limit, calc, trend) ── */}
      <div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {calc && (
            <span
              className="text-3xs uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] font-mono bg-info/10 text-info border border-info/20 shrink-0"
              title={calcTooltip ?? 'Calculated / derived metric'}
            >
              calc
            </span>
          )}
          {threshold && (
            <span className="text-3xs text-muted-foreground/70 shrink-0 font-mono">
              (limit {threshold})
            </span>
          )}
          {trend !== null && trend !== undefined && (
            <TrendBadge delta={trend} />
          )}
        </div>

        {/* ── Subtext / Metadata footer ── */}
        {subtext && (
          <div className="mt-1 text-2xs text-muted-foreground truncate font-mono">
            {subtext}
          </div>
        )}

        {/* ── Per-train expand rows ── */}
        {showExpand && expanded && (
          <div className="mt-2 p-2 rounded-[4px] bg-muted/40 border border-border/40 space-y-0.5 max-h-24 overflow-y-auto">
            {liveRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between text-2xs">
                <span className="text-muted-foreground truncate">{row.label}</span>
                <span className="text-foreground/90 tabular-nums shrink-0 ml-2 font-mono">
                  {row.value}
                  {rowUnit && <span className="text-muted-foreground ml-0.5 font-sans">{rowUnit}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </InstrumentTile>
  );
}

// Quality-cluster card that surfaces an aggregate Raw value at the top
// and renders a compact per-train breakdown beneath. Used for Raw TDS
// and Raw NTU.
export function PerWellSourceCard({
  icon: Icon, label, unit, aggregate, rows, field, plantCodeById,
  testId, decimals = 0, multiPlant = false,
}: {
  icon: any;
  label: string;
  unit: string;
  aggregate: number | null | undefined;
  rows: any[];
  /** 'tds_ppm' is used when rows come from well_readings (per-well source cards). */
  field: 'feed_tds' | 'tds_ppm' | 'turbidity_ntu' | 'permeate_tds';
  plantCodeById: Map<string, string>;
  testId: string;
  decimals?: number;
  // When true (multiple plants selected) prefixes each row with the plant
  // code so the user can tell which plant each train belongs to.
  multiPlant?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const aggregateTick = useValueTick(aggregate);

  const liveRows     = rows.filter((r) => r[field] != null);
  const showBreakdown = liveRows.length >= 2;

  const rowLabel = (r: any) => {
    const trainName = r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?');
    if (multiPlant) {
      const code = plantCodeById.get(r.plant_id) ?? '';
      return code ? `${code} · ${trainName}` : trainName;
    }
    return trainName;
  };

  return (
    <InstrumentTile
      className="stat-card min-w-0"
      data-testid={testId}
    >
      <div>
        {/* ── Header: icon · LABEL (uppercase) · per-well badge + expand ── */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <Icon className="shrink-0 h-3.5 w-3.5 text-muted-foreground/80" />
            <span className="uppercase tracking-wide font-semibold truncate leading-none text-2xs text-muted-foreground">
              {label}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {showBreakdown && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="h-5 w-5 flex items-center justify-center rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title={expanded ? 'Hide breakdown' : 'Show per-train breakdown'}
                aria-label={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* ── Value ── (key={aggregateTick} restarts the tick on real changes) */}
        <div
          key={aggregateTick}
          className={`mt-2 text-foreground leading-none whitespace-nowrap text-2xl font-bold font-mono tabular-nums ${aggregateTick > 0 ? 'animate-value-tick' : ''}`}
        >
          {aggregate ?? '—'}
          {unit && <span className="font-sans font-normal text-muted-foreground ml-1.5 text-xs">{unit}</span>}
        </div>
      </div>

      {/* ── Expand rows ── */}
      {showBreakdown && expanded && (
        <div className="mt-2 p-2 rounded-[4px] bg-muted/40 border border-border/40 space-y-0.5 max-h-24 overflow-y-auto">
          {liveRows.map((r) => (
            <div
              key={`${r.plant_id}-${r.well_id ?? r.train_id ?? r.train_number}`}
              className="flex items-center justify-between text-2xs"
            >
              <span className="text-muted-foreground truncate">{rowLabel(r)}</span>
              <span className="text-foreground/90 tabular-nums shrink-0 ml-2 font-mono">
                {decimals === 0 ? Math.round(r[field]) : (+r[field]).toFixed(decimals)}
              </span>
            </div>
          ))}
        </div>
      )}
    </InstrumentTile>
  );
}

// Section heading shared between the three clusters (Overview /
// Quality / Production Cost). Tactical bracket framing and loosened macro-whitespace.
export function ClusterHeader({
  icon: Icon, title, subtitle, accent,
}: {
  icon: any; title: string; subtitle?: string; accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-3 px-1 pb-1.5 border-b border-border/40">
      <div
        className={`h-3.5 w-[2px] rounded-full shrink-0 ${accent ?? 'bg-primary'}`}
        style={{ background: accent?.startsWith('#') ? accent : undefined }}
      />
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xs font-mono text-muted-foreground/60">[</span>
        <h2 className="text-xs font-bold uppercase tracking-wider text-foreground/90 font-mono">{title}</h2>
        <span className="text-3xs font-mono text-muted-foreground/60">]</span>
      </div>
      {subtitle && <span className="text-2xs text-muted-foreground/70 font-mono">({subtitle})</span>}
    </div>
  );
}
