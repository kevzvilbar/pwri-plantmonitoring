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

type ModulePermissions = Partial<Record<Action, readonly Role[]>>;

const ALL: readonly Role[] = ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'];
const ELEVATED: readonly Role[] = ['Technician', 'Manager', 'Data Analyst', 'Admin'];
const MANAGE: readonly Role[] = ['Manager', 'Admin'];

export const PERMISSION_MATRIX: Record<ModuleKey, ModulePermissions> = {
  dashboard: { view: ALL },
  ai_assistant: { view: ELEVATED },
  compliance: { view: ELEVATED, edit: ['Data Analyst', 'Admin'] },
  plants: { view: ALL, edit: MANAGE },
  operations: { view: ALL },
  ro_trains: { view: ALL },
  network_topology: { view: ELEVATED, edit: MANAGE },
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
