/**
 * useROTrains.ts
 * Shared hook — replaces 19 duplicate from('ro_trains') calls across the app.
 *
 * STATUS (Section 9.3, master plan 2026-07-20): hook is fully written and
 * correct, but has zero imports — the refactor that was supposed to replace
 * the duplicate inline Supabase queries in ROTrains.tsx never happened.
 * Decision needed: wire this in (real dedup value, bigger lift) or delete it.
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
  status: 'Running' | 'Offline' | 'Maintenance';
  well_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useROTrains(plantId?: string | string[]) {
  const ids = plantId
    ? Array.isArray(plantId) ? plantId : [plantId]
    : null;

  return useQuery({
    queryKey: ['ro_trains', ids ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('ro_trains').select('*').order('name');
      if (ids?.length) q = (q as any).in('plant_id', ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ROTrain[];
    },
    staleTime: 10 * 60_000,
  });
}

export function useROTrainsForPlant(plantId: string | undefined) {
  return useROTrains(plantId ? [plantId] : undefined);
}
