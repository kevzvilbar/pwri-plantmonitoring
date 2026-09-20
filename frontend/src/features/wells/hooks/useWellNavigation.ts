/**
 * useWellNavigation — P5-3 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * Opening and leaving a well's detail page.
 *
 * `openWell` pushes a history entry and marks it as coming from the list.
 * `backToWells` then uses real history when it can, so the list is exactly as
 * the user left it, and otherwise (bookmark, shared link, refresh into a fresh
 * tab) replaces the entry with the list URL so the page never traps the user.
 */
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FROM_WELLS_LIST, cameFromWellsList, wellDetailPath, wellsListPath } from '../lib/wellRoutes';

export function useWellNavigation(plantId: string) {
  const navigate = useNavigate();
  const location = useLocation();

  const openWell = useCallback(
    (wellId: string) => navigate(wellDetailPath(plantId, wellId), { state: FROM_WELLS_LIST }),
    [navigate, plantId],
  );

  const backToWells = useCallback(() => {
    if (cameFromWellsList(location.state)) navigate(-1);
    else navigate(wellsListPath(plantId), { replace: true });
  }, [navigate, location.state, plantId]);

  return { openWell, backToWells };
}
