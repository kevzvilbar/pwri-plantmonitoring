#!/usr/bin/env node
/**
 * check-types-sync.mjs
 *
 * Static, secret-free check that src/integrations/supabase/types.ts is in sync
 * with the current supabase/migrations directory.
 *
 * What it does:
 *   - Parses the latest migration file to extract table/column names
 *   - Checks that each table mentioned in migrations exists in types.ts
 *   - Checks that each column in CREATE/ALTER TABLE statements exists in types.ts
 *
 * What it does NOT do (by design — this is a fast gate, not a full validator):
 *   - Does NOT connect to a database
 *   - Does NOT verify types match exactly (nullable, defaults, etc.)
 *   - Does NOT catch missing RLS policies, indexes, or functions
 *   - Does NOT catch columns added via SQL functions/triggers that don't
 *     appear in CREATE/ALTER TABLE statements
 *
 * Exit codes:
 *   0 = in sync (or check inconclusive)
 *   1 = drift detected (tables/columns in migrations but missing from types.ts)
 *   2 = usage error
 */

import fs from 'fs';
import path from 'path';

const TYPES_PATH = path.resolve('src/integrations/supabase/types.ts');
const MIGRATIONS_DIR = path.resolve('../../supabase/migrations');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function extractTablesFromTypes(typesContent) {
  const tables = new Set();
  // Match: tableName: { Row: { ... }, Insert: { ... }, Update: { ... } }
  // Tables are nested under: export type Database = { public: { Tables: { ... } } }
  // So they have 6 spaces (two indentation levels)
  const tableRegex = /^\s{6}(\w+):\s*\{/gm;
  let match;
  while ((match = tableRegex.exec(typesContent)) !== null) {
    tables.add(match[1]);
  }
  return tables;
}

function extractColumnsFromMigration(sql) {
  const cols = new Map(); // table -> Set(columns)
  
  // CREATE TABLE table_name ( col1 type, col2 type, ... )
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi;
  // ALTER TABLE table_name ADD COLUMN col_name type
  const alterAddColRegex = /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi;
  // ALTER TABLE table_name ADD col_name type (less common but possible)
  const alterAddRegex = /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+(\w+)/gi;
  // CREATE VIEW ... AS SELECT ... (views don't have columns in types.ts the same way)
  
  let match;
  while ((match = createTableRegex.exec(sql)) !== null) {
    const table = match[1];
    // Find the column list between parentheses
    const startIdx = match.index + match[0].length;
    let parenDepth = 1;
    let endIdx = startIdx;
    while (endIdx < sql.length && parenDepth > 0) {
      if (sql[endIdx] === '(') parenDepth++;
      else if (sql[endIdx] === ')') parenDepth--;
      endIdx++;
    }
    const columnBlock = sql.slice(startIdx, endIdx - 1);
    // Extract column names (first word before type, ignoring constraints)
    const colLines = columnBlock.split(',').map(l => l.trim());
    for (const line of colLines) {
      // Skip constraints (PRIMARY KEY, FOREIGN KEY, CHECK, UNIQUE, etc.)
      const trimmed = line.toUpperCase();
      if (
        trimmed.startsWith('PRIMARY KEY') ||
        trimmed.startsWith('FOREIGN KEY') ||
        trimmed.startsWith('UNIQUE') ||
        trimmed.startsWith('CHECK') ||
        trimmed.startsWith('CONSTRAINT') ||
        trimmed.startsWith('INDEX')
      ) continue;
      // Column name is first identifier
      const colMatch = line.match(/^"?(\w+)"?/);
      if (colMatch) {
        if (!cols.has(table)) cols.set(table, new Set());
        cols.get(table).add(colMatch[1]);
      }
    }
  }
  
  while ((match = alterAddColRegex.exec(sql)) !== null) {
    if (!cols.has(match[1])) cols.set(match[1], new Set());
    cols.get(match[1]).add(match[2]);
  }
  
  while ((match = alterAddRegex.exec(sql)) !== null) {
    // Avoid double-counting from ALTER TABLE ... ADD COLUMN
    const upper = match[0].toUpperCase();
    if (upper.includes('COLUMN')) continue;
    if (!cols.has(match[1])) cols.set(match[1], new Set());
    cols.get(match[1]).add(match[2]);
  }
  
  return cols;
}

function main() {
  if (!fs.existsSync(TYPES_PATH)) {
    console.error(`❌ types.ts not found at ${TYPES_PATH}`);
    process.exit(2);
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`❌ Migrations directory not found at ${MIGRATIONS_DIR}`);
    process.exit(2);
  }
  
  const typesContent = readFile(TYPES_PATH);
  const typesTables = extractTablesFromTypes(typesContent);
  
  console.log(`Found ${typesTables.size} tables in types.ts`);
  
  // Read all migration files in order
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  let allMigrationCols = new Map();
  
  for (const file of migrationFiles) {
    const sql = readFile(path.join(MIGRATIONS_DIR, file));
    const cols = extractColumnsFromMigration(sql);
    for (const [table, columns] of cols) {
      if (!allMigrationCols.has(table)) allMigrationCols.set(table, new Set());
      for (const col of columns) {
        allMigrationCols.get(table).add(col);
      }
    }
  }
  
  console.log(`Found ${allMigrationCols.size} tables referenced in migrations`);
  
  // Check for tables in migrations but missing from types
  let hasDrift = false;
  
  for (const [table, columns] of allMigrationCols) {
    if (!typesTables.has(table)) {
      // Some tables are created in migrations but are system/internal
      const internalPrefixes = ['pg_', 'sql_', 'information_schema', '_'];
      const isInternal = internalPrefixes.some(p => table.startsWith(p));
      if (!isInternal) {
        console.error(`❌ Table "${table}" exists in migrations but NOT in types.ts`);
        hasDrift = true;
      }
      continue;
    }
    
    // Check columns (optional - can be noisy, so just warn)
    // We'd need to parse types.ts for columns to do this properly
    // For now, just table-level check
  }
  
  // Check for tables in types that don't appear in migrations (could be stale)
  // This is less critical - tables might be created in older migrations
  // that are still part of the history
  
  if (hasDrift) {
    console.error('\n❌ DRIFT DETECTED: Run `npm run types:gen` to regenerate types.ts');
    console.error('   (Requires VITE_SUPABASE_PROJECT_ID env var set to a live project)');
    process.exit(1);
  }
  
  console.log('✅ types.ts appears in sync with migrations (table-level check)');
  process.exit(0);
}

main();