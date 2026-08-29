// Cost Composition Sunburst: Cost -> {Power, Chemicals, Filters} -> Power
// splits into {Grid, Solar}, Chemicals into individual chemicals, Filters
// into housing type ($). Built with d3-hierarchy
// (partition layout) + d3-shape (arc path generator) for the math only.
import React, { useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc as arcGenerator } from 'd3-shape';
import { ChevronLeft, ChevronRight, Zap, FlaskConical, Layers, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtNum } from '@/lib/calculations';
import { useCostComposition, type CostSunburstNode } from '@/hooks/useCostComposition';
import { rangeKeyToDays } from './types';
import { useAppStore } from '@/store/appStore';

const GEO_FONT = "'DM Sans', ui-sans-serif, system-ui, sans-serif";

interface Props {
  plantIds: string[];
}

type RNode = HierarchyRectangularNode<CostSunburstNode> & { id: string };

// Expanded diameter for prominent executive presentation
const SIZE = 270;

const POWER_COLOR = 'hsl(var(--chart-6))';
const SOLAR_COLOR = 'hsl(var(--kpi-solar))';
const CHEM_COLOR = 'hsl(var(--highlight))';
const FILTER_COLOR = 'hsl(var(--chart-4))';

function peso(n: number) {
  return `₱${fmtNum(n)}`;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function visibleSpan(d: RNode, focus: RNode) {
  if (d.depth <= focus.depth) return null;
  const spanX = focus.x1 - focus.x0;
  if (spanX <= 0) return null;
  const x0 = clamp01((d.x0 - focus.x0) / spanX) * 2 * Math.PI;
  const x1 = clamp01((d.x1 - focus.x0) / spanX) * 2 * Math.PI;
  if (x1 - x0 < 1e-4) return null;
  return { x0, x1, y0: d.y0 - focus.depth, y1: d.y1 - focus.depth };
}

function categorySwatchStyle(name: string): string {
  if (name === 'Solar') return SOLAR_COLOR;
  if (name === 'Grid' || name === 'Power') return POWER_COLOR;
  if (name === 'Chemicals') return CHEM_COLOR;
  return FILTER_COLOR;
}

function categoryIcon(name: string) {
  if (name === 'Power' || name === 'Grid' || name === 'Solar') {
    return <Zap className="h-3.5 w-3.5" />;
  }
  if (name === 'Chemicals') {
    return <FlaskConical className="h-3.5 w-3.5" />;
  }
  return <Layers className="h-3.5 w-3.5" />;
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
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.012))
      .padRadius(RING * 1.5)
      .innerRadius((d) => d.y0 * RING)
      .outerRadius((d) => Math.max(d.y0 * RING, d.y1 * RING - 1.5)),
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
    if (rel !== 2) return 0.95;
    const siblings = (d.parent?.children ?? []) as RNode[];
    const idx = Math.max(0, siblings.indexOf(d));
    return Math.max(0.4, 0.88 - idx * 0.12);
  };

  if (isLoading) {
    return (
      <Card className="p-4 flex flex-col justify-between">
        <div className="flex flex-wrap items-center gap-1 mb-3">
          <span className="text-sm font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        </div>
        <Skeleton className="h-[310px] w-full rounded-xl" />
      </Card>
    );
  }

  if (!data || !rootNode || !(data.root.children?.length)) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-1 mb-2">
          <span className="text-sm font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
        </div>
        <div className="h-[310px] flex items-center justify-center text-xs text-muted-foreground">
          No cost data for this period.
        </div>
      </Card>
    );
  }

  const focusChildren = ((focus?.children ?? []) as RNode[]);
  const focusTotal = focus?.value ?? 0;
  const isZoomed = !!focus && focus.id !== 'Cost';

  return (
    <Card className="p-4 flex flex-col justify-between">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-1 mb-2">
          <span className="text-sm font-bold tracking-[-0.01em] text-foreground">Cost Composition</span>
          <button
            type="button"
            onClick={() => isZoomed && setFocusId((focus!.parent as RNode | null)?.id ?? 'Cost')}
            className={`ml-auto text-2xs flex items-center gap-1 font-medium transition-colors ${
              isZoomed
                ? 'text-primary hover:underline cursor-pointer bg-primary/10 px-2 py-0.5 rounded-full'
                : 'text-muted-foreground/80 cursor-default'
            }`}
          >
            {isZoomed ? (
              <>
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Zoom out to {(focus!.parent as RNode | null)?.data.name ?? 'Overview'}</span>
              </>
            ) : (
              <span>Click any slice to zoom · {rangeLabel}</span>
            )}
          </button>
        </div>
      </div>

      {/* Main Container: Prominent Side-by-side Ring & Breakdown */}
      <div className="flex flex-col sm:flex-row items-center gap-4 my-auto py-1">
        {/* Large SVG Ring */}
        <div className="shrink-0 relative flex items-center justify-center">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="shrink-0 drop-shadow-sm transition-transform hover:scale-[1.01]"
            style={{ width: SIZE, height: SIZE }}
          >
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
                      transition: 'd 400ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms ease',
                      stroke: 'hsl(var(--card))',
                      strokeWidth: 2,
                    }}
                    className={clickable ? 'hover:brightness-110' : ''}
                    onClick={clickable ? () => setFocusId(d.id) : undefined}
                  >
                    <title>{`${d.data.name}: ${peso(d.value ?? 0)}`}</title>
                  </path>
                );
              })}

              {/* Center circle */}
              <circle
                r={RING - 4}
                className="transition-all duration-300"
                style={{
                  fill: 'hsl(var(--card))',
                  stroke: 'hsl(var(--border))',
                  strokeWidth: 2,
                  cursor: isZoomed ? 'pointer' : 'default',
                }}
                onClick={() => isZoomed && setFocusId((focus!.parent as RNode | null)?.id ?? 'Cost')}
              />
              <text
                textAnchor="middle"
                y={-8}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fill: 'hsl(var(--muted-foreground))',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {focus?.data.name ?? 'Total Cost'}
              </text>
              <text
                textAnchor="middle"
                y={12}
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  fill: 'hsl(var(--foreground))',
                  fontFamily: GEO_FONT,
                }}
                className="tabular-nums font-bold"
              >
                {peso(focus?.value ?? 0)}
              </text>
            </g>
          </svg>
        </div>

        {/* Breakdown Card List */}
        <div className="flex-1 w-full flex flex-col justify-center gap-2.5">
          {isZoomed && (
            <div className="flex items-center gap-1 text-xs font-semibold text-primary px-1">
              <span>{focus?.data.name} Breakdown</span>
            </div>
          )}

          {focusChildren.length ? (
            focusChildren.map((c) => {
              const clickable = !!c.children?.length;
              const pct = focusTotal ? ((c.value ?? 0) / focusTotal) * 100 : 0;
              const swatchColor = categorySwatchStyle(c.data.name);

              return (
                <div
                  key={c.id}
                  onClick={clickable ? () => setFocusId(c.id) : undefined}
                  className={`p-2 rounded-xl border border-border/70 bg-muted/40 transition-all ${
                    clickable
                      ? 'hover:bg-muted hover:border-primary/50 cursor-pointer shadow-2xs hover:shadow-xs group'
                      : 'cursor-default'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="h-6 w-6 rounded-lg flex items-center justify-center text-white shrink-0 shadow-2xs transition-transform group-hover:scale-105"
                        style={{ background: swatchColor }}
                      >
                        {categoryIcon(c.data.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-foreground truncate flex items-center gap-1">
                          <span>{c.data.name}</span>
                          {clickable && (
                            <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold tabular-nums font-numeral text-foreground">
                        {peso(c.value ?? 0)}
                      </div>
                      <div
                        className="text-[10px] font-bold tabular-nums font-numeral"
                        style={{ color: swatchColor }}
                      >
                        {fmtNum(pct, 1)}% of total
                      </div>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="h-1.5 bg-background/80 rounded-full overflow-hidden border border-border/50">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: swatchColor,
                      }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-4 text-center rounded-xl bg-muted/30 border border-border/60 text-xs text-muted-foreground">
              No further sub-category breakdown for <strong className="text-foreground">{focus?.data.name}</strong>.
            </div>
          )}
        </div>
      </div>

      {/* Footer Notes */}
      <div className="mt-2 space-y-1 text-2xs text-muted-foreground/75 border-t border-border/50 pt-2">
        {!data.hasChemBreakdown && (
          <p className="flex items-center gap-1">
            <Info className="h-3 w-3 shrink-0" />
            <span>Add chemical pricing on the Costs page to unlock detailed dosing breakdown.</span>
          </p>
        )}
        {data.solarTotal > 0 && (
          <p>
            Solar is priced at the grid ₱/kWh tariff rate for comparative generation valuation.
          </p>
        )}
      </div>
    </Card>
  );
}
