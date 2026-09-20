import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePermission', () => ({
  useCan: () => () => false,
  usePermission: (m: string) => m !== 'admin_users' && m !== 'admin_migrations',
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, isManager: true, isDataAnalyst: false, loading: false }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ count: 'exact', head: true }) }) },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }) }));
vi.mock('../components/panels/UsersPanel', () => ({ UsersPanel: () => null }), { virtual: true });
vi.mock('../components/panels/PlantsPanel', () => ({ PlantsPanel: () => null }), { virtual: true });
vi.mock('../components/panels/AuditLogPanel', () => ({ AuditLogPanel: () => null }), { virtual: true });
vi.mock('../components/panels/MigrationsPanel', () => ({ MigrationsPanel: () => null }), { virtual: true });
vi.mock('../components/panels/RolesPanel', () => ({ RolesPanel: () => null }), { virtual: true });

import AdminPage from '@/features/admin/pages/AdminPage';

/** P2-6: ?tab= drives the active admin tab; unknown values fall back. */
describe('AdminPage ?tab= (P2-6)', () => {
  const renderAt = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AdminPage />
      </MemoryRouter>,
    );

  it('selects the plants tab for ?tab=plants', () => {
    const { unmount } = renderAt('/admin?tab=plants');
    expect(screen.getByRole('tab', { name: /plants/i })).toHaveAttribute('data-state', 'active');
    unmount();
  });

  it('falls back for an unknown tab', () => {
    const { unmount } = renderAt('/admin?tab=bogus');
    expect(screen.getByRole('tab', { name: /audit log/i })).not.toHaveAttribute('data-state', 'active');
    unmount();
  });
});
