import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DataState } from '@/components/DataState';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { Timer, AlertTriangle, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

type DowntimeEvent = {
  event_date: string;
  subsystem: string;
  duration_hrs: number;
  // The downtime_events table (supabase/migrations/20260515_...sql) only
  // stores `description` — no separate cause/raw_text/op_hrs/shutdown_hrs —
  // so these are left null/absent rather than faking a parse we can't do
  // client-side.
  cause?: string;
  raw_text?: string;
  op_hrs?: number | null;
  shutdown_hrs?: number | null;
  plant_name?: string;
};

type DowntimeResponse = {
  count: number;
  total_duration_hrs: number;
  by_subsystem: { subsystem: string; hours: number }[];
  events: DowntimeEvent[];
};

function rollup(events: DowntimeEvent[]): { subsystem: string; hours: number }[] {
  const bySub = new Map<string, number>();
  for (const e of events) {
    const key = e.subsystem || 'Unspecified';
    bySub.set(key, (bySub.get(key) ?? 0) + (e.duration_hrs || 0));
  }
  return [...bySub.entries()]
    .map(([subsystem, hours]) => ({ subsystem, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}

export function DowntimeEventsModal({
  open, onClose, plantId, plantName,
}: {
  open: boolean;
  onClose: () => void;
  plantId?: string;
  plantName?: string;
}) {
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [subFilter, setSubFilter] = useState<string>('all');

  const { data, isLoading, error, refetch } = useQuery<DowntimeResponse>({
    queryKey: ['downtime-events', plantId, from, to],
    enabled: open,
    queryFn: async () => {
      // Direct read of downtime_events — RLS (`auth_read_downtime`) allows
      // any signed-in user to read it. See
      // supabase/migrations/20260515_supabase_only_and_data_analysis.sql.
      let q = supabase
        .from('downtime_events' as any)
        .select('event_date, subsystem, duration_hrs, description, plant_id')
        .gte('event_date', from)
        .lte('event_date', to)
        .order('event_date', { ascending: false })
        .limit(2000);
      if (plantId) q = q.eq('plant_id', plantId);

      const { data: rows, error: sbError } = await q;
      if (sbError) throw new Error(sbError.message);

      const events: DowntimeEvent[] = (rows ?? []).map((r: any) => ({
        event_date: r.event_date,
        subsystem: r.subsystem ?? 'Unspecified',
        duration_hrs: Number(r.duration_hrs) || 0,
        cause: r.description ?? undefined,
        raw_text: r.description ?? '',
      }));
      return {
        count: events.length,
        total_duration_hrs: Math.round(events.reduce((s, e) => s + e.duration_hrs, 0) * 10) / 10,
        by_subsystem: rollup(events),
        events,
      };
    },
    retry: false,
  });

  const filtered = useMemo(() => {
    const list = data?.events ?? [];
    if (subFilter === 'all') return list;
    return list.filter((e) => e.subsystem.toLowerCase().includes(subFilter.toLowerCase()));
  }, [data, subFilter]);

  const subs = data?.by_subsystem ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[96vw] sm:w-full max-h-[90vh] flex flex-col" data-testid="downtime-events-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-4 w-4" />
            Downtime events {plantName ? `· ${plantName}` : ''}
          </DialogTitle>
          <DialogDescription>
            Each row is a single shutdown/disruption parsed from the daily remarks.
          </DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[140px]">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {/* By-subsystem chips */}
        {subs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Button
              size="sm" variant={subFilter === 'all' ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={() => setSubFilter('all')}
              data-testid="downtime-filter-all"
            >
              All · {data?.total_duration_hrs ?? 0}h
            </Button>
            {subs.slice(0, 8).map((s) => (
              <Button
                key={s.subsystem}
                size="sm"
                variant={subFilter === s.subsystem ? 'default' : 'outline'}
                className="h-7 px-2 text-xs"
                onClick={() => setSubFilter(s.subsystem)}
                data-testid={`downtime-filter-${s.subsystem}`}
              >
                {s.subsystem}
                <span className="ml-1 tabular-nums text-muted-foreground">{s.hours}h</span>
              </Button>
            ))}
          </div>
        )}

        {/* List */}
        <div className="border rounded-md overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="bg-muted/40 grid grid-cols-[88px_110px_60px_1fr] gap-2 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <span>Date</span>
            <span>Subsystem</span>
            <span className="text-right">Hours</span>
            <span>Cause</span>
          </div>
          <div className="overflow-auto flex-1">
            <DataState
              loading={isLoading}
              error={error}
              isEmpty={filtered.length === 0}
              onRetry={() => refetch()}
              emptyTitle="No downtime events"
              emptyDescription={plantId
                ? 'No shutdowns found for this plant in the selected range.'
                : 'Import a plant XLSX with a Downtime sheet via /import to see events here.'}
            >
              {filtered.map((ev, i) => {
                const sev = ev.duration_hrs >= 12 ? 'high' : ev.duration_hrs >= 3 ? 'med' : 'low';
                return (
                  <div key={`${ev.event_date}-${ev.subsystem}-${i}`}
                    className={cn(
                      'grid grid-cols-[88px_110px_60px_1fr] gap-2 px-3 py-2 border-t text-xs',
                      sev === 'high' && 'bg-danger-soft/50',
                      sev === 'med' && 'bg-warn-soft/30',
                    )}
                    data-testid={`downtime-event-row-${i}`}
                  >
                    <span className="font-mono-num">{ev.event_date}</span>
                    <span className="truncate" title={ev.subsystem}>
                      <Badge variant="outline" className="font-normal">{ev.subsystem}</Badge>
                    </span>
                    <span className={cn(
                      'text-right font-mono-num',
                      sev === 'high' && 'text-danger font-semibold',
                      sev === 'med' && 'text-warn',
                    )}>
                      {ev.duration_hrs.toFixed(1)}h
                    </span>
                    <span className="text-muted-foreground line-clamp-2">
                      {ev.cause || <span className="italic text-muted-foreground/70">{ev.raw_text}</span>}
                    </span>
                  </div>
                );
              })}
            </DataState>
          </div>
        </div>

        {/* Footer summary */}
        {(data?.count ?? 0) > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            {data?.count} event(s) · total <span className="font-mono-num">{data?.total_duration_hrs}h</span>
            {filtered.length !== data?.count && (
              <span>· showing {filtered.length} after filter</span>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
