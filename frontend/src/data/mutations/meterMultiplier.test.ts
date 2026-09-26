import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createSupabaseQueryMock } from '@/test/mocks/supabaseMock';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { submitMeterMultiplierWorkflow } from './meterMultiplier';

const fromMock = vi.mocked(supabase).from as unknown as Mock<
  (table: string) => ReturnType<typeof createSupabaseQueryMock>
>;

let rows: Record<string, unknown[]> = {};

describe('submitMeterMultiplierWorkflow', () => {
  beforeEach(() => {
    rows = {};
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) => createSupabaseQueryMock(rows[table] ?? []));
  });

  it('submits a multiplier cutover event and updates entity table and reading table', async () => {
    const result = await submitMeterMultiplierWorkflow({
      plantId: 'plant-1',
      entityType: 'well',
      entityId: 'well-1',
      eventType: 'multiplier_cutover',
      effectiveAt: '2026-09-26T08:00:00Z',
      oldReadingValue: 1250,
      oldReadingConvention: 'pre_multiplied',
      newReadingValue: 125,
      newMultiplier: 10,
      newMultiplierEnabled: true,
      performedBy: 'user-1',
      notes: 'Initial x10 cutover',
    });

    expect(result.error).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('meter_events');
    expect(fromMock).toHaveBeenCalledWith('wells');
    expect(fromMock).toHaveBeenCalledWith('well_readings');
  });

  it('submits a physical replacement event with serial numbers', async () => {
    const result = await submitMeterMultiplierWorkflow({
      plantId: 'plant-1',
      entityType: 'locator',
      entityId: 'loc-1',
      eventType: 'physical_replacement',
      effectiveAt: '2026-09-26T08:00:00Z',
      oldReadingValue: 9800,
      oldMeterSerial: 'SN-OLD-1',
      newReadingValue: 0,
      newMultiplier: 10,
      newMultiplierEnabled: true,
      newMeterSerial: 'SN-NEW-2',
      performedBy: 'user-1',
      notes: 'Swapped damaged meter',
    });

    expect(result.error).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('meter_events');
    expect(fromMock).toHaveBeenCalledWith('locators');
    expect(fromMock).toHaveBeenCalledWith('locator_readings');
  });
});

