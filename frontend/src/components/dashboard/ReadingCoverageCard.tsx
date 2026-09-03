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
  label:    string;
  done:     number;
  total:    number;
  urgent:   boolean; // true → switch to the danger hue when below 50%
  colorVar: string;  // CSS custom property driving this row's stripe hue
}

// Diagonal "hazard tape" stripe pattern in a single hue — bright/dim bands of
// the same color so the texture reads on top of any surface underneath it.
function stripeImage(colorVar: string, baseAlpha: number) {
  const dimAlpha = Math.max(baseAlpha * 0.35, 0.05);
  return `repeating-linear-gradient(-45deg,
    hsl(var(${colorVar}) / ${baseAlpha}) 0px,
    hsl(var(${colorVar}) / ${baseAlpha}) 5px,
    hsl(var(${colorVar}) / ${dimAlpha}) 5px,
    hsl(var(${colorVar}) / ${dimAlpha}) 10px)`;
}

// Critically low + urgent rows escalate to the danger hue — the category
// color is an identity, not a replacement for the underlying safety signal.
function resolveRowColor(done: number, total: number, urgent: boolean, colorVar: string) {
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  const critical = urgent && pct < 50;
  return { pct, critical, activeVar: critical ? '--danger' : colorVar };
}

function CoverageBar({ done, total, urgent, colorVar }: { done: number; total: number; urgent: boolean; colorVar: string }) {
  const { pct, critical, activeVar } = resolveRowColor(done, total, urgent, colorVar);

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs text-muted-foreground">
          {done} <span className="text-muted-foreground/50">/ {total}</span>
        </span>
        <span className={cn('text-2xs font-medium', critical ? 'text-danger' : 'text-muted-foreground')}>
          {pct}%
        </span>
      </div>
      <div className="relative h-2.5 w-full rounded-full overflow-hidden bg-muted/40">
        {/* Empty capacity — same stripe texture, faded */}
        <div className="absolute inset-0" style={{ backgroundImage: stripeImage(activeVar, 0.18) }} />
        {/* Filled portion */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            backgroundImage: stripeImage(activeVar, 1),
            boxShadow: `0 2px 6px -1px hsl(var(${activeVar}) / 0.55)`,
          }}
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
    staleTime: 5 * 60_000,  // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s global default, so the app-wide background-sync sweep force-refetched this well before its own interval was due
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
    staleTime: 5 * 60_000,  // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s global default, so the app-wide background-sync sweep force-refetched this well before its own interval was due
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
    staleTime: 5 * 60_000,  // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s global default, so the app-wide background-sync sweep force-refetched this well before its own interval was due
    refetchInterval: 5 * 60_000,
    staleTime:       2 * 60_000,
  });

  const rows: CoverageRow[] = [
    { label: 'Wells',      done: wellDone,    total: wellTotal,    urgent: false, colorVar: '--kpi-wells'   },
    { label: 'Locators',   done: locDone,     total: locatorTotal, urgent: false, colorVar: '--kpi-locator' },
    { label: 'RO Trains',  done: trainDone,   total: trainTotal,   urgent: true,  colorVar: '--kpi-ro'      },
  ];

  const anyMissing = rows.some((r) => r.done < r.total);

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-info shrink-0" aria-hidden />
        <span className="text-xs font-medium">Today's coverage</span>
        {anyMissing && (
          <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/70 text-2xs font-medium">
            Gaps
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const { activeVar } = resolveRowColor(r.done, r.total, r.urgent, r.colorVar);
          return (
            <div key={r.label}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: `hsl(var(${activeVar}))` }} />
                <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                  {r.label}
                </span>
              </div>
              <CoverageBar done={r.done} total={r.total} urgent={r.urgent} colorVar={r.colorVar} />
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-0.5 border-t border-border/40">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-muted-foreground"
          onClick={() => navigate('/operations')}
        >
          Log missing readings →
        </Button>
      </div>
    </Card>
  );
}
