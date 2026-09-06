/**
 * data/queries/ro-trains.ts — RO train query functions (roadmap Phase 3).
 *
 * Types come straight from the generated Database schema so this layer can
 * never drift from the live table shape.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ROTrainRow = Database['public']['Tables']['ro_trains']['Row'];

/** All RO trains, optionally filtered to one plant. */
export async function fetchROTrains(plantId?: string): Promise<ROTrainRow[]> {
  let q = supabase.from('ro_trains').select('*').order('train_number');
  if (plantId) q = q.eq('plant_id', plantId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ROTrainRow[];
}

export type { ROTrainRow };