// ─── Shared drill-interaction components (M2/M3) ────────────────────────────
// Per the improvement plan: the three drill systems on the dashboard
// (Production/NRW's granularity×breakdown, TDS/Recovery's
// default↔by-train↔by-hour, Plant Health's daily↔hourly↔monthly) keep their
// own state machines — merging them was explicitly ruled out as more risk
// than this round needs. What DOES get shared is the *interaction layer* on
// top: the granularity control, the stack/group toggle, the breadcrumb, and
// the click-to-drill affordance, so drilling in feels identical no matter
// which chart it's on.
//
// This module holds that shared layer's three actual UI components. The
// non-component logic they depend on (stack-mode persistence, drill-focus
// math, entity isolation, the drillable-bar-shape factory) lives in
// TrendChartDrillKit.ts instead — see that file's header for why the split
// exists (react-refresh/only-export-components). Import from whichever of
// the two files actually has what you need.
//
// NOTE — this split was accidentally reverted once already (a stale-branch
// merge on 2026-08-11 overwrote this file back to its pre-split, monolithic
// form and orphaned TrendChartDrillKit.ts entirely — 0 importers, silently
// dead code — which is how the 7 react-refresh warnings this split fixes
// came back). If you're about to add a new non-component export here,
// it almost certainly belongs in TrendChartDrillKit.ts instead — that's the
// whole point of the split holding.
//
// TrendChart.tsx currently wires these into Production/NRW, Raw Water's
// By-well breakdown, TDS/Recovery's by-train breakdown, and Plant Health's
// daily→hourly drill — i.e. every chart named in the plan now shares this
// interaction layer.

import React from 'react';
import { BarChart2, ChevronsUp, Rows3, Columns3 } from 'lucide-react';
import { isGranularityUsable, type Granularity } from './TrendChartAggregate';
import type { StackMode, DrillCrumb } from './TrendChartDrillKit';

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
  const allOptions: { key: Granularity; label: string; icon: React.ReactNode }[] = [
    { key: 'daily', label: 'Daily', icon: <BarChart2 className="h-3 w-3" /> },
    { key: 'weekly', label: 'Weekly', icon: <Rows3 className="h-3 w-3" /> },
    { key: 'monthly', label: 'Monthly', icon: <ChevronsUp className="h-3 w-3" /> },
  ];
  // Only offer Monthly bucketing when the active range span has enough data (>= 45 days, e.g. YTD or 60D/90D).
  // On shorter ranges (7D, 14D, 30D, single month), hide the Monthly view option completely so there is NO duplicate
  // 'Monthly' button conflicting with the Range selector's Monthly button.
  const options = allOptions.filter((opt) => opt.key !== 'monthly' || isGranularityUsable('monthly', rangeDays));

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {options.map(({ key, label, icon }) => {
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
              'h-6 min-w-[24px] px-2 rounded text-2xs font-medium transition-all leading-none flex items-center gap-1 border',
              !usable
                ? 'opacity-40 cursor-not-allowed bg-muted/40 text-muted-foreground/60 border-border/40'
                : active
                  ? 'bg-primary text-primary-foreground border-primary font-semibold shadow-xs cursor-pointer'
                  : 'bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted border-border/80 cursor-pointer',
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
// Only shown where there's actually something to stack — hidden otherwise.
// State persistence (readStackMode/writeStackMode) lives in
// TrendChartDrillKit.ts; this is just the segmented-control UI over it.
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
          'h-6 min-w-[24px] px-2 rounded text-2xs font-medium transition-colors flex items-center gap-1 cursor-pointer',
          value === 'grouped' ? 'bg-primary text-primary-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground',
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
          'h-6 min-w-[24px] px-2 rounded text-2xs font-medium transition-colors flex items-center gap-1 cursor-pointer',
          value === 'stacked' ? 'bg-primary text-primary-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        <Rows3 className="h-3 w-3 rotate-90" />
        Stack
      </button>
    </div>
  );
}

// ── Breadcrumb ───────────────────────────────────────────────────────────
// DrillCrumb's shape lives in TrendChartDrillKit.ts (it's a plain data type,
// not UI) — imported at the top of this file as a type-only import so it
// doesn't count as a value export from this components-only file.

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
