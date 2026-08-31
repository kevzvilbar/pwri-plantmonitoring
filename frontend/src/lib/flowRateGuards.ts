/**
 * flowRateGuards.ts
 *
 * Single source of truth for "is this odometer reading normal" across every
 * cumulative-meter input in the app — locators, wells, product meters,
 * blending events, power meters, and RO train feed/permeate/reject meters.
 *
 * Replaces comparing a raw volume/kWh delta directly against a reference
 * value. A raw delta has a direct relationship with the elapsed time
 * between readings, so the exact same delta means something completely
 * different after a 6-hour gap than after a 3-day gap — and it silently
 * breaks whenever a date in between has no reading at all. Every comparison
 * here is done on RATE (volume or kWh per hour — or per day for the one
 * data source, blending_events, that only stores a date, not a timestamp)
 * instead, which is what's actually comparable across readings taken at
 * different intervals.
 *
 * Two tiers, both measured as % deviation from the entity's own rolling
 * average rate:
 *
 *   - 'needs_remark' — outside ANOMALY_REMARK_BAND_PCT (±50%) of average,
 *     in EITHER direction. New requirement: the operator must type a
 *     remark before the reading can be saved (see reading_anomaly_remarks,
 *     supabase/migrations/20260807_reading_anomaly_remarks.sql). Nothing
 *     analogous existed before for "way lower than average" — only "way
 *     higher" was ever flagged anywhere in the app.
 *
 *   - 'critical' — outside the stricter, per-meter-type multiplier that
 *     already existed (readingGuards.ts' SPIKE_MULTIPLIER for well/locator —
 *     matching the fn_locator_reading_integrity DB trigger — plus ALERTS'
 *     product_spike_multiplier / blending_spike_multiplier /
 *     power_spike_multiplier / ro_meter_spike_multiplier — see
 *     calculations.ts). Deliberately NOT
 *     collapsed into one shared number: a stable RO permeate flow and a
 *     demand-driven well have different natural variance, so forcing one
 *     multiplier onto both would either miss real spikes on the stable one
 *     or nag constantly on the noisy one. What IS unified here is the SHAPE
 *     of the rule, the message text, and the remark requirement — every
 *     'critical' reading also satisfies 'needs_remark' by construction, so
 *     callers never have to special-case "critical but no remark needed".
 *
 *     'critical' is deliberately high-side only, matching every existing
 *     spike threshold in this codebase (all framed as "X× above average" —
 *     there has never been a symmetric auto-escalating "critical low"
 *     anywhere in the app). Unusually LOW readings land in 'needs_remark'
 *     (operator explains) but don't auto-escalate to pending_review the way
 *     unusually HIGH ones do. If that's wrong for some meter type, it's a
 *     one-line change in classifyDeviation — call it out per-page rather
 *     than baking in a silent app-wide assumption.
 */

export type AnomalyTier = 'ok' | 'needs_remark' | 'critical';
export type AnomalyDirection = 'high' | 'low' | null;
export type RateUnit = 'm3/hr' | 'm3/day' | 'kwh/hr';

/** ±75% around the average rate is normal variance. Beyond it, in either
 *  direction, the operator must explain why before saving. */
export const ANOMALY_REMARK_BAND_PCT = 75;

/** Minimum elapsed time before a rate is trusted at all. Two readings taken
 *  closer together than this produce a rate whose denominator is close to
 *  zero — amplifying timing noise into a false spike or crash. Below this
 *  floor the rate is treated as not computable, same as having no history. */
export const MIN_ELAPSED_HOURS = 0.5; // 30 minutes

/** Same idea as MIN_ELAPSED_HOURS, for the one source (blending_events)
 *  that only has day-level granularity, not a timestamp. */
export const MIN_ELAPSED_DAYS = 1;

export interface RatePoint {
  /** Cumulative meter value at this snapshot. */
  value: number;
  at: Date;
}

