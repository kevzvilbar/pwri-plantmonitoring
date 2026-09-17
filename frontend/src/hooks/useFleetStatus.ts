// Shared fleet telemetry — single source of truth for PlantPulseHero lamps
// and PlantHealthStrip chips.
//
// Previously Hero queried `well_readings` (limit 300, wells-only) while the
// Strip merged wells + locators, so the two counts on the same page could
// disagree (e.g. online 5 vs 4). Both now consume this hook: one TanStack
// query key, one merged wells+locators snapshot, one 5-min cadence.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type FleetStatus = 'online' | 'stale' | 'offline';

// Online < 2h since last reading · stale 2–8h · offline beyond that / no data.
export function statusFromLastDt(dt: string | null | undefined): FleetStatus {
  if (!dt) return 'offline';
  const hoursAgo = (Date.now() - new Date(dt).getTime()) / 3_600_000;
  if (hoursAgo < 2) return 'online';
  if (hoursAgo < 8) return 'stale';
  return 'offline';
}

async function fetchLatestByPlant(
  table: 'well_readings' | 'locator_readings',
  plantIds: string[],
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from(table)
    .select('plant_id, reading_datetime')
    .in('plant_id', plantIds)
    .order('reading_datetime', { ascending: false })
    .limit(Math.max(10, plantIds.length * 3));
  const map: Record<string, string> = {};
  (data ?? []).forEach((r: { plant_id: string; reading_datetime: string }) => {
    if (!map[r.plant_id]) map[r.plant_id] = r.reading_datetime;
  });
  return map;
}

export interface FleetSnapshot {
  /** Most recent reading datetime (wells ∪ locators) per plant. */
  lastByPlant: Record<string, string | null>;
  counts: { online: number; stale: number; offline: number };
  statusOf: (plantId: string) => FleetStatus;
}

export function useFleetStatus(plantIds: string[]): FleetSnapshot {
  // TanStack key must be referentially stable: callers derive plantIds from
  // filtered arrays that re-allocate every render. Join to a sorted string.
  const plantKey = useMemo(() => [...plantIds].sort().join(','), [plantIds]);
  const stableIds = useMemo(() => (plantKey ? plantKey.split(',') : []), [plantKey]);

  const { data } = useQuery({
    queryKey: ['fleet-status', plantKey],
    queryFn: async () => {
      if (!stableIds.length) return {} as Record<string, string | null>;
      const [wells, locators] = await Promise.all([
        fetchLatestByPlant('well_readings', stableIds),
        fetchLatestByPlant('locator_readings', stableIds),
      ]);
      const merged: Record<string, string | null> = {};
      stableIds.forEach((id) => {
        const w = wells[id] ?? null;
        const l = locators[id] ?? null;
        merged[id] = w && l ? (new Date(w) > new Date(l) ? w : l) : (w ?? l ?? null);
      });
      return merged;
    },
    enabled: stableIds.length > 0,
    // 5-min cadence matches the old strip; hero's 60s poll was pure egress.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return useMemo(() => {
    const lastByPlant: Record<string, string | null> = {};
    let online = 0;
    let stale = 0;
    let offline = 0;
    stableIds.forEach((id) => {
      const dt = data?.[id] ?? null;
      lastByPlant[id] = dt;
      const s = statusFromLastDt(dt);
      if (s === 'online') online++;
      else if (s === 'stale') stale++;
      else offline++;
    });
    return {
      lastByPlant,
      counts: { online, stale, offline },
      statusOf: (plantId: string) => statusFromLastDt(lastByPlant[plantId] ?? null),
    };
  }, [data, stableIds]);
}
