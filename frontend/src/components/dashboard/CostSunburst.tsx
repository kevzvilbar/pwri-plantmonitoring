// Cost Composition Sunburst: Cost -> {Power, Chemicals, Filters} -> Power
// splits into {Grid, Solar}, Chemicals into individual chemicals, Filters
// into housing type ($). Built with d3-hierarchy
// (partition layout) + d3-shape (arc path generator) for the math only —
// all DOM is rendered through React JSX, not d3-selection, so it behaves
// like any other React component.
//
// Layout mirrors the rest of the dashboard's compact chart cards (`p-3`
// Card, 13px bold title row) instead of the generic shadcn Card
// header/content padding, and the ring is sized dynamically from the
// hierarchy's actual depth so it always fills the available circle —
// previously a fixed radius left 2/3 of the circle blank whenever there
// was no per-chemical price breakdown to show. Power/Chemicals use the
// same accent colors (--chart-6 / --highlight) as the Power Cost / Chemical
// Cost stat cards right above this on the Dashboard, so the sunburst reads
// as a continuation of those tiles rather than an unrelated chart. Filters
// gets --chart-4 (violet) — unused elsewhere on this chart, and distinct
// from both neighbors at a glance.
//
// Zoom: clicking a ring segment (or its legend row) re-centers the layout
// on that node by recomputing every node's angular span relative to the
// clicked node's x0/x1. The `d` attribute on each <path> transitions via a
// plain CSS `transition: d`, which modern browsers animate natively since
// every arc comes from the same generator — no d3-transition/d3-interpolate
// dependency needed. Older browsers just snap instantly; nothing breaks.
import { useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc as arcGenerator } from 'd3-shape';
import { ChevronLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtNum } from '@/lib/calculations';
import { useCostComposition, type CostSunburstNode } from '@/hooks/useCostComposition';
import { rangeKeyToDays } from './types';
import { useAppStore } from '@/store/appStore';

// Same numeral typeface as StatCard/NRWGaugeCard/ComplianceRadarCard —
// declared once as the `font-numeral` Tailwind token (tailwind.config.ts)
// and loaded via the single app-wide @import in index.css. Kept as a plain
// string here too because the arc label below is an SVG <text> styled via
// inline `style`, which can't take a Tailwind class.
const GEO_FONT = "'DM Sans', ui-sans-serif, system-ui, sans-serif";

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
const SOLAR_COLOR = 'hsl(var(--kpi-solar))'; // same orange token as the Solar KPI/legend dot on the Energy Mix chart
const CHEM_COLOR = 'hsl(var(--highlight))';
const FILTER_COLOR = 'hsl(var(--chart-4))';

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

/** Color label for each category */
function categorySwatchStyle(name: string): string {
  if (name === 'Solar') return SOLAR_COLOR;
  if (name === 'Grid' || name === 'Power') return POWER_COLOR;
  if (name === 'Chemicals') return CHEM_COLOR;
  return FILTER_COLOR;
}

