/**
 * useWells.ts
 * Shared hook — replaces 27 duplicate from('wells') calls across the app.
 *
 * STATUS (Section 9.3, master plan 2026-07-20): hook is fully written and
 * correct, but has zero imports — the refactor that was supposed to replace
 * the duplicate inline Supabase queries in WellSection.tsx never happened.
 * Decision needed: either wire this in (real dedup value, bigger lift) or
 * delete it (abandoned plan). Do not silently leave it indefinitely.
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
  meter_multiplier: number;
  multiplier_enabled: boolean;
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
      // Explicit column list (matches Well interface) — avoids select=* egress overhead.
      // If you add a field to the Well interface, add it here too.
      let q = supabase
        .from('wells')
        .select(
          'id, name, plant_id, diameter, drilling_depth_m, gps_lat, gps_lng, has_power_meter, meter_brand, meter_size, meter_serial, meter_installed_date, size, status, meter_multiplier, multiplier_enabled, created_at, updated_at',
        )
        .order('name');
      if (ids?.length) q = (q as any).in('plant_id', ids);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Well[];
    },
    staleTime: 30 * 60_000,
  });
}

export function useWellsForPlant(plantId: string | undefined) {
  return useWells(plantId ? [plantId] : undefined);
}
