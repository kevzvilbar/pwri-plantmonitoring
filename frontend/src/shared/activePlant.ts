/**
 * Active-plant resolution — P5-2 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * "Which plant is this screen about?" used to be answered five different ways:
 * a local `useState('')` in every Operations form (mirrored to the global
 * picker by <PlantSelector>), and a `plants?.[0]` fallback on the page header
 * that silently showed the first plant's counts while the forms below showed
 * nothing. There is now one answer.
 *
 *   1. The globally selected plant, if the user is allowed to see it.
 *   2. Otherwise, the only plant the user can see. "All plants" and that one
 *      plant are the same set, so there is nothing to ask.
 *   3. Otherwise none: the caller must ask (`needsSelection`). There is no
 *      "first plant in the list" fallback.
 *
 * Pure and React-free on purpose, like shared/plantVisibility.ts. Components
 * use `useActivePlant()` (hooks/useActivePlant.ts).
 */

export interface ActivePlantResolution<T> {
  /** The resolved plant, or null when the caller has to ask. */
  plant: T | null;
  /** Several plants are visible and none is chosen. */
  needsSelection: boolean;
}

export function resolveActivePlant<T extends { id: string }>(
  visiblePlants: readonly T[],
  selectedPlantId: string | null | undefined,
): ActivePlantResolution<T> {
  const chosen = selectedPlantId
    ? visiblePlants.find((p) => p.id === selectedPlantId) ?? null
    : null;
  if (chosen) return { plant: chosen, needsSelection: false };

  if (visiblePlants.length === 1) return { plant: visiblePlants[0], needsSelection: false };

  return { plant: null, needsSelection: visiblePlants.length > 1 };
}

/**
 * True when the stored selection points at a plant this user cannot see, e.g.
 * it was left behind by the previous person on a shared device, or the user's
 * assignment was removed.
 *
 * Deliberately conservative: an empty plant list is ambiguous (the list may
 * have failed to load while offline) so it only counts as stale when the user
 * is known to have no plants at all (`needsAssignment`).
 */
export function isStaleSelection(
  visiblePlants: readonly { id: string }[],
  selectedPlantId: string | null | undefined,
  needsAssignment: boolean,
): boolean {
  if (!selectedPlantId) return false;
  if (needsAssignment) return true;
  if (visiblePlants.length === 0) return false;
  return !visiblePlants.some((p) => p.id === selectedPlantId);
}