export function CostSunburst({ plantIds }: Props) {
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);

  const isCustomRange = chartRange === 'CUSTOM';
  const resolvedTo = isCustomRange ? chartTo : format(new Date(), 'yyyy-MM-dd');
  const resolvedFrom = isCustomRange ? chartFrom : format(subDays(new Date(), days), 'yyyy-MM-dd');

  const { data, isLoading } = useCostComposition(plantIds, days, resolvedFrom, resolvedTo);
  const [focusId, setFocusId] = useState('Cost');

  const rangeLabel = resolvedFrom === resolvedTo
    ? format(parseISO(resolvedFrom), 'MMM d')
    : `${format(parseISO(resolvedFrom), 'MMM d')}–${format(parseISO(resolvedTo), 'MMM d')}`;

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
    if (d.data.name === 'Solar') return SOLAR_COLOR;
    if (d.data.name === 'Grid') return POWER_COLOR;
    let n: RNode = d;
    while (n.depth > 1 && n.parent) n = n.parent as RNode;
    return n.data.name === 'Power' ? POWER_COLOR
      : n.data.name === 'Chemicals' ? CHEM_COLOR
      : FILTER_COLOR;
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
        <div className="flex flex-wrap items-center gap-1 mb-3">
          <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        </div>
        <Skeleton className="h-[220px] w-full rounded-lg" />
      </Card>
    );
  }

  if (!data || !rootNode || !(data.root.children?.length)) {
    return (
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-1 mb-2">
          <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        </div>
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          No cost data for this period.
        </div>
      </Card>
    );
  }

  const focusChildren = ((focus?.children ?? []) as RNode[]);
  const focusTotal = focus?.value ?? 0;
  const isZoomed = !!focus && focus.id !== 'Cost';
  const rootTotal = rootNode?.value ?? 0;

  return (
    <Card className="p-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        <button
          type="button"
          onClick={() => isZoomed && setFocusId((focus!.parent as RNode | null)?.id ?? 'Cost')}
          className={`ml-auto text-2xs flex items-center gap-0.5 ${isZoomed ? 'text-muted-foreground hover:text-foreground cursor-pointer' : 'text-muted-foreground/70 cursor-default'}`}
        >
          {isZoomed ? <><ChevronLeft className="h-3 w-3" /> back to {(focus!.parent as RNode | null)?.data.name ?? 'Cost'}</> : `click a slice · ${rangeLabel}`}
        </button>
      </div>

      {/* Side-by-side: ring + legend */}
      <div className="flex gap-3 items-start">
        {/* SVG ring */}
        <div className="shrink-0">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: SIZE, height: SIZE }}>
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
                      strokeWidth: 1.5,
                    }}
                    onClick={clickable ? () => setFocusId(d.id) : undefined}
                  >
                    <title>{`${d.data.name}: ${peso(d.value ?? 0)}`}</title>
                  </path>
                );
              })}
              {/* Center circle */}
              <circle
                r={RING - 3}
                style={{ fill: 'hsl(var(--muted))', cursor: isZoomed ? 'pointer' : 'default' }}
                onClick={() => isZoomed && setFocusId((focus!.parent as RNode | null)?.id ?? 'Cost')}
              />
              <text textAnchor="middle" y={-6} style={{ fontSize: 9, fontWeight: 500, fill: 'hsl(var(--muted-foreground))' }}>
                {focus?.data.name ?? 'Cost'}
              </text>
              <text
                textAnchor="middle" y={8}
                style={{ fontSize: 10, fontWeight: 700, fill: 'hsl(var(--foreground))', fontFamily: GEO_FONT }}
                className="tabular-nums"
              >
                {peso(focus?.value ?? 0)}
              </text>
            </g>
          </svg>
        </div>

        {/* Right-side legend with % bars */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2 py-2">
          {/* Breadcrumb label */}
          {isZoomed && (
            <div className="text-[10px] text-muted-foreground mb-1 font-medium tracking-wide uppercase">
              {focus?.data.name} breakdown
            </div>
          )}

          {focusChildren.length ? focusChildren.map((c) => {
            const clickable = !!c.children?.length;
            const pct = focusTotal ? ((c.value ?? 0) / focusTotal) * 100 : 0;
            const globalPct = rootTotal ? ((c.value ?? 0) / rootTotal) * 100 : 0;
            const swatchColor = categorySwatchStyle(c.data.name);
            return (
              <div key={c.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={clickable ? () => setFocusId(c.id) : undefined}
                  className={`w-full flex items-center gap-1.5 text-xs transition-colors text-left ${clickable ? 'hover:text-foreground cursor-pointer group' : 'cursor-default'}`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0 transition-transform group-hover:scale-110"
                    style={{ background: swatchColor, opacity: opacityFor(c) }}
                  />
                  <span className="text-foreground/90 font-medium flex-1 truncate">{c.data.name}</span>
                  <span className="tabular-nums text-muted-foreground font-numeral text-[10px] shrink-0">
                    {peso(c.value ?? 0)}
                  </span>
                  <span
                    className="tabular-nums font-bold font-numeral text-[10px] shrink-0 w-8 text-right"
                    style={{ color: swatchColor }}
                  >
                    {fmtNum(pct, 0)}%
                  </span>
                </button>
                {/* % bar */}
                <div className="h-1 bg-muted rounded-full overflow-hidden ml-4">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: swatchColor, opacity: 0.75 }}
                  />
                </div>
              </div>
            );
          }) : (
            <div className="text-xs text-muted-foreground">No further breakdown for {focus?.data.name}.</div>
          )}
        </div>
      </div>

      {/* Footer notes */}
      <div className="mt-2 space-y-0.5">
        {!data.hasChemBreakdown && (
          <p className="text-2xs text-muted-foreground/70">
            No per-chemical prices on file — Chemicals shows the total. Add prices on the Costs page to unlock per-chemical detail.
          </p>
        )}
        {data.hasChemBreakdown && data.unpricedChemicals.length > 0 && (
          <p className="text-2xs text-muted-foreground/70">
            No price on file for {data.unpricedChemicals.join(', ')} — excluded from breakdown.
          </p>
        )}
        {data.solarTotal > 0 && (
          <p className="text-2xs text-muted-foreground/70">
            Solar is priced at the grid php/kWh rate for comparison — it isn't actually billed, so the center total runs higher than real cash spend.
          </p>
        )}
      </div>
    </Card>
  );
}
