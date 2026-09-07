import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { format } from 'date-fns';
import { DOSING_KEYS } from '../../../ro-trains/constants';

export function useDosingHistoryQueries(filterPlantId: string, from: string, to: string) {
  const qc = useQueryClient();

  const { data: logs, isLoading, error, refetch } = useQuery({
    queryKey: ['dosing-history', filterPlantId, from, to],
    queryFn: async () => {
      let q = supabase
        .from('chemical_dosing_logs')
        .select('id, plant_id, log_datetime, chlorine_kg, smbs_kg, anti_scalant_l, soda_ash_kg, free_chlorine_reagent_pcs, product_water_free_cl_ppm, calculated_cost, recorded_by, created_at')
        .order('log_datetime', { ascending: false })
        .limit(200);
      if (filterPlantId) q = q.eq('plant_id', filterPlantId);
      if (from) q = q.gte('log_datetime', from);
      if (to)   q = q.lte('log_datetime', to);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: prices } = useQuery({
    queryKey: ['chem-current-prices'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase.from('chemical_prices').select('*').lte('effective_date', today).order('effective_date', { ascending: false });
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        const fullName = p.chemical_name as string;
        if (!(fullName in map)) map[fullName] = p.unit_price;
        const baseName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(baseName in map)) map[baseName] = p.unit_price;
      });
      return map;
    },
  });

  return { logs, isLoading, error, refetch, prices, qc };
}
