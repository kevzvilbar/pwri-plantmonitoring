import { supabase } from '@/integrations/supabase/client';
import type { Dependency, DependencySnapshot } from './types';

export async function countRefs(table: string, column: string, value: string): Promise<number> {
  const { count } = await supabase
    .from(table as any)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);
  return count ?? 0;
}

export async function fetchUserDeps(id: string): Promise<DependencySnapshot> {
  const checks = await Promise.all([
    countRefs('user_roles', 'user_id', id),
    countRefs('afm_readings', 'recorded_by', id),
    countRefs('cartridge_readings', 'recorded_by', id),
    countRefs('checklist_executions', 'performed_by', id),
    countRefs('cip_logs', 'performed_by', id),
    countRefs('downtime_events', 'recorded_by', id),
    countRefs('incidents', 'recorded_by', id),
    countRefs('locator_readings', 'recorded_by', id),
    countRefs('power_readings', 'recorded_by', id),
    countRefs('user_profiles', 'immediate_head_id', id),
  ]);
  const [roles, ...rest] = checks;
  const refs: Dependency[] = [
    { table: 'afm_readings', count: rest[0] },
    { table: 'cartridge_readings', count: rest[1] },
    { table: 'checklist_executions', count: rest[2] },
    { table: 'cip_logs', count: rest[3] },
    { table: 'downtime_events', count: rest[4] },
    { table: 'incidents', count: rest[5] },
    { table: 'locator_readings', count: rest[6] },
    { table: 'power_readings', count: rest[7] },
    { table: 'user_profiles (reports to this user)', column: 'immediate_head_id', count: rest[8] },
  ].filter((r) => r.count > 0);
  const blockingRefs = refs.filter((r) => !r.table.startsWith('user_profiles'));
  const total = refs.reduce((a, b) => a + b.count, 0);
  return { blocking: blockingRefs.length > 0, total_references: total, references: refs, role_rows: roles };
}

export async function fetchPlantDeps(id: string): Promise<DependencySnapshot> {
  const checks = await Promise.all([
    countRefs('locators', 'plant_id', id),
    countRefs('downtime_events', 'plant_id', id),
    countRefs('incidents', 'plant_id', id),
    countRefs('daily_plant_summary', 'plant_id', id),
    countRefs('electric_bills', 'plant_id', id),
  ]);
  const refs: Dependency[] = [
    { table: 'locators', count: checks[0] },
    { table: 'downtime_events', count: checks[1] },
    { table: 'incidents', count: checks[2] },
    { table: 'daily_plant_summary', count: checks[3] },
    { table: 'electric_bills', count: checks[4] },
  ].filter((r) => r.count > 0);
  const total = refs.reduce((a, b) => a + b.count, 0);
  return { blocking: refs.length > 0, total_references: total, references: refs };
}
