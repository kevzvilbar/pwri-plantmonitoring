// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md) — this
// file has zero dependency on the rest of the TrendChart module, so it moved
// out unchanged. Imported by TrendChart.tsx (for its own internal use) and
// directly by BlendingVolumeCard.tsx (which no longer needs to import
// through the TrendChart module to reuse the legend).

// Palette for per-locator lines in drill views (cycles if more locators than colors).
// Also reused by ComplianceRadarCard (per-plant polygons) and CostSunburst (arc fills)
// so every chart on the dashboard draws from the same color set.
export const DRILL_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
  'hsl(var(--chart-7))',
  'hsl(var(--chart-8))',
  'hsl(var(--chart-9))',
  'hsl(var(--chart-10))',
  'hsl(var(--chart-11))',
  'hsl(var(--chart-12))',
];

// ─── Modern inline chart legend ──────────────────────────────────────────────
// Exported so other dashboard cards (e.g. BlendingVolumeCard's by-well
// breakdown) can reuse the exact same legend styling instead of forking it.
export type LegendShape = 'area' | 'bar' | 'line';
export function ModernChartLegend({ items }: {
  items: { color: string; label: string; shape?: LegendShape }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 px-0.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          {item.shape === 'bar' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: item.color }} />
          ) : item.shape === 'line' ? (
            <span className="inline-flex items-center gap-0.5 shrink-0">
              <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: item.color }} />
              <span className="inline-block h-2 w-2 rounded-full border-[2px]" style={{ background: 'hsl(var(--card))', borderColor: item.color }} />
              <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: item.color }} />
            </span>
          ) : (
            /* area */
            <span className="inline-block h-2.5 w-5 rounded-sm shrink-0" style={{
              background: `linear-gradient(to bottom, ${item.color}55, ${item.color}22)`,
              borderTop: `2px solid ${item.color}`,
            }} />
          )}
          <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground leading-none">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
