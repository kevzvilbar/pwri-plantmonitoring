/**
 * usePlantSelectionGuard — P5-2 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * The selected plant is persisted in localStorage. Signing out clears it, but
 * a session can also end without an explicit sign-out (expiry, another tab, a
 * shared tablet left on a login screen), and a user's plant assignment can
 * change. Either way the stored id can point at a plant the current user
 * cannot see, which leaves the TopBar picker blank while other screens carry
 * on with an invisible plant. Clear it as soon as it is known to be stale.
 *
 * Mounted once, by the TopBar, which is on every authenticated screen.
 */
import { useEffect } from 'react';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { usePlantStore } from '@/store/plantStore';
import { isStaleSelection } from '@/shared/activePlant';

export function usePlantSelectionGuard(): void {
  const { plants, isLoading, needsAssignment } = useVisiblePlants();
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
  const setSelectedPlantId = usePlantStore((s) => s.setSelectedPlantId);

  useEffect(() => {
    if (isLoading) return;
    if (isStaleSelection(plants, selectedPlantId, needsAssignment)) {
      setSelectedPlantId(null);
    }
  }, [isLoading, plants, selectedPlantId, needsAssignment, setSelectedPlantId]);
}
