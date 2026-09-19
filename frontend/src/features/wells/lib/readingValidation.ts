import { normalizeDatetime } from '@/components/ReadingImportDialog';

export function validateWellReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);
  if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
    e.push(`Row ${i}: current_reading must be a number`);
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.tds_ppm && isNaN(Number(r.tds_ppm)))
    e.push(`Row ${i}: tds_ppm must be a number`);
  if (r.turbidity_ntu && isNaN(Number(r.turbidity_ntu)))
    e.push(`Row ${i}: turbidity_ntu must be a number`);
  if (r.pressure_psi && isNaN(Number(r.pressure_psi)))
    e.push(`Row ${i}: pressure_psi must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

export function validateLocatorReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.locator_name?.trim()) e.push(`Row ${i}: locator_name is required`);
  const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';
  if (isDirect) {
    if (!r.daily_volume?.trim() || isNaN(Number(r.daily_volume)) || Number(r.daily_volume) <= 0)
      e.push(`Row ${i}: daily_volume must be a positive number when input_mode=direct`);
  } else {
    if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
      e.push(`Row ${i}: current_reading must be a number`);
  }
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.daily_volume && !isDirect && isNaN(Number(r.daily_volume)))
    e.push(`Row ${i}: daily_volume must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

export function validateDerivedOverrideRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.date?.trim() || isNaN(Date.parse(r.date.trim())))
    e.push(`Row ${i}: date must be a valid date (YYYY-MM-DD)`);
  if (!r.value?.trim() || isNaN(Number(r.value)))
    e.push(`Row ${i}: value must be a number`);
  if (!r.reason?.trim())
    e.push(`Row ${i}: reason is required — it's written to the audit log so the override is explained, not just a changed number`);
  return e;
}

export function validatePowerRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.plant_name?.trim()) e.push(`Row ${i}: plant_name is required`);
  if (!r.meter_reading_kwh?.trim() || isNaN(Number(r.meter_reading_kwh)))
    e.push(`Row ${i}: meter_reading_kwh is required and must be a number`);
  if (!r.reading_datetime?.trim() || isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is required and must be a valid datetime`);
  if (r.solar_meter_reading && isNaN(Number(r.solar_meter_reading)))
    e.push(`Row ${i}: solar_meter_reading must be a number`);
  if (r.solar_input_mode && !['raw', 'direct'].includes(r.solar_input_mode.trim().toLowerCase()))
    e.push(`Row ${i}: solar_input_mode must be "raw" or "direct"`);
  if (r.daily_solar_kwh && isNaN(Number(r.daily_solar_kwh)))
    e.push(`Row ${i}: daily_solar_kwh must be a number`);
  if (r.daily_grid_kwh && isNaN(Number(r.daily_grid_kwh)))
    e.push(`Row ${i}: daily_grid_kwh must be a number`);
  return e;
}

export function validateBlendingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);
  const hasRaw = !!r.raw_meter_reading?.trim();
  if (!hasRaw)
    e.push(`Row ${i}: raw_meter_reading (cumulative meter) is required — blending wells are metered, volume is always computed as a delta`);
  if (hasRaw && (isNaN(Number(r.raw_meter_reading)) || Number(r.raw_meter_reading) < 0))
    e.push(`Row ${i}: raw_meter_reading must be a non-negative number`);
  if (r.previous_reading?.trim() && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.event_date && isNaN(Date.parse(r.event_date)))
    e.push(`Row ${i}: event_date is not a valid date (use YYYY-MM-DD)`);
  if (r.reading_datetime?.trim() && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date (use YYYY-MM-DDTHH:mm)`);
  return e;
}
