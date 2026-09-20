import { describe, it, expect } from 'vitest';
import { CHAPTER_ROUTE_MAP, chapterLink } from './chapterRoutes';
import { BOOK_PARTS } from './bookChapters';
import { canOpenRoute, type Can } from '@/navConfig';
import { hasPermission, type Role } from '@/lib/permissions';
import { OPERATOR_ALLOWED_PATHS } from '@/components/ProtectedRoute';

const canFor = (role: Role): Can => (moduleKey, action = 'view') => hasPermission([role], moduleKey, action);

// The same test ProtectedRoute applies to an Operator.
const guardAllows = (pathname: string) =>
  OPERATOR_ALLOWED_PATHS.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));

const ROUTES = [...new Set(Object.values(CHAPTER_ROUTE_MAP))];

describe('manual "Open module" buttons vs. the route guard', () => {
  it('for an Operator, a chapter button is offered exactly when ProtectedRoute would let them in', () => {
    const canOperator = canFor('Operator');
    const mismatches = ROUTES.filter((r) => canOpenRoute(r, canOperator) !== guardAllows(r));
    expect(mismatches).toEqual([]);
  });

  it('an Operator is not offered the pages that used to end in "Access restricted"', () => {
    const canOperator = canFor('Operator');
    for (const r of ['/data-corrections', '/admin', '/costs', '/import', '/exports', '/topology',
      '/data-analysis', '/manager-scorecard', '/compliance']) {
      expect(canOpenRoute(r, canOperator), r).toBe(false);
    }
    for (const r of ['/', '/plants', '/operations', '/ro-trains', '/maintenance', '/incidents',
      '/employees', '/alerts', '/profile']) {
      expect(canOpenRoute(r, canOperator), r).toBe(true);
    }
  });

  it('a Manager can open Data Corrections and the Admin Console (D1); a Technician cannot open Admin', () => {
    expect(canOpenRoute('/data-corrections', canFor('Manager'))).toBe(true);
    expect(canOpenRoute('/admin', canFor('Manager'))).toBe(true); // D1: Plants/Audit tabs
    expect(canOpenRoute('/admin', canFor('Admin'))).toBe(true);
    expect(canOpenRoute('/admin', canFor('Technician'))).toBe(false);
  });

  it('routes with no nav item (/profile, /help) are open to everyone', () => {
    for (const role of ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'] as Role[]) {
      expect(canOpenRoute('/profile', canFor(role)), role).toBe(true);
      expect(canOpenRoute('/help', canFor(role)), role).toBe(true);
    }
  });
});

describe('CHAPTER_ROUTE_MAP', () => {
  it('only names chapters that exist in the manual (a typo would silently hide a button)', () => {
    const ids = new Set(BOOK_PARTS.flatMap((p) => p.chapters.map((c) => c.id)));
    expect(Object.keys(CHAPTER_ROUTE_MAP).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe('chapterLink', () => {
  it('opens the manual on /help, not Employees', () => {
    expect(chapterLink('alerts-triage', 'https://pwri.example', '/')).toBe(
      'https://pwri.example/help?chapter=alerts-triage',
    );
  });

  it('includes the router basename, with or without a trailing slash', () => {
    expect(chapterLink('costs', 'https://x.io', '/plantmonitoring/')).toBe('https://x.io/plantmonitoring/help?chapter=costs');
    expect(chapterLink('costs', 'https://x.io', '/plantmonitoring')).toBe('https://x.io/plantmonitoring/help?chapter=costs');
  });
});
