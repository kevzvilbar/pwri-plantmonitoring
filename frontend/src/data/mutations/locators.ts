import { supabase } from '@/integrations/supabase/client';
import { normalizeDatetime, resolveImportDuplicate } from '@/components/ReadingImportDialog';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { friendlyError } from '@/lib/supabaseErrors';
import { resolveReason } from '@/lib/correctionReasons';

const LOCATOR_INSERT_CHUNK_SIZE = 200;

export async function insertLocatorReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[]; affectedIds: string[] }> {
  const { data: locators, error: locatorsErr } = await supabase
    .from('locators').select('id, name').eq('plant_id', plantId);
  if (locatorsErr) throw locatorsErr;
  const nameToId: Record<string, string> = {};
  (locators ?? []).forEach((l: any) => { nameToId[l.name.trim().toLowerCase()] = l.id; });

  const locatorIds = Object.values(nameToId);
  const existingByKey: Record<string, string> = {};
  if (locatorIds.length > 0) {
    const { data: existingReadings, error: existingErr } = await supabase
      .from('locator_readings')
      .select('id, locator_id, reading_datetime')
      .in('locator_id', locatorIds);
    if (existingErr) throw existingErr;
    (existingReadings ?? []).forEach((e: any) => {
      const key = `${e.locator_id}|${(e.reading_datetime as string).slice(0, 16)}`;
      existingByKey[key] = e.id;
    });
  }

  let count = 0;
  const errors: string[] = [];
  const affectedIds = new Set<string>();
  const toInsert: { payload: Record<string, any>; locatorId: string }[] = [];

  for (const r of rows) {
    const locatorId = nameToId[r.locator_name?.trim().toLowerCase()];
    if (!locatorId) { errors.push(`Locator not found: "${r.locator_name}"`); continue; }

    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    const dtMin = dt.slice(0, 16);
    const dupKey = `${locatorId}|${dtMin}`;
    const existingId = existingByKey[dupKey];

    const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';

    if (existingId) {
      const decision = await resolveImportDuplicate(dupKey, `${r.locator_name} @ ${dtMin}`);
      if (decision === 'skip') continue;

      const updatePayload: Record<string, any> = { reading_datetime: dt, recorded_by: userId, is_estimated: false };
      if (isDirect) {
        updatePayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
        updatePayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
      } else {
        const csvCurLoc  = +r.current_reading;
        const csvPrevLoc = r.previous_reading ? +r.previous_reading : null;
        updatePayload.current_reading  = csvCurLoc;
        updatePayload.previous_reading = csvPrevLoc;
        const rawLocDelta = csvPrevLoc != null ? csvCurLoc - csvPrevLoc : null;
        if (rawLocDelta != null && rawLocDelta < 0)
          errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta.toFixed(2)}) — meter rollback detected.`);
      }
      const { error } = await supabase.from('locator_readings').update(updatePayload as any).eq('id', existingId);
      if (error) errors.push(error.message); else { count++; existingByKey[dupKey] = existingId; }
      continue;
    }

    const insertPayload: Record<string, any> = {
      locator_id:       locatorId,
      plant_id:         plantId,
      reading_datetime: dt,
      recorded_by:      userId,
      is_estimated:     false,
    };

    if (isDirect) {
      insertPayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
      insertPayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
    } else {
      const csvCurLoc2  = +r.current_reading;
      const csvPrevLoc2 = r.previous_reading ? +r.previous_reading : null;
      insertPayload.current_reading  = csvCurLoc2;
      insertPayload.previous_reading = csvPrevLoc2;
      const rawLocDelta2 = csvPrevLoc2 != null ? csvCurLoc2 - csvPrevLoc2 : null;
      if (rawLocDelta2 != null && rawLocDelta2 < 0)
        errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta2.toFixed(2)}) — meter rollback detected.`);
    }

    toInsert.push({ payload: insertPayload, locatorId });
    existingByKey[dupKey] = 'pending';
  }

  for (let i = 0; i < toInsert.length; i += LOCATOR_INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + LOCATOR_INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabase
      .from('locator_readings')
      .insert(chunk.map(c => c.payload) as any);
    if (!chunkError) {
      count += chunk.length;
      chunk.forEach(c => affectedIds.add(c.locatorId));
      continue;
    }
    for (const { payload, locatorId } of chunk) {
      const { error } = await supabase.from('locator_readings').insert(payload as any);
      if (error) errors.push(error.message);
      else { count++; affectedIds.add(locatorId); }
    }
  }

  return { count, errors, affectedIds: Array.from(affectedIds) };
}

export const HAMAS_OVERRIDE_SCHEMA = 'date* (YYYY-MM-DD), value* (m3), reason*';
export const HAMAS_OVERRIDE_TEMPLATE_ROW = {
  date: '2026-07-27',
  value: '250.00',
  reason: 'Corrected from field notebook — sibling meter was misread on this date.',
};

