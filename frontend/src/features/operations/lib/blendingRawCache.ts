// ─── Blending "previous cumulative reading" cache resolution ─────────────────
// Small, pure companion to BlendingRow's previous-reading logic in
// BlendingSection.tsx. Extracted so the localStorage-vs-DB resolution itself
// has direct unit coverage, separate from the localStorage/Supabase calls
// that feed it.
//
// Context: BlendingRow caches the well's last-entered cumulative meter
// reading in localStorage (per device) so it can pre-fill the input and
// compute Δ without a round trip. It also fetches the well's actual latest
// raw_meter_reading from the DB. The previous version of this code always
// preferred the localStorage value whenever one existed, on the assumption
// that it was necessarily "most recent". That assumption breaks whenever a
// newer reading was saved from a *different* device, or arrived via CSV
// import run on a different device (import only updates localStorage on the
// machine that ran it) — the device with the stale cache then keeps showing
// its old value indefinitely, even though the DB (and Reading History) have
// moved on. Always resolve to whichever source actually has the more recent
// event_date instead.

export interface RawReading {
  reading: number;
  date: string; // YYYY-MM-DD
}

/**
 * Returns whichever of the two readings is more recent by date. Falls back
 * to whichever one is present if only one is. ISO YYYY-MM-DD strings compare
 * correctly with a plain string comparison.
 */
export function latestRaw(
  a: RawReading | null | undefined,
  b: RawReading | null | undefined,
): RawReading | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.date > a.date ? b : a;
}
