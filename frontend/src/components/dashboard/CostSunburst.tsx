// Cost Composition Sunburst: Cost -> {Power, Chemicals} -> individual
// chemical ($). Built with d3-hierarchy (partition layout) + d3-shape (arc
// path generator) for the math only — all DOM is rendered through React
// JSX, not d3-selection, so it behaves like any other React component.
//
// Layout mirrors the rest of the dashboard's compact chart cards (`p-3`
// Card, 13px bold title row) instead of the generic shadcn Card
// header/content padding, and the ring is sized dynamically from the
// hierarchy's actual depth so it always fills the available circle —
// previously a fixed radius left 2/3 of the circle blank whenever there
// was no per-chemical price breakdown to show. Power/Chemicals use the
// same accent colors (--chart-6 / --highlight) as the Power Cost / Chemical
// Cost stat cards right above this on the Dashboard, so the sunburst reads
// as a continuation of those tiles rather than an unrelated chart.
//
// Zoom: clicking a ring segment (or its legend row) re-centers the layout
// on that node by recomputing every node's angular span relative to the
// clicked node's x0/x1. The `d` attribute on each <path> transitions via a
// plain CSS `transition: d`, which modern browsers animate natively since
// every arc comes from the same generator — no d3-transition/d3-interpolate
// dependency needed. Older browsers just snap instantly; nothing breaks.
import { useEffect, useMemo, useState } from 'react';
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc as arcGenerator } from 'd3-shape';
import { ChevronLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtNum } from '@/lib/calculations';
import { useCostComposition, type CostSunburstNode } from '@/hooks/useCostComposition';
import { rangeKeyToDays } from './types';
import { useAppStore } from '@/store/appStore';

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

interface Props {
  plantIds: string[];
}

type RNode = HierarchyRectangularNode<CostSunburstNode> & { id: string };

const SIZE = 200;

// Same accents as the Power Cost / Chemical Cost StatCards above this
// chart (`text-chart-6` / `text-highlight` in Dashboard.tsx) — fixed by
// category rather than by sort order, so "Power" is always this color
// regardless of which slice happens to be bigger this period.
const POWER_COLOR = 'hsl(var(--chart-6))';
const CHEM_COLOR = 'hsl(var(--highlight))';

