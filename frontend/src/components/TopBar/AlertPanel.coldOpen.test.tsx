import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'op-1' }, profile: { plant_assignments: [] }, roles: ['Operator'] }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [{ id: 'p1', name: 'Plant 1' }] }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({ isMobile: false, state: 'expanded' }),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ then: () => {} }) }) }), update: () => ({}) , delete: () => ({}) }) },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/Signal', () => ({
  Signal: ({ title, statusLine }: { title: React.ReactNode; statusLine?: React.ReactNode }) => (
    <div data-testid="signal">
      <span data-testid="signal-title">{title}</span>
      {statusLine && <span data-testid="signal-status">{statusLine}</span>}
    </div>
  ),
}));

import { AlertPanel } from '@/components/TopBar/AlertPanel';
import { useAlertStore } from '@/store/alertStore';

const alert = (id: string, severity: 'critical' | 'warning' | 'info') => ({
  id, severity, title: `${severity} alarm`, description: 'd', source: 'test',
  plantId: 'p1', timestamp: Date.now(),
});

const renderPanel = () =>
  render(
    <MemoryRouter>
      <AlertPanel />
    </MemoryRouter>,
  );

/** P3-9: a cold open on a non-Dashboard route used to say "All plant systems
 *  and sensors operating normally" before anything had been evaluated. */
describe('AlertPanel cold open (P3-9)', () => {
  beforeEach(() => {
    useAlertStore.setState({
      plantAlerts: [], snoozeMap: {}, serverStatusByKey: {}, alertsReady: false,
    });
  });

  it('says "Checking plant systems…" before the first computation finishes', () => {
    renderPanel();
    expect(screen.getByText('Checking plant systems…')).toBeInTheDocument();
    expect(screen.queryByText('All plant systems and sensors operating normally')).toBeNull();
  });

  it('shows the real alerts once the first computation lands, with the who/when line', () => {
    renderPanel();
    act(() => {
      useAlertStore.setState({ alertsReady: true });
      useAlertStore.getState().addAlerts([alert('c1', 'critical'), alert('i1', 'info')]);
    });
    expect(screen.queryByText('Checking plant systems…')).toBeNull();
    expect(screen.getAllByTestId('signal-title').map((e) => e.textContent))
      .toEqual(['critical alarm', 'info alarm']);

    // And an acknowledged alert carries who and when (P3-1/P3-3).
    act(() => useAlertStore.getState().acknowledgeAlert('c1', 'op-1'));
    expect(screen.getByTestId('signal-status').textContent).toMatch(/Acknowledged by/);
  });

  it('says "operating normally" only after the computation ran and found nothing', () => {
    renderPanel();
    act(() => useAlertStore.setState({ alertsReady: true }));
    expect(screen.getByText('No active alarms')).toBeInTheDocument();
    expect(screen.getByText('All plant systems and sensors operating normally')).toBeInTheDocument();
  });
});
