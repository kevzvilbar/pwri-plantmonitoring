#!/usr/bin/env node
/**
 * check-bundle-size.mjs
 *
 * Roadmap Phase 2 ("track bundle size over time"). Runs after `vite build`
 * and compares the actual gzipped size of the emitted JS/CSS in dist/asset
 * output against a committed baseline (bundle-size.json) — same pattern as
 * the lint ceiling: ANY change to the number, up or down, must land as a
 * reviewed one-line JSON diff instead of slipping through silently. A slow
 * creep from dependency additions was exactly how the app got heavy the
 * first time; nobody was looking at a number, because there wasn't one.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs            # check (CI mode, after build)
 *   node scripts/check-bundle-size.mjs --update   # re-baseline deliberately
 *
 * The metric is the gzipped transfer size of every .js and .css file in
 * dist/assets — what a cold visitor actually downloads for the shell
 * (workbox precaches these same files per vite-plugin-pwa's globPatterns).
 * Images/fonts are excluded: they change wholesale with asset swaps and
 * aren't affected by code-level regressions.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const distAssets = path.join(frontendRoot, 'dist', 'assets');
const baselinePath = path.join(frontendRoot, 'bundle-size.json');

const shouldUpdate = process.argv.includes('--update');

function gzipSizeKb(file) {
  return gzipSync(readFileSync(file)).length / 1024;
}

function measureAssets() {
  if (!existsSync(distAssets)) {
    console.error(
      'No dist/assets found. Run `npm run build` first — this check measures build output, it does not build.',
    );
    process.exit(2);
  }
  const files = readdirSync(distAssets)
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => {
      const full = path.join(distAssets, f);
      return {
        name: f,
        gzipKb: gzipSizeKb(full),
        rawKb: statSync(full).size / 1024,
      };
    })
    .sort((a, b) => b.gzipKb - a.gzipKb);
  return files;
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return null;
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

const files = measureAssets();
const totalGzipKb = files.reduce((a, f) => a + f.gzipKb, 0);

console.log(`Bundle: ${totalGzipKb.toFixed(1)} kB gzipped across ${files.length} JS/CSS asset(s).`);
for (const f of files.slice(0, 8)) {
  console.log(`  ${f.gzipKb.toFixed(1).padStart(7)} kB (raw ${f.rawKb.toFixed(0)})  ${f.name}`);
}
if (files.length > 8) console.log(`  … ${files.length - 8} more`);

const baseline = loadBaseline();

if (shouldUpdate) {
  const today = new Date().toISOString().slice(0, 10);
  const previous = baseline?.maxTotalGzipKb ?? null;
  const history = [
    ...(baseline?.history ?? []),
    { date: today, maxTotalGzipKb: Math.round(totalGzipKb * 10) / 10, previous },
  ];
  writeFileSync(
    baselinePath,
    JSON.stringify({ maxTotalGzipKb: Math.round(totalGzipKb * 10) / 10, lastUpdated: today, history }, null, 2) + '\n',
  );
  console.log(
    previous === null
      ? `\nInitialized bundle-size.json at ${totalGzipKb.toFixed(1)} kB.`
      : `\nRe-baselined bundle-size.json: ${previous} -> ${totalGzipKb.toFixed(1)} kB. Commit it with a reason.`,
  );
  process.exit(0);
}

if (!baseline) {
  console.error(
    '\nNo bundle-size.json found. Run `node scripts/check-bundle-size.mjs --update` once after a build, then commit the file.',
  );
  process.exit(1);
}

const toleranceKb = 2; // gzip noise across platforms/versions
if (totalGzipKb > baseline.maxTotalGzipKb + toleranceKb) {
  console.error(
    `\nBundle grew: baseline is ${baseline.maxTotalGzipKb} kB gzipped, actual is ${totalGzipKb.toFixed(1)} kB ` +
      `(+${(totalGzipKb - baseline.maxTotalGzipKb).toFixed(1)} kB).\n` +
      'If the growth is intended (a real feature, not an accidental dependency import), re-baseline with\n' +
      '`node scripts/check-bundle-size.mjs --update` and commit bundle-size.json with a reason.',
  );
  process.exit(1);
}

if (totalGzipKb < baseline.maxTotalGzipKb - toleranceKb) {
  console.error(
    `\nBundle shrank: baseline is ${baseline.maxTotalGzipKb} kB, actual is ${totalGzipKb.toFixed(1)} kB. ` +
      'Nice — re-baseline (`node scripts/check-bundle-size.mjs --update`) and commit so the gain is locked in.',
  );
  process.exit(1);
}

console.log(`\nMatches committed baseline (${baseline.maxTotalGzipKb} kB ±${toleranceKb}). OK.`);
