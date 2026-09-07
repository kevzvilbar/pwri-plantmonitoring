import * as React from 'react';
import { format, isSameDay, subDays, startOfDay } from 'date-fns';
import { CalendarIcon, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseDateValue, formatDateToIso } from './helpers';

export interface DatePickerProps {
  value?: string | Date | null;
  onChange?: (val: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  minDate?: string | Date;
  maxDate?: string | Date;
  presets?: boolean;
  clearable?: boolean;
  size?: 'sm' | 'default' | 'lg';
  displayFormat?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  className,
  id,
  disabled = false,
  minDate,
  maxDate,
  presets = true,
  clearable = true,
  size = 'default',
  displayFormat = 'MMM d, yyyy',
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = React.useMemo(() => parseDateValue(value), [value]);
  const min = React.useMemo(() => parseDateValue(minDate), [minDate]);
  const max = React.useMemo(() => parseDateValue(maxDate), [maxDate]);

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      if (clearable) onChange?.('');
    } else {
      onChange?.(formatDateToIso(date));
    }
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.('');
  };

  const applyPreset = (date: Date) => {
    onChange?.(formatDateToIso(date));
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
            !selectedDate && 'text-muted-foreground',
            open && 'ring-1 ring-ring border-primary shadow-xs',
            className
          )}
        >
          <div className="flex items-center gap-2 min-w-0 overflow-hidden truncate">
            <CalendarIcon className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            <span className={cn('truncate font-mono-num', selectedDate ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {selectedDate ? format(selectedDate, displayFormat) : placeholder}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-1 text-muted-foreground">
            {clearable && selectedDate && !disabled && (
              <span
                onClick={handleClear}
                className="p-0.5 rounded hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                title="Clear date"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition-transform', open && 'rotate-180')} />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0 border-border/60 shadow-xl rounded-xl" align="start">
        {presets && (
          <div className="flex items-center gap-1 p-2 border-b border-border/40 bg-muted/20">
            <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground px-1">Presets:</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 text-2xs rounded-md',
                selectedDate && isSameDay(selectedDate, today) && 'bg-primary/10 text-primary font-semibold'
              )}
              onClick={() => applyPreset(today)}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 text-2xs rounded-md',
                selectedDate && isSameDay(selectedDate, subDays(today, 1)) && 'bg-primary/10 text-primary font-semibold'
              )}
              onClick={() => applyPreset(subDays(today, 1))}
            >
              Yesterday
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-2xs rounded-md"
              onClick={() => applyPreset(subDays(today, 7))}
            >
              -7d
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-2xs rounded-md"
              onClick={() => applyPreset(subDays(today, 30))}
            >
              -30d
            </Button>
          </div>
        )}

        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={(date) => {
            const d = startOfDay(date);
            return (min ? d < startOfDay(min) : false) || (max ? d > startOfDay(max) : false);
          }}
          initialFocus
          className="rounded-b-xl"
        />
      </PopoverContent>
    </Popover>
  );
}
