/**
 * useVisiblePlants — P5-1 of docs/NAV-IA-REMEDIATION-PLAN.md (rule: D5).
 *
 * The plants the signed-in user is allowed to see. This replaces the inline
 * copies that had drifted apart in the TopBar, the Alerts page, the alert
 * runtime and the Plants page (and the Dashboard, which had none). The rule
 * itself lives in shared/plantVisibility.ts.
 *
 * Callers that also honour the global plant picker filter *this* list by
 * `selectedPlantId`; the picker never widens what a user may see.
 */
import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlants, type Plant } from '@/hooks/usePlants';
import { resolveVisiblePlants, seesAllPlants } from '@/shared/plantVisibility';

const EMPTY_PLANTS: Plant[] = [];
const EMPTY_IDS: string[] = [];

export interface VisiblePlants {
  /** Plants the user may see. A stable empty array while unresolved. */
  plants: Plant[];
  /** Ids of `plants`, for query keys and `.in('plant_id', ...)` filters. */
  plantIds: string[];
  /** True for Admin / Manager / Data Analyst. */
  seesAll: boolean;
  /** Auth or the plants list is still loading. */
  isLoading: boolean;
  /**
   * The user has resolved to zero plants and is not in the all-plants group,
   * so the UI should say "ask an admin to assign a plant". Never true while
   * loading, or when the plants list failed to load.
   */
  needsAssignment: boolean;
}

const LOADING: VisiblePlants = {
  plants: EMPTY_PLANTS,
  plantIds: EMPTY_IDS,
  seesAll: false,
  isLoading: true,
  needsAssignment: false,
};

export function useVisiblePlants(): VisiblePlants {
  const { roles, profile, loading: authLoading } = useAuth();
  const { data: allPlants, isLoading: plantsLoading } = usePlants();

  // Key on content, not identity, so a fresh-but-equal array from a re-render
  // (or a test double) does not hand every consumer a new `plants` reference
  // and re-run their effects. Roles and plant ids never contain '|'.
  const rolesKey = (roles ?? []).join('|');
  const assignmentsKey = (profile?.plant_assignments ?? []).join('|');

  return useMemo<VisiblePlants>(() => {
    // Until both auth and the plants list have resolved, roles are [] and an
    // Admin would momentarily look like an unassigned Operator. Report
    // "loading", not "no access".
    if (authLoading || !allPlants) {
      return plantsLoading || authLoading ? LOADING : { ...LOADING, isLoading: false };
    }

    const roleList = rolesKey ? rolesKey.split('|') : [];
    const assignmentList = assignmentsKey ? assignmentsKey.split('|') : [];
    const seesAll = seesAllPlants(roleList);
    const plants = resolveVisiblePlants(allPlants, roleList, assignmentList);

    return {
      plants,
      plantIds: plants.map((p) => p.id),
      seesAll,
      isLoading: false,
      needsAssignment: !seesAll && plants.length === 0,
    };
  }, [authLoading, plantsLoading, allPlants, rolesKey, assignmentsKey]);
}
