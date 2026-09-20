/**
 * Plant visibility rule — P5-1 / D5 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 *   Admin, Manager, Data Analyst → every plant.
 *   Everyone else                → only the plants in their profile's
 *                                  `plant_assignments`.
 *   Nobody assigned              → no plants. The UI says "ask an admin to
 *                                  assign a plant"; there is no silent
 *                                  fall-back to "everything".
 *
 * The all-plants group mirrors the database helper
 * `is_manager_or_analyst_or_admin()`.
 *
 * This is a UX scoping rule, not a security boundary. The `plants` table is
 * publicly readable, so this filter is the only thing that narrows the plant
 * list in the UI; row-level access to readings and the like is enforced by
 * RLS, per table.
 *
 * Pure and React-free on purpose. Components use `useVisiblePlants()`
 * (hooks/useVisiblePlants.ts), which feeds this the signed-in user's roles
 * and assignments.
 */

/** Roles that see every plant regardless of assignment. */
export const ALL_PLANT_ROLES = ['Admin', 'Manager', 'Data Analyst'] as const;

/** True when any of the user's roles grants visibility of every plant. */
export function seesAllPlants(roles: readonly string[] | null | undefined): boolean {
  if (!roles?.length) return false;
  const privileged: readonly string[] = ALL_PLANT_ROLES;
  return roles.some((role) => privileged.includes(role));
}

/**
 * The plants a user may see.
 *
 * Returns the input array itself (not a copy) for the all-plants group, so a
 * memoised caller keeps a stable reference.
 */
export function resolveVisiblePlants<T extends { id: string }>(
  plants: T[],
  roles: readonly string[] | null | undefined,
  assignments: readonly string[] | null | undefined,
): T[] {
  if (seesAllPlants(roles)) return plants;
  if (!assignments?.length) return [];
  const assigned = new Set(assignments);
  return plants.filter((plant) => assigned.has(plant.id));
}
