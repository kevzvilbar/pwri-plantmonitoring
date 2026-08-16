import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { useTabPersist } from '@/hooks/useTabPersist';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChevronLeft, ChevronRight, Pencil, Trash2, Loader2, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { PMS_CATEGORIES, PMS_FREQUENCIES } from '@/lib/pmsTemplates';
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
  checklist_steps: string[] | null;
  plant_id: string | null;
};

type DueItem = { template: Template; date: Date; status: 'done' | 'pending' | 'backlog' | 'upcoming' };
type CalendarView = 'day' | 'week' | 'month';

function formatWeekRange(start: Date, end: Date): string {
  const sameMonth = isSameMonth(start, end);
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth) return `${format(start, 'MMM d')} \u2013 ${format(end, 'd, yyyy')}`;
  if (sameYear) return `${format(start, 'MMM d')} \u2013 ${format(end, 'MMM d, yyyy')}`;
  return `${format(start, 'MMM d, yyyy')} \u2013 ${format(end, 'MMM d, yyyy')}`;
}

function dueDatesInRange(t: Template, from: Date, to: Date): Date[] {
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
  done: 'bg-accent',
  pending: 'bg-warn',
  backlog: 'bg-danger',
  upcoming: 'bg-muted-foreground/40',
};

export function PmsCalendar() {
  const { isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const [view, setView] = useTabPersist<CalendarView>('tab:maintenance-calendar-view', 'month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [openItem, setOpenItem] = useState<DueItem | null>(null);
  const [selected, setSelected] = useState<Date | null>(new Date());
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);

  // Visible date range depends on which view is active. Month keeps the
  // existing full 6-week grid; Week narrows to a single Sun–Sat row; Day
  // narrows to the single day the grid/detail panel below is built around.
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
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const navUnit = view === 'month' ? 'month' : view === 'week' ? 'week' : 'day';
  const headerTitle =
    view === 'month' ? format(cursor, 'MMMM yyyy')
    : view === 'week' ? formatWeekRange(gridStart, gridEnd)
    : format(cursor, 'EEEE, MMM d, yyyy');

  const goToday = () => {
    const today = new Date();
    setCursor(today);
    setSelected(startOfDay(today));
  };
  const goPrev = () => {
    if (view === 'month') { setCursor(addMonths(cursor, -1)); return; }
    if (view === 'week') { setCursor(addWeeks(cursor, -1)); return; }
    const d = addDays(cursor, -1);
    setCursor(d);
    setSelected(d);
  };
  const goNext = () => {
    if (view === 'month') { setCursor(addMonths(cursor, 1)); return; }
    if (view === 'week') { setCursor(addWeeks(cursor, 1)); return; }
    const d = addDays(cursor, 1);
    setCursor(d);
    setSelected(d);
  };
  const changeView = (v: CalendarView) => {
    if (v === view) return;
    // Keep whichever day was selected in view — switching views re-centers
    // the grid around it rather than jumping back to today.
    const anchor = selected ?? cursor;
    setCursor(anchor);
    if (v === 'day') setSelected(anchor);
    setView(v);
  };

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['pms-templates', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('checklist_templates')
        .select('id,category,equipment_name,frequency,schedule_start_date,checklist_steps,plant_id');
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1 min-w-0">
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs shrink-0"
              onClick={goToday} data-testid="button-cal-today">
              Today
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Previous ${navUnit}`}
              onClick={goPrev} data-testid="button-cal-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Next ${navUnit}`}
              onClick={goNext} data-testid="button-cal-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="font-semibold text-sm truncate ml-1" data-testid="text-cal-header">{headerTitle}</div>
          </div>

          <div className="flex items-center gap-1.5">
            <Tabs value={view} onValueChange={(v) => changeView(v as CalendarView)}>
              <TabsList className="h-8 p-0.5">
                <TabsTrigger value="day" className="h-7 px-2.5 text-xs" data-testid="button-view-day">Day</TabsTrigger>
                <TabsTrigger value="week" className="h-7 px-2.5 text-xs" data-testid="button-view-week">Week</TabsTrigger>
                <TabsTrigger value="month" className="h-7 px-2.5 text-xs" data-testid="button-view-month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
            {isManager && (
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-danger hover:text-danger"
                aria-label="Manage PMS schedules" title="Manage / delete schedules"
                onClick={() => setManageOpen(true)} data-testid="button-open-manage-schedules">
                <ListChecks className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {view !== 'day' && (
          <>
            <div className="grid grid-cols-7 text-2xs text-center text-muted-foreground mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map(day => {
                const key = format(day, 'yyyy-MM-dd');
                const items = dueByDay.get(key) ?? [];
                const inMonth = view === 'week' ? true : isSameMonth(day, cursor);
                const isToday = isSameDay(day, new Date());
                const isSelected = selected && isSameDay(day, selected);
                const counts = {
                  done: items.filter(i => i.status === 'done').length,
                  pending: items.filter(i => i.status === 'pending').length,
                  backlog: items.filter(i => i.status === 'backlog').length,
                  upcoming: items.filter(i => i.status === 'upcoming').length,
                };
                const cellTone =
                  counts.backlog ? 'bg-danger/10 border-danger/30'
                  : counts.pending ? 'bg-warn/10 border-warn/30'
                  : counts.done && !counts.upcoming ? 'bg-accent/10 border-accent/30'
                  : 'border-border';
                const MAX_VISIBLE = view === 'week' ? 6 : 3;
                const cellMinH = view === 'week' ? 'min-h-[110px] sm:min-h-[160px]' : 'min-h-[64px] sm:min-h-[88px]';
                const visible = items.slice(0, MAX_VISIBLE);
                const overflow = items.length - visible.length;
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(day)}
                    data-testid={`cell-day-${key}`}
                    className={[
                      cellMinH, 'rounded border text-left p-1 flex flex-col items-stretch',
                      'transition-colors hover:bg-accent/30',
                      inMonth ? 'opacity-100' : 'opacity-40',
                      cellTone,
                      isSelected ? 'ring-2 ring-primary' : '',
                      isToday ? 'font-bold' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs leading-none">{format(day, 'd')}</span>
                      {items.length > 0 && (
                        <span className="text-[9px] leading-none text-muted-foreground sm:hidden">{items.length}</span>
                      )}
                    </div>
                    {items.length > 0 && (
                      <div className="mt-1 space-y-0.5 min-w-0 overflow-hidden">
                        {visible.map((it, i) => (
                          <div
                            key={`${it.template.id}-${i}`}
                            className="flex items-center gap-1 min-w-0"
                            title={`${it.template.equipment_name} · ${it.template.category} · ${it.status}`}
                          >
                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[it.status]}`} />
                            <span className="truncate text-[9px] sm:text-2xs leading-tight font-normal text-foreground/80">
                              {it.template.equipment_name}
                            </span>
                          </div>
                        ))}
                        {overflow > 0 && (
                          <div className="text-[9px] sm:text-2xs leading-tight text-muted-foreground pl-2.5">
                            +{overflow} more
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-3 text-2xs mt-3 pt-2 border-t">
          <Legend dot="bg-accent" label="Done" />
          <Legend dot="bg-warn" label="Due Today" />
          <Legend dot="bg-danger" label="Backlog" />
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
                <div
                  key={`${it.template.id}-${i}`}
                  className="w-full flex items-center gap-1 text-xs rounded-md border hover:bg-secondary transition-colors"
                  data-testid={`row-due-${it.template.id}`}
                >
                  <button
                    onClick={() => setOpenItem(it)}
                    className="flex-1 min-w-0 flex items-center gap-2 p-2 text-left"
                  >
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[it.status]}`} />
                    <span className="font-medium truncate">{it.template.equipment_name}</span>
                    <span className="text-muted-foreground truncate hidden sm:inline">· {it.template.category}</span>
                    <span className="ml-auto text-2xs uppercase tracking-wide text-muted-foreground shrink-0">
                      {it.template.frequency} · {it.status}
                    </span>
                  </button>
                  {isManager && (
                    <div className="flex items-center gap-0.5 pr-1 shrink-0">
                      <Button
                        type="button" size="icon" variant="ghost" className="h-6 w-6"
                        aria-label={`Edit ${it.template.equipment_name}`}
                        data-testid={`button-edit-${it.template.id}`}
                        onClick={(e) => { e.stopPropagation(); setEditingTemplate(it.template); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button" size="icon" variant="ghost" className="h-6 w-6 text-danger hover:text-danger"
                        aria-label={`Delete ${it.template.equipment_name}`}
                        data-testid={`button-delete-${it.template.id}`}
                        onClick={(e) => { e.stopPropagation(); setDeletingTemplate(it.template); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {openItem && (
        <ChecklistDialog
          item={openItem}
          isManager={isManager}
          onClose={() => setOpenItem(null)}
          onEdit={(t) => { setOpenItem(null); setEditingTemplate(t); }}
          onDelete={(t) => { setOpenItem(null); setDeletingTemplate(t); }}
        />
      )}

      {editingTemplate && (
        <EditTemplateDialog
          template={editingTemplate}
          onClose={() => setEditingTemplate(null)}
        />
      )}

      {deletingTemplate && (
        <DeleteTemplateAlert
          template={deletingTemplate}
          onClose={() => setDeletingTemplate(null)}
          onDeleted={() => setDeletingTemplate(null)}
        />
      )}

      {manageOpen && (
        <ManageSchedulesDialog
          templates={templates ?? []}
          onClose={() => setManageOpen(false)}
        />
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

// ---------------- Checklist popup with per-step ticks ----------------

function ChecklistDialog({ item, isManager, onClose, onEdit, onDelete }: {
  item: DueItem;
  isManager: boolean;
  onClose: () => void;
  onEdit: (t: Template) => void;
  onDelete: (t: Template) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const steps = item.template.checklist_steps ?? [];
  const dateKey = format(item.date, 'yyyy-MM-dd');

  // Existing execution for this template + date (if any)
  const { data: existingExec } = useQuery({
    queryKey: ['pms-exec-for', item.template.id, dateKey],
    queryFn: async () => {
      const { data } = await supabase.from('checklist_executions')
        .select('*')
        .eq('template_id', item.template.id)
        .eq('execution_date', dateKey)
        .limit(1);
      return data?.[0] ?? null;
    },
  });

  const { data: existingSteps } = useQuery({
    queryKey: ['pms-step-execs', existingExec?.id],
    queryFn: async () => {
      if (!existingExec?.id) return [];
      const { data } = await supabase.from('checklist_step_executions')
        .select('*').eq('execution_id', existingExec.id).order('step_index');
      return data ?? [];
    },
    enabled: !!existingExec?.id,
  });

  const [findings, setFindings] = useState('');
  const [stepState, setStepState] = useState<Record<number, { completed: boolean; value: string; notes: string }>>({});
  const [saving, setSaving] = useState(false);

  // Hydrate from server when ready
  useMemo(() => {
    if (existingExec?.findings) setFindings(existingExec.findings);
    if (existingSteps?.length) {
      const next: typeof stepState = {};
      existingSteps.forEach((s: any) => {
        next[s.step_index] = { completed: s.completed, value: s.value ?? '', notes: s.notes ?? '' };
      });
      setStepState(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingExec?.id, existingSteps?.length]);

  const setStep = (i: number, patch: Partial<{ completed: boolean; value: string; notes: string }>) => {
    setStepState(prev => ({
      ...prev,
      [i]: { completed: false, value: '', notes: '', ...prev[i], ...patch },
    }));
  };

  const allDone = steps.length > 0 && steps.every((_, i) => stepState[i]?.completed);

  const save = async () => {
    setSaving(true);
    try {
      // Upsert execution row
      let execId = existingExec?.id;
      if (!execId) {
        const { data: ins, error } = await supabase.from('checklist_executions').insert({
          template_id: item.template.id,
          plant_id: item.template.plant_id,
          frequency: item.template.frequency,
          execution_date: dateKey,
          completed: allDone,
          completed_by: allDone ? user?.id : null,
          completed_at: allDone ? new Date().toISOString() : null,
          findings: findings || null,
        }).select('id').single();
        if (error) throw error;
        execId = ins.id;
      } else {
        const { error } = await supabase.from('checklist_executions').update({
          completed: allDone,
          completed_by: allDone ? user?.id : null,
          completed_at: allDone ? new Date().toISOString() : null,
          findings: findings || null,
        }).eq('id', execId);
        if (error) throw error;
      }

      // Replace per-step rows
      if (execId) {
        await supabase.from('checklist_step_executions').delete().eq('execution_id', execId);
        const stepRows = steps.map((text, i) => {
          const s = stepState[i] ?? { completed: false, value: '', notes: '' };
          return {
            execution_id: execId!,
            template_id: item.template.id,
            plant_id: item.template.plant_id,
            step_index: i,
            step_text: text,
            completed: !!s.completed,
            value: s.value || null,
            notes: s.notes || null,
            completed_by: s.completed ? user?.id ?? null : null,
            completed_at: s.completed ? new Date().toISOString() : null,
          };
        });
        if (stepRows.length) {
          const { error } = await supabase.from('checklist_step_executions').insert(stepRows);
          if (error) throw error;
        }
      }

      toast.success(allDone ? 'Checklist completed' : 'Progress saved');
      qc.invalidateQueries({ queryKey: ['pms-executions'] });
      qc.invalidateQueries({ queryKey: ['pms-exec-for', item.template.id, dateKey] });
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 pr-6">
            <div className="min-w-0">
              <DialogTitle className="text-base truncate">
                {item.template.equipment_name}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {item.template.category} · {item.template.frequency} · {format(item.date, 'EEE, MMM d, yyyy')}
              </p>
            </div>
            {isManager && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button" size="icon" variant="ghost" className="h-7 w-7"
                  aria-label="Edit this PMS schedule"
                  data-testid="button-edit-open-item"
                  onClick={() => onEdit(item.template)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" size="icon" variant="ghost" className="h-7 w-7 text-danger hover:text-danger"
                  aria-label="Delete this PMS schedule"
                  data-testid="button-delete-open-item"
                  onClick={() => onDelete(item.template)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            This template has no checklist steps. Edit the template to add some.
          </p>
        ) : (
          <div className="space-y-2">
            {steps.map((text, i) => {
              const s = stepState[i] ?? { completed: false, value: '', notes: '' };
              const isMeasurement = /\(.*\)$/.test(text) && !text.includes('—') && !text.includes('/');
              return (
                <div key={`${i}-${text.slice(0, 24)}`}
                  className={`rounded-md border p-2 transition-colors ${s.completed ? 'bg-accent-soft/50 border-accent/40' : 'bg-card'}`}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox checked={s.completed} className="mt-0.5"
                      onCheckedChange={(c) => setStep(i, { completed: !!c })} />
                    <span className="text-xs flex-1 leading-snug">{text}</span>
                  </label>
                  {isMeasurement && (
                    <Input value={s.value} placeholder="Reading / value"
                      className="mt-2 h-8 text-xs"
                      onChange={(e) => setStep(i, { value: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium">Findings / Notes (Optional)</label>
          <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : allDone ? 'Mark Complete' : 'Save Progress'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Edit / delete PMS schedule (Manager + Admin only) ----------------
// The DB (checklist_templates_write RLS policy) already restricts UPDATE/DELETE to
// Manager/Admin via is_manager_or_admin(); these dialogs are gated the same way on
// the client so non-managers never see the controls in the first place.

function EditTemplateDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    category: template.category,
    equipment_name: template.equipment_name,
    frequency: template.frequency,
    schedule_start_date: template.schedule_start_date ?? format(new Date(), 'yyyy-MM-dd'),
    checklist_steps: (template.checklist_steps ?? []).join('\n'),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!v.equipment_name.trim()) { toast.error('Equipment name is required'); return; }
    setSaving(true);
    try {
      const steps = v.checklist_steps.split('\n').map(s => s.trim()).filter(Boolean);
      const { error } = await supabase.from('checklist_templates').update({
        category: v.category,
        equipment_name: v.equipment_name.trim(),
        frequency: v.frequency,
        schedule_start_date: v.schedule_start_date || null,
        checklist_steps: steps.length ? steps : null,
      }).eq('id', template.id);
      if (error) throw error;
      toast.success('PMS schedule updated');
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-exec-for'] });
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit PMS Schedule</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Changes apply going forward. Already-completed checklist history is kept.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label>Category</Label>
              <Select value={v.category} onValueChange={(x) => setV({ ...v, category: x })}>
                <SelectTrigger data-testid="select-edit-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PMS_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequency</Label>
              <Select value={v.frequency} onValueChange={(x) => setV({ ...v, frequency: x as Template['frequency'] })}>
                <SelectTrigger data-testid="select-edit-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PMS_FREQUENCIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Equipment Name</Label>
            <Input
              value={v.equipment_name}
              data-testid="input-edit-equipment-name"
              onChange={(e) => setV({ ...v, equipment_name: e.target.value })}
            />
          </div>
          <div>
            <Label>Schedule Start Date</Label>
            <Input
              type="date"
              value={v.schedule_start_date}
              data-testid="input-edit-start-date"
              onChange={(e) => setV({ ...v, schedule_start_date: e.target.value })}
            />
          </div>
          <div>
            <Label>Checklist Steps (One Per Line)</Label>
            <Textarea
              value={v.checklist_steps}
              rows={6}
              data-testid="textarea-edit-steps"
              onChange={(e) => setV({ ...v, checklist_steps: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="button-save-edit-template">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTemplateAlert({ template, onClose, onDeleted }: {
  template: Template;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.from('checklist_templates').delete().eq('id', template.id);
      if (error) throw error;
      toast.success(`Deleted "${template.equipment_name}" schedule`);
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-executions'] });
      onDeleted();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && !deleting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-danger">Delete PMS schedule?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes <strong>{template.equipment_name}</strong> ({template.category} · {template.frequency}),
            including its checklist history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting} data-testid="button-cancel-delete-template">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            disabled={deleting}
            className="bg-danger text-danger-foreground hover:bg-danger/90"
            data-testid="button-confirm-delete-template"
          >
            {deleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {deleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------- Manage schedules: multi-select bulk delete (Manager + Admin only) ----------------
// Google-Calendar-style bulk removal: pick any number of PMS schedules — or an
// equipment's whole set of frequencies in one tap — and delete them together.
// Deleting a template removes every past/future occurrence computed from it
// (occurrences aren't stored rows) plus its checklist_executions history via
// ON DELETE CASCADE, same as the single-item delete above, just batched.

function ManageSchedulesDialog({ templates, onClose }: {
  templates: Template[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const sorted = useMemo(
    () => [...templates].sort((a, b) =>
      a.equipment_name.localeCompare(b.equipment_name) || a.frequency.localeCompare(b.frequency)),
    [templates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(t =>
      t.equipment_name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [sorted, query]);

  // Group by equipment so a whole equipment's schedule array (every
  // frequency variant) can be selected — and deleted — in one motion.
  const groups = useMemo(() => {
    const map = new Map<string, Template[]>();
    filtered.forEach(t => {
      const arr = map.get(t.equipment_name) ?? [];
      arr.push(t);
      map.set(t.equipment_name, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (ids: string[]) => {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id));
      const next = new Set(prev);
      ids.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(t => t.id)));
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkDeletePending(false);
    setBulkDeleting(true);
    try {
      const { error } = await supabase.from('checklist_templates').delete().in('id', ids);
      if (error) throw error;
      toast.success(`Deleted ${ids.length} PMS schedule${ids.length === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-executions'] });
      setSelectedIds(new Set());
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBulkDeleting(false);
    }
  };

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !bulkDeleting && onClose()}>
        <DialogContent className="max-w-lg w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base">Manage PMS Schedules</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Select one or more schedules — or an equipment's full set of frequencies — to delete.
              This removes every occurrence and its checklist history and cannot be undone.
            </p>
          </DialogHeader>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by equipment or category…"
            className="h-8 text-xs shrink-0"
            data-testid="input-manage-filter"
          />

          <div className="flex items-center justify-between shrink-0">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleSelectAll}
                disabled={!filtered.length}
                data-testid="checkbox-select-all-schedules"
              />
              Select all ({filtered.length})
            </label>
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="text-2xs text-muted-foreground underline underline-offset-2"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear selection
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
            {!filtered.length ? (
              <p className="text-xs text-muted-foreground text-center py-6">No schedules match.</p>
            ) : (
              groups.map(([equipment, rows]) => {
                const ids = rows.map(r => r.id);
                const groupSelected = ids.every(id => selectedIds.has(id));
                const groupPartial = !groupSelected && ids.some(id => selectedIds.has(id));
                return (
                  <div key={equipment} className="rounded-md border overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/60 border-b">
                      <Checkbox
                        checked={groupPartial ? 'indeterminate' : groupSelected}
                        onCheckedChange={() => toggleGroup(ids)}
                        data-testid={`checkbox-group-${equipment}`}
                      />
                      <span className="text-xs font-semibold flex-1 truncate">{equipment}</span>
                      <span className="text-2xs text-muted-foreground shrink-0">
                        {rows.length} schedule{rows.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="divide-y">
                      {rows.map(t => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-secondary/40"
                        >
                          <Checkbox
                            checked={selectedIds.has(t.id)}
                            onCheckedChange={() => toggleOne(t.id)}
                            data-testid={`checkbox-schedule-${t.id}`}
                          />
                          <span className="flex-1 min-w-0 truncate text-muted-foreground">{t.category}</span>
                          <span className="shrink-0 text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {t.frequency}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 shrink-0">
              <span className="text-xs font-medium text-danger flex-1">
                {selectedIds.size} schedule{selectedIds.size > 1 ? 's' : ''} selected
              </span>
              <Button
                size="sm"
                className="h-7 px-3 text-xs gap-1.5 bg-danger text-danger-foreground hover:bg-danger/90"
                onClick={() => setBulkDeletePending(true)}
                disabled={bulkDeleting}
                data-testid="button-bulk-delete-schedules"
              >
                {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete selected
              </Button>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={onClose} disabled={bulkDeleting}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeletePending} onOpenChange={(o) => !o && setBulkDeletePending(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Delete {selectedIds.size} PMS schedule{selectedIds.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected schedules — every past and future occurrence and
              their checklist history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting} data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDelete}
              disabled={bulkDeleting}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {bulkDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
