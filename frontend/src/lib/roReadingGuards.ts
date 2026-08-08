/**
 * roReadingGuards.ts
 *
 * Spike / anomaly guards for data that readingGuards.ts doesn't cover:
 *  - ro_train_readings feed/permeate/reject meter deltas
 *  - pump_readings phase (L1/L2/L3) current + voltage imbalance
 *  - ro_pretreatment_readings booster pump amperage (single-scalar, no
 *    phase breakdown — flagged vs. its own prior reading instead)
 *
 * These are pure functions (no Supabase calls) so the exact same logic can
 * run in two places and never disagree:
 *   1. Save-time, in PretreatmentAndROLog.tsx — before a new reading is
 *      written, so the operator gets an immediate warning and the row can
 *      be marked norm_status='pending_review'.
 *   2. Read-time, in Dashboard.tsx — scanning rows already sitting in the
 *      DB (including ones written before this guard existed, or written by
 *      CSV import which has no client-side guard at all) so they still
 *      surface in the notification bell.
 *
 * Root-cause example this is built to catch: an operator mis-keys a
 * cumulative meter reading (e.g. 2,153,677 instead of ~660,977), producing
 * a delta of 1,493,203 m3 and an implied flow rate of 409,096.71 m3/h.
 * Nothing in the app currently rejects, warns loudly on, or flags that for
 * review — it silently becomes the new "previous reading" baseline too.
 *
 * 2026-08-07: evaluateROMeterSpike rewritten to compare a FLOW RATE (delta ÷
 * hours elapsed) against a real rolling average rate, not a raw delta
 * against the single immediately-prior delta. The old version had two
 * compounding problems, visible in the "RO3 — Reject meter delta 200 m³ is
 * 525% above the prior reading's 32 m³" alert this was built to fix:
 *   1. No time normalization — comparing two deltas directly only makes
 *      sense if both readings covered the same elapsed time. A 200 m³
 *      delta over 48 hours and a 32 m³ delta over 6 hours are actually
 *      *closer* in rate (4.2 m³/hr vs 5.3 m³/hr) than the raw "525% above"
 *      framing suggests.
 *   2. Comparing to a single prior point, not an average — if that one
 *      prior reading happened to be an unusually low outlier, every normal
 *      reading afterward looks like a false spike by comparison. A rolling
 *      average absorbs one-off low readings instead of anchoring on them.
 * See flowRateGuards.ts, which this now delegates to (same module every
 * other odometer input in the app uses), and the ±50% 'needs_remark' tier
 * PretreatmentAndROLog.tsx now also applies on top of this 'critical' tier.
 */

import { ALERTS } from './calculations';
import {
  computeRate, computeRollingAverageRate, classifyDeviation,
  type RatePoint, type DeviationResult,
} from './flowRateGuards';

export type ROMeterKind = 'feed' | 'permeate' | 'reject';

const METER_LABEL: Record<ROMeterKind, string> = {
  feed: 'Feed',
  permeate: 'Permeate',
  reject: 'Reject',
};

/**
 * 10-day rolling average flow rate (m³/hr) for one train's meter, built from
 * a chronological series of cumulative snapshots — same pairwise-rate
 * pattern as Locator/Well (computeRollingAverageRate), just fed from
 * ro_train_readings instead. Exported so PretreatmentAndROLog.tsx and
 * Dashboard.tsx both build this the same way from whatever history they've
 * each already queried.
 */
export function computeROAverageFlowRate(points: RatePoint[], windowDays: number = 10): number | null {
  return computeRollingAverageRate(points, windowDays);
}

/**
 * Classifies a newly computed meter delta against the train's own rolling
 * average flow rate for that meter. Returns the full DeviationResult (same
 * shape flowRateGuards.classifyDeviation returns everywhere else) plus a
 * ready-to-render detail string and the meter's display label.
 *
 * currentDelta/hoursElapsed replace the old currentDelta/referenceDelta pair
 * — pass the elapsed time between this reading and the previous one for the
 * SAME meter (PretreatmentAndROLog.tsx already computes this as
 * autoDurationMin for the cooldown display; reuse it here, ÷60 for hours).
 */
export function evaluateROMeterSpike(
  kind: ROMeterKind,
  currentDelta: number | null,
  hoursElapsed: number | null,
  avgFlowRate: number | null,
  multiplier: number = ALERTS.ro_meter_spike_multiplier,
): DeviationResult & { label: string; detail: string } {
  const label = METER_LABEL[kind];
  const rate = computeRate(currentDelta, hoursElapsed);
  const result = classifyDeviation(rate, avgFlowRate, multiplier);
  if (result.tier === 'ok') return { ...result, label, detail: '' };

  const verb = result.direction === 'high' ? 'above' : 'below';
  const detail = result.tier === 'critical'
    ? `${label} flow rate ${result.rate!.toFixed(1)} m³/hr is ${result.deviationPct}% ${verb} the 10-day average (${result.avgRate!.toFixed(1)} m³/hr) — check for a mis-keyed meter value.`
    : `${label} flow rate ${result.rate!.toFixed(1)} m³/hr is ${result.deviationPct}% ${verb} the 10-day average (${result.avgRate!.toFixed(1)} m³/hr) — remark required before saving.`;
  return { ...result, label, detail };
}

export interface PhaseImbalanceResult {
  /** (max-min)/avg as a percentage. Null when fewer than 2 phases have data. */
  pct: number | null;
  tier: 'ok' | 'warning' | 'critical';
}

/**
 * Current or voltage imbalance across L1/L2/L3. Scale-invariant (percentage
 * of the phase average), so it works the same regardless of pump size or
 * nameplate rating — neither of which is stored anywhere in this schema.
 */
export function evaluatePhaseImbalance(
  l1: number | null | undefined,
  l2: number | null | undefined,
  l3: number | null | undefined,
): PhaseImbalanceResult {
  const vals = [l1, l2, l3].filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (vals.length < 2) return { pct: null, tier: 'ok' };
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg <= 0) return { pct: null, tier: 'ok' };
  const pct = ((max - min) / avg) * 100;
  const tier: PhaseImbalanceResult['tier'] =
    pct >= ALERTS.pump_phase_imbalance_critical_pct ? 'critical' :
    pct >= ALERTS.pump_phase_imbalance_warn_pct ? 'warning' : 'ok';
  return { pct, tier };
}

/**
 * Single-phasing / phase-loss check: one or two phases reading ~0 while the
 * others are clearly energized. A real (if less common) motor-protection
 * concern distinct from imbalance, and cheap to check from the same data.
 */
export function evaluatePhaseLoss(
  l1: number | null | undefined,
  l2: number | null | undefined,
  l3: number | null | undefined,
  runningThresholdAmps = 2,
): boolean {
  const vals = [l1, l2, l3].map((v) => (v != null && Number.isFinite(v) ? v : 0));
  const running = vals.filter((v) => v >= runningThresholdAmps);
  const dead = vals.filter((v) => v < runningThresholdAmps);
  return running.length > 0 && dead.length > 0 && running.length < 3;
}

/** Differential pressure across an inlet/outlet pair (psi), rounded like the rest of the app. */
export function dpPsi(inlet: number | null | undefined, outlet: number | null | undefined): number | null {
  if (inlet == null || outlet == null || !Number.isFinite(inlet) || !Number.isFinite(outlet)) return null;
  return +(inlet - outlet).toFixed(2);
}
