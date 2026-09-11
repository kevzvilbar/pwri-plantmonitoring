/**
 * data/queries/staff.ts — Staff/employee query functions.
 *
 * Roadmap Phase 3: the data-access layer. These are pure, React-free query
 * functions — the single place to find "every query against the user_profiles,
 * user_roles, and related tables". Components wrap them with React Query via
 * the hooks in src/data/hooks/; hardcoded inline .from() calls should be
 * migrated here incrementally.
 *
 * Types come straight from the generated Database schema
 * (src/integrations/supabase/types.ts) so this layer can never drift from
 * the live table shape — regenerate with `npm run types:gen` after any
 * migration that touches these tables.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type UserProfileRow = Database['public']['Tables']['user_profiles']['Row'];
type UserRoleRow = Database['public']['Tables']['user_roles']['Row'];

/** Staff member type matching the local employees/types.ts definition */
export interface StaffMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  suffix: string | null;
  username: string | null;
  designation: string | null;
  plant_assignments: string[];
  status: string;
  updated_at: string;
  last_seen_at: string | null;
  immediate_head_id: string | null;
  // Extended fields from the full profile
  email: string | null;
  confirmed: boolean;
  profile_complete: boolean;
  created_at: string;
}

/** All staff members — uses RPC if available for richer data */
export async function fetchAllStaff(): Promise<StaffMember[]> {
  const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
  if (!rpcError && rpcData) return rpcData as StaffMember[];
  
  const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
  if (error) throw error;
  return (data ?? []) as StaffMember[];
}

/** All user roles — uses RPC if available */
export async function fetchAllUserRoles(): Promise<{ user_id: string; role: string }[]> {
  const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_user_roles');
  if (!rpcError && rpcData) return rpcData as { user_id: string; role: string }[];
  
  const { data } = await (supabase as any).from('user_profiles').select('id, user_roles(role)');
  return (data ?? []).flatMap((p: any) =>
    (p.user_roles ?? []).map((r: any) => ({ user_id: p.id, role: r.role }))
  );
}

/** Fetch plants with staff assignments */
export async function fetchPlantsWithStaff(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from('plants').select('id, name').order('name');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/** Fetch plant details with flags for KPI calculations */
export async function fetchPlantFlags(): Promise<Record<string, { has_solar: boolean; has_grid: boolean; ro_hourly_target?: number | string | null }>> {
  const { data, error } = await supabase.from('plants').select('id, has_solar, has_grid');
  if (error) throw error;
  
  const flags: Record<string, { has_solar: boolean; has_grid: boolean; ro_hourly_target?: number | string | null }> = {};
  (data ?? []).forEach((p: any) => {
    flags[p.id] = { has_solar: p.has_solar ?? false, has_grid: p.has_grid ?? true, ro_hourly_target: null };
  });
  return flags;
}

/** Entity counts per plant for KPI denominators */
export async function fetchEntityCountsPerPlant(): Promise<{
  wellsPerPlant: Record<string, number>;
  locatorsPerPlant: Record<string, number>;
  trainsPerPlant: Record<string, string[]>;
  metersPerPlant: Record<string, number>;
}> {
  const [wells, locators, trains, meters] = await Promise.all([
    supabase.from('wells').select('plant_id'),
    supabase.from('locators').select('plant_id'),
    supabase.from('ro_trains').select('plant_id, id'),
    supabase.from('product_meters').select('plant_id'),
  ]);
  
  if (wells.error) throw wells.error;
  if (locators.error) throw locators.error;
  if (trains.error) throw trains.error;
  if (meters.error) throw meters.error;
  
  const wellsPerPlant: Record<string, number> = {};
  const locatorsPerPlant: Record<string, number> = {};
  const trainsPerPlant: Record<string, string[]> = {};
  const metersPerPlant: Record<string, number> = {};
  
  (wells.data ?? []).forEach((w: any) => { wellsPerPlant[w.plant_id] = (wellsPerPlant[w.plant_id] ?? 0) + 1; });
  (locators.data ?? []).forEach((l: any) => { locatorsPerPlant[l.plant_id] = (locatorsPerPlant[l.plant_id] ?? 0) + 1; });
  (trains.data ?? []).forEach((t: any) => { (trainsPerPlant[t.plant_id] = trainsPerPlant[t.plant_id] ?? []).push(t.id); });
  (meters.data ?? []).forEach((m: any) => { metersPerPlant[m.plant_id] = (metersPerPlant[m.plant_id] ?? 0) + 1; });
  
  return { wellsPerPlant, locatorsPerPlant, trainsPerPlant, metersPerPlant };
}

/** Reading data for KPI calculations */
export async function fetchKpiReadings(range: 'today' | number): Promise<{
  wellReadings: any[];
  locReadings: any[];
  roReadings: any[];
  meterReadings: any[];
  powerReadings: any[];
  chemReadings: any[];
  blendingReadings: any[];
}> {
  const since = range === 'today' 
    ? new Date().toISOString().slice(0, 10)
    : new Date(Date.now() - (range as number) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  
  const [wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings, blendingReadings] = await Promise.all([
    supabase.from('well_readings').select('*').gte('reading_datetime', since),
    supabase.from('locator_readings').select('*').gte('reading_datetime', since),
    supabase.from('ro_train_readings').select('*').gte('reading_datetime', since),
    supabase.from('product_meter_readings').select('*').gte('reading_datetime', since),
    supabase.from('power_readings').select('*').gte('reading_datetime', since),
    supabase.from('chemical_dosing_logs').select('*').gte('log_datetime', since),
    supabase.from('blending_events').select('*').gte('event_date', since),
  ]);
  
  if (wellReadings.error) throw wellReadings.error;
  if (locReadings.error) throw locReadings.error;
  if (roReadings.error) throw roReadings.error;
  if (meterReadings.error) throw meterReadings.error;
  if (powerReadings.error) throw powerReadings.error;
  if (chemReadings.error) throw chemReadings.error;
  if (blendingReadings.error) throw blendingReadings.error;
  
  return {
    wellReadings: wellReadings.data ?? [],
    locReadings: locReadings.data ?? [],
    roReadings: roReadings.data ?? [],
    meterReadings: meterReadings.data ?? [],
    powerReadings: powerReadings.data ?? [],
    chemReadings: chemReadings.data ?? [],
    blendingReadings: blendingReadings.data ?? [],
  };
}

export type { UserProfileRow, UserRoleRow };