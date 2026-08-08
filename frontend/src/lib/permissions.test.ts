import { describe, it, expect } from 'vitest';
import {
  PERMISSION_MATRIX, hasPermission, isOperatorOnly,
  effectivePermission, baseDefault, meaningfulOverrideCount, LOCKED_MODULES, MODULE_ORDER,
  type ModuleKey, type Action, type RoleOverride,
} from './permissions';
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

describe('manager_scorecard — must match fn_manager_plant_scorecard\'s own has_role() gate', () => {
  it('Admin, Manager, and Data Analyst can view; Technician and Operator cannot', () => {
    expect(hasPermission(['Admin'], 'manager_scorecard', 'view')).toBe(true);
    expect(hasPermission(['Manager'], 'manager_scorecard', 'view')).toBe(true);
    expect(hasPermission(['Data Analyst'], 'manager_scorecard', 'view')).toBe(true);
    expect(hasPermission(['Technician'], 'manager_scorecard', 'view')).toBe(false);
    expect(hasPermission(['Operator'], 'manager_scorecard', 'view')).toBe(false);
  });
});

describe('effectivePermission — custom role overrides', () => {
  it('falls back to the base role default when there is no override', () => {
    expect(effectivePermission('Manager', [], 'costs', 'budget')).toBe(baseDefault('Manager', 'costs', 'budget'));
    expect(effectivePermission('Operator', [], 'compliance', 'view')).toBe(false);
  });

  it('an override flips the result away from the base default', () => {
    const overrides: RoleOverride[] = [{ module_key: 'data_analysis_review', action: 'edit', allowed: true }];
    // Manager's default for data_analysis_review.edit is false (view-only) —
    // an explicit override should turn it on for this custom role.
    expect(baseDefault('Manager', 'data_analysis_review', 'edit')).toBe(false);
    expect(effectivePermission('Manager', overrides, 'data_analysis_review', 'edit')).toBe(true);
  });

  it('LOCKED_MODULES ignore overrides entirely — cannot be reassigned off Admin', () => {
    for (const moduleKey of LOCKED_MODULES) {
      const tryToUnlock: RoleOverride[] = [{ module_key: moduleKey, action: 'view', allowed: true }];
      // Operator's real access is false; a stored override claiming true
      // must still resolve to Operator's own (false) default.
      expect(effectivePermission('Operator', tryToUnlock, moduleKey, 'view')).toBe(false);

      const tryToLockOutAdmin: RoleOverride[] = [{ module_key: moduleKey, action: 'view', allowed: false }];
      expect(effectivePermission('Admin', tryToLockOutAdmin, moduleKey, 'view')).toBe(true);
    }
  });

  it('every module in MODULE_ORDER has a matrix entry (no orphaned/missing rows in the editor)', () => {
    const matrixKeys = new Set(Object.keys(PERMISSION_MATRIX));
    for (const m of MODULE_ORDER) expect(matrixKeys.has(m), `${m} missing from PERMISSION_MATRIX`).toBe(true);
    for (const m of matrixKeys) expect(MODULE_ORDER.includes(m as ModuleKey), `${m} missing from MODULE_ORDER`).toBe(true);
  });
});

describe('meaningfulOverrideCount — drives the "N overrides from base" badge', () => {
  it('is zero with no overrides', () => {
    expect(meaningfulOverrideCount('Manager', [])).toBe(0);
  });

  it('counts overrides that actually differ from the base default', () => {
    const overrides: RoleOverride[] = [
      { module_key: 'data_analysis_review', action: 'edit', allowed: true }, // Manager default: false -> real change
      { module_key: 'costs', action: 'budget', allowed: false }, // Manager default: true -> real change
    ];
    expect(meaningfulOverrideCount('Manager', overrides)).toBe(2);
  });

  it('does not count a stored override that just restates the base default (no-op)', () => {
    const noop: RoleOverride[] = [{ module_key: 'plants', action: 'view', allowed: baseDefault('Manager', 'plants', 'view') }];
    expect(meaningfulOverrideCount('Manager', noop)).toBe(0);
  });
});
