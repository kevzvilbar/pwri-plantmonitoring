/**
 * queryKeys.ts — query-key factory for the data access layer (roadmap Phase 3).
 *
 * Centralizes every key under a single, typed factory so:
 *   - a key change (renaming, adding params) updates every consumer at once,
 *   - React Query cache shape is consistent across hooks and components,
 *   - cross-page invalidation (e.g. "operator logged a well reading" must
 *     refresh the Operations tab AND Data Analysis) has one place to hook.
 *
 * Convention: `['wellReadings', plantId, { from, to }]` — scalar params FIRST,
 * object options LAST, so list vs detail keys never collide.
 */

export const queryKeys = {
  plants: {
    list: () => ['plants'] as const,
    byId: (id: string) => ['plants', id] as const,
  },
  wells: {
    list: (plantId?: string) => ['wells', plantId ?? 'all'] as const,
  },
  roTrains: {
    list: (plantId?: string) => ['ro_trains', plantId ?? 'all'] as const,
  },
  wellReadings: {
    list: (plantId: string, opts?: { from?: string; to?: string }) =>
      ['wellReadings', plantId, opts ?? {}] as const,
  },
  powerReadings: {
    list: (plantId: string) => ['powerReadings', plantId] as const,
  },
  compliance: {
    snapshots: (plantId: string) => ['complianceSnapshots', plantId] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;