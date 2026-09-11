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
    <div className="grid grid-cols-[1fr_auto] sm:flex sm:items-center sm:justify-between gap-x-2 gap-y-1.5 mb-2.5">
      {/* ── Element A: Title + Syncing (Row 1 Left on mobile, Order 1 on desktop) ── */}
      <div className="col-start-1 row-start-1 sm:order-1 flex items-center gap-1.5 min-w-0">
        {title && (
          <span className="text-xs font-bold tracking-tight text-foreground flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            <span className="truncate">{title}</span>
          </span>
        )}
        {isFetching && (
          <span className="text-2xs font-mono text-muted-foreground animate-pulse shrink-0">Syncing…</span>
        )}
      </div>

      {/* ── Element B: Range & Monthly picker (Row 2 Full-width on mobile, Order 2 on desktop) ── */}
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto sm:order-2 w-full sm:w-auto overflow-x-auto no-scrollbar py-0.5">
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
      </div>

      {/* ── Element C: Action Controls (Row 1 Right on mobile, Order 3 on desktop) ── */}
      <div className="col-start-2 row-start-1 sm:order-3 sm:ml-auto flex items-center gap-1.5 shrink-0 justify-self-end">
        {/* Mobile ⋮ overflow + desktop inline controls */}
        {trailingControls}

        {/* Per-chart Data Summary Action */}
        <button
          type="button"
          onClick={onOpenSummary}
          className="h-7 sm:h-8 px-2 sm:px-3 text-2xs sm:text-xs font-semibold rounded-[6px] sm:rounded-[8px] border border-border/80 bg-card text-foreground hover:bg-muted/80 hover:text-primary transition-all duration-150 ease-spring-out active:scale-[0.98] flex items-center gap-1 sm:gap-1.5 shadow-2xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          title={`Open ${title || metric} Data Summary`}
          data-testid={`trend-data-summary-${metric}`}
        >
          <TableProperties className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary shrink-0" />
          <span className="hidden xs:inline">Data Summary</span>
          <span className="xs:hidden">Summary</span>
        </button>
      </div>
    </div>
  );
}
