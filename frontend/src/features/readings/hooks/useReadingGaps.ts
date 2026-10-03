import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { STALE_READING_HOURS } from '@/lib/format';
import { ensureLocators, ensureWells } from '@/lib/referenceData';

/**
 * Detects Active wells/locators with no reading in > STALE_READING_HOURS
 * (48h — the same cutoff WellsList.tsx/LocatorsList.tsx's per-row "Last
 * reading" badge turns 'danger' at, via lib/format.ts's
 * lastReadingFreshness) so the notification bell and the list-page badges
 * always agree on what counts as stale.
 *
 * Unlike useTrainAutoOffline, this hook is read-only — it never writes
 * `status`. Wells/locators only surface in their reading-entry forms
 * (WellSection.tsx, LocatorSection.tsx) while status='Active', so an
 * auto-flip to 'Inactive' on a data gap would hide the very entity an
 * operator needs to log a catch-up reading for. Silence is surfaced as an
 * alert instead, exactly like the "Umapad has had no data for days but
 * still shows Active" report this was written for — the fix is telling
 * someone, not quietly relabeling the equipment.
 */
export interface ReadingGap {
  entity_id: string;
  entity_name: string;
  plant_id: string;
  last_reading_at: string | null;
  hours_gap: number;
}

/**
 * Human-readable "no reading in ..." text for a ReadingGap, shared by
 * useDashboardAlerts.ts's well/locator gap alerts. Pulled out here (rather
 * than left inline where it's consumed) so it's unit-testable on its own —
 * it previously rendered the literal string "Infinityd" for an entity with
 * `last_reading_at === null` (never read even once, so hours_gap comes
 * through as Infinity above), since `(Infinity / 24).toFixed(0)` stringifies
 * to "Infinity", not a bounded number.
 */
export function gapDescription(g: Pick<ReadingGap, 'last_reading_at' | 'hours_gap'>): string {
  if (g.last_reading_at == null) {
    return 'No reading has ever been logged — check the meter/connectivity or log a reading';
  }
  const days = (g.hours_gap / 24).toFixed(g.hours_gap >= 24 ? 0 : 1);
  return `No reading in ${days}d — check the meter/connectivity or log a reading`;
}

type EntityKind = 'well' | 'locator';

const LATEST_VIEW: Record<EntityKind, 'well_readings_latest' | 'locator_readings_latest'> = {
  well: 'well_readings_latest',
  locator: 'locator_readings_latest',
};
const ID_COL: Record<EntityKind, 'well_id' | 'locator_id'> = {
  well: 'well_id',
  locator: 'locator_id',
};

async function fetchReadingGaps(qc: QueryClient, kind: EntityKind, plantIds: string[]): Promise<ReadingGap[]> {
  if (!plantIds.length) return [];

  // Only Active (commissioned) entities can go "stale" in a way anyone
  // should be alerted about — a decommissioned well/locator is expected to
  // have gone quiet, and isn't shown in the reading-entry form anyway.
  //
  // Phase 1 (FREE-PLAN-BUDGET-PLAN): the entity list comes from the shared
  // ['wells'|'locators', ids] cache (filtered to Active here) instead of a private
  // request — the live logs showed this exact URL fetched 7x/hour.
  const all = kind === 'well'
    ? await ensureWells(qc, plantIds)
    : await ensureLocators(qc, plantIds);
  const entities = all.filter((e) => e.status === 'Active');
  if (!entities.length) return [];

  const idCol = ID_COL[kind];
  const { data: latest, error: latestErr } = await (supabase.from(LATEST_VIEW[kind] as any) as any)
    .select(`${idCol},reading_datetime`)
    .in('plant_id', plantIds);
  if (latestErr) throw latestErr;

  const lastByEntity = new Map<string, string>();
  (latest ?? []).forEach((r: any) => { lastByEntity.set(r[idCol], r.reading_datetime); });

  const now = Date.now();
  return entities
    .map((e) => {
      const last = lastByEntity.get(e.id) ?? null;
      const hours = last ? (now - new Date(last).getTime()) / 3_600_000 : Infinity;
      return {
        entity_id: e.id, entity_name: e.name, plant_id: e.plant_id,
        last_reading_at: last, hours_gap: hours,
      };
    })
    .filter((g) => g.hours_gap > STALE_READING_HOURS);
}

export function useReadingGaps(plantIds: string[]) {
  const qc = useQueryClient();
  const { data: wellGaps } = useQuery({
    queryKey: ['well-reading-gaps', plantIds],
    queryFn: () => fetchReadingGaps(qc, 'well', plantIds),
    enabled: plantIds.length > 0,
    // FIX (egress): covered by realtime cache invalidation
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  const { data: locatorGaps } = useQuery({
    queryKey: ['locator-reading-gaps', plantIds],
    queryFn: () => fetchReadingGaps(qc, 'locator', plantIds),
    enabled: plantIds.length > 0,
    // FIX (egress): covered by realtime cache invalidation
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  return { wellGaps: wellGaps ?? [], locatorGaps: locatorGaps ?? [] };
}
