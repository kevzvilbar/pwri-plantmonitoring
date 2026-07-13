/**
 * useLocators.ts
 * Shared hook — replaces 22 duplicate from('locators') calls across the app.
 * Caches master data for 10 minutes; invalidated when plant changes.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Locator {
  id: string;
  name: string;
  plant_id: string;
  meter_type: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  geofence_radius_m: number | null;
  is_active: boolean;
  status: string | null;
  meter_size_mm: number | null;
}

export function useLocators(plantId?: string | string[]) {
  const ids = plantId
    ? Array.isArray(plantId) ? plantId : [plantId]
    : null;

  return useQuery({
    queryKey: ['locators', ids ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('locators').select('*').order('name');
      if (ids?.length) q = (q as any).in('plant_id', ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Locator[];
    },
    staleTime: 10 * 60_000,
  });
}

/** Filter to a single plant */
export function useLocatorsForPlant(plantId: string | undefined) {
  return useLocators(plantId ? [plantId] : undefined);
}
