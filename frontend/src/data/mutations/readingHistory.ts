/**
 * data/mutations/readingHistory.ts — Reading history mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * reading history operations. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ReadingNormalizationInsert = Database['public']['Tables']['reading_normalizations']['Insert'];

/** Insert reading normalization audit entry */
export async function insertReadingNormalization(normalization: ReadingNormalizationInsert): Promise<void> {
  const { error } = await supabase.from('reading_normalizations').insert(normalization);
  if (error) throw error;
}

/** Update a reading entry (edit) */
export async function updateReadingEntry(
  table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events',
  id: string,
  updates: Record<string, any>,
  editorId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.from(table).update(updates).eq('id', id);
  if (error) throw error;
}

/** Delete a reading entry */
export async function deleteReadingEntry(
  table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events',
  id: string
): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

/** Toggle meter replacement flag */
export async function toggleMeterReplacement(
  table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events',
  id: string,
  value: boolean
): Promise<void> {
  const { error } = await supabase.from(table).update({ is_meter_replacement: value } as any).eq('id', id);
  if (error) throw error;
}

/** Replace meter (for well/locator) */
export async function replaceMeter(
  table: 'locator_readings' | 'well_readings',
  id: string,
  newSerial: string,
  editorId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.from(table).update({
    is_meter_replacement: true,
    meter_serial: newSerial,
    recorded_by: editorId,
  } as any).eq('id', id);
  if (error) throw error;
}

/** Bulk delete readings */
export async function bulkDeleteReadings(
  table: 'locator_readings' | 'well_readings' | 'power_readings' | 'blending_events',
  ids: string[]
): Promise<void> {
  const { error } = await supabase.from(table).delete().in('id', ids);
  if (error) throw error;
}

/** Cascade edit - update reading and cascade downstream */
export async function cascadeReadingEdit(
  table: 'locator_readings' | 'well_readings',
  id: string,
  newValue: number,
  editorId: string,
  reason: string
): Promise<void> {
  const { error } = await (supabase as any).rpc('cascade_reading_correction', {
    p_table: table,
    p_id: id,
    p_new_value: newValue,
    p_editor_id: editorId,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Get audit table name for module */
export function getAuditTableName(module: 'locator' | 'well' | 'blending' | 'power'): 'locator_readings' | 'power_readings' | 'blending_events' | 'well_readings' {
  switch (module) {
    case 'locator': return 'locator_readings';
    case 'power': return 'power_readings';
    case 'blending': return 'blending_events';
    default: return 'well_readings';
  }
}

export type { ReadingNormalizationInsert };