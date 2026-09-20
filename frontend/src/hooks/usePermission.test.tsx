import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Role, RoleOverride, CustomRole } from '@/lib/permissions';

let mockRoles: Role[] = [];
let mockCustom: { role: CustomRole; overrides: RoleOverride[] } | null = null;

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ roles: mockRoles }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: mockCustom }) }));

import { useCan, usePermission } from '@/hooks/usePermission';
import { useNavGroups } from '@/hooks/useNavGroups';

const customRole = (base_role: Role, overrides: RoleOverride[]) => ({
  role: { id: 'cr1', name: 'Custom', base_role, description: null } as CustomRole,
  overrides,
});
const labels = () =>
  renderHook(() => useNavGroups()).result.current.flatMap((g) => g.items.map((i) => i.label));

beforeEach(() => {
  mockRoles = [];
  mockCustom = null;
});

describe('useCan', () => {
  it('without a custom role, matches the base PERMISSION_MATRIX', () => {
    mockRoles = ['Technician'];
    const { result } = renderHook(() => useCan());
    expect(result.current('costs', 'edit')).toBe(true);
    expect(result.current('data_exports')).toBe(false);
    expect(result.current('dashboard')).toBe(true);
  });

  it('defaults the action to view', () => {
    mockRoles = ['Operator'];
    const { result } = renderHook(() => useCan());
    expect(result.current('plants')).toBe(true);
    expect(result.current('plants', 'edit')).toBe(false);
  });

  it('with a custom role, applies its overrides on top of the base role', () => {
    mockRoles = ['Manager'];
    mockCustom = customRole('Manager', [{ module_key: 'data_exports', action: 'view', allowed: false }]);
    const { result } = renderHook(() => useCan());
    expect(result.current('data_exports')).toBe(false);
    expect(result.current('smart_import')).toBe(true);
  });

  it('returns the same function across re-renders when nothing changed', () => {
    mockRoles = ['Operator'];
    const { result, rerender } = renderHook(() => useCan());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('usePermission', () => {
  it('agrees with useCan, including custom-role overrides', () => {
    mockRoles = ['Technician'];
    expect(renderHook(() => usePermission('costs', 'edit')).result.current).toBe(true);

    mockCustom = customRole('Technician', [{ module_key: 'costs', action: 'edit', allowed: false }]);
    expect(renderHook(() => usePermission('costs', 'edit')).result.current).toBe(false);
  });
});

describe('useNavGroups — custom-role overrides reach the nav', () => {
  it('hides an item the override restricts (base Manager, Data Exports off)', () => {
    mockRoles = ['Manager'];
    expect(labels()).toContain('Data Exports');

    mockCustom = customRole('Manager', [{ module_key: 'data_exports', action: 'view', allowed: false }]);
    const after = labels();
    expect(after).not.toContain('Data Exports');
    expect(after).toContain('Smart Import');
  });

  it('drops a whole group when every item in it is restricted', () => {
    mockRoles = ['Manager'];
    mockCustom = customRole('Manager', [
      { module_key: 'data_analysis_review', action: 'view', allowed: false },
      { module_key: 'data_corrections', action: 'view', allowed: false },
      { module_key: 'manager_scorecard', action: 'view', allowed: false },
    ]);
    const groups = renderHook(() => useNavGroups()).result.current.map((g) => g.label);
    expect(groups).not.toContain('Review');
  });

  it('shows an item the override grants (base Operator, Costs on)', () => {
    mockRoles = ['Operator'];
    mockCustom = customRole('Operator', [{ module_key: 'costs', action: 'view', allowed: true }]);
    expect(labels()).toContain('Costs & Tariffs');
  });

  it('keeps the Admin Console for an Admin even if a custom role switches every admin tab off (admin_users is locked)', () => {
    mockRoles = ['Admin'];
    mockCustom = customRole('Admin', [
      { module_key: 'admin_users', action: 'view', allowed: false },
      { module_key: 'admin_plants', action: 'view', allowed: false },
      { module_key: 'admin_audit', action: 'view', allowed: false },
    ]);
    // Only admin_users keeps the link alive here: LOCKED_MODULES ignores its override.
    expect(labels()).toContain('Admin Console');
  });

  it('a Manager whose custom role removes Admin → Plants and Audit loses the Admin Console link', () => {
    mockRoles = ['Manager'];
    mockCustom = customRole('Manager', [
      { module_key: 'admin_plants', action: 'view', allowed: false },
      { module_key: 'admin_audit', action: 'view', allowed: false },
    ]);
    expect(labels()).not.toContain('Admin Console');
  });
});
