/**
 * Navigation structure: the single source for what AppSidebar and BottomNav
 * render. Plain data plus one pure builder.
 *
 * This file knows nothing about roles. Callers pass a `Can` predicate (see
 * `useCan()` in hooks/usePermission.ts), so custom-role overrides from
 * Admin → Roles hide nav items the same way they gate pages.
 *
 * Route guarding is separate: ProtectedRoute.OPERATOR_ALLOWED_PATHS.
 * navConfig.test.ts fails if an item an Operator can see is missing there.
 */

import type { ComponentType } from 'react';
import {
  LayoutDashboard, Bell, ShieldCheck, Droplet, Wrench, AlertTriangle,
  Building2, GitBranch, FlaskConical, ClipboardCheck, Award,
  Download, Upload, Users, ShieldAlert, SquarePen,
} from 'lucide-react';
import { ROTrainIcon, PesoSignIcon } from '@/components/icons/water-icons';
import { MODULE_LABELS, type Action, type ModuleKey } from '@/lib/permissions';

/** Same shape as `hasPermission(roles, moduleKey, action)` with roles bound. */
export type Can = (moduleKey: ModuleKey, action?: Action) => boolean;

export interface NavItem {
  /** Stable key: React key and test assertions. */
  readonly id: string;
  readonly label: string;
  /** Shorter label for the mobile bottom bar, when `label` is too wide. */
  readonly mobileLabel?: string;
  readonly route: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** Item is visible when the user can view ANY of these modules. */
  readonly modules: readonly ModuleKey[];
  /** Highlight only on an exact path match (used for '/'). Otherwise the
   *  route and anything beneath it (e.g. /plants/:id) counts as active. */
  readonly end?: boolean;
  /** Slot in the mobile bottom bar, left to right. Items without a priority
   *  are listed in the "More" sheet. */
  readonly priority?: number;
  /** Live indicator rendered next to the item (see NavItemBadge). `approvals`
   *  is the count of accounts waiting for an Admin; only Admins see it. */
  readonly badge?: 'alerts' | 'approvals';
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

// "Admin Console" is one page over several modules (admin_users, admin_plants,
// admin_audit, ...), so it has no single MODULE_LABELS entry.
const ADMIN_CONSOLE_LABEL = 'Admin Console';

// Group order and membership follow the target navigation in
// docs/NAV-IA-REMEDIATION-PLAN.md (Appendix A).
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', modules: ['dashboard'], label: MODULE_LABELS.dashboard, route: '/', icon: LayoutDashboard, end: true, priority: 3 },
      { id: 'alerts', modules: ['alerts'], label: MODULE_LABELS.alerts, route: '/alerts', icon: Bell, priority: 4, badge: 'alerts' },
      { id: 'compliance', modules: ['compliance'], label: MODULE_LABELS.compliance, route: '/compliance', icon: ShieldCheck },
    ],
  },
  {
    label: 'Daily Logs',
    items: [
      { id: 'operations', modules: ['operations'], label: MODULE_LABELS.operations, mobileLabel: 'Readings', route: '/operations', icon: Droplet, priority: 1 },
      { id: 'ro-trains', modules: ['ro_trains'], label: MODULE_LABELS.ro_trains, route: '/ro-trains', icon: ROTrainIcon, priority: 2 },
      { id: 'pm-schedule', modules: ['pm_schedule'], label: MODULE_LABELS.pm_schedule, route: '/maintenance', icon: Wrench },
      { id: 'incidents', modules: ['incidents'], label: MODULE_LABELS.incidents, route: '/incidents', icon: AlertTriangle },
      // Same icon as the "Fix" button that creates a request.
      { id: 'my-corrections', modules: ['my_corrections'], label: MODULE_LABELS.my_corrections, route: '/my-corrections', icon: SquarePen },
    ],
  },
  {
    label: 'Assets',
    items: [
      { id: 'plants', modules: ['plants'], label: MODULE_LABELS.plants, route: '/plants', icon: Building2 },
      { id: 'topology', modules: ['network_topology'], label: MODULE_LABELS.network_topology, route: '/topology', icon: GitBranch },
    ],
  },
  {
    label: 'Review',
    items: [
      { id: 'data-analysis', modules: ['data_analysis_review'], label: MODULE_LABELS.data_analysis_review, route: '/data-analysis', icon: FlaskConical },
      { id: 'data-corrections', modules: ['data_corrections'], label: MODULE_LABELS.data_corrections, route: '/data-corrections', icon: ClipboardCheck },
      { id: 'manager-scorecard', modules: ['manager_scorecard'], label: MODULE_LABELS.manager_scorecard, route: '/manager-scorecard', icon: Award },
    ],
  },
  {
    label: 'Reports & Data',
    items: [
      { id: 'costs', modules: ['costs'], label: MODULE_LABELS.costs, route: '/costs', icon: PesoSignIcon },
      { id: 'exports', modules: ['data_exports'], label: MODULE_LABELS.data_exports, route: '/exports', icon: Download },
      { id: 'import', modules: ['smart_import'], label: MODULE_LABELS.smart_import, route: '/import', icon: Upload },
    ],
  },
  {
    label: 'Team & Admin',
    items: [
      { id: 'employees', modules: ['employees'], label: MODULE_LABELS.employees, route: '/employees', icon: Users },
      // Anyone who can view any admin tab gets the link; AdminPage gates each
      // tab itself (Managers land on Plants, not Users).
      { id: 'admin', modules: ['admin_users', 'admin_plants', 'admin_audit'], label: ADMIN_CONSOLE_LABEL, route: '/admin', icon: ShieldAlert, badge: 'approvals' },
    ],
  },
];

/** Groups (and their items) the user can view. Empty groups are dropped. */
export function buildNavConfig(can: Can): NavGroup[] {
  return NAV_GROUPS
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => item.modules.some((m) => can(m, 'view'))),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Can the user open `route` from a link that is not in the nav (a button in the
 * manual, say)? A route that belongs to a nav item follows that item's modules,
 * so this can never disagree with what the sidebar shows. A route that belongs
 * to no nav item (/profile, /help) is open to every signed-in user.
 *
 * `route` may be a full in-app URL. The query string, the hash and a trailing
 * slash are ignored ("/costs?tab=rollup" is the Costs page), and a sub-route
 * belongs to the nav item above it ("/plants/abc" is Plants). Comparing the raw
 * string instead would let "/costs?tab=rollup" match no nav item and fall
 * through to "open to everyone".
 */
export function canOpenRoute(route: string, can: Can): boolean {
  const pathname = route.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const owner = NAV_GROUPS.flatMap((g) => g.items)
    .filter((i) => i.route === pathname || (i.route !== '/' && pathname.startsWith(`${i.route}/`)))
    .sort((a, b) => b.route.length - a.route.length)[0];
  return owner ? owner.modules.some((m) => can(m, 'view')) : true;
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.route;
  return pathname === item.route || pathname.startsWith(`${item.route}/`);
}
