/**
 * selectKpiOperators.ts: who counts as an "evaluated operator" in the KPI tab.
 *
 * Why this is not just "role === 'Operator'":
 *   - The staff list comes from get_all_staff_profiles (SECURITY DEFINER), so it
 *     holds everyone. The roles list comes from get_all_user_roles, which is
 *     row-level-security scoped: an Operator only receives roles of people who
 *     share a plant with them (migration 20261004000004), and before that
 *     migration only their own. So a person's role can be unknown here.
 *   - When a role is unknown we fall back to the profile designation, but ONLY
 *     the exact value 'Operator' (the same definition OperatorSwitcher uses).
 *     An earlier attempt treated every designation that was not Admin or
 *     Manager as an operator, which listed all accounts.
 *   - A role that IS known always wins over the designation (designation is
 *     free text set at onboarding; roles are assigned by an Admin).
 *   - Viewers who are not Admin / Manager / Data Analyst only see operators
 *     who share a plant with them, matching profiles_select_colleagues.
 */
import type { StaffMember } from '../../types';

export interface RoleRow {
  user_id: string;
  role: string;
}

export interface KpiViewer {
  roles: readonly string[];
  plantIds: readonly string[];
}

const ELEVATED_ROLES = ['Admin', 'Manager', 'Data Analyst'] as const;

export function selectKpiOperators(
  staff: readonly StaffMember[],
  roles: readonly RoleRow[],
  viewer: KpiViewer,
): StaffMember[] {
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of roles) {
    if (!r.user_id || !r.role) continue;
    const set = rolesByUser.get(r.user_id) ?? new Set<string>();
    set.add(r.role);
    rolesByUser.set(r.user_id, set);
  }

  const elevated = viewer.roles.some((r) => (ELEVATED_ROLES as readonly string[]).includes(r));
  const viewerPlants = new Set(viewer.plantIds);

  return staff.filter((s) => {
    if (s.status !== 'Active') return false;

    if (!elevated && !(s.plant_assignments ?? []).some((p) => viewerPlants.has(p))) return false;

    const known = rolesByUser.get(s.id);
    if (known && known.size > 0) return known.has('Operator');
    return s.designation === 'Operator';
  });
}
