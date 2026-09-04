import type { ReactNode } from 'react';
import { TableProperties } from 'lucide-react';
import { RangeKey } from './types';
import { RangeAndMonthlyPicker } from './RangeAndMonthlyPicker';

interface TrendChartToolbarProps {
  metric: string;
  title?: string;
  range: RangeKey;
  from: string;
  to: string;
  chartYear?: number;
  chartMonth?: string;
  isFetching: boolean;
  onRangeChange: (range: RangeKey) => void;
  /** Called with both dates atomically to avoid stale-closure overwrites. */
  onCustomDatesChange: (from: string, to: string) => void;
  onMonthlyPeriodChange?: (year: number, month: string) => void;
  onOpenSummary: () => void;
  trailingControls: ReactNode;
}

export function TrendChartToolbar({
  metric,
  title,
  range,
  from,
  to,
  chartYear,
  chartMonth,
  isFetching,
  onRangeChange,
  onCustomDatesChange,
  onMonthlyPeriodChange,
  onOpenSummary,
  trailingControls,
}: TrendChartToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5">
      <div className="flex items-center gap-2 flex-wrap max-w-full">
        {title && (
          <span className="text-xs font-bold tracking-tight text-foreground flex items-center gap-1.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {title}
          </span>
        )}

        {/* Unified Range and Monthly controls */}
        <RangeAndMonthlyPicker
          range={range}
          onRangeChange={onRangeChange}
          from={from}
          to={to}
          onCustomDatesChange={onCustomDatesChange}
          chartYear={chartYear}
          chartMonth={chartMonth}
          onMonthlyPeriodChange={onMonthlyPeriodChange}
          testIdPrefix={`trend-range-${metric}`}
        />

        {isFetching && (
          <span className="text-2xs font-mono text-muted-foreground animate-pulse shrink-0">Syncing…</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Mobile ⋮ overflow + desktop inline controls */}
        {trailingControls}

        {/* Per-chart Data Summary Action */}
        <button
          type="button"
          onClick={onOpenSummary}
          className="h-7 px-2.5 text-2xs font-semibold rounded-md border border-border/80 bg-card text-foreground hover:bg-muted/80 hover:text-primary transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
          title={`Open ${title || metric} Data Summary`}
          data-testid={`trend-data-summary-${metric}`}
        >
          <TableProperties className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>Data Summary</span>
        </button>
      </div>
    </div>
  );
}
