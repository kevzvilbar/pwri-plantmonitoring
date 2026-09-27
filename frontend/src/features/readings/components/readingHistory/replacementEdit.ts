/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NormalizedReplacement } from '@/components/readingHistory/replacementTypes';

/** Prefill for ReplaceMeterDialog edit mode: an already-logged swap. */
export interface ReplacementInitial {
  id: string;
  readingId?: string | null;
  replacementDate: string | null;
  oldFinal: string;
  rawMeterType?: string | null;
  rawOldSerial?: string | null;
  rawMeterIndex?: number | null;
  newBrand: string;
  newSize: string;
  newSerial: string;
  newInitial: string;
  installedDate: string | null;
  remarks: string;
  oldMultiplier?: number | null;
  oldMultiplierEnabled?: boolean | null;
  newMultiplier?: number | null;
  newMultiplierEnabled?: boolean | null;
}

const toLocalInput = (v: any): string => {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function replacementToInitial(rec: NormalizedReplacement): ReplacementInitial {
  const raw = rec.raw ?? {};
  const oldFinal = rec.oldFinal ?? raw.old_final_reading ?? raw.old_meter_final_reading ?? '';
  const newInitial = rec.newInitial ?? raw.new_initial_reading ?? raw.new_meter_initial_reading ?? '';
  const oldMultiplier = rec.oldMultiplier != null ? rec.oldMultiplier : (raw.old_multiplier != null ? Number(raw.old_multiplier) : null);
  const oldMultiplierEnabled = rec.oldMultiplierEnabled != null ? rec.oldMultiplierEnabled : (raw.old_multiplier_enabled != null ? Boolean(raw.old_multiplier_enabled) : null);
  const newMultiplier = rec.newMultiplier != null ? rec.newMultiplier : (raw.new_multiplier != null ? Number(raw.new_multiplier) : null);
  const newMultiplierEnabled = rec.newMultiplierEnabled != null ? rec.newMultiplierEnabled : (raw.new_multiplier_enabled != null ? Boolean(raw.new_multiplier_enabled) : null);
  return {
    id: rec.id,
    readingId: (rec.raw?.reading_id ?? null) as string | null,
    rawMeterType: (rec.raw?.meter_type ?? null) as string | null,
    rawOldSerial: (rec.oldSerial ?? rec.raw?.old_meter_serial ?? null) as string | null,
    rawMeterIndex: (rec.raw?.meter_index ?? null) as number | null,
    replacementDate: toLocalInput(rec.replacementDate),
    oldFinal: oldFinal === '' || oldFinal == null ? '' : String(oldFinal),
    newBrand: rec.newBrand ?? raw.new_brand ?? raw.new_meter_brand ?? '',
    newSize: rec.newSize ?? raw.new_size ?? raw.new_meter_size ?? '',
    newSerial: rec.newSerial ?? raw.new_serial ?? raw.new_meter_serial ?? '',
    newInitial: newInitial === '' || newInitial == null ? '' : String(newInitial),
    installedDate: toLocalInput(rec.installedDate),
    remarks: rec.remarks ?? raw.remarks ?? raw.notes ?? '',
    oldMultiplier,
    oldMultiplierEnabled,
    newMultiplier,
    newMultiplierEnabled,
  };
}
