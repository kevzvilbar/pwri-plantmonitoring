/**
 * ro-trains/submitPretreatReadings.ts
 *
 * Core DB write logic for Pre-Treatment Readings CSV import.
 * Mirrors the structure of submitROReadings.ts.
 *
 * No React imports — safe for use in non-component contexts.
 */
import { supabase } from '@/integrations/supabase/client';
import { parsePretreatRow } from './pretreat-csv';

export type PretreatConflictMode = 'skip' | 'overwrite';

export async function insertPretreatReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
  options?: {
    conflictMode?: PretreatConflictMode;
    /**
     * When provided (called from TrainLogModal), bypass the per-row
     * train_number → ID lookup and use this ID for all rows.
     */
    trainIdOverride?: string;
    /**
     * When provided, rows whose reading_datetime falls outside this window
     * are rejected before any write attempt.
     */
    dateRange?: { start: string; end: string };
  },
): Promise<{ count: number; skipped: number; errors: string[]; affectedTrainIds: string[] }> {
  const conflictMode = options?.conflictMode ?? 'skip';

  // Skip the DB train lookup when the caller already knows the target train.
  const numToId: Record<string, string> = {};
  if (!options?.trainIdOverride) {
    const { data: trains } = await (supabase.from('ro_trains' as any) as any)
      .select('id, train_number')
      .eq('plant_id', plantId);
    (trains ?? []).forEach((t: any) => { numToId[String(t.train_number)] = t.id; });
  }

  let count = 0;
  let skipped = 0;
  const errors: string[] = [];
  const affectedTrainIds = new Set<string>();

  for (const r of rows) {
    const rowTrainId = options?.trainIdOverride ?? numToId[r.train_number?.trim()];
    if (!rowTrainId) {
      errors.push(`Train ${r.train_number} not found in this plant`);
      continue;
    }

    const rawDt = r.reading_datetime?.trim().replace(' ', 'T');
    if (!rawDt || isNaN(Date.parse(rawDt))) {
      errors.push(`Row has invalid reading_datetime: ${r.reading_datetime}`);
      continue;
    }
    const dt    = new Date(rawDt).toISOString();
    const dtMin = dt.slice(0, 16);

    // Date-range gate
    if (options?.dateRange) {
      const dtMs   = new Date(dt).getTime();
      const fromMs = new Date(options.dateRange.start).getTime();
      const toMs   = new Date(options.dateRange.end).getTime();
      if (dtMs < fromMs || dtMs > toMs) {
        errors.push(
          `Skipped (out of range): ${dt} is outside accepted window ` +
          `${options.dateRange.start} → ${options.dateRange.end}`,
        );
        continue;
      }
    }

    // Duplicate check — one per train per minute
    const { data: existing } = await (supabase.from('ro_pretreatment_readings' as any) as any)
      .select('id')
      .eq('train_id', rowTrainId)
      .gte('reading_datetime', `${dtMin}:00`)
      .lte('reading_datetime', `${dtMin}:59`)
      .limit(1);

    const existingId: string | null = existing?.[0]?.id ?? null;

    if (existingId && conflictMode === 'skip') {
      skipped++;
      continue;
    }

    const parsed = parsePretreatRow(r);
    const payload: Record<string, any> = {
      plant_id:         plantId,
      train_id:         rowTrainId,
      reading_datetime: dt,
      ...parsed,
    };
    if (userId) payload.recorded_by = userId;

    let writeError: any;
    if (existingId) {
      const { error } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .update(payload)
        .eq('id', existingId);
      writeError = error;
    } else {
      const { error } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .insert(payload);
      writeError = error;
    }

    if (writeError) {
      errors.push(writeError.message);
    } else {
      count++;
      affectedTrainIds.add(rowTrainId);
    }
  }

  return { count, skipped, errors, affectedTrainIds: Array.from(affectedTrainIds) };
}
