/**
 * adminCleanup.ts
 *
 * Client-side port of the old FastAPI `/api/admin/plants/cleanup` route
 * (backend/admin_service.py: cleanup_plants + _clear_no_cascade_children +
 * plant_dependencies + scrub_plant_assignments).
 *
 * That backend route ran on a user-scoped Supabase client (the caller's own
 * JWT via `user_scoped_client(token)`) — NOT the service-role key — and
 * relied entirely on RLS to gate the deletes:
 *   - plants:                    "plants_write_admin_manager" (is_manager_or_admin)
 *   - the no-cascade child tables: "<table>_plant_access" (user_has_plant_access,
 *     which is true for any Admin regardless of their own plant_assignments)
 *   - deletion_audit_log:        "audit log insertable by admin/manager"
 *   - user_profiles:             "profiles_admin_all" (is_admin)
 * Since none of that needs elevated/service-role access, this is a straight
 * port to direct supabase-js calls — same tables, same order, same RLS gate.
 */
import { supabase } from '@/integrations/supabase/client';

// Mirrors PLANT_REF_TABLES in backend/admin_service.py — used only to build
// the informational "dependencies" snapshot stored on the audit row.
const PLANT_REF_TABLES = [
  'wells', 'locators', 'ro_trains',
  'well_readings', 'locator_readings', 'ro_train_readings',
  'afm_readings', 'cartridge_readings', 'pump_readings',
  'ro_pretreatment_readings',
  'power_readings', 'electric_bills', 'power_tariffs',
  'chemical_inventory', 'chemical_deliveries', 'chemical_dosing_logs',
  'chemical_residual_samples', 'chemical_prices',
  'cip_logs',
  'daily_plant_summary', 'downtime_events', 'incidents',
  'checklist_templates', 'train_status_log', 'production_costs',
  'notifications',
];

// Mirrors _PLANT_NO_CASCADE_CHILDREN — tables whose plant_id FK has no
// ON DELETE CASCADE, so they must be cleared before the plant row itself.
const PLANT_NO_CASCADE_CHILDREN = [
  'well_meter_replacements',
  'well_pms_records',
  'well_readings',
  'locator_meter_replacements',
  'locator_readings',
  'ro_train_readings',
  'ro_train_replacements', // legacy/optional — may not exist in every DB
  'incidents',
  'checklist_executions',
];

/** Mirrors admin_helpers.py's is_missing_table_error(). */
function isMissingTableError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('does not exist')
    || lower.includes('schema cache')
    || lower.includes('could not find the table')
    || lower.includes('pgrst205')
    || lower.includes('relation')
  );
}

