/**
 * Well routes — P5-3 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * A well's detail view used to be `useState` inside <WellsList>, so it had no
 * URL: it could not be linked, bookmarked or reloaded, and the browser Back
 * button left the plant instead of returning to the wells list. It is now a
 * child route of the plant, `/plants/:id/wells/:wellId`.
 */

/** The wells list of a plant: the Wells tab of the facility page. */
export const wellsListPath = (plantId: string): string => `/plants/${plantId}?tab=wells`;

/** One well, inside its plant. */
export const wellDetailPath = (plantId: string, wellId: string): string =>
  `/plants/${plantId}/wells/${wellId}`;

/**
 * Router state attached when a well is opened from the wells list. It lets
 * "Back to Wells" use real history (so the list keeps its scroll position) when
 * there is a list entry to return to, and fall back to the list URL when the
 * page was reached some other way (a bookmark, a shared link).
 */
export const FROM_WELLS_LIST = { fromWellsList: true } as const;

export function cameFromWellsList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { fromWellsList?: unknown }).fromWellsList === true;
}

export type WellViewState = 'loading' | 'error' | 'not-found' | 'ready';

/**
 * What the well page should show. A URL can name a well that does not exist,
 * that RLS hides from this user, or that belongs to a different plant than the
 * one in the path. None of those may spin forever or show another plant's well
 * under this plant's page.
 */
export function resolveWellView(args: {
  well: { plant_id?: string | null } | null | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The plant in the URL. Omit to skip the ownership check. */
  plantId?: string;
}): WellViewState {
  const { well, isLoading, isError, plantId } = args;
  if (well) {
    if (plantId && well.plant_id && well.plant_id !== plantId) return 'not-found';
    return 'ready';
  }
  if (isLoading) return 'loading';
  if (isError) return 'error';
  return 'not-found';
}
