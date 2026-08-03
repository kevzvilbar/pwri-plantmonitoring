/**
 * migrationsStatus.ts
 *
 * Client-side port of backend/migrations_status.py (the old
 * `/api/admin/migrations/*` routes). That backend code ran on a
 * user-scoped Supabase client (the caller's own JWT), not the service-role
 * key, and probed the schema purely through PostgREST — so none of it
 * actually needed a server. The one thing it *did* need a server for was
 * reading `supabase/migrations/*.sql` off disk and keeping override/history
 * state in two local JSON files beside the process. Since there's no
 * backend anymore:
 *   - the SQL files are bundled into the frontend at build time (see the
 *     `import.meta.glob` below) instead of read from disk at request time
 *   - override/history state lives in the new `migration_state` table
 *     (supabase/migrations/20260802_migration_state.sql), Admin-gated by
 *     RLS, instead of local JSON files that didn't even survive a backend
 *     redeploy
 *
 * Everything else — the regex parsing, the table/column probing, the
 * applied/pending/partial/indeterminate logic, the override-purge-into-
 * history behavior — is a line-for-line port.
 */
import { supabase } from '@/integrations/supabase/client';

// ─── Bundle migration SQL files at build time ───────────────────────────────
// eslint-disable-next-line no-restricted-syntax
const migrationModules = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface MigrationFileSource {
  filename: string;
  sql: string;
}

function loadMigrationFiles(): MigrationFileSource[] {
  return Object.entries(migrationModules)
    .map(([path, sql]) => ({ filename: path.split('/').pop() as string, sql }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── SQL parsing (ported from migrations_status.py) ─────────────────────────

const CONSTRAINT_HEADS = new Set(['primary', 'foreign', 'unique', 'check', 'constraint', 'exclude', 'like']);

function splitTopLevelCommas(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') { depth += 1; buf += ch; }
    else if (ch === ')') { depth -= 1; buf += ch; }
    else if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; }
    else buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

function extractTableColumns(createBlock: string): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const segment of splitTopLevelCommas(createBlock)) {
    if (!segment) continue;
    const m = /^\s*"?([a-z_][a-z0-9_]*)"?\b/i.exec(segment);
    if (!m) continue;
    const first = m[1].toLowerCase();
    if (CONSTRAINT_HEADS.has(first)) continue;
    if (seen.has(first)) continue;
    seen.add(first);
    cols.push(first);
  }
  return cols;
}

function findCreateTableBlocks(cleanedSql: string): { table: string; body: string }[] {
  const out: { table: string; body: string }[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(cleanedSql))) {
    const name = m[1].toLowerCase();
    const matchEnd = m.index + m[0].length;
    const openIdx = cleanedSql.indexOf('(', matchEnd);
    if (openIdx < 0) continue;
    let depth = 1;
    let i = openIdx + 1;
    while (i < cleanedSql.length && depth > 0) {
      if (cleanedSql[i] === '(') depth += 1;
      else if (cleanedSql[i] === ')') depth -= 1;
      i += 1;
    }
    if (depth !== 0) continue;
    out.push({ table: name, body: cleanedSql.slice(openIdx + 1, i - 1) });
  }
  return out;
}

interface ParsedMigration {
  tablesWithCols: [string, string[]][];
  addedColumns: [string, string][];
}

function parseMigration(sql: string): ParsedMigration {
  const cleaned = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

  const tablesWithCols: [string, string[]][] = [];
  const seenTables = new Set<string>();
  for (const { table, body } of findCreateTableBlocks(cleaned)) {
    if (seenTables.has(table)) continue;
    seenTables.add(table);
    tablesWithCols.push([table, extractTableColumns(body)]);
  }

  const addedColumns: [string, string][] = [];
  const columnSeen = new Set<string>();
  const alterRe = /alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?)(?=alter\s+table|$)/gi;
  let alterMatch: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((alterMatch = alterRe.exec(cleaned))) {
    const table = alterMatch[1].toLowerCase();
    const body = alterMatch[2];
    const addColRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
    let colMatch: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((colMatch = addColRe.exec(body))) {
      const colname = colMatch[1].toLowerCase();
      const key = `${table}.${colname}`;
      if (columnSeen.has(key)) continue;
      columnSeen.add(key);
      addedColumns.push([table, colname]);
    }
  }

  return { tablesWithCols, addedColumns };
}

