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
  diameter: string | null;
  drilling_depth_m: number | null;
  gps_lat: number | null;
  gps_lng: number | null;
  has_power_meter: boolean;
  meter_brand: string | null;
  meter_size: string | null;
  meter_serial: string | null;
  meter_installed_date: string | null;
  size: string | null;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
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
