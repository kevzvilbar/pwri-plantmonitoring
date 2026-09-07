import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';

export function useChemicalPriceDelete() {
  const qc = useQueryClient();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = useCallback(async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from('chemical_prices').delete().eq('id', deleteId);
    setDeleting(false);
    setDeleteId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Price record deleted');
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  }, [deleteId, qc]);

  return { deleteId, setDeleteId, deleting, confirmDelete };
}
