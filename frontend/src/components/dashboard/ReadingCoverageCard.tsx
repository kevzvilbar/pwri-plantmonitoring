import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClipboardCheck } from 'lucide-react';
import { format, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

interface CoverageRow {
  label:   string;
  done:    number;
  total:   number;
  urgent:  boolean; // true → show red bar when below 50%
}

function CoverageBar({ done, total, urgent }: { done: number; total: number; urgent: boolean }) {
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
  const isLow  = pct < 50;
  const barCls = urgent && isLow ? 'bg-rose-500' : pct < 80 ? 'bg-amber-400' : 'bg-emerald-500';

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[11px] text-muted-foreground">
          {done} <span className="text-muted-foreground/50">/ {total}</span>
        </span>
        <span className={cn('text-[10px] font-medium', isLow && urgent ? 'text-rose-600' : 'text-muted-foreground')}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barCls)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  plantIds: string[];
}

export function ReadingCoverageCard({ plantIds }: Props) {
  const navigate = useNavigate();
  const todayStart = useMemo(
    () => format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm:ss"),
    [],
  );

  // ── Entity totals ──────────────────────────────────────────────────────────
  const { data: wellTotal = 0 } = useQuery({
    queryKey: ['coverage-wells-total', plantIds],
    queryFn: async () => {
      let q = supabase.from('wells').select('id', { count: 'exact', head: true }).eq('status', 'Active');
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { count } = await q;
      return count ?? 0;
    },
    staleTime: 5 * 60_000,
  });

  const { data: locatorTotal = 0 } = useQuery({
    queryKey: ['coverage-locators-total', plantIds],
    queryFn: async () => {
      let q = supabase.from('locators').select('id', { count: 'exact', head: true }).eq('status', 'Active');
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { count } = await q;
      return count ?? 0;
    },
    staleTime: 5 * 60_000,
  });

  const { data: trainTotal = 0 } = useQuery({
    queryKey: ['coverage-trains-total', plantIds],
    queryFn: async () => {
      let q = supabase.from('ro_trains').select('id', { count: 'exact', head: true });
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { count } = await q;
      return count ?? 0;
    },
    staleTime: 5 * 60_000,
  });

  // ── Today's readings count ─────────────────────────────────────────────────
  const { data: wellDone = 0 } = useQuery({
    queryKey: ['coverage-wells-done', plantIds, todayStart],
    queryFn: async () => {
      let q = supabase
        .from('well_readings')
        .select('well_id', { count: 'exact', head: false })
        .gte('reading_datetime', todayStart);
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { data } = await q;
      // Distinct wells
      return new Set((data ?? []).map((r: any) => r.well_id)).size;
    },
    refetchInterval: 5 * 60_000,
    staleTime:       2 * 60_000,
  });

  const { data: locDone = 0 } = useQuery({
    queryKey: ['coverage-locators-done', plantIds, todayStart],
    queryFn: async () => {
      let q = supabase
        .from('locator_readings')
        .select('locator_id', { count: 'exact', head: false })
        .gte('reading_datetime', todayStart);
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { data } = await q;
      return new Set((data ?? []).map((r: any) => r.locator_id)).size;
    },
    refetchInterval: 5 * 60_000,
    staleTime:       2 * 60_000,
  });

  const { data: trainDone = 0 } = useQuery({
    queryKey: ['coverage-trains-done', plantIds, todayStart],
    queryFn: async () => {
      let q = supabase
        .from('ro_train_readings')
        .select('train_id', { count: 'exact', head: false })
        .gte('reading_datetime', todayStart);
      if (plantIds.length) q = q.in('plant_id', plantIds);
      const { data } = await q;
      return new Set((data ?? []).map((r: any) => r.train_id)).size;
    },
    refetchInterval: 5 * 60_000,
    staleTime:       2 * 60_000,
  });

  const rows: CoverageRow[] = [
    { label: 'Wells',      done: wellDone,    total: wellTotal,    urgent: false },
    { label: 'Locators',   done: locDone,     total: locatorTotal, urgent: false },
    { label: 'RO Trains',  done: trainDone,   total: trainTotal,   urgent: true  },
  ];

  const anyMissing = rows.some((r) => r.done < r.total);

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-info shrink-0" aria-hidden />
        <span className="text-[12px] font-medium">Today's coverage</span>
        {anyMissing && (
          <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/70 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40 text-[10px] font-medium">
            Gaps
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label}>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {r.label}
            </span>
            <CoverageBar done={r.done} total={r.total} urgent={r.urgent} />
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-0.5 border-t border-border/40">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-[11px] text-muted-foreground"
          onClick={() => navigate('/operations')}
        >
          Log missing readings →
        </Button>
      </div>
    </Card>
  );
}
