import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * P5-1 (D5): the alert runtime must compute alarms only for plants the user
 * may see, then narrow by the global picker. Uses the REAL useVisiblePlants;
 * only auth, the plants query and the Dashboard domain hooks are faked.
 */

type Auth = { roles: string[]; assignments: string[] };
let auth: Auth;

const PLANTS = [
  { id: 'p1', name: 'Plant 1' },
  { id: 'p2', name: 'Plant 2' },
  { id: 'p3', name: 'Plant 3' },
];

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    roles: [...auth.roles],
    profile: { plant_assignments: [...auth.assignments] },
    loading: false,
  }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: PLANTS, isLoading: false }) }));
vi.mock('./useAlertEvents', () => ({
  useAlertEvents: () => ({
    record: vi.fn().mockResolvedValue(true),
    statuses: {},
    loaded: true,
    isRecording: false,
  }),
}));

const useProductionStats = vi.fn();
const useQualityStats = vi.fn();
const usePowerStats = vi.fn();
const useDashboardAlerts = vi.fn();
vi.mock('@/pages/Dashboard/hooks', () => ({
  useProductionStats: (a: unknown) => { useProductionStats(a); return { todayWells: [], production: [], nrw: null, nrwBreached: false }; },
  useQualityStats: (a: unknown) => {
    useQualityStats(a);
    return { latestRO: [], roAvgFlowByTrain: new Map(), recentPretreatment: [], latestPumpReadings: [], qualityTrainMeta2: new Map() };
  },
  usePowerStats: (a: unknown) => {
    usePowerStats(a);
    return { powerAvgByPlant: new Map(), prevPowerRowByPlant: new Map(), todayPower: [], powerIsStale: false };
  },
  useDashboardAlerts: (a: unknown) => { useDashboardAlerts(a); },
}));

import { useAlertsData } from './useAlertsData';
import { usePlantStore } from '@/store/plantStore';

const lastAlertsArgs = () => useDashboardAlerts.mock.calls.at(-1)![0] as { plantIds: string[]; plants: { id: string }[] };

describe('useAlertsData plant scope (P5-1 / D5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlantStore.setState({ selectedPlantId: null });
    auth = { roles: ['Operator'], assignments: ['p1', 'p3'] };
  });

  it('computes only for the plants an Operator is assigned', () => {
    const { result } = renderHook(() => useAlertsData());
    expect(result.current.plantIds).toEqual(['p1', 'p3']);
    expect(lastAlertsArgs().plantIds).toEqual(['p1', 'p3']);
    expect(useProductionStats.mock.calls.at(-1)![0].plantIds).toEqual(['p1', 'p3']);
  });

  it('computes for every plant for a Data Analyst, even one who happens to have an assignment', () => {
    // The old inline rule narrowed anyone with an assignment to those plants.
    auth = { roles: ['Data Analyst'], assignments: ['p1'] };
    const { result } = renderHook(() => useAlertsData());
    expect(result.current.plantIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('narrows by the picker, but never beyond what the user may see', () => {
    usePlantStore.setState({ selectedPlantId: 'p3' });
    const { result } = renderHook(() => useAlertsData());
    expect(result.current.plantIds).toEqual(['p3']);

    // A stale selection outside the user's plants must NOT widen access.
    usePlantStore.setState({ selectedPlantId: 'p2' });
    const stale = renderHook(() => useAlertsData());
    expect(stale.result.current.plantIds).toEqual([]);
  });

  it('computes for nothing when a non-privileged user has no assignments (no fall-back to all)', () => {
    auth = { roles: ['Technician'], assignments: [] };
    const { result } = renderHook(() => useAlertsData());
    expect(result.current.plantIds).toEqual([]);
    expect(lastAlertsArgs().plants).toEqual([]);
  });

  it('exposes a stable plantIdsKey', () => {
    const { result } = renderHook(() => useAlertsData());
    expect(result.current.plantIdsKey).toBe('p1,p3');
  });
});
