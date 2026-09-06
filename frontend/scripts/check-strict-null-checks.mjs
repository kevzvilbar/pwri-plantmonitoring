#!/usr/bin/env node
/**
 * check-strict-null-checks.mjs
 *
 * Incremental strictNullChecks adoption (roadmap Phase 1: "enable
 * strictNullChecks incrementally, starting with lib/ files").
 *
 * Enabling `strictNullChecks` across this codebase in one change is not
 * feasible — ~4 MB of Lovable-scaffolded TSX was written with it off, and
 * turning it on today produces thousands of errors. A big-bang flip would
 * also stall every in-flight branch that merges into the resulting wall of
 * conflicts.
 *
 * The ratchet instead works like the ESLint warning ceiling: a committed
 * allowlist (strict-null-checks.json) names the files that are HELD to the
 * strictNullChecks standard. `tsc` runs once over the whole project with
 * strictNullChecks ON (tsconfig.strict.json); the check passes only if:
 *
 *   1. ZERO errors are reported in any allowlisted file, and
 *   2. every allowlist entry exists on disk.
 *
 * Errors in non-allowlisted files are IGNORED — that's the whole point.
 * To tighten the ratchet, verify a candidate file is clean, add it to the
 * allowlist, commit. To find candidates, run:
 *
 *   node scripts/check-strict-null-checks.mjs --suggest
 *
 * Usage:
 *   node scripts/check-strict-null-checks.mjs              # check (CI mode)
 *   node scripts/check-strict-null-checks.mjs --suggest    # list clean candidates
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const allowlistPath = path.join(frontendRoot, 'strict-null-checks.json');

const shouldSuggest = process.argv.includes('--suggest');

// Load inputs BEFORE anything consumes them. (These originally lived at the
// bottom of the file — a temporal-dead-zone bug: every branch above references
// `allowlist`/`byFile`/`totalErrors`, so the script crashed on startup.)
const allowlist = loadAllowlist();
const byFile = collectErrorsByFile(runStrictTsc());
const totalErrors = [...byFile.values()].reduce((a, b) => a + b, 0);

function loadAllowlist() {
  if (!existsSync(allowlistPath)) {
    // No allowlist file = nothing ratcheted yet; the check is vacuously
    // green but tsc still has to run once so a broken tsconfig.strict.json
    // is surfaced immediately rather than discovered when someone ratchets.
    return { files: [], note: '' };
  }
  return JSON.parse(readFileSync(allowlistPath, 'utf8'));
}

function runStrictTsc() {
  try {
    // tsc exits 2 whenever it reports ANY error — expected here, since the
    // un-ratcheted majority of the codebase still has strictNullChecks off.
    // The diagnostics are on stdout either way.
    return execFileSync(
      'npx',
      ['tsc', '-p', 'tsconfig.strict.json', '--noEmit', '--pretty', 'false'],
      { cwd: frontendRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, shell: true },
    );
  } catch (err) {
    if (typeof err.stdout === 'string') return err.stdout;
    console.error('Failed to run tsc:', err.message);
    process.exit(2);
  }
}

/** Parse `file(line,col): error TSxxxx: message` lines into a file→count map. */
function collectErrorsByFile(tscOutput) {
  const byFile = new Map();
  for (const line of tscOutput.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+):/);
    if (!m) continue;
    // tsc prints paths with forward slashes relative to the project dir.
    const file = m[1].replace(/\\/g, '/');
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  return byFile;
}

if (shouldSuggest) {
  console.log(`strictNullChecks: ${totalErrors} error(s) across ${byFile.size} file(s), whole project.`);
  // tsc only lists files WITH errors, so clean candidates = every tracked
  // src file that doesn't appear in the error map and isn't allowlisted.
  const allow = new Set(allowlist.files.map((f) => f.replace(/\\/g, '/')));
  const { execSync } = await import('node:child_process');
  let allFiles = [];
  try {
    const out = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', {
      cwd: frontendRoot,
      encoding: 'utf8',
      shell: true,
    });
    allFiles = out.split(/\r?\n/).filter(Boolean);
  } catch {
    console.error('Could not enumerate src files via git; run from a checkout.');
    process.exit(2);
  }
  const suggestions = allFiles
    .filter((f) => !byFile.has(f) && !allow.has(f))
    .sort();
  console.log(`\nZero-error files not yet allowlisted (${suggestions.length} candidate(s)):\n`);
  for (const f of suggestions) console.log(`  ${f}`);
  console.log(
    '\nVerify with a focused read before allowlisting — "zero errors today" can',
    'still mean "null-unsafe by luck".',
  );
  process.exit(0);
}

let failed = false;

// 1. Every allowlisted file must exist and be error-free.
for (const file of allowlist.files) {
  const normalized = file.replace(/\\/g, '/');
  const abs = path.join(frontendRoot, normalized);
  if (!existsSync(abs)) {
    console.error(`Allowlisted file no longer exists: ${normalized}. Remove it from strict-null-checks.json (or restore the file).`);
    failed = true;
    continue;
  }
  const count = byFile.get(normalized);
  if (count) {
    console.error(`STRICT RATCHET FAILED: ${normalized} (allowlisted as strictNullChecks-clean) now reports ${count} error(s).`);
    console.error(`  Reproduce: npx tsc -p tsconfig.strict.json --noEmit --pretty false | findstr "${normalized}"`);
    failed = true;
  }
}

// 2. Sanity: tsc must actually have type-checked something. (A
//    tsconfig.strict.json typo that includes nothing would otherwise make
//    this check pass forever while checking nothing.)
if (totalErrors === 0 && allowlist.files.length > 0) {
  console.error(
    'Suspicious: strict tsc reported zero errors project-wide. If strictNullChecks ' +
    'was enabled globally (tsconfig.app.json), REMOVE this ratchet — it is obsolete; ' +
    'otherwise verify tsconfig.strict.json still extends tsconfig.app.json.',
  );
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `Strict ratchet OK: ${allowlist.files.length} file(s) held to strictNullChecks; ` +
  `${totalErrors} error(s) exist in un-ratcheted files (ignored by design).`,
);
console.log('To grow the ratchet: node scripts/check-strict-null-checks.mjs --suggest');
