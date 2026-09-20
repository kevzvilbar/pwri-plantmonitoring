import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./PlantCard', () => ({
  PlantCard: ({ plant }: { plant: { name: string } }) => <div data-testid="plant-card">{plant.name}</div>,
}));

import { PlantList } from './PlantList';

const base = {
  summaryCounts: {},
  isManager: false,
  onNavigate: vi.fn(),
  onInspect: vi.fn(),
  setSearch: vi.fn(),
  setStatusFilter: vi.fn(),
};

describe('PlantList empty states (D5)', () => {
  it('asks an unassigned user to see an admin', () => {
    render(<PlantList {...base} plants={[]} filteredList={[]} needsAssignment />);
    expect(screen.getByText('No plants assigned')).toBeInTheDocument();
    expect(screen.queryByText('No plants visible')).toBeNull();
  });

  it('keeps the generic message when the list is empty for any other reason', () => {
    render(<PlantList {...base} plants={[]} filteredList={[]} />);
    expect(screen.getByText('No plants visible')).toBeInTheDocument();
    expect(screen.queryByText('No plants assigned')).toBeNull();
  });

  it('renders cards, and neither message, when there are plants', () => {
    const plants = [{ id: 'p1', name: 'Plant 1' }];
    render(<PlantList {...base} plants={plants} filteredList={plants} />);
    expect(screen.getAllByTestId('plant-card')).toHaveLength(1);
    expect(screen.queryByText('No plants assigned')).toBeNull();
    expect(screen.queryByText('No plants visible')).toBeNull();
  });
});
