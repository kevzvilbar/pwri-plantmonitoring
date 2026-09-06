import { supabase } from '@/integrations/supabase/client';
import { normalizeDatetime, resolveImportDuplicate } from '@/components/ReadingImportDialog';

export async function insertBlendingReadings(
  rows: Record<string, string>[],
  plantId: string,
  plantName: string,
): Promise<{ count: number; errors: string[] }> {
  const { data: wells } = await supabase
    .from('wells').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (wells ?? []).forEach((w: any) => { nameToId[w.name.trim().toLowerCase()] = w.id; });

  // ── Raw meter tracking ────────────────────────────────────────────────────
  // Priority for "previous cumulative reading" resolution (highest → lowest):
  //   1. Explicit `previous_reading` column in the CSV row
  //   2. Last raw_meter_reading processed for this well earlier in this batch
  //      (rows are sorted chronologically before processing)
  //   3. localStorage value persisted by manual BlendingRow entries or prior imports
  // If nothing is found here, previous_reading is simply omitted from the
  // write — trg_blending_set_reading (20260729_blending_previous_reading_
  // trigger.sql) resolves it from the well's own history on INSERT, or
  // correctly treats it as a genuine baseline (0 m³ logged) if none exists
  // anywhere. Nothing here ever stores the raw reading itself as a volume.
  const prevRawByWell: Record<string, number | null> = {};

  const initPrevRaw = (wellId: string) => {
    if (wellId in prevRawByWell) return; // already seeded
    try {
      const stored = localStorage.getItem(`blending-raw-${wellId}`);
      prevRawByWell[wellId] = stored ? (JSON.parse(stored) as { reading: number }).reading : null;
    } catch {
      prevRawByWell[wellId] = null;
    }
  };

  // Sort chronologically so intra-batch deltas are computed in the right order
  const sorted = [...rows].sort((a, b) => {
    const da = a.reading_datetime || a.event_date || '';
    const db = b.reading_datetime || b.event_date || '';
    return da.localeCompare(db);
  });

  // Accumulate localStorage updates; apply them all at the end so a mid-import
  // error doesn't leave localStorage in a half-written state.
  const pendingRawPersist: Record<string, { reading: number; date: string }> = {};

  let count = 0;
  const errors: string[] = [];

  for (const r of sorted) {
    const wellId = nameToId[r.well_name?.trim().toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    // Normalise event_date to YYYY-MM-DD regardless of what the CSV contains
    // (Excel commonly exports as M/D/YYYY e.g. "5/19/2026"; PostgreSQL stores
    // dates in ISO format so the duplicate-check .eq() and future queries must
    // use the same canonical form to match correctly).
    const _rawEventDate = r.event_date || '';
    const _parsedEvent = _rawEventDate ? new Date(_rawEventDate) : null;
    const eventDate = (_parsedEvent && !isNaN(_parsedEvent.getTime()))
      ? `${_parsedEvent.getFullYear()}-${String(_parsedEvent.getMonth() + 1).padStart(2, '0')}-${String(_parsedEvent.getDate()).padStart(2, '0')}`
      : new Date().toISOString().slice(0, 10);

    // ── Client-side delta preview — this is validation only now (fast,
    // per-row error messages before a round trip), not what actually gets
    // stored. trg_blending_set_reading (20260729_blending_previous_reading_
    // trigger.sql) owns volume_m3 server-side; the client never writes it.
    if (!r.raw_meter_reading?.trim()) {
      errors.push(`${r.well_name} @ ${eventDate}: raw_meter_reading is required — row skipped.`);
      continue;
    }
    const curRaw = +r.raw_meter_reading;
    initPrevRaw(wellId);

    // Determine previous: explicit CSV column wins, then batch-tracked, then localStorage
    const prevRaw: number | null =
      r.previous_reading?.trim() ? +r.previous_reading
      : prevRawByWell[wellId] ?? null;

    if (prevRaw != null) {
      const previewDelta = curRaw - prevRaw;
      if (previewDelta < 0) {
        errors.push(
          `${r.well_name} @ ${eventDate}: negative delta ${previewDelta.toFixed(2)} m³ ` +
          `(raw ${curRaw} − prev ${prevRaw}) — meter rollback? Row skipped.`,
        );
        continue;
      }
      if (previewDelta === 0) {
        errors.push(
          `${r.well_name} @ ${eventDate}: delta is 0 (current reading equals previous ${curRaw}). Row skipped.`,
        );
        continue;
      }
    }

    // Advance the batch tracker so the next row for this well uses this reading
    prevRawByWell[wellId] = curRaw;
    pendingRawPersist[wellId] = { reading: curRaw, date: eventDate };

    // ── Duplicate check: same well + same event_date ───────────────────────
    try {
      const { data: existing } = await (supabase.from('blending_events' as any) as any)
        .select('id')
        .eq('well_id', wellId)
        .eq('event_date', eventDate)
        .limit(1);
      if (existing && existing.length > 0) {
        const decision = await resolveImportDuplicate(
          `${wellId}|${eventDate}`,
          `${r.well_name} @ ${eventDate}`,
          true, // date-only match
        );
        if (decision === 'skip') continue;
        // overwrite: fall through to upsert below
      }
    } catch {
      // blending_events table may not exist yet — fall through and let the insert handle it
    }

    try {
      // Resolve reading_datetime from CSV: prefer reading_datetime column, fall back to event_date
      const _csvDt = r.reading_datetime?.trim() ? normalizeDatetime(r.reading_datetime.trim()) : null;
      const _rdIso = _csvDt && !isNaN(Date.parse(_csvDt)) ? new Date(_csvDt).toISOString() : null;
      // Atomic upsert via fn_blending_upsert_reading (INSERT ... ON CONFLICT
      // (well_id, event_date) DO UPDATE) — replaces the old select-then-
      // insert/update pair, which left a race window where two concurrent
      // imports/saves for the same well+day could each pass the "does it
      // exist?" check before either had written, producing two rows for the
      // same well/day. See 20260809_blending_events_dedupe_and_unique_constraint.sql.
      const { error: insErr } = await supabase.rpc('fn_blending_upsert_reading' as any, {
        p_well_id: wellId, p_plant_id: plantId, p_well_name: r.well_name, p_plant_name: plantName,
        p_event_date: eventDate,
        p_reading_datetime: _rdIso,
        p_raw_meter_reading: curRaw,
        p_previous_reading: prevRaw,
        p_update_previous_reading: true, // CSV always carries prevRaw through on overwrite, same as before
      });
      if (insErr) throw new Error(insErr.message);
      count++;
    } catch (e) {
      errors.push(e.message);
    }
  }

  // ── Persist latest raw readings to localStorage ────────────────────────────
  // Applied after the loop so BlendingRow's delta calculation stays correct on
  // the next manual entry, and future imports can auto-detect the previous value.
  for (const [wellId, v] of Object.entries(pendingRawPersist)) {
    try { localStorage.setItem(`blending-raw-${wellId}`, JSON.stringify(v)); } catch { /* best-effort persist — ignore */ }
  }

  return { count, errors };
}
