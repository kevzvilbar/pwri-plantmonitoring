/**
 * data-analysis/index.ts  — Supabase Edge Function
 * ──────────────────────────────────────────────────
 * Replaces the Python FastAPI backend for the Data Analysis & Regression page.
 *
 * Routes handled (mirrors backend/server.py + regression_service.py):
 *   POST  /api/data-analysis/run-regression
 *   POST  /api/data-analysis/apply-regression
 *   POST  /api/data-analysis/retract-regression
 *   GET   /api/data-analysis/results
 *   POST  /api/data-analysis/edit-raw
 *   GET   /api/data-analysis/raw-edit-log
 *   GET   /api/data-analysis/tables
 *
 * Deploy:
 *   supabase functions deploy data-analysis --no-verify-jwt
 *
 * Required Supabase secrets (set via dashboard or CLI):
 *   SUPABASE_URL              (auto-injected by Supabase)
 *   SUPABASE_ANON_KEY         (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (add manually — needed for writes that bypass RLS)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Constants (mirror regression_service.py) ───────────────────────────────

const Z_THRESHOLD = 2.5;
const MIN_ROWS = 5;

const SUPPORTED_TABLES: Record<string, string[]> = {
  well_readings:          ['daily_volume', 'current_reading', 'previous_reading', 'power_meter_reading'],
  locator_readings:       ['daily_volume', 'current_reading', 'previous_reading'],
  product_meter_readings: ['daily_volume', 'current_reading', 'previous_reading'],
  ro_train_readings:      ['permeate_tds', 'permeate_ph', 'raw_turbidity', 'dp_psi', 'recovery_pct'],
};

// ── CORS headers ───────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(detail: string, status = 400) {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Supabase client helpers ────────────────────────────────────────────────

function userClient(token: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** Extract Bearer token from Authorization header. */
function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Decode JWT payload (no verification — Supabase already verified it). */
function jwtPayload(token: string): Record<string, unknown> {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

/** Get user id and role from token. */
function callerIdentity(token: string) {
  const p = jwtPayload(token);
  const uid = p.sub as string | undefined;
  const role = (p.user_metadata as Record<string, unknown> | undefined)?.role as string ?? 'Staff';
  return { uid, role };
}

const ALLOWED_ROLES = new Set(['Admin', 'Data Analyst']);
const READ_ROLES    = new Set(['Admin', 'Data Analyst', 'Manager']);

// ── OLS regression helpers (mirrors numpy logic in regression_service.py) ──

interface Stats { rSquared: number | null; slope: number | null; intercept: number | null; }

interface CorrectionRow {
  reading_id: string;
  reading_datetime: string;
  original_value: number | null;
  corrected_value: number | null;
  z_score: number | null;
  is_outlier: boolean;
  note: string;
}

function fitAndFlag(
  readings: Record<string, unknown>[],
  column: string,
): { corrections: CorrectionRow[]; stats: Stats } {
  // Build (index, value, row) triples where value is not null
  const pairs: Array<{ i: number; val: number; row: Record<string, unknown> }> = [];
  readings.forEach((row, i) => {
    const v = row[column];
    if (v !== null && v !== undefined) {
      const n = parseFloat(String(v));
      if (!isNaN(n)) pairs.push({ i, val: n, row });
    }
  });

  if (pairs.length < MIN_ROWS) {
    return {
      corrections: readings.map(r => ({
        reading_id:       String(r.id ?? ''),
        reading_datetime: String(r.reading_datetime ?? ''),
        original_value:   r[column] !== undefined ? Number(r[column]) : null,
        corrected_value:  null,
        z_score:          null,
        is_outlier:       false,
        note:             'Insufficient data for regression',
      })),
      stats: { rSquared: null, slope: null, intercept: null },
    };
  }

  // OLS: y = slope*x + intercept  (x = ordinal index, y = sensor value)
  const n    = pairs.length;
  const xs   = pairs.map(p => p.i);
  const ys   = pairs.map(p => p.val);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, j) => a + x * ys[j], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  const slope     = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const yPred   = xs.map(x => slope * x + intercept);
  const resid   = ys.map((y, j) => y - yPred[j]);

  // R²
  const meanY  = sumY / n;
  const ssTot  = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
  const ssRes  = resid.reduce((a, r) => a + r * r, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null;

  // Z-scores on residuals
  const stdRes = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / resid.length);
  const zScores = stdRes > 0 ? resid.map(r => r / stdRes) : resid.map(() => 0);

  // Build lookup: index → { val, z, yHat }
  const pairMap = new Map(
    pairs.map((p, j) => [p.i, { val: p.val, z: zScores[j], yHat: yPred[j] }]),
  );

  const corrections: CorrectionRow[] = readings.map((row, i) => {
    const original = row[column] !== undefined && row[column] !== null ? Number(row[column]) : null;
    const info = pairMap.get(i);
    if (!info) {
      return {
        reading_id:       String(row.id ?? ''),
        reading_datetime: String(row.reading_datetime ?? ''),
        original_value:   original,
        corrected_value:  null,
        z_score:          null,
        is_outlier:       false,
        note:             'Missing value — skipped',
      };
    }
    const isOutlier = Math.abs(info.z) > Z_THRESHOLD;
    return {
      reading_id:       String(row.id ?? ''),
      reading_datetime: String(row.reading_datetime ?? ''),
      original_value:   original,
      corrected_value:  isOutlier ? Math.round(info.yHat * 1000) / 1000 : null,
      z_score:          Math.round(info.z * 10000) / 10000,
      is_outlier:       isOutlier,
      note:             isOutlier
        ? `Outlier (z=${info.z.toFixed(2)}); corrected to OLS projection`
        : 'Within normal range',
    };
  });

  return { corrections, stats: { rSquared, slope, intercept } };
}

