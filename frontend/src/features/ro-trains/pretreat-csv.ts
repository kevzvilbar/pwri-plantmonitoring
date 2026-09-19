/**
 * ro-trains/pretreat-csv.ts
 *
 * CSV parsing, schema definition, and row-level validation for the Pre-Treatment
 * Readings CSV importer.
 *
 * The pre-treatment table stores five JSONB columns (afm_units, booster_pumps,
 * filter_housings, cartridge_filter_housings, mmf_readings) with a dynamic
 * number of units per train.  The CSV template uses a wide flat format —
 * afm1_in_psi … afm6_in_psi etc. — up to a fixed maximum.  Any column that is
 * blank for a row is treated as "unit not present" and omitted from the JSONB
 * array, so the template works for plants with fewer units without needing a
 * per-train variant.
 *
 * No React imports — pure functions, safe to use in non-component contexts.
 */

import { parseROCSVLine } from './csv';

// ─── Column-family maximums ───────────────────────────────────────────────────
// Set conservatively high.  Unused columns are simply left blank in the CSV.

const MAX_AFM     = 6;   // AFM/MMF units
const MAX_BOOSTER = 4;   // Booster pumps
const MAX_FILTER  = 4;   // Standard filter housings
const MAX_CART    = 4;   // Cartridge / bag filter housings

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parsePretreatCSVText(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseROCSVLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseROCSVLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
}

// ─── Schema string (for UI display) ──────────────────────────────────────────

export const PRETREAT_SCHEMA =
  'train_number*, reading_datetime* (YYYY-MM-DDTHH:mm), hpp_target_psi, bag_filters_changed, remarks, ' +
  'afm1_in_psi…afm6_in_psi, afm1_out_psi…afm6_out_psi, ' +
  'afm1_bw_start…afm6_bw_start (ISO datetime), afm1_bw_end…afm6_bw_end, ' +
  'mmf1_meter_start…mmf6_meter_start, mmf1_meter_end…mmf6_meter_end, ' +
  'booster1_hz…booster4_hz, booster1_amp…booster4_amp, booster1_target_psi…booster4_target_psi, ' +
  'cart1_in_psi…cart4_in_psi, cart1_out_psi…cart4_out_psi, ' +
  'filter1_in_psi…filter4_in_psi, filter1_out_psi…filter4_out_psi';

// ─── Template row ─────────────────────────────────────────────────────────────

function buildTemplateRow(): Record<string, string> {
  const r: Record<string, string> = {
    train_number:        '1',
    reading_datetime:    '2024-06-15T08:30',
    hpp_target_psi:      '850',
    bag_filters_changed: '0',
    remarks:             '',
  };
  // AFM/MMF units (MMF meter start/end shares the same unit numbering as AFM —
  // see ROTrains.tsx train.num_afm, which drives both together as one "AFM/MMF" group)
  for (let i = 1; i <= MAX_AFM; i++) {
    r[`afm${i}_in_psi`]        = i === 1 ? '45' : '';
    r[`afm${i}_out_psi`]       = i === 1 ? '40' : '';
    r[`afm${i}_bw_start`]      = '';
    r[`afm${i}_bw_end`]        = '';
    r[`mmf${i}_meter_start`]   = '';
    r[`mmf${i}_meter_end`]     = '';
  }
  // Booster pumps
  for (let i = 1; i <= MAX_BOOSTER; i++) {
    r[`booster${i}_hz`]          = i === 1 ? '50' : '';
    r[`booster${i}_amp`]         = i === 1 ? '12.5' : '';
    r[`booster${i}_target_psi`]  = '';
  }
  // Cartridge / bag housings
  for (let i = 1; i <= MAX_CART; i++) {
    r[`cart${i}_in_psi`]  = i === 1 ? '30' : '';
    r[`cart${i}_out_psi`] = i === 1 ? '28' : '';
  }
  // Filter housings
  for (let i = 1; i <= MAX_FILTER; i++) {
    r[`filter${i}_in_psi`]  = i === 1 ? '25' : '';
    r[`filter${i}_out_psi`] = i === 1 ? '22' : '';
  }
  return r;
}

export const PRETREAT_TEMPLATE_ROW = buildTemplateRow();

// ─── Flat CSV row → JSONB payload ─────────────────────────────────────────────

export interface ParsedPretreatRow {
  hpp_target_pressure_psi:    number | null;
  bag_filters_changed:        number;
  remarks:                    string | null;
  afm_units:                  any[];
  mmf_readings:               any[];
  booster_pumps:              any[];
  filter_housings:            any[];
  cartridge_filter_housings:  any[];
  /** Top-level (synchronized) backwash window — only set when every populated
   *  afm unit's backwash window agrees; otherwise null and the per-unit
   *  windows inside afm_units are the source of truth. */
  backwash_start:             string | null;
  backwash_end:               string | null;
}

