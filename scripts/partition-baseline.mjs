#!/usr/bin/env node
/**
 * partition-baseline.mjs
 *
 * Partitions the monolithic 958 KB baseline migration into 5 modular,
 * reviewable migration files preserving exact execution order and dependencies.
 *
 * Usage:
 *   node scripts/partition-baseline.mjs          # Generate partitions
 *   node scripts/partition-baseline.mjs --verify # Verify exact byte content matches archive
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const ARCHIVE_DIR = path.join(REPO_ROOT, 'supabase', 'migrations_archive');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

const PARTITIONS = [
  {
    filename: '20260908000001_001_core_schema.sql',
    title: 'Baseline 001: Core Schema & Roles (April 2026)',
    startIdx: 1,
    endIdx: 18,
  },
  {
    filename: '20260908000002_002_meters_and_audits.sql',
    title: 'Baseline 002: Normalization, Meters & Audits (May–July 2026)',
    startIdx: 19,
    endIdx: 36,
  },
  {
    filename: '20260908000003_003_hamas_meter_wiring.sql',
    title: 'Baseline 003: HAMAS Meter Wiring & Input Modes (July–Aug 2026)',
    startIdx: 37,
    endIdx: 60,
  },
  {
    filename: '20260908000004_004_custom_roles_and_readings.sql',
    title: 'Baseline 004: Custom Roles, Reading Views & Deduping (Aug 2026)',
    startIdx: 61,
    endIdx: 96,
  },
  {
    filename: '20260908000005_005_backfill_and_hardening.sql',
    title: 'Baseline 005: Reading Backfill, Monotonicity & Security Hardening (Aug–Sept 2026)',
    startIdx: 97,
    endIdx: 121,
  },
];

function getAllArchivedFiles() {
  return fs.readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function buildPartitionSql(partition, archiveFiles) {
  const files = archiveFiles.slice(partition.startIdx - 1, partition.endIdx);
  let sql = `-- =============================================================================\n`;
  sql += `-- Migration: ${partition.filename}\n`;
  sql += `-- ${partition.title}\n`;
  sql += `-- Partition of baseline schema covering archived migrations #${partition.startIdx} to #${partition.endIdx}\n`;
  sql += `-- =============================================================================\n\n`;

  for (const file of files) {
    const filePath = path.join(ARCHIVE_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    sql += `-- >>>>>>> BEGIN ARCHIVED: ${file} >>>>>>>\n`;
    sql += content.trimEnd() + '\n\n';
    sql += `-- <<<<<<< END ARCHIVED: ${file} <<<<<<<\n\n`;
  }

  return sql;
}

function run() {
  const isVerify = process.argv.includes('--verify');
  const archiveFiles = getAllArchivedFiles();

  if (archiveFiles.length !== 121) {
    console.error(`Expected 121 archived files, found ${archiveFiles.length}`);
    process.exit(1);
  }

  console.log(`Found ${archiveFiles.length} archived migrations.`);

  for (const p of PARTITIONS) {
    const targetPath = path.join(MIGRATIONS_DIR, p.filename);
    const sql = buildPartitionSql(p, archiveFiles);

    if (isVerify) {
      if (!fs.existsSync(targetPath)) {
        console.error(`Missing partition file: ${targetPath}`);
        process.exit(1);
      }
      const existing = fs.readFileSync(targetPath, 'utf8');
      if (existing !== sql) {
        console.error(`Mismatch detected in ${p.filename}`);
        process.exit(1);
      }
      console.log(`✓ Verified ${p.filename} (${sql.split('\n').length} lines, ${sql.length} bytes)`);
    } else {
      fs.writeFileSync(targetPath, sql, 'utf8');
      console.log(`✓ Written ${p.filename} (${sql.split('\n').length} lines, ${sql.length} bytes)`);
    }
  }

  console.log(isVerify ? '\nAll partitions verified successfully.' : '\nAll partitions written successfully.');
}

run();