// ─── Schema probing (ported from admin_helpers.py / migrations_status.py) ──

function isMissingTableError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('does not exist')
    || lower.includes('schema cache')
    || lower.includes('could not find the table')
    || lower.includes('pgrst205')
    || lower.includes('relation')
  );
}

async function probeTable(table: string): Promise<boolean> {
  const { error } = await supabase.from(table as any).select('*', { count: 'exact', head: true }).limit(1);
  if (!error) return true;
  // A permission/RLS error still means the table exists — it's just not
  // visible to this caller. Only a genuinely missing table reports false.
  return !isMissingTableError(error.message);
}

async function probeColumn(table: string, column: string): Promise<boolean> {
  const { error } = await supabase.from(table as any).select(column).limit(0);
  if (!error) return true;
  const lower = (error.message || '').toLowerCase();
  const missingColumn = lower.includes('column') && (
    lower.includes('does not exist') || lower.includes('could not find') || lower.includes('pgrst204')
  );
  if (missingColumn || isMissingTableError(lower)) return false;
  return true;
}

// ─── Types (mirror the shape MigrationsPanel.tsx already expects) ──────────

export interface MigrationExpectedColumn { column: string; exists: boolean; }
export interface MigrationProbeTable {
  name: string;
  exists: boolean;
  expected_columns: MigrationExpectedColumn[];
  missing_columns: string[];
  present_columns: string[];
  expected_count: number;
}
export interface MigrationProbeColumn { table: string; column: string; exists: boolean; }
export interface MigrationOverride {
  marked_at: string;
  by_user_id: string | null;
  by_label: string | null;
  note: string | null;
}
export interface MigrationApplyHistory {
  applied_at: string | null;
  by_label: string | null;
  note: string | null;
  source: string | null;
}
export type MigrationStatusValue = 'applied' | 'pending' | 'partial' | 'indeterminate';
export interface MigrationFile {
  filename: string;
  size: number;
  sha256: string;
  status: MigrationStatusValue;
  probed_status: MigrationStatusValue;
  manual_override: MigrationOverride | null;
  override_applied: boolean;
  apply_history: MigrationApplyHistory | null;
  table_probes: MigrationProbeTable[];
  column_probes: MigrationProbeColumn[];
  added_column_probes: MigrationProbeColumn[];
  sql: string;
}
export interface MigrationsResponse {
  migrations_dir: string;
  summary: { total: number; applied: number; pending: number; partial: number; indeterminate: number };
  files: MigrationFile[];
  purged_overrides: string[];
}

interface MigrationStateRow {
  filename: string;
  manual_override: MigrationOverride | null;
  apply_history: MigrationApplyHistory | null;
}

// ─── Main entry points ───────────────────────────────────────────────────────

