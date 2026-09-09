/**
 * data/mutations/compliance.ts — Compliance mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * compliance operations. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Thresholds } from '@/data/queries/compliance';

/** Persist thresholds to database and localStorage */
export async function persistThresholds(scope: string, thresholds: Thresholds): Promise<void> {
  const { error } = await supabase
    .from('compliance_thresholds')
    .upsert({ scope, thresholds, updated_at: new Date().toISOString() }, { onConflict: 'scope' });
  if (error) throw error;
}

/** Create a compliance snapshot */
export async function createComplianceSnapshot(
  plantId: string,
  scope: string,
  scopeLabel: string,
  violations: any[],
  thresholds: Thresholds,
): Promise<void> {
  const { error } = await supabase
    .from('compliance_snapshots')
    .insert({
      plant_id: plantId,
      scope,
      scope_label: scopeLabel,
      violations,
      thresholds,
      evaluated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export type { Thresholds };