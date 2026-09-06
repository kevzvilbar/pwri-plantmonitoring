/**
 * data/mutations/readings.ts — reading mutation functions (roadmap Phase 3).
 *
 * Client-side validation + the single Supabase insert point for a well
 * reading. Keeping every write behind one function means the trigger
 * cascade (chain sync → volume delta → cost → audit) only ever needs to be
 * reasoned about from here, and any new validation lands in ONE place.
 *
 * The input shape is derived from the generated Database schema so it can
 * never drift from the live table shape.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type WellReadingInsert = Database['public']['Tables']['well_readings']['Insert'];

export interface WellReadingInput {
  plant_id: string;
  well_id: string;
  reading_datetime: string;
  current_reading?: number | null;
  recorded_by?: string | null;
}

/** Insert a well reading and return the created row id. */
export async function insertWellReading(input: WellReadingInput): Promise<{ id: string }> {
  if (!input.plant_id) throw new Error('plant_id is required');
  if (!input.well_id) throw new Error('well_id is required');
  if (!input.reading_datetime) throw new Error('reading_datetime is required');

  const { data, error } = await supabase
    .from('well_readings')
    .insert({
      plant_id: input.plant_id,
      well_id: input.well_id,
      reading_datetime: input.reading_datetime,
      current_reading: input.current_reading ?? null,
      recorded_by: input.recorded_by ?? null,
    } satisfies WellReadingInsert)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}