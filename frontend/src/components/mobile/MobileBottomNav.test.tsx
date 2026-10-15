import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';

// Mock auth hook with Operator role
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-id' },
    profile: { first_name: 'John', last_name: 'Operator', designation: 'Operator' },
    roles: ['Operator'],
    isAdmin: false,
    isManager: false,
    isDataAnalyst: false,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  useCan: () => () => true,
}));

vi.mock('@/hooks/useNavGroups', () => ({
  useNavGroups: () => [
    {
      label: 'Daily Logs',
      items: [
        { id: 'operations', label: 'Daily Readings', route: '/operations', icon: () => null, modules: ['operations'] },
        { id: 'ro-trains', label: 'RO Trains', route: '/ro-trains', icon: () => null, modules: ['ro_trains'] },
      ],
    },
    {
      label: 'Monitor',
      items: [
        { id: 'dashboard', label: 'Dashboard', route: '/', icon: () => null, modules: ['dashboard'], end: true },
        { id: 'alerts', label: 'Alerts', route: '/alerts', icon: () => null, modules: ['alerts'] },
      ],
    },
  ],
}));

vi.mock('@/hooks/useAlertBadge', () => ({
  useAlertBadge: () => ({ count: 0, hasCritical: false }),
}));

vi.mock('@/features/readings/hooks/useCorrections', () => ({
  useInboxCount: () => ({ data: 0 }),
}));

vi.mock('@/hooks/usePendingApprovalsCount', () => ({
  usePendingApprovalsCount: () => 0,
}));

describe('MobileBottomNav Component', () => {
  it('renders operator-specific navigation tabs and action FAB', () => {
    render(
      <MemoryRouter initialEntries={['/operations']}>
        <MobileBottomNav />
      </MemoryRouter>
    );

    // Operator tabs
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Log')).toBeInTheDocument(); // Center FAB
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });
});

