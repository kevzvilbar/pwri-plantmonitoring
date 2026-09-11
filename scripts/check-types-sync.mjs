#!/usr/bin/env node
/**
 * CI / local check: fails if a table or column defined in supabase/migrations/*.sql
 * does not appear in frontend/src/integrations/supabase/types.ts.
 *
 * Catches:
 * 1. New tables created via `CREATE TABLE` in migrations.
 * 2. New columns added to existing tables via `ALTER TABLE ... ADD COLUMN`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const TYPES_FILE = join(REPO_ROOT, 'frontend', 'src', 'integrations', 'supabase', 'types.ts');

const createTableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
const alterTableRe = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?\s+([\s\S]*?);/gi;
const addColumnRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;

const createdTables = new Set();
const alteredColumnsByTable = new Map(); // table -> Set<col>

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

  // Tables
  for (const match of sql.matchAll(createTableRe)) {
    createdTables.add(match[1]);
  }

  // Altered columns
  for (const match of sql.matchAll(alterTableRe)) {
    const table = match[1];
    const body = match[2];
    for (const colMatch of body.matchAll(addColumnRe)) {
      const col = colMatch[1];
      if (!alteredColumnsByTable.has(table)) {
        alteredColumnsByTable.set(table, new Set());
      }
      alteredColumnsByTable.get(table).add(col);
    }
  }
}

// ── 2. Parse types.ts tables and columns ──────────────────────────────────────
const typesSrc = readFileSync(TYPES_FILE, 'utf8').replace(/\r/g, '');
const lines = typesSrc.split('\n');

const typedTables = new Set();
const typedTableColumns = new Map(); // table -> Set<col>

let currentTable = null;
let inRow = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Match table definition under Database["public"]["Tables"]
  const tableMatch = line.match(/^\s{6}(\w+):\s*\{$/);
  if (tableMatch) {
    currentTable = tableMatch[1];
    typedTables.add(currentTable);
    if (!typedTableColumns.has(currentTable)) {
      typedTableColumns.set(currentTable, new Set());
    }
    inRow = false;
  }

  // Track Row object properties
  if (line.match(/^\s{8}Row:\s*\{$/)) {
    inRow = true;
  } else if (line.match(/^\s{8}\}/) && inRow) {
    inRow = false;
  } else if (inRow && currentTable) {
    const colMatch = line.match(/^\s{10}(\w+):/);
    if (colMatch) {
      typedTableColumns.get(currentTable).add(colMatch[1]);
    }
  }
}

// ── 3. Validate tables ────────────────────────────────────────────────────────
const missingTables = [...createdTables].filter((t) => !typedTables.has(t)).sort();

// ── 4. Validate altered columns ───────────────────────────────────────────────
const missingColumns = [];
for (const [table, cols] of alteredColumnsByTable.entries()) {
  const existingCols = typedTableColumns.get(table);
  // Only validate columns if the table itself is known in types.ts
  if (existingCols) {
    for (const col of cols) {
      if (!existingCols.has(col)) {
        missingColumns.push({ table, column: col });
      }
    }
  }
}

let hasErrors = false;

if (missingTables.length > 0) {
  hasErrors = true;
  console.error('✖ types.ts is stale — tables created in supabase/migrations/ are missing:');
  for (const t of missingTables) {
    console.error(`  - table: ${t}`);
  }
}

if (missingColumns.length > 0) {
  hasErrors = true;
  console.error('✖ types.ts is stale — columns added in supabase/migrations/ are missing:');
  for (const { table, column } of missingColumns) {
    console.error(`  - ${table}.${column}`);
  }
}

if (hasErrors) {
  console.error('\nRegenerate types using:');
  console.error('  npm run types:gen:local     (against local Supabase)');
  console.error('  npm run types:gen           (against remote project)');
  console.error('or manually update frontend/src/integrations/supabase/types.ts\n');
  process.exit(1);
}

let totalColsCount = 0;
for (const cols of alteredColumnsByTable.values()) {
  totalColsCount += cols.size;
}

console.log(
  `✓ types.ts is in sync — all ${createdTables.size} tables and all ${totalColsCount} migration columns are present.`
);
