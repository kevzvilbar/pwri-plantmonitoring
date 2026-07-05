/**
 * readingGuards.ts
 *
 * Client-side guards that mirror the DB trigger logic so the UI can give
 * immediate feedback BEFORE hitting Supabase.
 *
 * Fix summary (from diagnostic report 2026-06-25):
 *  - Backward readings auto-tagged 'pending_review' — not saved as 'normal'
 *  - Spike readings (>2× 7-day avg flow rate) auto-tagged 'pending_review'
 *  - Per-user cooldown window (45 min) prevents SRP double-entry
 *  - previous_reading is always fetched from DB, never trusted from client state
 */

import { supabase } from '@/integrations/supabase/client';

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

/** Factor above the 7-day average flow rate that triggers a spike flag. */
export const SPIKE_MULTIPLIER = 2.0;

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
 * @param isMeterReplacement Whether to bypass backward check
 * @param isEstimated  Whether to bypass backward check
 * @param avgFlowRate  10-day average flow rate in m³/hr (pre-computed by caller)
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

  // ── 3. Backward reading check ─────────────────────────────────────────────
  if (
    prevReading !== null &&
    currentReading < prevReading &&
    !isMeterReplacement &&
    !isEstimated
  ) {
    const delta = currentReading - prevReading;
    return {
      status: 'pending_review',
      reason: 'backward',
      detail: `Reading ${currentReading.toLocaleString()} is ${Math.abs(delta).toLocaleString()} below last confirmed value (${prevReading.toLocaleString()}). Sent for supervisor review.`,
    };
  }

  // ── 4. Spike check ────────────────────────────────────────────────────────
  if (prevReading !== null && prevDt !== null && avgFlowRate !== null && avgFlowRate > 0) {
    const volume = currentReading - prevReading;
    const hoursElapsed =
      (readingDatetime.getTime() - prevDt.getTime()) / 3_600_000;

    if (hoursElapsed > 0 && volume > 0) {
      const currentFlowRate = volume / hoursElapsed;
      if (currentFlowRate > avgFlowRate * SPIKE_MULTIPLIER) {
        const pctAbove = Math.round((currentFlowRate / avgFlowRate - 1) * 100);
        return {
          status: 'pending_review',
          reason: 'spike',
          detail: `Flow rate ${currentFlowRate.toFixed(1)} m³/hr is ${pctAbove}% above the ${avgFlowRate.toFixed(1)} m³/hr average. Sent for supervisor review.`,
        };
      }
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
