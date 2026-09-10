import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays } from 'date-fns';
import { calc } from '@/lib/calculations';
import { pctDelta } from '@/components/dashboard/types';
import { computeRollingAverageRateFromDeltas, type VolumePoint } from '@/lib/flowRateGuards';

export interface UsePowerStatsParams {
  plantIds: string[];
  today: string;
  yesterday: string;
  tariffByPlant?: Map<string, number>;
  production?: number | null;
}

export function computePowerKwh(
  currentRows: any[],
  prevRows: any[],
  configMap: Map<string, number[]> | undefined,
  tariffByPlant?: Map<string, number>,
): { kwh: number; powerCostPeso: number | null } {
  const prevByPlant = new Map<string, any>();
  for (const p of prevRows) prevByPlant.set(p.plant_id, p);
  let totalKwh = 0;
  let totalCostPeso = 0;
  let hasTariff = false;
  for (const r of currentRows) {
    if (r.is_meter_replacement) continue;
    const pid     = r.plant_id;
    const prev    = prevByPlant.get(pid);
    const multArr = configMap?.get(pid) ?? [1];
    const rGmr    = r.grid_meter_readings as Record<string, number> | null | undefined;
    const pGmr    = prev?.grid_meter_readings as Record<string, number> | null | undefined;
    let kwh = 0;
    let rawDeltaAttempted = false;

    if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
      rawDeltaAttempted = true;
      let sum = 0;
      for (const k of Object.keys(rGmr)) {
        const mi    = parseInt(k, 10);
        const mMult = multArr[mi] ?? multArr[0] ?? 1;
        if (pGmr[k] != null) sum += (rGmr[k] - pGmr[k]) * mMult;
      }
      if (sum >= 0) kwh = sum;
    } else if (prev?.meter_reading_kwh != null && r.meter_reading_kwh != null) {
      rawDeltaAttempted = true;
      const delta = +r.meter_reading_kwh - +prev.meter_reading_kwh;
      if (delta >= 0) kwh = delta * (multArr[0] ?? 1);
    }

    if (kwh === 0 && !rawDeltaAttempted) {
      if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
        kwh = +r.daily_grid_kwh;
      else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
        kwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
    }
    totalKwh += kwh;

    const rate = tariffByPlant?.get(pid) ?? null;
    if (rate != null && kwh > 0) {
      totalCostPeso += kwh * rate;
      hasTariff = true;
    }
  }
  return { kwh: totalKwh, powerCostPeso: hasTariff ? totalCostPeso : null };
}

