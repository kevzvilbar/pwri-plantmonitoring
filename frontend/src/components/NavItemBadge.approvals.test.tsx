import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@/lib/permissions';

let mockRoles: Role[] = [];
let mockPending = 0;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ roles: mockRoles }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/hooks/usePendingApprovalsCount', () => ({
  usePendingApprovalsCount: () => mockPending,
  PENDING_APPROVALS_COUNT_KEY: ['pending-approvals-count'],
}));

import { AppSidebar } from '@/components/AppSidebar';
import { BottomNav } from '@/components/BottomNav';
import { SidebarProvider } from '@/components/ui/sidebar';

const sidebar = () => render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
const bottomNav = () => render(<MemoryRouter><BottomNav /></MemoryRouter>);
const badge = (n: number) => new RegExp(`^${n} ${n === 1 ? 'account' : 'accounts'} waiting for approval$`);

beforeEach(() => { mockRoles = ['Admin']; mockPending = 0; });

describe('Admin Console approvals badge (P5-5)', () => {
  it('shows the number of accounts waiting, on the Admin Console item, to an Admin', () => {
    mockPending = 3;
    sidebar();
    const admin = screen.getByRole('link', { name: /admin console/i });
    expect(within(admin).getByRole('img', { name: badge(3) })).toHaveTextContent('3');
  });

  it('uses the singular for one', () => {
    mockPending = 1;
    sidebar();
    expect(screen.getByRole('img', { name: badge(1) })).toBeInTheDocument();
  });

  it('is absent when nobody is waiting', () => {
    sidebar();
    expect(screen.queryByRole('img', { name: /waiting for approval/i })).toBeNull();
  });

  it('is absent for a Manager, who sees Admin Console but cannot approve accounts', () => {
    mockRoles = ['Manager'];
    mockPending = 5;
    sidebar();
    expect(screen.getByRole('link', { name: /admin console/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /waiting for approval/i })).toBeNull();
  });

  it('is absent for an Operator, who has no Admin Console at all', () => {
    mockRoles = ['Operator'];
    mockPending = 5;
    sidebar();
    expect(screen.queryByRole('img', { name: /waiting for approval/i })).toBeNull();
  });

  it('on mobile the Admin item lives in the More sheet, so More carries a dot while it is closed', () => {
    mockPending = 2;
    bottomNav();
    const more = screen.getByRole('button', { name: /more/i });
    expect(within(more).getByRole('img', { name: badge(2) })).toBeInTheDocument();
  });

  it('and the count is on the item inside the sheet', () => {
    mockPending = 2;
    bottomNav();
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    const admin = screen.getByRole('link', { name: /admin console/i });
    expect(within(admin).getByRole('img', { name: badge(2) })).toHaveTextContent('2');
  });

  it('More has no dot for a role without the badge', () => {
    mockRoles = ['Manager'];
    mockPending = 2;
    bottomNav();
    expect(within(screen.getByRole('button', { name: /more/i })).queryByRole('img')).toBeNull();
  });
});
