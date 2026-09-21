import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetPath, readingsPath, type AssetKind } from './assetLinks';
import { wellDetailPath } from '@/features/wells/lib/wellRoutes';

const KINDS: AssetKind[] = ['well', 'locator', 'product'];

/** Declared route patterns from App.tsx, as regexes ("/plants/:id/wells/:wellId" -> /^\/plants\/[^/]+\/wells\/[^/]+\/?$/). */
function declaredRoutes(): RegExp[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(here, '..', 'App.tsx'), 'utf8');
  return [...app.matchAll(/<Route\s[^>]*?\bpath="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== '*')
    .map((p) => new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}/?$`));
}

const pathnameOf = (url: string) => url.split(/[?#]/)[0];

describe('assetPath (P5-7): the asset in Plants', () => {
  it('a well goes to its own page, not to the wells list', () => {
    // The regression this file exists for: after P5-3 a well has a page of its
    // own, but the reading row kept linking to `?tab=wells&highlight=`.
    expect(assetPath('well', 'p1', 'w1')).toBe('/plants/p1/wells/w1');
    expect(assetPath('well', 'p1', 'w1')).toBe(wellDetailPath('p1', 'w1'));
  });

  it('a locator goes to its card on the plant\u2019s Locators tab', () => {
    expect(assetPath('locator', 'p1', 'l1')).toBe('/plants/p1?tab=locators&highlight=l1');
  });

  it('a product meter goes to its card on the plant\u2019s Product tab', () => {
    expect(assetPath('product', 'p1', 'm1')).toBe('/plants/p1?tab=product&highlight=m1');
  });

  it.each(KINDS)('%s: lands on a declared route (never the NotFound page)', (kind) => {
    const pathname = pathnameOf(assetPath(kind, 'p1', 'x1'));
    expect(declaredRoutes().some((re) => re.test(pathname))).toBe(true);
  });
});

describe('readingsPath (P5-7): the asset in Daily Readings', () => {
  it.each([
    ['well', '/operations?tab=well&highlight=w1'],
    ['locator', '/operations?tab=locator&highlight=w1'],
    ['product', '/operations?tab=product&highlight=w1'],
  ] as const)('%s', (kind, expected) => {
    expect(readingsPath(kind, 'w1')).toBe(expected);
  });

  it.each(KINDS)('%s: lands on a declared route', (kind) => {
    const pathname = pathnameOf(readingsPath(kind, 'x1'));
    expect(declaredRoutes().some((re) => re.test(pathname))).toBe(true);
  });
});
