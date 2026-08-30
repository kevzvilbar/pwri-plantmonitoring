import type { ReactNode } from 'react';
import { DateRangePicker } from '@/components/ui/date-picker';
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
  trailingControls: ReactNode;
}

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
    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        {title && (
          <span className="text-xs font-bold tracking-tight text-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            {title}
          </span>
        )}

        {/* Range pills */}
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/50">
          {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              data-testid={`trend-range-${metric}-${r}`}
              className={[
                'h-5 px-2 text-[10px] font-bold rounded-md transition-all',
                range === r
                  ? 'bg-card text-primary shadow-xs border border-border/80'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {r}
            </button>
          ))}
          <button
            onClick={() => onRangeChange('CUSTOM')}
            data-testid={`trend-range-${metric}-CUSTOM`}
            className={[
              'h-5 px-2 text-[10px] font-bold rounded-md transition-all',
              range === 'CUSTOM'
                ? 'bg-card text-primary shadow-xs border border-border/80'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            Custom
          </button>
        </div>

        {range === 'CUSTOM' && (
          <DateRangePicker
            from={from}
            to={to}
            onChange={({ from: f, to: t }) => {
              if (f) onFromChange(f);
              if (t) onToChange(t);
            }}
            size="sm"
            className="h-6 w-[200px] text-2xs px-2"
          />
        )}

        {isFetching && (
          <span className="text-2xs font-mono text-muted-foreground animate-pulse">Syncing…</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Mobile ⋮ overflow + desktop inline controls */}
        {trailingControls}
      </div>
    </div>
  );
}
