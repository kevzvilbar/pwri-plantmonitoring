/**
 * data/mutations/shiftDuty.ts — Shift duty & partner pairing mutations.
 *
 * Roadmap: Pair-duty attribution for shared terminals & KPI appraisal fairness.
 */
import { supabase } from '@/integrations/supabase/client';

export interface RecordShiftDutyParams {
  plantId: string;
  operatorId: string;
  partnerOperatorId?: string | null;
  cycleKey: string;
  confirmedBy?: string | null;
}

export interface EndShiftDutyParams {
  id: string;
  endedBy: string;
}

export async function recordShiftDuty(params: RecordShiftDutyParams) {
  const isDual = Boolean(params.partnerOperatorId && params.partnerOperatorId !== params.operatorId);

  const { data, error } = await supabase
    .from('shift_duty_log')
    .insert({
      plant_id: params.plantId,
      operator_id: params.operatorId,
      partner_operator_id: isDual ? (params.partnerOperatorId ?? null) : null,
      is_dual_duty: isDual,
      cycle_key: params.cycleKey,
      declared_at: new Date().toISOString(),
      confirmed_by: params.confirmedBy ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function endShiftDuty(params: EndShiftDutyParams) {
  const { data, error } = await supabase
    .from('shift_duty_log')
    .update({
      ended_at: new Date().toISOString(),
      ended_by: params.endedBy,
      is_dual_duty: false,
    })
    .eq('id', params.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchActiveShiftDuty(plantId: string, operatorId: string, cycleKey: string) {
  const { data, error } = await supabase
    .from('shift_duty_log')
    .select('*')
    .eq('plant_id', plantId)
    .eq('cycle_key', cycleKey)
    .is('ended_at', null)
    .or(`operator_id.eq.${operatorId},partner_operator_id.eq.${operatorId}`)
    .order('declared_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[ShiftDuty] fetchActiveShiftDuty error:', error);
    return null;
  }
  return data;
}
