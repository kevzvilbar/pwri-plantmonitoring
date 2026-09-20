import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Role, RoleOverride, CustomRole } from '@/lib/permissions';

let mockRoles: Role[] = [];
let mockCustom: { role: CustomRole; overrides: RoleOverride[] } | null = null;

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ roles: mockRoles }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: mockCustom }) }));

import { AppSidebar } from '@/components/AppSidebar';
import { BottomNav } from '@/components/BottomNav';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useAlertStore, type PlantAlert } from '@/store/alertStore';

const alert = (id: string, severity: PlantAlert['severity']): PlantAlert => ({
  id, severity, title: id, description: '', source: 'test', plantId: 'p1', timestamp: 0,
});

const renderSidebar = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider><AppSidebar /></SidebarProvider>
    </MemoryRouter>,
  );
const renderBottomNav = (path = '/') =>
  render(<MemoryRouter initialEntries={[path]}><BottomNav /></MemoryRouter>);

beforeEach(() => {
  mockRoles = ['Operator'];
  mockCustom = null;
  useAlertStore.setState({ plantAlerts: [], snoozeMap: {} });
});

describe('AppSidebar', () => {
  it('renders the shared groups in order, with no "Other" and no Profile', () => {
    mockRoles = ['Manager'];
    renderSidebar();
    const labels = ['Overview', 'Daily Logs', 'Assets', 'Review', 'Reports & Data', 'Team & Admin'];
    const positions = labels.map((l) => screen.getByText(l));
    // DOM order == expected order
    positions.slice(1).forEach((el, i) => {
      expect(positions[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(screen.queryByText('Other')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Admin Console' })).toHaveAttribute('href', '/admin');
  });

  it('shows an Operator only what the matrix allows', () => {
    renderSidebar();
    const names = screen.getAllByRole('link').map((l) => l.textContent?.trim()).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['Dashboard', 'Alerts', 'Daily Readings', 'RO Trains', 'Plants', 'Employees']));
    for (const hidden of ['Data Corrections', 'Costs & Tariffs', 'Admin Console', 'Data Exports']) {
      expect(names).not.toContain(hidden);
    }
  });

  it('applies custom-role overrides', () => {
    mockRoles = ['Manager'];
    mockCustom = {
      role: { id: 'r', name: 'x', base_role: 'Manager', description: null },
      overrides: [{ module_key: 'data_exports', action: 'view', allowed: false }],
    };
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Data Exports' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Smart Import' })).toBeInTheDocument();
  });

  it('marks nested paths active: /plants/abc lights Plants', () => {
    renderSidebar('/plants/abc');
    // The base SidebarMenuButton classes already contain `data-[active=true]:bg-sidebar-accent`,
    // so assert on the accent bar that AppSidebar only adds when its own isActive is true.
    const ACTIVE_BAR = 'shadow-[inset_2.5px_0_0_0_hsl(var(--sidebar-primary))]';
    expect(screen.getByRole('link', { name: 'Plants' }).className).toContain(ACTIVE_BAR);
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).not.toContain(ACTIVE_BAR);
  });

  it('shows the alerts count, and only for unacknowledged critical/warning alerts', () => {
    renderSidebar();
    expect(screen.queryByRole('img', { name: /unacknowledged/ })).toBeNull();

    act(() => useAlertStore.getState().addAlerts([alert('c', 'critical'), alert('w', 'warning'), alert('i', 'info')]));
    expect(screen.getByRole('img', { name: '2 unacknowledged alerts' })).toHaveTextContent('2');

    act(() => useAlertStore.getState().acknowledgeAlert('c', 'u1'));
    expect(screen.getByRole('img', { name: '1 unacknowledged alert' })).toHaveTextContent('1');
  });
});

describe('BottomNav', () => {
  it('puts Readings · RO Trains · Dashboard · Alerts · More in the bar, in that order', () => {
    renderBottomNav();
    const nav = screen.getByRole('navigation');
    const items = Array.from(nav.querySelectorAll('button, a')).map((el) => el.textContent?.trim());
    expect(items).toEqual(['Readings', 'RO Trains', 'Dashboard', 'Alerts', 'More']);
  });

  it('keeps Plants out of the bar and lists it in More, with the shared group names', async () => {
    mockRoles = ['Technician'];
    renderBottomNav();
    expect(screen.queryByRole('link', { name: 'Plants' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: 'Plants' })).toHaveAttribute('href', '/plants');
    expect(within(sheet).getByRole('link', { name: 'Network Topology' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Costs & Tariffs' })).toBeInTheDocument();
    // bar items are not repeated in the sheet; nothing is called Other; Profile is not a nav item
    expect(within(sheet).queryByRole('link', { name: /Alerts|Dashboard|RO Trains/ })).toBeNull();
    expect(within(sheet).queryByText('Other')).toBeNull();
    expect(within(sheet).queryByRole('link', { name: 'Profile' })).toBeNull();
  });

  it('uses the same labels as the sidebar (no more "Data Analysis" vs "Data Analysis & Review")', async () => {
    mockRoles = ['Manager'];
    renderBottomNav();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('link', { name: 'Data Analysis & Review' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Admin Console' })).toHaveAttribute('href', '/admin');
  });

  it('shows the alerts badge on the Alerts slot', () => {
    renderBottomNav();
    act(() => useAlertStore.getState().addAlerts([alert('c', 'critical')]));
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('img', { name: '1 unacknowledged alert' })).toBeInTheDocument();
  });

  it('keeps the full name for assistive tech on the shortened Readings label', () => {
    renderBottomNav();
    expect(screen.getByRole('button', { name: 'Daily Readings' })).toHaveTextContent('Readings');
  });

  it('marks Readings active on bare /operations (was inactive before: ?tab= list mismatch)', () => {
    renderBottomNav('/operations');
    expect(screen.getByRole('button', { name: 'Daily Readings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'RO Trains' })).not.toHaveAttribute('aria-current');
  });
});
