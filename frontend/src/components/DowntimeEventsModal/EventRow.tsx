import React from 'react';
import { Badge } from '@/components/ui/badge';
import { DowntimeEvent } from './types';
import { cn } from '@/lib/utils';
import { Trash2 } from 'lucide-react';

interface EventRowProps {
  event: DowntimeEvent;
  index: number;
  isAdmin: boolean;
  isManager: boolean;
  onDelete: (id?: string) => void;
}

export function EventRow({ event, index, isAdmin, isManager, onDelete }: EventRowProps) {
  const sev = event.duration_hrs >= 12 ? 'high' : event.duration_hrs >= 3 ? 'med' : 'low';

  return (
    <div
      className={cn(
        'grid grid-cols-[96px_110px_130px_70px_1fr_40px] gap-2 px-3 py-2.5 text-xs transition-colors items-center hover:bg-muted/30',
        sev === 'high' && 'bg-danger-soft/40',
        sev === 'med' && 'bg-warn-soft/20'
      )}
      data-testid={`downtime-event-row-${index}`}
    >
      <span className="font-mono-num font-medium text-foreground">{event.event_date}</span>

      <span className="truncate font-medium text-muted-foreground text-2xs">
        {event.plant_name || '—'}
      </span>

      <div className="truncate">
        <Badge variant="outline" className="font-normal text-3xs px-1.5 py-0">
          {event.subsystem}
        </Badge>
      </div>

      <span
        className={cn(
          'text-right font-mono-num font-semibold',
          sev === 'high' && 'text-danger font-bold',
          sev === 'med' && 'text-warn font-semibold',
          sev === 'low' && 'text-foreground'
        )}
      >
        {event.duration_hrs.toFixed(1)}h
      </span>

      <div className="text-muted-foreground text-xs line-clamp-2 pr-2">
        {event.cause ? (
          <span>{event.cause}</span>
        ) : (
          <span className="italic text-muted-foreground/60">{event.raw_text || 'No remarks provided'}</span>
        )}
        {event.source_type === 'daily_summary' && (
          <span className="ml-1.5 text-3xs px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground border border-border/40 inline-block">
            Daily Log
          </span>
        )}
      </div>

      <div className="text-right">
        {event.source_type === 'granular_event' && (isAdmin || isManager) ? (
          <button
            type="button"
            onClick={() => onDelete(event.id)}
            className="p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger-soft transition-colors"
            title="Delete downtime record"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="text-muted-foreground/30 text-2xs">—</span>
        )}
      </div>
    </div>
  );
}
