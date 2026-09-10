import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface ProductionCostRow {
  chem_cost: number | null;
  power_cost: number | null;
  total_cost: number | null;
  plant_id: string;
  cost_date: string;
}

export interface UseCostStatsParams {
  plantIds: string[];
  todayPowerCostPeso: number | null;
}

export function useCostStats({
  plantIds,
  todayPowerCostPeso,
}: UseCostStatsParams) {
  const { data: todayCostsRaw } = useQuery({
    queryKey: ['dash-costs-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return {
        rows: [] as ProductionCostRow[],
        costDataDate: null as string | null,
        tariffByPlant: new Map<string, number>(),
        dashDosingPeso: 0,
      };
      const todayStr = format(new Date(), 'yyyy-MM-dd');

      const [prodCostRes, tariffRes, dosingRes, pricesRes] = await Promise.all([
        supabase.from('production_costs')
          .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
          .in('plant_id', plantIds)
          .eq('cost_date', todayStr),
        supabase.from('power_tariffs')
          .select('plant_id,effective_date,rate_per_kwh')
          .in('plant_id', plantIds)
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
        supabase.from('chemical_dosing_logs')
          .select('log_datetime,calculated_cost,plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg')
          .in('plant_id', plantIds)
          .gte('log_datetime', new Date(todayStr + 'T00:00:00').toISOString())
          .lte('log_datetime', new Date(todayStr + 'T23:59:59').toISOString()),
        supabase.from('chemical_prices')
          .select('chemical_name,unit_price')
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
      ]);
      if (prodCostRes.error) throw prodCostRes.error;
      if (tariffRes.error) throw tariffRes.error;
      if (dosingRes.error) throw dosingRes.error;
      if (pricesRes.error) throw pricesRes.error;

      const tariffByPlant = new Map<string, number>();
      for (const t of tariffRes.data ?? []) {
        if (!tariffByPlant.has(t.plant_id)) tariffByPlant.set(t.plant_id, +t.rate_per_kwh);
      }

      const priceMap: Record<string, number> = {};
      for (const p of pricesRes.data ?? []) {
        if (!(p.chemical_name in priceMap)) priceMap[p.chemical_name] = +p.unit_price;
        const base = (p.chemical_name as string).replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(base in priceMap)) priceMap[base] = +p.unit_price;
      }
      const DOSING_KEYS = [
        { key: 'chlorine_kg',    name: 'Chlorine'     },
        { key: 'smbs_kg',        name: 'SMBS'         },
        { key: 'anti_scalant_l', name: 'Anti Scalant' },
        { key: 'soda_ash_kg',    name: 'Soda Ash'     },
      ] as const;
      let dashDosingPeso = 0;
      for (const r of dosingRes.data ?? []) {
        const stored = +(r.calculated_cost ?? 0);
        const live   = DOSING_KEYS.reduce((s, c) => s + (+r[c.key] || 0) * (priceMap[c.name] ?? 0), 0);
        dashDosingPeso += stored > 0 ? stored : live;
      }

      if ((prodCostRes.data ?? []).length) {
        return { rows: prodCostRes.data!, costDataDate: todayStr, tariffByPlant, dashDosingPeso };
      }

      const { data: recent, error: recentErr } = await supabase
        .from('production_costs')
        .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
        .in('plant_id', plantIds)
        .order('cost_date', { ascending: false })
        .limit(plantIds.length * 3);
      if (recentErr) throw recentErr;
      const latestByPlant = new Map<string, ProductionCostRow>();
      (recent ?? []).forEach((r) => {
        if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r);
      });
      const rows = Array.from(latestByPlant.values());
      return { rows, costDataDate: rows[0]?.cost_date ?? null, tariffByPlant, dashDosingPeso };
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const todayCosts        = todayCostsRaw?.rows ?? [];
  const costDataDate      = todayCostsRaw?.costDataDate ?? null;
  const costIsStale       = costDataDate != null && costDataDate !== format(new Date(), 'yyyy-MM-dd');
  const dashTariffByPlant = todayCostsRaw?.tariffByPlant ?? new Map<string, number>();
  const dashDosingPeso    = todayCostsRaw?.dashDosingPeso ?? 0;

  // Aggregates
  const hasCostData = (todayCosts ?? []).length > 0;

  const prodCostsChem = costIsStale
    ? 0
    : (todayCosts ?? []).reduce((s, r) => s + (Number(r.chem_cost) || 0), 0);
  const chemCostTotal = prodCostsChem + dashDosingPeso;
  const chemCost      = (chemCostTotal > 0) ? chemCostTotal
    : hasCostData ? null
    : null;

  const powerCost = todayPowerCostPeso != null ? +todayPowerCostPeso.toFixed(0) : null;

  const productionCost = (chemCost != null || powerCost != null)
    ? (chemCost ?? 0) + (powerCost ?? 0)
    : null;

  return {
    todayCostsRaw,
    todayCosts,
    costDataDate,
    costIsStale,
    dashTariffByPlant,
    dashDosingPeso,
    hasCostData,
    prodCostsChem,
    chemCostTotal,
    chemCost,
    powerCost,
    productionCost,
  };
}

