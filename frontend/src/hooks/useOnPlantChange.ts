/**
 * useOnPlantChange — P5-2 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * Runs `onChange` when the active plant changes, but not on the first render.
 *
 * Why this exists: the plant is now global, so it can change underneath a form
 * (the user picks another plant in the TopBar). Anything typed for the old
 * plant must be dropped, or it could be submitted against the new one. The
 * Power form used to get this for free from its own `handlePlantChange`; a
 * global plant needs an explicit hook.
 */
import { useEffect, useRef } from 'react';

export function useOnPlantChange(plantId: string, onChange: () => void): void {
  const last = useRef(plantId);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (last.current === plantId) return;
    last.current = plantId;
    latest.current();
  }, [plantId]);
}
