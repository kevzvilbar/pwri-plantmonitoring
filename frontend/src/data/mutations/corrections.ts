/**
 * data/mutations/corrections.ts — Data correction mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * correction workflows. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { SourceTable } from '@/pages/dataCorrections/types';

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
  updates: CorrectionRequestUpdate,
): Promise<void> {
  const { error } = await supabase.from('correction_requests').update(updates).eq('id', id);
  if (error) throw error;
}

/** Approve a correction request */
export async function approveCorrectionRequest(
  id: string,
  reviewerId: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase
    .from('correction_requests')
    .update({
      status: 'approved',
      resolved_by: reviewerId,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Reject a correction request */
export async function rejectCorrectionRequest(
  id: string,
  reviewerId: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase
    .from('correction_requests')
    .update({
      status: 'rejected',
      resolved_by: reviewerId,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
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
  table: SourceTable,
  ids: string[],
  reviewerId: string,
  note?: string,
): Promise<void> {
  let error;
  if (table === 'locator_readings') {
    ({ error } = await supabase.from('locator_readings').update({
      norm_status: 'normal',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
      ...(note ? { remarks: note } : {}),
    }).in('id', ids));
  } else if (table === 'well_readings') {
    ({ error } = await supabase.from('well_readings').update({
      norm_status: 'normal',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).in('id', ids));
  } else if (table === 'product_meter_readings') {
    ({ error } = await supabase.from('product_meter_readings').update({
      norm_status: 'normal',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).in('id', ids));
  } else {
    ({ error } = await supabase.from('ro_train_readings').update({
      norm_status: 'normal',
      ...(note ? { remarks: note } : {}),
    }).in('id', ids));
  }
  if (error) throw error;
}

/** Bulk retract pending readings */
export async function bulkRetractReadings(
  table: SourceTable,
  ids: string[],
  reviewerId: string,
  note?: string,
): Promise<void> {
  let error;
  if (table === 'locator_readings') {
    ({ error } = await supabase.from('locator_readings').update({
      norm_status: 'retracted',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
      ...(note ? { remarks: note } : {}),
    }).in('id', ids));
  } else if (table === 'well_readings') {
    ({ error } = await supabase.from('well_readings').update({
      norm_status: 'retracted',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).in('id', ids));
  } else if (table === 'product_meter_readings') {
    ({ error } = await supabase.from('product_meter_readings').update({
      norm_status: 'retracted',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).in('id', ids));
  } else {
    ({ error } = await supabase.from('ro_train_readings').update({
      norm_status: 'retracted',
      ...(note ? { remarks: note } : {}),
    }).in('id', ids));
  }
  if (error) throw error;
}

/** Supersede any other pending correction requests for the same source entity */
export async function supersedeOtherCorrectionRequests(
  sourceTable: SourceTable,
  sourceId: string,
  resolvedBy: string | undefined,
  note: string,
  excludeRequestId?: string,
): Promise<void> {
  let q = supabase
    .from('correction_requests')
    .update({
      status: 'rejected',
      resolved_by: resolvedBy ?? null,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
    .eq('source_table', sourceTable)
    .eq('source_id', sourceId)
    .eq('status', 'pending');
  if (excludeRequestId) q = q.neq('id', excludeRequestId);
  const { error } = await q;
  if (error) console.error('supersedeOtherCorrectionRequests failed:', error);
}

export type { CorrectionRequestInsert, CorrectionRequestUpdate, ReadingNormalizationInsert };