import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

let mockUsers = false;
let mockIsAdmin = true;
vi.mock('@/hooks/usePermission', () => ({
  useCan: () => () => false,
  usePermission: (m: string) => (m === 'admin_users' ? mockUsers : m !== 'admin_migrations'),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin, isManager: true, isDataAnalyst: false, loading: false }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ count: 'exact', head: true }) }) } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }) }));
vi.mock('../components/panels/UsersPanel', () => ({ UsersPanel: () => null }));
vi.mock('../components/panels/PlantsPanel', () => ({ PlantsPanel: () => null }));
vi.mock('../components/panels/AuditLogPanel', () => ({ AuditLogPanel: () => null }));
vi.mock('../components/panels/MigrationsPanel', () => ({ MigrationsPanel: () => null }));
vi.mock('../components/panels/RolesPanel', () => ({ RolesPanel: () => null }));

import AdminPage from './AdminPage';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><AdminPage /><Where /></MemoryRouter>);
const active = (id: string) => expect(screen.getByTestId(`admin-tab-${id}`)).toHaveAttribute('data-state', 'active');

beforeEach(() => { mockUsers = false; mockIsAdmin = true; });

/** P5-4: Admin uses useUrlTab; which tabs are valid depends on the role. */
describe('AdminPage ?tab= per role (P5-4)', () => {
  it('a role without admin_users opens Plants, also for ?tab=users', () => {
    renderAt('/admin');
    active('plants');
  });

  it('?tab=users falls back to Plants for a role without admin_users', () => {
    renderAt('/admin?tab=users');
    active('plants');
  });

  it('a role with admin_users opens Users by default and for ?tab=users', () => {
    mockUsers = true;
    renderAt('/admin');
    active('users');
  });

  it('?tab=roles opens Roles for an Admin', () => {
    renderAt('/admin?tab=roles');
    active('roles');
  });

  it('?tab=roles falls back to Plants for a non-Admin', () => {
    mockIsAdmin = false;
    renderAt('/admin?tab=roles');
    active('plants');
  });

  it('picking a tab writes it to the URL and keeps other params', () => {
    renderAt('/admin?tab=plants&q=x');
    fireEvent.mouseDown(screen.getByTestId('admin-tab-audit'), { button: 0 });
    const sp = new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]);
    expect([sp.get('tab'), sp.get('q')]).toEqual(['audit', 'x']);
  });
});
