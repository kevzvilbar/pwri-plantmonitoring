/**
 * data/mutations/corrections.ts — Data correction mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * correction workflows. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type CorrectionRequestInsert = Database['public']['Tables']['correction_requests']['Insert'];
type CorrectionRequestUpdate = Database['public']['Tables']['correction_requests']['Update'];
type ReadingNormalizationInsert = Database['public']['Tables']['reading_normalizations']['Insert'];

/** Create a correction request */
export async function createCorrectionRequest(request: CorrectionRequestInsert): Promise<{ id: string }> {
  const { data, error } = await supabase.from('correction_requests').insert(request).select('id').single();
  if (error) throw error;
  return data as { id: string };
}

/** Update a correction request (approve/reject) */
export async function updateCorrectionRequest(
  id: string,
  updates: CorrectionRequestUpdate
): Promise<void> {
  const { error } = await supabase.from('correction_requests').update(updates).eq('id', id);
  if (error) throw error;
}

/** Approve a correction request */
export async function approveCorrectionRequest(
  id: string,
  reviewerId: string,
  note?: string
): Promise<void> {
  const { error } = await supabase
    .from('correction_requests')
    .update({
      status: 'approved' as const,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      resolution_note: note,
    } as any)
    .eq('id', id);
  if (error) throw error;
}

/** Reject a correction request */
export async function rejectCorrectionRequest(
  id: string,
  reviewerId: string,
  note?: string
): Promise<void> {
  const { error } = await supabase
    .from('correction_requests')
    .update({
      status: 'rejected' as const,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      resolution_note: note,
    } as any)
    .eq('id', id);
  if (error) throw error;
}

/** Insert reading normalization audit entry */
export async function insertReadingNormalization(normalization: ReadingNormalizationInsert): Promise<void> {
  const { error } = await supabase.from('reading_normalizations').insert(normalization);
  if (error) throw error;
}

/** Bulk approve pending readings */
export async function bulkApproveReadings(
  table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings',
  ids: string[],
  reviewerId: string,
  note?: string
): Promise<void> {
  const { error } = await (supabase.from(table as any)
    .update({ norm_status: 'normal', reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), resolution_note: note })
    .in('id', ids) as any);
  if (error) throw error;
}

/** Bulk retract pending readings */
export async function bulkRetractReadings(
  table: 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings',
  ids: string[],
  reviewerId: string,
  note?: string
): Promise<void> {
  const { error } = await (supabase.from(table as any)
    .update({ norm_status: 'retracted', reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), resolution_note: note })
    .in('id', ids) as any);
  if (error) throw error;
}

export type { CorrectionRequestInsert, CorrectionRequestUpdate, ReadingNormalizationInsert };