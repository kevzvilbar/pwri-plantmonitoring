// ─── Shared meter-replacement-aware delta helper ────────────────────────────
// This is a byte-for-byte copy of the local `computeEntityDeltas` function
// defined inside TrendChart.tsx's `chartData` useMemo (the function backing
// every historical Production / Raw Water / Consumption number this app
// shows, including the Overview StatCards' underlying trend lines).
//
// It is copied rather than imported because TrendChart.tsx is a large,
// heavily-patched file with a documented history of subtle regressions in
// exactly this computation (see its own comments: the -4,853,089 spike, the
// -898K consumption spike, the Aug 7-10 Coke/Parkmall miscalculation) — the
// safest change to a file like that is no change at all. This mirrors the
// same pattern the codebase already uses for computePivotFromReadingsNoCache
// in DataSummaryModal.tsx, which carries an identical "mirrors TrendChart.tsx
// computeEntityDeltas" note.
//
// If you fix a bug here, fix it in TrendChart.tsx's copy too (and vice
// versa) — the two are meant to stay identical. The real fix, if this ever
// gets a third caller, is to extract both into this file for real; two
// documented mirrors is the same tradeoff DataSummaryModal.tsx already made,
// not a new one.
//
// entityKeyField: the column that uniquely identifies an individual meter.
//   • well_readings          → 'well_id'
//   • locator_readings       → 'locator_id'
//   • product_meter_readings → 'meter_id'
//   • ro_train_readings      → 'train_id'
//
// Keying by the individual meter ID (not plant_id) prevents readings from
// different meters at the same plant bleeding into each other's diff.
//
// dailyVolumeField: if the table stores a pre-computed daily volume column
// (e.g. locator_readings.daily_volume), use it directly when present. Wells
// and product meters don't have this column so pass null.
//
// Meter-replacement handling (matches Operations.tsx display logic):
//   • REPL row (is_meter_replacement = true):
//       delta = 0, new baseline = current_reading, flag entity as "afterRepl"
//   • First non-REPL row after a REPL:
//       delta = 0 (new meter has no valid predecessor yet), clear flag
//   • All subsequent rows:
//       delta = current_reading − last seen current_reading for that entity
//
// rawDelta is null when there is no predecessor (first reading in window,
// or first after replacement) so callers don't false-flag those as negative
// readings.
export function computeEntityDeltas(
  readings: any[],
  entityKeyField: string,
  dailyVolumeField: string | null,
  options?: {
    skipAfterRepl?: boolean;
    // IDs (e.g. locator_id) whose default_input_mode = 'direct' —
    // current_reading already IS the period's volume for these. Mirrors
    // EntityHistoryChart.tsx's isDirectMode branch.
    directModeIds?: Set<string>;
  },
): { r: any; delta: number; rawDelta: number | null; isMeterReplacement: boolean }[] {
  // skipAfterRepl=true: the replacement row already sets lastReading to the
  // new meter's starting value, so the very next reading can diff against it
  // normally (e.g. RO permeate: repl=227,368 → next=228,106 → delta=737.7).
  // skipAfterRepl=false (default): the row immediately after a replacement is
  // zeroed as a safety net for meter types where the replacement reading may
  // not be a reliable baseline (locators, wells, product meters).
  const skipAfterRepl = options?.skipAfterRepl ?? false;
  const directModeIds = options?.directModeIds;

  const sorted = [...readings]
    .filter((r) => r.norm_status !== 'retracted')
    .sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );

  const lastReading = new Map<string, number>(); // entityKey → last current_reading
  const afterRepl   = new Set<string>();          // entities whose next row is zeroed

  return sorted.map((r) => {
    const entityKey = r[entityKeyField] ?? r.plant_id ?? '__';
    const isMR      = !!r.is_meter_replacement;

    if (isMR) {
      lastReading.set(entityKey, +r.current_reading);
      if (!skipAfterRepl) afterRepl.add(entityKey);
      return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
    }

    if (afterRepl.has(entityKey)) {
      lastReading.set(entityKey, +r.current_reading);
      afterRepl.delete(entityKey);
      return { r, delta: 0, rawDelta: null, isMeterReplacement: false };
    }

    if (directModeIds?.has(entityKey)) {
      // Direct mode: current_reading already IS the period's volume — no
      // diff, no dependence on daily_volume/previous_reading.
      const delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
      lastReading.set(entityKey, +r.current_reading);
      return { r, delta, rawDelta: null, isMeterReplacement: false };
    }

    if (dailyVolumeField && r[dailyVolumeField] != null && !lastReading.has(entityKey)) {
      // Only trust the stored daily_volume for the FIRST row of this entity
      // within the fetched window, where there's no locally walked
      // predecessor to diff against — that stored value may legitimately
      // span >1 day if readings were skipped before the window. Once a
      // predecessor HAS been walked (below), always diff live against it
      // instead: daily_volume/previous_reading are written once at insert
      // time and never cascaded when an earlier reading is later
      // edited/deleted/replaced, so a downstream row can keep pointing at a
      // stale predecessor indefinitely.
      // Preserve negative daily_volume so drops/flaws are reflected rather
      // than hidden.
      const storedVol = +r[dailyVolumeField];
      const delta     = storedVol;
      lastReading.set(entityKey, +r.current_reading);
      return { r, delta, rawDelta: null, isMeterReplacement: false };
    }

    if (!lastReading.has(entityKey)) {
      lastReading.set(entityKey, +r.current_reading);
      // If the DB stored previous_reading, compute the delta instead of
      // returning 0. Without this, the first reading in the fetch window
      // (no prior in-memory row) always shows 0, causing a false dip at the
      // start of every range.
      if (r.previous_reading != null) {
        const rawDelta = +r.current_reading - +r.previous_reading;
        const delta    = rawDelta;
        return { r, delta, rawDelta, isMeterReplacement: false };
      }
      // No previous_reading in DB → we genuinely don't know the delta for
      // this first row. isMeterReplacement=true here is a "skip this point"
      // signal for callers that annotate individual points; it doesn't
      // affect a plain sum since delta is already 0.
      return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
    }

    const rawDelta = +r.current_reading - lastReading.get(entityKey)!;
    const delta    = rawDelta;
    lastReading.set(entityKey, +r.current_reading);
    return { r, delta, rawDelta, isMeterReplacement: false };
  });
}
