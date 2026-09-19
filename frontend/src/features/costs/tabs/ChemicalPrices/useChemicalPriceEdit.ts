import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';

export function useChemicalPriceEdit(userId: string | undefined) {
  const qc = useQueryClient();

  const [editId, setEditId]     = useState<string | null>(null);
  const [editV, setEditV]       = useState({ chemical_name: '', unit_price: '', effective_date: '' });
  const [saving, setSaving]     = useState(false);

  const startEdit = useCallback((p: any) => {
    setEditId(p.id);
    setEditV({
      chemical_name: p.chemical_name ?? '',
      unit_price: String(p.unit_price ?? ''),
      effective_date: p.effective_date ?? '',
    });
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    if (!editV.chemical_name || !editV.unit_price) { toast.error('Name and price required'); return; }
    setSaving(true);
    const { error } = await supabase.from('chemical_prices').update({
      chemical_name: editV.chemical_name, unit_price: +editV.unit_price,
      effective_date: editV.effective_date, updated_by: userId,
    }).eq('id', id);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Price record updated');
    setEditId(null);
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  }, [editV, qc, userId]);

  const cancelEdit = useCallback(() => setEditId(null), []);

  return { editId, editV, setEditV, saving, startEdit, saveEdit, cancelEdit };
}
