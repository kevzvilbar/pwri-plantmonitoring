/**
 * lib/autoOfflineThreshold.ts
 *
 * Single source of truth for the auto-offline staleness threshold — the
 * "no production reading for N hours ⇒ the train is effectively Offline"
 * business rule.
 *
 * This constant used to live as three independent hand-rolled copies:
 *   - hooks/useTrainAutoOffline.ts (AUTO_OFFLINE_THRESHOLD_HOURS — the flagger)
 *   - lib/trainStatusTimeline.ts   (AUTO_OFFLINE_THRESHOLD_HOURS — display
 *     guards like dropBogusOpenAutoFlag)
 *   - pages/ro-trains/helpers.tsx  (TWO_HOURS_MS — deriveTrainStatus)
 * plus an inline `2 * 60 * 60 * 1000` in usePretreatmentData.ts. They drifted
 * once already (1h vs 2h, fixed 2026-09-12 — see the comment that used to sit
 * next to helpers.tsx's copy): train cards showed "Offline" a full hour
 * before the flagger would ever act on it. Every consumer now imports from
 * here, and autoOfflineThreshold.test.ts fails CI if a local literal copy is
 * reintroduced anywhere.
 *
 * Kept a plain constant module rather than a config table deliberately: the
 * flagger runs on a 5-minute poll from every open client, and a per-request
 * config read would add a failure mode to the exact path that must never
 * silently no-op. Change the value here, in one place.
 */

export const AUTO_OFFLINE_THRESHOLD_HOURS = 2;

export const ONE_HOUR_MS = 60 * 60 * 1000;

/** Matches AUTO_OFFLINE_THRESHOLD_HOURS — kept as a separate export because
 *  several call sites (deriveTrainStatus, isPastTwoHoursMissing) think in
 *  milliseconds. */
export const TWO_HOURS_MS = AUTO_OFFLINE_THRESHOLD_HOURS * ONE_HOUR_MS;

/**
 * True when the train has gone AUTO_OFFLINE_THRESHOLD_HOURS or longer without
 * data, i.e. the auto-offline staleness rule applies to it.
 *
 * Staleness is measured from the later of:
 *   - the last real reading, and
 *   - the end (covered_until) of the newest "was actually running — failed to
 *     encode" attestation (ro_train_uptime_reports).
 *
 * Without the second term the RO log form stays locked right after the
 * operator files that attestation: filing it deliberately inserts NO reading
 * row (readings come in the next save, once the form unlocks), so the last
 * reading is still hours old and the form kept treating the train as
 * offline — demanding downtime reason / Back Online At for downtime that,
 * by the operator's own attestation, never happened.
 *
 * An attestation is not a reading and not a standing exemption: it only
 * vouches for the train up to covered_until, so the 2h clock restarts from
 * there and the train goes stale again if no reading follows.
 */
export function isReadingGapStale(
  lastReadingAt: string | null | undefined,
  attestedUntil: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const toMs = (v: string | null | undefined): number => {
    const t = v ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const latest = Math.max(toMs(lastReadingAt), toMs(attestedUntil));
  return latest === 0 || nowMs - latest >= TWO_HOURS_MS;
}
