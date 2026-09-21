import { describe, it, expect } from 'vitest';
import { buildNavConfig, isNavItemActive, type Can, type NavItem } from '@/navConfig';
import { hasPermission, MODULE_LABELS, type Role } from '@/lib/permissions';
import { OPERATOR_ALLOWED_PATHS } from '@/components/ProtectedRoute';

const canFor = (role: Role): Can => (moduleKey, action = 'view') => hasPermission([role], moduleKey, action);

// Group → item labels, in order. Appendix A of docs/NAV-IA-REMEDIATION-PLAN.md.
const shape = (role: Role) =>
  buildNavConfig(canFor(role)).map((g) => [g.label, g.items.map((i) => i.label)] as const);

// P5-6 added My Corrections: anyone can raise a correction request, so anyone can follow one up.
const DAILY_LOGS = ['Daily Readings', 'RO Trains', 'PM Schedule', 'Incidents', 'My Corrections'];
const REVIEW = ['Data Analysis & Review', 'Data Corrections', 'Manager Scorecard'];

const EXPECTED: Record<Role, ReadonlyArray<readonly [string, string[]]>> = {
  Operator: [
    ['Overview', ['Dashboard', 'Alerts']],
    ['Daily Logs', DAILY_LOGS],
    ['Assets', ['Plants']],
    ['Team & Admin', ['Employees']],
  ],
  Technician: [
    ['Overview', ['Dashboard', 'Alerts', 'Compliance']],
    ['Daily Logs', DAILY_LOGS],
    ['Assets', ['Plants', 'Network Topology']],
    ['Reports & Data', ['Costs & Tariffs']],
    ['Team & Admin', ['Employees']],
  ],
  Manager: [
    ['Overview', ['Dashboard', 'Alerts', 'Compliance']],
    ['Daily Logs', DAILY_LOGS],
    ['Assets', ['Plants', 'Network Topology']],
    ['Review', REVIEW],
    ['Reports & Data', ['Costs & Tariffs', 'Data Exports', 'Smart Import']],
    ['Team & Admin', ['Employees', 'Admin Console']],
  ],
  'Data Analyst': [
    ['Overview', ['Dashboard', 'Alerts', 'Compliance']],
    ['Daily Logs', DAILY_LOGS],
    ['Assets', ['Plants', 'Network Topology']],
    ['Review', REVIEW],
    ['Reports & Data', ['Costs & Tariffs', 'Data Exports', 'Smart Import']],
    ['Team & Admin', ['Employees']],
  ],
  Admin: [
    ['Overview', ['Dashboard', 'Alerts', 'Compliance']],
    ['Daily Logs', DAILY_LOGS],
    ['Assets', ['Plants', 'Network Topology']],
    ['Review', REVIEW],
    ['Reports & Data', ['Costs & Tariffs', 'Data Exports', 'Smart Import']],
    ['Team & Admin', ['Employees', 'Admin Console']],
  ],
};

const ROLES = Object.keys(EXPECTED) as Role[];

describe('buildNavConfig — exact output per role', () => {
  for (const role of ROLES) {
    it(`${role}`, () => {
      expect(shape(role)).toEqual(EXPECTED[role]);
    });
  }

  it('item counts match the plan (9 / 12 / 18 / 17 / 18)', () => {
    const count = (r: Role) => buildNavConfig(canFor(r)).reduce((n, g) => n + g.items.length, 0);
    expect(ROLES.map(count)).toEqual([9, 12, 18, 17, 18]);
  });

  it('never has a group called Other, and Profile is not a nav item', () => {
    for (const role of ROLES) {
      const groups = buildNavConfig(canFor(role));
      expect(groups.map((g) => g.label)).not.toContain('Other');
      expect(groups.flatMap((g) => g.items.map((i) => i.route))).not.toContain('/profile');
    }
  });

  it('a user who can view nothing gets no groups', () => {
    expect(buildNavConfig(() => false)).toEqual([]);
  });

  it('only ever asks about the view action', () => {
    const actions = new Set<string | undefined>();
    buildNavConfig((_m, a) => { actions.add(a); return true; });
    expect([...actions]).toEqual(['view']);
  });
});

