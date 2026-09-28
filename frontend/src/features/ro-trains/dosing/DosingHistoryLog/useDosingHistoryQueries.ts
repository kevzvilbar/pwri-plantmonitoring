import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export function useDosingHistoryQueries(filterPlantId: string, from: string, to: string) {
  const qc = useQueryClient();

  const { data: logs, isLoading, error, refetch } = useQuery({
    queryKey: ['dosing-history', filterPlantId, from, to],
    queryFn: async () => {
      let q = supabase
        .from('chemical_dosing_logs')
        .select(`
          id,
          plant_id,
          log_datetime,
          chlorine_kg,
          smbs_kg,
          anti_scalant_l,
          soda_ash_kg,
          free_chlorine_reagent_pcs,
          product_water_free_cl_ppm,
          calculated_cost,
          recorded_by,
          created_at,
          has_items,
          chemical_dosing_items (
            id,
            catalog_id,
            chemical_name,
            entry_mode,
            entry_qty,
            entry_unit,
            factor_to_base,
            qty,
            qty_extra,
            extra_reason,
            unit,
            strength_pct,
            density_kg_per_l,
            product_kg,
            active_kg,
            unit_price,
            line_cost
          ),
          chemical_residual_samples (
            id,
            sample_index,
            sampling_point,
            point_role,
            method,
            parameter,
            residual_ppm,
            tested_at,
            reagent_qty
          )
        `)
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
      const { data } = await supabase
        .from('chemical_prices')
        .select('*')
        .lte('effective_date', today)
        .order('effective_date', { ascending: false });
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
