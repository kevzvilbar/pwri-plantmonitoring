import { describe, it, expect } from 'vitest';
import { PERMISSION_MATRIX, hasPermission, isOperatorOnly, type ModuleKey, type Action } from './permissions';
import type { Role } from '@/hooks/useAuth';

const ROLES: Role[] = ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'];
const MODULE_KEYS = Object.keys(PERMISSION_MATRIX) as ModuleKey[];

describe('PERMISSION_MATRIX — structural sanity', () => {
  it('every module defines at least a view rule', () => {
    for (const key of MODULE_KEYS) {
      expect(PERMISSION_MATRIX[key].view, `${key} has no view rule`).toBeDefined();
      expect(PERMISSION_MATRIX[key].view!.length).toBeGreaterThan(0);
    }
  });

  it('Admin can do everything any other role can, on every defined action', () => {
    // Catches the "extended Manager's access but forgot Admin" class of bug.
    for (const key of MODULE_KEYS) {
      const rules = PERMISSION_MATRIX[key];
      for (const action of Object.keys(rules) as Action[]) {
        const allowed = rules[action]!;
        if (allowed.length > 0) {
          expect(allowed, `${key}.${action} should include Admin`).toContain('Admin');
        }
      }
    }
  });
});

describe('PERMISSION_MATRIX — guardrails', () => {
  it('Admin Console — Users is Admin-only (no accidental lockout path)', () => {
    expect(PERMISSION_MATRIX.admin_users.view).toEqual(['Admin']);
    expect(PERMISSION_MATRIX.admin_users.edit).toEqual(['Admin']);
  });

  it('Admin Console — Migrations is Admin-only', () => {
    expect(PERMISSION_MATRIX.admin_migrations.view).toEqual(['Admin']);
  });

  it('budget access on Costs & Tariffs is Manager/Admin only', () => {
    expect(hasPermission(['Technician'], 'costs', 'budget')).toBe(false);
    expect(hasPermission(['Data Analyst'], 'costs', 'budget')).toBe(false);
    expect(hasPermission(['Manager'], 'costs', 'budget')).toBe(true);
    expect(hasPermission(['Admin'], 'costs', 'budget')).toBe(true);
  });

  it('compliance threshold edits are Data Analyst/Admin only, matching the compliance_thresholds RLS policy', () => {
    // Manager can view Compliance but the underlying table's write policy
    // (admin_write_thresholds, 20260515_supabase_only_and_data_analysis.sql)
    // only allows Admin or Data Analyst. Before this permission existed,
    // Compliance.tsx showed every viewer an Edit button regardless of role,
    // and a swallowed Supabase error meant Manager/Technician saw a false
    // "Thresholds saved" toast while the write silently failed.
    expect(hasPermission(['Technician'], 'compliance', 'edit')).toBe(false);
    expect(hasPermission(['Manager'], 'compliance', 'edit')).toBe(false);
    expect(hasPermission(['Data Analyst'], 'compliance', 'edit')).toBe(true);
    expect(hasPermission(['Admin'], 'compliance', 'edit')).toBe(true);
  });
});

// This block is the executable version of Appendix A. It's deliberately
// written as its own literal table (not derived from PERMISSION_MATRIX)
// so a silent edit to the matrix above shows up as a failing test here —
// forcing someone to either fix the code or knowingly update this table
// (and, by extension, the manual) rather than drift unnoticed.
const APPENDIX_A: Array<{ module: ModuleKey; action: Action; allowed: Role[] }> = [
  { module: 'dashboard', action: 'view', allowed: ROLES },
  { module: 'ai_assistant', action: 'view', allowed: ['Technician', 'Manager', 'Data Analyst', 'Admin'] },
  { module: 'compliance', action: 'view', allowed: ['Technician', 'Manager', 'Data Analyst', 'Admin'] },
  { module: 'plants', action: 'edit', allowed: ['Manager', 'Admin'] },
  { module: 'employees', action: 'view', allowed: ROLES },
  { module: 'data_analysis_review', action: 'edit', allowed: ['Data Analyst', 'Admin'] },
  { module: 'admin_users', action: 'view', allowed: ['Admin'] },
  { module: 'admin_migrations', action: 'view', allowed: ['Admin'] },
];

describe('Appendix A cross-check', () => {
  for (const row of APPENDIX_A) {
    it(`${row.module}.${row.action} matches the documented matrix`, () => {
      for (const role of ROLES) {
        expect(hasPermission([role], row.module, row.action)).toBe(row.allowed.includes(role));
      }
    });
  }
});

describe('isOperatorOnly — replaces the logic duplicated in ProtectedRoute/AppSidebar/BottomNav', () => {
  const OPERATOR_DESIGNATION = 'Operator';

  it('is true for a plain Operator with no elevated role', () => {
    expect(isOperatorOnly(['Operator'], null, OPERATOR_DESIGNATION)).toBe(true);
  });

  it('is false once any elevated role is present, even alongside Operator', () => {
    expect(isOperatorOnly(['Operator', 'Manager'], null, OPERATOR_DESIGNATION)).toBe(false);
  });

  it('is true when designation is Operator even if roles are still unset', () => {
    expect(isOperatorOnly([], OPERATOR_DESIGNATION, OPERATOR_DESIGNATION)).toBe(true);
  });

  it('is false with no roles and no matching designation', () => {
    expect(isOperatorOnly([], null, OPERATOR_DESIGNATION)).toBe(false);
  });

  it('is false for an elevated role even when designation is stale as Operator', () => {
    // Regression: AppSidebar.tsx and BottomNav.tsx used to compute this as
    // true (missing the !isElevated guard ProtectedRoute already had),
    // which hid Finance/Analysis/Admin nav items from a user who could
    // actually navigate to those routes directly.
    expect(isOperatorOnly(['Manager'], OPERATOR_DESIGNATION, OPERATOR_DESIGNATION)).toBe(false);
    expect(isOperatorOnly(['Admin'], OPERATOR_DESIGNATION, OPERATOR_DESIGNATION)).toBe(false);
    expect(isOperatorOnly(['Data Analyst'], OPERATOR_DESIGNATION, OPERATOR_DESIGNATION)).toBe(false);
  });
});
