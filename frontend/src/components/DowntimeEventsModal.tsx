import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { format, subDays } from 'date-fns';
import { Timer, AlertTriangle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { TopControlsBar } from './DowntimeEventsModal/TopControlsBar';
import { SubsystemFilterChips } from './DowntimeEventsModal/SubsystemFilterChips';
import { AddEventForm } from './DowntimeEventsModal/AddEventForm';
import { EventsTable } from './DowntimeEventsModal/EventsTable';
import {
  DowntimeEvent,
  DowntimeResponse,
  SUBSYSTEM_OPTIONS,
  rollup,
} from './DowntimeEventsModal/types';

export type { DowntimeEvent };

export function DowntimeEventsModal({
  open,
  onClose,
  plantId: initialPlantId,
  plantName: initialPlantName,
}: {
  open: boolean;
  onClose: () => void;
  plantId?: string;
  plantName?: string;
}) {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useAuth();
  const { data: plants = [] } = usePlants();

  const [selectedPlantId, setSelectedPlantId] = useState<string>(initialPlantId || 'all');
  const effectivePlantId = initialPlantId || (selectedPlantId === 'all' ? undefined : selectedPlantId);

  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => ({
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  }));

  const [subFilter, setSubFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddDialog, setShowAddDialog] = useState(false);

  const [newEventDate, setNewEventDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [newEventPlantId, setNewEventPlantId] = useState<string>(initialPlantId || plants[0]?.id || '');
  const [newEventSubsystem, setNewEventSubsystem] = useState<string>('RO Trains');
  const [newEventDuration, setNewEventDuration] = useState<string>('');
  const [newEventDescription, setNewEventDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const plantMap = useMemo(() => {
    const map = new Map<string, string>();
    plants.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [plants]);

  const activePlantLabel = initialPlantName || (effectivePlantId ? plantMap.get(effectivePlantId) : 'All Plants');

  const { data, isLoading, error, refetch } = useQuery<DowntimeResponse>({
    queryKey: ['downtime-events', effectivePlantId, dateRange.from, dateRange.to],
    enabled: open,
    queryFn: async () => {
      let qEvents = supabase
        .from('downtime_events' as any)
        .select('id, event_date, subsystem, duration_hrs, description, plant_id, created_at')
        .order('event_date', { ascending: false })
        .limit(2000);

      if (dateRange.from) qEvents = qEvents.gte('event_date', dateRange.from);
      if (dateRange.to) qEvents = qEvents.lte('event_date', dateRange.to);
      if (effectivePlantId) qEvents = qEvents.eq('plant_id', effectivePlantId);

      const { data: eventRows, error: eventErr } = await qEvents;
      if (eventErr) throw new Error(eventErr.message);

      const granularEvents: DowntimeEvent[] = (eventRows ?? []).map((r: any) => ({
        id: r.id,
        event_date: r.event_date,
        subsystem: r.subsystem ?? 'General',
        duration_hrs: Number(r.duration_hrs) || 0,
        cause: r.description ?? undefined,
        raw_text: r.description ?? '',
        plant_id: r.plant_id,
        plant_name: r.plant_id ? plantMap.get(r.plant_id) : undefined,
        source_type: 'granular_event',
        created_at: r.created_at,
      }));

      const coveredPlantDates = new Set<string>();
      granularEvents.forEach((ev) => {
        if (ev.plant_id) coveredPlantDates.add(`${ev.plant_id}:${ev.event_date}`);
      });

      let qSummary = supabase
        .from('daily_plant_summary')
        .select('summary_date, downtime_hrs, notes, plant_id')
        .gt('downtime_hrs', 0)
        .order('summary_date', { ascending: false })
        .limit(1000);

      if (dateRange.from) qSummary = qSummary.gte('summary_date', dateRange.from);
      if (dateRange.to) qSummary = qSummary.lte('summary_date', dateRange.to);
      if (effectivePlantId) qSummary = qSummary.eq('plant_id', effectivePlantId);

      const { data: summaryRows } = await qSummary;

      const summaryEvents: DowntimeEvent[] = (summaryRows ?? [])
        .filter((r) => !coveredPlantDates.has(`${r.plant_id}:${r.summary_date}`))
        .map((r) => ({
          id: `summary-${r.plant_id}-${r.summary_date}`,
          event_date: r.summary_date,
          subsystem: 'Plant General',
          duration_hrs: Number(r.downtime_hrs) || 0,
          cause: r.notes ?? 'Daily reported plant downtime',
          raw_text: r.notes ?? '',
          plant_id: r.plant_id,
          plant_name: plantMap.get(r.plant_id),
          source_type: 'daily_summary',
        }));

      const allEvents = [...granularEvents, ...summaryEvents].sort((a, b) =>
        b.event_date.localeCompare(a.event_date)
      );

      return {
        count: allEvents.length,
        total_duration_hrs: Math.round(allEvents.reduce((s, e) => s + e.duration_hrs, 0) * 10) / 10,
        by_subsystem: rollup(allEvents),
        events: allEvents,
      };
    },
    retry: false,
  });

  const filtered = useMemo(() => {
    let list = data?.events ?? [];
    if (subFilter !== 'all') {
      list = list.filter((e) => e.subsystem.toLowerCase().includes(subFilter.toLowerCase()));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (e) =>
          e.subsystem.toLowerCase().includes(q) ||
          (e.cause && e.cause.toLowerCase().includes(q)) ||
          (e.plant_name && e.plant_name.toLowerCase().includes(q)) ||
          e.event_date.includes(q)
      );
    }
    return list;
  }, [data, subFilter, searchQuery]);

  const subs = data?.by_subsystem ?? [];

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventDate) {
      toast.error('Please select an event date');
      return;
    }
    const duration = parseFloat(newEventDuration);
    if (isNaN(duration) || duration <= 0) {
      toast.error('Please enter a valid duration in hours');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: insErr } = await supabase.from('downtime_events' as any).insert({
        event_date: newEventDate,
        plant_id: newEventPlantId || null,
        subsystem: newEventSubsystem,
        duration_hrs: duration,
        description: newEventDescription.trim() || null,
      });

      if (insErr) throw new Error(insErr.message);

      toast.success('Downtime event recorded successfully');
      setShowAddDialog(false);
      setNewEventDuration('');
      setNewEventDescription('');
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      qc.invalidateQueries({ queryKey: ['alerts-feed'] });
      qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to record downtime event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async (id?: string) => {
    if (!id || id.startsWith('summary-')) {
      toast.info('This record is aggregated from daily summary logs and cannot be deleted here.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this recorded downtime event?')) {
      return;
    }

    try {
      const { error: delErr } = await supabase.from('downtime_events' as any).delete().eq('id', id);
      if (delErr) throw new Error(delErr.message);

      toast.success('Downtime event removed');
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      qc.invalidateQueries({ queryKey: ['alerts-feed'] });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete event');
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setShowAddDialog(false);
          onClose();
        }
      }}
      title={
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-danger-soft text-danger border border-danger/20">
            <Timer className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">Downtime Events</span>
              {activePlantLabel && (
                <Badge variant="outline" className="text-2xs font-semibold px-2 py-0">
                  {activePlantLabel}
                </Badge>
              )}
            </div>
            <p className="text-xs font-normal text-muted-foreground mt-0.5">
              Comprehensive shutdown and disruption logs parsed from plant remarks and telemetry
            </p>
          </div>
        </div>
      }
      className="max-w-4xl w-[96vw] sm:w-full"
      bodyScroll={false}
      footer={
        (data?.count ?? 0) > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground w-full">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-warn" />
              <span>
                <strong>{data?.count}</strong> event(s) recorded · total{' '}
                <span className="font-mono-num font-bold text-foreground">{data?.total_duration_hrs}h</span> downtime
              </span>
              {filtered.length !== data?.count && (
                <span className="text-muted-foreground/80">({filtered.length} matching filter)</span>
              )}
            </div>
            {(isAdmin || isManager) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 ml-auto border-primary/40 text-primary hover:bg-primary/5"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Record Downtime
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3.5 h-full min-h-0" data-testid="downtime-events-modal">
        <TopControlsBar
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          selectedPlantId={selectedPlantId}
          onSelectedPlantIdChange={setSelectedPlantId}
          initialPlantId={initialPlantId}
          plants={plants}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onLogClick={() => setShowAddDialog(true)}
        />

        {subs.length > 0 && (
          <SubsystemFilterChips
            subs={subs}
            totalDurationHrs={data?.total_duration_hrs ?? 0}
            totalCount={data?.count ?? 0}
            subFilter={subFilter}
            onSubFilterChange={setSubFilter}
          />
        )}

        <AddEventForm
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          plants={plants}
          initialPlantId={initialPlantId}
          isSubmitting={isSubmitting}
          eventDate={newEventDate}
          onEventDateChange={setNewEventDate}
          plantId={newEventPlantId}
          onPlantIdChange={setNewEventPlantId}
          subsystem={newEventSubsystem}
          onSubsystemChange={setNewEventSubsystem}
          duration={newEventDuration}
          onDurationChange={setNewEventDuration}
          description={newEventDescription}
          onDescriptionChange={setNewEventDescription}
          onSubmit={handleCreateEvent}
        />

        <EventsTable
          events={filtered}
          isLoading={isLoading}
          error={error}
          refetch={refetch}
          effectivePlantId={effectivePlantId}
          isAdmin={isAdmin}
          isManager={isManager}
          onDeleteEvent={handleDeleteEvent}
        />
      </div>
    </ResponsiveDialog>
  );
}
