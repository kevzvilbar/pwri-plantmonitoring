// Throwaway validation harness (Phase-3 residual-gate checker).
// Runs tsc + vite build + vitest + eslint + check-bundle-size sequentially,
// capturing each as UTF-8 (PS redirection here emits UTF-16 that garbles logs).
// Writes a single clean UTF-8 summary the reviewer can read.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve('frontend');
const summary = [];

function run(label, cmd, args, opts = {}) {
  let out = '', code = 0, ok = true;
  try {
    out = execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
  } catch (e) {
    ok = false; code = e.status ?? 1;
    out = (e.stdout ? e.stdout.toString('utf8') : '') + (e.stderr ? e.stderr.toString('utf8') : '');
  }
  return { label, ok, code, out: out.toString('utf8') };
}

// 1) typecheck gate (CI gate, ci.yml:52)
const tsc = run('tsc', 'npx.cmd', ['tsc', '--noEmit', '-p', 'tsconfig.app.json']);
summary.push(`## ${tsc.label}: exit=${tsc.ok ? 0 : tsc.code}`);
const tscErrs = tsc.out.match(/^\S.*\.ts\(\d+,\d+\): error TS/gm) || [];
summary.push(tscErrs.length ? `TSC_ERRORS=${tscErrs.length}` : 'TSC_ERRORS=0');

// 2) production build
const build = run('vite build', 'npx.cmd', ['vite', 'build']);
summary.push(`## ${build.label}: exit=${build.ok ? 0 : build.code}`);
const built = (build.out.match(/built in [\d.]+s/) || ['built in (n/a)'])[0];
summary.push(`BUILD_LINE=${built}`);
summary.push(`ADMIN_1030_CHUNK_PRESENT=${/Admin-[A-Za-z0-9]+\.js\s+10[0-9][0-9][0-9]\s/.test(build.out) ? 'YES' : 'NO'}`);
summary.push(`CHUNKS_LARGER_800_WARN=${build.out.includes('larger than 800') ? 'YES' : 'NO'}`);
// list largest emitted JS/CSS assets from dist/assets (gzip), like check-bundle-size
if (build.ok) {
  const distAssets = path.join(root, 'dist', 'assets');
  const files = readdirSync(distAssets)
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => ({ name: f, gzipKb: gzipSync(readFileSync(path.join(distAssets, f))).length / 1024 }))
    .sort((a, b) => b.gzipKb - a.gzipKb);
  const total = files.reduce((s, f) => s + f.gzipKb, 0);
  summary.push(`DIST_TOTAL_GZ_KB=${total.toFixed(1)} (${files.length} assets)`);
  summary.push('TOP 8 ASSETS (gzip kB):');
  for (const f of files.slice(0, 8)) summary.push(`  ${f.gzipKb.toFixed(1).padStart(7)}  ${f.name}`);
}

// 3) unit tests
const tests = run('vitest', 'npx.cmd', ['vitest', 'run']);
summary.push(`## ${tests.label}: exit=${tests.ok ? 0 : tests.code}`);
const passLine = (tests.out.match(/Tests\s+\d+ passed/) || tests.out.match(/Test Files\s+\d+ passed/) || [''])[0];
summary.push(`TESTS_PASS=${passLine}`);

// 4) lint ceiling (changed files)
const lint = run('eslint', 'npx.cmd', ['eslint', '--max-warnings', 'Infinity', 'src/pages/Admin.tsx', 'src/data/data.test.ts', 'src/pages/admin']);
summary.push(`## ${lint.label}: exit=${lint.ok ? 0 : lint.code}`);
const warns = (lint.out.match(/\d+ warning/));
summary.push(`LINT_WARNINGS=${warns ? warns[0] : 'n/a'}`);

// 5) bundle-size gate
const bsc = run('check-bundle-size', 'node', ['scripts/check-bundle-size.mjs']);
summary.push(`## ${bsc.label}: exit=${bsc.ok ? 0 : bsc.code}`);
summary.push(`BSC_OUT=${bsc.out.replace(/\n+/g, ' | ')}`);

writeFileSync(path.join(root, 'validate_summary.txt'), summary.join('\n'), 'utf8');
console.log(summary.join('\n'));
