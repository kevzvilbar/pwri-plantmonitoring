import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, Circle, ListChecks } from 'lucide-react';
import { getCurrentShift } from '@/lib/shifts';
import { ensureLocators, ensureWells } from '@/lib/referenceData';
import { cn } from '@/lib/utils';

export type OperationTabKey = 'locator' | 'well' | 'product' | 'blending' | 'power';

export interface ShiftRoundProgressProps {
  plantId: string | null;
  activeTab: string;
  onSelectTab: (tab: OperationTabKey) => void;
}

export function ShiftRoundProgress({
  plantId,
  activeTab,
  onSelectTab,
}: ShiftRoundProgressProps) {
  const qc = useQueryClient();
  const shiftInfo = getCurrentShift();
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const startOfDayIso = todayDate.toISOString();
  const todayDateStr = startOfDayIso.split('T')[0];

  // 1. Fetch Locator stats for today
  const { data: locatorStats = { total: 0, completed: 0 } } = useQuery({
    queryKey: ['shift-round-locator-stats', plantId, todayDateStr],
    queryFn: async () => {
      if (!plantId) return { total: 0, completed: 0 };
      // Phase 1 (FREE-PLAN-BUDGET-PLAN): total from the shared catalog cache.
      const locators = await ensureLocators(qc, [plantId]);

      const total = locators.length;
      if (total === 0) return { total: 0, completed: 0 };

      const { data: readings } = await supabase
        .from('locator_readings')
        .select('locator_id')
        .eq('plant_id', plantId)
        .gte('reading_datetime', startOfDayIso);

      const uniqueLogged = new Set((readings ?? []).map((r) => r.locator_id)).size;
      return { total, completed: uniqueLogged };
    },
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  // 2. Fetch Well stats for today
  const { data: wellStats = { total: 0, completed: 0 } } = useQuery({
    queryKey: ['shift-round-well-stats', plantId, todayDateStr],
    queryFn: async () => {
      if (!plantId) return { total: 0, completed: 0 };
      const wells = await ensureWells(qc, [plantId]);

      const total = wells.length;
      if (total === 0) return { total: 0, completed: 0 };

      const { data: readings } = await supabase
        .from('well_readings')
        .select('well_id')
        .eq('plant_id', plantId)
        .gte('reading_datetime', startOfDayIso);

      const uniqueLogged = new Set((readings ?? []).map((r) => r.well_id)).size;
      return { total, completed: uniqueLogged };
    },
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  // 3. Fetch Product meter stats for today
  const { data: productStats = { total: 0, completed: 0 } } = useQuery({
    queryKey: ['shift-round-product-stats', plantId, todayDateStr],
    queryFn: async () => {
      if (!plantId) return { total: 0, completed: 0 };
      const { data: meters } = await supabase
        .from('product_meters')
        .select('id')
        .eq('plant_id', plantId);

      const total = meters?.length ?? 0;
      if (total === 0) return { total: 0, completed: 0 };

      const { data: readings } = await supabase
        .from('product_meter_readings')
        .select('meter_id')
        .eq('plant_id', plantId)
        .gte('reading_datetime', startOfDayIso);

      const uniqueLogged = new Set((readings ?? []).map((r) => r.meter_id)).size;
      return { total, completed: uniqueLogged };
    },
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  // 4. Fetch Blending log presence for today
  const { data: blendingDone = false } = useQuery({
    queryKey: ['shift-round-blending-stats', plantId, todayDateStr],
    queryFn: async () => {
      if (!plantId) return false;
      const { data } = await supabase
        .from('blending_events')
        .select('id')
        .eq('plant_id', plantId)
        .gte('event_date', todayDateStr)
        .limit(1);
      return Boolean(data && data.length > 0);
    },
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  // 5. Fetch Power log presence for today
  const { data: powerDone = false } = useQuery({
    queryKey: ['shift-round-power-stats', plantId, todayDateStr],
    queryFn: async () => {
      if (!plantId) return false;
      const { data } = await supabase
        .from('power_readings')
        .select('id')
        .eq('plant_id', plantId)
        .gte('reading_datetime', startOfDayIso)
        .limit(1);
      return Boolean(data && data.length > 0);
    },
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  if (!plantId) {
    return (
      <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/70 text-xs text-muted-foreground shadow-2xs">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <span>Select a plant to view today’s shift round checklist and walk-list progress.</span>
        </div>
      </div>
    );
  }

  const steps = [
    {
      key: 'locator' as const,
      label: 'Locators',
      done: locatorStats.total > 0 ? locatorStats.completed >= locatorStats.total : false,
      detail: locatorStats.total > 0 ? `${locatorStats.completed}/${locatorStats.total}` : 'No assets',
    },
    {
      key: 'well' as const,
      label: 'Wells',
      done: wellStats.total > 0 ? wellStats.completed >= wellStats.total : false,
      detail: wellStats.total > 0 ? `${wellStats.completed}/${wellStats.total}` : 'No assets',
    },
    {
      key: 'product' as const,
      label: 'Product',
      done: productStats.total > 0 ? productStats.completed >= productStats.total : false,
      detail: productStats.total > 0 ? `${productStats.completed}/${productStats.total}` : 'No assets',
    },
    {
      key: 'blending' as const,
      label: 'Blending',
      done: blendingDone,
      detail: blendingDone ? 'Logged' : 'Pending',
    },
    {
      key: 'power' as const,
      label: 'Power',
      done: powerDone,
      detail: powerDone ? 'Logged' : 'Pending',
    },
  ];

  const completedStepsCount = steps.filter((s) => s.done).length;
  const progressPercent = Math.round((completedStepsCount / steps.length) * 100);

  return (
    <section
      aria-label="Shift Round Progress"
      className="p-3.5 rounded-2xl bg-card border border-border/80 shadow-2xs space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wide">
                Shift Round Walk-List
              </h3>
              <span className="text-3xs px-2 py-0.5 rounded-full font-semibold bg-muted text-muted-foreground">
                {shiftInfo.name}
              </span>
            </div>
            <p className="text-2xs text-muted-foreground">
              {completedStepsCount} of {steps.length} sections logged ({progressPercent}%)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-label="Shift Round Completion"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="w-28 sm:w-36 h-2 rounded-full bg-muted overflow-hidden border border-border/50"
          >
            <div
              className={cn(
                'h-full transition-all duration-300',
                progressPercent === 100 ? 'bg-status-normal' : 'bg-primary',
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-2xs font-mono font-bold text-foreground min-w-[2.5rem] text-right">
            {progressPercent}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
        {steps.map((step) => {
          const isActive = activeTab === step.key;
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => onSelectTab(step.key)}
              className={cn(
                'flex items-center justify-between p-2 rounded-xl text-left border transition-all text-xs select-none',
                isActive
                  ? 'border-primary/60 bg-primary/5 shadow-2xs'
                  : 'border-border/60 bg-muted/30 hover:bg-muted/60 hover:border-border',
              )}
            >
              <div className="flex items-center gap-1.5 truncate">
                {step.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-status-normal shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                )}
                <span className={cn('font-semibold truncate', isActive ? 'text-primary' : 'text-foreground')}>
                  {step.label}
                </span>
              </div>
              <span className="text-3xs font-mono font-medium text-muted-foreground ml-1 shrink-0">
                {step.detail}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