export function validateDerivedOverrideRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.date?.trim() || isNaN(Date.parse(r.date.trim())))
    e.push(`Row ${i}: date must be a valid date (YYYY-MM-DD)`);
  if (!r.value?.trim() || isNaN(Number(r.value)))
    e.push(`Row ${i}: value must be a number`);
  if (!r.reason?.trim())
    e.push(`Row ${i}: reason is required — it's written to the audit log so the override is explained, not just a changed number`);
  return e;
}

export async function syncDerivedLocatorMirrors(
  locatorId: string,
  readingDatetime: string,
  value: number,
): Promise<void> {
  const { data: mirrors, error: mirrorsErr } = await (supabase
    .from('product_meters' as any) as any)
    .select('id, plant_id')
    .eq('derived_from_locator_id', locatorId)
    .eq('is_derived', true);
  if (mirrorsErr || !mirrors?.length) return;

  const dateKey = new Date(readingDatetime)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const dayStart  = new Date(`${dateKey}T00:00:00+08:00`).toISOString();
  const dayEndDt  = new Date(`${dateKey}T00:00:00+08:00`);
  dayEndDt.setDate(dayEndDt.getDate() + 1);
  const dayEnd    = dayEndDt.toISOString();
  const insertDt  = new Date(`${dateKey}T23:59:00+08:00`).toISOString();

  for (const mirror of mirrors as any[]) {
    const { data: existing } = await (supabase
      .from('product_meter_readings' as any) as any)
      .select('id')
      .eq('meter_id', mirror.id)
      .gte('reading_datetime', dayStart)
      .lt('reading_datetime', dayEnd)
      .order('reading_datetime', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await (supabase.from('product_meter_readings' as any) as any).update({
        current_reading:  value,
        previous_reading: 0,
        daily_volume:     value,
        is_estimated:     true,
      }).eq('id', existing.id);
    } else {
      await (supabase.from('product_meter_readings' as any) as any).insert({
        meter_id:         mirror.id,
        plant_id:         mirror.plant_id,
        reading_datetime: insertDt,
        current_reading:  value,
        previous_reading: 0,
        daily_volume:     value,
        is_estimated:     true,
      });
    }
  }
}

export async function insertDerivedOverrideRows(
  rows: Record<string, string>[],
  plantId: string,
  locatorId: string,
  userId: string | null,
  actorLabel: string,
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  const lastIndexForDate = new Map<string, number>();
  rows.forEach((r, i) => { const d = r.date?.trim(); if (d) lastIndexForDate.set(d, i); });
  rows.forEach((r, i) => {
    const d = r.date?.trim();
    if (d && lastIndexForDate.get(d) !== i)
      errors.push(`Row ${i + 2} (${d}): superseded by a later row in this file for the same date — only the last row per date is applied.`);
  });
  const byDate = new Map<string, { row: Record<string, string>; line: number }>();
  rows.forEach((r, i) => {
    const d = r.date?.trim();
    if (d && lastIndexForDate.get(d) === i) byDate.set(d, { row: r, line: i + 2 });
  });

  const { data: existing, error: existingErr } = await supabase
    .from('locator_readings')
    .select('id, reading_datetime, current_reading, is_estimated')
    .eq('locator_id', locatorId);
  if (existingErr) throw existingErr;
  const existingByDate: Record<string, any> = {};
  (existing ?? []).forEach((row: any) => {
    const dKey = new Date(row.reading_datetime).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    if (!existingByDate[dKey] || new Date(row.reading_datetime) > new Date(existingByDate[dKey].reading_datetime)) {
      existingByDate[dKey] = row;
    }
  });

  let count = 0;
  for (const [dateKey, { row, line }] of byDate) {
    try {
      const value = Number(row.value);
      const reason = row.reason.trim();
      const existingRow = existingByDate[dateKey];
      const before = existingRow
        ? { current_reading: existingRow.current_reading, is_estimated: existingRow.is_estimated }
        : {};
      const payload: any = {
        locator_id: locatorId, plant_id: plantId,
        current_reading: value, previous_reading: 0, is_estimated: false,
        recorded_by: userId,
      };
      const { data: savedRow, error } = existingRow?.id
        ? await supabase.from('locator_readings').update(payload).eq('id', existingRow.id).select().single()
        : await supabase.from('locator_readings')
            .insert({ ...payload, reading_datetime: new Date(`${dateKey}T23:59:00+08:00`).toISOString() })
            .select().single();
      if (error) throw error;

      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: (savedRow as any)?.id ?? null,
        plant_id: plantId,
        actor_user_id: userId,
        actor_label: actorLabel,
        changes: { ...diffFields(before, { current_reading: value, is_estimated: false }), override_reason: { old: null, new: reason } },
        reason,
      });
      await syncDerivedLocatorMirrors(
        locatorId,
        (savedRow as any)?.reading_datetime ?? new Date(`${dateKey}T23:59:00+08:00`).toISOString(),
        value,
      );
      count++;
    } catch (err: any) {
      errors.push(`Row ${line} (${row.date}): ${friendlyError(err)}`);
    }
  }
  return { count, errors };
}
