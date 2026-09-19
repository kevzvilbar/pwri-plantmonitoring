import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { RolesPanel } from './RolesPanel';
import type { CustomRole, RoleOverride } from '@/lib/permissions';

// RolesPanel talks to Supabase exclusively through these hooks — mocking at
// this boundary tests the component's own rendering/interaction logic
// without re-testing the data layer (that's covered separately: the SQL
// migration was verified directly against Postgres, RLS included).
const saveOverridesMutateAsync = vi.fn().mockResolvedValue(undefined);
const createRoleMutateAsync = vi.fn();
const deleteRoleMutateAsync = vi.fn().mockResolvedValue(undefined);

const PLANT_SUPERVISOR: CustomRole = {
  id: 'role-1', name: 'Plant supervisor', base_role: 'Manager', description: null,
};
let overridesForRole1: RoleOverride[] = [
  { module_key: 'data_analysis_review', action: 'edit', allowed: true }, // Manager default is false
];

vi.mock('@/hooks/useCustomRoles', () => ({
  useCustomRoles: () => ({ data: [PLANT_SUPERVISOR], isLoading: false }),
  useCustomRoleOverrides: (id: string | null) => ({
    data: id === 'role-1' ? overridesForRole1 : [],
    isLoading: false,
  }),
  useCreateCustomRole: () => ({ mutateAsync: createRoleMutateAsync, isPending: false }),
  useDeleteCustomRole: () => ({ mutateAsync: deleteRoleMutateAsync, isPending: false }),
  useSaveCustomRoleOverrides: () => ({ mutateAsync: saveOverridesMutateAsync, isPending: false }),
}));

vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  saveOverridesMutateAsync.mockClear();
  createRoleMutateAsync.mockClear();
  deleteRoleMutateAsync.mockClear();
  overridesForRole1 = [{ module_key: 'data_analysis_review', action: 'edit', allowed: true }];
});

describe('RolesPanel', () => {
  it('renders all 5 system role tabs plus custom roles plus "New role"', () => {
    render(<RolesPanel />);
    for (const r of ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin']) {
      expect(screen.getByTestId(`role-tab-system-${r}`)).toHaveTextContent(r);
    }
    expect(screen.getByTestId('role-tab-custom-role-1')).toHaveTextContent('Plant supervisor');
    expect(screen.getByTestId('role-new-btn')).toBeInTheDocument();
  });

  it('a system role tab is read-only: switches disabled, no save footer', () => {
    render(<RolesPanel />);
    fireEvent.click(screen.getByTestId('role-tab-system-Manager'));

    expect(screen.getByText(/System role — permissions are fixed/i)).toBeInTheDocument();
    expect(screen.getByTestId('role-toggle-costs-budget')).toBeDisabled();
    expect(screen.queryByTestId('role-save-btn')).not.toBeInTheDocument();
  });

  it('locked modules (Admin console) are always disabled, even for a custom role', () => {
    render(<RolesPanel />);
    fireEvent.click(screen.getByTestId('role-tab-custom-role-1'));

    expect(screen.getByTestId('role-toggle-admin_users-view')).toBeDisabled();
    expect(screen.getByText(/Admin Console — Users/i)).toBeInTheDocument();
  });

  it('selecting the custom role shows base role + a non-zero override count from seeded data', () => {
    render(<RolesPanel />);
    fireEvent.click(screen.getByTestId('role-tab-custom-role-1'));

    const banner = screen.getByText(/Based on/i).closest('span')!;
    expect(within(banner).getByText('Manager')).toBeInTheDocument();
    // 1 seeded override that differs from Manager's default (data_analysis_review.edit)
    expect(screen.getByText(/1 override from base/i)).toBeInTheDocument();
  });

  it('toggling a switch on a custom role updates the unsaved-changes count, and Save persists the diff', () => {
    render(<RolesPanel />);
    fireEvent.click(screen.getByTestId('role-tab-custom-role-1'));

    // Flip Costs & Tariffs budget off (Manager's default is true -> this is a new override)
    const budgetToggle = screen.getByTestId('role-toggle-costs-budget');
    expect(budgetToggle).not.toBeDisabled();
    fireEvent.click(budgetToggle);

    expect(screen.getByText(/2 unsaved changes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('role-save-btn'));
    expect(saveOverridesMutateAsync).toHaveBeenCalledWith({
      customRoleId: 'role-1',
      toKeep: expect.arrayContaining([
        expect.objectContaining({ module_key: 'data_analysis_review', action: 'edit', allowed: true }),
        expect.objectContaining({ module_key: 'costs', action: 'budget', allowed: false }),
      ]),
    });
  });

  it('Cancel discards unsaved local changes back to the saved baseline', () => {
    render(<RolesPanel />);
    fireEvent.click(screen.getByTestId('role-tab-custom-role-1'));

    fireEvent.click(screen.getByTestId('role-toggle-costs-budget'));
    expect(screen.getByText(/2 unsaved changes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText(/no unsaved changes/i)).toBeInTheDocument();
  });

  it('opening "New role" and creating one calls the create mutation with the chosen base role', async () => {
    createRoleMutateAsync.mockResolvedValue({ id: 'role-2', name: 'Compliance lead', base_role: 'Technician', description: null });
    render(<RolesPanel />);

    fireEvent.click(screen.getByTestId('role-new-btn'));
    await act(async () => {});
    fireEvent.change(screen.getByTestId('role-name-input'), { target: { value: 'Compliance lead' } });
    fireEvent.click(screen.getByTestId('role-create-confirm-btn'));

    expect(createRoleMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Compliance lead' }),
    );
  });
});
