/**
 * data/queries/readingHistory.ts — Reading history query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * reading history across all modules (locator, well, power, blending).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';

export type HistoryModule = 'locator' | 'well' | 'blending' | 'power';

export interface ReadingHistoryOptions {
  module: HistoryModule;
  entityId: string;
  days?: 7 | 14 | 30 | 60 | 'custom';
  appliedFrom?: string;
  appliedTo?: string;
  customFrom?: string;
  customTo?: string;
}

/** Get date range for query */
function getDateRange(options: ReadingHistoryOptions): { sinceDate: string; untilNextDay: string } {
  const _localStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const _addDay = (s: string, n: number) => {
    const [y, m, day] = s.split('-').map(Number);
    return _localStr(new Date(y, m - 1, day + n));
  };

  const { days, appliedFrom, appliedTo, customFrom, customTo } = options;
  let sinceDate: string;
  let untilNextDay: string;

  if (days === 'custom') {
    sinceDate = appliedFrom ?? customFrom ?? '';
    untilNextDay = _addDay(appliedTo ?? customTo ?? '', 1);
  } else {
    const daysNum = typeof days === 'number' ? days : 30;
    sinceDate = _localStr(new Date(Date.now() - daysNum * 86400_000));
    untilNextDay = _addDay(_localStr(new Date()), 1);
  }

  return { sinceDate, untilNextDay };
}

/** Fetch locator readings */
export async function fetchLocatorReadings(entityId: string, sinceDate: string, untilNextDay: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('locator_readings')
    .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, is_meter_replacement, is_meter_rollover, meter_rollover_max, is_estimated, recorded_by, created_at, norm_status')
    .eq('locator_id', entityId)
    .gte('reading_datetime', sinceDate)
    .lt('reading_datetime', untilNextDay)
    .order('reading_datetime', { ascending: false });
  
  if (!error) return data ?? [];
  
  // Fallback: base columns only
  const { data: fallback } = await supabase
    .from('locator_readings')
    .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, recorded_by, created_at, norm_status')
    .eq('locator_id', entityId)
    .gte('reading_datetime', sinceDate)
    .lt('reading_datetime', untilNextDay)
    .order('reading_datetime', { ascending: false });
  
  return (fallback ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, is_meter_rollover: false, meter_rollover_max: null, is_estimated: false }));
}

/** Fetch well readings */
export async function fetchWellReadings(entityId: string, sinceDate: string, untilNextDay: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('well_readings')
    .select('id, current_reading, previous_reading, power_meter_reading, tds_ppm, turbidity_ntu, pressure_psi, reading_datetime, is_meter_replacement, is_meter_rollover, meter_rollover_max, is_estimated, recorded_by, created_at, norm_status')
    .eq('well_id', entityId)
    .gte('reading_datetime', sinceDate)
    .lt('reading_datetime', untilNextDay)
    .order('reading_datetime', { ascending: false });
  
  if (!error) return data ?? [];
  
  // Fallback
  const { data: fallback } = await supabase
    .from('well_readings')
    .select('id, current_reading, previous_reading, power_meter_reading, reading_datetime, recorded_by, created_at, norm_status')
    .eq('well_id', entityId)
    .gte('reading_datetime', sinceDate)
    .lt('reading_datetime', untilNextDay)
    .order('reading_datetime', { ascending: false });
  
  return (fallback ?? []).map((r: any) => ({ ...r, is_meter_rollover: false, meter_rollover_max: null, is_estimated: false }));
}

/** Fetch power readings */
export async function fetchPowerReadings(entityId: string, sinceDate: string, untilNextDay: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('power_readings')
    .select('id, meter_reading_kwh, grid_meter_readings, daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, solar_meter_reading, reading_datetime, is_meter_replacement, is_estimated, recorded_by, created_at')
    .eq('plant_id', entityId)
    .gte('reading_datetime', sinceDate)
    .lt('reading_datetime', untilNextDay)
    .order('reading_datetime', { ascending: false });
  
  if (!error) return data ?? [];
  
  // Fallback
  const { data: fallback } = await supabase
    .from('power_readings')
    .select('id, meter_reading_kwh, daily_consumption_kwh, reading_datetime, is_meter_replacement, recorded_by, created_at')
    .eq('plant_id', entityId)
    .gte('reading_datetime', sinceDate)
    .lt('reading_datetime', untilNextDay)
    .order('reading_datetime', { ascending: false });
  
  return (fallback ?? []).map((r: any) => ({ ...r, is_estimated: false }));
}

