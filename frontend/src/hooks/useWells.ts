/**
 * useWells.ts
 * Shared hook — replaces 27 duplicate from('wells') calls across the app.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Well {
  id: string;
  name: string;
  plant_id: string;
  well_type: string | null;
  depth_m: number | null;
  pump_capacity_m3h: number | null;
  gps_lat: number | null;
  gps_lng: number | null;
  is_active: boolean;
  status: string | null;
  has_dedicated_power_meter: boolean | null;
  power_meter_group: string | null;
}

export function useWells(plantId?: string | string[]) {
  const ids = plantId
    ? Array.isArray(plantId) ? plantId : [plantId]
    : null;

  return useQuery({
    queryKey: ['wells', ids ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('wells').select('*').order('name');
      if (ids?.length) q = (q as any).in('plant_id', ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Well[];
    },
    staleTime: 10 * 60_000,
  });
}

export function useWellsForPlant(plantId: string | undefined) {
  return useWells(plantId ? [plantId] : undefined);
}
