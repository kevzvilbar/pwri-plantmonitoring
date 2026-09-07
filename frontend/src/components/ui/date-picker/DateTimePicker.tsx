import * as React from 'react';
import { format, startOfDay, setHours, setMinutes } from 'date-fns';
import { Clock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseDateValue, formatDateTimeToIso } from './helpers';

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

  const [hours, setHoursState] = React.useState<number>(() =>
    parseDateValue(value)?.getHours() ?? new Date().getHours()
  );
  const [minutes, setMinutesState] = React.useState<number>(() =>
    parseDateValue(value)?.getMinutes() ?? 0
  );

  React.useEffect(() => {
    if (selectedDate) {
      setHoursState(selectedDate.getHours());
      setMinutesState(selectedDate.getMinutes());
    }
  }, [selectedDate]);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const withTime = setMinutes(setHours(date, hours), minutes);
    onChange?.(formatDateTimeToIso(withTime));
  };

  const handleTimeChange = (newHours: number, newMinutes: number) => {
    setHoursState(newHours);
    setMinutesState(newMinutes);
    if (!selectedDate) return;
    const withTime = setMinutes(setHours(selectedDate, newHours), newMinutes);
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
        <div className="p-1 border-b sm:border-b-0 sm:border-r border-border/40">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            disabled={(date) => {
              const d = startOfDay(date);
              return (min ? d < startOfDay(min) : false) || (max ? d > startOfDay(max) : false);
            }}
            initialFocus
          />
        </div>

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
