import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  eachDayOfInterval, addMonths, format, isSameDay, isSameMonth,
  isAfter, isBefore, startOfDay, addDays, addWeeks, addQuarters, addYears,
} from 'date-fns';

export type Template = {
  id: string;
  category: string;
  equipment_name: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
  schedule_start_date: string | null;
  checklist_steps: string[] | null;
  plant_id: string | null;
};

export type DueItem = { template: Template; date: Date; status: 'done' | 'pending' | 'backlog' | 'upcoming' };
export type CalendarView = 'day' | 'week' | 'month';

export function formatWeekRange(start: Date, end: Date): string {
  const sameMonth = isSameMonth(start, end);
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth) return `${format(start, 'MMM d')} \u2013 ${format(end, 'd, yyyy')}`;
  if (sameYear) return `${format(start, 'MMM d')} \u2013 ${format(end, 'MMM d, yyyy')}`;
  return `${format(start, 'MMM d, yyyy')} \u2013 ${format(end, 'MMM d, yyyy')}`;
}

export function dueDatesInRange(t: Template, from: Date, to: Date): Date[] {
  if (!t.schedule_start_date) return [];
  let cursor = startOfDay(new Date(t.schedule_start_date));
  const stop = startOfDay(to);
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

export function nextOccurrence(d: Date, freq: Template['frequency']): Date {
  switch (freq) {
    case 'Daily': return addDays(d, 1);
    case 'Weekly': return addWeeks(d, 1);
    case 'Monthly': return addMonths(d, 1);
    case 'Quarterly': return addQuarters(d, 1);
    case 'Yearly': return addYears(d, 1);
  }
}

export const STATUS_COLORS: Record<DueItem['status'], string> = {
  done: 'bg-accent',
  pending: 'bg-warn',
  backlog: 'bg-danger',
  upcoming: 'bg-muted-foreground/40',
};

export function getGridRange(view: CalendarView, cursor: Date): { start: Date; end: Date } {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  let gridStart: Date;
  let gridEnd: Date;
  if (view === 'month') {
    gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  } else if (view === 'week') {
    gridStart = startOfWeek(cursor, { weekStartsOn: 0 });
    gridEnd = endOfWeek(cursor, { weekStartsOn: 0 });
  } else {
    gridStart = startOfDay(cursor);
    gridEnd = startOfDay(cursor);
  }
  return { start: gridStart, end: gridEnd };
}

export function computeDueByDay(templates: Template[] | undefined, executions: { template_id: string; completed_at: string }[] | undefined, gridStart: Date, gridEnd: Date): Map<string, DueItem[]> {
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
}
