import React from 'react';
import type { RangeKey } from './types';
import { DateRangePicker } from '@/components/ui/date-picker';
import { MonthlyPeriodBar } from './MonthlyPeriodBar';
import { cn } from '@/lib/utils';

export interface RangeAndMonthlyPickerProps {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  from?: string;
  to?: string;
  onCustomDatesChange?: (from: string, to: string) => void;
  chartYear?: number;
  chartMonth?: string;
  onMonthlyPeriodChange?: (year: number, month: string) => void;
  testIdPrefix?: string;
  monthlyTestIdPrefix?: string;
  className?: string;
}

const PRESET_RANGES: RangeKey[] = ['7D', '14D', '30D', '60D', '90D'];

export function RangeAndMonthlyPicker({
  range,
  onRangeChange,
  from,
  to,
  onCustomDatesChange,
  chartYear,
  chartMonth,
  onMonthlyPeriodChange,
  testIdPrefix = 'range',
  monthlyTestIdPrefix,
  className,
}: RangeAndMonthlyPickerProps) {
  const currentYear = new Date().getFullYear();

  if (range === 'MONTHLY') {
    return (
      <MonthlyPeriodBar
        year={chartYear ?? currentYear}
        selectedMonth={chartMonth ?? 'YTD'}
        onPeriodChange={(y, m) => onMonthlyPeriodChange?.(y, m)}
        onBackToDays={() => onRangeChange('7D')}
        testIdPrefix={monthlyTestIdPrefix ?? `${testIdPrefix}-monthly`}
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/50 flex-wrap">
        {PRESET_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRangeChange(r)}
            data-testid={`${testIdPrefix}-${r}`}
            className={cn(
              'h-7 px-2.5 text-2xs font-semibold rounded-md transition-all cursor-pointer',
              range === r
                ? 'bg-card text-primary shadow-xs border border-border/80'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {r}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onRangeChange('CUSTOM')}
          data-testid={`${testIdPrefix}-CUSTOM`}
          className={cn(
            'h-7 px-2.5 text-2xs font-semibold rounded-md transition-all cursor-pointer',
            range === 'CUSTOM'
              ? 'bg-card text-primary shadow-xs border border-border/80'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Custom
        </button>

        <div className="h-3.5 border-r border-border/40 mx-0.5" aria-hidden />

        <button
          type="button"
          onClick={() => onRangeChange('MONTHLY')}
          data-testid={`${testIdPrefix}-MONTHLY`}
          className="h-7 px-2.5 text-2xs font-semibold rounded-md transition-all cursor-pointer text-muted-foreground hover:text-foreground"
        >
          Monthly
        </button>
      </div>

      {range === 'CUSTOM' && onCustomDatesChange && from && to && (
        <DateRangePicker
          from={from}
          to={to}
          onChange={({ from: f, to: t }) => onCustomDatesChange(f, t)}
          size="sm"
          className="h-7 w-[200px] text-2xs px-2"
        />
      )}
    </div>
  );
}
