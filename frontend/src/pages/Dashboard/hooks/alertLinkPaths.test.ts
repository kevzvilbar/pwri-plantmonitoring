import { describe, it, expect } from 'vitest';
import { OPERATOR_ALLOWED_PATHS } from '@/components/ProtectedRoute';

/**
 * P2-3: every alert linkPath an operator can receive must survive
 * ProtectedRoute. '/' is exact, the rest are prefixes — same rule the guard
 * applies. Query strings are allowed (matching is on pathname), so
 * /ro-trains?tab=chemical-dosing passes while /chemicals does not.
 */
const OPERATOR_ALERT_LINK_PATHS = [
  '/ro-trains?tab=chemical-dosing',
  '/operations?tab=blending',
  '/operations?tab=power',
  '/operations',
];

function guardAllows(linkPath: string): boolean {
  const pathname = linkPath.split(/[?#]/)[0] || '/';
  return OPERATOR_ALLOWED_PATHS.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
}

describe('operator alert linkPaths are reachable (P2-3)', () => {
  it.each(OPERATOR_ALERT_LINK_PATHS)('%s passes ProtectedRoute', (path) => {
    expect(guardAllows(path)).toBe(true);
  });

  it('the old /chemicals link did not (regression guard)', () => {
    expect(guardAllows('/chemicals')).toBe(false);
  });
});
