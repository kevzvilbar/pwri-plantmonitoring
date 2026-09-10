import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProductionStats } from './useProductionStats';
import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useProductionStats — Server-Side Aggregations & Fallbacks', () => {
  const defaultParams = {
    plantIds: ['plant-uuid-1', 'plant-uuid-2'],
    today: '2026-09-10T00:00:00.000Z',
    yesterday: '2026-09-09T00:00:00.000Z',
    _localDateStr: '2026-09-10',
    _yesterdayKey: '2026-09-09',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses server aggregates when get_dashboard_aggregates succeeds', async () => {
    const mockAggregates = {
      raw_water_vol: 12500.5,
      y_raw_water_vol: 12000.0,
      production: 11200.0,
      y_production: 10800.0,
      consumption: 10500.0,
      y_consumption: 10100.0,
      blending: 350.0,
      nrw: 6.25,
      y_nrw: 6.48,
      by_plant: [
        {
          plant_id: 'plant-uuid-1',
          plant_name: 'Plant North',
          raw_water_vol: 6500.5,
          production: 5800.0,
          consumption: 5400.0,
          blending: 200.0,
          nrw: 6.9,
        },
        {
          plant_id: 'plant-uuid-2',
          plant_name: 'Plant South',
          raw_water_vol: 6000.0,
          production: 5400.0,
          consumption: 5100.0,
          blending: 150.0,
          nrw: 5.56,
        },
      ],
    };

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockAggregates,
      error: null,
    });

    const { result } = renderHook(() => useProductionStats(defaultParams), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.serverAggregates).toEqual(mockAggregates);
    });

    expect(result.current.production).toBe(11200.0);
    expect(result.current.consumption).toBe(10500.0);
    expect(result.current.rawWaterVol).toBe(12500.5);
    expect(result.current.yProduction).toBe(10800.0);
    expect(result.current.yConsumption).toBe(10100.0);
    expect(result.current.yRawWaterVol).toBe(12000.0);
    expect(result.current.blending).toBe(350.0);
    expect(result.current.nrw).toBe(6.25);
    expect(result.current.yNrw).toBe(6.48);
    expect(result.current.serverAggregates?.by_plant).toHaveLength(2);
  });

  it('falls back seamlessly to client computation if RPC returns an error', async () => {
    (supabase.rpc as any).mockResolvedValueOnce({
      data: null,
      error: new Error('Network timeout'),
    });

    const { result } = renderHook(() => useProductionStats(defaultParams), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // serverAggregates is null due to RPC error fallback
      expect(result.current.serverAggregates).toBeNull();
    });

    // Fallback computes from client reading rows (which default to 0 with empty mocks)
    expect(result.current.production).toBe(0);
    expect(result.current.consumption).toBe(0);
    expect(result.current.rawWaterVol).toBe(0);
    expect(result.current.blending).toBe(0);
    expect(result.current.nrw).toBe(0);
  });
});
