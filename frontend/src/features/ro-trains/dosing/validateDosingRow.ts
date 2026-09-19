export function validateDosingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.plant_name?.trim())
    e.push(`Row ${i}: plant_name is required`);
  if (r.log_datetime && isNaN(Date.parse(r.log_datetime.trim().replace(' ', 'T'))))
    e.push(`Row ${i}: log_datetime is not a valid date`);
  const numFields = ['chlorine_kg', 'smbs_kg', 'anti_scalant_l', 'soda_ash_kg', 'free_chlorine_reagent_pcs'];
  for (const f of numFields) {
    if (r[f]?.trim() && isNaN(Number(r[f])))
      e.push(`Row ${i}: ${f} must be a number`);
  }
  return e;
}
