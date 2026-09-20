import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

let mockBudget = false;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isManager: true, isAdmin: false }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => mockBudget, useCan: () => () => true }));
vi.mock('./components/BudgetTab', () => ({ BudgetTab: () => <div data-testid="budget-body" /> }));
vi.mock('./tabs/FiltersTab', () => ({ FiltersTab: () => <div data-testid="filters-body" /> }));
vi.mock('./tabs/ChemicalPrices', () => ({ ChemicalPrices: () => <div data-testid="prices-body" /> }));
vi.mock('./tabs/Rollup', () => ({ Rollup: () => <div data-testid="rollup-body" /> }));
vi.mock('./tabs/Power', () => ({ Power: () => <div data-testid="power-body" /> }));
vi.mock('./tabs/Compare', () => ({ Compare: () => <div data-testid="compare-body" /> }));

import Costs from './CostsPage';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Costs /><Where /></MemoryRouter>);

beforeEach(() => { mockBudget = false; });

describe('CostsPage ?tab= (P5-4)', () => {
  it('opens Rollup by default', () => {
    renderAt('/costs');
    expect(screen.getByTestId('rollup-body')).toBeInTheDocument();
  });

  it('opens the tab a Dashboard card links to', () => {
    renderAt('/costs?tab=power');
    expect(screen.getByTestId('power-body')).toBeInTheDocument();
  });

  it('an unknown tab opens Rollup; it used to render an empty page', () => {
    renderAt('/costs?tab=garbage');
    expect(screen.getByTestId('rollup-body')).toBeInTheDocument();
  });

  it('?tab=budget without the budget permission opens Rollup, and there is no Budget tab', () => {
    renderAt('/costs?tab=budget');
    expect(screen.getByTestId('rollup-body')).toBeInTheDocument();
    expect(screen.queryByTestId('budget-body')).toBeNull();
    expect(screen.queryByRole('tab', { name: /budget/i })).toBeNull();
  });

  it('?tab=budget with the permission opens Budget', () => {
    mockBudget = true;
    renderAt('/costs?tab=budget');
    expect(screen.getByTestId('budget-body')).toBeInTheDocument();
  });

  it('picking a tab keeps the other query params (it used to wipe them)', () => {
    renderAt('/costs?tab=rollup&plant=p1');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /power/i }), { button: 0 });
    const sp = new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]);
    expect([sp.get('tab'), sp.get('plant')]).toEqual(['power', 'p1']);
  });
});
