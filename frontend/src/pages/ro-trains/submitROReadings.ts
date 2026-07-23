/**
 * ro-trains/submitROReadings.ts
 *
 * Core DB write logic for RO Train readings CSV import.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 *
 * No React imports — safe for use in non-component contexts.
 */
import { supabase } from '@/integrations/supabase/client';
import { flushDeltaCache } from '@/lib/deltaCache';
import { normalizeRODatetime } from './csv';

// ─── Permeate date attribution ────────────────────────────────────────────────
// All readings are attributed to the plain local calendar date of
// reading_datetime.  The 00:20 cutoff-time shift rule was removed — no day
// boundary is crossed regardless of when the reading is recorded.

export function getPermeateDayLabel(
  isoDatetime: string,
  _cutoffHHmm?: string,
): string {
  const dt = new Date(isoDatetime);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const d  = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Conflict resolution ──────────────────────────────────────────────────────
// 'skip'      — leave existing row untouched, record as skipped (default)
// 'overwrite' — UPDATE the existing row with the new values

export type ConflictMode = 'skip' | 'overwrite';

// ─── insertROTrainReadings ────────────────────────────────────────────────────

export async function insertROTrainReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
  options?: {
    permeateIsProduction?: boolean;
    conflictMode?: ConflictMode;
  },
): Promise<{ count: number; skipped: number; errors: string[]; affectedTrainIds: string[] }> {
  const { data: trains } = await supabase
    .from('ro_trains')
    .select('id, train_number')
    .eq('plant_id', plantId);
  const numToId: Record<string, string> = {};
  (trains ?? []).forEach((t: any) => { numToId[String(t.train_number)] = t.id; });

  const conflictMode: ConflictMode = options?.conflictMode ?? 'skip';
  let count = 0;
  let skipped = 0;
  const errors: string[] = [];
  const affectedTrainIds = new Set<string>();

  for (const r of rows) {
    const trainId = numToId[r.train_number?.trim()];
    if (!trainId) { errors.push(`Train ${r.train_number} not found in this plant`); continue; }

    const dt    = r.reading_datetime
      ? new Date(normalizeRODatetime(r.reading_datetime)).toISOString()
      : new Date().toISOString();
    const dtMin = dt.slice(0, 16);

    // Duplicate check — one per train per hour
    const { data: existing } = await supabase
      .from('ro_train_readings')
      .select('id')
      .eq('train_id', trainId)
      .gte('reading_datetime', `${dtMin}:00`)
      .lte('reading_datetime', `${dtMin}:59`)
      .limit(1);

    const existingId: string | null = existing?.[0]?.id ?? null;

    if (existingId && conflictMode === 'skip') {
      skipped++;
      continue;
    }

    const num = (k: string) => r[k]?.trim() ? +r[k] : null;

    // Permeate meter delta
    const permCurr  = r.permeate_meter_curr?.trim() ? +r.permeate_meter_curr : null;
    const permPrev  = r.permeate_meter_prev?.trim() ? +r.permeate_meter_prev : null;
    const permDelta = permCurr !== null && permPrev !== null ? Math.max(0, permCurr - permPrev) : null;

    // Core payload — columns confirmed present in the original schema
    const corePayload: Record<string, any> = {
      train_id:             trainId,
      plant_id:             plantId,
      reading_datetime:     dt,
      feed_pressure_psi:    num('feed_pressure_psi'),
      reject_pressure_psi:  num('reject_pressure_psi'),
      feed_flow:            num('feed_flow'),
      permeate_flow:        num('permeate_flow'),
      reject_flow:          num('reject_flow'),
      feed_tds:             num('feed_tds'),
      permeate_tds:         num('permeate_tds'),
      reject_tds:           num('reject_tds'),
      feed_ph:              num('feed_ph'),
      permeate_ph:          num('permeate_ph'),
      reject_ph:            num('reject_ph'),
      turbidity_ntu:        num('turbidity_ntu'),
      temperature_c:        num('temperature_c'),
      suction_pressure_psi: num('suction_pressure_psi'),
    };

    // Optional columns — added by migrations; may not exist in all DBs.
    // Only include each key when it has a real value so un-migrated DBs don't
    // get a schema-cache error.
    const optionalPayload: Record<string, any> = {};
    const remarksVal  = r.remarks?.trim();
    if (remarksVal)        optionalPayload.remarks                  = remarksVal;
    if (userId)            optionalPayload.recorded_by              = userId;
    const chlorineVal = r.chlorine_residual_mg_l?.trim() ? +r.chlorine_residual_mg_l : null;
    if (chlorineVal !== null) optionalPayload.chlorine_residual_mg_l = chlorineVal;
    if (permCurr !== null) optionalPayload.permeate_meter           = permCurr;
    if (permPrev !== null) optionalPayload.permeate_meter_prev      = permPrev;
    if (permDelta !== null) optionalPayload.permeate_meter_delta    = permDelta;

    // Column-fallback: full payload → core-only on schema-cache miss.
    // Mirrors the pattern in insertPowerReadings / insertWellReadings.
    const OPTIONAL_KEYS = [
      'remarks', 'recorded_by',
      'chlorine_residual_mg_l',
      'feed_meter', 'feed_meter_prev', 'feed_meter_delta',
      'permeate_meter', 'permeate_meter_prev', 'permeate_meter_delta',
      'reject_meter', 'reject_meter_prev', 'reject_meter_delta',
    ];
    const isOptionalColError = (msg: string) =>
      OPTIONAL_KEYS.some(k => msg.includes(`'${k}'`));

    const doWrite = async (payload: Record<string, any>) => {
      if (existingId) {
        const { error } = await supabase
          .from('ro_train_readings')
          .update(payload as any)
          .eq('id', existingId);
        return error;
      }
      const { error } = await supabase
        .from('ro_train_readings')
        .insert(payload as any);
      return error;
    };

    const error = await doWrite({ ...corePayload, ...optionalPayload });

    if (error) {
      if (isOptionalColError(error.message)) {
        const e2 = await doWrite(corePayload);
        if (e2) errors.push(e2.message);
        else    { count++; affectedTrainIds.add(trainId); }
      } else {
        errors.push(error.message);
      }
    } else {
      count++;
      affectedTrainIds.add(trainId);
    }
  }

  // Flush the hybrid delta cache for every train that was mutated so the next
  // Dashboard/TrendChart render recomputes from fresh DB rows (Tier 2).
  if (affectedTrainIds.size > 0) flushDeltaCache(Array.from(affectedTrainIds));

  return { count, skipped, errors, affectedTrainIds: Array.from(affectedTrainIds) };
}
