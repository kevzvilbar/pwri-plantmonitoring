/**
 * useROTrains.ts
 * Shared hook — replaces duplicate from('ro_trains') calls across the app.
 *
 * STATUS: wired into Overview.tsx and ROTrainsPage.tsx (2026-09-22, see
 * commit "fix(ro-trains): stop duplicate-fetching..."), plus the egress
 * pass that added this comment, which migrated every call site confirmed
 * to duplicate another site's exact column/filter shape (verified against
 * live PostgREST logs, not guessed). Sites with a genuinely different
 * shape (single-train lookups by id, mutations, one-off dialogs) were
 * deliberately left as direct supabase calls — forcing everything through
 * one hook only pays off where two or more call sites actually want the
 * same data.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ROTrain {
  id: string;
  name: string | null;
  plant_id: string;
  train_number: number;
  filter_housing_type: string | null;
  filter_media_type: string | null;
  num_afm: number;
  num_booster_pumps: number;
  num_cartridge_filters: number;
  num_controllers: number;
  num_filter_housings: number;
  num_hp_pumps: number;
  shared_power_meter_group: string | null;
  uses_em_meter: boolean;
  em_all_streams: boolean;
  em_stream_feed: boolean;
  em_stream_permeate: boolean;
  em_stream_reject: boolean;
  has_feed_meter: boolean;
  has_permeate_meter: boolean;
  has_reject_meter: boolean;
  unit_type: string;
  status: 'Running' | 'Offline' | 'Maintenance';
  well_id: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_TRAINS: ROTrain[] = [];

/**
 * Fetches ro_trains, optionally scoped to one or more plants.
 *
 * `plantId` semantics are deliberately different for `undefined` vs `[]`:
 *  - `undefined` (or omitted): no plant filter — every train the caller's
 *    RLS policy exposes. Used for "All plants" views.
 *  - `[]` (explicitly empty array): zero plants selected — returns `[]`
 *    without a network call. This matters because callers commonly derive
 *    the array from useVisiblePlants().visiblePlants, which is legitimately
 *    empty for a user with no plant assigned (see P5-1); without this
 *    distinction, an empty array was falling through the old `if (ids?.length)`
 *    guard and silently fetching every train system-wide — a scoping leak
 *    for exactly the user this hook should be showing the least to.
 */
export function useROTrains(plantId?: string | string[]) {
  const ids = plantId === undefined ? null : (Array.isArray(plantId) ? plantId : [plantId]);
  const isEmptySelection = ids !== null && ids.length === 0;

  return useQuery({
    queryKey: ['ro_trains', ids ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('ro_trains').select('*').order('name');
      if (ids?.length) q = (q as any).in('plant_id', ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ROTrain[];
    },
    enabled: !isEmptySelection,
    // No network call needed for an empty selection, but still resolve the
    // query to [] rather than leaving it perpetually in a disabled/no-data
    // state, since some callers read .data directly without checking enabled.
    initialData: isEmptySelection ? EMPTY_TRAINS : undefined,
    staleTime: 15 * 60_000,
  });
}

export function useROTrainsForPlant(plantId: string | undefined) {
  return useROTrains(plantId ? [plantId] : undefined);
}
