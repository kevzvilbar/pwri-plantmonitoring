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
