import * as React from 'react';
import {
  format,
  parseISO,
  isValid,
  isSameDay,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  setHours,
  setMinutes,
} from 'date-fns';
import {
  Calendar as CalendarIcon,
  CalendarRange,
  Clock,
  ChevronDown,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDateValue(val?: string | Date | null): Date | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return isValid(val) ? val : undefined;
  try {
    const parsed = val.includes('T') || val.includes(' ')
      ? new Date(val.replace(' ', 'T'))
      : parseISO(val);
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function formatDateToIso(d?: Date | null): string {
  if (!d || !isValid(d)) return '';
  return format(d, 'yyyy-MM-dd');
}

function formatDateTimeToIso(d?: Date | null): string {
  if (!d || !isValid(d)) return '';
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

// ─── 1. Single DatePicker ────────────────────────────────────────────────────

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
          disabled={(date) => (min ? date < min : false) || (max ? date > max : false)}
          initialFocus
          className="rounded-b-xl"
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── 2. DateRangePicker ──────────────────────────────────────────────────────

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
      to: range.to ? formatDateToIso(range.to) : range.from ? formatDateToIso(range.from) : '',
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

// ─── 3. DateTimePicker (Date + Time) ──────────────────────────────────────────

export interface DateTimePickerProps {
  value?: string | Date | null;
  onChange?: (val: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  minDate?: string | Date;
  maxDate?: string | Date;
  size?: 'sm' | 'default' | 'lg';
  displayFormat?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Select date & time',
  className,
  id,
  disabled = false,
  minDate,
  maxDate,
  size = 'default',
  displayFormat = 'MMM d, yyyy HH:mm',
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = React.useMemo(() => parseDateValue(value), [value]);
  const min = React.useMemo(() => parseDateValue(minDate), [minDate]);
  const max = React.useMemo(() => parseDateValue(maxDate), [maxDate]);

  // Internal time state
  const hours = selectedDate ? selectedDate.getHours() : new Date().getHours();
  const minutes = selectedDate ? selectedDate.getMinutes() : 0;

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const withTime = setMinutes(setHours(date, hours), minutes);
    onChange?.(formatDateTimeToIso(withTime));
  };

  const handleTimeChange = (newHours: number, newMinutes: number) => {
    const base = selectedDate || new Date();
    const withTime = setMinutes(setHours(base, newHours), newMinutes);
    onChange?.(formatDateTimeToIso(withTime));
  };

  const setNow = () => {
    const now = new Date();
    onChange?.(formatDateTimeToIso(now));
  };

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
            <Clock className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            <span className={cn('truncate font-mono-num', selectedDate ? 'text-foreground font-medium' : 'text-muted-foreground')}>
              {selectedDate ? format(selectedDate, displayFormat) : placeholder}
            </span>
          </div>

          <ChevronDown className={cn('h-3.5 w-3.5 opacity-60 transition-transform shrink-0 ml-1 text-muted-foreground', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0 border-border/60 shadow-xl rounded-xl flex flex-col sm:flex-row" align="start">
        {/* Calendar Column */}
        <div className="p-1 border-b sm:border-b-0 sm:border-r border-border/40">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            disabled={(date) => (min ? date < min : false) || (max ? date > max : false)}
            initialFocus
          />
        </div>

        {/* Time Selector Column */}
        <div className="p-3 bg-muted/10 min-w-[160px] flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">Time (24h)</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-5 px-1.5 text-3xs font-semibold gap-1"
                onClick={setNow}
              >
                <Clock className="h-2.5 w-2.5 text-primary" /> Now
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Hours */}
              <div className="space-y-1">
                <span className="text-3xs text-muted-foreground font-mono">Hour</span>
                <select
                  value={hours}
                  onChange={(e) => handleTimeChange(Number(e.target.value), minutes)}
                  className="w-full h-8 text-xs font-mono font-semibold bg-background border border-input rounded-md px-1.5 focus:ring-1 focus:ring-ring"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {String(i).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>

              {/* Minutes */}
              <div className="space-y-1">
                <span className="text-3xs text-muted-foreground font-mono">Min</span>
                <select
                  value={minutes}
                  onChange={(e) => handleTimeChange(hours, Number(e.target.value))}
                  className="w-full h-8 text-xs font-mono font-semibold bg-background border border-input rounded-md px-1.5 focus:ring-1 focus:ring-ring"
                >
                  {Array.from({ length: 60 }, (_, i) => (
                    <option key={i} value={i}>
                      :{String(i).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick minute increments */}
            <div className="pt-2 border-t border-border/40 space-y-1">
              <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">Intervals</span>
              <div className="grid grid-cols-4 gap-1">
                {[0, 15, 30, 45].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleTimeChange(hours, m)}
                    className={cn(
                      'py-1 text-2xs font-mono rounded border transition-all text-center',
                      minutes === m
                        ? 'bg-primary text-primary-foreground border-primary font-bold shadow-2xs'
                        : 'border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    :{String(m).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            className="w-full h-7 text-xs font-medium"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