export function parsePretreatRow(r: Record<string, string>): ParsedPretreatRow {
  const num = (k: string): number | null => (r[k]?.trim() ? +r[k] : null);

  // AFM/MMF units
  const afm_units: any[] = [];
  for (let i = 1; i <= MAX_AFM; i++) {
    const inP     = num(`afm${i}_in_psi`);
    const outP    = num(`afm${i}_out_psi`);
    const bwStart = r[`afm${i}_bw_start`]?.trim() || null;
    const bwEnd   = r[`afm${i}_bw_end`]?.trim() || null;
    const inBackwash = !!(bwStart || bwEnd);
    const dpPsi = inP != null && outP != null && !inBackwash ? +(inP - outP).toFixed(2) : null;
    if (inP != null || outP != null || inBackwash) {
      afm_units.push({
        unit:           i,
        in_psi:         inBackwash ? null : inP,
        out_psi:        inBackwash ? null : outP,
        dp_psi:         dpPsi,
        backwash_start: bwStart ? new Date(bwStart.replace(' ', 'T')).toISOString() : null,
        backwash_end:   bwEnd   ? new Date(bwEnd.replace(' ', 'T')).toISOString()   : null,
      });
    }
  }

  // MMF meter readings — separate JSONB column from afm_units, but same unit
  // numbering (see train.num_afm in ROTrains.tsx). Real shape: {unit, meter_start, meter_end}.
  const mmf_readings: any[] = [];
  for (let i = 1; i <= MAX_AFM; i++) {
    const meterStart = num(`mmf${i}_meter_start`);
    const meterEnd   = num(`mmf${i}_meter_end`);
    if (meterStart != null || meterEnd != null) {
      mmf_readings.push({ unit: i, meter_start: meterStart, meter_end: meterEnd });
    }
  }

  // Booster pumps
  const booster_pumps: any[] = [];
  for (let i = 1; i <= MAX_BOOSTER; i++) {
    const hz        = num(`booster${i}_hz`);
    const amp       = num(`booster${i}_amp`);
    const targetPsi = num(`booster${i}_target_psi`);
    if (hz != null || amp != null || targetPsi != null) {
      booster_pumps.push({
        unit:                i,
        target_hz:           hz,
        target_pressure_psi: targetPsi,
        hz_mode:             targetPsi == null,
        amperage:            amp,
      });
    }
  }

  // Filter housings
  const filter_housings: any[] = [];
  for (let i = 1; i <= MAX_FILTER; i++) {
    const inP  = num(`filter${i}_in_psi`);
    const outP = num(`filter${i}_out_psi`);
    if (inP != null || outP != null) filter_housings.push({ unit: i, in_psi: inP, out_psi: outP });
  }

  // Cartridge / bag filter housings
  const cartridge_filter_housings: any[] = [];
  for (let i = 1; i <= MAX_CART; i++) {
    const inP  = num(`cart${i}_in_psi`);
    const outP = num(`cart${i}_out_psi`);
    if (inP != null || outP != null) cartridge_filter_housings.push({ unit: i, in_psi: inP, out_psi: outP });
  }

  // Top-level backwash_start/backwash_end mirror ROTrains.tsx's "synchronized"
  // mode: only set when every unit that has a backwash window agrees on it.
  // TrainDetail.tsx reads this top-level pair for a whole-reading duration calc
  // in addition to the per-unit ones inside afm_units.
  const bwWindows = afm_units
    .filter((u) => u.backwash_start && u.backwash_end)
    .map((u) => `${u.backwash_start}|${u.backwash_end}`);
  const synchronized = bwWindows.length > 0 && bwWindows.every((w) => w === bwWindows[0]);
  const [syncStart, syncEnd] = synchronized ? bwWindows[0].split('|') : [null, null];

  return {
    hpp_target_pressure_psi:   num('hpp_target_psi'),
    bag_filters_changed:       num('bag_filters_changed') ?? 0,
    remarks:                   r.remarks?.trim() || null,
    afm_units,
    mmf_readings,
    booster_pumps,
    filter_housings,
    cartridge_filter_housings,
    backwash_start: syncStart,
    backwash_end:   syncEnd,
  };
}

// ─── Row validator ────────────────────────────────────────────────────────────

export function validatePretreatRow(r: Record<string, string>, rowNum: number): string[] {
  const e: string[] = [];

  if (!r.train_number?.trim() || isNaN(Number(r.train_number)))
    e.push(`Row ${rowNum}: train_number is required and must be a number`);

  if (!r.reading_datetime?.trim())
    e.push(`Row ${rowNum}: reading_datetime is required`);
  else if (isNaN(Date.parse(r.reading_datetime.trim().replace(' ', 'T'))))
    e.push(`Row ${rowNum}: reading_datetime is not a valid date/time`);

  const numericFields = [
    'hpp_target_psi', 'bag_filters_changed',
    ...Array.from({ length: MAX_AFM }, (_, i) => [`afm${i + 1}_in_psi`, `afm${i + 1}_out_psi`]).flat(),
    ...Array.from({ length: MAX_AFM }, (_, i) => [`mmf${i + 1}_meter_start`, `mmf${i + 1}_meter_end`]).flat(),
    ...Array.from({ length: MAX_BOOSTER }, (_, i) => [
      `booster${i + 1}_hz`, `booster${i + 1}_amp`, `booster${i + 1}_target_psi`,
    ]).flat(),
    ...Array.from({ length: MAX_FILTER }, (_, i) => [
      `filter${i + 1}_in_psi`, `filter${i + 1}_out_psi`,
    ]).flat(),
    ...Array.from({ length: MAX_CART }, (_, i) => [
      `cart${i + 1}_in_psi`, `cart${i + 1}_out_psi`,
    ]).flat(),
  ];

  for (const f of numericFields) {
    if (r[f]?.trim() && isNaN(Number(r[f])))
      e.push(`Row ${rowNum}: ${f} must be a number`);
  }

  for (let i = 1; i <= MAX_AFM; i++) {
    const start = r[`afm${i}_bw_start`]?.trim();
    const end   = r[`afm${i}_bw_end`]?.trim();
    if (start && isNaN(Date.parse(start.replace(' ', 'T'))))
      e.push(`Row ${rowNum}: afm${i}_bw_start is not a valid datetime`);
    if (end && isNaN(Date.parse(end.replace(' ', 'T'))))
      e.push(`Row ${rowNum}: afm${i}_bw_end is not a valid datetime`);
  }

  return e;
}
