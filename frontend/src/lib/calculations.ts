// Calculation utilities for PWRI operations

export const calc = {
  /**
   * current/previous: raw meter values.
   * isMeterRollover + meterMax: when the SAME meter wrapped around (not a
   * physical meter replacement), pass the wrap ceiling so the true delta
   * — (meterMax - previous) + current — is used instead of clamping a
   * spurious negative delta to zero.
   */
  dailyVolume: (
    current: number,
    previous: number,
    isMeterRollover = false,
    meterMax: number | null = null,
  ) => {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (isMeterRollover && Number.isFinite(meterMax as number)) {
      return Math.max(0, Math.round((meterMax as number) - previous + current));
    }
    return Math.max(0, Math.round(current - previous));
  },

  pressureDiff: (inlet: number, outlet: number) =>
    Number.isFinite(inlet) && Number.isFinite(outlet) ? +(inlet - outlet).toFixed(1) : null,

  recovery: (permFlow: number, feedFlow: number) =>
    feedFlow ? +((permFlow / feedFlow) * 100).toFixed(1) : null,

  rejection: (permTDS: number, rejectTDS: number) =>
    rejectTDS ? +((1 - permTDS / rejectTDS) * 100).toFixed(1) : null,

  saltPassage: (permTDS: number, rejectTDS: number) =>
    rejectTDS ? +((permTDS / rejectTDS) * 100).toFixed(1) : null,

  rejectFlow: (feedFlow: number, permFlow: number) =>
    Number.isFinite(feedFlow) && Number.isFinite(permFlow) ? +(feedFlow - permFlow).toFixed(2) : null,

  nrw: (production: number, consumption: number) =>
    production ? +(((production - consumption) / production) * 100).toFixed(1) : null,

  pvRatio: (kwh: number, m3: number) =>
    m3 ? +(kwh / m3).toFixed(2) : null,

  chemCost: (qty: number, unitPrice: number) =>
    +(qty * unitPrice).toFixed(2),
};

export const ALERTS = {
  dp_max: 40,
  permeate_tds_max: 600,
  permeate_ph_min: 6.5,
  permeate_ph_max: 8.5,
  recovery_min: 65,
  recovery_max: 75,
  // Well/locator readings do NOT use a constant here — they import
  // SPIKE_MULTIPLIER from lib/readingGuards.ts instead, because
  // fn_locator_reading_integrity (the DB trigger that's the actual source of
  // truth for locator pending_review) hardcodes 2.0 in SQL. A separate
  // 2.5 lived here until 2026-08-07 and was only ever used by the client-side
  // cosmetic banner — meaning a reading between 2.0x-2.5x average got
  // silently sent to pending_review by the DB with no warning ever shown to
  // the operator before Save. Product and blending have no DB trigger of
  // their own, so ALERTS remains the sole authority for them — hence two
  // separate, independently-tunable constants below instead of reviving one
  // shared name that different meter types would drift back out of sync on.
  product_spike_multiplier: 2.5,
  blending_spike_multiplier: 2.5,
  geofence_radius_m_default: 100,
  nrw_green_max: 13,
  nrw_amber_max: 16,

  // ── Pre-treatment differential pressure (psi) ──────────────────────────
  // Mirror the thresholds already used inline in PretreatmentAndROLog.tsx
  // (afmDp >= 40, cartridge/bag filter housing dpWarn >= 25) so the entry
  // form's warning colors and the Dashboard/notification alert feed agree
  // on the same numbers instead of drifting apart.
  pretreatment_afm_dp_max: 40,
  pretreatment_filter_housing_dp_max: 25,

  // ── Booster / HPP pump electrical (pump_readings: l1_amp/l2_amp/l3_amp,
  //    voltage) ─────────────────────────────────────────────────────────
  // No per-pump nameplate rating is stored anywhere in the schema, so a
  // single fixed amp/volt ceiling would be wrong for some pumps and useless
  // for others. Phase imbalance is used instead — it's scale-invariant
  // (works the same for a 5A pump and a 50A pump) and is a standard motor
  // protection signal: NEMA MG-1 treats >~10% current imbalance across a
  // 3-phase motor's phases as a bearing/insulation risk worth investigating.
  pump_phase_imbalance_warn_pct: 10,
  pump_phase_imbalance_critical_pct: 20,

  // Booster pump amperage entered on the routine pre-treatment form
  // (ro_pretreatment_readings.booster_pumps — one scalar amp reading per
  // unit, no phase breakdown) is flagged the same way the existing
  // permHighWarn permeate-meter check already works: current reading vs.
  // that SAME unit's immediately-prior reading, not an absolute ceiling.
  pretreatment_pump_amp_spike_multiplier: 1.6,

  // ── Power consumption rate ───────────────────────────────────────────────
  // Spike vs. the plant's own rolling average kWh/hr (same "beyond the
  // limit" shape as product_spike_multiplier/blending_spike_multiplier, kept
  // separate so power's threshold can be tuned independently of the water
  // meters).
  power_spike_multiplier: 2.0,

  // ── RO train meter deltas (feed/permeate/reject) ────────────────────────
  // Mirrors readingGuards.ts' SPIKE_MULTIPLIER (2.0x) so the live Dashboard
  // alert scan and the save-time guard in roReadingGuards.ts use the same
  // definition of "spike" as locator/well meters already do.
  ro_meter_spike_multiplier: 2.0,
};

// Haversine distance in meters
export function distanceMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isOffLocation(
  readLat: number, readLng: number,
  assetLat: number, assetLng: number,
  radiusM = ALERTS.geofence_radius_m_default,
): boolean {
  if (![readLat, readLng, assetLat, assetLng].every(Number.isFinite)) return false;
  return distanceMeters(readLat, readLng, assetLat, assetLng) > radiusM;
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not available'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function nrwColor(pct: number | null): 'accent' | 'warn' | 'danger' {
  if (pct === null) return 'accent';
  if (pct < ALERTS.nrw_green_max) return 'accent';
  if (pct < ALERTS.nrw_amber_max) return 'warn';
  return 'danger';
}
