/**
 * data/queries/wells.ts — well and well-reading query functions.
 *
 * Roadmap Phase 3: the data-access layer. These are pure, React-free query
 * functions — the single place to find "every query against the wells /
 * well_readings tables". Components wrap them with React Query via the
 * hooks in src/data/hooks/; hardcoded inline .from() calls should be
 * migrated here incrementally (see docs/CODE_REVIEW.md).
 *
 * Types come straight from the generated Database schema
 * (src/integrations/supabase/types.ts) so this layer can never drift from
 * the live table shape — regenerate with `npm run types:gen` after any
 * migration that touches these tables.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type WellRow = Database['public']['Tables']['wells']['Row'];
type WellReadingRow = Database['public']['Tables']['well_readings']['Row'];

/** All wells, optionally filtered to one plant. */
export async function fetchWells(plantId?: string): Promise<WellRow[]> {
  let q = supabase.from('wells').select('*').order('name');
  if (plantId) q = q.eq('plant_id', plantId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as WellRow[];
}

/** Latest N readings for a well (descending), for history/detail views. */
export async function fetchWellReadings(
  wellId: string,
  limit = 50,
): Promise<WellReadingRow[]> {
  const { data, error } = await supabase
    .from('well_readings')
    .select('*')
    .eq('well_id', wellId)
    .order('reading_datetime', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WellReadingRow[];
}

export type { WellRow, WellReadingRow };