/**
 * ro-trains/csv.ts
 *
 * CSV parsing, schema definition, and row-level validation for the RO Train
 * Readings CSV importer.  Extracted from ROTrains.tsx (§4 item 2 decomposition).
 *
 * No React imports — pure functions, safe to use in non-component contexts.
 */

// ─── Low-level CSV parser ─────────────────────────────────────────────────────

export function parseROCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (line[i] === '"') {
      i++;
      let val = '';
      while (i < len) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { val += line[i++]; }
      }
      fields.push(val.trim());
      if (i < len && line[i] === ',') i++;
    } else {
      const start = i;
      while (i < len && line[i] !== ',') i++;
      fields.push(line.slice(start, i).trim());
      if (i < len && line[i] === ',') i++;
    }
  }
  if (len > 0 && line[len - 1] === ',') fields.push('');
  return fields;
}

export function parseROCSVText(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseROCSVLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = parseROCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

/** Normalise a datetime string from the CSV into ISO 8601 format. */
export function normalizeRODatetime(raw: string): string {
  if (!raw?.trim()) return '';
  let s = raw.trim().replace(' ', 'T');
  s = s.replace(/T(\d):/, 'T0$1:');
  return s;
}

// ─── RO Train Readings schema ─────────────────────────────────────────────────

export const RO_TRAIN_SCHEMA =
  'train_number*, reading_datetime (YYYY-MM-DDTHH:mm), feed_pressure_psi, reject_pressure_psi, ' +
  'feed_flow, permeate_flow, reject_flow, feed_tds, permeate_tds, reject_tds, ' +
  'feed_ph, permeate_ph, reject_ph, turbidity_ntu, temperature_c, chlorine_residual_mg_l, suction_pressure_psi, ' +
  'permeate_meter_curr (cumulative m³ — used as production when "Permeate = Production"), ' +
  'permeate_meter_prev (previous reading — delta computed automatically), remarks';

export const RO_TRAIN_TEMPLATE_ROW: Record<string, string> = {
  train_number:           '1',
  reading_datetime:       '2024-06-15T08:30',
  feed_pressure_psi:      '120',
  reject_pressure_psi:    '115',
  feed_flow:              '10.5',
  permeate_flow:          '7.5',
  reject_flow:            '3.0',
  feed_tds:               '800',
  permeate_tds:           '50',
  reject_tds:             '1500',
  feed_ph:                '7.2',
  permeate_ph:            '6.8',
  reject_ph:              '7.5',
  turbidity_ntu:          '0.5',
  temperature_c:          '28',
  chlorine_residual_mg_l: '',
  suction_pressure_psi:   '10',
  permeate_meter_curr:    '',
  permeate_meter_prev:    '',
  remarks:                '',
};

/** Validate a single parsed CSV row; returns a list of human-readable errors. */
export function validateROTrainRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.train_number?.trim() || isNaN(Number(r.train_number)))
    e.push(`Row ${i}: train_number is required and must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeRODatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  const numFields = [
    'feed_pressure_psi', 'reject_pressure_psi', 'feed_flow', 'permeate_flow', 'reject_flow',
    'feed_tds', 'permeate_tds', 'reject_tds', 'feed_ph', 'permeate_ph', 'reject_ph',
    'turbidity_ntu', 'temperature_c', 'chlorine_residual_mg_l', 'suction_pressure_psi',
  ];
  for (const f of numFields) {
    if (r[f]?.trim() && isNaN(Number(r[f])))
      e.push(`Row ${i}: ${f} must be a number`);
  }
  if (r.permeate_meter_curr?.trim() && isNaN(Number(r.permeate_meter_curr)))
    e.push(`Row ${i}: permeate_meter_curr must be a number`);
  if (r.permeate_meter_prev?.trim() && isNaN(Number(r.permeate_meter_prev)))
    e.push(`Row ${i}: permeate_meter_prev must be a number`);
  if (r.permeate_meter_curr?.trim() && r.permeate_meter_prev?.trim()) {
    const delta = +r.permeate_meter_curr - +r.permeate_meter_prev;
    if (delta < 0)
      e.push(`Row ${i}: permeate_meter_curr (${r.permeate_meter_curr}) is less than permeate_meter_prev (${r.permeate_meter_prev}) — meter rollback`);
  }
  return e;
}
