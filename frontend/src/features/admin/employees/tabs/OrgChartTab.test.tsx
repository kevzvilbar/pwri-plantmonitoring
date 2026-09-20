import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockCanApprove = true;
let mockStaff: unknown[] = [];
vi.mock('@/hooks/usePermission', () => ({ useCan: () => () => mockCanApprove }));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'staff' ? mockStaff : [] }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('../components/DirectoryStats', () => ({ DirectoryStats: () => <div data-testid="dir-stats" /> }));
vi.mock('../components/OrgChart', () => ({ OrgChart: () => <div data-testid="org-chart" />, HierarchyLegend: () => null }));

import { OrgChartTab } from './OrgChartTab';

const pending = (id: string) => ({ id, status: 'Pending', first_name: 'A', last_name: id });
const renderTab = () => render(<MemoryRouter><OrgChartTab /></MemoryRouter>);

beforeEach(() => { mockCanApprove = true; mockStaff = []; });

describe('Org chart tab (was Info)', () => {
  it('shows the directory and the reporting tree', () => {
    renderTab();
    expect(screen.getByTestId('dir-stats')).toBeInTheDocument();
    expect(screen.getByTestId('org-chart')).toBeInTheDocument();
  });

  it('no longer hosts the manual or the approval queue: they moved to /help and Admin → Users', () => {
    mockStaff = [pending('u1'), pending('u2')];
    renderTab();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByTestId('pending-approvals')).toBeNull();
    expect(screen.queryByText(/manual/i)).toBeNull();
  });

  it('says all accounts are active when none are waiting', () => {
    renderTab();
    expect(screen.getByText(/all accounts active/i)).toBeInTheDocument();
  });

  it('for an Admin, the pending count links to Admin → Users', () => {
    mockStaff = [pending('u1'), pending('u2')];
    renderTab();
    expect(screen.getByRole('link', { name: /2 pending approvals/i })).toHaveAttribute('href', '/admin?tab=users');
  });

  it('for anyone else it is a plain count, not a link to a page they cannot open', () => {
    mockCanApprove = false;
    mockStaff = [pending('u1')];
    renderTab();
    expect(screen.getByText(/1 pending approval/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
