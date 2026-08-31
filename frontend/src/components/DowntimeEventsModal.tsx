import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DataState } from '@/components/DataState';
import { DateRangePicker, DatePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { format, subDays } from 'date-fns';
import {
  Timer,
  AlertTriangle,
  Filter,
  Plus,
  Search,
  Trash2,
  Clock,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type DowntimeEvent = {
  id?: string;
  event_date: string;
  subsystem: string;
  duration_hrs: number;
  cause?: string;
  raw_text?: string;
  plant_id?: string;
  plant_name?: string;
  source_type?: 'granular_event' | 'daily_summary';
  created_at?: string;
};

type DowntimeResponse = {
  count: number;
  total_duration_hrs: number;
  by_subsystem: { subsystem: string; hours: number }[];
  events: DowntimeEvent[];
};

const SUBSYSTEM_OPTIONS = [
  { value: 'RO Trains', label: 'RO Trains / Desalination' },
  { value: 'Well Pumps', label: 'Deep Wells / Submersible Pumps' },
  { value: 'Pretreatment', label: 'Pre-treatment / Media & Cartridge Filters' },
  { value: 'Power & Grid', label: 'Power Grid / Solar / Generator Outage' },
  { value: 'Meters & Distribution', label: 'Meters / Transmission & Distribution' },
  { value: 'CIP & Maintenance', label: 'CIP Cleaning & Scheduled Servicing' },
  { value: 'General Plant', label: 'General / Plant-wide Disruption' },
];

function rollup(events: DowntimeEvent[]): { subsystem: string; hours: number }[] {
  const bySub = new Map<string, number>();
  for (const e of events) {
    const key = e.subsystem || 'General';
    bySub.set(key, (bySub.get(key) ?? 0) + (e.duration_hrs || 0));
  }
  return [...bySub.entries()]
    .map(([subsystem, hours]) => ({ subsystem, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}

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

  // Active selected plant filter (can be swapped if no initialPlantId is locked)
  const [selectedPlantId, setSelectedPlantId] = useState<string>(initialPlantId || 'all');
  const effectivePlantId = initialPlantId || (selectedPlantId === 'all' ? undefined : selectedPlantId);

  // Premium Date Range state — default to last 30 days up to today
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => ({
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  }));

  const [subFilter, setSubFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddDialog, setShowAddDialog] = useState(false);

  // New downtime event form state
  const [newEventDate, setNewEventDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [newEventPlantId, setNewEventPlantId] = useState<string>(initialPlantId || plants[0]?.id || '');
  const [newEventSubsystem, setNewEventSubsystem] = useState<string>('RO Trains');
  const [newEventDuration, setNewEventDuration] = useState<string>('');
  const [newEventDescription, setNewEventDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Map plant IDs to names
  const plantMap = useMemo(() => {
    const map = new Map<string, string>();
    plants.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [plants]);

  const activePlantLabel = initialPlantName || (effectivePlantId ? plantMap.get(effectivePlantId) : 'All Plants');

  // Query unified downtime events (from downtime_events + daily_plant_summary)
  const { data, isLoading, error, refetch } = useQuery<DowntimeResponse>({
    queryKey: ['downtime-events', effectivePlantId, dateRange.from, dateRange.to],
    enabled: open,
    queryFn: async () => {
      // 1. Fetch from downtime_events table
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

      // Set of dates already covered in granular events per plant to prevent duplicates
      const coveredPlantDates = new Set<string>();
      granularEvents.forEach((ev) => {
        if (ev.plant_id) coveredPlantDates.add(`${ev.plant_id}:${ev.event_date}`);
      });

      // 2. Fallback / supplementary read of daily_plant_summary where downtime_hrs > 0
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

  // Filtered event list
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

  // Handle recording new downtime event
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

  // Handle deleting a recorded event
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
        {/* ── Top Controls Bar: Premium DateRangePicker + Plant Switcher + Actions ── */}
        <div className="flex flex-wrap items-end justify-between gap-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-2xs shrink-0">
          {/* Left: Premium Date Horizon Picker */}
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-primary" /> Time Horizon Range
              </Label>
              <DateRangePicker
                from={dateRange.from}
                to={dateRange.to}
                onChange={(range) => setDateRange(range)}
                size="sm"
                className="w-full h-8.5 text-xs bg-background"
                placeholder="Select date horizon..."
              />
            </div>

            {/* Plant selector if not pre-locked */}
            {!initialPlantId && plants.length > 0 && (
              <div className="space-y-1 min-w-[140px]">
                <Label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Plant</Label>
                <Select value={selectedPlantId} onValueChange={setSelectedPlantId}>
                  <SelectTrigger className="h-8.5 text-xs bg-background">
                    <SelectValue placeholder="All Plants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Plants</SelectItem>
                    {plants.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Right: Search & Record Button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative w-44 sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cause / notes…"
                className="h-8.5 text-xs pl-8 bg-background"
              />
            </div>

            <Button
              size="sm"
              onClick={() => setShowAddDialog(true)}
              className="h-8.5 px-3 text-xs gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Log Downtime
            </Button>
          </div>
        </div>

        {/* ── Subsystem Category Chips ── */}
        {subs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center px-1 shrink-0">
            <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
            <Button
              size="sm"
              variant={subFilter === 'all' ? 'default' : 'outline'}
              className={cn(
                'h-6.5 px-2.5 text-2xs rounded-full transition-all',
                subFilter === 'all' && 'shadow-xs font-semibold'
              )}
              onClick={() => setSubFilter('all')}
              data-testid="downtime-filter-all"
            >
              All Subsystems · {data?.total_duration_hrs ?? 0}h
            </Button>
            {subs.map((s) => (
              <Button
                key={s.subsystem}
                size="sm"
                variant={subFilter === s.subsystem ? 'default' : 'outline'}
                className={cn(
                  'h-6.5 px-2.5 text-2xs rounded-full transition-all',
                  subFilter === s.subsystem && 'shadow-xs font-semibold'
                )}
                onClick={() => setSubFilter(s.subsystem)}
                data-testid={`downtime-filter-${s.subsystem}`}
              >
                {s.subsystem}
                <span className="ml-1 font-mono-num font-semibold text-muted-foreground">{s.hours}h</span>
              </Button>
            ))}
          </div>
        )}

        {/* ── Modal Inline Form for Recording Downtime ── */}
        {showAddDialog && (
          <form
            onSubmit={handleCreateEvent}
            className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3 shrink-0 animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-primary/20 pb-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Record Downtime Event</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowAddDialog(false)}
              >
                Cancel
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Event Date using Single DatePicker */}
              <div className="space-y-1">
                <Label className="text-2xs font-semibold">Event Date *</Label>
                <DatePicker
                  value={newEventDate}
                  onChange={(val) => setNewEventDate(val)}
                  size="sm"
                  className="w-full bg-background"
                />
              </div>

              {/* Plant selection */}
              <div className="space-y-1">
                <Label className="text-2xs font-semibold">Plant *</Label>
                <Select value={newEventPlantId} onValueChange={setNewEventPlantId}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue placeholder="Select plant" />
                  </SelectTrigger>
                  <SelectContent>
                    {plants.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Subsystem */}
              <div className="space-y-1">
                <Label className="text-2xs font-semibold">Subsystem *</Label>
                <Select value={newEventSubsystem} onValueChange={setNewEventSubsystem}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue placeholder="Select subsystem" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBSYSTEM_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Duration (Hours) */}
              <div className="space-y-1">
                <Label className="text-2xs font-semibold">Duration (hrs) *</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="720"
                  placeholder="e.g. 3.5"
                  value={newEventDuration}
                  onChange={(e) => setNewEventDuration(e.target.value)}
                  className="h-8 text-xs bg-background font-mono-num"
                  required
                />
              </div>
            </div>

            {/* Description / Cause */}
            <div className="space-y-1">
              <Label className="text-2xs font-semibold">Root Cause / Operational Remarks</Label>
              <Input
                value={newEventDescription}
                onChange={(e) => setNewEventDescription(e.target.value)}
                placeholder="Describe shutdown reason, maintenance performed, or grid outage details…"
                className="h-8 text-xs bg-background"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowAddDialog(false)}
              >
                Dismiss
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="h-7 text-xs font-semibold bg-primary text-primary-foreground gap-1.5 shadow-xs"
              >
                {isSubmitting ? 'Saving…' : 'Save Event'}
              </Button>
            </div>
          </form>
        )}

        {/* ── Events Table List ── */}
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
              isEmpty={filtered.length === 0}
              onRetry={() => refetch()}
              emptyTitle="No downtime events"
              emptyDescription={
                effectivePlantId
                  ? 'No recorded shutdowns found for this plant in the selected time horizon.'
                  : 'No downtime events recorded across plants in the selected time horizon. Click "Log Downtime" above to register one.'
              }
            >
              {filtered.map((ev, i) => {
                const sev = ev.duration_hrs >= 12 ? 'high' : ev.duration_hrs >= 3 ? 'med' : 'low';
                return (
                  <div
                    key={`${ev.event_date}-${ev.subsystem}-${ev.id || i}`}
                    className={cn(
                      'grid grid-cols-[96px_110px_130px_70px_1fr_40px] gap-2 px-3 py-2.5 text-xs transition-colors items-center hover:bg-muted/30',
                      sev === 'high' && 'bg-danger-soft/40',
                      sev === 'med' && 'bg-warn-soft/20'
                    )}
                    data-testid={`downtime-event-row-${i}`}
                  >
                    {/* Date */}
                    <span className="font-mono-num font-medium text-foreground">{ev.event_date}</span>

                    {/* Plant */}
                    <span className="truncate font-medium text-muted-foreground text-2xs">
                      {ev.plant_name || '—'}
                    </span>

                    {/* Subsystem Badge */}
                    <div className="truncate">
                      <Badge variant="outline" className="font-normal text-3xs px-1.5 py-0">
                        {ev.subsystem}
                      </Badge>
                    </div>

                    {/* Duration */}
                    <span
                      className={cn(
                        'text-right font-mono-num font-semibold',
                        sev === 'high' && 'text-danger font-bold',
                        sev === 'med' && 'text-warn font-semibold',
                        sev === 'low' && 'text-foreground'
                      )}
                    >
                      {ev.duration_hrs.toFixed(1)}h
                    </span>

                    {/* Cause & Source indicator */}
                    <div className="text-muted-foreground text-xs line-clamp-2 pr-2">
                      {ev.cause ? (
                        <span>{ev.cause}</span>
                      ) : (
                        <span className="italic text-muted-foreground/60">{ev.raw_text || 'No remarks provided'}</span>
                      )}
                      {ev.source_type === 'daily_summary' && (
                        <span className="ml-1.5 text-3xs px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground border border-border/40 inline-block">
                          Daily Log
                        </span>
                      )}
                    </div>

                    {/* Actions (Delete if direct event and user is admin/manager) */}
                    <div className="text-right">
                      {ev.source_type === 'granular_event' && (isAdmin || isManager) ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(ev.id)}
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
              })}
            </DataState>
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
