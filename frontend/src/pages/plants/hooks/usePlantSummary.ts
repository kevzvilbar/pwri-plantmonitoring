import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { STALE_READING_HOURS } from '@/lib/format';

export type SummaryCounts = {
  wells: Record<string, { active: number; total: number }>;
  locators: Record<string, { active: number; total: number }>;
  trains: Record<string, { active: number; total: number }>;
};

export function usePlantSummary() {
  return useQuery<SummaryCounts>({
    queryKey: ['plants-summary-counts'],
    queryFn: async () => {
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      const staleCutoff = new Date(Date.now() - STALE_READING_HOURS * 60 * 60 * 1000).toISOString();

      const [
        wellsRes, locatorsRes, trainsRes, recentReadingsRes,
        wellLatestRes, locatorLatestRes,
      ] = await Promise.all([
        supabase.from('wells').select('id, plant_id, status'),
        supabase.from('locators').select('id, plant_id, status'),
        supabase.from('ro_trains').select('id, plant_id, status'),
        supabase.from('ro_train_readings')
          .select('train_id')
          .gte('reading_datetime', twoHoursAgo),
        (supabase.from('well_readings_latest' as any) as any).select('well_id, reading_datetime'),
        (supabase.from('locator_readings_latest' as any) as any).select('locator_id, reading_datetime'),
      ]);

      const recentSet = new Set((recentReadingsRes.data ?? []).map((r: any) => r.train_id));

      const wellLatest    = (wellLatestRes.data    ?? []) as { well_id: string; reading_datetime: string }[];
      const locatorLatest = (locatorLatestRes.data ?? []) as { locator_id: string; reading_datetime: string }[];

      const freshWellSet = new Set(
        wellLatest.filter((r) => r.reading_datetime >= staleCutoff).map((r) => r.well_id),
      );
      const freshLocatorSet = new Set(
        locatorLatest.filter((r) => r.reading_datetime >= staleCutoff).map((r) => r.locator_id),
      );

      type Summary = Record<string, { active: number; total: number }>;
      const tally = (
        rows: { id: string; plant_id: string; status: string }[],
        freshSet: Set<string>,
      ): Summary => {
        const out: Summary = {};
        rows.forEach((r) => {
          if (!out[r.plant_id]) out[r.plant_id] = { active: 0, total: 0 };
          out[r.plant_id].total++;
          if (r.status === 'Active' && freshSet.has(r.id)) out[r.plant_id].active++;
        });
        return out;
      };

      const trainTally: Summary = {};
      for (const t of (trainsRes.data ?? []) as any[]) {
        if (!trainTally[t.plant_id]) trainTally[t.plant_id] = { active: 0, total: 0 };
        trainTally[t.plant_id].total++;
        const isRunning = t.status !== 'Maintenance' && recentSet.has(t.id);
        if (isRunning) trainTally[t.plant_id].active++;
      }

      return {
        wells:    tally(wellsRes.data    ?? [], freshWellSet),
        locators: tally(locatorsRes.data ?? [], freshLocatorSet),
        trains:   trainTally,
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
