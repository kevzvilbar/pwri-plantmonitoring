import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { RangeKey } from './types';

interface TrendChartToolbarProps {
  metric: string;
  title?: string;
  range: RangeKey;
  from: string;
  to: string;
  isFetching: boolean;
  onRangeChange: (range: RangeKey) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onOpenSummary: () => void;
  /** Everything after the "Data Summary" button: the mobile "⋮ more
   *  options" popover and, as a sibling, the desktop-only inline control
   *  cluster (granularity/breakdown/stack-mode/export — one variant per
   *  metric type). Both stay owned by TrendChart.tsx: together they branch
   *  on ~6 metric types and close over two dozen-plus pieces of chart
   *  state. Passing that through as one prop here would relocate the
   *  coupling into a 25+ prop interface, not reduce it. The real fix is a
   *  declarative per-metric config table that renders both clusters
   *  generically — a data-shape change, not a file-split — left as a
   *  follow-up rather than done half-safely here. */
  trailingControls: ReactNode;
}

/**
 * Compact header row above every trend chart: title, range pills (7D/14D/
 * .../Custom with date inputs), a loading indicator, and the "Data Summary"
 * button. Pure presentation — every piece of state it reads or writes comes
 * in as a prop, nothing here reaches into the store or an API directly.
 *
 * Extracted out of the ~3,900-line TrendChart render (see that file's
 * header comment) as a first, low-risk cut at the "one giant component"
 * problem flagged in the Aug 2026 code review — chosen specifically because
 * its prop surface is small (10 props vs. the 25+ the mobile-overflow
 * popover would need), so this split actually reduces what a reviewer has
 * to hold in their head, rather than just moving code to a new address.
 */
export function TrendChartToolbar({
  metric,
  title,
  range,
  from,
  to,
  isFetching,
  onRangeChange,
  onFromChange,
  onToChange,
  onOpenSummary,
  trailingControls,
}: TrendChartToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 mb-2">
      {title && (
        <span className="text-xs font-bold tracking-[-0.01em] w-full sm:w-auto sm:mr-1 shrink-0 text-foreground">{title}</span>
      )}
      {/* Range pills — compact size */}
      <div className="flex flex-nowrap items-center gap-0.5 shrink-0 sm:flex-wrap">
        {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
          <button key={r}
            onClick={() => onRangeChange(r)}
            data-testid={`trend-range-${metric}-${r}`}
            className={[
              'px-2 text-2xs font-semibold transition-colors leading-none sm:h-5 sm:rounded-full',
              range === r
                ? 'text-primary font-bold sm:bg-primary sm:text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground sm:bg-muted/70 sm:border sm:border-border',
            ].join(' ')}
          >{r}</button>
        ))}
        <button
          onClick={() => onRangeChange('CUSTOM')}
          data-testid={`trend-range-${metric}-CUSTOM`}
          className={[
            'px-2 text-2xs font-semibold transition-colors leading-none sm:h-5 sm:rounded-full',
            range === 'CUSTOM'
              ? 'text-primary font-bold sm:bg-primary sm:text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground sm:bg-muted/70 sm:border sm:border-border',
          ].join(' ')}
        >Custom</button>
        {range === 'CUSTOM' && (
          <div className="flex items-center gap-1 mt-1 w-full sm:w-auto sm:mt-0">
            <Input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-6 w-[110px] text-2xs px-1.5"
              data-testid={`trend-from-${metric}`}
            />
            <span className="text-2xs text-muted-foreground shrink-0">→</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              className="h-6 w-[110px] text-2xs px-1.5"
              data-testid={`trend-to-${metric}`}
            />
          </div>
        )}
        {isFetching && (
          <span className="text-2xs text-muted-foreground ml-1">Loading…</span>
        )}
      </div>

      {/* Data Summary — opens a popup dialog (non-retractable) */}
      <button
        onClick={onOpenSummary}
        className="ml-auto shrink-0 px-1 text-2xs font-medium transition-colors leading-none text-muted-foreground hover:text-foreground sm:h-5 sm:px-2 sm:rounded sm:border sm:bg-muted sm:hover:bg-muted/80 sm:border-border"
        title="Open data summary table"
      >
        Data Summary
      </button>

      {/* ── Mobile ⋮ overflow + desktop inline controls ─────────────────── */}
      {trailingControls}
    </div>
  );
}
