import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { FileSpreadsheet } from 'lucide-react';
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
          <div className="flex items-center gap-1">
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
          <span className="text-2xs font-mono text-muted-foreground animate-pulse">Syncing…</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Data Summary button */}
        <button
          onClick={onOpenSummary}
          className="h-6 px-2.5 rounded-lg text-2xs font-semibold inline-flex items-center gap-1.5 bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 transition-all shadow-xs"
          title="Open data summary table"
        >
          <FileSpreadsheet className="h-3 w-3 text-primary" />
          <span>Data Summary</span>
        </button>

        {/* Mobile ⋮ overflow + desktop inline controls */}
        {trailingControls}
      </div>
    </div>
  );
}
