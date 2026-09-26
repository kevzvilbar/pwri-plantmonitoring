import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { useTrainDataRealtime, trainRealtimeInvalidationKeys, TABLE_INVALIDATION_KEYS } from './useTrainDataRealtime';
import { supabase } from '@/integrations/supabase/client';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

describe('useTrainDataRealtime', () => {
  let mockInvalidateQueries: ReturnType<typeof vi.fn>;
  let mockChannel: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let registeredCallbacks: Record<string, () => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockInvalidateQueries = vi.fn();
    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
    } as any);

    registeredCallbacks = {};

    mockChannel = {
      on: vi.fn().mockImplementation((_event, filter, cb) => {
        if (filter?.table) {
          registeredCallbacks[filter.table] = cb;
        }
        return mockChannel;
      }),
      subscribe: vi.fn().mockReturnThis(),
    };

    vi.mocked(supabase.channel).mockReturnValue(mockChannel as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('trainRealtimeInvalidationKeys returns unique array of all keys', () => {
    const keys = trainRealtimeInvalidationKeys();
    expect(keys.length).toBeGreaterThan(0);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toEqual(uniqueKeys.size);
    expect(keys).toContain('trains');
    expect(keys).toContain('well-readings');
  });

  it('subscribes to channels and debounces invalidation bursts', () => {
    renderHook(() => useTrainDataRealtime());

    expect(supabase.channel).toHaveBeenCalled();

    // Trigger an event on ro_train_readings
    const roCallback = registeredCallbacks['ro_train_readings'];
    expect(roCallback).toBeDefined();

    // Fire 3 quick events
    roCallback();
    roCallback();
    roCallback();

    // Before debounce timer fires, no invalidations yet
    expect(mockInvalidateQueries).not.toHaveBeenCalled();

    // Advance timer by 2000ms
    vi.advanceTimersByTime(2000);

    // Now invalidations should have fired once per key in TABLE_INVALIDATION_KEYS['ro_train_readings']
    const expectedKeys = TABLE_INVALIDATION_KEYS['ro_train_readings'];
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(expectedKeys.length);
    for (const key of expectedKeys) {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});
