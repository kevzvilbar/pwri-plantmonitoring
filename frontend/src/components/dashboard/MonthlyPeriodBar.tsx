import React from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CalendarDays, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface MonthlyPeriodBarProps {
  year: number;
  selectedMonth: string; // 'YTD' | '01' | '02' | ... | '12'
  onPeriodChange: (year: number, month: string) => void;
  onBackToDays?: () => void;
  className?: string;
  testIdPrefix?: string;
}

export function MonthlyPeriodBar({
  year,
  selectedMonth,
  onPeriodChange,
  onBackToDays,
  className,
  testIdPrefix = 'monthly-period',
}: MonthlyPeriodBarProps) {
  const currentYear = new Date().getFullYear();
  const currentMonthIdx = new Date().getMonth() + 1; // 1-12
  const availableYears = [currentYear - 2, currentYear - 1, currentYear];

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 flex-wrap text-2xs animate-in fade-in duration-200',
        className,
      )}
      data-testid={`${testIdPrefix}-bar`}
    >
      {onBackToDays && (
        <button
          type="button"
          onClick={onBackToDays}
          className="h-7 px-2 text-2xs font-semibold rounded-md border border-border/80 bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
          title="Return to rolling day presets (7D, 14D, 30D…)"
          data-testid={`${testIdPrefix}-back-days`}
        >
          <ArrowLeft className="h-3 w-3" />
          <span className="hidden xs:inline">Days</span>
        </button>
      )}

      {/* Year selector */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Year:</span>
        <Select
          value={String(year)}
          onValueChange={(y) => onPeriodChange(+y, selectedMonth)}
        >
          <SelectTrigger
            className="h-7 w-20 px-2 rounded-md text-2xs font-semibold bg-background border-border/80"
            data-testid={`${testIdPrefix}-year-select`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableYears.map((y) => (
              <SelectItem key={y} value={String(y)} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="h-4 border-r border-border/50 hidden xs:block" aria-hidden />

      {/* Period label & pills */}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5 max-w-full">
        <span className="text-3xs uppercase font-bold tracking-wider text-muted-foreground mr-0.5 shrink-0 flex items-center gap-1">
          <CalendarDays className="h-3 w-3 text-primary" />
          <span>PERIOD:</span>
        </span>

        {/* YTD Full Year button */}
        <button
          type="button"
          disabled={year > currentYear}
          onClick={() => !(year > currentYear) && onPeriodChange(year, 'YTD')}
          data-testid={`${testIdPrefix}-pill-YTD`}
          title={year > currentYear ? 'Future period — no data recorded yet' : undefined}
          className={cn(
            'h-7 px-2.5 rounded-md font-semibold shrink-0 transition-all text-2xs',
            selectedMonth === 'YTD'
              ? 'bg-primary text-primary-foreground font-bold shadow-xs cursor-pointer'
              : year > currentYear
              ? 'opacity-35 cursor-not-allowed text-muted-foreground/40 bg-muted/10'
              : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer',
          )}
        >
          YTD Full Year
        </button>

        {/* 12 Month Pills */}
        {MONTH_LABELS.map((label, idx) => {
          const monthNum = idx + 1;
          const monthKey = String(monthNum).padStart(2, '0');
          const isSelected = selectedMonth === monthKey;
          const isFuture = year > currentYear || (year === currentYear && monthNum > currentMonthIdx);

          return (
            <button
              key={monthKey}
              type="button"
              disabled={isFuture}
              onClick={() => !isFuture && onPeriodChange(year, monthKey)}
              data-testid={`${testIdPrefix}-pill-${monthKey}`}
              title={isFuture ? 'Future period — no data recorded yet' : undefined}
              className={cn(
                'h-7 px-2 rounded-md shrink-0 transition-all text-2xs font-medium',
                isSelected
                  ? 'bg-primary text-primary-foreground font-bold shadow-xs cursor-pointer'
                  : isFuture
                  ? 'opacity-35 cursor-not-allowed text-muted-foreground/40 bg-muted/10'
                  : 'text-foreground/90 hover:text-foreground hover:bg-muted/80 bg-muted/30 cursor-pointer',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