function peso(n: number) {
  return `₱${fmtNum(n)}`;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

/** Node's angular/radial span re-expressed relative to `focus`. Returns
 *  null when the node shouldn't be drawn at the current zoom level (it's
 *  an ancestor of the focus, or outside its angular slice). */
function visibleSpan(d: RNode, focus: RNode) {
  if (d.depth <= focus.depth) return null;
  const spanX = focus.x1 - focus.x0;
  if (spanX <= 0) return null;
  const x0 = clamp01((d.x0 - focus.x0) / spanX) * 2 * Math.PI;
  const x1 = clamp01((d.x1 - focus.x0) / spanX) * 2 * Math.PI;
  if (x1 - x0 < 1e-4) return null;
  return { x0, x1, y0: d.y0 - focus.depth, y1: d.y1 - focus.depth };
}

export function CostSunburst({ plantIds }: Props) {
  useDMSans();
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);

  const { data, isLoading } = useCostComposition(plantIds, days);
  const [focusId, setFocusId] = useState('Cost');

  const { byId, rootNode } = useMemo(() => {
    if (!data?.root) return { nodes: [] as RNode[], byId: new Map<string, RNode>(), rootNode: null as RNode | null };

    const h = hierarchy(data.root)
      .sum((d) => (d.children ? 0 : d.value ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const laidOut = partition<CostSunburstNode>().size([2 * Math.PI, h.height + 1])(h) as RNode;
    laidOut.each((d) => {
      const rd = d as RNode;
      rd.id = rd.ancestors().map((a) => a.data.name).reverse().join(' / ');
    });

    const all = laidOut.descendants() as RNode[];
    const map = new Map(all.map((d) => [d.id, d]));
    return { nodes: all, byId: map, rootNode: laidOut };
  }, [data]);

  // Ring thickness derived from the tree's actual depth, so the arcs
  // always fill the full circle whether there's 1 ring (no per-chemical
  // prices yet) or 2 (Power/Chemicals -> individual chemical).
  const ringCount = Math.max(1, (rootNode?.height ?? 1) + 1);
  const RING = SIZE / 2 / ringCount;

  const focus = byId.get(focusId) ?? rootNode;
  const arc = useMemo(
    () => arcGenerator<{ x0: number; x1: number; y0: number; y1: number }>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.008))
      .padRadius(RING * 1.5)
      .innerRadius((d) => d.y0 * RING)
      .outerRadius((d) => Math.max(d.y0 * RING, d.y1 * RING - 1)),
    [RING],
  );

  const colorFor = (d: RNode): string => {
    let n: RNode = d;
    while (n.depth > 1 && n.parent) n = n.parent as RNode;
    return n.data.name === 'Power' ? POWER_COLOR : CHEM_COLOR;
  };
  const opacityFor = (d: RNode) => {
    const rel = d.depth - (focus?.depth ?? 0);
    if (rel !== 2) return 0.92;
    const siblings = (d.parent?.children ?? []) as RNode[];
    const idx = Math.max(0, siblings.indexOf(d));
    return Math.max(0.35, 0.85 - idx * 0.14);
  };

  if (isLoading) {
    return (
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-1 mb-2">
          <span className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        </div>
        <Skeleton className="h-[200px] w-full" />
      </Card>
    );
  }

  if (!data || !rootNode || !(data.root.children?.length)) {
    return (
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-1 mb-2">
          <span className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        </div>
        <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
          No cost data for this period.
        </div>
      </Card>
    );
  }

  const focusChildren = ((focus?.children ?? []) as RNode[]);
  const focusTotal = focus?.value ?? 0;
  const isZoomed = !!focus && focus.id !== 'Cost';

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <span className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        <button
          type="button"
          onClick={() => isZoomed && setFocusId((focus!.parent as RNode | null)?.id ?? 'Cost')}
          className={`ml-auto text-[10px] flex items-center gap-0.5 ${isZoomed ? 'text-muted-foreground hover:text-foreground cursor-pointer' : 'text-muted-foreground/70 cursor-default'}`}
        >
          {isZoomed ? <><ChevronLeft className="h-3 w-3" /> back to {(focus!.parent as RNode | null)?.data.name ?? 'Cost'}</> : `click a slice · last ${days}d`}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0" style={{ width: SIZE, height: SIZE }}>
          <g transform={`translate(${SIZE / 2},${SIZE / 2})`}>
            {(rootNode!.descendants() as RNode[]).filter((d) => d.depth > 0).map((d) => {
              if (!focus) return null;
              const span = visibleSpan(d, focus);
              if (!span) return null;
              const clickable = !!d.children?.length;
              return (
                <path
                  key={d.id}
                  d={arc(span) ?? undefined}
                  style={{
                    fill: colorFor(d),
                    opacity: opacityFor(d),
                    cursor: clickable ? 'pointer' : 'default',
                    transition: 'd 400ms ease, opacity 300ms ease',
                    stroke: 'hsl(var(--card))',
                    strokeWidth: 1,
                  }}
                  onClick={clickable ? () => setFocusId(d.id) : undefined}
                >
                  <title>{`${d.data.name}: ${peso(d.value ?? 0)}`}</title>
                </path>
              );
            })}
            {/* Center circle — shows the focused node's total; click to zoom out */}
            <circle
              r={RING - 2}
              style={{ fill: 'hsl(var(--muted))', cursor: isZoomed ? 'pointer' : 'default' }}
              onClick={() => isZoomed && setFocusId((focus!.parent as RNode | null)?.id ?? 'Cost')}
            />
            <text textAnchor="middle" y={-4} style={{ fontSize: 10, fontWeight: 600, fill: 'hsl(var(--foreground))' }}>
              {focus?.data.name ?? 'Cost'}
            </text>
            <text
              textAnchor="middle" y={11}
              style={{ fontSize: 11, fontWeight: 700, fill: 'hsl(var(--foreground))', fontFamily: GEO_FONT }}
              className="tabular-nums"
            >
              {peso(focus?.value ?? 0)}
            </text>
          </g>
        </svg>

        {/* Side legend — breadcrumb-aware: shows whatever is one level
            below the current focus, so it updates as you drill in. Rows
            are clickable too, not just the arcs. */}
        <div className="flex-1 min-w-0 w-full space-y-1">
          {focusChildren.length ? focusChildren.map((c) => {
            const clickable = !!c.children?.length;
            const pct = focusTotal ? ((c.value ?? 0) / focusTotal) * 100 : 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={clickable ? () => setFocusId(c.id) : undefined}
                className={`w-full flex items-center justify-between gap-2 text-[11px] rounded px-1 py-0.5 text-left transition-colors ${clickable ? 'hover:bg-muted/60 cursor-pointer' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: colorFor(c), opacity: opacityFor(c) }} />
                  <span className="truncate text-foreground/90">{c.data.name}</span>
                </span>
                <span className="flex items-baseline gap-1.5 shrink-0 tabular-nums" style={{ fontFamily: GEO_FONT }}>
                  <span className="text-foreground font-semibold">{peso(c.value ?? 0)}</span>
                  <span className="text-muted-foreground text-[10px]">{fmtNum(pct, 0)}%</span>
                </span>
              </button>
            );
          }) : (
            <div className="text-[11px] text-muted-foreground px-1">No further breakdown for {focus?.data.name}.</div>
          )}
        </div>
      </div>

      {!data.hasChemBreakdown && (
        <p className="text-[10px] text-muted-foreground/70 mt-2">
          No per-chemical prices on file yet — Chemicals shows the total from Production Costs.
          Add prices on the Costs page to unlock the per-chemical ring.
        </p>
      )}
      {data.hasChemBreakdown && data.unpricedChemicals.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 mt-2">
          No price on file for {data.unpricedChemicals.join(', ')} — excluded from the breakdown above.
        </p>
      )}
    </Card>
  );
}
