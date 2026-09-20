import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

type Named = { id: string; name: string };
type ActiveState = {
  plant: Named | null; plantId: string; plants: Named[];
  isLoading: boolean; needsAssignment: boolean; needsSelection: boolean;
};
const active = vi.hoisted(() => ({
  value: { plant: null, plantId: '', plants: [], isLoading: false, needsAssignment: false, needsSelection: false } as ActiveState,
  select: vi.fn(),
}));
vi.mock('@/hooks/useActivePlant', () => ({ useActivePlant: () => ({ ...active.value, select: active.select }) }));

import { ActivePlantChip } from './ActivePlantChip';

const A = { id: 'a', name: 'Alpha WTP' };
const B = { id: 'b', name: 'Bravo WTP' };
const base = { plant: null, plantId: '', plants: [A, B], isLoading: false, needsAssignment: false, needsSelection: false };

describe('ActivePlantChip (P5-2)', () => {
  beforeEach(() => { active.select.mockClear(); active.value = { ...base }; });

  it('shows the active plant as a read-only label: no dropdown, no buttons', () => {
    active.value = { ...base, plant: B, plantId: 'b' };
    render(<ActivePlantChip />);
    expect(screen.getByTestId('active-plant-chip').textContent).toContain('Bravo WTP');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('points to the TopBar as the place to change it', () => {
    active.value = { ...base, plant: A, plantId: 'a' };
    render(<ActivePlantChip />);
    expect(screen.getByText(/plant picker in the top bar/i)).toBeTruthy();
  });

  it('when a choice is required, offers each visible plant and writes the global selection', () => {
    active.value = { ...base, needsSelection: true };
    render(<ActivePlantChip />);
    expect(screen.getByText(/choose a plant to log readings/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bravo WTP' }));
    expect(active.select).toHaveBeenCalledWith('b');
  });

  it('tells an unassigned user to ask an admin, with nothing to click', () => {
    active.value = { ...base, plants: [], needsAssignment: true };
    render(<ActivePlantChip />);
    expect(screen.getByText(/ask an admin to assign a plant/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a placeholder while loading, not a choice or a plant', () => {
    active.value = { ...base, isLoading: true };
    render(<ActivePlantChip />);
    expect(screen.queryByTestId('active-plant-chip')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offline (plant id known, list unavailable): still shows a usable label', () => {
    active.value = { ...base, plants: [], plantId: 'a', plant: null };
    render(<ActivePlantChip />);
    expect(screen.getByTestId('active-plant-chip').textContent).toContain('Selected plant');
  });

  it('says so plainly when there is nothing to show', () => {
    active.value = { ...base, plants: [] };
    render(<ActivePlantChip />);
    expect(screen.getByText(/no plant available/i)).toBeTruthy();
  });
});
