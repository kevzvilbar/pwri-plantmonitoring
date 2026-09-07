import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canEditEntry } from '../../../ro-trains/helpers';
import { logReadingEdit } from '../../../ro-trains/helpers';
import { friendlyError } from '@/lib/supabaseErrors';

export function useDosingHistoryDelete() {
  const qc = useQueryClient();
  const { isManager, activeOperator, user } = useAuth();

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting]               = useState(false);

  const deleteRow = useCallback(async (row: any) => {
    if (!canEditEntry(row, isManager, activeOperator?.id)) {
      toast.error('You can only delete your own entries, within 8 hours of submitting them.');
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from('chemical_dosing_logs').delete().eq('id', row.id);
    setDeleting(false);
    setPendingDeleteId(null);
    if (error) { toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name: 'chemical_dosing_logs',
      record_id: row.id,
      plant_id: row.plant_id ?? null,
      action: 'delete',
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel,
    });

    toast.success('Record deleted');
    qc.invalidateQueries({ queryKey: ['dosing-history'] });
    qc.invalidateQueries({ queryKey: ['chem-stock-computed'] });
  }, [qc, isManager, activeOperator, user]);

  return { pendingDeleteId, setPendingDeleteId, deleting, deleteRow };
}