/** Fetch blending events */
export async function fetchBlendingEvents(entityId: string, options: ReadingHistoryOptions): Promise<any[]> {
  const { days, customFrom, customTo } = options;
  
  try {
    let q = (supabase.from('blending_events' as any) as any)
      .select('id, well_id, plant_id, well_name, plant_name, event_date, reading_datetime, volume_m3, noted_at, is_meter_replacement, raw_meter_reading, is_estimated')
      .eq('well_id', entityId)
      .order('event_date', { ascending: false });

    if (days === 'custom') {
      q = q.gte('event_date', customFrom?.slice(0, 10) ?? '').lte('event_date', customTo?.slice(0, 10) ?? '');
    } else {
      const daysNum = typeof days === 'number' ? days : 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysNum);
      q = q.gte('event_date', cutoff.toISOString().slice(0, 10));
    }

    const { data, error } = await q;
    
    if (error) {
      // is_meter_replacement may not exist yet — retry without it
      if (error.message?.includes('is_meter_replacement') || error.message?.includes('raw_meter_reading') || error.message?.includes('does not exist')) {
        let q2 = (supabase.from('blending_events' as any) as any)
          .select('id, well_id, plant_id, well_name, plant_name, event_date, volume_m3, noted_at')
          .eq('well_id', entityId)
          .order('event_date', { ascending: false });
        
        if (days === 'custom') {
          q2 = q2.gte('event_date', customFrom?.slice(0, 10) ?? '').lte('event_date', customTo?.slice(0, 10) ?? '');
        } else {
          const daysNum = typeof days === 'number' ? days : 30;
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - daysNum);
          q2 = q2.gte('event_date', cutoff.toISOString().slice(0, 10));
        }
        
        const { data: d2, error: e2 } = await q2;
        if (e2) throw e2;
        return (d2 ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, raw_meter_reading: null, is_estimated: false }));
      }
      throw error;
    }
    
    return (data ?? []).map((r: any) => ({ ...r, is_meter_replacement: !!r.is_meter_replacement, is_estimated: !!r.is_estimated }));
  } catch {
    return [];
  }
}

/** Main entry point - fetch readings based on module */
export async function fetchReadingHistory(options: ReadingHistoryOptions): Promise<any[]> {
  const { sinceDate, untilNextDay } = getDateRange(options);
  
  switch (options.module) {
    case 'locator':
      return fetchLocatorReadings(options.entityId, sinceDate, untilNextDay);
    case 'well':
      return fetchWellReadings(options.entityId, sinceDate, untilNextDay);
    case 'power':
      return fetchPowerReadings(options.entityId, sinceDate, untilNextDay);
    case 'blending':
      return fetchBlendingEvents(options.entityId, options);
    default:
      return [];
  }
}

/** Resync locator chain - rebuild previous_reading from actual chain */
export async function resyncLocatorChain(locatorId: string): Promise<void> {
  const { data: all, error } = await supabase
    .from('locator_readings')
    .select('id, current_reading, previous_reading, reading_datetime, is_estimated')
    .eq('locator_id', locatorId)
    .order('reading_datetime', { ascending: true });
  
  if (error || !all) return;

  let last: number | null = null;
  const updates: { id: string; previous_reading: number | null }[] = [];
  const staleEstimatedIds: string[] = [];

  for (const row of all as any[]) {
    const cur = +row.current_reading;
    if (row.is_estimated && last != null && cur <= last) {
      staleEstimatedIds.push(row.id);
      continue;
    }
    const newPrev = last;
    if (row.previous_reading !== newPrev) {
      updates.push({ id: row.id, previous_reading: newPrev });
    }
    last = cur;
  }

  if (staleEstimatedIds.length) {
    await supabase.from('locator_readings').delete().in('id', staleEstimatedIds);
  }

  if (updates.length) {
    await Promise.all(updates.map(u => supabase
      .from('locator_readings')
      .update({ previous_reading: u.previous_reading } as any)
      .eq('id', u.id)));
  }

  if (staleEstimatedIds.length || updates.length) {
    (supabase.rpc as any)('fn_backfill_missing_readings', { p_lookback_days: 14 }).catch(() => {});
  }
}

export type { HistoryModule };