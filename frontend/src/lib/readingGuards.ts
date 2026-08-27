/**
 * readingGuards.ts
 *
 * Client-side guards that mirror the DB trigger logic so the UI can give
 * immediate feedback BEFORE hitting Supabase.
 *
 * Fix summary (from diagnostic report 2026-06-25):
 *  - Backward readings auto-tagged 'pending_review' — not saved as 'normal'
 *  - Spike readings (>2× 10-day avg flow rate) auto-tagged 'pending_review'
 *  - Per-user cooldown window (45 min) prevents SRP double-entry
 *  - previous_reading is always fetched from DB, never trusted from client state
 *
 * 2026-08-07: spike math delegated to lib/flowRateGuards.ts (shared with
 * every other odometer input — well/locator/product/blending/power/RO —
 * instead of being computed inline here only). See that module's header for
 * why raw delta comparisons were replaced with flow-rate comparisons
 * app-wide, and for the new ±50% 'needs_remark' tier each page now also
 * evaluates client-side alongside this function.
 */

import { supabase } from '@/integrations/supabase/client';
import { computeRate, classifyDeviation, formatDeviationMessage } from './flowRateGuards';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReadingEntityType = 'locator' | 'well';

export type GuardResult =
  | { status: 'ok' }
  | { status: 'pending_review'; reason: 'backward' | 'spike'; detail: string }
  | { status: 'blocked'; reason: 'cooldown'; minutesLeft: number; availableAt: Date }
  | { status: 'blocked'; reason: 'duplicate'; detail: string };

// ── Constants ────────────────────────────────────────────────────────────────

/** Minutes a user must wait between readings for the same locator. */
export const LOCATOR_COOLDOWN_MINUTES = 45;

/**
 * Factor above the 10-day average flow rate that triggers a 'critical' spike
 * flag (auto pending_review). Mirrors fn_locator_reading_integrity's
 * hardcoded 2.0 in the DB trigger — if that SQL function's threshold is ever
 * changed, change it here too, and vice versa, since well_readings has no
 * equivalent DB trigger and relies on this value alone.
 *
 * LocatorSection.tsx and WellSection.tsx import this SAME constant for their
 * reactive client-side banner (via classifyDeviation) instead of a separately
 * tuned value, so what the operator is warned about before Save and what the
 * DB actually does at Save can't drift apart again.
 */
export const SPIKE_MULTIPLIER = 2.0;

/**
 * Hours within which an IDENTICAL current_reading value (vs. the last
 * confirmed good reading) is treated as an accidental double-submission and
 * blocked outright, rather than saved with a 0 daily_volume. 'raw'
 * (cumulative) mode only — see the duplicate-value check below for why.
 */
export const DUPLICATE_VALUE_WINDOW_HOURS = 12;

// ── Core guard ───────────────────────────────────────────────────────────────

/**
 * Evaluates whether a proposed reading should be saved as 'normal',
 * 'pending_review', or blocked entirely.
 *
 * @param entityType   'locator' or 'well'
 * @param entityId     locator_id or well_id (UUID)
 * @param plantId      plant_id (UUID)
 * @param userId       recorded_by (UUID)
 * @param currentReading  The meter value the operator just typed
 * @param readingDatetime ISO string for the reading timestamp
 * @param isMeterReplacement Whether to bypass backward check (new physical meter installed)
 * @param isEstimated  Whether to bypass backward check
 * @param avgFlowRate  10-day average flow rate in m³/hr (pre-computed by caller)
 * @param isMeterRollover Whether to bypass backward check because the SAME
 *   meter wrapped around (e.g. 99999 -> 00012), distinct from a physical
 *   meter replacement. When true, the caller is responsible for also
 *   persisting is_meter_rollover=true and meter_rollover_max on the saved
 *   row so daily_volume is computed from the true wrap delta instead of
 *   being clamped to zero.
 * @param inputMode 'raw' (default) = currentReading is a cumulative totalizer,
 *   so a lower value than the last confirmed reading is a real anomaly
 *   ("backward"). 'direct' = currentReading already IS the period's volume
 *   (e.g. HAMAS) — a lower value than yesterday is ordinary day-to-day
 *   variation, not a fault, so the backward check is skipped entirely, and
 *   the spike check compares the volume itself (not a reading-to-reading
 *   diff) against the average.
 */
