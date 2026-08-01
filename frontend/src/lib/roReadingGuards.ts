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
 */

import { ALERTS } from './calculations';

export type ROMeterKind = 'feed' | 'permeate' | 'reject';

export interface ROMeterSpikeResult {
  isSpike: boolean;
  /** current delta ÷ reference delta. Null when not computable. */
  multiple: number | null;
  label: string;
  detail: string;
}

const METER_LABEL: Record<ROMeterKind, string> = {
  feed: 'Feed',
  permeate: 'Permeate',
  reject: 'Reject',
};

/**
 * Compares a newly computed meter delta (this reading minus the previous
 * odometer snapshot) against a reference delta — normally the immediately
 * prior confirmed delta for the same train + meter, the same "vs. last
 * time" comparison PretreatmentAndROLog.tsx already does for permeate
 * (permHighWarn), just factored out so Dashboard can reuse it for
 * already-saved rows and for feed/reject too.
 *
 * Deliberately conservative: only fires when the reference delta itself is
 * a real, positive, non-trivial value, so a train that happened to be near
 * zero on the prior reading doesn't produce a false "spike" on every
 * reading afterward.
 */
export function evaluateROMeterSpike(
  kind: ROMeterKind,
  currentDelta: number | null,
  referenceDelta: number | null,
  multiplier: number = ALERTS.ro_meter_spike_multiplier,
): ROMeterSpikeResult {
  const label = METER_LABEL[kind];
  if (
    currentDelta == null || referenceDelta == null ||
    !Number.isFinite(currentDelta) || !Number.isFinite(referenceDelta) ||
    referenceDelta <= 0 || currentDelta <= 0
  ) {
    return { isSpike: false, multiple: null, label, detail: '' };
  }
  const multiple = currentDelta / referenceDelta;
  const isSpike = multiple > multiplier;
  return {
    isSpike,
    multiple,
    label,
    detail: isSpike
      ? `${label} meter delta ${Math.round(currentDelta).toLocaleString()} m³ is ${Math.round((multiple - 1) * 100)}% above the prior reading's ${Math.round(referenceDelta).toLocaleString()} m³ — check for a mis-keyed meter value.`
      : '',
  };
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
