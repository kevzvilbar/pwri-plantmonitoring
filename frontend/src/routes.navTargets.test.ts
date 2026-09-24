import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTER_ROUTE_MAP } from '@/components/manual/chapterRoutes';

// Regression guard for a bug found while finishing P5-5: ProductMeterRow sent
// users to `/corrections?tab=inbox`. No such route exists (the page is
// `/data-corrections`), so the chip landed on the NotFound page. Nothing
// caught it because a navigate() target is just a string.
//
// This test reads App.tsx for the declared route patterns, then scans the
// source for literal in-app targets (navigate('/x'), <Navigate to="/x" />,
// <Link to="/x">) and requires each one to match a declared route. Targets
// built at runtime (variables, ROUTE_MAP lookups) are out of scope: only
// literals can be checked statically.

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Declared route patterns, e.g. "/plants/:id/wells/:wellId". "*" is the 404 catch-all, so it is excluded. */
function declaredRoutes(): RegExp[] {
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  const patterns = [...app.matchAll(/<Route\s[^>]*?\bpath="([^"]+)"/g)].map((m) => m[1]);
  return patterns
    .filter((p) => p !== '*')
    .map((p) => new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}/?$`));
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.|\.d\.ts$/.test(e.name) ? [full] : [];
  });
}

// navigate('/x') · navigate("/x") · navigate(`/x/${id}`) · <Navigate to="/x"> · <Link to={`/x`}>
// · route-shaped object properties: { route: '/x' } (nav items), { linkPath: '/x' } (alerts),
//   { to: '/x' }, { href: '/x' }
const TARGET_RES = [
  /\bnavigate\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g,
  /<(?:Navigate|Link|NavLink)\s[^>]*?\bto=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g,
  /\b(?:route|linkPath|to|href):\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g,
];

/** "/plants/${id}?tab=x#y" -> "/plants/x": drop expressions first (they may contain "?"), then query and hash. */
function toPathname(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, 'x').split(/[?#]/)[0];
}

function literalTargets(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  return TARGET_RES.flatMap((re) =>
    [...text.matchAll(re)].map((m) => m.slice(1).find((g) => g !== undefined) ?? ''),
  ).filter((t) => t.startsWith('/') && !t.startsWith('//'));
}

describe('in-app navigation targets', () => {
  const routes = declaredRoutes();

  it('finds the routes declared in App.tsx (guards against the extractor silently matching nothing)', () => {
    expect(routes.length).toBeGreaterThan(15);
    expect(routes.some((r) => r.test('/data-corrections'))).toBe(true);
    expect(routes.some((r) => r.test('/plants/abc/wells/def'))).toBe(true);
  });

  it('does not treat the old broken path as a route', () => {
    expect(routes.some((r) => r.test('/corrections'))).toBe(false);
  });

  it('every literal navigate()/Navigate/Link target resolves to a declared route', { timeout: 60000 }, () => {
    const broken: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const target of literalTargets(file)) {
        if (!routes.some((r) => r.test(toPathname(target)))) {
          broken.push(`${path.relative(SRC, file)}: ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  // The scan above only sees navigate('/x') literals. The manual's "Open module"
  // targets live in a lookup table, so check those values directly.
  it('every manual chapter route (CHAPTER_ROUTE_MAP) resolves to a declared route', () => {
    const broken = Object.entries(CHAPTER_ROUTE_MAP)
      .filter(([, route]) => !routes.some((r) => r.test(toPathname(route))))
      .map(([chapter, route]) => `${chapter}: ${route}`);
    expect(broken).toEqual([]);
  });

  // Nav items and alert links are object properties, not navigate() calls: a typo
  // in navConfig's `route:` would put a dead link in the sidebar.
  it('also scans route-shaped properties, where the nav items live', () => {
    const navTargets = literalTargets(path.join(SRC, 'navConfig.ts'));
    expect(navTargets).toContain('/data-corrections');
    expect(navTargets.length).toBeGreaterThan(10);
  });

  // This file proves a target EXISTS, not that the user can OPEN it: an Operator
  // is sent to "/" with a toast from every page outside ProtectedRoute's list.
  // See components/dashboard/OperatorDeadEnds.test.tsx for that half.
});
