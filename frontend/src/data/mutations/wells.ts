import { supabase } from '@/integrations/supabase/client';
import { normalizeDatetime, resolveImportDuplicate } from '@/components/ReadingImportDialog';

const INSERT_CHUNK_SIZE = 200;

export async function insertWellReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  const { data: wells } = await supabase
    .from('wells').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (wells ?? []).forEach((w: any) => { nameToId[w.name.trim().toLowerCase()] = w.id; });

  let count = 0;
  const errors: string[] = [];

  type Resolved = { r: Record<string, string>; wellId: string; dt: string; dtMin: string };
  const resolved: Resolved[] = [];
  for (const r of rows) {
    const wellId = nameToId[r.well_name?.trim().toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    resolved.push({ r, wellId, dt, dtMin: dt.slice(0, 16) });
  }
  if (resolved.length === 0) return { count, errors };

  const wellIds = Array.from(new Set(resolved.map(x => x.wellId)));
  const dtValues = resolved.map(x => x.dt).sort();
  const rangeStart = dtValues[0].slice(0, 10) + 'T00:00:00';
  const rangeEnd   = dtValues[dtValues.length - 1].slice(0, 10) + 'T23:59:59';

  const { data: existingRows } = await supabase
    .from('well_readings')
    .select('id, well_id, reading_datetime')
    .in('well_id', wellIds)
    .gte('reading_datetime', rangeStart)
    .lte('reading_datetime', rangeEnd);

  const existingByKey = new Map<string, string>();
  (existingRows ?? []).forEach((row: any) => {
    const key = `${row.well_id}|${new Date(row.reading_datetime).toISOString().slice(0, 16)}`;
    existingByKey.set(key, row.id);
  });

  const toInsert: Record<string, any>[] = [];

  for (const { r, wellId, dt, dtMin } of resolved) {
    const existingId = existingByKey.get(`${wellId}|${dtMin}`);

    if (existingId) {
      const decision = await resolveImportDuplicate(`${wellId}|${dtMin}`, `${r.well_name} @ ${dtMin}`);
      if (decision === 'skip') continue;
      const ovwCur = +r.current_reading;
      const ovwPrev = r.previous_reading ? +r.previous_reading : null;
      const ovwDailyVol = ovwPrev != null ? ovwCur - ovwPrev : null;
      const ovwPayload: Record<string, any> = {
        current_reading: ovwCur,
        previous_reading: ovwPrev,
        reading_datetime: dt,
        recorded_by: userId,
        daily_volume: ovwDailyVol,
      };
      if (r.tds_ppm?.trim())       ovwPayload.tds_ppm = +r.tds_ppm;
      if (r.turbidity_ntu?.trim()) ovwPayload.turbidity_ntu = +r.turbidity_ntu;
      if (r.pressure_psi?.trim())  ovwPayload.pressure_psi = +r.pressure_psi;
      const { error } = await supabase.from('well_readings').update(ovwPayload as any).eq('id', existingId);
      if (error) errors.push(error.message); else count++;
      continue;
    }

    const csvCur = +r.current_reading;
    const csvPrev = r.previous_reading ? +r.previous_reading : null;
    const rawWellDelta = csvPrev != null ? csvCur - csvPrev : null;
    if (rawWellDelta != null && rawWellDelta < 0)
      errors.push(`Well "${r.well_name}" @ ${dt.slice(0, 10)}: negative delta (${rawWellDelta.toFixed(2)}) — meter drop detected and preserved.`);
    const csvDailyVol = rawWellDelta != null ? rawWellDelta : null;

    const insertPayload: Record<string, any> = {
      well_id: wellId,
      plant_id: plantId,
      current_reading: csvCur,
      previous_reading: csvPrev,
      daily_volume: csvDailyVol,
      reading_datetime: dt,
      recorded_by: userId,
    };
    if (r.tds_ppm?.trim())       insertPayload.tds_ppm = +r.tds_ppm;
    if (r.turbidity_ntu?.trim()) insertPayload.turbidity_ntu = +r.turbidity_ntu;
    if (r.pressure_psi?.trim())  insertPayload.pressure_psi = +r.pressure_psi;
    toInsert.push(insertPayload);
  }

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabase.from('well_readings').insert(chunk as any);
    if (!chunkError) {
      count += chunk.length;
      continue;
    }
    for (const payload of chunk) {
      const { error } = await supabase.from('well_readings').insert(payload as any);
      if (error) errors.push(`${payload.reading_datetime}: ${error.message}`);
      else count++;
    }
  }

  return { count, errors };
}
