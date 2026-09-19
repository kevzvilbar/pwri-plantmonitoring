import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { useTabPersist } from '@/hooks/useTabPersist';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, ListChecks, Pencil, Trash2 } from 'lucide-react';
import { addDays, eachDayOfInterval, format, isSameDay, isSameMonth } from 'date-fns';
import { usePmsCalendarLogic, Legend, ChecklistDialog, EditTemplateDialog, DeleteTemplateAlert, ManageSchedulesDialog, STATUS_COLORS } from '.';
import type { DueItem } from './pmsTypes';

export function PmsCalendar() {
  const { isManager } = useAuth();
  const { view, cursor, setCursor, selected, setSelected,
    openItem, setOpenItem, editingTemplate, setEditingTemplate,
    deletingTemplate, setDeletingTemplate, manageOpen, setManageOpen,
    navUnit, headerTitle, days,
    goToday, goPrev, goNext, changeView,
    dueByDay, selectedItems, templates,
  } = usePmsCalendarLogic();

  const cellTone = (items: DueItem[]) => {
    const counts = { done: 0, pending: 0, backlog: 0, upcoming: 0 };
    items.forEach(i => counts[i.status]++);
    if (counts.backlog) return 'bg-danger/10 border-danger/30';
    if (counts.pending) return 'bg-warn/10 border-warn/30';
    if (counts.done && !counts.upcoming) return 'bg-accent/10 border-accent/30';
    return 'border-border';
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1 min-w-0">
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs shrink-0"
              onClick={goToday} data-testid="button-cal-today">Today</Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Previous ${navUnit}`}
              onClick={goPrev} data-testid="button-cal-prev"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Next ${navUnit}`}
              onClick={goNext} data-testid="button-cal-next"><ChevronRight className="h-4 w-4" /></Button>
            <div className="font-semibold text-sm truncate ml-1" data-testid="text-cal-header">{headerTitle}</div>
          </div>

          <div className="flex items-center gap-1.5">
            <Tabs value={view} onValueChange={(v) => changeView(v as typeof view)}>
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
                const MAX_VISIBLE = view === 'week' ? 6 : 3;
                const cellMinH = view === 'week' ? 'min-h-[110px] sm:min-h-[160px]' : 'min-h-[64px] sm:min-h-[88px]';
                const visible = items.slice(0, MAX_VISIBLE);
                const overflow = items.length - visible.length;
                return (
                  <button key={key} onClick={() => setSelected(day)} data-testid={`cell-day-${key}`}
                    className={[
                      cellMinH, 'rounded border text-left p-1 flex flex-col items-stretch',
                      'transition-colors hover:bg-accent/30',
                      inMonth ? 'opacity-100' : 'opacity-40',
                      cellTone(items),
                      isSelected ? 'ring-2 ring-primary' : '',
                      isToday ? 'font-bold' : '',
                    ].join(' ')}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs leading-none">{format(day, 'd')}</span>
                      {items.length > 0 && (
                        <span className="text-3xs leading-none text-muted-foreground sm:hidden">{items.length}</span>
                      )}
                    </div>
                    {items.length > 0 && (
                      <div className="mt-1 space-y-0.5 min-w-0 overflow-hidden">
                        {visible.map((it, i) => (
                          <div key={`${it.template.id}-${i}`}
                            className="flex items-center gap-1 min-w-0"
                            title={`${it.template.equipment_name} · ${it.template.category} · ${it.status}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[it.status]}`} />
                            <span className="truncate text-3xs sm:text-2xs leading-tight font-normal text-foreground/80">
                              {it.template.equipment_name}
                            </span>
                          </div>
                        ))}
                        {overflow > 0 && (
                          <div className="text-3xs sm:text-2xs leading-tight text-muted-foreground pl-2.5">
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
                <div key={`${it.template.id}-${i}`}
                  className="w-full flex items-center gap-1 text-xs rounded-md border hover:bg-secondary transition-colors"
                  data-testid={`row-due-${it.template.id}`}>
                  <button onClick={() => setOpenItem(it)}
                    className="flex-1 min-w-0 flex items-center gap-2 p-2 text-left">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[it.status]}`} />
                    <span className="font-medium truncate">{it.template.equipment_name}</span>
                    <span className="text-muted-foreground truncate hidden sm:inline">· {it.template.category}</span>
                    <span className="ml-auto text-2xs uppercase tracking-wide text-muted-foreground shrink-0">
                      {it.template.frequency} · {it.status}
                    </span>
                  </button>
                  {isManager && (
                    <div className="flex items-center gap-0.5 pr-1 shrink-0">
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
                        aria-label={`Edit ${it.template.equipment_name}`}
                        data-testid={`button-edit-${it.template.id}`}
                        onClick={(e) => { e.stopPropagation(); setEditingTemplate(it.template); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-danger hover:text-danger"
                        aria-label={`Delete ${it.template.equipment_name}`}
                        data-testid={`button-delete-${it.template.id}`}
                        onClick={(e) => { e.stopPropagation(); setDeletingTemplate(it.template); }}>
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
        <ChecklistDialog item={openItem} isManager={isManager}
          onClose={() => setOpenItem(null)}
          onEdit={(t) => { setOpenItem(null); setEditingTemplate(t); }}
          onDelete={(t) => { setOpenItem(null); setDeletingTemplate(t); }}
        />
      )}
      {editingTemplate && (
        <EditTemplateDialog template={editingTemplate} onClose={() => setEditingTemplate(null)} />
      )}
      {deletingTemplate && (
        <DeleteTemplateAlert template={deletingTemplate}
          onClose={() => setDeletingTemplate(null)}
          onDeleted={() => setDeletingTemplate(null)}
        />
      )}
      {manageOpen && (
        <ManageSchedulesDialog templates={templates ?? []} onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}