export async function listMigrationStatus(): Promise<MigrationsResponse> {
  const files = loadMigrationFiles();

  const { data: stateRows, error: stateError } = await supabase
    .from('migration_state' as any)
    .select('filename, manual_override, apply_history');
  if (stateError) throw new Error(`Failed to load migration state: ${stateError.message}`);

  const stateMap = new Map<string, MigrationStateRow>();
  for (const row of (stateRows ?? []) as unknown as MigrationStateRow[]) {
    stateMap.set(row.filename, row);
  }

  const summary = { total: 0, applied: 0, pending: 0, partial: 0, indeterminate: 0 };
  const purgedOverrides: string[] = [];
  const rowsToPersist: { filename: string; manual_override: null; apply_history: MigrationApplyHistory }[] = [];
  const out: MigrationFile[] = [];

  for (const { filename, sql } of files) {
    const parsed = parseMigration(sql);
    const tableProbes: MigrationProbeTable[] = [];
    const allSignals: boolean[] = [];

    for (const [tableName, expectedCols] of parsed.tablesWithCols) {
      const tableExists = await probeTable(tableName);
      allSignals.push(tableExists);

      let expectedColumns: MigrationExpectedColumn[];
      let missingColumns: string[];
      let presentColumns: string[];

      if (tableExists) {
        const results = await Promise.all(
          expectedCols.map(async (col) => ({ col, exists: await probeColumn(tableName, col) })),
        );
        expectedColumns = results.map((r) => ({ column: r.col, exists: r.exists }));
        presentColumns = results.filter((r) => r.exists).map((r) => r.col);
        missingColumns = results.filter((r) => !r.exists).map((r) => r.col);
        results.forEach((r) => allSignals.push(r.exists));
      } else {
        expectedColumns = expectedCols.map((col) => ({ column: col, exists: false }));
        missingColumns = [...expectedCols];
        presentColumns = [];
      }

      tableProbes.push({
        name: tableName,
        exists: tableExists,
        expected_columns: expectedColumns,
        missing_columns: missingColumns,
        present_columns: presentColumns,
        expected_count: expectedCols.length,
      });
    }

    const addedColumnProbes: MigrationProbeColumn[] = [];
    for (const [table, col] of parsed.addedColumns) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await probeColumn(table, col);
      addedColumnProbes.push({ table, column: col, exists });
      allSignals.push(exists);
    }

    let probedStatus: MigrationStatusValue;
    if (allSignals.length === 0) probedStatus = 'indeterminate';
    else if (allSignals.every(Boolean)) probedStatus = 'applied';
    else if (!allSignals.some(Boolean)) probedStatus = 'pending';
    else probedStatus = 'partial';

    const state = stateMap.get(filename);
    let override = state?.manual_override ?? null;
    let history = state?.apply_history ?? null;
    let status: MigrationStatusValue;
    let overrideApplied = false;

    if (override && probedStatus === 'applied') {
      // The schema caught up with a manually-marked file — fold the
      // override into permanent history (if not already recorded) and
      // drop the override itself.
      if (!history) {
        history = {
          applied_at: override.marked_at,
          by_label: override.by_label,
          note: override.note,
          source: 'override-purge',
        };
      }
      purgedOverrides.push(filename);
      rowsToPersist.push({ filename, manual_override: null, apply_history: history });
      override = null;
      overrideApplied = false;
      status = 'applied';
    } else if (override && probedStatus !== 'applied') {
      status = 'applied';
      overrideApplied = true;
    } else {
      status = probedStatus;
      overrideApplied = false;
    }

    summary.total += 1;
    summary[status] += 1;

    out.push({
      filename,
      size: byteSize(sql),
      sha256: await sha256Hex(sql),
      status,
      probed_status: probedStatus,
      manual_override: override,
      override_applied: overrideApplied,
      apply_history: history,
      table_probes: tableProbes,
      column_probes: addedColumnProbes,
      added_column_probes: addedColumnProbes,
      sql,
    });
  }

  if (rowsToPersist.length > 0) {
    const { error } = await supabase.from('migration_state' as any).upsert(rowsToPersist, { onConflict: 'filename' });
    if (error) throw new Error(`Failed to persist purged overrides: ${error.message}`);
  }

  return { migrations_dir: 'supabase/migrations', summary, files: out, purged_overrides: purgedOverrides };
}

function validateFilename(filename: string, known: Set<string>): void {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Invalid migration filename.');
  }
  if (!filename.endsWith('.sql')) throw new Error('Migration filenames must end with .sql.');
  if (!known.has(filename)) throw new Error(`Migration not found: ${filename}`);
}

export async function markMigrationApplied(
  filename: string,
  note: string | null,
  actorUserId: string | null,
  actorLabel: string | null,
): Promise<{ ok: true; filename: string; manual_override: MigrationOverride }> {
  validateFilename(filename, new Set(loadMigrationFiles().map((f) => f.filename)));
  const override: MigrationOverride = {
    marked_at: new Date().toISOString(),
    by_user_id: actorUserId,
    by_label: actorLabel || actorUserId,
    note: (note || '').trim().slice(0, 500) || null,
  };
  const { error } = await supabase
    .from('migration_state' as any)
    .upsert({ filename, manual_override: override }, { onConflict: 'filename' });
  if (error) throw new Error(error.message);
  return { ok: true, filename, manual_override: override };
}

