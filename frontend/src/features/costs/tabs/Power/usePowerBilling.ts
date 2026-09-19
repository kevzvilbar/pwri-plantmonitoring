import { supabase } from '@/integrations/supabase/client';
import { resolveBillingDuplicate } from '../importHelpers';

export type BillingFormValues = {
  billing_month: string;
  period_start: string;
  period_end: string;
  previous_reading: string;
  current_reading: string;
  multiplier: string;
  generation_charge: string;
  distribution_charge: string;
  other_charges: string;
  total_amount: string;
  remarks: string;
  provider: string;
};

export const BILLING_INSERT_CHUNK_SIZE = 200;

export function validateBillingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.billing_month?.trim()) e.push(`Row ${i}: billing_month is required`);
  else if (isNaN(Date.parse(r.billing_month))) e.push(`Row ${i}: billing_month must be a valid date (YYYY-MM-DD)`);
  if (!r.total_amount?.trim() || isNaN(Number(r.total_amount)) || Number(r.total_amount) < 0)
    e.push(`Row ${i}: total_amount is required and must be a non-negative number`);
  if (r.period_start && isNaN(Date.parse(r.period_start))) e.push(`Row ${i}: period_start is not a valid date`);
  if (r.period_end   && isNaN(Date.parse(r.period_end)))   e.push(`Row ${i}: period_end is not a valid date`);
  if (r.previous_reading    && isNaN(Number(r.previous_reading)))    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.current_reading     && isNaN(Number(r.current_reading)))     e.push(`Row ${i}: current_reading must be a number`);
  if (
    r.previous_reading?.trim() && r.current_reading?.trim() &&
    !isNaN(Number(r.previous_reading)) && !isNaN(Number(r.current_reading)) &&
    Number(r.current_reading) < Number(r.previous_reading)
  ) {
    e.push(`Row ${i}: current_reading (${r.current_reading}) is less than previous_reading (${r.previous_reading}) — readings appear reversed, which produces negative kWh and corrupts power costs`);
  }
  if (r.multiplier          && isNaN(Number(r.multiplier)))          e.push(`Row ${i}: multiplier must be a number`);
  if (r.generation_charge   && isNaN(Number(r.generation_charge)))   e.push(`Row ${i}: generation_charge must be a number`);
  if (r.distribution_charge && isNaN(Number(r.distribution_charge))) e.push(`Row ${i}: distribution_charge must be a number`);
  if (r.other_charges       && isNaN(Number(r.other_charges)))       e.push(`Row ${i}: other_charges must be a number`);
  return e;
}

function normDate(val: string | undefined): string | null {
  if (!val?.trim()) return null;
  const s = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function insertBillingRows(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  type Prepared = { billingMonth: string; payload: Record<string, any> };
  const prepared: Prepared[] = [];
  for (const r of rows) {
    const parsedBillingDate = normDate(r.billing_month);
    if (!parsedBillingDate) { errors.push(`billing_month invalid: "${r.billing_month}"`); continue; }
    const billingMonth = parsedBillingDate.slice(0, 7) + '-01';

    const periodStart = normDate(r.period_start);
    const periodEnd   = normDate(r.period_end);

    const payload: Record<string, any> = {
      plant_id: plantId,
      billing_month: billingMonth,
      period_start:        periodStart,
      period_end:          periodEnd,
      previous_reading:    r.previous_reading    !== '' && r.previous_reading    != null ? +r.previous_reading    : null,
      current_reading:     r.current_reading     !== '' && r.current_reading     != null ? +r.current_reading     : null,
      multiplier:          r.multiplier          !== '' && r.multiplier          != null ? +r.multiplier          : 1,
      generation_charge:   r.generation_charge   !== '' && r.generation_charge   != null ? +r.generation_charge   : null,
      distribution_charge: r.distribution_charge !== '' && r.distribution_charge != null ? +r.distribution_charge : null,
      other_charges:       r.other_charges       !== '' && r.other_charges       != null ? +r.other_charges       : null,
      total_amount:        +r.total_amount,
      remarks:             r.remarks             || 'Imported',
      recorded_by:         userId,
    };

    if (payload.previous_reading != null && payload.current_reading != null &&
        payload.current_reading < payload.previous_reading) {
      errors.push(`${billingMonth}: current_reading (${payload.current_reading}) < previous_reading (${payload.previous_reading}) — row skipped to prevent negative kWh`);
      continue;
    }

    prepared.push({ billingMonth, payload });
  }
  if (prepared.length === 0) return { count, errors };

  const { data: existingBills } = await supabase
    .from('electric_bills')
    .select('id, billing_month')
    .eq('plant_id', plantId)
    .in('billing_month', Array.from(new Set(prepared.map(p => p.billingMonth))));
  const existingByMonth = new Map<string, string>();
  (existingBills ?? []).forEach((row: any) => existingByMonth.set(row.billing_month, row.id));

  const toInsert: Record<string, any>[] = [];
  for (const { billingMonth, payload } of prepared) {
    const existingId = existingByMonth.get(billingMonth);
    if (existingId) {
      const label = `Bill @ ${billingMonth.slice(0, 7)}`;
      const decision = await resolveBillingDuplicate(`${plantId}|${billingMonth}`, label, true);
      if (decision === 'skip') continue;
      const { error } = await supabase.from('electric_bills').update(payload as any).eq('id', existingId);
      if (error) errors.push(`${billingMonth}: ${error.message}`); else count++;
      continue;
    }
    toInsert.push(payload);
  }

  for (let i = 0; i < toInsert.length; i += BILLING_INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + BILLING_INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabase.from('electric_bills').insert(chunk as any);
    if (!chunkError) { count += chunk.length; continue; }
    for (const payload of chunk) {
      const { error } = await supabase.from('electric_bills').insert(payload as any);
      if (error) errors.push(`${payload.billing_month}: ${error.message}`);
      else count++;
    }
  }

  return { count, errors };
}
