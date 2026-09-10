/**
 * data/queries/kpi.ts — KPI query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * KPI dashboard calculations. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';

/** Plant flags for KPI calculations */
export interface PlantFlags {
  has_solar: boolean;
  has_grid: boolean;
  ro_hourly_target?: number | string | null;
}

/** Entity counts per plant for KPI denominators */
export interface EntityCountsPerPlant {
  wellsPerPlant: Record<string, number>;
  locatorsPerPlant: Record<string, number>;
  trainsPerPlant: Record<string, string[]>;
  metersPerPlant: Record<string, number>;
}

/** Reading data for KPI calculations */
export interface KpiReadings {
  wellReadings: Array<{ plant_id: string; well_id: string; reading_datetime: string; recorded_by: string | null }>;
  locReadings: Array<{ plant_id: string; locator_id: string; reading_datetime: string; recorded_by: string | null }>;
  roReadings: Array<{ plant_id: string; train_id: string; reading_datetime: string; recorded_by: string | null }>;
  meterReadings: Array<{ plant_id: string; meter_id: string; reading_datetime: string; recorded_by: string | null }>;
  powerReadings: Array<{ plant_id: string; reading_datetime: string; recorded_by: string | null; daily_solar_kwh: number | null; daily_grid_kwh: number | null }>;
  chemReadings: Array<{ plant_id: string; log_datetime: string; recorded_by: string }>;
  blendingReadings: Array<{ plant_id: string; well_id: string; event_date: string; recorded_by: string | null }>;
}

/** Fetch plant flags for KPI calculations */
export async function fetchPlantFlags(): Promise<Record<string, PlantFlags>> {
  const { data, error } = await supabase.from('plants').select('id, has_solar, has_grid, ro_hourly_target');
  if (error) throw error;
  
  const flags: Record<string, PlantFlags> = {};
  (data ?? []).forEach((p: any) => {
    flags[p.id] = { has_solar: p.has_solar ?? false, has_grid: p.has_grid ?? true, ro_hourly_target: p.ro_hourly_target };
  });
  return flags;
}

/** Entity counts per plant for KPI denominators */
export async function fetchEntityCountsPerPlant(): Promise<EntityCountsPerPlant> {
  const [wells, locators, trains, meters] = await Promise.all([
    supabase.from('wells').select('id, plant_id, status'),
    supabase.from('locators').select('id, plant_id, status'),
    supabase.from('ro_trains').select('id, plant_id, status'),
    supabase.from('product_meters').select('id, plant_id, status'),
  ]);
  
  if (wells.error) throw wells.error;
  if (locators.error) throw locators.error;
  if (trains.error) throw trains.error;
  if (meters.error) throw meters.error;
  
  const wellsPerPlant: Record<string, number> = {};
  const locatorsPerPlant: Record<string, number> = {};
  const trainsPerPlant: Record<string, string[]> = {};
  const metersPerPlant: Record<string, number> = {};
  
  (wells.data ?? []).filter((w: any) => w.status === 'Active').forEach((w: any) => { 
    wellsPerPlant[w.plant_id] = (wellsPerPlant[w.plant_id] ?? 0) + 1; 
  });
  (locators.data ?? []).filter((l: any) => l.status === 'Active').forEach((l: any) => { 
    locatorsPerPlant[l.plant_id] = (locatorsPerPlant[l.plant_id] ?? 0) + 1; 
  });
  (trains.data ?? []).filter((t: any) => t.status !== 'Offline').forEach((t: any) => { 
    (trainsPerPlant[t.plant_id] = trainsPerPlant[t.plant_id] ?? []).push(t.id); 
  });
  (meters.data ?? []).filter((m: any) => m.status === 'Active').forEach((m: any) => { 
    metersPerPlant[m.plant_id] = (metersPerPlant[m.plant_id] ?? 0) + 1; 
  });
  
  return { wellsPerPlant, locatorsPerPlant, trainsPerPlant, metersPerPlant };
}

/** Reading data for KPI calculations */
export async function fetchKpiReadings(since: string): Promise<KpiReadings> {
  const [wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings] = await Promise.all([
    supabase.from('well_readings')
      .select('plant_id, well_id, reading_datetime, recorded_by, is_estimated')
      .gte('reading_datetime', since),
    supabase.from('locator_readings')
      .select('plant_id, locator_id, reading_datetime, recorded_by, is_estimated')
      .gte('reading_datetime', since),
    supabase.from('ro_train_readings')
      .select('plant_id, train_id, reading_datetime, recorded_by, is_estimated')
      .gte('reading_datetime', since),
    supabase.from('product_meter_readings')
      .select('plant_id, meter_id, reading_datetime, recorded_by, is_estimated')
      .gte('reading_datetime', since),
    supabase.from('power_readings')
      .select('plant_id, reading_datetime, recorded_by, daily_solar_kwh, daily_grid_kwh, is_estimated')
      .gte('reading_datetime', since),
    supabase.from('chemical_dosing_logs')
      .select('plant_id, log_datetime, recorded_by')
      .gte('log_datetime', since),
    supabase.from('blending_events')
      .select('plant_id, well_id, event_date, is_estimated')
      .gte('event_date', since.slice(0, 10)),
  ]);
  
  if (wellReadings.error) throw wellReadings.error;
  if (locReadings.error) throw locReadings.error;
  if (roReadings.error) throw roReadings.error;
  if (meterReadings.error) throw meterReadings.error;
  if (powerReadings.error) throw powerReadings.error;
  if (chemReadings.error) throw chemReadings.error;
  if (blendingReadings.error) throw blendingReadings.error;
  
  return {
    wellReadings: ((wellReadings.data ?? []) as any[])
      .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; well_id: string; reading_datetime: string; recorded_by: string | null }[],
    locReadings: ((locReadings.data ?? []) as any[])
      .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; locator_id: string; reading_datetime: string; recorded_by: string | null }[],
    roReadings: ((roReadings.data ?? []) as any[])
      .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; train_id: string; reading_datetime: string; recorded_by: string | null }[],
    meterReadings: ((meterReadings.data ?? []) as any[])
      .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; meter_id: string; reading_datetime: string; recorded_by: string | null }[],
    powerReadings: ((powerReadings.data ?? []) as any[])
      .filter(r => !r.is_estimated && r.recorded_by != null) as { plant_id: string; reading_datetime: string; recorded_by: string | null; daily_solar_kwh: number | null; daily_grid_kwh: number | null }[],
    chemReadings: ((chemReadings.data ?? []) as any[])
      .filter(r => r.recorded_by != null) as { plant_id: string; log_datetime: string; recorded_by: string }[],
    blendingReadings: ((blendingReadings.data ?? []) as any[])
      .filter(r => !r.is_estimated)
      .map(r => ({ ...r, recorded_by: null })) as { plant_id: string; well_id: string; event_date: string; recorded_by: string | null }[],
  };
}

