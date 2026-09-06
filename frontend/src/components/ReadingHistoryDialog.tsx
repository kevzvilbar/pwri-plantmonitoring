/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HistoryModule, HISTORY_WINDOWS, ReadingHistoryProps, getGridMeterVal } from './readingHistory/types';
import { useReadingHistoryQuery } from './readingHistory/useReadingHistoryQuery';
import { ReadingHistoryTable } from './readingHistory/ReadingHistoryTable';
import { useAuth } from '@/hooks/useAuth';

export { getGridMeterVal };

export function ReadingHistoryDialog(props: ReadingHistoryProps) {
  const { entityName, module, entityId, meterFilter, gridMeterCount: gridMeterCountProp = 1, gridMeterNames = [] } = props;
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);

  const { activeOperator } = useAuth();

  const resolvedGridCount = Math.max(1, gridMeterCountProp);
  const getHistGridLabel = (idx: number): string =>
    gridMeterNames[idx] ?? (resolvedGridCount === 1 ? 'Grid Meter' : `Grid Meter ${idx + 1}`);

  const { data: rawRows = [], isLoading, queryKey } = useReadingHistoryQuery({ module, entityId, days, appliedFrom, appliedTo, customFrom, customTo });

  const title = module === 'power'
    ? meterFilter
      ? meterFilter.type === 'solar'
        ? `Solar — ${entityName} — History`
        : `${getHistGridLabel(meterFilter.idx)} — ${entityName} — History`
      : `Power — ${entityName}`
    : `${entityName} — History`;

  return (
    <Dialog open onOpenChange={props.onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        {/* Window selector */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {HISTORY_WINDOWS.map(({ label, days: d }) => (
              <button
                key={label}
                onClick={() => { setDays(d as any);  }}
                className={[
                  'px-3 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => { setDays('custom');  }}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              Custom
            </button>
          </div>
          {days === 'custom' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo);  }}>
                Apply
              </Button>
            </div>
          )}
        </div>

        <ReadingHistoryTable rawRows={rawRows} isLoading={isLoading} days={days} appliedFrom={appliedFrom} appliedTo={appliedTo} queryKey={queryKey} activeOperator={activeOperator} {...props} />
      </DialogContent>
    </Dialog>
  );
}
