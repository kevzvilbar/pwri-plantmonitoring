/**
 * usePlantRouteSync — P5-2 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * Keeps `/plants/:id` and the global plant picker (TopBar) telling the same
 * story, in both directions.
 *
 * URL → picker.  Opening a facility (from the Dashboard, an alert, a link)
 *   makes it the active plant, so Daily Readings, Alerts and the rest follow
 *   it. Before, the picker stayed on "All plants" and Operations quietly used
 *   a different plant than the page you had just come from.
 *
 * Picker → URL.  Changing the picker while a facility is open moves to the new
 *   facility, or back to the list for "All plants".
 *
 * The two directions must not fight. URL → picker runs once per route id and
 * only for a plant the user may see. Picker → URL reacts only to a real change
 * of the picker, never to its value at mount. The older single effect treated
 * the persisted value as a change and bounced you off the plant you had just
 * opened onto whichever one was stored.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { usePlantStore } from '@/store/plantStore';

export function usePlantRouteSync(routePlantId: string | undefined): void {
  const navigate = useNavigate();
  const { plants } = useVisiblePlants();
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
  const setSelectedPlantId = usePlantStore((s) => s.setSelectedPlantId);

  // URL → picker, once per route id.
  const syncedRouteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!routePlantId) {
      syncedRouteRef.current = null;
      return;
    }
    if (syncedRouteRef.current === routePlantId) return;
    // Wait until the plant is known to be visible. Never select one the user
    // cannot see; the picker only narrows, it does not widen.
    if (!plants.some((p) => p.id === routePlantId)) return;
    syncedRouteRef.current = routePlantId;
    if (usePlantStore.getState().selectedPlantId !== routePlantId) {
      setSelectedPlantId(routePlantId);
    }
  }, [routePlantId, plants, setSelectedPlantId]);

  // Picker → URL, only on a genuine change of the picker.
  const lastSelectedRef = useRef(selectedPlantId);
  useEffect(() => {
    if (selectedPlantId === lastSelectedRef.current) return;
    lastSelectedRef.current = selectedPlantId;
    if (!routePlantId) return;
    if (selectedPlantId && selectedPlantId !== routePlantId) navigate(`/plants/${selectedPlantId}`);
    else if (!selectedPlantId) navigate('/plants');
  }, [selectedPlantId, routePlantId, navigate]);
}
