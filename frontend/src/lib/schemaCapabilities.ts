/**
 * schemaCapabilities.ts
 *
 * Remembers, per browser tab and for a limited time, that a specific column is
 * absent from the live database, so code that has a graceful fallback does not
 * re-send the failing request on every visit. FREE-PLAN-BUDGET-PLAN.md, Phase 0.
 *
 * WHY: the multiplier feature's code ships before its migrations are applied.
 * Each visit to the Power meter config page used to fire the "full" query, get a
 * 400 `42703 column ... does not exist`, then fall back — three requests (two of
 * them failing, each also written to the logs) where one would do. The 2026-10-03
 * log sample showed ~160 such failures/day from a handful of sessions.
 *
 * The flag expires (TTL) so that once the migration IS applied, the full query is
 * probed again without needing a redeploy or a tab close.
 */

const TTL_MS = 30 * 60_000;
const STORAGE_PREFIX = 'pwri:missing-column:';
const memory = new Map<string, number>();

/** True when a PostgREST/Postgres error says a column does not exist (SQLSTATE 42703). */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '42703' || /column .* does not exist/i.test(e.message ?? '');
}

/** `key` is a human-readable "table.column" label, e.g. 'power_meter_changes.power_kind'. */
export function isColumnKnownMissing(key: string): boolean {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem !== undefined) {
    if (now - mem < TTL_MS) return true;
    memory.delete(key);
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (raw) {
      const at = Number(raw);
      if (Number.isFinite(at) && now - at < TTL_MS) {
        memory.set(key, at);
        return true;
      }
      sessionStorage.removeItem(STORAGE_PREFIX + key);
    }
  } catch {
    /* storage unavailable (private mode / SSR) — in-memory flag still works */
  }
  return false;
}

/** Records the column as missing when `err` is a missing-column error. Returns true if it was. */
export function noteMissingColumn(key: string, err: unknown): boolean {
  if (!isMissingColumnError(err)) return false;
  const at = Date.now();
  memory.set(key, at);
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(at));
  } catch {
    /* ignore */
  }
  return true;
}

/** Test helper. */
export function _resetSchemaCapabilities(): void {
  memory.clear();
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