export interface DeviationResult {
  tier: AnomalyTier;
  direction: AnomalyDirection;
  /** Current computed rate. Null when not computable (gap too small, first reading, etc). */
  rate: number | null;
  /** Rolling average rate being compared against. Null when there's no usable history yet. */
  avgRate: number | null;
  /** Roughly |rate/avgRate - 1| × 100, rounded. Null whenever rate or avgRate is null. */
  deviationPct: number | null;
}

/**
 * Volume (or kWh) per hour between two odometer snapshots. Returns null —
 * rather than a huge or meaningless number — when the pair can't produce a
 * trustworthy rate: non-positive volume, non-positive elapsed time, or
 * elapsed time under the minimum floor.
 */
export function computeRate(
  volume: number | null,
  elapsed: number | null,
  minElapsed: number = MIN_ELAPSED_HOURS,
  allowNegative: boolean = false,
): number | null {
  if (volume == null || elapsed == null) return null;
  if (!Number.isFinite(volume) || !Number.isFinite(elapsed)) return null;
  if (!allowNegative && volume <= 0) return null;
  if (elapsed < minElapsed) return null;
  return volume / elapsed;
}

/**
 * Rolling average rate across a chronological series of cumulative-meter
 * snapshots. Computes a rate for each consecutive pair (skipping pairs that
 * fail computeRate's sanity floor) and averages those per-pair rates —
 * NOT a simple average of raw per-reading deltas. A gap day contributes one
 * rate covering the whole gap, never a false "zero" for the missing day,
 * which is exactly the assumption that made the old per-page checks fragile.
 *
 * windowDays filters which snapshots are considered before pairing, not
 * after, so every pair used is a real consecutive pair inside the window —
 * never a pair straddling the window boundary against a point outside it.
 */
export function computeRollingAverageRate(
  points: RatePoint[],
  windowDays: number,
  minElapsed: number = MIN_ELAPSED_HOURS,
  elapsedUnitMs: number = 3_600_000, // hours by default; pass 86_400_000 for day-granularity sources
): number | null {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sorted = points
    .filter((p) => p.at >= since)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const rates: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const volume = sorted[i].value - sorted[i - 1].value;
    const elapsed = (sorted[i].at.getTime() - sorted[i - 1].at.getTime()) / elapsedUnitMs;
    const rate = computeRate(volume, elapsed, minElapsed, false);
    if (rate != null) rates.push(rate);
  }
  if (!rates.length) return null;
  return rates.reduce((s, n) => s + n, 0) / rates.length;
}

export interface VolumePoint {
  /** The period's own volume (already a delta, NOT a cumulative meter value). */
  volume: number;
  /** When that period ended. */
  at: Date;
}

/**
 * Same as computeRollingAverageRate, for sources (product meters, locators)
 * that persist a delta directly into the DB (`daily_volume`) rather than
 * requiring a diff of cumulative meter readings. Each point is already a
 * single period's volume, so unlike computeRollingAverageRate there is no
 * diff to take here, only an elapsed time to divide by.
 *
 * Each point's rate is volume ÷ (this point's timestamp − the PREVIOUS
 * point's timestamp), i.e. "how long was the period this volume covers",
 * not a difference between two volumes. This is the fix for exactly the
 * bug this module exists for: the previous per-page logic averaged these
 * volumes directly, silently assuming every one of them covered exactly one
 * day — which breaks the moment a date has no reading and the next entry's
 * stored volume actually covers a longer span.
 */
export function computeRollingAverageRateFromDeltas(
  points: VolumePoint[],
  windowDays: number,
  minElapsed: number = MIN_ELAPSED_HOURS,
  elapsedUnitMs: number = 3_600_000,
): number | null {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sorted = points
    .filter((p) => p.at >= since)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const rates: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const elapsed = (sorted[i].at.getTime() - sorted[i - 1].at.getTime()) / elapsedUnitMs;
    const rate = computeRate(sorted[i].volume, elapsed, minElapsed, false);
    if (rate != null) rates.push(rate);
  }
  if (!rates.length) return null;
  return rates.reduce((s, n) => s + n, 0) / rates.length;
}

