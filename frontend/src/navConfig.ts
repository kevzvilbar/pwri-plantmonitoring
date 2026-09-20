/**
 * Navigation configuration generated from PERMISSION_MATRIX.
 *
 * This is the single source for what appears in AppSidebar and BottomNav.
 * Both components import from here instead of hand-coding role lists.
 */

import { hasPermission, MODULE_LABELS, type ModuleKey, type Role } from '@/lib/permissions';
import { ComponentType } from 'react';

export interface NavItem {
  route: string;
  moduleKey: ModuleKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
  matchPaths?: string[];
  matchTabValues?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Icon map - keeps icons consistent across sidebar and bottom nav
import {
  LayoutDashboard, Bell, Building2, Droplet,
  GitBranch, Wrench, AlertTriangle, Award,
  PesoSignIcon, Users, ShieldCheck, ShieldAlert,
  ClipboardCheck, FlaskConical, Download, Upload,
} from 'lucide-react';
import { ROTrainIcon as ROTrainIconComponent } from '@/components/icons/water-icons';

const ICON_MAP: Record<ModuleKey, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  alerts: Bell,
  compliance: ShieldCheck,
  plants: Building2,
  operations: Droplet,
  ro_trains: ROTrainIconComponent,
  network_topology: GitBranch,
  pm_schedule: Wrench,
  incidents: AlertTriangle,
  manager_scorecard: Award,
  costs: PesoSignIcon,
  employees: Users,
  data_exports: Download,
  smart_import: Upload,
  data_analysis_review: FlaskConical,
  data_corrections: ClipboardCheck,
  admin_users: ShieldAlert,
  admin_plants: Building2,
  admin_audit: ShieldAlert,
  admin_migrations: ShieldAlert,
  profile: LayoutDashboard,
};

const ROUTE_MAP: Record<ModuleKey, string> = {
  dashboard: '/',
  alerts: '/alerts',
  compliance: '/compliance',
  plants: '/plants',
  operations: '/operations',
  ro_trains: '/ro-trains',
  network_topology: '/topology',
  pm_schedule: '/maintenance',
  incidents: '/incidents',
  manager_scorecard: '/manager-scorecard',
  costs: '/costs',
  employees: '/employees',
  data_exports: '/exports',
  smart_import: '/import',
  data_analysis_review: '/data-analysis',
  data_corrections: '/data-corrections',
  admin_users: '/admin',
  profile: '/profile',
};

// 6 groups organized by user task (down from 8)
const GROUP_DEFS: { label: string; moduleKeys: ModuleKey[] }[] = [
  { label: 'Overview', moduleKeys: ['dashboard', 'alerts'] },
  { label: 'Assets', moduleKeys: ['plants', 'network_topology'] },
  { label: 'Daily Logs', moduleKeys: ['operations', 'ro_trains', 'pm_schedule', 'incidents'] },
  { label: 'Review', moduleKeys: ['data_analysis_review', 'data_corrections', 'manager_scorecard'] },
  { label: 'Admin', moduleKeys: ['admin_users'] },
  { label: 'Other', moduleKeys: ['compliance', 'costs', 'employees', 'data_exports', 'smart_import', 'profile'] },
];

const MODULE_TO_GROUP: Record<ModuleKey, string> = {};
for (const group of GROUP_DEFS) {
  for (const mk of group.moduleKeys) MODULE_TO_GROUP[mk] = group.label;
}

/**
 * Build navigation groups for a given role's permissions.
 * Only modules where the user has 'view' permission appear.
 */
export function buildNavConfig(roles: string[] | Role[]): NavGroup[] {
  const groups: NavGroup[] = [];

  for (const groupDef of GROUP_DEFS) {
    const items: NavItem[] = [];

    for (const moduleKey of groupDef.moduleKeys) {
      if (hasPermission(roles as Role[], moduleKey as ModuleKey, 'view') && !moduleKey.startsWith('admin_')) {
        items.push({
          route: ROUTE_MAP[moduleKey],
          moduleKey,
          label: MODULE_LABELS[moduleKey],
          icon: ICON_MAP[moduleKey],
          matchPaths: getMatchPaths(moduleKey),
          matchTabValues: getMatchTabValues(moduleKey),
        });
      }
    }

    if (items.length > 0) {
      groups.push({ label: groupDef.label, items });
    }
  }

  return groups;
}

function getMatchPaths(moduleKey: ModuleKey): string[] | undefined {
  switch (moduleKey) {
    case 'operations': return ['/operations'];
    case 'plants': return ['/plants', '/plants/'];
    default: return undefined;
  }
}

function getMatchTabValues(moduleKey: ModuleKey): string[] | undefined {
  switch (moduleKey) {
    case 'operations': return ['well', 'wells', 'locator', 'locators', 'product', 'blending', 'power'];
    case 'ro_trains': return ['overview', 'pretreat-ro', 'chemical-dosing', 'pretreat'];
    default: return undefined;
  }
}

export function getGroupForModule(moduleKey: ModuleKey): string {
  return MODULE_TO_GROUP[moduleKey] ?? 'Other';
}
