import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * P5-1 (D5) on the Dashboard: it used to take every plant regardless of
 * assignment. It must now use the shared visibility rule, the same set the
 * alert runtime computes for.
 */

type Visible = { plants: { id: string; name: string }[]; needsAssignment: boolean };
let visible: Visible;

const ALL = [
  { id: 'p1', name: 'Plant 1' },
  { id: 'p2', name: 'Plant 2' },
  { id: 'p3', name: 'Plant 3' },
];

vi.mock('@/hooks/useVisiblePlants', () => ({ useVisiblePlants: () => visible }));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: ALL, isLoading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({}),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/pages/Compliance', () => ({ loadThresholds: () => ({}), DEFAULT_THRESHOLDS: {} }));

const production = vi.fn();
const quality = vi.fn();
const power = vi.fn();
const cost = vi.fn();
vi.mock('./Dashboard/hooks', () => ({
  useProductionStats: (a: unknown) => { production(a); return {}; },
  useQualityStats: (a: unknown) => { quality(a); return {}; },
  usePowerStats: (a: unknown) => { power(a); return {}; },
  useCostStats: (a: unknown) => { cost(a); return {}; },
}));

const hero = vi.fn();
const strip = vi.fn();
vi.mock('@/components/dashboard/PlantPulseHero', () => ({
  PlantPulseHero: (p: { plantIds: string[] }) => { hero(p); return <div data-testid="hero" />; },
}));
vi.mock('@/components/dashboard/PlantHealthStrip', () => ({
  PlantHealthStrip: (p: { plantIds: string[] }) => { strip(p); return <div data-testid="strip" />; },
}));
vi.mock('@/components/dashboard/DashboardSectionNav', () => ({ DashboardSectionNav: () => null }));
vi.mock('@/components/DowntimeEventsModal', () => ({ DowntimeEventsModal: () => null }));
vi.mock('@/components/dashboard/TrendChartWrappers', () => ({ TrendModal: () => null }));
vi.mock('./Dashboard/ActionCenter', () => ({ ActionCenter: () => null }));
vi.mock('./Dashboard/OverviewCluster', () => ({ OverviewCluster: () => null }));
vi.mock('./Dashboard/QualityCluster', () => ({ QualityCluster: () => null }));
vi.mock('./Dashboard/CostCluster', () => ({ CostCluster: () => null }));
vi.mock('./Dashboard/AuditsCluster', () => ({ AuditsCluster: () => null }));
vi.mock('./Dashboard/HealthCluster', () => ({ HealthCluster: () => null }));

import Dashboard from './Dashboard';
import { usePlantStore } from '@/store/plantStore';

const lastIds = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0].plantIds as string[];

describe('Dashboard plant scope (P5-1 / D5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlantStore.setState({ selectedPlantId: null });
    visible = { plants: ALL, needsAssignment: false };
  });

  it('gives the stat hooks and both widgets only the plants the user may see', () => {
    visible = { plants: [ALL[0], ALL[2]], needsAssignment: false };
    render(<Dashboard />);
    for (const fn of [production, quality, power, cost, hero, strip]) {
      expect(lastIds(fn)).toEqual(['p1', 'p3']);
    }
  });

  it('narrows to the picker selection when it is one of the visible plants', () => {
    visible = { plants: [ALL[0], ALL[2]], needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: 'p3' });
    render(<Dashboard />);
    expect(lastIds(production)).toEqual(['p3']);
    expect(lastIds(hero)).toEqual(['p3']);
  });

  it('a stale picker selection outside the visible plants yields NO ids, never widens access', () => {
    visible = { plants: [ALL[0]], needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: 'p2' });
    render(<Dashboard />);
    expect(lastIds(production)).toEqual([]);
    expect(lastIds(hero)).toEqual([]);
  });

  it('an unassigned user gets the explanation and neither widget', () => {
    visible = { plants: [], needsAssignment: true };
    render(<Dashboard />);
    expect(screen.getByText('No plants assigned')).toBeInTheDocument();
    expect(screen.queryByTestId('hero')).toBeNull();
    expect(screen.queryByTestId('strip')).toBeNull();
    expect(hero).not.toHaveBeenCalled();
    expect(strip).not.toHaveBeenCalled();
  });

  it('a user with plants sees the widgets and no "No plants assigned" message', () => {
    render(<Dashboard />);
    expect(screen.getByTestId('hero')).toBeInTheDocument();
    expect(screen.getByTestId('strip')).toBeInTheDocument();
    expect(screen.queryByText('No plants assigned')).toBeNull();
  });
});