/**
 * Classifies a current rate against its rolling average into
 * 'ok' / 'needs_remark' / 'critical', with direction and % deviation.
 *
 * criticalMultiplier is the existing per-meter-type threshold (2.5 for
 * well/locator/product/blending, 2.0 for power/RO — see ALERTS in
 * calculations.ts) expressed exactly the way it already is app-wide
 * (average × multiplier = the ceiling), so no existing constant has to
 * change shape — every page just routes its multiplier through this one
 * function instead of its own inline comparison.
 */
export function classifyDeviation(
  rate: number | null,
  avgRate: number | null,
  criticalMultiplier: number,
): DeviationResult {
  if (rate == null) {
    return { tier: 'ok', direction: null, rate, avgRate, deviationPct: null };
  }

  // Handle backward / negative flow (e.g. entered 58,936 instead of 589,360 or meter rollover)
  if (rate < 0) {
    const devPct = avgRate != null && avgRate > 0
      ? Math.round(Math.abs(rate / avgRate - 1) * 100)
      : 100;
    return {
      tier: 'critical',
      direction: 'low',
      rate,
      avgRate,
      deviationPct: devPct,
    };
  }

  if (avgRate == null || avgRate <= 0) {
    return { tier: 'ok', direction: null, rate, avgRate, deviationPct: null };
  }

  const ratio = rate / avgRate;
  const remarkBandRatio = ANOMALY_REMARK_BAND_PCT / 100; // 0.5
  const withinBand = ratio >= 1 - remarkBandRatio && ratio <= 1 + remarkBandRatio;
  if (withinBand) {
    return { tier: 'ok', direction: null, rate, avgRate, deviationPct: null };
  }

  const direction: AnomalyDirection = ratio >= 1 ? 'high' : 'low';
  const deviationPct = Math.round(Math.abs(ratio - 1) * 100);
  const tier: AnomalyTier =
    direction === 'high' && ratio > criticalMultiplier ? 'critical' : 'needs_remark';

  return { tier, direction, rate, avgRate, deviationPct };
}

const UNIT_LABEL: Record<RateUnit, string> = {
  'm3/hr': 'm³/hr',
  'm3/day': 'm³/day',
  'kwh/hr': 'kWh/hr',
};

/**
 * One shared message template, used by every page — replaces four
 * previously-separate, slightly-different hand-written strings
 * (LocatorSection, WellSection, ProductSection, BlendingSection) plus the
 * RO / power ones, so the wording an operator sees is identical everywhere.
 *
 * escalates controls the 'critical' tier's trailing sentence: true (default)
 * when this reading actually gets auto-flagged pending_review for a
 * supervisor (locator/well/product/RO all have that column and an existing
 * review pipeline for it — see DataCorrections.tsx / PendingReviewCard.tsx).
 * Pass false for tables that have no such column or pipeline (blending_events,
 * power_readings) so the message doesn't promise a review that won't happen —
 * "critical" there still means stronger visual severity + a remark is still
 * required, just without the auto-escalation consequence.
 */
export function formatDeviationMessage(
  label: string,
  result: DeviationResult,
  unit: RateUnit,
  windowDays: number,
  escalates: boolean = true,
): string {
  if (result.tier === 'ok' || result.rate == null || result.deviationPct == null) {
    return '';
  }
  const u = UNIT_LABEL[unit];
  const noun = unit === 'kwh/hr' ? 'rate' : 'flow rate';

  if (result.rate < 0) {
    return `${label} reading is below previous (negative ${noun} ${result.rate.toFixed(1)} ${u}). If this meter requires a ×10 multiplier or experienced rollover/replacement, verify and explain — remark required before saving.`;
  }

  if (result.avgRate == null) return '';

  const verb = result.direction === 'high' ? 'above' : 'below';
  const base = `${label} ${noun} ${result.rate.toFixed(1)} ${u} is ${result.deviationPct}% ${verb} the ${windowDays}-day average (${result.avgRate.toFixed(1)} ${u})`;
  if (result.tier !== 'critical') return `${base} — remark required before saving.`;
  return escalates
    ? `${base} — sent for supervisor review.`
    : `${base} — please double-check before saving.`;
}
