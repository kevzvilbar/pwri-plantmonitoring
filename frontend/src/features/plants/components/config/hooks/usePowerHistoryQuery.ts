import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';

export type PowerHistoryRow = {
  date: string;
  solar: number;
  grid: number;
};

export function usePowerHistoryQuery(
  plantId: string,
  range: '30' | '90' | '180' | 'all',
) {
  const { data: rows = [], isLoading } = useQuery<PowerHistoryRow[]>({
    queryKey: ['power-history', plantId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      let multiplier = 1;
      let multiplierArr: number[] = [1];
      try {
        const { data: ppc } = await (supabase.from('plant_power_config' as any) as any)
          .select('grid_meter_multipliers')
          .eq('plant_id', plantId)
          .maybeSingle();
        const mArr = ppc?.grid_meter_multipliers;
        if (Array.isArray(mArr) && mArr.length > 0) {
          multiplierArr = mArr.map((v: any) => +v > 0 ? +v : 1);
          multiplier    = multiplierArr[0];
        }
      } catch { /* table may not exist — keep defaults */ }

      const { data: allRows } = await supabase
        .from('power_readings' as any)
        .select('reading_datetime, meter_reading_kwh, grid_meter_readings, solar_meter_reading, daily_consumption_kwh, daily_grid_kwh, daily_solar_kwh, is_meter_replacement, multiplier')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: true });

      const allReadings = (allRows ?? []) as any[];

      const byDate = new Map<string, { solar: number; grid: number }>();
      const ensure = (d: string) => {
        if (!byDate.has(d)) byDate.set(d, { solar: 0, grid: 0 });
        return byDate.get(d)!;
      };

      let prevGridMeter: number | null = null;
      let prevGridReadings: Record<string, number> | null = null;

      for (const r of allReadings) {
        const date = r.reading_datetime ? format(new Date(r.reading_datetime), 'yyyy-MM-dd') : '';
        if (!date) continue;

        const isMeterRepl = !!r.is_meter_replacement;
        const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
        const rGmr = r.grid_meter_readings as Record<string, number> | null | undefined;

        if (isMeterRepl) {
          prevGridMeter    = gridCurrent;
          prevGridReadings = rGmr ?? null;
        } else {
          let gridKwh = 0;

          {
            const pGmr = prevGridReadings;

            if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
              let total = 0;
              for (const k of Object.keys(rGmr)) {
                const mi    = parseInt(k, 10);
                const mMult = multiplierArr[mi] ?? multiplierArr[0] ?? 1;
                if (pGmr[k] != null) total += (rGmr[k] - pGmr[k]) * mMult;
              }
              if (total >= 0) gridKwh = total;
            } else if (prevGridMeter != null && gridCurrent != null) {
              const delta = gridCurrent - prevGridMeter;
              if (delta >= 0) gridKwh = delta * (multiplierArr[0] ?? 1);
            }
          }

          if (gridKwh === 0) {
            if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0) {
              gridKwh = +r.daily_consumption_kwh;
            } else if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0) {
              gridKwh = +r.daily_grid_kwh;
            }
          }

          prevGridMeter    = gridCurrent;
          prevGridReadings = rGmr ?? null;

          if (r.reading_datetime >= since && gridKwh > 0) {
            ensure(date).grid += gridKwh;
          }
        }

        if (!isMeterRepl && r.reading_datetime >= since) {
          const solarKwh = r.daily_solar_kwh != null ? Math.max(0, +r.daily_solar_kwh) : 0;
          if (solarKwh > 0) ensure(date).solar += solarKwh;
        }
      }

      return Array.from(byDate.entries())
        .filter(([date]) => date >= since.slice(0, 10))
        .map(([date, v]) => ({ date, solar: +v.solar.toFixed(2), grid: +v.grid.toFixed(2) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const rangeAggregates = useMemo(() => {
    let solarSum = 0;
    let gridSum = 0;
    for (const r of rows) {
      solarSum += r.solar;
      gridSum += r.grid;
    }
    const totalKwh = +(solarSum + gridSum).toFixed(2);
    const avgDaily = rows.length ? +(totalKwh / rows.length).toFixed(1) : 0;
    const solarPct = totalKwh > 0 ? +((solarSum / totalKwh) * 100).toFixed(1) : 0;
    return { solarSum: +solarSum.toFixed(2), gridSum: +gridSum.toFixed(2), totalKwh, avgDaily, solarPct };
  }, [rows]);

  return { rows, isLoading, rangeAggregates };
}
