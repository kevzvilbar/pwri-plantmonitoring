import React from 'react';
import { DataState } from '@/components/DataState';
import { EventRow } from './EventRow';
import { DowntimeEvent } from './types';

interface EventsTableProps {
  events: DowntimeEvent[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  effectivePlantId?: string;
  isAdmin: boolean;
  isManager: boolean;
  onDeleteEvent: (id?: string) => void;
}

export function EventsTable({
  events,
  isLoading,
  error,
  refetch,
  effectivePlantId,
  isAdmin,
  isManager,
  onDeleteEvent,
}: EventsTableProps) {
  return (
    <div className="border rounded-xl bg-card overflow-hidden flex-1 min-h-0 flex flex-col shadow-2xs">
      <div className="bg-muted/50 border-b border-border/80 grid grid-cols-[96px_110px_130px_70px_1fr_40px] gap-2 px-3 py-2 text-2xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
        <span>Date</span>
        <span>Plant</span>
        <span>Subsystem</span>
        <span className="text-right">Duration</span>
        <span>Root Cause / Remarks</span>
        <span className="text-right">Act</span>
      </div>

      <div className="overflow-auto flex-1 divide-y divide-border/40">
        <DataState
          loading={isLoading}
          error={error}
          isEmpty={events.length === 0}
          onRetry={() => refetch()}
          emptyTitle="No downtime events"
          emptyDescription={
            effectivePlantId
              ? 'No recorded shutdowns found for this plant in the selected time horizon.'
              : 'No downtime events recorded across plants in the selected time horizon. Click "Log Downtime" above to register one.'
          }
        >
          {events.map((ev, i) => (
            <EventRow
              key={`${ev.event_date}-${ev.subsystem}-${ev.id || i}`}
              event={ev}
              index={i}
              isAdmin={isAdmin}
              isManager={isManager}
              onDelete={onDeleteEvent}
            />
          ))}
        </DataState>
      </div>
    </div>
  );
}
