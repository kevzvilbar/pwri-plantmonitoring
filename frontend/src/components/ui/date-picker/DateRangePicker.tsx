import * as React from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear } from 'date-fns';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseDateValue, formatDateToIso } from './helpers';

export interface DateRangePickerProps {
  from?: string | Date | null;
  to?: string | Date | null;
  onChange?: (range: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  presets?: boolean;
  size?: 'sm' | 'default' | 'lg';
  align?: 'start' | 'center' | 'end';
}

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Select date range',
  className,
  id,
  disabled = false,
  presets = true,
  size = 'default',
  align = 'start',
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const fromDate = React.useMemo(() => parseDateValue(from), [from]);
  const toDate = React.useMemo(() => parseDateValue(to), [to]);

  const dateRange = React.useMemo(() => ({
    from: fromDate,
    to: toDate,
  }), [fromDate, toDate]);

  const handleSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range) {
      onChange?.({ from: '', to: '' });
      return;
    }
    onChange?.({
      from: range.from ? formatDateToIso(range.from) : '',
      to: range.to ? formatDateToIso(range.to) : '',
    });
    if (range.from && range.to) {
      setOpen(false);
    }
  };

  const applyRangePreset = (start: Date, end: Date) => {
    onChange?.({
      from: formatDateToIso(start),
      to: formatDateToIso(end),
    });
    setOpen(false);
  };

  const today = new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-label={placeholder}
          className={cn(
            'flex items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 font-normal text-left transition-all',
            'hover:bg-muted/40 hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
            size === 'sm' ? 'h-8 text-xs px-2.5' : size === 'lg' ? 'h-10 text-sm px-3.5' : 'h-8.5 text-xs',
            !fromDate && !toDate && 'text-muted-foreground',
            open && 'ring-1 ring-ring border-primary shadow-xs',
            className
          )}
        >
          <div className="flex items-center gap-2 min-w-0 overflow-hidden truncate">
            <CalendarRange className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            <span className={cn('truncate font-mono-num', fromDate || toDate ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {fromDate && toDate
                ? `${format(fromDate, 'MMM d, yyyy')} – ${format(toDate, 'MMM d, yyyy')}`
                : fromDate
                ? `${format(fromDate, 'MMM d, yyyy')} – …`
                : placeholder}
            </span>
          </div>

          <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition-transform shrink-0 ml-1 text-muted-foreground', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0 border-border/60 shadow-xl rounded-xl flex flex-col md:flex-row" align={align}>
        {presets && (
          <div className="flex flex-col gap-1 p-3 border-b md:border-b-0 md:border-r border-border/40 bg-muted/20 min-w-[140px]">
            <div className="text-3xs uppercase tracking-wider font-bold text-muted-foreground px-2 py-1">Time Horizon</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => applyRangePreset(today, today)}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => applyRangePreset(subDays(today, 1), subDays(today, 1))}
            >
              Yesterday
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => applyRangePreset(subDays(today, 6), today)}
            >
              Last 7 Days
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => applyRangePreset(subDays(today, 29), today)}
            >
              Last 30 Days
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => applyRangePreset(startOfMonth(today), endOfMonth(today))}
            >
              This Month
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => {
                const prev = subMonths(today, 1);
                applyRangePreset(startOfMonth(prev), endOfMonth(prev));
              }}
            >
              Last Month
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start h-7 text-xs px-2 font-normal rounded-md"
              onClick={() => applyRangePreset(startOfYear(today), today)}
            >
              Year to Date
            </Button>
          </div>
        )}

        <div className="p-1">
          <Calendar
            mode="range"
            selected={dateRange as any}
            onSelect={handleSelect as any}
            numberOfMonths={1}
            initialFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