describe('Admin Console visibility (D1: any admin_* view)', () => {
  const adminGroup = (can: Can) =>
    buildNavConfig(can).find((g) => g.label === 'Team & Admin')?.items.map((i) => i.label) ?? [];

  it('is shown for a user who can view only Admin → Audit', () => {
    expect(adminGroup((m) => m === 'admin_audit')).toEqual(['Admin Console']);
  });
  it('is shown for a user who can view only Admin → Plants', () => {
    expect(adminGroup((m) => m === 'admin_plants')).toEqual(['Admin Console']);
  });
  it('is hidden when no admin tab is viewable', () => {
    expect(adminGroup((m) => m === 'employees')).toEqual(['Employees']);
  });
  it('follows the rule exactly: admin_migrations alone does not show the link', () => {
    expect(adminGroup((m) => m === 'admin_migrations')).toEqual([]);
  });
});

describe('nav data integrity', () => {
  const all = buildNavConfig(() => true).flatMap((g) => g.items);

  it('has unique ids, routes, and icons (no two items share a glyph)', () => {
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    expect(new Set(all.map((i) => i.route)).size).toBe(all.length);
    expect(new Set(all.map((i) => i.icon)).size).toBe(all.length);
  });

  it('labels come from MODULE_LABELS (except the multi-module Admin Console)', () => {
    for (const item of all.filter((i) => i.id !== 'admin')) {
      expect(item.label, item.id).toBe(MODULE_LABELS[item.modules[0]]);
    }
  });

  it('every item is gated by at least one module', () => {
    for (const item of all) expect(item.modules.length, item.id).toBeGreaterThan(0);
  });
});

describe('mobile bottom-bar slots (D4)', () => {
  const slots = (role: Role) =>
    buildNavConfig(canFor(role))
      .flatMap((g) => g.items)
      .filter((i) => i.priority != null)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((i) => i.mobileLabel ?? i.label);

  it('is Readings · RO Trains · Dashboard · Alerts for every role, Plants left to More', () => {
    for (const role of ROLES) {
      expect(slots(role), role).toEqual(['Readings', 'RO Trains', 'Dashboard', 'Alerts']);
    }
  });

  it('Alerts carries the alerts badge', () => {
    const alerts = buildNavConfig(() => true).flatMap((g) => g.items).find((i) => i.id === 'alerts');
    expect(alerts?.badge).toBe('alerts');
  });
});

describe('Operator reachability', () => {
  // Same test the route guard applies (ProtectedRoute): '/' is exact, the rest are prefixes.
  const guardAllows = (path: string) =>
    OPERATOR_ALLOWED_PATHS.some((p) => (p === '/' ? path === '/' : path.startsWith(p)));

  it('every route an Operator sees in the nav is in OPERATOR_ALLOWED_PATHS', () => {
    const routes = buildNavConfig(canFor('Operator')).flatMap((g) => g.items.map((i) => i.route));
    expect(routes.length).toBeGreaterThan(0);
    const blocked = routes.filter((r) => !guardAllows(r));
    expect(blocked, `Operator sees these in the nav but ProtectedRoute redirects them: ${blocked.join(', ')}`).toEqual([]);
  });
});

describe('isNavItemActive', () => {
  const item = (over: Partial<NavItem>): NavItem => ({
    id: 'x', label: 'X', route: '/plants', icon: () => null, modules: ['plants'], ...over,
  });

  it('exact-only items (Dashboard) do not match sub-paths', () => {
    const home = item({ route: '/', end: true });
    expect(isNavItemActive(home, '/')).toBe(true);
    expect(isNavItemActive(home, '/plants')).toBe(false);
  });
  it('matches the route and anything beneath it', () => {
    expect(isNavItemActive(item({}), '/plants')).toBe(true);
    expect(isNavItemActive(item({}), '/plants/abc123')).toBe(true);
    expect(isNavItemActive(item({}), '/plants/abc123/wells/w1')).toBe(true);
  });
  it('does not match a path that merely shares a prefix', () => {
    expect(isNavItemActive(item({}), '/plantsfoo')).toBe(false);
    expect(isNavItemActive(item({ route: '/operations' }), '/operations-archive')).toBe(false);
  });
  it('ignores ?tab= entirely (matches on pathname)', () => {
    // Regression: the old mobile nav compared ?tab= against a hand-kept list
    // and showed Readings as inactive on bare /operations.
    expect(isNavItemActive(item({ route: '/operations' }), '/operations')).toBe(true);
  });
});
