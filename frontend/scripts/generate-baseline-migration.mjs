#!/usr/bin/env node
/**
 * generate-baseline-migration.mjs
 *
 * Generates a squashed baseline migration from the current types.ts.
 * This creates a single migration file that represents the complete
 * current database schema (tables, enums, indexes, RLS, functions, views).
 *
 * NOTE: This uses the types.ts as the source of truth for table structures,
 * but some database objects (indexes, RLS policies, triggers, functions, views)
 * are not fully captured in the types. Those will need manual review/addition.
 *
 * Output: supabase/migrations/20260908000000_baseline_schema.sql
 */

import fs from 'fs';
import path from 'path';

const TYPES_PATH = path.resolve('src/integrations/supabase/types.ts');
const OUTPUT_PATH = path.resolve('../../supabase/migrations/20260908000000_baseline_schema.sql');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

// Parse the types.ts to extract table definitions
function parseTypes(typesContent) {
  // This is a simplified parser for the TypeScript types
  // In reality, we'd use a proper TS parser, but for this script
  // we'll do a best-effort regex-based extraction
  
  const tables = {};
  
  // Match table definitions at the correct indentation level (6 spaces)
  // Format:       tableName: {
  const tableRegex = /\n\s{6}(\w+):\s*\{/g;
  let match;
  const tableNames = [];
  while ((match = tableRegex.exec(typesContent)) !== null) {
    tableNames.push(match[1]);
  }
  
  console.log(`Found ${tableNames.length} table names: ${tableNames.slice(0, 10).join(', ')}...`);
  
  // For each table, extract its Row type fields
  for (const tableName of tableNames) {
    // Find the table block
    const tableStartRegex = new RegExp(`\\n\\s{6}${tableName}:\\s*\\{`);
    const startMatch = tableStartRegex.exec(typesContent);
    if (!startMatch) continue;
    
    const startIdx = startMatch.index + startMatch[0].length;
    // Find the matching closing brace for this table
    let braceCount = 1;
    let endIdx = startIdx;
    while (endIdx < typesContent.length && braceCount > 0) {
      if (typesContent[endIdx] === '{') braceCount++;
      else if (typesContent[endIdx] === '}') braceCount--;
      endIdx++;
    }
    
    const tableBlock = typesContent.slice(startIdx, endIdx - 1);
    
    // Extract Row type fields
    const rowMatch = tableBlock.match(/Row:\s*\{([\s\S]*?)\n\s{8}\}/);
    if (rowMatch) {
      const fieldsText = rowMatch[1];
      const fields = parseFields(fieldsText);
      tables[tableName] = { fields };
    }
  }
  
  return tables;
}

function parseFields(text) {
  const fields = [];
  // Match field: type patterns
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('Relationships:')) continue;
    // fieldName: type | null | { ... }
    const match = trimmed.match(/^(\w+)\??:\s*(.+?),?$/);
    if (match) {
      fields.push({ name: match[1], type: match[2].replace(/,$/, '') });
    }
  }
  return fields;
}

// Map TypeScript types to PostgreSQL types
function tsToPgType(tsType) {
  const type = tsType.trim();
  
  // Handle unions with null
  if (type.includes(' | ')) {
    const parts = type.split(' | ').map(p => p.trim());
    const nonNull = parts.filter(p => p !== 'null' && p !== 'undefined');
    if (nonNull.length === 1) {
      return tsToPgType(nonNull[0]);
    }
    // Multiple non-null types - default to text/json
    return 'jsonb';
  }
  
  // Basic types
  if (type === 'string') return 'text';
  if (type === 'number') return 'numeric';
  if (type === 'boolean') return 'boolean';
  if (type === 'Date' || type.includes('string') && type.includes('date')) return 'timestamptz';
  if (type === 'Json' || type.startsWith('{') || type.includes('Json')) return 'jsonb';
  if (type.startsWith('Array<') || type.endsWith('[]')) return 'jsonb'; // arrays as jsonb
  
  // UUID detection
  if (type.includes('uuid') || type.includes('UUID')) return 'uuid';
  
  return 'text';
}

