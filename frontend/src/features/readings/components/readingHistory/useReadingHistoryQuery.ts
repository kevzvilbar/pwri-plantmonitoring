/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { HistoryModule } from './types';

export function useReadingHistoryQuery({ module, entityId, days, appliedFrom, appliedTo, customFrom, customTo }: any) {
  const queryKey = ['reading-history', module, entityId, days, appliedFrom, appliedTo];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      let sinceDate: string;
      let untilNextDay: string; // exclusive upper bound = day after end date
      // Pure local-date arithmetic — avoids UTC offset shifting the date back
      // (e.g. UTC+8 would turn 2026-05-08T00:00:00 local → 2026-05-07T16:00:00Z).
      const _localStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const _addDay = (s: string, n: number) => {
        const [y, m, day] = s.split('-').map(Number);
        return _localStr(new Date(y, m - 1, day + n));
      };
      if (days === 'custom') {
        sinceDate = appliedFrom;
        untilNextDay = _addDay(appliedTo, 1);
      } else {
        sinceDate = _localStr(new Date(Date.now() - days * 86400_000));
        untilNextDay = _addDay(_localStr(new Date()), 1);
      }

      if (module === 'locator') {
        const { data, error } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, is_meter_replacement, is_meter_rollover, meter_rollover_max, is_estimated, recorded_by, created_at, norm_status')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (is_meter_replacement / is_meter_rollover may not
        // exist yet in this environment — avoid the PostgREST schema-cache error taking
        // the whole dialog down to zero rows, matching the well/power/blending
        // branches above).
        const { data: fallback } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, recorded_by, created_at, norm_status')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return (fallback ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, is_meter_rollover: false, meter_rollover_max: null, is_estimated: false }));
      }
      if (module === 'well') {
        const { data, error } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, tds_ppm, turbidity_ntu, pressure_psi, reading_datetime, is_meter_replacement, is_meter_rollover, meter_rollover_max, is_estimated, recorded_by, created_at, norm_status')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns tds_ppm / pressure_psi /
        // is_meter_replacement / is_meter_rollover may not exist yet — avoid the
        // PostgREST schema-cache error)
        const { data: fallback } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, reading_datetime, recorded_by, created_at, norm_status')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return (fallback ?? []).map((r: any) => ({ ...r, is_meter_rollover: false, meter_rollover_max: null, is_estimated: false }));
      }
      if (module === 'power') {
        const { data, error } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, grid_meter_readings, daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, solar_meter_reading, reading_datetime, is_meter_replacement, is_estimated, recorded_by, created_at')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns missing)
        const { data: fallback } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, daily_consumption_kwh, reading_datetime, is_meter_replacement, recorded_by, created_at')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return (fallback ?? []).map((r: any) => ({ ...r, is_estimated: false }));
      }
      if (module === 'blending') {
        try {
          let q = (supabase.from('blending_events' as any) as any)
            .select('id, well_id, plant_id, well_name, plant_name, event_date, reading_datetime, volume_m3, noted_at, is_meter_replacement, raw_meter_reading, is_estimated')
            .eq('well_id', entityId)
            .order('event_date', { ascending: false });
          if (days === 'custom') {
            q = q.gte('event_date', customFrom.slice(0, 10)).lte('event_date', customTo.slice(0, 10));
          } else {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (days as number));
            q = q.gte('event_date', cutoff.toISOString().slice(0, 10));
          }
          const { data, error } = await q;
          if (error) {
            // is_meter_replacement may not exist yet — retry without it
            if (error.message?.includes('is_meter_replacement') || error.message?.includes('raw_meter_reading') || error.message?.includes('does not exist')) {
              // Retry with only the guaranteed base columns — neither is_meter_replacement
              // nor raw_meter_reading may exist yet if the migration hasn't been run.
              let q2 = (supabase.from('blending_events' as any) as any)
                .select('id, well_id, plant_id, well_name, plant_name, event_date, volume_m3, noted_at')
                .eq('well_id', entityId)
                .order('event_date', { ascending: false });
              if (days === 'custom') {
                q2 = q2.gte('event_date', customFrom.slice(0, 10)).lte('event_date', customTo.slice(0, 10));
              } else {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - (days as number));
                q2 = q2.gte('event_date', cutoff.toISOString().slice(0, 10));
              }
              const { data: d2, error: e2 } = await q2;
              if (e2) throw e2; // surface unexpected errors rather than silently returning []
              return (d2 ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, raw_meter_reading: null, is_estimated: false }));
            }
            throw error;
          }
          return (data ?? []).map((r: any) => ({ ...r, is_meter_replacement: !!r.is_meter_replacement, is_estimated: !!r.is_estimated }));
        } catch { return []; }
      }
      return [];
    },
    staleTime: 0,
  });
  return { ...query, queryKey };
}