/** Individual config queries for fine-grained caching */
export async function fetchWellsConfig(): Promise<Array<{ id: string; plant_id: string; status: string }>> {
  const { data, error } = await supabase.from('wells').select('id, plant_id, status');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; plant_id: string; status: string }>;
}

export async function fetchLocatorsConfig(): Promise<Array<{ id: string; plant_id: string; status: string }>> {
  const { data, error } = await supabase.from('locators').select('id, plant_id, status');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; plant_id: string; status: string }>;
}

export async function fetchTrainsConfig(): Promise<Array<{ id: string; plant_id: string; status: string }>> {
  const { data, error } = await (supabase as any).from('ro_trains').select('id, plant_id, status');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; plant_id: string; status: string }>;
}

export async function fetchMetersConfig(): Promise<Array<{ id: string; plant_id: string; status: string }>> {
  const { data, error } = await (supabase as any).from('product_meters').select('id, plant_id, status');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; plant_id: string; status: string }>;
}

/** Individual reading queries for fine-grained caching */
export async function fetchWellReadings(since: string): Promise<Array<{ plant_id: string; well_id: string; reading_datetime: string; recorded_by: string | null }>> {
  const { data, error } = await supabase.from('well_readings')
    .select('plant_id, well_id, reading_datetime, recorded_by, is_estimated')
    .gte('reading_datetime', since);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => !r.is_estimated && r.recorded_by != null) as Array<{ plant_id: string; well_id: string; reading_datetime: string; recorded_by: string | null }>;
}

export async function fetchLocatorReadings(since: string): Promise<Array<{ plant_id: string; locator_id: string; reading_datetime: string; recorded_by: string | null }>> {
  const { data, error } = await supabase.from('locator_readings')
    .select('plant_id, locator_id, reading_datetime, recorded_by, is_estimated')
    .gte('reading_datetime', since);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => !r.is_estimated && r.recorded_by != null) as Array<{ plant_id: string; locator_id: string; reading_datetime: string; recorded_by: string | null }>;
}

export async function fetchRoTrainReadings(since: string): Promise<Array<{ plant_id: string; train_id: string; reading_datetime: string; recorded_by: string | null }>> {
  const { data, error } = await (supabase as any).from('ro_train_readings')
    .select('plant_id, train_id, reading_datetime, recorded_by, is_estimated')
    .gte('reading_datetime', since);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => !r.is_estimated && r.recorded_by != null) as Array<{ plant_id: string; train_id: string; reading_datetime: string; recorded_by: string | null }>;
}

export async function fetchProductMeterReadings(since: string): Promise<Array<{ plant_id: string; meter_id: string; reading_datetime: string; recorded_by: string | null }>> {
  const { data, error } = await (supabase as any).from('product_meter_readings')
    .select('plant_id, meter_id, reading_datetime, recorded_by, is_estimated')
    .gte('reading_datetime', since);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => !r.is_estimated && r.recorded_by != null) as Array<{ plant_id: string; meter_id: string; reading_datetime: string; recorded_by: string | null }>;
}

export async function fetchPowerReadings(since: string): Promise<Array<{ plant_id: string; reading_datetime: string; recorded_by: string | null; daily_solar_kwh: number | null; daily_grid_kwh: number | null }>> {
  const { data, error } = await supabase.from('power_readings')
    .select('plant_id, reading_datetime, recorded_by, daily_solar_kwh, daily_grid_kwh, is_estimated')
    .gte('reading_datetime', since);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => !r.is_estimated && r.recorded_by != null) as Array<{ plant_id: string; reading_datetime: string; recorded_by: string | null; daily_solar_kwh: number | null; daily_grid_kwh: number | null }>;
}

export async function fetchChemReadings(since: string): Promise<Array<{ plant_id: string; log_datetime: string; recorded_by: string }>> {
  const { data, error } = await supabase.from('chemical_dosing_logs')
    .select('plant_id, log_datetime, recorded_by')
    .gte('log_datetime', since);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => r.recorded_by != null) as Array<{ plant_id: string; log_datetime: string; recorded_by: string }>;
}

export async function fetchBlendingReadings(since: string): Promise<Array<{ plant_id: string; well_id: string; event_date: string; recorded_by: string | null }>> {
  const { data, error } = await supabase.from('blending_events')
    .select('plant_id, well_id, event_date, is_estimated')
    .gte('event_date', since.slice(0, 10));
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter(r => !r.is_estimated)
    .map(r => ({ ...r, recorded_by: null })) as Array<{ plant_id: string; well_id: string; event_date: string; recorded_by: string | null }>;
}