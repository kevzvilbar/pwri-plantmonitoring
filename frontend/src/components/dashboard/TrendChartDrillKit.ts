// ─── Drill-interaction logic (M2/M3), split from TrendChartDrill.tsx ───────
// TrendChartDrill.tsx originally held both the three drill UI components
// (GranularityControl, StackToggle, DrillBreadcrumb) AND this plain
// state/logic layer (stack-mode persistence, drill-focus math, entity
// isolation, the drillable-bar-shape factory) in one file. That mix trips
// react-refresh/only-export-components — Vite's Fast Refresh needs a
// component file to export ONLY components, so it can tell "this module
// changed, remount just this component" apart from "this module changed,
// I don't know what depends on it, full reload." Seven exports here
// (stackModeStorageKey, readStackMode, writeStackMode, focusToRange,
// nextFinerGranularity, toggleIsolateEntity, makeDrillableBarShape) aren't
// components, so each one flagged a warning once TrendChartDrill.tsx also
// started exporting real components in the M2/M3 pass.
//
// Same fix already applied once on this dashboard: lib/regressionCorrection.ts
// was split out of DataAnalysis.tsx for the identical reason (see
// lint-ceiling.json's 2026-08-10 history entry — "Moved runOLS and friends
// out of DataAnalysis.tsx into lib/regressionCorrection.ts (a plain .ts
// file, no JSX)... the extraction is a strictly better fix than accepting
// the trade-off in place"). This file follows that same convention: plain
// .ts, no JSX at module scope. makeDrillableBarShape still needs to hand
// Recharts a component, so its returned closure builds the <rect> via
// React.createElement instead of JSX — that's the only reason this file
// doesn't need a .tsx extension.
//
// TrendChartDrill.tsx re-imports everything it needs from here; nothing in
// this file imports from TrendChartDrill.tsx, so there's no cycle.

import React from 'react';
import { isGranularityUsable, type Granularity } from './TrendChartAggregate';

// ── Stack / Group toggle (M2) — persisted state ──────────────────────────
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

// ── Breadcrumb data shape ────────────────────────────────────────────────
export interface DrillCrumb {
  /** e.g. "30D", "Aug 2026", "Wk of Aug 4", "By locator" */
  label: string;
  /** Omit on the last (current) crumb — it isn't clickable. */
  onSelect?: () => void;
}

// ── Local drill-focus window ─────────────────────────────────────────────
// Clicking a bar time-drills into that period. Rather than mutating the
// shared global dashboard range (useAppStore's chartRange/From/To — every
// other chart on the page reads that same range, so silently narrowing it
// out from under a bar click would resize charts the user didn't touch),
// each chart keeps its own local focus override: "show only this
// week/month/day, at the next-finer granularity" layered on top of the
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

/**
 * Re-exported so chart-specific auto-disable checks (e.g. hiding a
 * click-to-drill affordance on a bucket too short to drill further) can
 * share the exact same usability rule as the GranularityControl buttons
 * without importing TrendChartAggregate directly in every call site.
 */
export { isGranularityUsable, type Granularity };

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
//
// Built with React.createElement rather than JSX so this stays a plain .ts
// file (see the file header) — the element tree is small enough that this
// doesn't cost readability.
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
    return React.createElement('rect', {
      x,
      y,
      width: Math.max(0, width),
      height: Math.max(0, height),
      fill,
      fillOpacity: isPartial ? 0.45 : 1,
      strokeDasharray: isPartial ? '3 2' : undefined,
      stroke: isPartial ? fill : undefined,
      strokeWidth: isPartial ? 1 : 0,
      rx: r0,
      ry: r1,
      role: 'button',
      tabIndex: 0,
      'aria-label': ariaLabel(payload ?? {}),
      style: { cursor: 'pointer', outline: 'none' },
      className: 'trend-drill-bar',
      onClick: activate,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      },
    });
  };
}
