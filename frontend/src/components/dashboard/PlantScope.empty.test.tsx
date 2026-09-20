import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * D5: `plantIds` is authoritative on the Dashboard widgets. Both used to read
 * an empty list as "no filter" and show every plant, which only mattered while
 * plants were loading. With D5 an unassigned user (or a stale picker selection)
 * makes it a steady state, so [] must mean "nothing".
 */

const PLANTS = [
  { id: 'p1', name: 'Alpha Plant' },
  { id: 'p2', name: 'Beta Plant' },
];

vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: PLANTS, isLoading: false }) }));

const useFleetStatus = vi.fn();
vi.mock('@/hooks/useFleetStatus', () => ({
  useFleetStatus: (ids: string[]) => {
    useFleetStatus(ids);
    return {
      lastByPlant: {},
      counts: { online: 0, stale: 0, offline: 0 },
      statusOf: () => 'offline' as const,
    };
  },
}));
vi.mock('@/hooks/useNow', () => ({ useNow: () => new Date('2026-09-20T12:00:00Z') }));

import { PlantHealthStrip } from './PlantHealthStrip';
import { PlantPulseHero } from './PlantPulseHero';

const heroProps = {
  selectedPlantName: 'All Production Facilities',
  production: null,
  dProduction: null,
  onOpenDowntime: vi.fn(),
};

const lastFleetIds = () => useFleetStatus.mock.calls.at(-1)![0] as string[];

describe('PlantHealthStrip plantIds is authoritative (D5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows nothing for an empty list instead of every plant', () => {
    const { container } = render(<PlantHealthStrip plantIds={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Alpha|Beta/)).toBeNull();
  });

  it('shows only the listed plants', () => {
    render(<PlantHealthStrip plantIds={['p2']} />);
    expect(screen.getByText(/Beta/)).toBeInTheDocument();
    expect(screen.queryByText(/Alpha/)).toBeNull();
  });
});

describe('PlantPulseHero plantIds is authoritative (D5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the fleet hook about NO plants when given an empty list', () => {
    render(<PlantPulseHero {...heroProps} plantIds={[]} />);
    expect(lastFleetIds()).toEqual([]);
  });

  it('asks the fleet hook about exactly the listed plants', () => {
    render(<PlantPulseHero {...heroProps} plantIds={['p1']} />);
    expect(lastFleetIds()).toEqual(['p1']);
  });
});
