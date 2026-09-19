import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { useTabPersist } from '@/hooks/useTabPersist';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { addDays, addMonths, addWeeks, eachDayOfInterval, format, startOfDay } from 'date-fns';
import type { Template, CalendarView, DueItem } from './pmsTypes';
import { getGridRange, computeDueByDay, formatWeekRange } from './pmsTypes';

export type PmsCalendarLogic = {
  view: CalendarView;
  setView: (v: CalendarView) => void;
  cursor: Date;
  setCursor: (d: Date) => void;
  selected: Date | null;
  setSelected: (d: Date | null) => void;
  openItem: DueItem | null;
  setOpenItem: (i: DueItem | null) => void;
  editingTemplate: Template | null;
  setEditingTemplate: (t: Template | null) => void;
  deletingTemplate: Template | null;
  setDeletingTemplate: (t: Template | null) => void;
  manageOpen: boolean;
  setManageOpen: (b: boolean) => void;
  navUnit: 'month' | 'week' | 'day';
  headerTitle: string;
  days: Date[];
  goToday: () => void;
  goPrev: () => void;
  goNext: () => void;
  changeView: (v: CalendarView) => void;
  templates: Template[] | undefined;
  executions: { template_id: string; completed_at: string }[] | undefined;
  dueByDay: Map<string, DueItem[]>;
  selectedItems: DueItem[];
  isManager: boolean;
};

export function usePmsCalendarLogic(): PmsCalendarLogic {
  const { isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const [view, setView] = useTabPersist<CalendarView>('tab:maintenance-calendar-view', 'month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [openItem, setOpenItem] = useState<DueItem | null>(null);
  const [selected, setSelected] = useState<Date | null>(new Date());
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const { start: gridStart, end: gridEnd } = getGridRange(view, cursor);
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

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

  const dueByDay = useMemo(() => computeDueByDay(templates, executions, gridStart, gridEnd), [templates, executions, gridStart, gridEnd]);

  const selectedKey = selected ? format(selected, 'yyyy-MM-dd') : null;
  const selectedItems = selectedKey ? (dueByDay.get(selectedKey) ?? []) : [];

  return {
    view, setView, cursor, setCursor, selected, setSelected,
    openItem, setOpenItem, editingTemplate, setEditingTemplate,
    deletingTemplate, setDeletingTemplate, manageOpen, setManageOpen,
    navUnit, headerTitle, days,
    goToday, goPrev, goNext, changeView,
    templates, executions, dueByDay, selectedItems,
    isManager,
  };
}
