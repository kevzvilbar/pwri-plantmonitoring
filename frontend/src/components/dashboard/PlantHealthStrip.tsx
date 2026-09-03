import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';

import { Lamp, type LampTone } from '@/components/ui/Lamp';

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

function statusToLampTone(status: StripStatus): LampTone {
  switch (status) {
    case 'online':  return 'good';
    case 'stale':   return 'warn';
    case 'offline': return 'muted';
  }
}

interface Props {
  /** Plant IDs currently visible on the dashboard (respects global filter) */
  plantIds: string[];
  onSelectPlant?: (plantId: string) => void;
}

export function PlantHealthStrip({ plantIds, onSelectPlant }: Props) {
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
    // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s
    // global default, so the app-wide background-sync sweep force-refetched this
    // well before its own interval was due.
    staleTime: 60_000,
    refetchInterval: 60_000,
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
    // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s
    // global default, so the app-wide background-sync sweep force-refetched this
    // well before its own interval was due.
    staleTime: 60_000,
    refetchInterval: 60_000,
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
    <div
      className="overflow-x-auto -mx-1 px-1 py-1 sm:overflow-visible sm:mx-0 sm:px-0"
      aria-label="Per-plant status strip"
    >
      <div className="flex items-center gap-2 sm:flex-wrap min-w-max sm:min-w-0">
        <div className="flex items-center gap-1.5 text-2xs font-bold text-muted-foreground uppercase tracking-wider mr-1 shrink-0">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>Live Fleet</span>
        </div>

        {visiblePlants.map((plant) => {
          const lastDt    = lastByPlant[plant.id] ?? null;
          const status    = statusFromLastDt(lastDt);
          const shortName = (plant as any).code ?? plant.name.split(' ')[0];

          return (
            <div
              key={plant.id}
              onClick={() => onSelectPlant?.(plant.id)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap transition-all cursor-pointer select-none shrink-0',
                status === 'online' && 'bg-card border-border/80 text-foreground hover:border-primary/50',
                status === 'stale' && 'bg-warn-soft/30 border-warn/40 text-warn hover:border-warn',
                status === 'offline' && 'bg-muted/30 border-border/50 text-muted-foreground hover:border-border',
              )}
              title={`${plant.name} · Last reading: ${lastDt ? new Date(lastDt).toLocaleString() : 'none'}`}
            >
              <Lamp
                tone={statusToLampTone(status)}
                pulse={status === 'online'}
                size={7}
              />
              <span>{shortName}</span>
              {lastDt ? (
                <span className="text-2xs font-normal opacity-75 font-mono">
                  {formatDistanceToNow(new Date(lastDt), { addSuffix: false })}
                </span>
              ) : (
                <span className="text-2xs font-normal opacity-50 font-mono">Offline</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
