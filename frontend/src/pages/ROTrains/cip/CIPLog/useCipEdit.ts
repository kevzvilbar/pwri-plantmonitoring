import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { canEditEntry, diffFields, logReadingEdit } from '../../../ro-trains';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';
import { format } from 'date-fns';
import { CIP_BUILTIN_DB_MAP } from '../../../ro-trains';

export function useCipEdit(cipChemicals: any[], isManager: boolean, activeOperator: any, qc: ReturnType<typeof useQueryClient>, plantId: string, user: any) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [editChems, setEditChems] = useState<Record<string, string>>({});
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const cipAdapt = (c: any) => ({ recorded_by: c.conducted_by ?? null, created_at: c.created_at ?? null });

  const startEdit = (c: any) => {
    if (!canEditEntry(cipAdapt(c), isManager, activeOperator?.id)) {
      toast.error('You can only edit your own CIP logs within 8 hours of submitting them. Managers can edit any record.');
      return;
    }
    setEditId(c.id);
    setEditRow(c);
    setEditReason('');
    setEditCustomReason('');
    setEditStart(c.start_datetime ? format(new Date(c.start_datetime), "yyyy-MM-dd'T'HH:mm") : '');
    setEditEnd(c.end_datetime ? format(new Date(c.end_datetime), "yyyy-MM-dd'T'HH:mm") : '');
    const chems: Record<string, string> = {};
    cipChemicals.forEach(chem => {
      const col = CIP_BUILTIN_DB_MAP[chem.name];
      if (col) { const val = c[col]; if (val != null && val !== 0) chems[chem.name] = String(val); }
    });
    try {
      const match = (c.remarks ?? '').match(/__cip_extra:(\{[^}]+\})/);
      if (match) {
        const extra = JSON.parse(match[1]) as Record<string, { value: string }>;
        Object.entries(extra).forEach(([name, { value }]) => { chems[name] = value; });
      }
    } catch { /* ignore malformed JSON */ }
    setEditChems(chems);
    setEditRemarks((c.remarks ?? '').replace(/\s*__cip_extra:\{[^}]+\}/, '').trim());
  };

  const saveEdit = async () => {
    if (!editId || !editRow) return;
    if (!canEditEntry(cipAdapt(editRow), isManager, activeOperator?.id)) {
      toast.error('You no longer have permission to edit this entry.');
      return;
    }
    if (!editReason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(editReason, editCustomReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);
    const payload: Record<string, any> = {
      start_datetime: editStart ? new Date(editStart).toISOString() : null,
      end_datetime: editEnd ? new Date(editEnd).toISOString() : null,
    };
    cipChemicals.forEach(chem => {
      const col = CIP_BUILTIN_DB_MAP[chem.name];
      if (col) payload[col] = editChems[chem.name] ? +editChems[chem.name] : null;
    });
    if (!('caustic_soda_kg' in payload)) payload.caustic_soda_kg = null;
    if (!('hcl_l' in payload)) payload.hcl_l = null;
    if (!('sls_g' in payload)) payload.sls_g = null;
    const customChems = cipChemicals.filter(c => !CIP_BUILTIN_DB_MAP[c.name]);
    let remarksOut: string | null = editRemarks.trim() || null;
    if (customChems.length > 0) {
      const extra: Record<string, { value: string; unit: string }> = {};
      customChems.forEach(c => {
        const val = editChems[c.name];
        if (val) extra[c.name] = { value: val, unit: c.unit };
      });
      if (Object.keys(extra).length > 0) {
        const suffix = `__cip_extra:${JSON.stringify(extra)}`;
        remarksOut = remarksOut ? `${remarksOut} ${suffix}` : suffix;
      }
    }
    payload.remarks = remarksOut;

    const { error } = await supabase.from('cip_logs').update(payload as any).eq('id', editId);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name: 'cip_logs',
      record_id: editId,
      plant_id: editRow.plant_id ?? null,
      train_id: editRow.train_id ?? null,
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel,
      changes: diffFields(editRow, payload),
      reason: resolveReason(editReason, editCustomReason),
    });

    toast.success('CIP record updated');
    setEditId(null); setEditRow(null);
    setEditReason(''); setEditCustomReason('');
    qc.invalidateQueries({ queryKey: ['cip-history'] });
  };

  const deleteCipRow = async (c: any) => {
    if (!canEditEntry(cipAdapt(c), isManager, activeOperator?.id)) {
      toast.error('You can only delete your own CIP logs within 8 hours of submitting them. Managers can delete any record.');
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from('cip_logs').delete().eq('id', c.id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('CIP record deleted');
    qc.invalidateQueries({ queryKey: ['cip-history'] });
  };

  return {
    editId, setEditId, editRow, setEditRow,
    editChems, setEditChems, editStart, setEditStart, editEnd, setEditEnd,
    editRemarks, setEditRemarks, editReason, setEditReason, editCustomReason, setEditCustomReason,
    saving, pendingDeleteId, setPendingDeleteId, deleting,
    startEdit, saveEdit, deleteCipRow,
  };
}