export async function evaluateReadingGuard(
  entityType: ReadingEntityType,
  entityId: string,
  plantId: string,
  userId: string,
  currentReading: number,
  readingDatetime: Date,
  isMeterReplacement = false,
  isEstimated = false,
  avgFlowRate: number | null = null,
  isMeterRollover = false,
  inputMode: 'raw' | 'direct' = 'raw',
): Promise<GuardResult> {
  const table = entityType === 'locator' ? 'locator_readings' : 'well_readings';
  const entityCol = entityType === 'locator' ? 'locator_id' : 'well_id';

  // ── 1. Cooldown check (per user, per entity) ──────────────────────────────
  const { data: recentUserEntry } = await (supabase
    .from(table as any)
    .select('reading_datetime')
    .eq(entityCol, entityId)
    .eq('plant_id', plantId)
    .eq('recorded_by', userId)
    .not('norm_status', 'in', '("retracted")')
    .order('reading_datetime', { ascending: false })
    .limit(1) as any);

  if (recentUserEntry?.length) {
    const lastDt = new Date(recentUserEntry[0].reading_datetime);
    const minutesElapsed = (readingDatetime.getTime() - lastDt.getTime()) / 60_000;
    const minutesLeft = Math.ceil(LOCATOR_COOLDOWN_MINUTES - minutesElapsed);
    if (minutesLeft > 0) {
      const availableAt = new Date(lastDt.getTime() + LOCATOR_COOLDOWN_MINUTES * 60_000);
      return { status: 'blocked', reason: 'cooldown', minutesLeft, availableAt };
    }
  }

  // ── 2. Fetch last good reading (non-retracted, non-pending_review) ────────
  const { data: lastGood } = await (supabase
    .from(table as any)
    .select('current_reading, reading_datetime')
    .eq(entityCol, entityId)
    .eq('plant_id', plantId)
    .not('norm_status', 'in', '("retracted","pending_review")')
    .lt('reading_datetime', readingDatetime.toISOString())
    .order('reading_datetime', { ascending: false })
    .limit(1) as any);

  const prevReading: number | null = lastGood?.length ? Number(lastGood[0].current_reading) : null;
  const prevDt: Date | null = lastGood?.length ? new Date(lastGood[0].reading_datetime) : null;

  // ── 3. Duplicate-value check — 'raw' (cumulative) mode only ───────────────
  // A meter reading that's IDENTICAL to the last confirmed value within
  // DUPLICATE_VALUE_WINDOW_HOURS is virtually always an accidental
  // double-submission (screen resubmitted, same value copied from the log
  // sheet, etc.) rather than a genuine zero-flow period — a live meter
  // essentially never holds the exact same cumulative value for 12 straight
  // hours. Blocked outright (not sent to pending_review, unlike backward/
  // spike below): it produces daily_volume = 0 by definition, so there's
  // nothing for a supervisor to approve — the operator just needs to
  // re-check the meter and enter the real value, or the actual timestamp.
  //
  // Skipped for 'direct' mode (currentReading already IS a period's volume,
  // e.g. HAMAS — the same day-volume repeating is ordinary, not a fault) and
  // for the same explicit-override flags the backward check below skips:
  // meter replacement / rollover, where a value coincidentally matching the
  // old meter's last reading is a known special case, not an error.
  if (
    inputMode === 'raw' &&
    prevReading !== null &&
    prevDt !== null &&
    currentReading === prevReading &&
    !isMeterReplacement &&
    !isEstimated &&
    !isMeterRollover
  ) {
    const hoursElapsed = (readingDatetime.getTime() - prevDt.getTime()) / 3_600_000;
    if (hoursElapsed < DUPLICATE_VALUE_WINDOW_HOURS) {
      const elapsedLabel = hoursElapsed < 1
        ? `${Math.max(1, Math.round(hoursElapsed * 60))} min`
        : `${Math.round(hoursElapsed)} hr`;
      return {
        status: 'blocked',
        reason: 'duplicate',
        detail: `Reading ${currentReading.toLocaleString()} is identical to the value recorded ${elapsedLabel} ago — that would record zero flow. Double-check the meter before saving.`,
      };
    }
  }

  // ── 4. Backward reading check — 'raw' (cumulative) mode only ──────────────
  // For 'direct' mode, currentReading already IS the period's volume, so a
  // lower value than yesterday is ordinary day-to-day variation, not a fault.
  if (
    inputMode === 'raw' &&
    prevReading !== null &&
    currentReading < prevReading &&
    !isMeterReplacement &&
    !isEstimated &&
    !isMeterRollover
  ) {
    const delta = currentReading - prevReading;
    return {
      status: 'pending_review',
      reason: 'backward',
      detail: `Reading ${currentReading.toLocaleString()} is ${Math.abs(delta).toLocaleString()} below last confirmed value (${prevReading.toLocaleString()}). Sent for supervisor review.`,
    };
  }

  // ── 5. Spike check ────────────────────────────────────────────────────────
  // Routed through the shared classifier (flowRateGuards.ts) so this DB-round-
  // trip guard and each page's own reactive cosmetic banner can never drift
  // apart the way they used to (the banner was comparing against
  // ALERTS.avg_multiplier_warn = 2.5 while this — and the DB trigger,
  // fn_locator_reading_integrity — actually used SPIKE_MULTIPLIER = 2.0, so a
  // reading between 2.0x-2.5x got silently sent to pending_review with no
  // warning ever shown before Save). Only the 'critical' tier is surfaced
  // here — the new ±50% 'needs_remark' tier doesn't need a network round
  // trip and is evaluated client-side, reactively, before the operator even
  // reaches Save (see LocatorSection.tsx / WellSection.tsx).
  if (inputMode === 'direct') {
    // currentReading already IS the period's volume, one self-contained
    // reading = one period — no reading-to-reading diff/elapsed-time to
    // compute, so it's compared to the average directly.
    const result = classifyDeviation(currentReading, avgFlowRate, SPIKE_MULTIPLIER);
    if (result.tier === 'critical') {
      return {
        status: 'pending_review',
        reason: 'spike',
        detail: formatDeviationMessage('Reading', result, 'm3/day', 10),
      };
    }
  } else if (prevReading !== null && prevDt !== null) {
    const volume = currentReading - prevReading;
    const hoursElapsed = (readingDatetime.getTime() - prevDt.getTime()) / 3_600_000;
    const rate = computeRate(volume, hoursElapsed);
    const result = classifyDeviation(rate, avgFlowRate, SPIKE_MULTIPLIER);
    if (result.tier === 'critical') {
      return {
        status: 'pending_review',
        reason: 'spike',
        detail: formatDeviationMessage('Reading', result, 'm3/hr', 10),
      };
    }
  }

  return { status: 'ok' };
}

