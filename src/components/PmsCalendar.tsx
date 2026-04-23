import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, format, isSameDay, isSameMonth, isAfter, isBefore, startOfDay,
  addDays, addWeeks, addQuarters, addYears,
} from 'date-fns';

type Template = {
  id: string;
  plant_id: string;
  category: string;
  equipment_name: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
  schedule_start_date: string | null;
  checklist_steps: string[] | null;
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
  const qc = useQueryClient();
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['pms-templates', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_templates')
        .select('id,plant_id,category,equipment_name,frequency,schedule_start_date,checklist_steps');
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
                onClick={() => { setSelected(day); setDialogOpen(true); }}
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
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold">
              {format(selected, 'EEEE, MMM d, yyyy')} · {selectedItems.length} task{selectedItems.length === 1 ? '' : 's'}
            </div>
            {selectedItems.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>Open checklist</Button>
            )}
          </div>
          {selectedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">No PMS tasks scheduled.</p>
          ) : (
            <div className="space-y-1.5">
              {selectedItems.map((it, i) => (
                <button key={`${it.template.id}-${i}`}
                  onClick={() => setDialogOpen(true)}
                  className="w-full flex items-center gap-2 text-xs text-left hover:bg-accent/30 rounded px-1 py-0.5"
                  data-testid={`row-due-${it.template.id}`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[it.status]}`} />
                  <span className="font-medium">{it.template.equipment_name}</span>
                  <span className="text-muted-foreground">· {it.template.category}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                    {it.template.frequency} · {it.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <DayChecklistDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        date={selected}
        items={selectedItems}
        onCompleted={() => {
          qc.invalidateQueries({ queryKey: ['pms-executions'] });
          qc.invalidateQueries({ queryKey: ['pms-records'] });
        }}
      />
    </div>
  );
}

function DayChecklistDialog({
  open, onClose, date, items, onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  date: Date | null;
  items: DueItem[];
  onCompleted: () => void;
}) {
  const { user } = useAuth();
  const [activeIdx, setActiveIdx] = useState(0);
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const [findings, setFindings] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset transient state when dialog reopens or active item changes
  const active = items[activeIdx];
  const resetForItem = () => { setChecks({}); setFindings(''); };

  if (!date) return null;

  const markDone = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('checklist_executions').insert({
        template_id: active.template.id,
        plant_id: active.template.plant_id,
        frequency: active.template.frequency,
        completed: true,
        completed_by: user?.id,
        completed_at: new Date().toISOString(),
        execution_date: format(date, 'yyyy-MM-dd'),
        findings: findings || null,
      });
      if (error) throw error;
      toast.success(`${active.template.equipment_name} marked complete`);
      onCompleted();
      // Move to next pending item or close
      const nextIdx = items.findIndex((it, i) => i > activeIdx && it.status !== 'done');
      if (nextIdx >= 0) { setActiveIdx(nextIdx); resetForItem(); }
      else { onClose(); }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  const steps = active?.template.checklist_steps ?? [];
  const allChecked = steps.length > 0 && steps.every((_, i) => checks[i]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] sm:w-full max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Checklists · {format(date, 'EEE, MMM d')}
          </DialogTitle>
        </DialogHeader>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No tasks scheduled this day.</p>
        ) : (
          <div className="space-y-3">
            {/* Item picker */}
            <div className="flex gap-1.5 flex-wrap">
              {items.map((it, i) => (
                <button key={`${it.template.id}-${i}`}
                  onClick={() => { setActiveIdx(i); resetForItem(); }}
                  className={[
                    'text-[11px] px-2 py-1 rounded border flex items-center gap-1.5',
                    i === activeIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent/30',
                  ].join(' ')}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[it.status]}`} />
                  {it.template.equipment_name}
                </button>
              ))}
            </div>

            {active && (
              <div className="space-y-2">
                <div>
                  <div className="font-semibold text-sm">{active.template.equipment_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {active.template.category} · {active.template.frequency} ·
                    <span className="uppercase ml-1">{active.status}</span>
                  </div>
                </div>

                {steps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No checklist steps defined for this template.</p>
                ) : (
                  <div className="space-y-1.5 border rounded-md p-2 bg-secondary/30">
                    {steps.map((s, i) => (
                      <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={!!checks[i]}
                          onCheckedChange={(v) => setChecks(prev => ({ ...prev, [i]: !!v }))}
                          className="mt-0.5"
                        />
                        <span className={checks[i] ? 'line-through text-muted-foreground' : ''}>{s}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">Findings (optional)</label>
                  <Textarea value={findings} onChange={e => setFindings(e.target.value)} rows={2}
                    placeholder="Anything noted during inspection?" />
                </div>

                {active.status === 'done' && (
                  <div className="text-[11px] text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Already completed for this day.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {items.length > 0 && active && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button onClick={markDone} disabled={saving || active.status === 'done' || (steps.length > 0 && !allChecked)}>
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {saving ? 'Saving…' : 'Mark complete'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
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
