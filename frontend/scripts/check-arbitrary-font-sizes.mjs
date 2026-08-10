#!/usr/bin/env node
/**
 * check-arbitrary-font-sizes.mjs
 *
 * The compact type scale (text-3xs/text-2xs in tailwind.config.ts) exists so
 * dense UI (RO train readings, meter grids, KPI badges) doesn't fall back to
 * one-off text-[Npx] arbitrary values. That migration is done as of
 * 2026-08-10 — this script's job is making sure it stays done.
 *
 * Every text-[Npx] usage left in the codebase is deliberate (documented
 * in-place) rather than debt: components/manual/bookPrimitives.tsx's own
 * serif reading-type system, components/OdometerRollerInput.tsx's larger
 * digit sizes, and one responsive label-collapse trick in
 * pages/plants/index.tsx that isn't really a font size. ALLOWLIST below is
 * the exact, current set of those.
 *
 * Unlike check-lint-ceiling.mjs's numeric ceiling, this is a set match: any
 * usage not in ALLOWLIST is new debt and fails the check; any ALLOWLIST
 * entry no longer found in the codebase is stale and also fails, so the
 * list can't silently drift out of sync with reality in either direction.
 *
 * Usage:
 *   node scripts/check-arbitrary-font-sizes.mjs
 *
 * To add a new arbitrary size deliberately: add a comment at the usage site
 * explaining why the compact scale (or text-xs and up) doesn't fit, then add
 * an entry here with the same reasoning. Don't add one just to make this
 * script pass — that's the debt this exists to prevent.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', 'src');

const ALLOWLIST = [
  { file: 'components/manual/bookPrimitives.tsx', value: '17px', reason: 'Manual reader serif type system, not the dashboard compact scale.' },
  { file: 'components/manual/bookPrimitives.tsx', value: '18px', reason: 'Manual reader serif type system, not the dashboard compact scale.' },
  { file: 'components/manual/bookPrimitives.tsx', value: '13.5px', reason: 'Manual reader serif type system, not the dashboard compact scale.' },
  { file: 'components/OdometerRollerInput.tsx', value: '17px', reason: 'Odometer digit readability, a separate choice from the compact scale.' },
  { file: 'components/OdometerRollerInput.tsx', value: '18px', reason: 'Odometer digit readability, a separate choice from the compact scale.' },
  { file: 'components/OdometerRollerInput.tsx', value: '19px', reason: 'Odometer digit readability, a separate choice from the compact scale.' },
  { file: 'pages/plants/index.tsx', value: '0px', reason: "Responsive label-collapse trick, not a font size — see the comment at the usage site." },
];

function findUsages() {
  let stdout;
  try {
    stdout = execFileSync(
      'grep',
      ['-rEo', String.raw`text-\[[0-9.]+px\]`, '.', '-l', '--include=*.tsx', '--include=*.ts', '--include=*.css'],
      { cwd: srcRoot, encoding: 'utf8' },
    );
  } catch (err) {
    // grep exits 1 when it finds nothing at all — that's success (0 usages).
    if (err.status === 1) return [];
    throw err;
  }
  const files = stdout.trim().split('\n').filter(Boolean);

  const usages = [];
  for (const relFile of files) {
    const grepOut = execFileSync(
      'grep', ['-Eo', String.raw`text-\[[0-9.]+px\]`, relFile],
      { cwd: srcRoot, encoding: 'utf8' },
    );
    const matches = grepOut.trim().split('\n').filter(Boolean);
    for (const m of matches) {
      const cleanValue = m.match(/\[([0-9.]+px)\]/)[1];
      usages.push({ file: relFile.replace(/^\.\//, ''), value: cleanValue });
    }
  }
  return usages;
}

const usages = findUsages();

const usageKey = (u) => `${u.file}::${u.value}`;
const allowKey = (a) => `${a.file}::${a.value}`;

const usageSet = new Map(usages.map((u) => [usageKey(u), u]));
const allowSet = new Map(ALLOWLIST.map((a) => [allowKey(a), a]));

const newDebt = usages.filter((u) => !allowSet.has(usageKey(u)));
const staleAllowlist = ALLOWLIST.filter((a) => !usageSet.has(allowKey(a)));

if (newDebt.length === 0 && staleAllowlist.length === 0) {
  console.log(`OK — ${usages.length} arbitrary text-[Npx] usage(s), all documented and allowlisted.`);
  process.exit(0);
}

if (newDebt.length > 0) {
  console.error('\nNew undocumented text-[Npx] usage(s) found:');
  for (const u of newDebt) console.error(`  ${u.file}: text-[${u.value}]`);
  console.error(
    '\nUse text-3xs (9px) or text-2xs (10px) from the compact scale if this is dense-UI ' +
    'chrome. If it genuinely needs to be a one-off, add a comment explaining why at the ' +
    'usage site and add a matching entry to ALLOWLIST in this script.',
  );
}

if (staleAllowlist.length > 0) {
  console.error('\nALLOWLIST entries no longer found in the codebase (remove them):');
  for (const a of staleAllowlist) console.error(`  ${a.file}: text-[${a.value}]`);
}

process.exit(1);