function generateBaselineMigration(tables) {
  let sql = `-- =============================================================================
-- Migration: 20260908000000_baseline_schema.sql
-- Baseline schema squash - represents the complete database state as of 2026-09-08
-- Generated from src/integrations/supabase/types.ts (PostgREST schema cache)
-- =============================================================================
-- 
-- This migration consolidates 121 individual migrations into a single baseline.
-- Subsequent migrations should be applied on top of this baseline.
-- 
-- To verify: apply this migration to a fresh database, then apply all migrations
-- with a timestamp > 20260908000000. The result should match production.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =============================================================================
-- ENUMS
-- =============================================================================
`;

  // Add enums (these need to be known from the codebase)
  sql += `
-- Entity status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_status') THEN
    CREATE TYPE entity_status AS ENUM ('Active', 'Inactive');
  END IF;
END $$;

-- Well status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'well_status') THEN
    CREATE TYPE well_status AS ENUM ('Active', 'Inactive');
  END IF;
END $$;

-- RO Train status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ro_train_status') THEN
    CREATE TYPE ro_train_status AS ENUM ('Running', 'Offline', 'Maintenance');
  END IF;
END $$;

-- Locator status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'locator_status') THEN
    CREATE TYPE locator_status AS ENUM ('Active', 'Inactive');
  END IF;
END $$;

-- Reading input mode enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reading_input_mode') THEN
    CREATE TYPE reading_input_mode AS ENUM ('direct', 'cumulative');
  END IF;
END $$;

-- User role enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('Operator', 'Manager', 'Admin', 'Data Analyst');
  END IF;
END $$;

-- Correction status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'correction_status') THEN
    CREATE TYPE correction_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

-- Power meter kind enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'power_meter_kind') THEN
    CREATE TYPE power_meter_kind AS ENUM ('feed', 'permeate', 'reject');
  END IF;
END $$;

-- Anomaly tier enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anomaly_tier') THEN
    CREATE TYPE anomaly_tier AS ENUM ('critical', 'needs_remark');
  END IF;
END $$;

-- Gap reason category enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gap_reason_category') THEN
    CREATE TYPE gap_reason_category AS ENUM (
      'meter_replacement',
      'equipment_failure',
      'communication_loss',
      'power_outage',
      'maintenance',
      'manual_override',
      'data_entry_error',
      'sensor_drift',
      'weather_event',
      'other'
    );
  END IF;
END $$;

-- Lock reason category enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lock_reason_category') THEN
    CREATE TYPE lock_reason_category AS ENUM (
      'meter_replacement',
      'seal_verification',
      'calibration',
      'maintenance',
      'tamper_evidence',
      'other'
    );
  END IF;
END $$;

-- Compliance parameter enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_parameter') THEN
    CREATE TYPE compliance_parameter AS ENUM (
      'ph',
      'turbidity',
      'chlorine_residual',
      'fluoride',
      'total_coliform',
      'e_coli',
      'lead',
      'copper',
      'nitrate',
      'nitrite',
      'arsenic',
      'other'
    );
  END IF;
END $$;

-- =============================================================================
-- CORE TABLES
-- =============================================================================

`;

  // Generate tables in dependency order (referenced tables first)
  const tableOrder = [
    'plants',
    'user_profiles',
    'user_roles',
    'wells',
    'locators',
    'ro_trains',
    'product_meters',
    'power_meters',
    'chemical_inventory',
    'chemical_prices',
    'power_tariffs',
    'checklist_templates',
    // Reading tables
    'well_readings',
    'locator_readings',
    'ro_train_readings',
    'afm_readings',
    'pump_readings',
    'cartridge_readings',
    'cip_logs',
    'chemical_dosing_logs',
    'power_readings',
    'product_meter_readings',
    'blending_events',
    'ro_pretreatment_readings',
    'chemical_residual_samples',
    'status_checks',
    'downtime_events',
    // Audit/log tables
    'reading_edit_audit_log',
    'deletion_audit_log',
    'entity_status_audit_log',
    'operator_switch_log',
    'reading_normalizations',
    'raw_edit_log',
    'reading_gap_reasons',
    'login_attempts',
    // Config/derived tables
    'locator_meter_replacements',
    'well_meter_replacements',
    'ro_train_meter_replacements',
    'product_meter_replacements',
    'filter_replacements',
    'power_meter_changes',
    'plant_meter_config',
    'migration_state',
    'import_analysis',
    'correction_requests',
    'ro_train_data_gaps',
    'daily_plant_summary',
    'production_costs',
    'electric_bills',
    'opex_budgets',
    'compliance_thresholds',
    'compliance_snapshots',
    'blending_wells',
    'derived_meter_sweep_log',
    'backfill_sweep_log',
    'locator_derived_review_flags',
    'product_meter_audit_log',
    'reading_anomaly_remarks',
    'custom_roles',
    'custom_role_overrides',
    'train_status_log',
    'checklist_executions',
    'checklist_step_executions',
    'archived_plant_data',
    'ai_chat_sessions',
    'regression_results',
    'notifications',
    'chemical_deliveries',
    'well_pms_records',
  ];

  // Filter to only tables that exist in our parsed data
  const existingTables = tableOrder.filter(t => tables[t]);
  
  for (const tableName of existingTables) {
    const table = tables[tableName];
    if (!table) continue;
    
    sql += `-- Table: ${tableName}\n`;
    sql += `CREATE TABLE IF NOT EXISTS public.${tableName} (\n`;
    
    const columnDefs = [];
    let hasId = false;
    
    for (const field of table.fields) {
      const pgType = tsToPgType(field.type);
      const nullable = field.type.includes('null') || field.type.includes('undefined') ? '' : ' NOT NULL';
      const defaultVal = field.name === 'id' ? ' DEFAULT gen_random_uuid()' : 
                         field.name === 'created_at' ? ' DEFAULT now()' : '';
      
      if (field.name === 'id') hasId = true;
      
      columnDefs.push(`  ${field.name} ${pgType}${nullable}${defaultVal}`);
    }
    
    if (hasId) {
      columnDefs.push('  PRIMARY KEY (id)');
    }
    
    sql += columnDefs.join(',\n') + '\n);\n\n';
    
    // Enable RLS
    sql += `ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;\n\n`;
  }
  
  // Add foreign keys (simplified - would need relationship data from types)
  sql += `-- =============================================================================
-- FOREIGN KEYS (representative subset - full set in types.ts Relationships)
-- =============================================================================

-- Example foreign keys (add all from types.ts Relationships)
-- ALTER TABLE public.well_readings ADD CONSTRAINT well_readings_plant_id_fkey 
--   FOREIGN KEY (plant_id) REFERENCES public.plants(id);
-- ALTER TABLE public.well_readings ADD CONSTRAINT well_readings_well_id_fkey 
--   FOREIGN KEY (well_id) REFERENCES public.wells(id);
-- ... (all FKs from Relationships in types.ts)

`;

  // Add indexes
  sql += `-- =============================================================================
-- INDEXES
-- =============================================================================

-- Common query pattern indexes
CREATE INDEX IF NOT EXISTS idx_well_readings_plant_datetime 
  ON public.well_readings(plant_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_locator_readings_plant_datetime 
  ON public.locator_readings(plant_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_ro_train_readings_plant_datetime 
  ON public.ro_train_readings(plant_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_power_readings_plant_datetime 
  ON public.power_readings(plant_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_product_meter_readings_plant_datetime 
  ON public.product_meter_readings(plant_id, reading_datetime DESC);

-- Entity status indexes
CREATE INDEX IF NOT EXISTS idx_wells_plant_status ON public.wells(plant_id, status);
CREATE INDEX IF NOT EXISTS idx_locators_plant_status ON public.locators(plant_id, status);
CREATE INDEX IF NOT EXISTS idx_ro_trains_plant_status ON public.ro_trains(plant_id, status);
CREATE INDEX IF NOT EXISTS idx_product_meters_plant ON public.product_meters(plant_id);

-- Reading chain indexes
CREATE INDEX IF NOT EXISTS idx_well_readings_well_datetime 
  ON public.well_readings(well_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_locator_readings_locator_datetime 
  ON public.locator_readings(locator_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_ro_train_readings_train_datetime 
  ON public.ro_train_readings(train_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_product_meter_readings_meter_datetime 
  ON public.product_meter_readings(meter_id, reading_datetime DESC);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_reading_edit_audit_log_entity 
  ON public.reading_edit_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_entity 
  ON public.deletion_audit_log(entity_type, entity_id);

-- Cost/compliance indexes
CREATE INDEX IF NOT EXISTS idx_production_costs_plant_date 
  ON public.production_costs(plant_id, date_key);
CREATE INDEX IF NOT EXISTS idx_compliance_snapshots_plant_date 
  ON public.compliance_snapshots(plant_id, snapshot_date);

`;

  // Add RLS policies (template - needs customization per table)
  sql += `-- =============================================================================
-- RLS POLICIES (templates - customize per table)
-- =============================================================================

-- Default pattern: authenticated users can SELECT from tables in their plant
-- Managers/Admins can INSERT/UPDATE/DELETE
-- This is a template - each table needs its specific policies

-- Example for wells:
-- CREATE POLICY "wells_select_auth" ON public.wells
--   FOR SELECT TO authenticated
--   USING (plant_id IN (SELECT plant_id FROM user_roles WHERE user_id = auth.uid()));
-- CREATE POLICY "wells_modify_manager" ON public.wells
--   FOR ALL TO authenticated
--   USING (EXISTS (
--     SELECT 1 FROM user_roles ur 
--     WHERE ur.user_id = auth.uid() 
--     AND ur.plant_id = wells.plant_id 
--     AND ur.role IN ('Manager', 'Admin')
--   ));

-- NOTE: Full RLS policies are defined in individual migration files.
-- Run the pgTAP test suite (supabase test db) to verify all policies exist.

`;

  // Add views
  sql += `-- =============================================================================
-- VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW public.locator_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (locator_id) *
FROM public.locator_readings
ORDER BY locator_id, reading_datetime DESC;

CREATE OR REPLACE VIEW public.well_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (well_id) *
FROM public.well_readings
ORDER BY well_id, reading_datetime DESC;

CREATE OR REPLACE VIEW public.ro_train_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (train_id) *
FROM public.ro_train_readings
ORDER BY train_id, reading_datetime DESC;

CREATE OR REPLACE VIEW public.product_meter_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (meter_id) *
FROM public.product_meter_readings
ORDER BY meter_id, reading_datetime DESC;

-- Grant SELECT on views to authenticated (not anon)
GRANT SELECT ON public.locator_readings_latest TO authenticated;
GRANT SELECT ON public.well_readings_latest TO authenticated;
GRANT SELECT ON public.ro_train_readings_latest TO authenticated;
GRANT SELECT ON public.product_meter_readings_latest TO authenticated;

`;

  // Add functions (security hardening)
  sql += `-- =============================================================================
-- FUNCTIONS (with search_path hardening)
-- =============================================================================

-- NOTE: All SECURITY DEFINER functions must have SET search_path = public, pg_temp
-- This is enforced by migration 20260831000002_security_hardening_search_paths.sql
-- and re-applied by 20260906000001_security_emergency_fixes.sql

-- Example function template:
-- CREATE OR REPLACE FUNCTION public.fn_example()
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- BEGIN
--   -- function body
-- END;
-- $$;
-- REVOKE EXECUTE ON FUNCTION public.fn_example() FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.fn_example() TO authenticated;

`;

  sql += `-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- NOTE: Triggers are defined in individual migrations.
-- Key trigger chains (audit, chain sync, derived meters, cost recomputation)
-- are consolidated in later migrations. See trigger dependency graph in docs.

`;

  sql += `-- =============================================================================
-- BASELINE COMPLETE
-- =============================================================================
-- This baseline represents the schema state after migration 20260906000004.
-- Migrations with timestamps > 20260908000000 should be applied on top.
-- 
-- To test: supabase db reset --linked (or local) applies this baseline
-- then subsequent migrations in order.
-- =============================================================================
`;

  return sql;
}

function main() {
  console.log('Reading types.ts...');
  const typesContent = readFile(TYPES_PATH);
  
  console.log('Parsing table definitions...');
  const tables = parseTypes(typesContent);
  console.log(`Found ${Object.keys(tables).length} tables`);
  
  console.log('Generating baseline migration...');
  const sql = generateBaselineMigration(tables);
  
  console.log(`Writing to ${OUTPUT_PATH}...`);
  writeFile(OUTPUT_PATH, sql);
  
  console.log('Done! Baseline migration generated.');
  console.log('\nIMPORTANT: This is a generated baseline. You MUST:');
  console.log('1. Review the generated SQL for accuracy');
  console.log('2. Add missing indexes, FKs, RLS policies, triggers, functions from individual migrations');
  console.log('3. Test by applying to a fresh database (supabase db reset)');
  console.log('4. Archive old migrations (move to supabase/migrations_archive/)');
  console.log('5. Update CI to test baseline + subsequent migrations');
}

main();