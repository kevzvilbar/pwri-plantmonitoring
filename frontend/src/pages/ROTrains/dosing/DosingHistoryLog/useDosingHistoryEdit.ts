import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canEditEntry } from '../../../ro-trains/helpers';
import { diffFields } from '../../../ro-trains/helpers';
import { logReadingEdit } from '../../../ro-trains/helpers';
import { DOSING_KEYS } from '../../../ro-trains/constants';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';

export function useDosingHistoryEdit(prices: Record<string, number> | undefined) {
  const qc = useQueryClient();
  const { isManager, activeOperator, user } = useAuth();

  const [editId, setEditId]         = useState<string | null>(null);
  const [editRow, setEditRow]       = useState<any | null>(null);
  const [editV, setEditV]           = useState<Record<string, string>>({});
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving]         = useState(false);

  const startEdit = useCallback((row: any) => {
    if (!canEditEntry(row, isManager, activeOperator?.id)) {
      toast.error('You can only edit your own entries, within 8 hours of submitting them.');
      return;
    }
    setEditId(row.id);
    setEditRow(row);
    setEditReason('');
    setEditCustomReason('');
    setEditV({
      log_datetime:               row.log_datetime ? format(new Date(row.log_datetime), "yyyy-MM-dd'T'HH:mm") : '',
      chlorine_kg:                String(row.chlorine_kg    ?? ''),
      smbs_kg:                    String(row.smbs_kg        ?? ''),
      anti_scalant_l:             String(row.anti_scalant_l ?? ''),
      soda_ash_kg:                String(row.soda_ash_kg    ?? ''),
      free_chlorine_reagent_pcs:  String(row.free_chlorine_reagent_pcs ?? ''),
      product_water_free_cl_ppm:  String(row.product_water_free_cl_ppm ?? ''),
    });
  }, [isManager, activeOperator]);

  const saveEdit = useCallback(async () => {
    if (!editId || !editRow) return;
    if (!canEditEntry(editRow, isManager, activeOperator?.id)) {
      toast.error('You no longer have permission to edit this entry.');
      return;
    }
    if (!editReason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(editReason, editCustomReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);
    const num = (k: string) => editV[k] !== '' ? +editV[k] : null;
    const costCalc = DOSING_KEYS.reduce((s: any, c: any) => {
      const qty = num(c.key) ?? 0;
      return s + qty * (prices?.[c.name] ?? 0);
    }, 0);
    const payload: any = {
      log_datetime:               new Date(editV.log_datetime).toISOString(),
      chlorine_kg:                num('chlorine_kg')               ?? 0,
      smbs_kg:                    num('smbs_kg')                   ?? 0,
      anti_scalant_l:             num('anti_scalant_l')            ?? 0,
      soda_ash_kg:                num('soda_ash_kg')               ?? 0,
      free_chlorine_reagent_pcs:  num('free_chlorine_reagent_pcs') ?? 0,
      product_water_free_cl_ppm:  num('product_water_free_cl_ppm'),
      calculated_cost:            +costCalc.toFixed(2),
    };
    const { error } = await supabase.from('chemical_dosing_logs').update(payload).eq('id', editId);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name: 'chemical_dosing_logs',
      record_id: editId,
      plant_id: editRow.plant_id ?? null,
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel,
      changes: diffFields(editRow, payload),
      reason: resolveReason(editReason, editCustomReason),
    });

    toast.success('Dosing record updated');
    setEditId(null);
    setEditRow(null);
    setEditReason('');
    setEditCustomReason('');
    qc.invalidateQueries({ queryKey: ['dosing-history'] });
    qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
  }, [editId, editRow, editV, editReason, editCustomReason, prices, qc, isManager, activeOperator, user]);

  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditRow(null);
    setEditReason('');
    setEditCustomReason('');
  }, []);

  return { editId, editRow, editV, setEditV, editReason, setEditReason, editCustomReason, setEditCustomReason, saving, startEdit, saveEdit, cancelEdit };
}

