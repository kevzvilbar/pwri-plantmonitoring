/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/integrations/supabase/client';
import type { NormalizedReplacement, ReplacementKind, ReplacementTarget } from './replacementTypes';
import { numOrNull, strOrNull } from './replacementUtils';

function normalize(kind: ReplacementKind, row: any): NormalizedReplacement {
  if (kind === 'well') {
    return {
      id: row.id, table: 'well_meter_replacements',
      oldSerial: strOrNull(row.old_serial), oldFinal: numOrNull(row.old_final_reading),
      replacementDate: strOrNull(row.replacement_date),
      newBrand: strOrNull(row.new_brand), newSize: strOrNull(row.new_size),
      newSerial: strOrNull(row.new_serial), newInitial: numOrNull(row.new_initial_reading),
      installedDate: strOrNull(row.new_installed_date),
      replacedBy: strOrNull(row.replaced_by), remarks: strOrNull(row.remarks), raw: row,
    };
  }
  if (kind === 'power') {
    return {
      id: row.id, table: 'power_meter_changes',
      meterLabel: row.meter_index != null ? `Grid Meter ${(Number(row.meter_index) || 0) + 1}` : null,
      oldFinal: numOrNull(row.old_meter_final_reading),
      replacementDate: strOrNull(row.change_date),
      newInitial: numOrNull(row.new_meter_initial_reading),
      oldMultiplier: numOrNull(row.old_multiplier), newMultiplier: numOrNull(row.new_multiplier),
      replacedBy: strOrNull(row.changed_by), remarks: strOrNull(row.notes), raw: row,
    };
  }
  const meterLabel =
    kind === 'train' && row.meter_type
      ? `${String(row.meter_type).charAt(0).toUpperCase()}${String(row.meter_type).slice(1)} meter`
      : null;
  return {
    id: row.id,
    table: kind === 'locator' ? 'locator_meter_replacements'
      : kind === 'product' ? 'product_meter_replacements' : 'ro_train_meter_replacements',
    meterLabel,
    oldSerial: strOrNull(row.old_meter_serial), oldBrand: strOrNull(row.old_meter_brand),
    oldSize: strOrNull(row.old_meter_size), oldFinal: numOrNull(row.old_meter_final_reading),
    replacementDate: strOrNull(row.replacement_date),
    newBrand: strOrNull(row.new_meter_brand), newSize: strOrNull(row.new_meter_size),
    newSerial: strOrNull(row.new_meter_serial), newInitial: numOrNull(row.new_meter_initial_reading),
    installedDate: strOrNull(row.new_meter_installed_date),
    replacedBy: strOrNull(row.replaced_by), remarks: strOrNull(row.remarks), raw: row,
  };
}

/**
 * Normalizes a raw replacement row into the shared shape used by the detail
 * popover. Exported so settings screens (WellDetail / LocatorDetail) that
 * already hold the row locally don't have to re-fetch it by reading_id.
 */
export function normalizeReplacementRow(kind: ReplacementKind, row: any): NormalizedReplacement {
  const rec = normalize(kind, row);
  const joined = row?.replacer ?? row?.changer;
  if (joined) {
    rec.replacerName = [joined.first_name, joined.last_name].filter(Boolean).join(' ') || null;
  }
  return rec;
}

/** Resolves display names for whoever logged a set of swaps. */
export async function attachReplacerNames(records: NormalizedReplacement[]): Promise<NormalizedReplacement[]> {
  const actorIds = [...new Set(records.map((r) => r.replacedBy).filter(Boolean))] as string[];
  if (!actorIds.length) return records;
  const names = new Map<string, string>();
  try {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, username')
      .in('id', actorIds);
    for (const p of ((profiles ?? []) as any[])) {
      names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || p.id);
    }
  } catch { /* display-only enrichment */ }
  return records.map((r) => (r.replacedBy && names.get(r.replacedBy)
    ? { ...r, replacerName: names.get(r.replacedBy) ?? null } : r));
}

export async function fetchReplacementRecords(target: ReplacementTarget): Promise<NormalizedReplacement[]> {
  const { kind, readingId, meterIndex, meterType } = target;
  if (!readingId || kind === 'blending') return [];
  let table = 'ro_train_meter_replacements';
  if (kind === 'well') table = 'well_meter_replacements';
  else if (kind === 'locator') table = 'locator_meter_replacements';
  else if (kind === 'product') table = 'product_meter_replacements';
  else if (kind === 'power') table = 'power_meter_changes';

  let q = (supabase.from(table as any) as any).select('*').eq('reading_id', readingId);
  if (kind === 'power' && meterIndex != null) q = q.eq('meter_index', meterIndex);
  if (kind === 'train' && meterType) q = q.eq('meter_type', meterType);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error || !data?.length) return [];

  const rows = data as any[];
  const actorIds = [...new Set(rows.map((r) => r.replaced_by ?? r.changed_by).filter(Boolean))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    try {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, username')
        .in('id', actorIds as string[]);
      for (const p of ((profiles ?? []) as any[])) {
        names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || p.id);
      }
    } catch { /* display-only enrichment */ }
  }
  return rows.map((r) => {
    const n = normalize(kind, r);
    const actor = r.replaced_by ?? r.changed_by;
    if (actor && names.get(actor)) n.replacerName = names.get(actor) ?? null;
    return n;
  });
}
