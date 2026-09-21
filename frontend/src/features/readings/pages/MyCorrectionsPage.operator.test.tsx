import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CustomRole, Role, RoleOverride } from '@/lib/permissions';
import type { MyCorrectionRequest } from '@/shared/myCorrections';
import { clickEverything, operatorCanOpen } from '@/test/clickEverything';

/** P5-6, from the point of view of the people this page is for. Nothing about
 *  permissions is mocked except the signed-in user, so this exercises the real
 *  PERMISSION_MATRIX, the real nav, and the real operator allow-list. */

let mockRoles: Role[] = ['Operator'];
let mockCustom: { role: CustomRole; overrides: RoleOverride[] } | null = null;

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ roles: mockRoles, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: mockCustom }) }));

const REQUESTS: MyCorrectionRequest[] = [
  {
    id: 'r1', status: 'rejected', rawStatus: 'rejected', title: 'Well 3', subtitle: 'Well · North Plant',
    readingAt: '2026-09-20T06:00:00Z', originalValue: 100, proposedValue: 110, reason: 'Meter misread', note: null,
    createdAt: '2026-09-20T08:00:00Z', resolvedAt: '2026-09-20T10:00:00Z', resolvedByName: '@maria',
    resolutionNote: 'Reading was correct.',
  },
  {
    id: 'r2', status: 'pending', rawStatus: 'pending', title: 'Locator 7', subtitle: 'Locator · North Plant',
    readingAt: null, originalValue: 5, proposedValue: 6, reason: 'Typo', note: null,
    createdAt: '2026-09-20T09:00:00Z', resolvedAt: null, resolvedByName: null, resolutionNote: null,
  },
];
vi.mock('../hooks/useMyCorrections', () => ({
  useMyCorrections: () => ({ data: REQUESTS, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
}));

import MyCorrectionsPage from './MyCorrectionsPage';
import { useCan } from '@/hooks/usePermission';
import { buildNavConfig } from '@/navConfig';

const customRole = (base_role: Role, overrides: RoleOverride[]) => ({
  role: { id: 'cr1', name: 'Custom', base_role, description: null } as CustomRole,
  overrides,
});
const page = () => <MyCorrectionsPage />;

describe('My Corrections, for the people it is for (P5-6)', () => {
  beforeEach(() => { mockRoles = ['Operator']; mockCustom = null; });

  it.each<Role>(['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'])(
    '%s can see their requests: anyone can raise one, so anyone can follow one up',
    (role) => {
      mockRoles = [role];
      render(<MemoryRouter>{page()}</MemoryRouter>);
      expect(screen.queryByText(/access denied/i)).toBeNull();
      expect(screen.getAllByTestId('correction-request')).toHaveLength(2);
    },
  );

  it('an Operator is let through by the route guard, with or without a filter', () => {
    expect(operatorCanOpen('/my-corrections')).toBe(true);
    expect(operatorCanOpen('/my-corrections?status=rejected')).toBe(true);
  });

  it('the rejection reason reaches the Operator (the reason the page exists)', () => {
    render(<MemoryRouter>{page()}</MemoryRouter>);
    expect(screen.getByText('Reading was correct.')).toBeTruthy();
  });

  it('clicking everything on the page as an Operator never leaves it, so there is no dead end to hit', async () => {
    const visited = await clickEverything(page);
    // Filter chips rewrite the query string of the page itself: not navigation away.
    const away = visited.filter((url) => !url.startsWith('/__start'));
    expect(away).toEqual([]);
    for (const url of away) expect(operatorCanOpen(url)).toBe(true);
  });

  it('Admin → Roles is honoured: a custom role denied "My Corrections" gets no page content', () => {
    mockRoles = ['Operator'];
    mockCustom = customRole('Operator', [{ module_key: 'my_corrections', action: 'view', allowed: false }]);
    render(<MemoryRouter>{page()}</MemoryRouter>);
    expect(screen.getByText(/access denied/i)).toBeTruthy();
    expect(screen.queryAllByTestId('correction-request')).toHaveLength(0);
  });

  it('and the same override removes it from the nav, so the link is not offered', () => {
    mockRoles = ['Operator'];
    const labels = () => renderHook(() => buildNavConfig(useCan())).result.current.flatMap((g) => g.items.map((i) => i.label));
    expect(labels()).toContain('My Corrections');
    mockCustom = customRole('Operator', [{ module_key: 'my_corrections', action: 'view', allowed: false }]);
    expect(labels()).not.toContain('My Corrections');
  });
});
