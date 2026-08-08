import type { Role } from '@/hooks/useAuth';

// Single source of truth for "who can do what". This is Appendix A —
// Roles & Permissions Matrix — encoded as data instead of scattered
// booleans. If a role's access changes, change it HERE first.
// permissions.test.ts walks this table and fails loudly if the app's
// actual behavior (ProtectedRoute, page-level canEdit checks, etc.)
// drifts from what's declared here.
//
// Not covered yet: per-plant scoping (plant_assignments) and the
// "redirected" outcome for Data Analyst on Admin Console → Plants/Audit.
// Those stay as-is in Admin.tsx for now — see REDIRECTS below.

export type Action = 'view' | 'edit' | 'budget' | 'delete';

export type ModuleKey =
  | 'dashboard'
  | 'ai_assistant'
  | 'compliance'
  | 'plants'
  | 'operations'
  | 'ro_trains'
  | 'network_topology'
  | 'pm_schedule'
  | 'incidents'
  | 'costs'
  | 'employees'
  | 'data_exports'
  | 'smart_import'
  | 'data_analysis_review'
  | 'data_corrections'
  | 'admin_users'
  | 'admin_plants'
  | 'admin_audit'
  | 'admin_migrations'
  | 'profile';

// Display order + labels for the roles editor and any other UI that needs
// to render "every module" (mirrors Appendix A's row order).
export const MODULE_ORDER: readonly ModuleKey[] = [
  'dashboard', 'ai_assistant', 'compliance', 'plants', 'operations', 'ro_trains',
  'network_topology', 'pm_schedule', 'incidents', 'costs', 'employees',
  'data_exports', 'smart_import', 'data_analysis_review', 'data_corrections',
  'admin_users', 'admin_plants', 'admin_audit', 'admin_migrations', 'profile',
];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  ai_assistant: 'AI Assistant',
  compliance: 'Compliance',
  plants: 'Plants',
  operations: 'Operations',
  ro_trains: 'RO Trains',
  network_topology: 'Network Topology',
  pm_schedule: 'PM Schedule',
  incidents: 'Incidents',
  costs: 'Costs & Tariffs',
  employees: 'Employees',
  data_exports: 'Data Exports',
  smart_import: 'Smart Import',
  data_analysis_review: 'Data Analysis & Review',
  data_corrections: 'Data Corrections',
  admin_users: 'Admin Console — Users',
  admin_plants: 'Admin Console — Plants',
  admin_audit: 'Admin Console — Audit',
  admin_migrations: 'Admin Console — Migrations',
  profile: 'Profile',
};

type ModulePermissions = Partial<Record<Action, readonly Role[]>>;

const ALL: readonly Role[] = ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'];
const ELEVATED: readonly Role[] = ['Technician', 'Manager', 'Data Analyst', 'Admin'];
const MANAGE: readonly Role[] = ['Manager', 'Admin'];

export const PERMISSION_MATRIX: Record<ModuleKey, ModulePermissions> = {
  dashboard: { view: ALL },
  ai_assistant: { view: ELEVATED },
  compliance: { view: ELEVATED },
  plants: { view: ALL, edit: MANAGE },
  operations: { view: ALL },
  ro_trains: { view: ALL },
  network_topology: { view: ELEVATED },
  pm_schedule: { view: ALL },
  incidents: { view: ALL },
  // Technician's "view" here is deliberately looser than its real UI —
  // Costs.tsx itself narrows what a Technician sees inside the page.
  // This entry governs nav/route access, not in-page field visibility.
  costs: { view: ELEVATED, edit: ['Technician', 'Manager', 'Admin'], budget: MANAGE },
  employees: { view: ALL },
  data_exports: { view: MANAGE.concat('Data Analyst') },
  smart_import: { view: MANAGE.concat('Data Analyst') },
  data_analysis_review: { view: MANAGE.concat('Data Analyst'), edit: ['Data Analyst', 'Admin'] },
  data_corrections: { view: MANAGE.concat('Data Analyst') },
  admin_users: { view: ['Admin'], edit: ['Admin'] },
  admin_plants: { view: MANAGE, edit: MANAGE },
  admin_audit: { view: MANAGE, edit: MANAGE },
  admin_migrations: { view: ['Admin'], edit: ['Admin'] },
  profile: { view: ALL },
};

