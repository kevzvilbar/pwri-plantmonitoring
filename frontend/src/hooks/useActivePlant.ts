/**
 * useActivePlant — P5-2 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * The one plant a data-entry screen is about. It is derived from the global
 * plant picker (TopBar) filtered by what the user may see, never held in local
 * component state, so a form can no longer disagree with the header above it.
 * The resolution rule lives in shared/activePlant.ts.
 */
import { useMemo } from 'react';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { usePlantStore } from '@/store/plantStore';
import type { Plant } from '@/hooks/usePlants';
import { resolveActivePlant } from '@/shared/activePlant';

export interface ActivePlant {
  /** The resolved plant, or null while loading / when the caller must ask. */
  plant: Plant | null;
  /** Id of the active plant; '' when there is none. Safe for query keys. */
  plantId: string;
  /** Plants the user may see, for building a chooser. */
  plants: Plant[];
  isLoading: boolean;
  /** The user has no plants at all: "ask an admin to assign a plant". */
  needsAssignment: boolean;
  /** Several plants are visible and none is chosen: the UI must ask. */
  needsSelection: boolean;
  /** Choose a plant. Writes the global selection, the same one the TopBar shows. */
  select: (plantId: string) => void;
}

export function useActivePlant(): ActivePlant {
  const { plants, isLoading, needsAssignment } = useVisiblePlants();
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
  const setSelectedPlantId = usePlantStore((s) => s.setSelectedPlantId);

  return useMemo<ActivePlant>(() => {
    if (isLoading) {
      return { plant: null, plantId: '', plants, isLoading, needsAssignment, needsSelection: false, select: setSelectedPlantId };
    }

    // The plant list could not be read at all (offline with no cache) and the
    // user is not known to lack plants. Field data entry must keep working, so
    // trust the stored selection rather than blocking on a list we cannot get.
    if (plants.length === 0 && !needsAssignment) {
      return { plant: null, plantId: selectedPlantId ?? '', plants, isLoading, needsAssignment, needsSelection: false, select: setSelectedPlantId };
    }

    const { plant, needsSelection } = resolveActivePlant(plants, selectedPlantId);
    return { plant, plantId: plant?.id ?? '', plants, isLoading, needsAssignment, needsSelection, select: setSelectedPlantId };
  }, [plants, isLoading, needsAssignment, selectedPlantId, setSelectedPlantId]);
}
