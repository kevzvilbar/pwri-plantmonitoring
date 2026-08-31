#!/usr/bin/env node
/**
 * check-lint-ceiling.mjs
 *
 * Replaces the old `eslint . --max-warnings=N` gate, where N was a number
 * hand-edited in ci.yml and had drifted stale three separate times in one
 * week (see git blame on ci.yml before this script existed, or
 * pwri-improvement-plan.md Phase 0.1 for the history) because nothing
 * forced it to track the real count.
 *
 * This script counts the ACTUAL current warning total from ESLint and
 * compares it against the committed value in lint-ceiling.json. Unlike a
 * `--max-warnings` flag, it fails on ANY mismatch — not just an increase —
 * so the ceiling can never go stale silently in either direction. Whoever's
 * change moved the number has to look at it and commit the new value
 * on purpose, with a reason, in the same PR.
 *
 * Usage:
 *   node scripts/check-lint-ceiling.mjs            # check only (CI mode)
 *   node scripts/check-lint-ceiling.mjs --update    # rewrite the ceiling
 *                                                    # file to match reality
 *
 * After --update, the diff to lint-ceiling.json IS the review artifact —
 * "warnings went from 1616 to 1489, here's the PR that did it" is now a
 * one-line JSON diff instead of a paragraph of prose in ci.yml.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const ceilingPath = path.join(frontendRoot, 'lint-ceiling.json');

const shouldUpdate = process.argv.includes('--update');

function runEslintJson() {
  let stdout;
  try {
    // ESLint exits 1 when it finds any warnings/errors at all (with no
    // --max-warnings flag applied here) — that's expected and NOT a
    // failure of this script, so we always read stdout regardless of
    // the child's exit code.
    stdout = execFileSync('npx', ['eslint', '.', '--format', 'json'], {
      cwd: frontendRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      shell: true,
    });
  } catch (err) {
    // execFileSync throws when the child exits non-zero, but ESLint's JSON
    // is still on stdout — recover it from the error object.
    if (err.stdout) {
      stdout = err.stdout.toString();
    } else {
      console.error('Failed to run ESLint:', err.message);
      process.exit(2);
    }
  }
  return JSON.parse(stdout);
}

function summarize(results) {
  let warnings = 0;
  let errors = 0;
  const byRule = {};
  for (const file of results) {
    warnings += file.warningCount;
    errors += file.errorCount;
    for (const msg of file.messages) {
      if (msg.severity === 1) {
        const rule = msg.ruleId ?? '(no rule id)';
        byRule[rule] = (byRule[rule] ?? 0) + 1;
      }
    }
  }
  return { warnings, errors, byRule };
}

function loadCeiling() {
  if (!existsSync(ceilingPath)) {
    return { maxWarnings: null, lastUpdated: null, history: [] };
  }
  return JSON.parse(readFileSync(ceilingPath, 'utf8'));
}

function saveCeiling(ceiling) {
  writeFileSync(ceilingPath, JSON.stringify(ceiling, null, 2) + '\n');
}

const results = runEslintJson();
const { warnings, errors, byRule } = summarize(results);
const ceiling = loadCeiling();

console.log(`ESLint: ${warnings} warnings, ${errors} errors.`);
console.log('By rule:', JSON.stringify(byRule, null, 2));

if (errors > 0) {
  console.error(`\n${errors} ESLint error(s) found. Fix these regardless of the warning ceiling.`);
  process.exit(1);
}

if (shouldUpdate) {
  const today = new Date().toISOString().slice(0, 10);
  const previous = ceiling.maxWarnings;
  const nextHistory = [
    ...(ceiling.history ?? []),
    { date: today, maxWarnings: warnings, previous: previous ?? null },
  ];
  saveCeiling({ maxWarnings: warnings, lastUpdated: today, history: nextHistory });
  console.log(
    previous === null
      ? `\nInitialized lint-ceiling.json at ${warnings}.`
      : `\nUpdated lint-ceiling.json: ${previous} -> ${warnings}. Commit this file with a reason in the commit message.`,
  );
  process.exit(0);
}

if (ceiling.maxWarnings === null) {
  console.error(
    '\nNo lint-ceiling.json found. Run `node scripts/check-lint-ceiling.mjs --update` once to create it, then commit the file.',
  );
  process.exit(1);
}

if (warnings === ceiling.maxWarnings) {
  console.log(`\nMatches committed ceiling (${ceiling.maxWarnings}). OK.`);
  process.exit(0);
}

if (warnings > ceiling.maxWarnings) {
  console.error(
    `\nWarning count increased: committed ceiling is ${ceiling.maxWarnings}, actual is ${warnings} ` +
    `(+${warnings - ceiling.maxWarnings}).\n` +
    `Fix the new warnings, or if the increase is intentional, run ` +
    `\`node scripts/check-lint-ceiling.mjs --update\` locally and commit the updated ` +
    `lint-ceiling.json with a reason in the commit message.`,
  );
  process.exit(1);
}

// warnings < ceiling.maxWarnings
console.error(
  `\nWarning count decreased: committed ceiling is ${ceiling.maxWarnings}, actual is ${warnings} ` +
  `(-${ceiling.maxWarnings - warnings}). Nice — but the ceiling file needs to catch up so this ` +
  `improvement doesn't silently erode later.\n` +
  `Run \`node scripts/check-lint-ceiling.mjs --update\` locally and commit the updated ` +
  `lint-ceiling.json.`,
);
process.exit(1);
