import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

type AuthMock = {
  roles: string[];
  profile: { plant_assignments: string[] } | null;
  loading: boolean;
};
type PlantsMock = {
  data: { id: string; name: string }[] | undefined;
  isLoading: boolean;
};

const PLANTS = [
  { id: 'p1', name: 'Plant 1' },
  { id: 'p2', name: 'Plant 2' },
  { id: 'p3', name: 'Plant 3' },
];

let auth: AuthMock;
let plantsQuery: PlantsMock;

// Deliberately builds NEW arrays on every call, like a re-rendering provider
// or a sloppy test double would, to prove the hook keys on content.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    roles: [...auth.roles],
    profile: auth.profile ? { plant_assignments: [...auth.profile.plant_assignments] } : null,
    loading: auth.loading,
  }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => plantsQuery }));

import { useVisiblePlants } from '@/hooks/useVisiblePlants';

const signedIn = (roles: string[], assignments: string[]): AuthMock => ({
  roles,
  profile: { plant_assignments: assignments },
  loading: false,
});

const ids = (r: { plants: { id: string }[] }) => r.plants.map((p) => p.id);

describe('useVisiblePlants (P5-1 / D5)', () => {
  beforeEach(() => {
    auth = signedIn(['Operator'], []);
    plantsQuery = { data: PLANTS, isLoading: false };
  });

  describe.each(['Admin', 'Manager', 'Data Analyst'])('%s', (role) => {
    it('sees every plant, even with no assignments', () => {
      auth = signedIn([role], []);
      const { result } = renderHook(() => useVisiblePlants());
      expect(ids(result.current)).toEqual(['p1', 'p2', 'p3']);
      expect(result.current.plantIds).toEqual(['p1', 'p2', 'p3']);
      expect(result.current.seesAll).toBe(true);
      expect(result.current.needsAssignment).toBe(false);
    });

    it('is not narrowed by assignments', () => {
      auth = signedIn([role], ['p1']);
      const { result } = renderHook(() => useVisiblePlants());
      expect(ids(result.current)).toEqual(['p1', 'p2', 'p3']);
    });
  });

  describe.each(['Operator', 'Technician'])('%s', (role) => {
    it('sees only assigned plants', () => {
      auth = signedIn([role], ['p1', 'p3']);
      const { result } = renderHook(() => useVisiblePlants());
      expect(ids(result.current)).toEqual(['p1', 'p3']);
      expect(result.current.seesAll).toBe(false);
      expect(result.current.needsAssignment).toBe(false);
    });

    it('with nobody assigned sees NOTHING and is told to ask an admin', () => {
      auth = signedIn([role], []);
      const { result } = renderHook(() => useVisiblePlants());
      expect(result.current.plants).toEqual([]);
      expect(result.current.plantIds).toEqual([]);
      expect(result.current.needsAssignment).toBe(true);
    });

    it('assigned only to a deleted plant also needs an assignment', () => {
      auth = signedIn([role], ['gone']);
      const { result } = renderHook(() => useVisiblePlants());
      expect(result.current.plants).toEqual([]);
      expect(result.current.needsAssignment).toBe(true);
    });
  });

  it('a user with several roles gets the widest visibility', () => {
    auth = signedIn(['Operator', 'Manager'], []);
    const { result } = renderHook(() => useVisiblePlants());
    expect(ids(result.current)).toEqual(['p1', 'p2', 'p3']);
  });

  it('a signed-in user with no profile row resolves to nothing', () => {
    auth = { roles: [], profile: null, loading: false };
    const { result } = renderHook(() => useVisiblePlants());
    expect(result.current.plants).toEqual([]);
    expect(result.current.needsAssignment).toBe(true);
  });

  it('a Manager with an empty plants table has no plants but needs no assignment', () => {
    auth = signedIn(['Manager'], []);
    plantsQuery = { data: [], isLoading: false };
    const { result } = renderHook(() => useVisiblePlants());
    expect(result.current.plants).toEqual([]);
    expect(result.current.needsAssignment).toBe(false);
  });

  describe('while unresolved', () => {
    it('reports loading, not "no access", while auth is loading (an Admin has no roles yet)', () => {
      auth = { roles: [], profile: null, loading: true };
      const { result } = renderHook(() => useVisiblePlants());
      expect(result.current.isLoading).toBe(true);
      expect(result.current.plants).toEqual([]);
      expect(result.current.needsAssignment).toBe(false);
    });

    it('reports loading while the plants list is loading', () => {
      auth = signedIn(['Operator'], ['p1']);
      plantsQuery = { data: undefined, isLoading: true };
      const { result } = renderHook(() => useVisiblePlants());
      expect(result.current.isLoading).toBe(true);
      expect(result.current.needsAssignment).toBe(false);
    });

    it('does not claim "ask an admin" when the plants list failed to load', () => {
      auth = signedIn(['Operator'], ['p1']);
      plantsQuery = { data: undefined, isLoading: false };
      const { result } = renderHook(() => useVisiblePlants());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.plants).toEqual([]);
      expect(result.current.needsAssignment).toBe(false);
    });

    it('resolves once auth finishes loading', () => {
      auth = { roles: [], profile: null, loading: true };
      const { result, rerender } = renderHook(() => useVisiblePlants());
      expect(result.current.plants).toEqual([]);
      auth = signedIn(['Manager'], []);
      rerender();
      expect(ids(result.current)).toEqual(['p1', 'p2', 'p3']);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('reference stability', () => {
    it('returns the same object across re-renders when nothing changed', () => {
      auth = signedIn(['Operator'], ['p1', 'p2']);
      const { result, rerender } = renderHook(() => useVisiblePlants());
      const first = result.current;
      rerender();
      rerender();
      expect(result.current).toBe(first);
      expect(result.current.plants).toBe(first.plants);
    });

    it('hands back the query result itself for the all-plants group', () => {
      auth = signedIn(['Admin'], []);
      const { result } = renderHook(() => useVisiblePlants());
      expect(result.current.plants).toBe(PLANTS);
    });

    it('recomputes when the assignments actually change', () => {
      auth = signedIn(['Operator'], ['p1']);
      const { result, rerender } = renderHook(() => useVisiblePlants());
      expect(ids(result.current)).toEqual(['p1']);
      auth = signedIn(['Operator'], ['p1', 'p2']);
      rerender();
      expect(ids(result.current)).toEqual(['p1', 'p2']);
    });
  });
});