async function countRefs(table: string, plantId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from(table as any)
      .select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function plantDependencies(plantId: string) {
  const refs: { table: string; count: number }[] = [];
  let total = 0;
  for (const table of PLANT_REF_TABLES) {
    const n = await countRefs(table, plantId);
    if (n) {
      refs.push({ table, count: n });
      total += n;
    }
  }
  let assignedUsers = 0;
  try {
    const { count } = await supabase
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .contains('plant_assignments', [plantId]);
    assignedUsers = count ?? 0;
  } catch {
    // best-effort, mirrors backend
  }
  return {
    plant_id: plantId,
    references: refs,
    total_references: total,
    assigned_users: assignedUsers,
    blocking: total > 0 || assignedUsers > 0,
  };
}

async function scrubPlantAssignments(plantId: string): Promise<void> {
  try {
    const { data: assigned } = await supabase
      .from('user_profiles')
      .select('id, plant_assignments')
      .contains('plant_assignments', [plantId]);
    for (const prof of assigned ?? []) {
      const next = ((prof as any).plant_assignments ?? []).filter((p: string) => p !== plantId);
      await supabase.from('user_profiles').update({ plant_assignments: next }).eq('id', (prof as any).id);
    }
  } catch {
    // Best-effort, same as backend — never block the parent delete on this.
  }
}

async function clearNoCascadeChildren(plantId: string): Promise<Record<string, number>> {
  const deletedCounts: Record<string, number> = {};
  for (const table of PLANT_NO_CASCADE_CHILDREN) {
    const { count, error } = await supabase
      .from(table as any)
      .delete({ count: 'exact' })
      .eq('plant_id', plantId);
    if (error) {
      if (isMissingTableError(error.message)) continue;
      throw new Error(`Failed clearing ${table} for this plant: ${error.message}`);
    }
    deletedCounts[table] = count ?? 0;
  }
  return deletedCounts;
}

export interface CleanupPlantsResult {
  ok: true;
  processed: { name: string; plant_id: string; deleted_counts: Record<string, number> }[];
  not_found: string[];
  actor_label: string | null;
}

/**
 * Bulk hard-delete plants by name. Mirrors cleanup_plants() exactly:
 * validate -> resolve each name -> snapshot deps -> write audit row FIRST
 * -> clear no-cascade children -> scrub plant_assignments -> delete plant.
 *
 * Authorization is NOT re-checked here in JS — RLS is the actual gate (a
 * non-Admin caller's deletes/inserts above will simply fail or no-op under
 * the policies listed at the top of this file). Callers should still gate
 * the UI on `isAdmin` for a good experience, same as BadImportCleanupCard.
 */
export async function cleanupPlants({
  names,
  reason,
  actorUserId,
  actorLabel,
}: {
  names: string[];
  reason: string;
  actorUserId: string;
  actorLabel: string | null;
}): Promise<CleanupPlantsResult> {
  const cleanedNames = names.map((n) => n.trim()).filter(Boolean);
  if (!cleanedNames.length) throw new Error('`names` must contain non-empty strings.');
  if (!reason || reason.trim().length < 5) {
    throw new Error('`reason` is required and must be at least 5 characters.');
  }

  const processed: CleanupPlantsResult['processed'] = [];
  const notFound: string[] = [];

  for (const name of cleanedNames) {
    const { data: row, error: lookupErr } = await supabase
      .from('plants')
      .select('id, name')
      .eq('name', name)
      .maybeSingle();
    // Was: error discarded — a failed lookup for a plant that genuinely
    // exists silently landed in `notFound` alongside plants that actually
    // don't exist, indistinguishable to the caller. In a bulk operation
    // that matters: the admin sees an unexpected "not found" for a real
    // plant and has no way to tell it was a fetch failure, not a typo.
    if (lookupErr) throw new Error(`Lookup failed for '${name}': ${lookupErr.message}`);
    if (!row) {
      notFound.push(name);
      continue;
    }
    const plantId = row.id as string;

    // Snapshot dependency counts before mutation (audit + response only).
    const deps = await plantDependencies(plantId);

    // Audit FIRST — even if a downstream delete fails, the caller has a trail.
    const { error: auditError } = await supabase.from('deletion_audit_log').insert({
      kind: 'plant',
      entity_id: plantId,
      entity_label: ((row.name as string) || '').slice(0, 200) || null,
      action: 'hard',
      actor_user_id: actorUserId,
      actor_label: actorLabel,
      reason: `[CLEANUP] ${reason.trim()}`.slice(0, 500),
      dependencies: deps,
    });
    if (auditError) {
      throw new Error(`Failed to write audit log for '${name}': ${auditError.message}`);
    }

    let deletedCounts: Record<string, number>;
    try {
      deletedCounts = await clearNoCascadeChildren(plantId);
    } catch (e) {
      throw new Error(`Cleanup failed mid-flight for '${name}': ${(e as Error).message}`);
    }
    await scrubPlantAssignments(plantId);

    // Finally drop the plant; CASCADE removes wells/locators/ro_trains/etc.
    const { error: plantDeleteError } = await supabase.from('plants').delete().eq('id', plantId);
    if (plantDeleteError) {
      throw new Error(`Cleanup failed mid-flight for '${name}': ${plantDeleteError.message}`);
    }
    deletedCounts.plants = 1;

    processed.push({ name, plant_id: plantId, deleted_counts: deletedCounts });
  }

  return { ok: true, processed, not_found: notFound, actor_label: actorLabel };
}