// ── Route handlers ─────────────────────────────────────────────────────────

/** POST /api/data-analysis/run-regression */
async function runRegression(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return err('Unauthorized', 401);
  const { uid, role } = callerIdentity(token);
  if (!ALLOWED_ROLES.has(role)) return err('Forbidden', 403);

  const body = await req.json();
  const { source_table, column_name, plant_id, date_from, date_to, entity_id } = body;

  if (!SUPPORTED_TABLES[source_table]) return err(`Table '${source_table}' is not supported.`);
  if (!SUPPORTED_TABLES[source_table].includes(column_name))
    return err(`Column '${column_name}' is not supported for '${source_table}'.`);

  const db = userClient(token);

  // Build select cols (same as regression_service.py)
  let selectCols = `id,reading_datetime,${column_name},norm_status`;
  if (['well_readings', 'locator_readings'].includes(source_table)) selectCols += ',plant_id';

  let q = db.from(source_table).select(selectCols);

  // Entity-level filter (well_id, train_id, etc.)
  const entityFkMap: Record<string, string> = {
    well_readings:          'well_id',
    locator_readings:       'locator_id',
    ro_train_readings:      'train_id',
    product_meter_readings: 'meter_id',
  };
  if (entity_id && entityFkMap[source_table]) {
    q = q.eq(entityFkMap[source_table], entity_id);
  } else if (plant_id) {
    q = q.eq('plant_id', plant_id);
  }

  if (date_from) q = q.gte('reading_datetime', date_from);
  if (date_to)   q = q.lte('reading_datetime', `${date_to}T23:59:59`);

  // @ts-ignore — Supabase chaining types
  const { data: readings, error: fetchErr } = await q.order('reading_datetime', { ascending: true }).limit(2000);
  if (fetchErr) return err(`Fetch failed: ${fetchErr.message}`, 500);

  const { corrections, stats } = fitAndFlag(readings ?? [], column_name);
  const outlierCount = corrections.filter(c => c.is_outlier).length;
  const resultId     = crypto.randomUUID();
  const now          = new Date().toISOString();

  const doc = {
    id:           resultId,
    source_table,
    column_name,
    plant_id:     plant_id ?? null,
    date_from:    date_from ?? null,
    date_to:      date_to   ?? null,
    created_by:   uid ?? null,
    created_role: role,
    row_count:    (readings ?? []).length,
    r_squared:    stats.rSquared,
    slope:        stats.slope,
    intercept:    stats.intercept,
    corrections,
    status:       'pending',
  };

  // Persist with service role (RLS may block insert otherwise)
  const svc = serviceClient();
  await svc.from('regression_results').insert(doc);

  return ok({
    result_id:     resultId,
    source_table,
    column_name,
    plant_id:      plant_id ?? null,
    date_from:     date_from ?? null,
    date_to:       date_to   ?? null,
    row_count:     (readings ?? []).length,
    outlier_count: outlierCount,
    r_squared:     stats.rSquared,
    slope:         stats.slope,
    intercept:     stats.intercept,
    corrections,
    status:        'pending',
    created_at:    now,
  });
}

