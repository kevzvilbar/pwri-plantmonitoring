/**
 * data/queries/myCorrections.ts: the signed-in user's own correction requests
 * (P5-6 of docs/NAV-IA-REMEDIATION-PLAN.md).
 *
 * Two things here are deliberate:
 *
 * 1. The `submitted_by` filter. Row-level security on `correction_requests`
 *    lets anyone with access to a plant read EVERY request for that plant
 *    (`correction_requests_select_plant`), so RLS does not narrow this to "mine".
 *    Without the filter an operator would see their coworkers' requests.
 *
 * 2. The lookups around the rows (well names, plant names, reviewer names) are
 *    best-effort. The request itself (status, reason, the reviewer's note) is
 *    what an operator came for, so a failed lookup degrades to a generic label
 *    instead of failing the screen.
 */
import { supabase } from '@/integrations/supabase/client';
import { fetchPlantNames, fetchUsernames } from './corrections';
import {
  buildMyRequest, refKey, EMPTY_CONTEXT, MY_CORRECTIONS_LIMIT,
  type CorrectionRequestRow, type MyCorrectionRequest, type RequestContext,
} from '@/shared/myCorrections';

const COLUMNS =
  'id, source_table, source_id, plant_id, original_value, proposed_value, reason, note, status, resolved_by, resolved_at, resolution_note, created_at';

interface ReadingInfo { id: string; entityId: string | null; readingAt: string | null }

async function safe<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

const unique = (xs: readonly (string | null | undefined)[]): string[] =>
  [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** Which reading each request is about, and which well / locator / meter / train it belongs to. */
async function readingInfo(table: string, ids: string[]): Promise<ReadingInfo[]> {
  switch (table) {
    case 'locator_readings': {
      const { data } = await supabase.from('locator_readings').select('id, locator_id, reading_datetime').in('id', ids);
      return (data ?? []).map((r) => ({ id: r.id, entityId: r.locator_id, readingAt: r.reading_datetime }));
    }
    case 'well_readings': {
      const { data } = await supabase.from('well_readings').select('id, well_id, reading_datetime').in('id', ids);
      return (data ?? []).map((r) => ({ id: r.id, entityId: r.well_id, readingAt: r.reading_datetime }));
    }
    case 'product_meter_readings': {
      const { data } = await supabase.from('product_meter_readings').select('id, meter_id, reading_datetime').in('id', ids);
      return (data ?? []).map((r) => ({ id: r.id, entityId: r.meter_id, readingAt: r.reading_datetime }));
    }
    case 'ro_train_readings': {
      const { data } = await supabase.from('ro_train_readings').select('id, train_id, reading_datetime').in('id', ids);
      return (data ?? []).map((r) => ({ id: r.id, entityId: r.train_id, readingAt: r.reading_datetime }));
    }
    default:
      return [];
  }
}

async function entityNames(table: string, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  switch (table) {
    case 'locator_readings': {
      const { data } = await supabase.from('locators').select('id, name').in('id', ids);
      return Object.fromEntries((data ?? []).map((e) => [e.id, e.name]));
    }
    case 'well_readings': {
      const { data } = await supabase.from('wells').select('id, name').in('id', ids);
      return Object.fromEntries((data ?? []).map((e) => [e.id, e.name]));
    }
    case 'product_meter_readings': {
      const { data } = await supabase.from('product_meters').select('id, name').in('id', ids);
      return Object.fromEntries((data ?? []).map((e) => [e.id, e.name]));
    }
    case 'ro_train_readings': {
      const { data } = await supabase.from('ro_trains').select('id, name, train_number').in('id', ids);
      return Object.fromEntries((data ?? []).map((e) => [e.id, e.name || `Train ${e.train_number}`]));
    }
    default:
      return {};
  }
}

async function loadContext(rows: readonly CorrectionRequestRow[]): Promise<RequestContext> {
  const idsByTable = new Map<string, string[]>();
  for (const r of rows) idsByTable.set(r.source_table, [...(idsByTable.get(r.source_table) ?? []), r.source_id]);
  const tables = [...idsByTable.keys()];

  const infoByTable = await Promise.all(
    tables.map(async (t) => [t, await safe(readingInfo(t, unique(idsByTable.get(t) ?? [])), [] as ReadingInfo[])] as const),
  );

  const readings: Record<string, { entityId: string | null; readingAt: string | null }> = {};
  const entityIdsByTable = new Map<string, string[]>();
  for (const [table, infos] of infoByTable) {
    for (const info of infos) readings[refKey(table, info.id)] = { entityId: info.entityId, readingAt: info.readingAt };
    entityIdsByTable.set(table, unique(infos.map((i) => i.entityId)));
  }

  const [namesByTable, plantNames, userNames] = await Promise.all([
    Promise.all(
      tables.map(async (t) => [t, await safe(entityNames(t, entityIdsByTable.get(t) ?? []), {} as Record<string, string>)] as const),
    ),
    safe(fetchPlantNames(unique(rows.map((r) => r.plant_id))), {} as Record<string, string>),
    safe(fetchUsernames(unique(rows.map((r) => r.resolved_by))), {} as Record<string, string>),
  ]);

  const names: Record<string, string> = {};
  for (const [table, byId] of namesByTable) {
    for (const [id, name] of Object.entries(byId)) names[refKey(table, id)] = name;
  }

  return { readings, entityNames: names, plantNames, userNames };
}

/** The user's own requests, newest first. */
export async function fetchMyCorrectionRequests(
  userId: string,
  limit = MY_CORRECTIONS_LIMIT,
): Promise<MyCorrectionRequest[]> {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('correction_requests')
    .select(COLUMNS)
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as CorrectionRequestRow[];
  if (rows.length === 0) return [];

  const ctx = await safe(loadContext(rows), EMPTY_CONTEXT);
  return rows.map((r) => buildMyRequest(r, ctx));
}
