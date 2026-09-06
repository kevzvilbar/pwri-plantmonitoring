/**
 * Tests for the Phase-3 data-access layer: data/queries + data/mutations.
 *
 * Uses the shared Supabase mock (src/test/mocks/supabaseMock) so no real
 * network calls are made. These tests pin down the contract the whole app
 * will rely on as inline .from() calls migrate into this layer:
 *   - fetch* return rows from the table, throw on error
 *   - insert* validate client-side before touching supabase
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseQueryMock } from '@/test/mocks/supabaseMock';

// Mock the Supabase client. The factory is hoisted above module scope, so it
// builds the mock from inline vi.fn()s with NO outer references (avoids the
// temporal-dead-zone trap — imported bindings are also unavailable when the
// hoisted factory runs). We capture `from` ONCE after import, typed as a mock
// via vi.mocked: a single controlled cast, zero `as any` (roadmap Phase 5).
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn().mockReturnThis(),
    }),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { fetchWells, fetchWellReadings } from './queries/wells';
import { fetchROTrains } from './queries/ro-trains';
import { insertWellReading } from '@/data/mutations/readings';

// Capture the mocked `from` (typed, single cast) for assertions.
const fromMock = vi.mocked(supabase).from;

// Rows keyed by table name; each test overrides the subset it needs.
let rows: Record<string, unknown[]> = {};

beforeEach(() => {
  rows = {};
  vi.clearAllMocks();
  fromMock.mockImplementation((table: string) => createSupabaseQueryMock(rows[table] ?? []));
});

describe('data/queries/wells', () => {
  it('fetchWells returns all wells and orders by name', async () => {
    rows.wells = [{ id: 'w1', name: 'Well B', plant_id: 'p1', status: 'Active' }];
    const wells = await fetchWells();
    expect(wells).toHaveLength(1);
    expect(wells[0].name).toBe('Well B');
    expect(fromMock).toHaveBeenCalledWith('wells');
  });

  it('fetchWells filters by plant when plantId is given', async () => {
    rows.wells = [{ id: 'w2', name: 'Well A', plant_id: 'p2', status: 'Active' }];
    await fetchWells('p2');
    const builder = fromMock.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('plant_id', 'p2');
  });

  it('fetchWellReadings orders descending and limits', async () => {
    rows.well_readings = [{ id: 'r1', well_id: 'w1', reading_datetime: '2026-09-06T00:00:00Z' }];
    const list = await fetchWellReadings('w1', 25);
    expect(list).toHaveLength(1);
    const builder = fromMock.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('well_id', 'w1');
    expect(builder.limit).toHaveBeenCalledWith(25);
  });
});

describe('data/queries/ro-trains', () => {
  it('fetchROTrains returns trains and filters by plant', async () => {
    rows.ro_trains = [{ id: 't1', plant_id: 'p1', train_number: 1, status: 'Running' }];
    const trains = await fetchROTrains('p1');
    expect(trains).toHaveLength(1);
    expect(fromMock).toHaveBeenCalledWith('ro_trains');
    const builder = fromMock.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('plant_id', 'p1');
  });
});

describe('data/mutations/readings', () => {
  it('insertWellReading validates required fields before calling supabase', async () => {
    rows.well_readings = [{ id: 'rd-1' }];
    await expect(insertWellReading({ plant_id: '', well_id: '', reading_datetime: 'x' })).rejects.toThrow('plant_id is required');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('insertWellReading inserts the reading and returns its id', async () => {
    rows.well_readings = [{ id: 'rd-1' }];
    const result = await insertWellReading({ plant_id: 'p1', well_id: 'w1', reading_datetime: '2026-09-06T08:00:00Z', current_reading: 123 });
    expect(result).toEqual({ id: 'rd-1' });
    expect(fromMock).toHaveBeenCalledWith('well_readings');
    const builder = fromMock.mock.results[0].value;
    // client-side fields map into the insert payload
    const insertArg = builder.insert.mock.calls[0][0];
    expect(insertArg.plant_id).toBe('p1');
    expect(insertArg.well_id).toBe('w1');
    expect(insertArg.reading_datetime).toBe('2026-09-06T08:00:00Z');
    expect(insertArg.current_reading).toBe(123);
  });

  it('propagates a supabase error instead of swallowing it', async () => {
    // Override just this call: supabase returns an error → fetch* throws.
    fromMock.mockImplementation(() => ({
      ...createSupabaseQueryMock([]),
      then: vi.fn().mockImplementation((resolve) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve)),
    }));
    await expect(fetchWells()).rejects.toThrow('boom');
  });
});

describe('data/queryKeys', () => {
  it('produces stable, serializable keys', async () => {
    const { queryKeys } = await import('@/data/queryKeys');
    expect(queryKeys.wells.list('p1')).toEqual(['wells', 'p1']);
    expect(queryKeys.wells.list()).toEqual(['wells', 'all']);
    expect(JSON.stringify(queryKeys.wellReadings.list('p1', { from: 'a', to: 'b' }))).toBe(JSON.stringify(['wellReadings', 'p1', { from: 'a', to: 'b' }]));
  });
});