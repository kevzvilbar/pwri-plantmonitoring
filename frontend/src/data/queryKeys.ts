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
    metrics: (plantId: string, days: number, from?: string, to?: string) => ['compliance', 'metrics', plantId, days, from, to] as const,
    chemSupply: (plantId: string, lookbackDays: number) => ['compliance', 'chem-supply', plantId, lookbackDays] as const,
    previousMetrics: (plantId: string, days: number) => ['compliance', 'previous-metrics', plantId, days] as const,
    thresholds: (scope: string) => ['compliance', 'thresholds', scope] as const,
    fleet: (plants: Array<{ id: string; name: string }>, days: number) => ['compliance', 'fleet', plants.map(p => p.id).join(','), days] as const,
  },
  staff: {
    list: () => ['staff'] as const,
    roles: () => ['staff', 'roles'] as const,
    plantsWithStaff: () => ['staff', 'plants-with-staff'] as const,
    plantFlags: () => ['staff', 'plant-flags'] as const,
    entityCounts: () => ['staff', 'entity-counts'] as const,
    kpiReadings: (range: 'today' | number) => ['staff', 'kpi-readings', range] as const,
  },
  corrections: {
    pending: () => ['corrections', 'pending'] as const,
    pendingCount: () => ['corrections', 'pending-count'] as const,
    requestsCount: () => ['corrections', 'requests-count'] as const,
    inboxCount: () => ['corrections', 'inbox-count'] as const,
    inbox: () => ['corrections', 'inbox'] as const,
    requests: (status?: 'pending' | 'approved' | 'rejected') => ['corrections', 'requests', status ?? 'all'] as const,
    editHistory: (limit: number) => ['corrections', 'edit-history', limit] as const,
    operatorStats: () => ['corrections', 'operator-stats'] as const,
    chain: (table: string, entityId: string, limit: number) => ['corrections', 'chain', table, entityId, limit] as const,
  },
  kpi: {
    plantFlags: () => ['kpi', 'plant-flags'] as const,
    entityCounts: () => ['kpi', 'entity-counts'] as const,
    readings: (since: string) => ['kpi', 'readings', since] as const,
    wellsConfig: () => ['kpi', 'config', 'wells'] as const,
    locatorsConfig: () => ['kpi', 'config', 'locators'] as const,
    trainsConfig: () => ['kpi', 'config', 'trains'] as const,
    metersConfig: () => ['kpi', 'config', 'meters'] as const,
    wellReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'wells', since, refreshKey] as const,
    locatorReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'locators', since, refreshKey] as const,
    roTrainReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'ro-trains', since, refreshKey] as const,
    productMeterReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'product-meters', since, refreshKey] as const,
    powerReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'power', since, refreshKey] as const,
    chemReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'chemical', since, refreshKey] as const,
    blendingReadings: (since: string, refreshKey: number) => ['kpi', 'readings', 'blending', since, refreshKey] as const,
  },
  readingHistory: {
    list: (options: any) => ['reading-history', options.module, options.entityId, options.days, options.appliedFrom, options.appliedTo] as const,
  },
  auth: {
    plantsForSignup: () => ['auth', 'plants-for-signup'] as const,
    operatorPeers: (plantId: string) => ['auth', 'operator-peers', plantId] as const,
    userProfile: (userId: string) => ['auth', 'user-profile', userId] as const,
  },
  imports: {
    entityNameMap: (configId: string, plantId: string) => ['imports', 'entity-map', configId, plantId] as const,
    entityNamesForTemplate: (configId: string, plantId: string) => ['imports', 'entity-names', configId, plantId] as const,
    currentUser: () => ['imports', 'current-user'] as const,
  },
  plantTopology: {
    data: (plantId: string) => ['plant-topology', 'data', plantId] as const,
    links: (plantId: string) => ['plant-topology', 'links', plantId] as const,
    wells: (plantId: string) => ['plant-topology', 'wells', plantId] as const,
    roTrains: (plantId: string) => ['plant-topology', 'ro-trains', plantId] as const,
    locators: (plantId: string) => ['plant-topology', 'locators', plantId] as const,
    productMeters: (plantId: string) => ['plant-topology', 'product-meters', plantId] as const,
    powerConfig: (plantId: string) => ['plant-topology', 'power-config', plantId] as const,
    meterConfig: (plantId: string) => ['plant-topology', 'meter-config', plantId] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;