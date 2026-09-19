/**
 * frontend/src/pages/ro-trains/components/TrainLogFilters.tsx
 *
 * Filters bar for the TrainLogModal: tab switcher, date presets, DateRangePicker, and entry count.
 */
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';

interface TrainLogFiltersProps {
  logTab: 'ro' | 'pretreat';
  setLogTab: (tab: 'ro' | 'pretreat') => void;
  rangePreset: '7' | '30' | '90' | 'custom';
  applyPreset: (p: '7' | '30' | '90') => void;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  setRangePreset: (v: '7' | '30' | '90' | 'custom') => void;
  setPage: (v: number | ((prev: number) => number)) => void;
  isLoading: boolean;
  preLoading: boolean;
  activeTotal: number;
}

export function TrainLogFilters({
  logTab, setLogTab, rangePreset, applyPreset,
  dateFrom, dateTo, setDateFrom, setDateTo, setRangePreset, setPage,
  isLoading, preLoading, activeTotal,
}: TrainLogFiltersProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 shrink-0 flex-wrap">
      <div className="flex rounded-full border border-border overflow-hidden text-xs font-semibold mr-1">
        {(['ro', 'pretreat'] as const).map(tab => (
          <button key={tab} onClick={() => { setLogTab(tab); setPage(0); }}
            className={cn('px-3 py-1 transition-colors',
              logTab === tab ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
            {tab === 'ro' ? 'RO' : 'Pre-Treatment'}
          </button>
        ))}
      </div>
      {(['7', '30', '90'] as const).map(p => (
        <button key={p} onClick={() => applyPreset(p)}
          className={cn('h-6 px-2 rounded text-xs font-medium border transition-colors',
            rangePreset === p ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input text-muted-foreground hover:text-foreground')}>
          {p}d
        </button>
      ))}
      <DateRangePicker
        from={dateFrom}
        to={dateTo}
        onChange={({ from: f, to: t }) => {
          setDateFrom(f);
          setDateTo(t);
          setRangePreset('custom');
          setPage(0);
        }}
        size="sm"
        className="h-6 w-[200px] text-xs px-2"
      />
      {!isLoading && !preLoading && (
        <span className="text-xs text-muted-foreground ml-auto">
          <span className="font-semibold text-foreground">{activeTotal}</span> entries
        </span>
      )}
    </div>
  );
}
