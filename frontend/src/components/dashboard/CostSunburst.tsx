// Cost Composition Sunburst: Cost -> {Power, Chemicals} -> individual
// chemical ($). Built with d3-hierarchy (partition layout) + d3-shape (arc
// path generator) for the math only — all DOM is rendered through React
// JSX, not d3-selection, so it behaves like any other React component
// (no manual DOM diffing to fight with React's reconciler).
//
// Zoom: clicking a ring segment re-centers the layout on that node by
// recomputing every node's angular span relative to the clicked node's
// x0/x1 (the standard "zoomable sunburst" technique). The `d` attribute
// on each <path> transitions via a plain CSS `transition: d`, which modern
// browsers animate natively since every arc comes from the same generator
// (same path-command structure, only the numbers change) — no d3-transition
// or d3-interpolate dependency needed. Older browsers just snap instantly;
// nothing breaks.
import { useMemo, useState } from 'react';
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc as arcGenerator } from 'd3-shape';
import { ChevronLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { fmtNum } from '@/lib/calculations';
import { useCostComposition, type CostSunburstNode } from '@/hooks/useCostComposition';
import { rangeKeyToDays } from './types';
import { useAppStore } from '@/store/appStore';
import { DRILL_COLORS } from './TrendChart';

interface Props {
  plantIds: string[];
}

type RNode = HierarchyRectangularNode<CostSunburstNode> & { id: string };

const SIZE = 320;
const CENTER = SIZE / 2;
const RING = SIZE / 6;

function peso(n: number) {
  return `₱${fmtNum(n)}`;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

/** Node's angular/radial span re-expressed relative to `focus`, in the
 *  [0, 2π] x [0, ring-count] space the arc generator expects. Returns
 *  null when the node shouldn't be drawn at the current zoom level
 *  (it's an ancestor of the focus, or outside its angular slice). */
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
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);

  const { data, isLoading } = useCostComposition(plantIds, days);
  const [focusId, setFocusId] = useState('Cost');

  const { nodes, byId, rootNode } = useMemo(() => {
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

  const focus = byId.get(focusId) ?? rootNode;
  const arc = useMemo(
    () => arcGenerator<{ x0: number; x1: number; y0: number; y1: number }>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.008))
      .padRadius(RING * 1.5)
      .innerRadius((d) => d.y0 * RING)
      .outerRadius((d) => Math.max(d.y0 * RING, d.y1 * RING - 1)),
    [],
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cost Composition</CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-72 w-full" /></CardContent>
      </Card>
    );
  }

  if (!data || !rootNode || !(data.root.children?.length)) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cost Composition</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            No cost data for this period.
          </div>
        </CardContent>
      </Card>
    );
  }

  const rootChildren = rootNode.children ?? [];
  const colorFor = (d: RNode): string => {
    let n: RNode = d;
    while (n.depth > 1 && n.parent) n = n.parent as RNode;
    const idx = rootChildren.findIndex((c) => c === n);
    const base = DRILL_COLORS[idx % DRILL_COLORS.length];
    return d.depth > 1 ? base : base;
  };
  const opacityFor = (d: RNode) => (d.depth - (focus?.depth ?? 0) === 1 ? 0.9 : 0.65);

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Cost Composition</CardTitle>
          <CardDescription>
            Power vs. chemicals — click a slice to drill in. Last {days} day{days === 1 ? '' : 's'}.
          </CardDescription>
        </div>
        {focus && focus.id !== 'Cost' && (
          <Button
            variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0"
            onClick={() => setFocusId((focus.parent as RNode | null)?.id ?? 'Cost')}
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-2">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[320px] h-auto">
            <g transform={`translate(${CENTER},${CENTER})`}>
              {nodes.filter((d) => d.depth > 0).map((d) => {
                if (!focus) return null;
                const span = visibleSpan(d, focus);
                if (!span || span.y0 > 3) return null;
                const clickable = !!d.children?.length;
                const midAngle = (span.x0 + span.x1) / 2;
                const midRadius = ((span.y0 + span.y1) / 2) * RING;
                const showLabel = span.x1 - span.x0 > 0.12 && span.y1 > span.y0;
                const labelDeg = (midAngle * 180) / Math.PI;
                return (
                  <g key={d.id}>
                    <path
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
                    {showLabel && (
                      <text
                        transform={`rotate(${labelDeg - 90}) translate(${midRadius},0) rotate(${labelDeg < 180 ? 0 : 180})`}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontSize: 9, fill: 'hsl(var(--card-foreground))', pointerEvents: 'none' }}
                      >
                        {d.data.name}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Center circle — shows the focused node's total; click to zoom out */}
              <circle
                r={RING - 2}
                style={{
                  fill: 'hsl(var(--muted))',
                  cursor: focus && focus.id !== 'Cost' ? 'pointer' : 'default',
                }}
                onClick={() => focus && focus.id !== 'Cost' && setFocusId((focus.parent as RNode | null)?.id ?? 'Cost')}
              />
              <text textAnchor="middle" y={-4} style={{ fontSize: 11, fontWeight: 600, fill: 'hsl(var(--foreground))' }}>
                {focus?.data.name ?? 'Cost'}
              </text>
              <text textAnchor="middle" y={12} style={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}>
                {peso(focus?.value ?? 0)}
              </text>
            </g>
          </svg>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center text-[11px] text-muted-foreground">
            {rootChildren.map((c, i) => (
              <span key={c.data.name} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: DRILL_COLORS[i % DRILL_COLORS.length] }}
                />
                {c.data.name} · {peso(c.value ?? 0)}
              </span>
            ))}
          </div>

          {!data.hasChemBreakdown && (
            <p className="text-[10px] text-muted-foreground/70 text-center max-w-[280px]">
              No per-chemical prices on file yet — Chemicals shows the total from Production Costs.
              Add prices on the Costs page to unlock the per-chemical ring.
            </p>
          )}
          {data.hasChemBreakdown && data.unpricedChemicals.length > 0 && (
            <p className="text-[10px] text-muted-foreground/70 text-center max-w-[280px]">
              No price on file for {data.unpricedChemicals.join(', ')} — excluded from the breakdown above.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