/** POST /api/data-analysis/apply-regression */
async function applyRegression(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return err('Unauthorized', 401);
  const { uid, role } = callerIdentity(token);
  if (!ALLOWED_ROLES.has(role)) return err('Forbidden', 403);

  const { result_id } = await req.json();
  const svc = serviceClient();

  const { data: row } = await svc.from('regression_results').select('*').eq('id', result_id).maybeSingle();
  if (!row) return err(`Regression result '${result_id}' not found.`, 404);
  if (row.status !== 'pending') return err(`Result is '${row.status}' — can only apply 'pending' results.`);

  const outliers = (row.corrections as CorrectionRow[])
    .filter(c => c.is_outlier && c.corrected_value !== null);

  const normRows = [];
  for (const c of outliers) {
    await svc.from(row.source_table).update({ norm_status: 'normalized' }).eq('id', c.reading_id);
    normRows.push({
      source_table:   row.source_table,
      source_id:      c.reading_id,
      action:         'normalize',
      original_value: c.original_value,
      adjusted_value: c.corrected_value,
      note:           c.note || `Regression correction (result_id=${result_id})`,
      performed_by:   uid ?? null,
      performed_role: role,
    });
  }

  if (normRows.length) await svc.from('reading_normalizations').insert(normRows);
  await svc.from('regression_results').update({ status: 'applied' }).eq('id', result_id);

  return ok({ applied: outliers.length });
}

/** POST /api/data-analysis/retract-regression */
async function retractRegression(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return err('Unauthorized', 401);
  const { uid, role } = callerIdentity(token);
  if (!ALLOWED_ROLES.has(role)) return err('Forbidden', 403);

  const { result_id } = await req.json();
  const svc = serviceClient();

  const { data: row } = await svc.from('regression_results').select('*').eq('id', result_id).maybeSingle();
  if (!row) return err(`Regression result '${result_id}' not found.`, 404);
  if (row.status !== 'applied') return err(`Result is '${row.status}' — can only retract 'applied' results.`);

  const outliers = (row.corrections as CorrectionRow[]).filter(c => c.is_outlier);

  const normRows = [];
  for (const c of outliers) {
    await svc.from(row.source_table).update({ norm_status: 'retracted' }).eq('id', c.reading_id);
    normRows.push({
      source_table:   row.source_table,
      source_id:      c.reading_id,
      action:         'retract',
      original_value: c.original_value,
      adjusted_value: null,
      note:           `Regression retracted (result_id=${result_id})`,
      performed_by:   uid ?? null,
      performed_role: role,
    });
  }

  if (normRows.length) await svc.from('reading_normalizations').insert(normRows);
  await svc.from('regression_results').update({ status: 'retracted' }).eq('id', result_id);

  return ok({ retracted: outliers.length });
}

