import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wrench, Clock } from 'lucide-react';
import { addDays, differenceInDays, parseISO, format } from 'date-fns';
import { usePlants } from '@/hooks/usePlants';
import { cn } from '@/lib/utils';

// ── Frequency → interval days ─────────────────────────────────────────────────
const FREQ_DAYS: Record<string, number> = {
  Daily:     1,
  Weekly:    7,
  Monthly:   30,
  Quarterly: 90,
  Yearly:    365,
};

// Number of days ahead to look for upcoming tasks
const LOOKAHEAD_DAYS = 14;
// Maximum items to display
const MAX_ITEMS = 3;

interface PMItem {
  templateId:   string;
  plantName:    string;
  equipment:    string;
  category:     string;
  nextDue:      Date;
  daysUntilDue: number;
}

function urgencyLabel(days: number): string {
  if (days < 0)  return 'Overdue';
  if (days === 0) return 'Due today';
  return `${days}d`;
}

function urgencyPillCls(days: number): string {
  if (days < 0)   return 'bg-danger-soft text-danger border border-danger/20';
  if (days <= 3)  return 'bg-warn-soft  text-warn-foreground border border-warn/20';
  return 'bg-info-soft text-info border border-info/20';
}

function urgencyIconCls(days: number): string {
  if (days < 0)  return 'text-danger';
  if (days <= 3) return 'text-warn';
  return 'text-info';
}

interface Props {
  plantIds: string[];
}

export function PMDueSoonCard({ plantIds }: Props) {
  const navigate = useNavigate();
  const { data: plants } = usePlants();

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, (p as any).code ?? p.name));
    return m;
  }, [plants]);

  // PERF FIX: Add .limit() to avoid loading unnecessary template records.
  // Only fetch the most recently modified templates since we only display top 3.
  // Fetch slightly more (MAX_ITEMS * 5) to account for filtering by date range.
  const { data: templates } = useQuery({
    queryKey: ['pm-templates', plantIds],
    queryFn: async () => {
      let q = supabase
        .from('checklist_templates')
        .select('id, plant_id, equipment_name, frequency, category, schedule_start_date')
        .order('updated_at', { ascending: false })
        .limit(MAX_ITEMS * 5);  // PERF: Limit query to ~15 records instead of all
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { data } = await q;
      return data ?? [];
    },
    staleTime: 10 * 60_000,
  });

  const templateIds = useMemo(
    () => (templates ?? []).map((t: any) => t.id),
    [templates],
  );

  // Fetch most-recent execution per template
  const { data: latestExecs } = useQuery({
    queryKey: ['pm-latest-execs', templateIds],
    queryFn: async () => {
      if (!templateIds.length) return [];
      const { data } = await supabase
        .from('checklist_executions')
        .select('template_id, execution_date')
        .in('template_id', templateIds)
        .order('execution_date', { ascending: false });
      return data ?? [];
    },
    enabled: templateIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Map templateId → most recent execution_date
  const lastDoneByTemplate = useMemo(() => {
    const m = new Map<string, string>();
    (latestExecs ?? []).forEach((e: any) => {
      if (!m.has(e.template_id)) m.set(e.template_id, e.execution_date);
    });
    return m;
  }, [latestExecs]);

  // Compute next-due date and filter to window
  const items: PMItem[] = useMemo(() => {
    const today    = new Date();
    const cutoff   = addDays(today, LOOKAHEAD_DAYS);
    const results: PMItem[] = [];

    (templates ?? []).forEach((t: any) => {
      const freqDays = FREQ_DAYS[t.frequency as string] ?? 30;
      const lastDone = lastDoneByTemplate.get(t.id);

      let nextDue: Date;
      if (lastDone) {
        nextDue = addDays(parseISO(lastDone), freqDays);
      } else if (t.schedule_start_date) {
        nextDue = parseISO(t.schedule_start_date);
      } else {
        return; // no reference date — skip
      }

      const daysUntilDue = differenceInDays(nextDue, today);

      // Include overdue + due within lookahead
      if (daysUntilDue <= LOOKAHEAD_DAYS) {
        results.push({
          templateId:   t.id,
          plantName:    plantNameById.get(t.plant_id) ?? '?',
          equipment:    t.equipment_name ?? 'Equipment',
          category:     t.category ?? '',
          nextDue,
          daysUntilDue,
        });
      }
    });

    // Sort: overdue first (most overdue → least), then soonest
    return results
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
      .slice(0, MAX_ITEMS);
  }, [templates, lastDoneByTemplate, plantNameById]);

  if (!items.length) {
    return (
      <Card className="p-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Wrench className="h-4 w-4 shrink-0" aria-hidden />
        No PM tasks due in the next {LOOKAHEAD_DAYS} days.
      </Card>
    );
  }

  return (
    <Card className="p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        <span className="text-[12px] font-medium">PM due soon</span>
        <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full bg-warn-soft text-warn-foreground border border-warn/20 text-[10px] font-medium">
          {items.length} item{items.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Item list */}
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.templateId}
            className="flex items-center gap-2.5 p-2 rounded-md bg-muted/30 border border-border/40"
          >
            {/* Clock icon */}
            <div
              className={cn(
                'h-7 w-7 rounded-md flex items-center justify-center shrink-0',
                item.daysUntilDue < 0
                  ? 'bg-danger-soft'
                  : item.daysUntilDue <= 3
                    ? 'bg-warn-soft'
                    : 'bg-info-soft',
              )}
            >
              <Clock
                className={cn('h-3.5 w-3.5', urgencyIconCls(item.daysUntilDue))}
                aria-hidden
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium truncate">
                <span className="text-muted-foreground/70 mr-1">{item.plantName} ·</span>
                {item.equipment}
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                {item.category}
                {item.category && ' · '}
                {item.daysUntilDue < 0
                  ? `Overdue since ${format(item.nextDue, 'MMM d')}`
                  : `Due ${format(item.nextDue, 'MMM d')}`}
              </div>
            </div>

            {/* Urgency badge */}
            <span
              className={cn(
                'shrink-0 px-1.5 py-0.5 rounded-full text-[9.5px] font-semibold',
                urgencyPillCls(item.daysUntilDue),
              )}
            >
              {urgencyLabel(item.daysUntilDue)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-0.5 border-t border-border/40">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-[11px] text-muted-foreground"
          onClick={() => navigate('/maintenance')}
        >
          Full PM schedule →
        </Button>
      </div>
    </Card>
  );
}
