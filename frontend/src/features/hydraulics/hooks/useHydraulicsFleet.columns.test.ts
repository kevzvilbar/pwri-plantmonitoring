/**
 * Regression guard: the fleet query once embedded `plants(code)`, a column the
 * plants table does not have, so the whole page failed with
 * "column plants_1.code does not exist". HydraulicsPage.test.tsx mocks the
 * Supabase client, so it can never catch that. This checks the embedded
 * columns against the generated types instead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const hook = readFileSync(resolve(root, 'features/hydraulics/hooks/useHydraulicsFleet.ts'), 'utf8').replace(/\r\n/g, '\n');
const types = readFileSync(resolve(root, 'integrations/supabase/types.ts'), 'utf8').replace(/\r\n/g, '\n');

function rowColumns(table: string): string[] {
  const start = types.indexOf(`      ${table}: {\n        Row: {`);
  expect(start, `table ${table} in types.ts`).toBeGreaterThan(-1);
  const body = types.slice(start, types.indexOf('        }\n', start));
  return [...body.matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]);
}

describe('useHydraulicsFleet select lists', () => {
  it('only embeds plants columns that exist', () => {
    const embed = hook.match(/plants\s*\(([^)]*)\)/);
    expect(embed, 'plants(...) embed').not.toBeNull();
    const cols = embed![1].split(',').map((c) => c.trim()).filter(Boolean);
    const real = rowColumns('plants');
    for (const c of cols) expect(real, `plants.${c}`).toContain(c);
  });

  it('only selects wells columns that exist', () => {
    const sel = hook.match(/\.from\('wells'\)\s*\.select\(`([\s\S]*?)`\)/)![1]
      .replace(/plants\s*\([^)]*\)/, '');
    const cols = sel.split(',').map((c) => c.trim()).filter(Boolean);
    const real = rowColumns('wells');
    for (const c of cols) expect(real, `wells.${c}`).toContain(c);
  });
});
