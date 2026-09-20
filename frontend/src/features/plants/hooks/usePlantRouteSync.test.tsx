import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const visible = vi.hoisted(() => ({ plants: [] as Array<{ id: string }> }));
vi.mock('@/hooks/useVisiblePlants', () => ({
  useVisiblePlants: () => ({ plants: visible.plants, plantIds: visible.plants.map((p) => p.id), seesAll: true, isLoading: false, needsAssignment: false }),
}));

import { usePlantRouteSync } from './usePlantRouteSync';
import { usePlantStore } from '@/store/plantStore';
import { useParams } from 'react-router-dom';

const A = { id: 'a' };
const B = { id: 'b' };
const C = { id: 'c' };

let path = '';
function Probe() {
  path = useLocation().pathname;
  return null;
}
function Page() {
  const { id } = useParams();
  usePlantRouteSync(id);
  return <Probe />;
}
function App({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/plants" element={<Page />} />
        <Route path="/plants/:id" element={<Page />} />
        <Route path="/plants/:id/wells/:wellId" element={<Page />} />
      </Routes>
    </MemoryRouter>
  );
}
const sel = () => usePlantStore.getState().selectedPlantId;

describe('usePlantRouteSync (P5-2)', () => {
  beforeEach(() => {
    visible.plants = [A, B, C];
    usePlantStore.setState({ selectedPlantId: null });
    path = '';
  });

  it('opening a facility makes it the active plant (picker was on "All plants")', () => {
    render(<App start="/plants/b" />);
    expect(sel()).toBe('b');
    expect(path).toBe('/plants/b');
  });

  it('opening a facility does NOT bounce to a stale persisted plant (the old bug)', () => {
    usePlantStore.setState({ selectedPlantId: 'a' });
    render(<App start="/plants/b" />);
    expect(path).toBe('/plants/b');
    expect(sel()).toBe('b');
  });

  it('does not touch the list page', () => {
    usePlantStore.setState({ selectedPlantId: 'a' });
    render(<App start="/plants" />);
    expect(path).toBe('/plants');
    expect(sel()).toBe('a');
  });

  it('never selects a plant the user cannot see', () => {
    visible.plants = [A];
    render(<App start="/plants/zzz" />);
    expect(sel()).toBeNull();
    expect(path).toBe('/plants/zzz');
  });

  it('waits for the plant list, then syncs', () => {
    visible.plants = [];
    const { rerender } = render(<App start="/plants/b" />);
    expect(sel()).toBeNull();
    visible.plants = [A, B];
    rerender(<App start="/plants/b" />);
    expect(sel()).toBe('b');
  });

  it('changing the picker while a facility is open moves to that facility', () => {
    render(<App start="/plants/b" />);
    act(() => usePlantStore.getState().setSelectedPlantId('c'));
    expect(path).toBe('/plants/c');
    expect(sel()).toBe('c');
  });

  it('clearing the picker to "All plants" returns to the list, and is not re-selected', () => {
    render(<App start="/plants/b" />);
    act(() => usePlantStore.getState().setSelectedPlantId(null));
    expect(path).toBe('/plants');
    expect(sel()).toBeNull();
  });

  it('from a well page, changing plant leaves the well (it belongs to the old plant)', () => {
    render(<App start="/plants/b/wells/w1" />);
    expect(sel()).toBe('b');
    act(() => usePlantStore.getState().setSelectedPlantId('c'));
    expect(path).toBe('/plants/c');
  });
});