export async function unmarkMigrationApplied(
  filename: string,
): Promise<{ ok: true; filename: string; removed: boolean }> {
  validateFilename(filename, new Set(loadMigrationFiles().map((f) => f.filename)));
  const { data: row } = await supabase
    .from('migration_state' as any)
    .select('manual_override')
    .eq('filename', filename)
    .maybeSingle();
  const removed = !!(row as unknown as { manual_override: unknown } | null)?.manual_override;
  if (removed) {
    const { error } = await supabase
      .from('migration_state' as any)
      .update({ manual_override: null })
      .eq('filename', filename);
    if (error) throw new Error(error.message);
  }
  return { ok: true, filename, removed };
}

export interface ImportApplyHistoryResult {
  ok: true;
  mode: 'fill_gaps' | 'overwrite';
  added: string[];
  overwritten: string[];
  skipped_existing: string[];
  skipped_unknown: string[];
  skipped_invalid: string[];
  imported_by: string | null;
}

export async function importApplyHistory(
  payload: { history: Record<string, unknown> },
  mode: 'fill_gaps' | 'overwrite',
  actorLabel: string | null,
  actorUserId: string | null,
): Promise<ImportApplyHistoryResult> {
  if (mode !== 'fill_gaps' && mode !== 'overwrite') throw new Error(`Unknown import mode: ${mode}`);
  const incoming = payload?.history;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error("Payload must contain a 'history' object keyed by filename.");
  }

  const known = new Set(loadMigrationFiles().map((f) => f.filename));

  const { data: existingRows } = await supabase.from('migration_state' as any).select('filename, apply_history');
  const hasExistingHistory = new Map<string, boolean>();
  for (const row of (existingRows ?? []) as unknown as MigrationStateRow[]) {
    hasExistingHistory.set(row.filename, !!row.apply_history);
  }

  const added: string[] = [];
  const overwritten: string[] = [];
  const skippedExisting: string[] = [];
  const skippedUnknown: string[] = [];
  const skippedInvalid: string[] = [];
  const toUpsert: { filename: string; apply_history: MigrationApplyHistory }[] = [];

  for (const [filename, entry] of Object.entries(incoming)) {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..') || !filename.endsWith('.sql')) {
      skippedInvalid.push(filename);
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      skippedInvalid.push(filename);
      continue;
    }
    if (!known.has(filename)) {
      skippedUnknown.push(filename);
      continue;
    }
    const e = entry as Record<string, unknown>;
    const appliedAt = typeof e.applied_at === 'string' ? e.applied_at : null;
    if (!appliedAt) {
      skippedInvalid.push(filename);
      continue;
    }
    const normalised: MigrationApplyHistory = {
      applied_at: appliedAt,
      by_label: typeof e.by_label === 'string' ? e.by_label : null,
      note: typeof e.note === 'string' ? e.note : null,
      source: typeof e.source === 'string' ? e.source : 'import',
    };
    const already = hasExistingHistory.get(filename) ?? false;
    if (already) {
      if (mode === 'overwrite') {
        toUpsert.push({ filename, apply_history: normalised });
        overwritten.push(filename);
      } else {
        skippedExisting.push(filename);
      }
    } else {
      toUpsert.push({ filename, apply_history: normalised });
      added.push(filename);
    }
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase.from('migration_state' as any).upsert(toUpsert, { onConflict: 'filename' });
    if (error) throw new Error(error.message);
  }

  return {
    ok: true,
    mode,
    added: added.sort(),
    overwritten: overwritten.sort(),
    skipped_existing: skippedExisting.sort(),
    skipped_unknown: skippedUnknown.sort(),
    skipped_invalid: skippedInvalid.sort(),
    imported_by: actorLabel || actorUserId,
  };
}