export function usePowerStats({
  plantIds,
  today,
  yesterday,
  tariffByPlant,
  production,
}: UsePowerStatsParams) {
  const { data: dashPowerConfigMap } = useQuery({
    queryKey: ['dash-power-config-map', plantIds],
    queryFn: async () => {
      const map = new Map<string, number[]>();
      try {
        const { data } = await supabase
          .from('plant_power_config')
          .select('plant_id,grid_meter_multipliers')
          .in('plant_id', plantIds);
        for (const cfg of data ?? []) {
          const mArr = cfg.grid_meter_multipliers as any[];
          if (Array.isArray(mArr) && mArr.length > 0)
            map.set(cfg.plant_id, mArr.map((v) => +v > 0 ? +v : 1));
        }
      } catch { /* plant_power_config may not exist */ }
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const { data: todayPowerRaw } = useQuery({
    queryKey: ['dash-power-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], prevRows: [] as any[], isStale: false };

      const { data: todayRows, error: todayErr } = await supabase.from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds).gte('reading_datetime', today);
      if (todayErr) throw todayErr;

      let rows = todayRows ?? [];
      let isStale = false;

      if (!rows.length) {
        const { data: recent, error: recentErr } = await supabase.from('power_readings')
          .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
          .in('plant_id', plantIds).order('reading_datetime', { ascending: false }).limit(plantIds.length * 3);
        if (recentErr) throw recentErr;
        const latestByPlant = new Map<string, any>();
        (recent ?? []).forEach((r) => { if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r); });
        rows = Array.from(latestByPlant.values());
        isStale = rows.length > 0;
      }

      const baselineTimestamp = rows.length > 0 ? rows[0].reading_datetime : today;
      let prevRows: any[] = [];
      const { data: prevData, error: prevErr } = await (supabase.rpc as any)(
        'latest_power_readings_before',
        { plant_ids: plantIds, before_ts: baselineTimestamp },
      );
      if (!prevErr && prevData && prevData.length > 0) {
        prevRows = prevData;
      } else {
        if (prevErr) console.warn('[Dashboard] latest_power_readings_before failed:', prevErr);
        await Promise.all(
          plantIds.map(async (pid) => {
            const { data } = await supabase.from('power_readings')
              .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
              .eq('plant_id', pid).lt('reading_datetime', baselineTimestamp)
              .order('reading_datetime', { ascending: false }).limit(1);
            if (data?.[0]) prevRows.push(data[0]);
          }),
        );
      }

      return { rows, prevRows, isStale };
    },
    enabled: plantIds.length > 0,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const todayPower   = todayPowerRaw?.rows ?? [];
  const powerIsStale = todayPowerRaw?.isStale ?? false;

  const { data: yPower } = useQuery({
    queryKey: ['dash-power-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], prevRows: [] as any[] };
      const { data: rows, error: rowsErr } = await supabase.from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today);
      if (rowsErr) throw rowsErr;

      let prevRows: any[] = [];
      const { data: prevData, error: prevErr } = await (supabase.rpc as any)(
        'latest_power_readings_before',
        { plant_ids: plantIds, before_ts: yesterday },
      );
      if (!prevErr && prevData && prevData.length > 0) {
        prevRows = prevData;
      } else {
        if (prevErr) console.warn('[Dashboard] yesterday latest_power_readings_before failed:', prevErr);
        await Promise.all(
          plantIds.map(async (pid) => {
            const { data } = await supabase.from('power_readings')
              .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
              .eq('plant_id', pid).lt('reading_datetime', yesterday)
              .order('reading_datetime', { ascending: false }).limit(1);
            if (data?.[0]) prevRows.push(data[0]);
          }),
        );
      }
      return { rows: rows ?? [], prevRows };
    },
    enabled: plantIds.length > 0,
    staleTime: 12 * 60 * 60_000,
    refetchInterval: false,
  });

  const { data: powerHistory = [] } = useQuery({
    queryKey: ['dash-power-history', plantIds, today],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const since = subDays(new Date(), 14).toISOString();
      const { data, error } = await supabase
        .from('power_readings')
        .select('plant_id,daily_consumption_kwh,reading_datetime')
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .lt('reading_datetime', today)
        .not('daily_consumption_kwh', 'is', null);
      if (error) throw new Error(`power_readings (history): ${error.message}`);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 15 * 60_000,
  });

  const powerAvgByPlant = useMemo(() => {
    const byPlant = new Map<string, VolumePoint[]>();
    (powerHistory ?? []).forEach((r) => {
      const v = Number(r.daily_consumption_kwh);
      if (!Number.isFinite(v) || v <= 0 || !r.reading_datetime) return;
      const key = r.plant_id;
      if (!byPlant.has(key)) byPlant.set(key, []);
      byPlant.get(key)!.push({ volume: v, at: new Date(r.reading_datetime) });
    });
    const out = new Map<string, number>();
    byPlant.forEach((points, pid) => {
      const avg = computeRollingAverageRateFromDeltas(points, 14);
      if (avg != null) out.set(pid, avg);
    });
    return out;
  }, [powerHistory]);

  const prevPowerRowByPlant = useMemo(() => {
    const m = new Map<string, { reading_datetime: string }>();
    (todayPowerRaw?.prevRows ?? []).forEach((r: any) => {
      if (r.plant_id && r.reading_datetime) m.set(r.plant_id, r);
    });
    return m;
  }, [todayPowerRaw]);

  // Aggregations
  const { kwh, powerCostPeso: todayPowerCostPeso } = computePowerKwh(
    todayPower, todayPowerRaw?.prevRows ?? [], dashPowerConfigMap, tariffByPlant,
  );

  const { kwh: yKwh } = computePowerKwh(yPower?.rows ?? [], yPower?.prevRows ?? [], dashPowerConfigMap);
  const dKwh = pctDelta(kwh, yKwh);
  const powerCost = todayPowerCostPeso != null ? +todayPowerCostPeso.toFixed(0) : null;
  const pv = calc.pvRatio(kwh, production ?? 0);

  return {
    dashPowerConfigMap,
    todayPowerRaw,
    todayPower,
    powerIsStale,
    yPower,
    powerHistory,
    powerAvgByPlant,
    prevPowerRowByPlant,
    // Aggregates
    kwh,
    yKwh,
    dKwh,
    powerCostPeso: todayPowerCostPeso,
    powerCost,
    pv,
  };
}
