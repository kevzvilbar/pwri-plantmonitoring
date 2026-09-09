#!/usr/bin/env node
/**
 * squash-baseline.mjs
 * 
 * Generates the baseline migration (20260908000000_baseline_schema.sql)
 * by concatenating all archived migrations + any reconciliation migration.
 * 
 * Usage:
 *   node scripts/squash-baseline.mjs              # Normal run
 *   node scripts/squash-baseline.mjs --dry-run    # Preview without writing
 *   node scripts/squash-baseline.mjs --verify     # Test the generated baseline locally
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const PROJECT_ROOT = path.resolve('..');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'supabase', 'migrations_archive');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'supabase', 'migrations');
const BASELINE_PATH = path.join(MIGRATIONS_DIR, '20260908000000_baseline_schema.sql');
const RECONCILIATION_PATTERN = /^20260909\d{6}_reconcile/;

function getMigrationFiles() {
  // Get all archived migrations in chronological order
  const archived = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  // Get any reconciliation migration in the active migrations folder
  const reconciliation = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => RECONCILIATION_PATTERN.test(f))
    .sort();
  
  return { archived, reconciliation };
}

function readMigration(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function generateBaseline({ archived, reconciliation, dryRun }) {
  console.log(`\n=== Baseline Generation ===`);
  console.log(`Archived migrations: ${archived.length}`);
  console.log(`Reconciliation migrations: ${reconciliation.length}`);
  
  if (reconciliation.length === 0) {
    console.warn('\n⚠️  No reconciliation migration found!');
    console.warn('   Run `supabase db pull` after linking to production first.');
    console.warn('   Expected pattern: 20260909XXXXXX_reconcile_prod_drift.sql\n');
  }
  
  let combined = `-- =============================================================================
-- Migration: 20260908000000_baseline_schema.sql
-- Baseline schema squash - represents complete database state as of 2026-09-08
-- Generated from ${archived.length} archived migrations + ${reconciliation.length} reconciliation migration(s)
-- =============================================================================
-- 
-- This migration consolidates all historical migrations into a single baseline.
-- Subsequent migrations (20260909000001+) should be applied on top of this baseline.
-- 
-- To verify: apply this migration to a fresh database, then apply all migrations
-- with timestamp > 20260908000000. The result should match production.
-- =============================================================================

`;

  // Add all archived migrations
  for (const file of archived) {
    const content = readMigration(path.join(ARCHIVE_DIR, file));
    combined += `-- >>>>>>> BEGIN ARCHIVED: ${file} >>>>>>>\n`;
    combined += content.trimEnd() + '\n\n';
    combined += `-- <<<<<<< END ARCHIVED: ${file} <<<<<<<\n\n`;
  }
  
  // Add reconciliation migration(s)
  for (const file of reconciliation) {
    const content = readMigration(path.join(MIGRATIONS_DIR, file));
    combined += `-- >>>>>>> BEGIN RECONCILIATION: ${file} >>>>>>>\n`;
    combined += content.trimEnd() + '\n\n';
    combined += `-- <<<<<<< END RECONCILIATION: ${file} <<<<<<<\n\n`;
  }
  
  combined += `-- =============================================================================
-- END OF BASELINE
-- =============================================================================
`;
  
  if (dryRun) {
    console.log('\n=== DRY RUN - Baseline Preview (first 200 lines) ===\n');
    console.log(combined.split('\n').slice(0, 200).join('\n'));
    console.log('\n... (truncated)');
    console.log(`\nTotal size: ${combined.length} bytes, ${combined.split('\n').length} lines`);
    return;
  }
  
  // Write the baseline
  fs.writeFileSync(BASELINE_PATH, combined);
  console.log(`\n✅ Baseline written to: ${BASELINE_PATH}`);
  console.log(`   Size: ${combined.length} bytes, ${combined.split('\n').length} lines`);
  
  // Also copy reconciliation migration(s) to migrations folder if they're not already there
  for (const file of reconciliation) {
    const src = path.join(MIGRATIONS_DIR, file);
    const dest = path.join(MIGRATIONS_DIR, file); // Already in place
    console.log(`   Reconciliation migration already in place: ${file}`);
  }
}

async function verifyBaseline() {
  console.log('\n=== Verifying Baseline Locally ===\n');
  
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('❌ Baseline file not found. Run without --verify first.');
    process.exit(1);
  }
  
  // Reset local Supabase with the new baseline
  console.log('Resetting local Supabase...');
  try {
    execFileSync('supabase', ['stop'], { stdio: 'inherit', cwd: PROJECT_ROOT });
    execFileSync('supabase', ['start'], { stdio: 'inherit', cwd: PROJECT_ROOT, timeout: 180000 });
    console.log('✅ Local Supabase started with baseline');
  } catch (e) {
    console.error('❌ Failed to start Supabase:', e.message);
    process.exit(1);
  }
  
  // Run pgTAP tests
  console.log('\nRunning pgTAP RLS tests...');
  try {
    execFileSync('supabase', ['test', 'db'], { stdio: 'inherit', cwd: PROJECT_ROOT, timeout: 120000 });
    console.log('✅ pgTAP tests passed');
  } catch (e) {
    console.error('❌ pgTAP tests failed:', e.message);
    process.exit(1);
  }
  
  console.log('\n✅ Baseline verification complete - schema is functionally complete');
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verify = args.includes('--verify');
  
  try {
    if (verify) {
      verifyBaseline();
      return;
    }
    
    const { archived, reconciliation } = getMigrationFiles();
    generateBaseline({ archived, reconciliation, dryRun });
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();