// ─── Shared drill-interaction primitives (M3) ───────────────────────────────
// Per the improvement plan: the three drill systems on the dashboard
// (Production/NRW's granularity×breakdown, TDS/Recovery's
// default↔by-train↔by-hour, Plant Health's daily↔hourly↔monthly) keep their
// own state machines — merging them was explicitly ruled out as more risk
// than this round needs. What DOES get shared is the *interaction layer* on
// top: the breadcrumb, the click-to-drill affordance, and the hover/focus
// styling, so drilling in feels identical no matter which chart it's on.
//
// This module is that shared layer. TrendChart.tsx currently wires it into
// the Production/NRW chart (the flagship case named in the brief); the same
// pieces are ready to wire into TDS/Recovery and Plant Health next — each
// just needs its own small adapter that turns "user clicked this bar" into
// "call setRoDrillMode / setPhDrillMode with the right value", the same way
// the Production/NRW adapter below does for setViewGran/setViewBreakdown.

import React from 'react';
import { BarChart2, ChevronsUp, Rows3, Columns3 } from 'lucide-react';
import { isGranularityUsable, type Granularity } from './TrendChartAggregate';

// ── Granularity control (M1) ─────────────────────────────────────────────
// One shared Daily / Weekly / Monthly segmented control, used everywhere a
// metric's primary series flows through the shared chartData→buildTrendRows
// pipeline (production, nrw, rawwater, productionCost, pv, kwh, and the
// 'default' sub-view of tds/recovery). Auto-disables a granularity that
// would show a chart with only a sliver of a bucket in it, per
// isGranularityUsable — e.g. Weekly on a 7D range.
export function GranularityControl({
  value, onChange, rangeDays, testIdPrefix,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
  rangeDays: number;
  testIdPrefix?: string;
}) {
  const OPTIONS: { key: Granularity; label: string; icon: React.ReactNode; activeClass: string }[] = [
    { key: 'daily', label: 'Daily', icon: <BarChart2 className="h-3 w-3" />, activeClass: 'bg-primary text-white border-primary' },
    { key: 'weekly', label: 'Weekly', icon: <Rows3 className="h-3 w-3" />, activeClass: 'bg-chart-2 text-white border-chart-2' },
    { key: 'monthly', label: 'Monthly', icon: <ChevronsUp className="h-3 w-3" />, activeClass: 'bg-kpi-ro text-white border-kpi-ro' },
  ];
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {OPTIONS.map(({ key, label, icon, activeClass }) => {
        const usable = isGranularityUsable(key, rangeDays);
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            disabled={!usable}
            onClick={() => usable && onChange(key)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${key}` : undefined}
            title={usable ? undefined : `Needs a longer date range to show more than one ${key === 'weekly' ? 'week' : 'month'}`}
            className={[
              'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
              !usable
                ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border'
                : active
                  ? activeClass
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
            ].join(' ')}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Stack / Group toggle (M2) ────────────────────────────────────────────
export type StackMode = 'stacked' | 'grouped';

/** localStorage-backed, per-metric — mirrors the VIEW_MODE_KEY pattern in types.ts. */
export function stackModeStorageKey(metric: string): string {
  return `pwri:trend-stack-mode:${metric}`;
}

export function readStackMode(metric: string, fallback: StackMode = 'grouped'): StackMode {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(stackModeStorageKey(metric));
  return raw === 'stacked' || raw === 'grouped' ? raw : fallback;
}

export function writeStackMode(metric: string, mode: StackMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(stackModeStorageKey(metric), mode);
}

/** Only shown where there's actually something to stack — hidden otherwise. */
export function StackToggle({
  value, onChange, testId,
}: {
  value: StackMode;
  onChange: (v: StackMode) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 shrink-0" data-testid={testId}>
      <button
        type="button"
        onClick={() => onChange('grouped')}
        title="Grouped bars — compare entities side by side"
        className={[
          'h-4 px-1.5 rounded text-2xs font-medium transition-colors flex items-center gap-0.5',
          value === 'grouped' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        <Columns3 className="h-3 w-3" />
        Group
      </button>
      <button
        type="button"
        onClick={() => onChange('stacked')}
        title="Stacked bars — see the combined total"
        className={[
          'h-4 px-1.5 rounded text-2xs font-medium transition-colors flex items-center gap-0.5',
          value === 'stacked' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        <Rows3 className="h-3 w-3 rotate-90" />
        Stack
      </button>
    </div>
  );
}

// ── Breadcrumb ───────────────────────────────────────────────────────────

export interface DrillCrumb {
  /** e.g. "30D", "Aug 2026", "Wk of Aug 4", "By locator" */
  label: string;
  /** Omit on the last (current) crumb — it isn't clickable. */
  onSelect?: () => void;
}

/**
 * "30D › Aug 2026 › Wk of Aug 4 › By locator" — each non-final segment is
 * clickable and jumps back to that point in the drill path. Replaces
 * relying on the button row alone for orientation once state can change
 * from click targets scattered across the chart (bars, legend entries)
 * instead of just the two granularity/breakdown buttons.
 */
export function DrillBreadcrumb({ crumbs }: { crumbs: DrillCrumb[] }) {
  if (crumbs.length <= 1) return null;
  return (
    <nav
      aria-label="Drill path"
      className="flex flex-wrap items-center gap-1 mb-1.5 text-2xs"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span className="text-muted-foreground/50" aria-hidden>›</span>}
            {isLast || !c.onSelect ? (
              <span className="font-semibold text-foreground">{c.label}</span>
            ) : (
              <button
                type="button"
                onClick={c.onSelect}
                className="text-muted-foreground hover:text-foreground hover:underline transition-colors font-medium"
              >
                {c.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ── Local drill-focus window ─────────────────────────────────────────────
// Clicking a bar time-drills into that bucket. Rather than mutating the
// shared global dashboard range (useAppStore's chartRange/From/To — every
// other chart on the page reads that same range, so silently narrowing it
// out from under a bar click would resize charts the user didn't touch),
// each chart keeps its own local focus override: "show only this
// week/month, at the next-finer granularity" layered on top of the
// existing fetched data. Clearing it (via the breadcrumb or the same bar)
// restores the full range.
export interface DrillFocus {
  /** yyyy-MM-dd bucket start the user drilled into. */
  bucketIsoDate: string;
  /** Human label for the breadcrumb, e.g. "Aug 2026" or "Wk of Aug 4". */
  label: string;
  /** The granularity that produced the clicked bucket (what we drilled FROM). */
  fromGranularity: 'monthly' | 'weekly';
}

/** Local start/end (yyyy-MM-dd, inclusive) for the bucket a focus points at. */
export function focusToRange(focus: DrillFocus): { startKey: string; endKey: string } {
  const start = new Date(`${focus.bucketIsoDate}T00:00:00`);
  const end = new Date(start);
  if (focus.fromGranularity === 'monthly') {
    end.setMonth(end.getMonth() + 1);
    end.setDate(0); // last day of that month
  } else {
    end.setDate(end.getDate() + 6); // ISO week: Mon..Sun
  }
  const fmt = (d: Date) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { startKey: fmt(start), endKey: fmt(end) };
}

/** The finer granularity a click on a monthly/weekly bar should drill into. */
export function nextFinerGranularity(g: 'monthly' | 'weekly'): 'weekly' | 'daily' {
  return g === 'monthly' ? 'weekly' : 'daily';
}

// ── Legend click → isolate entity ────────────────────────────────────────
// Clicking a legend entry isolates that one series; clicking the same entry
// again (or an "all" reset) restores every entity. Pure state-transition
// helper so the same behavior is trivial to wire into any chart that has an
// `entities: {id}[]` list and a `Set<string> | null` selection (null = all).
export function toggleIsolateEntity(
  current: Set<string> | null,
  entityId: string,
  allIds: string[],
): Set<string> | null {
  // Already isolated to exactly this one entity → clicking it again resets to "all".
  if (current && current.size === 1 && current.has(entityId)) return null;
  return new Set([entityId]);
}

// ── Keyboard-accessible, drillable bar shape ─────────────────────────────
// Recharts <Bar> renders plain <rect> nodes that are mouse-only by default —
// nothing marks them as interactive for a keyboard or screen-reader user.
// This custom `shape` renders the same rect but adds role="button",
// tabIndex, onKeyDown (Enter/Space), an aria-label, a pointer cursor, and a
// subtle hover/focus highlight, so "this is drillable" is signalled beyond
// the separate control row above the chart.
export interface DrillableBarShapeProps {
  x?: number; y?: number; width?: number; height?: number; fill?: string;
  payload?: Record<string, unknown>;
  radius?: [number, number, number, number];
  /** Called with the row's payload when activated (click or Enter/Space). */
  onActivate: (payload: Record<string, unknown>) => void;
  /** Builds the aria-label for a given row, e.g. "Drill into August 2026". */
  ariaLabel: (payload: Record<string, unknown>) => string;
}

export function makeDrillableBarShape(
  onActivate: (payload: Record<string, unknown>) => void,
  ariaLabel: (payload: Record<string, unknown>) => string,
) {
  return (props: any) => {
    const { x = 0, y = 0, width = 0, height = 0, fill, payload, radius } = props;
    const isPartial = !!payload?._partial;
    const [r0, r1] = Array.isArray(radius) ? radius : [3, 3];
    const activate = () => onActivate(payload ?? {});
    return (
      <rect
        x={x}
        y={y}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        fill={fill}
        fillOpacity={isPartial ? 0.45 : 1}
        strokeDasharray={isPartial ? '3 2' : undefined}
        stroke={isPartial ? fill : undefined}
        strokeWidth={isPartial ? 1 : 0}
        rx={r0}
        ry={r1}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel(payload ?? {})}
        style={{ cursor: 'pointer', outline: 'none' }}
        className="trend-drill-bar"
        onClick={activate}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        }}
      />
    );
  };
}
