/**
 * useROTrains.ts
 * Shared hook — replaces 19 duplicate from('ro_trains') calls across the app.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ROTrain {
  id: string;
  name: string;
  plant_id: string;
  train_number: number | null;
  design_capacity_m3d: number | null;
  membrane_type: string | null;
  num_vessels: number | null;
  elements_per_vessel: number | null;
  is_active: boolean;
  status: string | null;
  well_id: string | null;
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
