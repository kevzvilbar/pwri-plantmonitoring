import * as React from 'react';
import { fmtNum } from '@/lib/calculations';
import type { BlendingRowLogic } from './useBlendingRow';

interface BlendingRowTelemetryProps {
  state: BlendingRowLogic;
}

export function BlendingRowTelemetry({ state }: BlendingRowTelemetryProps) {
  const { prevCumulative, prevRawReading, prevDateStr, isBackdated, backdatedContextLoading, backdatedContext, eventDate, dbLatestRaw, previousDate, todayVolume } = state;

  return (
    <div className="recessed-glass p-2.5 sm:p-3 flex items-center justify-between gap-2 flex-wrap">
      <div className="text-xs text-muted-foreground">
        prev meter: <span className="font-mono-num font-semibold text-foreground" title={
          isBackdated
            ? (backdatedContextLoading
                ? 'Looking up the reading before this date…'
                : backdatedContext?.predecessor
                  ? `Last cumulative reading before ${eventDate}, on ${backdatedContext.predecessor.date}`
                  : `No reading before ${eventDate} — this would be the well's earliest known reading`)
            : prevRawReading
              ? `Last cumulative reading on ${prevRawReading.date}`
              : dbLatestRaw
                ? `Last cumulative reading on ${dbLatestRaw.date} (from DB)`
                : previousDate ? `Last entry on ${previousDate} (daily vol)` : 'No prior reading'
        }>
          {isBackdated && backdatedContextLoading ? '…' : prevCumulative != null ? fmtNum(prevCumulative) : '—'}
        </span>
        {prevDateStr && (
          <span className="text-muted-foreground/60 ml-1">({prevDateStr})</span>
        )}
        <span className="mx-1.5 text-border">·</span>
        today: <span className="font-mono-num font-semibold text-primary">{fmtNum(todayVolume)} m³</span>
      </div>
    </div>
  );
}
