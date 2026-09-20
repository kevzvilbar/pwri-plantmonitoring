import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/usePresence', () => ({ usePresence: () => ({ isUserOnline: () => false }) }));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('../employees/tabs/StaffTab', () => ({ StaffTab: () => <div data-testid="staff-body" /> }));
vi.mock('../employees/tabs/KpiTab', () => ({ KpiTab: () => <div data-testid="kpi-body" /> }));
vi.mock('../employees/tabs/OrgChartTab', () => ({ OrgChartTab: () => <div data-testid="org-body" /> }));

import EmployeesPage from './EmployeesPage';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><EmployeesPage /><Where /></MemoryRouter>);

beforeEach(() => sessionStorage.clear());

describe('EmployeesPage tabs (P5-4, P5-5)', () => {
  it('opens on Staff by default', () => {
    renderAt('/employees');
    expect(screen.getByTestId('staff-body')).toBeInTheDocument();
  });

  it('the URL wins over what a previous visit stored in sessionStorage', () => {
    sessionStorage.setItem('tab:employees', 'kpi');
    renderAt('/employees');
    expect(screen.getByTestId('staff-body')).toBeInTheDocument();
  });

  it('opens KPI for the Dashboard radar deep link and keeps its other params', () => {
    renderAt('/employees?tab=kpi&view=individual&plant=p1');
    expect(screen.getByTestId('kpi-body')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /staff/i }), { button: 0 });
    const sp = new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]);
    expect([sp.get('tab'), sp.get('view'), sp.get('plant')]).toEqual(['staff', 'individual', 'p1']);
  });

  it('calls the third tab "Org chart", not "Info"', () => {
    renderAt('/employees');
    expect(screen.getByRole('tab', { name: /org chart/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^info$/i })).toBeNull();
  });

  it('an old ?tab=info link still lands on the Org chart tab', () => {
    renderAt('/employees?tab=info');
    expect(screen.getByTestId('org-body')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /org chart/i })).toHaveAttribute('data-state', 'active');
  });

  it('writes the new name to the URL when the tab is picked', () => {
    renderAt('/employees');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /org chart/i }), { button: 0 });
    expect(screen.getByTestId('where').textContent).toBe('/employees?tab=org-chart');
  });

  it('falls back to Staff for an unknown tab', () => {
    renderAt('/employees?tab=bogus');
    expect(screen.getByTestId('staff-body')).toBeInTheDocument();
  });
});
