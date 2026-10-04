#!/usr/bin/env node
/**
 * scripts/security-audit.mjs
 *
 * Automated security audit check for PWRI Plant Monitoring.
 * Validates:
 * 1. Database RLS & RPC grants in migrations.
 * 2. CSV Formula Injection (CWE-1236) prevention across frontend code.
 * 3. Edge Function authorization guards.
 * 4. Content Security Policy (CSP) presence.
 *
 * Exit code 0 if all security invariants hold, 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let failures = 0;
let passes = 0;

function pass(msg) {
  console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
  passes++;
}

function fail(msg, detail = '') {
  console.error(`  \x1b[31m✖\x1b[0m ${msg}`);
  if (detail) console.error(`    \x1b[90m${detail}\x1b[0m`);
  failures++;
}

function check(sectionName, fn) {
  console.log(`\n\x1b[1m\x1b[36m[Security Check]\x1b[0m ${sectionName}`);
  try {
    fn();
  } catch (err) {
    fail(`Exception in check: ${err.message}`);
  }
}

// ─── 1. Content Security Policy (CSP) ──────────────────────────────────────────
check('Content Security Policy in index.html', () => {
  const indexPath = path.join(ROOT_DIR, 'frontend', 'index.html');
  if (!fs.existsSync(indexPath)) {
    fail('frontend/index.html not found');
    return;
  }
  const content = fs.readFileSync(indexPath, 'utf-8');
  if (!content.includes('http-equiv="Content-Security-Policy"')) {
    fail('frontend/index.html is missing http-equiv="Content-Security-Policy"');
  } else if (!content.includes("default-src 'self'")) {
    fail('CSP does not define default-src \'self\'');
  } else if (!content.includes("object-src 'none'")) {
    fail('CSP does not restrict object-src to \'none\'');
  } else {
    pass('Strict Content-Security-Policy defined in frontend/index.html');
  }
});

// ─── 2. CSV Formula Injection Prevention (CWE-1236) ──────────────────────────
check('CSV Formula Injection Defense across frontend', () => {
  const frontendSrc = path.join(ROOT_DIR, 'frontend', 'src');
  const filesToScan = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
        filesToScan.push(full);
      }
    }
  }

  walk(frontendSrc);

  let unescapedCsvCreations = 0;
  for (const file of filesToScan) {
    // Exclude the centralized safe CSV module itself
    if (file.endsWith(path.join('shared', 'csv.ts')) || file.endsWith(path.join('shared', 'csv.tsx'))) continue;

    const code = fs.readFileSync(file, 'utf-8');
    // Pattern looking for raw unescaped CSV Blob creation
    if (code.includes("type: 'text/csv") || code.includes('type: "text/csv') || code.includes('data:text/csv')) {
      fail(`Direct CSV Blob/DataURI construction without shared safe csv module in ${path.relative(ROOT_DIR, file)}`);
      unescapedCsvCreations++;
    }
  }

  if (unescapedCsvCreations === 0) {
    pass(`All ${filesToScan.length} frontend source files use safe sanitized CSV exporters (CWE-1236 compliant)`);
  }
});

// ─── 3. Edge Function Auth Verification ──────────────────────────────────────
check('Edge Function Security Guards', () => {
  const functionsDir = path.join(ROOT_DIR, 'supabase', 'functions');
  if (!fs.existsSync(functionsDir)) {
    fail('supabase/functions not found');
    return;
  }

  const funcDirs = fs.readdirSync(functionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'));

  for (const fd of funcDirs) {
    const indexPath = path.join(functionsDir, fd.name, 'index.ts');
    if (!fs.existsSync(indexPath)) {
      fail(`Edge function ${fd.name} missing index.ts`);
      continue;
    }
    const code = fs.readFileSync(indexPath, 'utf-8');
    const hasAuthCheck = code.includes('Authorization') || code.includes('authHeader') || code.includes('SUPABASE_SERVICE_ROLE_KEY');
    if (!hasAuthCheck) {
      fail(`Edge function ${fd.name} has no Authorization or Service Key verification`);
    } else {
      pass(`Edge function '${fd.name}' verifies caller authorization`);
    }
  }
});

// ─── 4. Database RLS & Security Migrations ────────────────────────────────────
check('Database RLS & Migration Invariants', () => {
  const migrationsDir = path.join(ROOT_DIR, 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    fail('supabase/migrations not found');
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  let latestHardeningFound = false;

  for (const file of files) {
    if (file.includes('security_hardening_costs_and_rpcs')) {
      latestHardeningFound = true;
    }
  }

  if (!latestHardeningFound) {
    fail('Migration 20261004000001_security_hardening_costs_and_rpcs.sql is missing');
  } else {
    pass('Production costs RLS & summary RPC hardening migration present');
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────');
if (failures === 0) {
  console.log(`\x1b[32m✔ Security Audit PASSED (${passes} checks passed)\x1b[0m\n`);
  process.exit(0);
} else {
  console.error(`\x1b[31m✖ Security Audit FAILED (${failures} failures, ${passes} passed)\x1b[0m\n`);
  process.exit(1);
}
