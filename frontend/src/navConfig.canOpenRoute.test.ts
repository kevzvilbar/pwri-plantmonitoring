import { describe, it, expect } from 'vitest';
import { canOpenRoute } from '@/navConfig';
import { hasPermission, type Role } from '@/lib/permissions';

const canFor = (role: Role) => (m: Parameters<typeof hasPermission>[1], a: Parameters<typeof hasPermission>[2] = 'view') =>
  hasPermission([role], m, a);

/**
 * canOpenRoute used to compare the raw string with each nav item's route, so
 * "/costs?tab=rollup" matched nothing and fell through to "no nav item: open".
 */
describe('canOpenRoute: the path decides, not the exact string', () => {
  const operator = canFor('Operator');

  it.each([
    '/costs', '/costs?tab=rollup', '/costs?tab=budget&plant=p1', '/costs#top', '/costs/', '/costs/?tab=power',
    '/data-corrections?tab=pending', '/compliance?x=1', '/topology?plant=p1', '/admin?tab=users', '/exports/', '/import?x',
  ])('an Operator cannot open %s', (route) => {
    expect(canOpenRoute(route, operator)).toBe(false);
  });

  it.each([
    '/', '/?x=1', '/plants', '/plants?tab=wells', '/plants/abc', '/plants/abc/wells/def?tab=x', '/operations?tab=well',
    '/ro-trains?tab=cip&train=t1', '/alerts', '/profile', '/help', '/help?chapter=costs',
  ])('an Operator can open %s', (route) => {
    expect(canOpenRoute(route, operator)).toBe(true);
  });

  it('a sub-route follows the nav item above it', () => {
    expect(canOpenRoute('/admin/anything', operator)).toBe(false);
    expect(canOpenRoute('/plants/abc', operator)).toBe(true);
  });

  it('"/" is the Dashboard only: it is not a parent of every other route', () => {
    expect(canOpenRoute('/costs', operator)).toBe(false);
    expect(canOpenRoute('/data-analysis?x=1', operator)).toBe(false);
  });

  it('a role that may view the page can open it with a query string', () => {
    expect(canOpenRoute('/costs?tab=rollup', canFor('Admin'))).toBe(true);
    expect(canOpenRoute('/admin?tab=users', canFor('Admin'))).toBe(true);
    expect(canOpenRoute('/topology?plant=p1', canFor('Technician'))).toBe(true);
  });

  it('a path that belongs to no nav item stays open, as documented', () => {
    expect(canOpenRoute('/somewhere-new', operator)).toBe(true);
  });
});
