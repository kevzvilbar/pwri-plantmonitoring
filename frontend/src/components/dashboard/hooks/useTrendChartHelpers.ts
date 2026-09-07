export function useChartHelpers(p: Record<string, any>) {
  const { compact } = p;

  const chartHeight = compact ? 'h-[200px]' : 'h-[340px]';

  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(value);
  };

  return { chartHeight, formatYAxis };
}
