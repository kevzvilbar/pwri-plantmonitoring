/**
 * Asset <-> readings links — P5-7 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * An asset (well, locator, product meter) shows up in two places: its own page
 * under Plants, and its row in Daily Readings (`/operations`). Each side links
 * to the other, and both sides must agree on the URL, or a link lands on the
 * wrong tab or highlights nothing.
 *
 * They used to be hand-built strings in a dozen call sites. That is how the
 * "Plant detail" link on a well's reading row went stale: P5-3 gave a well its
 * own page, but the reading row kept pointing at the wells list. Build every
 * such link here instead.
 */
import { wellDetailPath } from '@/features/wells/lib/wellRoutes';

export type AssetKind = 'well' | 'locator' | 'product';

/**
 * The asset's own page in Plants.
 *
 * A well has a page of its own (`/plants/:id/wells/:wellId`). Locators and
 * product meters are cards on a tab of the plant, so they link to that tab with
 * `?highlight=` scrolling the card into view and pulsing it.
 */
export function assetPath(kind: AssetKind, plantId: string, id: string): string {
  switch (kind) {
    case 'well':
      return wellDetailPath(plantId, id);
    case 'locator':
      return `/plants/${plantId}?tab=locators&highlight=${id}`;
    case 'product':
      return `/plants/${plantId}?tab=product&highlight=${id}`;
  }
}

/**
 * The asset's row in Daily Readings. The plant is not part of the URL: the page
 * reads it from the global plant picker, which opening a plant page sets.
 */
export function readingsPath(kind: AssetKind, id: string): string {
  return `/operations?tab=${kind}&highlight=${id}`;
}
