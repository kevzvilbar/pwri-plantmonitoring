import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * P5-1 (D5): the alerts feed (downtime / blending / compliance) must be scoped
 * by the caller's `plantIds`. It used to filter only when a plant was picked,
 * so "All plants" — or a user with no plants — pulled every plant's alerts.
 */

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];

// Records every builder call and resolves like a real (empty) PostgREST query.
function builder(table: string) {
  const b: Record<string, unknown> = {};
  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ table, method, args });
    return b;
  };
  for (const m of ['select', 'gte', 'lt', 'eq', 'in', 'order', 'limit']) b[m] = chain(m);
  b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
  return b;
}
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (t: string) => builder(t) } }));

vi.mock('@/hooks/useReadingGaps', () => ({ useReadingGaps: () => ({ wellGaps: [], locatorGaps: [] }), gapDescription: () => '' }));
vi.mock('@/hooks/useTrainHourlyGaps', () => ({ useTrainHourlyGaps: () => [] }));
vi.mock('@/hooks/useTrainAutoOffline', () => ({ useTrainAutoOffline: () => [] }));

import { useDashboardAlerts } from './useDashboardAlerts';

const FEED_TABLES = ['downtime_events', 'blending_events', 'compliance_snapshots'];

function run(plantIds: string[], selectedPlantId: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useDashboardAlerts({
        selectedPlantId,
        addAlerts: vi.fn(),
        clearConditionAlerts: vi.fn(),
        plants: plantIds.map((id) => ({ id, name: id })),
        plantIds,
        latestRO: [],
        roAvgFlowByTrain: new Map(),
        recentPretreatment: [],
        latestPumpReadings: [],
        powerAvgByPlant: new Map(),
        prevPowerRowByPlant: new Map(),
        todayPower: [],
        powerIsStale: false,
        nrw: null,
        nrwBreached: false,
        qualityTrainMeta2: new Map(),
      } as unknown as Parameters<typeof useDashboardAlerts>[0]),
    { wrapper },
  );
}

const feedCalls = (method: string) =>
  calls.filter((c) => FEED_TABLES.includes(c.table) && c.method === method);

describe('useDashboardAlerts feed scope (P5-1 / D5)', () => {
  beforeEach(() => { calls.length = 0; });

  it('filters all three feed queries to the caller’s plantIds, with no plant picked', async () => {
    run(['p1', 'p3'], null);
    await waitFor(() => expect(feedCalls('in')).toHaveLength(3));

    expect(feedCalls('in').map((c) => c.table).sort()).toEqual([...FEED_TABLES].sort());
    for (const c of feedCalls('in')) expect(c.args).toEqual(['plant_id', ['p1', 'p3']]);
  });

  it('no longer relies on a single-plant .eq() filter', async () => {
    run(['p1'], 'p1');
    await waitFor(() => expect(feedCalls('in')).toHaveLength(3));
    expect(feedCalls('eq')).toHaveLength(0);
    for (const c of feedCalls('in')) expect(c.args).toEqual(['plant_id', ['p1']]);
  });

  it('issues NO feed queries at all when there are no plants (empty means nothing, not all)', async () => {
    const { result } = run([], null);
    // Give React Query a real chance to (wrongly) fire before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => FEED_TABLES.includes(c.table))).toHaveLength(0);
    expect(result.current).toBeDefined();
  });
});
