/**
 * lib/format.ts
 * ═════════════
 * Single source of truth for all number and date formatting in the app.
 * Replaces the 8+ different inline patterns (toFixed, toLocaleString,
 * fmtNum helpers, etc.) with consistent typed helpers.
 *
 * Usage:
 *   import { fmtVol, fmtKwh, fmtDate, fmtDateTime } from '@/lib/format';
 */

// ── Locale / timezone ─────────────────────────────────────────────────────────
const PH_LOCALE  = 'en-PH';
const PH_TZ      = 'Asia/Manila';

// ── Number formatters ─────────────────────────────────────────────────────────

/** m³ volume — 0 decimals for large values, 1 for small */
export function fmtVol(n: number | null | undefined, unit = 'm³'): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const formatted = Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Volume without unit label — for table cells where unit is in the header */
export function fmtVolRaw(n: number | null | undefined): string {
  return fmtVol(n, '');
}

/** kWh / electrical energy */
export function fmtKwh(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }) + ' kWh';
}

/** kW power demand */
export function fmtKw(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }) + ' kW';
}

/** Percentage (0–100 range, not 0–1) */
export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + '%';
}

/** Philippine Peso */
export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₱' + Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** ppm (TDS, chlorine residual, etc.) */
export function fmtPpm(n: number | null | undefined): string {
  if (n == null) return '—';
  const decimals = Math.abs(n) < 10 ? 2 : 1;
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + ' ppm';
}

/** NTU (turbidity) */
export function fmtNtu(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' NTU';
}

/** psi (pressure) */
export function fmtPsi(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + ' psi';
}

/** pH — 2 decimal places, no unit */
export function fmtPh(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Temperature °C */
export function fmtTemp(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + ' °C';
}

/** Generic number with configurable decimals — replaces inline toFixed() calls */
export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return Number(n).toLocaleString(PH_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Compact: 1,234,567 → "1.2M", 12,345 → "12.3K" */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1)     + 'K';
  return fmtNum(n, 0);
}

/** Delta prefix: "+342 m³" or "-12 m³" */
export function fmtDelta(n: number | null | undefined, unit = 'm³'): string {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${fmtVol(n, unit)}`;
}

// ── Date / time formatters (all PHT) ─────────────────────────────────────────

/** "14 Jul 2026" */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(PH_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: PH_TZ,
  });
}

/** "14 Jul 2026 09:30" */
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(PH_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: PH_TZ,
  });
}

/** "09:30" */
export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString(PH_LOCALE, {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PH_TZ,
  });
}

/** "Jul 2026" — for chart x-axis labels */
export function fmtMonthYear(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(PH_LOCALE, {
    month: 'short', year: 'numeric', timeZone: PH_TZ,
  });
}

/**
 * "2026-07-14" — ISO date string in PHT (for DB date queries / chart
 * date-bucketing).
 *
 * Was previously implemented as:
 *   const pht = new Date(dt.toLocaleString('en-US', { timeZone: PH_TZ }));
 *   return pht.toISOString().slice(0, 10);
 * That round-trips through a locale string with NO timezone marker, so
 * `new Date(...)` re-parses it using the *runtime's own local timezone* —
 * it only produced the correct Manila date when the code happened to be
 * executing with a local timezone of UTC+0. For any other local timezone —
 * including Asia/Manila itself, the one this app is built for — it silently
 * shifted the bucketed date by up to a day. A reading logged at 04:46 AM
 * Manila time (~20:46 UTC the previous day) bucketed onto the wrong day
 * again for anyone whose device timezone is Asia/Manila, which is most of
 * this app's actual users — the exact "day early" bug this function was
 * originally written to fix, reappearing for the one timezone it exists for.
 * Confirmed via TZ=Asia/Manila node repro: old impl returned one day early;
 * this Intl.DateTimeFormat version doesn't depend on the runtime's local
 * timezone at all, so it's stable across every device regardless of where
 * the browser/server happens to think "local" is.
 */
export function fmtIsoDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(dt);
  const y = parts.find(p => p.type === 'year')?.value ?? '';
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  const day = parts.find(p => p.type === 'day')?.value ?? '';
  return y && m && day ? `${y}-${m}-${day}` : '';
}

/** "2 hours ago", "just now", etc. */
export function fmtRelative(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60)  return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60)  return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)   return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 7)   return `${day} day${day > 1 ? 's' : ''} ago`;
  return fmtDate(d);
}

/**
 * Tone + label for a "last reading" freshness badge: accent within a day,
 * warn 1–2 days, danger beyond that. Deliberately not called a "flag" —
 * that word already means the derived-locator review-flag workflow
 * (locator_derived_review_flags) elsewhere in this app. Shared by the
 * Operations entry card and the Plant detail asset card for the same
 * locator, so the two screens never disagree about how stale it is.
 */
export function lastReadingFreshness(d: string | Date | null | undefined): {
  tone: 'accent' | 'warn' | 'danger' | 'muted';
  label: string;
} {
  if (!d) return { tone: 'muted', label: 'No reading yet' };
  const hours = (Date.now() - new Date(d).getTime()) / 3_600_000;
  const tone = hours < 24 ? 'accent' : hours < 48 ? 'warn' : 'danger';
  return { tone, label: `Last reading: ${fmtRelative(d)}` };
}

// ── Toast message helpers ─────────────────────────────────────────────────────
// Standardizes save-confirmation messages across Operations, ROTrains, etc.

/** "MCWD-M1: saved · +342 m³  (1,761,551 → 1,761,893)" */
export function fmtSaveToast(
  entityName: string,
  action: 'saved' | 'updated',
  currentReading?: number | null,
  previousReading?: number | null,
  dailyVolume?: number | null,
): string {
  const deltaStr = dailyVolume != null
    ? ` · ${fmtDelta(dailyVolume)}`
    : '';
  const chainStr = previousReading != null && currentReading != null
    ? `  (${fmtNum(previousReading, 0)} → ${fmtNum(currentReading, 0)})`
    : '';
  return `${entityName}: ${action}${deltaStr}${chainStr}`;
}
