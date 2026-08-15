// ─── Blending backdated-entry date resolution ────────────────────────────────
// Small, pure companion to BlendingRow's "previous cumulative reading" logic
// in BlendingSection.tsx. Extracted so the date-splitting logic itself has
// direct unit coverage, separate from the Supabase query that feeds it.
//
// Context: BlendingRow used to compute "previous cumulative reading" as
// whichever of localStorage / DB-latest-raw / previousVolume it found first —
// always the well's GLOBALLY most recent reading, regardless of which date
// the operator is actually entering. Backdating a missed day (e.g. entering
// Aug 13 after Aug 15 was already logged) compared the Aug 13 entry against
// the Aug 15 reading, producing a nonsensical negative delta that
// permanently blocked Save. The server's own trigger
// (trg_blending_set_reading, see 20260729_blending_previous_reading_trigger.sql)
// already resolves this correctly — latest event_date strictly before the
// row being written — this module mirrors that exact resolution client-side
// so the preview/warning/Save-gating the operator sees agrees with what the
// server will actually derive.

export interface BlendingRawRow {
  raw_meter_reading: number;
  event_date: string;
}

export interface BlendingDateContext {
  /** A reading already logged exactly ON eventDate, if any. */
  existingForDate: { reading: number } | null;
  /** The most recent reading strictly BEFORE eventDate, if any. */
  predecessor: { reading: number; date: string } | null;
}

/**
 * Splits up to the two most-recent blending_events rows for a well with
 * event_date <= eventDate into "already logged on this exact date" and "the
 * true chronological predecessor" (most recent reading strictly before it).
 *
 * Expects `rows` to come from a query filtered to event_date <= eventDate
 * and sorted descending by event_date — exactly what the
 * `.order('event_date', { ascending: false }).limit(2)` query in
 * BlendingRow provides — but does not depend on that ordering for
 * correctness: predecessor selection explicitly requires event_date <
 * eventDate, so a later-dated row can never be mistaken for the
 * predecessor even if a future caller passes unfiltered rows.
 */
export function resolveBlendingDateContext(
  rows: BlendingRawRow[],
  eventDate: string,
): BlendingDateContext {
  const existingRow = rows.find(r => r.event_date === eventDate) ?? null;
  // Explicit "<" (not just "!== eventDate") so this stays correct even if a
  // future caller passes rows that aren't pre-filtered to event_date <=
  // eventDate — a later-dated row must never be picked as the predecessor.
  // ISO YYYY-MM-DD strings compare correctly with a plain "<".
  const predecessorRow = rows.find(r => r.event_date < eventDate) ?? null;
  return {
    existingForDate: existingRow ? { reading: existingRow.raw_meter_reading } : null,
    predecessor: predecessorRow
      ? { reading: predecessorRow.raw_meter_reading, date: predecessorRow.event_date }
      : null,
  };
}