// Data Analyst (without Manager) never reaches any admin_* tab — Admin.tsx
// redirects once at page entry, before tabs render. Modeled per-module here
// (rather than as a single page-level flag) so a future custom-role editor
// can still show "redirected" instead of a raw deny on each row.
export const REDIRECTS: Partial<Record<ModuleKey, { for: Role; to: string }>> = {
  admin_users: { for: 'Data Analyst', to: '/data-corrections' },
  admin_plants: { for: 'Data Analyst', to: '/data-corrections' },
  admin_audit: { for: 'Data Analyst', to: '/data-corrections' },
  admin_migrations: { for: 'Data Analyst', to: '/data-corrections' },
};

export function hasPermission(roles: Role[], moduleKey: ModuleKey, action: Action = 'view'): boolean {
  const allowed = PERMISSION_MATRIX[moduleKey]?.[action];
  if (!allowed) return false;
  return roles.some((r) => allowed.includes(r));
}

// ─────────────────────────────────────────────────────────────────────────
// Custom roles — named presets an Admin builds on top of a system role.
// A custom role never changes RLS (every assigned user still carries a
// user_roles row keyed to base_role); this only affects what usePermission()
// reports for nav/UI purposes. See supabase/migrations/20260808_custom_roles.sql.

export interface CustomRole {
  id: string;
  name: string;
  base_role: Role;
  description: string | null;
}

export interface RoleOverride {
  module_key: ModuleKey;
  action: Action;
  allowed: boolean;
}

// Mirrors the DB-level guard trigger (fn_guard_custom_role_override): these
// modules stay tied to the Admin role no matter what base role or overrides
// a custom role has, so an Admin can never accidentally lock themselves (or
// everyone else) out of user management or migrations.
export const LOCKED_MODULES: readonly ModuleKey[] = ['admin_users', 'admin_migrations'];

// Modules with nothing to toggle — every role that can see them at all sees
// the same thing, so the editor renders them as fixed "–" rows.
export const UNCONFIGURABLE_MODULES: readonly ModuleKey[] = ['dashboard', 'profile'];

/** What a given action on a module resolves to, before any override. */
export function baseDefault(baseRole: Role, moduleKey: ModuleKey, action: Action = 'view'): boolean {
  return hasPermission([baseRole], moduleKey, action);
}

/**
 * Effective permission for a custom role: the base role's default, unless
 * an override exists for this (module, action) — except on LOCKED_MODULES,
 * which always resolve to the base role's own access regardless of any
 * stored override (defense in depth; the DB trigger also rejects writes there).
 */
export function effectivePermission(
  baseRole: Role,
  overrides: readonly RoleOverride[],
  moduleKey: ModuleKey,
  action: Action = 'view',
): boolean {
  if (!LOCKED_MODULES.includes(moduleKey)) {
    const override = overrides.find((o) => o.module_key === moduleKey && o.action === action);
    if (override) return override.allowed;
  }
  return baseDefault(baseRole, moduleKey, action);
}

/** Overrides that actually change behavior vs. the base role — the number a
 *  "3 overrides from base" badge should show (a no-op override that just
 *  restates the default shouldn't inflate the count). */
export function meaningfulOverrideCount(baseRole: Role, overrides: readonly RoleOverride[]): number {
  return overrides.filter((o) => o.allowed !== baseDefault(baseRole, o.module_key, o.action)).length;
}

// Replaces the near-identical block duplicated in ProtectedRoute.tsx,
// AppSidebar.tsx, and BottomNav.tsx.
export function isOperatorOnly(
  roles: Role[],
  designation: string | null | undefined,
  operatorDesignation: string,
): boolean {
  const isElevated = roles.some((r) => (['Admin', 'Data Analyst', 'Manager'] as Role[]).includes(r));
  if (isElevated) return false;
  return designation === operatorDesignation || (roles.length > 0 && roles.every((r) => r === 'Operator'));
}
