import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

// ── Status helpers ────────────────────────────────────────────────────────────
// A plant is considered "online" when it has at least one reading in the last
// 2 hours, "stale" for 2-8 hours, and "offline" beyond that (or no data).
type StripStatus = 'online' | 'stale' | 'offline';

function statusFromLastDt(dt: string | null | undefined): StripStatus {
  if (!dt) return 'offline';
  const hoursAgo = (Date.now() - new Date(dt).getTime()) / 3_600_000;
  if (hoursAgo < 2)  return 'online';
  if (hoursAgo < 8)  return 'stale';
  return 'offline';
}

const DOT_CLS: Record<StripStatus, string> = {
  online:  'bg-emerald-500',
  stale:   'bg-amber-400',
  offline: 'bg-muted-foreground/30',
};

const PILL_CLS: Record<StripStatus, string> = {
  online:  'border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20',
  stale:   'border-amber-200/70  bg-amber-50/40  dark:border-amber-900/50  dark:bg-amber-950/20',
  offline: 'border-border/60 bg-muted/20',
};

interface Props {
  /** Plant IDs currently visible on the dashboard (respects global filter) */
  plantIds: string[];
}

export function PlantHealthStrip({ plantIds }: Props) {
  const { data: plants } = usePlants();

  // Latest well reading datetime per plant
  const { data: wellLastDt } = useQuery({
    queryKey: ['health-strip-wells', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return {} as Record<string, string>;
      const { data } = await supabase
        .from('well_readings')
        .select('plant_id, reading_datetime')
        .in('plant_id', plantIds)
        .order('reading_datetime', { ascending: false })
        .limit(500);
      const map: Record<string, string> = {};
      (data ?? []).forEach((r) => {
        if (!map[r.plant_id]) map[r.plant_id] = r.reading_datetime;
      });
      return map;
    },
    enabled: plantIds.length > 0,
    refetchInterval: 60_000,
    staleTime:       30_000,
  });

  // Latest locator reading datetime per plant
  const { data: locLastDt } = useQuery({
    queryKey: ['health-strip-locators', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return {} as Record<string, string>;
      const { data } = await supabase
        .from('locator_readings')
        .select('plant_id, reading_datetime')
        .in('plant_id', plantIds)
        .order('reading_datetime', { ascending: false })
        .limit(500);
      const map: Record<string, string> = {};
      (data ?? []).forEach((r) => {
        if (!map[r.plant_id]) map[r.plant_id] = r.reading_datetime;
      });
      return map;
    },
    enabled: plantIds.length > 0,
    refetchInterval: 60_000,
    staleTime:       30_000,
  });

  // Merge: most recent reading across both sources per plant
  const lastByPlant = useMemo(() => {
    const merged: Record<string, string | null> = {};
    plantIds.forEach((id) => {
      const w = wellLastDt?.[id] ?? null;
      const l = locLastDt?.[id]  ?? null;
      if (w && l) {
        merged[id] = new Date(w) > new Date(l) ? w : l;
      } else {
        merged[id] = w ?? l ?? null;
      }
    });
    return merged;
  }, [plantIds, wellLastDt, locLastDt]);

  const visiblePlants = useMemo(
    () => (plants ?? []).filter((p) => !plantIds.length || plantIds.includes(p.id)),
    [plants, plantIds],
  );

  if (!visiblePlants.length) return null;

  return (
    /* Outer: clips the scrollable area. The negative x-margin + matching
       padding lets the pills reach the screen edge on mobile without causing
       page-level overflow.  On sm+ there is enough room to wrap naturally. */
    <div
      className="overflow-x-auto -mx-1 px-1 pb-0.5 sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0"
      aria-label="Per-plant status strip"
    >
      <div className="flex items-center gap-1.5 sm:flex-wrap min-w-max sm:min-w-0">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mr-0.5 shrink-0">
          Plants
        </span>

        {visiblePlants.map((plant) => {
          const lastDt    = lastByPlant[plant.id] ?? null;
          const status    = statusFromLastDt(lastDt);
          const shortName = (plant as any).code ?? plant.name.split(' ')[0];

          return (
            <div
              key={plant.id}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] whitespace-nowrap select-none shrink-0',
                PILL_CLS[status],
              )}
              title={`${plant.name} · Last reading: ${lastDt ? new Date(lastDt).toLocaleString() : 'none'}`}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  DOT_CLS[status],
                  status === 'online' && 'animate-pulse',
                )}
              />
              <span className="font-medium">{shortName}</span>
              {lastDt ? (
                <span className="text-muted-foreground/60">
                  {formatDistanceToNow(new Date(lastDt), { addSuffix: false })} ago
                </span>
              ) : (
                <span className="text-muted-foreground/40">No data</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
