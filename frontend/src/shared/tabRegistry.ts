/**
 * shared/tabRegistry.ts
 *
 * Single source of truth for tab definitions across the application (IA3-1).
 * Maps every URL-linkable tab to its parent route, user-facing label,
 * and required permission module.
 *
 * Used by:
 * - CommandPalette (Ctrl+K tab search)
 * - Document title formatting (e.g. "Costs & Tariffs · Budget")
 * - URL tab alias normalization & tests
 */

import type { ModuleKey } from '@/lib/permissions';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly pageName: string;
  readonly module: ModuleKey;
  readonly aliases?: readonly string[];
  readonly keywords?: readonly string[];
}

export const TAB_REGISTRY: readonly TabDefinition[] = [
  // ── Daily Readings (/operations) ──────────────────────────────────────────
  { id: 'locator', label: 'Locators', route: '/operations', pageName: 'Daily Readings', module: 'operations', aliases: ['locators'] },
  { id: 'well', label: 'Wells', route: '/operations', pageName: 'Daily Readings', module: 'operations', aliases: ['wells'] },
  { id: 'product', label: 'Product Meters', route: '/operations', pageName: 'Daily Readings', module: 'operations', aliases: ['product-meters'] },
  { id: 'blending', label: 'Blending', route: '/operations', pageName: 'Daily Readings', module: 'operations', aliases: ['blending-wells'] },
  { id: 'power', label: 'Power Meters', route: '/operations', pageName: 'Daily Readings', module: 'operations', aliases: ['power-meters'] },

  // ── PM Schedule (/maintenance) ────────────────────────────────────────────
  { id: 'calendar', label: 'PM Calendar', route: '/maintenance', pageName: 'PM Schedule', module: 'pm_schedule' },
  { id: 'records', label: 'PM Records', route: '/maintenance', pageName: 'PM Schedule', module: 'pm_schedule' },
  { id: 'add', label: 'Add Maintenance Task', route: '/maintenance', pageName: 'PM Schedule', module: 'pm_schedule' },

  // ── Incidents (/incidents) ────────────────────────────────────────────────
  { id: 'open', label: 'Open Incidents', route: '/incidents', pageName: 'Incidents', module: 'incidents' },
  { id: 'report', label: 'Report Incident', route: '/incidents', pageName: 'Incidents', module: 'incidents' },
  { id: 'history', label: 'Incident History', route: '/incidents', pageName: 'Incidents', module: 'incidents' },

  // ── Plants (/plants) ──────────────────────────────────────────────────────
  { id: 'locators', label: 'Locators', route: '/plants', pageName: 'Plants', module: 'plants', aliases: ['locator'] },
  { id: 'wells', label: 'Wells', route: '/plants', pageName: 'Plants', module: 'plants', aliases: ['well'] },
  { id: 'product', label: 'Product Meters', route: '/plants', pageName: 'Plants', module: 'plants' },
  { id: 'trains', label: 'RO Trains', route: '/plants', pageName: 'Plants', module: 'plants', aliases: ['ro-trains'] },
  { id: 'power', label: 'Power & Energy', route: '/plants', pageName: 'Plants', module: 'plants' },
  { id: 'configuration', label: 'Plant Configuration', route: '/plants', pageName: 'Plants', module: 'plants', aliases: ['config', 'settings'] },

  // ── Compliance (/compliance) ──────────────────────────────────────────────
  { id: 'status', label: 'Compliance Status', route: '/compliance', pageName: 'Compliance', module: 'compliance' },
  { id: 'fleet', label: 'Fleet Compliance', route: '/compliance', pageName: 'Compliance', module: 'compliance' },
  { id: 'thresholds', label: 'Water Quality Thresholds', route: '/compliance', pageName: 'Compliance', module: 'compliance', keywords: ['limits', 'ranges'] },
  { id: 'whatif', label: 'What-If Simulation', route: '/compliance', pageName: 'Compliance', module: 'compliance', keywords: ['calculator', 'predict'] },

  // ── Data Corrections (/data-corrections) ──────────────────────────────────
  { id: 'pending', label: 'Pending Review', route: '/data-corrections', pageName: 'Data Corrections', module: 'data_corrections', keywords: ['queue', 'approvals'] },
  { id: 'inbox', label: 'Correction Inbox', route: '/data-corrections', pageName: 'Data Corrections', module: 'data_corrections' },
  { id: 'history', label: 'Correction History', route: '/data-corrections', pageName: 'Data Corrections', module: 'data_corrections', keywords: ['audit'] },
  { id: 'operators', label: 'Operator Stats', route: '/data-corrections', pageName: 'Data Corrections', module: 'data_corrections', keywords: ['ranking', 'metrics'] },

  // ── Costs & Tariffs (/costs) ──────────────────────────────────────────────
  { id: 'rollup', label: 'Cost Rollup', route: '/costs', pageName: 'Costs & Tariffs', module: 'costs' },
  { id: 'power', label: 'Power Costs & Tariffs', route: '/costs', pageName: 'Costs & Tariffs', module: 'costs', keywords: ['kwh', 'rates'] },
  { id: 'compare', label: 'Plant Comparison', route: '/costs', pageName: 'Costs & Tariffs', module: 'costs' },
  { id: 'prices', label: 'Chemical Prices', route: '/costs', pageName: 'Costs & Tariffs', module: 'costs' },
  { id: 'filters', label: 'Filter Replacement Costs', route: '/costs', pageName: 'Costs & Tariffs', module: 'costs' },
  { id: 'budget', label: 'OPEX Budget', route: '/costs', pageName: 'Costs & Tariffs', module: 'costs', keywords: ['forecast', 'allowance'] },

  // ── Employees (/employees) ────────────────────────────────────────────────
  { id: 'staff', label: 'Staff Directory', route: '/employees', pageName: 'Employees', module: 'employees' },
  { id: 'kpi', label: 'Duty & KPI Tracker', route: '/employees', pageName: 'Employees', module: 'employees' },
  { id: 'org-chart', label: 'Organization Chart', route: '/employees', pageName: 'Employees', module: 'employees' },

  // ── Admin Console (/admin) ────────────────────────────────────────────────
  { id: 'users', label: 'User Management', route: '/admin', pageName: 'Admin Console', module: 'admin_users' },
  { id: 'plants', label: 'Plant Settings', route: '/admin', pageName: 'Admin Console', module: 'admin_plants' },
  { id: 'audit', label: 'Audit Logs', route: '/admin', pageName: 'Admin Console', module: 'admin_audit' },
  { id: 'migrations', label: 'Database Migrations', route: '/admin', pageName: 'Admin Console', module: 'admin_users' },
  { id: 'roles', label: 'Role Permissions', route: '/admin', pageName: 'Admin Console', module: 'admin_users' },
];

/**
 * Returns all tabs matching a search query that the caller can view.
 */
export function searchTabs(query: string, can: (module: ModuleKey) => boolean): TabDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return TAB_REGISTRY.filter((tab) => {
    if (!can(tab.module)) return false;
    const matchTarget = `${tab.label} ${tab.pageName} ${tab.id} ${(tab.keywords ?? []).join(' ')}`.toLowerCase();
    return matchTarget.includes(q);
  });
}

/**
 * Returns the formatted document title for a given route and tab.
 */
export function getTabDocumentTitle(pathname: string, tabId: string): string | null {
  const match = TAB_REGISTRY.find(
    (t) => t.route === pathname && (t.id.toLowerCase() === tabId.toLowerCase() || t.aliases?.includes(tabId.toLowerCase())),
  );
  if (!match) return null;
  return `${match.pageName} · ${match.label} | PWRI Plant Monitoring`;
}
