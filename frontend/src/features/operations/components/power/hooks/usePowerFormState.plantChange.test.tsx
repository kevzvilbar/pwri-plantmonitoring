import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/** P5-2: the plant is global now, so it can change underneath the Power form
 *  (the user picks another plant in the top bar). Anything typed for the old
 *  plant must be cleared, or it could be submitted against the new one. This
 *  guard used to live in the form's own plant-change handler. */

const active = vi.hoisted(() => ({ plantId: 'p1' }));

vi.mock('@/hooks/useActivePlant', () => ({ useActivePlant: () => ({ plantId: active.plantId }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdmin: false, isManager: false, isDataAnalyst: false }) }));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

import { usePowerFormState } from './usePowerFormState';

describe('usePowerFormState when the global plant changes (P5-2)', () => {
  beforeEach(() => { active.plantId = 'p1'; });

  function typeSomething(result: { current: ReturnType<typeof usePowerFormState> }) {
    act(() => {
      result.current.setReading('12345');
      result.current.setSolarReading('678');
      result.current.setMultiplierInput('2');
      result.current.setEditingId('row-1');
      result.current.setGridMeterReadings(['1', '2', '3', '4', '5']);
      result.current.setSolarMeterReadings(['9', '8', '7', '6', '5']);
      result.current.setAnomalyRemark('meter was swapped');
    });
  }

  it('keeps what was typed while the plant stays the same', () => {
    const { result, rerender } = renderHook(() => usePowerFormState());
    typeSomething(result);
    rerender();
    expect(result.current.reading).toBe('12345');
    expect(result.current.gridMeterReadings[0]).toBe('1');
  });

  it('clears every typed value when the plant changes, so nothing is submitted against the wrong plant', () => {
    const { result, rerender } = renderHook(() => usePowerFormState());
    typeSomething(result);
    expect(result.current.reading).toBe('12345');

    active.plantId = 'p2';
    rerender();

    expect(result.current.plantId).toBe('p2');
    expect(result.current.reading).toBe('');
    expect(result.current.solarReading).toBe('');
    expect(result.current.multiplierInput).toBe('');
    expect(result.current.editingId).toBeNull();
    expect(result.current.gridMeterReadings).toEqual(['', '', '', '', '']);
    expect(result.current.solarMeterReadings).toEqual(['', '', '', '', '']);
    expect(result.current.powerAnomaly).toBeNull();
    expect(result.current.anomalyRemark).toBe('');
  });

  it('also clears when the plant is cleared', () => {
    const { result, rerender } = renderHook(() => usePowerFormState());
    typeSomething(result);
    active.plantId = '';
    rerender();
    expect(result.current.reading).toBe('');
    expect(result.current.gridMeterReadings).toEqual(['', '', '', '', '']);
  });

  it('does not clear anything on first render', () => {
    const { result } = renderHook(() => usePowerFormState());
    expect(result.current.plantId).toBe('p1');
    expect(result.current.editingId).toBeNull();
  });
});
