import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, format, isSameDay, isSameMonth, isAfter, isBefore, startOfDay,
  addDays, addWeeks, addQuarters, addYears,
} from 'date-fns';

type Template = {
  id: string;
  category: string;
  equipment_name: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
  schedule_start_date: string | null;
};

type DueItem = { template: Template; date: Date; status: 'done' | 'pending' | 'backlog' | 'upcoming' };

// Returns ALL due dates of `template` between [from, to] (inclusive).
function dueDatesInRange(t: Template, from: Date, to: Date): Date[] {
  if (!t.schedule_start_date) return [];
  let cursor = startOfDay(new Date(t.schedule_start_date));
  const stop = startOfDay(to);
  // fast-forward cursor close to `from`
  while (isBefore(cursor, startOfDay(from))) {
    cursor = nextOccurrence(cursor, t.frequency);
    if (isAfter(cursor, stop)) return [];
  }
  const out: Date[] = [];
  while (!isAfter(cursor, stop)) {
    out.push(cursor);
    cursor = nextOccurrence(cursor, t.frequency);
  }
  return out;
}

function nextOccurrence(d: Date, freq: Template['frequency']): Date {
  switch (freq) {
    case 'Daily': return addDays(d, 1);
    case 'Weekly': return addWeeks(d, 1);
    case 'Monthly': return addMonths(d, 1);
    case 'Quarterly': return addQuarters(d, 1);
    case 'Yearly': return addYears(d, 1);
  }
}

const STATUS_COLORS: Record<DueItem['status'], string> = {
  done: 'bg-emerald-500',
  pending: 'bg-amber-500',
  backlog: 'bg-rose-500',
  upcoming: 'bg-muted-foreground/40',
};

export function PmsCalendar() {
  const { selectedPlantId } = useAppStore();
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(new Date());

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['pms-templates', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_templates')
        .select('id,category,equipment_name,frequency,schedule_start_date');
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      return ((await q).data ?? []) as Template[];
    },
  });

  const { data: executions } = useQuery<{ template_id: string; completed_at: string }[]>({
    queryKey: ['pms-executions', selectedPlantId, format(gridStart, 'yyyy-MM-dd'), format(gridEnd, 'yyyy-MM-dd')],
    queryFn: async () => {
      let q = supabase.from('checklist_executions')
        .select('template_id, completed_at, plant_id, completed')
        .eq('completed', true)
        .gte('completed_at', gridStart.toISOString())
        .lte('completed_at', addDays(gridEnd, 1).toISOString());
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const rows = (await q).data ?? [];
      return rows.map((r: any) => ({ template_id: r.template_id, completed_at: r.completed_at }));
    },
  });

  // Build due items per day
  const dueByDay = useMemo(() => {
    const map = new Map<string, DueItem[]>();
    if (!templates) return map;
    const today = startOfDay(new Date());
    const execIndex = new Map<string, Date[]>();
    (executions ?? []).forEach(e => {
      const arr = execIndex.get(e.template_id) ?? [];
      arr.push(new Date(e.completed_at));
      execIndex.set(e.template_id, arr);
    });
    templates.forEach(t => {
      const dates = dueDatesInRange(t, gridStart, gridEnd);
      dates.forEach(d => {
        const key = format(d, 'yyyy-MM-dd');
        const execs = execIndex.get(t.id) ?? [];
        const isDone = execs.some(ed => isSameDay(ed, d));
        let status: DueItem['status'];
        if (isDone) status = 'done';
        else if (isSameDay(d, today)) status = 'pending';
        else if (isBefore(d, today)) status = 'backlog';
        else status = 'upcoming';
        const list = map.get(key) ?? [];
        list.push({ template: t, date: d, status });
        map.set(key, list);
      });
    });
    return map;
  }, [templates, executions, gridStart, gridEnd]);

  const selectedKey = selected ? format(selected, 'yyyy-MM-dd') : null;
  const selectedItems = selectedKey ? (dueByDay.get(selectedKey) ?? []) : [];

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <Button size="icon" variant="ghost" onClick={() => setCursor(addMonths(cursor, -1))} data-testid="button-cal-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-semibold text-sm">{format(cursor, 'MMMM yyyy')}</div>
          <Button size="icon" variant="ghost" onClick={() => setCursor(addMonths(cursor, 1))} data-testid="button-cal-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 text-[10px] text-center text-muted-foreground mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const items = dueByDay.get(key) ?? [];
            const inMonth = isSameMonth(day, cursor);
            const isToday = isSameDay(day, new Date());
            const isSelected = selected && isSameDay(day, selected);
            const counts = {
              done: items.filter(i => i.status === 'done').length,
              pending: items.filter(i => i.status === 'pending').length,
              backlog: items.filter(i => i.status === 'backlog').length,
              upcoming: items.filter(i => i.status === 'upcoming').length,
            };
            // Cell base color reflects worst status
            const cellTone =
              counts.backlog ? 'bg-rose-500/10 border-rose-500/30'
              : counts.pending ? 'bg-amber-500/10 border-amber-500/30'
              : counts.done && !counts.upcoming ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'border-border';
            return (
              <button
                key={key}
                onClick={() => setSelected(day)}
                data-testid={`cell-day-${key}`}
                className={[
                  'aspect-square min-h-[44px] rounded border text-left p-1 flex flex-col',
                  'transition-colors hover:bg-accent/30',
                  inMonth ? 'opacity-100' : 'opacity-40',
                  cellTone,
                  isSelected ? 'ring-2 ring-primary' : '',
                  isToday ? 'font-bold' : '',
                ].join(' ')}
              >
                <div className="text-[11px] leading-none">{format(day, 'd')}</div>
                {items.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-0.5">
                    {(['backlog', 'pending', 'done', 'upcoming'] as const).map(s =>
                      counts[s] > 0 ? (
                        <span key={s} className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s]}`} />
                      ) : null
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3 text-[10px] mt-3 pt-2 border-t">
          <Legend dot="bg-emerald-500" label="Done" />
          <Legend dot="bg-amber-500" label="Due Today" />
          <Legend dot="bg-rose-500" label="Backlog" />
          <Legend dot="bg-muted-foreground/40" label="Upcoming" />
        </div>
      </Card>

      {selected && (
        <Card className="p-3">
          <div className="text-xs font-semibold mb-2">
            {format(selected, 'EEEE, MMM d, yyyy')} · {selectedItems.length} task{selectedItems.length === 1 ? '' : 's'}
          </div>
          {selectedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">No PMS tasks scheduled.</p>
          ) : (
            <div className="space-y-1.5">
              {selectedItems.map((it, i) => (
                <div key={`${it.template.id}-${i}`} className="flex items-center gap-2 text-xs"
                  data-testid={`row-due-${it.template.id}`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[it.status]}`} />
                  <span className="font-medium">{it.template.equipment_name}</span>
                  <span className="text-muted-foreground">· {it.template.category}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                    {it.template.frequency} · {it.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
