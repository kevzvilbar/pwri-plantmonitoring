import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordShiftDuty, endShiftDuty, fetchActiveShiftDuty } from './shiftDuty';
import { supabase } from '@/integrations/supabase/client';

describe('shiftDuty mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a shift duty entry with dual-duty true when partner is provided', async () => {
    const mockData = {
      id: 'duty-1',
      plant_id: 'plant-1',
      operator_id: 'user-1',
      partner_operator_id: 'user-2',
      is_dual_duty: true,
      cycle_key: '2026-09-26-S1',
    };

    vi.spyOn(supabase, 'from').mockReturnValueOnce({
      insert: vi.fn().mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          single: vi.fn().mockResolvedValueOnce({ data: mockData, error: null }),
        }),
      }),
    } as any);

    const res = await recordShiftDuty({
      plantId: 'plant-1',
      operatorId: 'user-1',
      partnerOperatorId: 'user-2',
      cycleKey: '2026-09-26-S1',
      confirmedBy: 'user-1',
    });

    expect(res).toEqual(mockData);
  });

  it('records a shift duty entry with dual-duty false when no partner is provided', async () => {
    const mockData = {
      id: 'duty-2',
      plant_id: 'plant-1',
      operator_id: 'user-1',
      partner_operator_id: null,
      is_dual_duty: false,
      cycle_key: '2026-09-26-S1',
    };

    vi.spyOn(supabase, 'from').mockReturnValueOnce({
      insert: vi.fn().mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          single: vi.fn().mockResolvedValueOnce({ data: mockData, error: null }),
        }),
      }),
    } as any);

    const res = await recordShiftDuty({
      plantId: 'plant-1',
      operatorId: 'user-1',
      cycleKey: '2026-09-26-S1',
    });

    expect(res).toEqual(mockData);
  });

  it('ends a shift duty partnership', async () => {
    const mockData = {
      id: 'duty-1',
      ended_at: '2026-09-26T14:00:00Z',
      ended_by: 'user-1',
      is_dual_duty: false,
    };

    vi.spyOn(supabase, 'from').mockReturnValueOnce({
      update: vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            single: vi.fn().mockResolvedValueOnce({ data: mockData, error: null }),
          }),
        }),
      }),
    } as any);

    const res = await endShiftDuty({ id: 'duty-1', endedBy: 'user-1' });
    expect(res).toEqual(mockData);
  });
});
