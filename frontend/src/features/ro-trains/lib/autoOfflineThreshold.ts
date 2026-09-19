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