/** GET /api/data-analysis/results */
async function listResults(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return err('Unauthorized', 401);
  const { role } = callerIdentity(token);
  if (!READ_ROLES.has(role)) return err('Forbidden', 403);

  const url = new URL(req.url);
  const plant_id    = url.searchParams.get('plant_id');
  const source_table = url.searchParams.get('source_table');
  const column_name = url.searchParams.get('column_name');
  const entity_id   = url.searchParams.get('entity_id');

  const db = userClient(token);
  let q = db.from('regression_results').select('*');
  if (plant_id)     q = q.eq('plant_id', plant_id);
  if (source_table) q = q.eq('source_table', source_table);
  if (column_name)  q = q.eq('column_name', column_name);

  // @ts-ignore
  const { data, error } = await q.order('created_at', { ascending: false }).limit(50);
  if (error) return err(error.message, 500);

  return ok({ results: data ?? [] });
}

/** POST /api/data-analysis/edit-raw */
async function editRaw(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return err('Unauthorized', 401);
  const { uid, role } = callerIdentity(token);
  if (!ALLOWED_ROLES.has(role)) return err('Forbidden', 403);

  const body = await req.json();
  const { source_table, source_id, column_name, old_value, new_value, note } = body;

  if (!SUPPORTED_TABLES[source_table]) return err(`Table '${source_table}' not supported.`);

  const svc = serviceClient();
  const { error: updateErr } = await svc
    .from(source_table)
    .update({ [column_name]: new_value })
    .eq('id', source_id);
  if (updateErr) return err(`Update failed: ${updateErr.message}`, 500);

  await svc.from('raw_edit_log').insert({
    source_table, source_id, column_name,
    old_value, new_value,
    edited_by:   uid ?? null,
    edited_role: role,
    edited_at:   new Date().toISOString(),
    note:        note ?? '',
  });

  return ok({ ok: true, source_id, column_name, new_value });
}

/** GET /api/data-analysis/raw-edit-log */
async function rawEditLog(req: Request): Promise<Response> {
  const token = bearerToken(req);
  if (!token) return err('Unauthorized', 401);
  const { role } = callerIdentity(token);
  if (!READ_ROLES.has(role)) return err('Forbidden', 403);

  const url = new URL(req.url);
  const source_table = url.searchParams.get('source_table');
  const source_id    = url.searchParams.get('source_id');
  const limit        = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)));

  const db = userClient(token);
  let q = db.from('raw_edit_log').select('*');
  if (source_table) q = q.eq('source_table', source_table);
  if (source_id)    q = q.eq('source_id', source_id);

  // @ts-ignore
  const { data, error } = await q.order('edited_at', { ascending: false }).limit(limit);
  if (error) return err(error.message, 500);

  return ok({ log: data ?? [] });
}

// ── Main router ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url   = new URL(req.url);
  // Strip the function prefix: /data-analysis/api/data-analysis/run-regression
  // → normalise to the path segment after /api/data-analysis/
  const match = url.pathname.match(/\/api\/data-analysis\/([\w-]+)/);
  const route = match ? match[1] : null;

  try {
    if (req.method === 'POST' && route === 'run-regression')    return await runRegression(req);
    if (req.method === 'POST' && route === 'apply-regression')  return await applyRegression(req);
    if (req.method === 'POST' && route === 'retract-regression') return await retractRegression(req);
    if (req.method === 'GET'  && route === 'results')           return await listResults(req);
    if (req.method === 'POST' && route === 'edit-raw')          return await editRaw(req);
    if (req.method === 'GET'  && route === 'raw-edit-log')      return await rawEditLog(req);
    if (req.method === 'GET'  && route === 'tables') {
      return ok({ tables: SUPPORTED_TABLES });
    }
    return err('Not found', 404);
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : 'Internal error', 500);
  }
});