/**
 * Returns the effective previous_reading from the DB — the value the trigger
 * will also use. Calling this on the frontend lets the UI show the correct
 * computed delta BEFORE the server responds.
 */
export async function fetchLastGoodReading(
  entityType: ReadingEntityType,
  entityId: string,
  plantId: string,
  beforeDatetime: Date,
): Promise<{ reading: number | null; dt: Date | null }> {
  const table = entityType === 'locator' ? 'locator_readings' : 'well_readings';
  const entityCol = entityType === 'locator' ? 'locator_id' : 'well_id';

  const { data } = await (supabase
    .from(table as any)
    .select('current_reading, reading_datetime')
    .eq(entityCol, entityId)
    .eq('plant_id', plantId)
    .not('norm_status', 'in', '("retracted","pending_review")')
    .lt('reading_datetime', beforeDatetime.toISOString())
    .order('reading_datetime', { ascending: false })
    .limit(1) as any);

  if (!data?.length) return { reading: null, dt: null };
  return {
    reading: Number(data[0].current_reading),
    dt: new Date(data[0].reading_datetime),
  };
}

/**
 * Formats a cooldown countdown as a human-readable string.
 * e.g. 45 → "45 min", 90 → "1 hr 30 min"
 */
export function formatCooldown(minutesLeft: number): string {
  if (minutesLeft < 60) return `${minutesLeft} min`;
  const h = Math.floor(minutesLeft / 60);
  const m = minutesLeft % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}
