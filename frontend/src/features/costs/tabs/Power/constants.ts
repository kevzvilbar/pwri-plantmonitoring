export const BILLING_SCHEMA = 'billing_month* (YYYY-MM-DD), period_start, period_end, previous_reading, current_reading, multiplier, generation_charge, distribution_charge, other_charges, total_amount*, remarks';

export const BILLING_TEMPLATE_ROW: Record<string, string> = {
  billing_month: '2026-05-01',
  period_start: '2026-04-01',
  period_end: '2026-04-30',
  previous_reading: '12000',
  current_reading: '12950',
  multiplier: '120',
  generation_charge: '15000',
  distribution_charge: '8000',
  other_charges: '2000',
  total_amount: '25000',
  remarks: '',
};
