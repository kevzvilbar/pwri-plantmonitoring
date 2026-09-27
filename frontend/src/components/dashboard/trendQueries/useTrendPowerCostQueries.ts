import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface UseTrendPowerCostQueriesOptions {
  metric: string;
  plantIds: string[];
  startISO: string;
  startKey: string;
  endKey: string;
  chartStaleTime: number;
  chartRefetchInterval: false | number;
  needsPowerReadings: boolean;
  needsCostReadings: boolean;
}

export function useTrendPowerCostQueries({
  metric,
  plantIds,
  startISO,
  startKey,
  endKey,
  chartStaleTime,
  chartRefetchInterval,
  needsPowerReadings,
  needsCostReadings,
}: UseTrendPowerCostQueriesOptions) {
  const supaSelect = async <T,>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', `${endKey}T23:59:59.999Z`);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };

  const { data: powerReadings, isFetching: fetchingPower, error: errPower, refetch: refetchPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const inWindow = await supaSelect<any>(
        'power_readings',
        'daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,multiplier,reading_datetime,is_meter_replacement,plant_id,is_estimated',
      );
      let preRows: any[] = [];
      const { data: rpcRows, error: rpcErr } = await (supabase.rpc as any)(
        'latest_power_readings_before',
        { plant_ids: plantIds, before_ts: startISO },
      );
      if (!rpcErr && rpcRows && rpcRows.length > 0) {
        preRows = rpcRows;
      } else {
        await Promise.all(
          plantIds.map(async (pid) => {
            const { data } = await (supabase.from('power_readings' as never) as any)
              .select('daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,multiplier,reading_datetime,is_meter_replacement,plant_id,is_estimated')
              .eq('plant_id', pid)
              .lt('reading_datetime', startISO)
              .order('reading_datetime', { ascending: false })
              .limit(1);
            if (data?.[0]) preRows.push(data[0]);
          }),
        );
      }
      return [...preRows, ...inWindow].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
    },
    enabled: plantIds.length > 0 && needsPowerReadings,
    staleTime: chartStaleTime,
    refetchInterval: chartRefetchInterval,
  });

  const { data: costReadings, isFetching: fetchingCost, error: errCost, refetch: refetchCost } = useQuery({
    queryKey: ['trend-cost', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const [prodCostRes, dosingRes, pricesRes] = await Promise.all([
        supabase.from('production_costs')
          .select('cost_date,chem_cost,plant_id')
          .in('plant_id', plantIds)
          .gte('cost_date', startKey)
          .lte('cost_date', endKey),
        supabase.from('chemical_dosing_logs')
          .select('log_datetime,calculated_cost,plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg,free_chlorine_reagent_pcs')
          .in('plant_id', plantIds)
          .gte('log_datetime', `${startKey}T00:00:00`)
          .lte('log_datetime', `${endKey}T23:59:59`),
        supabase.from('chemical_prices')
          .select('chemical_name,unit_price')
          .lte('effective_date', today)
          .order('effective_date', { ascending: false }),
      ]);
      if (prodCostRes.error) throw new Error(`production_costs: ${prodCostRes.error.message}`);
      if (dosingRes.error)   throw new Error(`chemical_dosing_logs: ${dosingRes.error.message}`);

      const priceMap: Record<string, number> = {};
      for (const p of (pricesRes.data ?? []) as any[]) {
        const base = (p.chemical_name as string).replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(p.chemical_name in priceMap)) priceMap[p.chemical_name] = +p.unit_price;
        if (!(base in priceMap))            priceMap[base]            = +p.unit_price;
      }

      interface ChemDayAcc {
        chem_cost: number;
        chlorine_kg: number;
        chlorine_cost: number;
        smbs_kg: number;
        smbs_cost: number;
        anti_scalant_l: number;
        anti_scalant_cost: number;
        soda_ash_kg: number;
        soda_ash_cost: number;
        free_cl_pcs: number;
        free_cl_cost: number;
        other_cost: number;
      }
      const dayAccMap = new Map<string, ChemDayAcc>();
      const getAcc = (k: string): ChemDayAcc => {
        let acc = dayAccMap.get(k);
        if (!acc) {
          acc = {
            chem_cost: 0,
            chlorine_kg: 0,
            chlorine_cost: 0,
            smbs_kg: 0,
            smbs_cost: 0,
            anti_scalant_l: 0,
            anti_scalant_cost: 0,
            soda_ash_kg: 0,
            soda_ash_cost: 0,
            free_cl_pcs: 0,
            free_cl_cost: 0,
            other_cost: 0,
          };
          dayAccMap.set(k, acc);
        }
        return acc;
      };

      for (const r of (prodCostRes.data ?? []) as any[]) {
        const k = `${r.plant_id}|${r.cost_date}`;
        const manualCost = +(r.chem_cost ?? 0);
        if (manualCost > 0) {
          const acc = getAcc(k);
          acc.chem_cost += manualCost;
          acc.other_cost += manualCost;
        }
      }

      for (const r of (dosingRes.data ?? []) as any[]) {
        const storedCost = +r.calculated_cost || 0;
        const clKg = +r.chlorine_kg || 0;
        const clCost = clKg * (priceMap['Chlorine'] ?? 0);
        const smbsKg = +r.smbs_kg || 0;
        const smbsCost = smbsKg * (priceMap['SMBS'] ?? 0);
        const asL = +r.anti_scalant_l || 0;
        const asCost = asL * (priceMap['Anti Scalant'] ?? 0);
        const saKg = +r.soda_ash_kg || 0;
        const saCost = saKg * (priceMap['Soda Ash'] ?? 0);
        const clPcs = +r.free_chlorine_reagent_pcs || 0;
        const clReagentCost = clPcs * (priceMap['Free Cl Reagent'] ?? 0);

        const liveCost = clCost + smbsCost + asCost + saCost + clReagentCost;
        const cost = storedCost > 0 ? storedCost : liveCost;
        if (cost <= 0 && clKg <= 0 && smbsKg <= 0 && asL <= 0 && saKg <= 0 && clPcs <= 0) continue;

        const dateKey = format(new Date(r.log_datetime), 'yyyy-MM-dd');
        const k = `${r.plant_id}|${dateKey}`;
        const acc = getAcc(k);
        acc.chem_cost += cost;
        acc.chlorine_kg += clKg;
        acc.chlorine_cost += clCost;
        acc.smbs_kg += smbsKg;
        acc.smbs_cost += smbsCost;
        acc.anti_scalant_l += asL;
        acc.anti_scalant_cost += asCost;
        acc.soda_ash_kg += saKg;
        acc.soda_ash_cost += saCost;
        acc.free_cl_pcs += clPcs;
        acc.free_cl_cost += clReagentCost;
        if (storedCost > liveCost && liveCost > 0) {
          acc.other_cost += (storedCost - liveCost);
        }
      }

      return Array.from(dayAccMap.entries()).map(([key, acc]) => {
        const [plant_id, cost_date] = key.split('|');
        return {
          plant_id,
          cost_date,
          chem_cost: acc.chem_cost,
          chlorine_kg: acc.chlorine_kg,
          chlorine_cost: acc.chlorine_cost,
          smbs_kg: acc.smbs_kg,
          smbs_cost: acc.smbs_cost,
          anti_scalant_l: acc.anti_scalant_l,
          anti_scalant_cost: acc.anti_scalant_cost,
          soda_ash_kg: acc.soda_ash_kg,
          soda_ash_cost: acc.soda_ash_cost,
          free_cl_pcs: acc.free_cl_pcs,
          free_cl_cost: acc.free_cl_cost,
          other_cost: acc.other_cost,
        };
      });
    },
    enabled: plantIds.length > 0 && needsCostReadings,
    staleTime: chartStaleTime,
    refetchInterval: chartRefetchInterval,
  });

  const { data: powerTariffs } = useQuery({
    queryKey: ['trend-power-tariffs', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('power_tariffs')
        .select('plant_id,effective_date,rate_per_kwh,multiplier')
        .in('plant_id', plantIds)
        .order('effective_date', { ascending: true });
      if (error) throw new Error(`power_tariffs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
    staleTime: 10 * 60_000,
  });

  const { data: rawBillMultiplierMap } = useQuery<Record<string, number>>({
    queryKey: ['trend-bill-multipliers', plantIds],
    queryFn: async () => {
      const map: Record<string, number> = {};
      try {
        const { data } = await supabase.from('electric_bills')
          .select('plant_id,multiplier')
          .in('plant_id', plantIds)
          .order('billing_month', { ascending: false });
        for (const b of data ?? []) {
          if (map[b.plant_id] == null && +(b.multiplier ?? 0) > 0)
            map[b.plant_id] = +b.multiplier;
        }
      } catch { /* electric_bills table may not exist — silently default to row.multiplier */ }
      return map;
    },
    enabled: plantIds.length > 0 && metric === 'kwh',
    staleTime: 5 * 60_000,
  });
  const billMultiplierMap = useMemo(() => {
    if (!rawBillMultiplierMap) return new Map<string, number>();
    if (rawBillMultiplierMap instanceof Map) return rawBillMultiplierMap;
    const m = new Map<string, number>();
    if (typeof rawBillMultiplierMap === 'object') {
      Object.entries(rawBillMultiplierMap).forEach(([k, v]) => m.set(k, Number(v)));
    }
    return m;
  }, [rawBillMultiplierMap]);

  const { data: rawPowerConfigMap } = useQuery<Record<string, number[]>>({
    queryKey: ['trend-power-config', plantIds],
    queryFn: async () => {
      const map: Record<string, number[]> = {};
      try {
        const { data } = await supabase.from('plant_power_config')
          .select('plant_id,grid_meter_multipliers')
          .in('plant_id', plantIds);
        for (const cfg of data ?? []) {
          const mArr = cfg.grid_meter_multipliers as unknown[];
          if (Array.isArray(mArr) && mArr.length > 0)
            map[cfg.plant_id] = mArr.map((v) => Number(v) > 0 ? Number(v) : 1);
        }
      } catch { /* plant_power_config table may not exist — keep defaults */ }
      return map;
    },
    enabled: plantIds.length > 0 && metric === 'kwh',
    staleTime: 5 * 60_000,
  });
  const powerConfigMap = useMemo(() => {
    if (!rawPowerConfigMap) return new Map<string, number[]>();
    if (rawPowerConfigMap instanceof Map) return rawPowerConfigMap;
    const m = new Map<string, number[]>();
    if (typeof rawPowerConfigMap === 'object') {
      Object.entries(rawPowerConfigMap).forEach(([k, v]) => {
        if (Array.isArray(v)) m.set(k, v);
      });
    }
    return m;
  }, [rawPowerConfigMap]);

  return {
    powerReadings, fetchingPower, errPower, refetchPower,
    costReadings, fetchingCost, errCost, refetchCost,
    powerTariffs, billMultiplierMap, powerConfigMap,
  };
}
