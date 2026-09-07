import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { toast } from '@/components/ui/sonner';
import { KIND_COPY, type DeleteMenuProps, type DependencySnapshot } from './types';
import { fetchUserDeps, fetchPlantDeps } from './deps';

export function useDeleteEntity({ kind, id, invalidateKeys, onDeleted }: DeleteMenuProps) {
  const qc = useQueryClient();
  const [openSoft, setOpenSoft] = useState(false);
  const [openHard, setOpenHard] = useState(false);
  const [openForce, setOpenForce] = useState(false);
  const [forceAck, setForceAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [deps, setDeps] = useState<DependencySnapshot | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);

  const copy = KIND_COPY[kind];
  const reasonValid = reason.trim().length >= 5;

  const resetAndClose = useCallback(() => {
    setReason('');
    setDeps(null);
    setForceAck(false);
    setOpenSoft(false);
    setOpenHard(false);
    setOpenForce(false);
  }, []);

  const doSoft = useCallback(async () => {
    try {
      setBusy(true);
      const cap = copy.label[0].toUpperCase() + copy.label.slice(1);
      if (kind === 'user') {
        const { error } = await supabase.from('user_profiles').update({ status: 'Suspended' }).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('plants').update({ status: 'Inactive' }).eq('id', id);
        if (error) throw new Error(error.message);
      }
      toast.success(`${cap} marked ${copy.softName}`);
      invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      resetAndClose();
      onDeleted?.();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [kind, id, copy, invalidateKeys, qc, resetAndClose, onDeleted]);

  const loadDeps = useCallback(async () => {
    setLoadingDeps(true);
    try {
      const snap = kind === 'user' ? await fetchUserDeps(id) : await fetchPlantDeps(id);
      setDeps(snap);
    } catch (_e) {
      setDeps({ blocking: false, total_references: 0, references: [] });
    } finally {
      setLoadingDeps(false);
    }
  }, [kind, id]);

  const doHard = useCallback(async (force = false, _archive = false) => {
    if (!reasonValid) {
      toast.error('Please enter a reason of at least 5 characters.');
      return;
    }
    try {
      setBusy(true);
      const cap = copy.label[0].toUpperCase() + copy.label.slice(1);
      if (kind === 'user') {
        const { error: headErr } = await supabase
          .from('user_profiles')
          .update({ immediate_head_id: null })
          .eq('immediate_head_id', id);
        if (headErr) throw new Error(`Could not clear reporting references: ${headErr.message}`);
        const { error: rolesErr } = await supabase.from('user_roles').delete().eq('user_id', id);
        if (rolesErr) throw new Error(rolesErr.message);
        const { error: profileErr } = await supabase.from('user_profiles').delete().eq('id', id);
        if (profileErr) throw new Error(profileErr.message);
      } else {
        const { error } = await supabase.from('plants').delete().eq('id', id);
        if (error) throw new Error(error.message);
      }
      toast.success(force ? `${cap} force-deleted` : `${cap} permanently deleted`);
      invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      resetAndClose();
      onDeleted?.();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [kind, id, copy, reasonValid, invalidateKeys, qc, resetAndClose, onDeleted]);

  const openHardWithDeps = useCallback(() => {
    setReason('');
    setDeps(null);
    setForceAck(false);
    setOpenHard(true);
    loadDeps();
  }, [loadDeps]);

  const promptForce = useCallback(() => {
    setOpenHard(false);
    setOpenForce(true);
  }, []);

  return {
    openSoft, setOpenSoft,
    openHard, setOpenHard,
    openForce, setOpenForce,
    forceAck, setForceAck,
    busy,
    reason, setReason,
    deps, loadingDeps,
    copy, reasonValid,
    resetAndClose,
    doSoft,
    doHard,
    loadDeps,
    openHardWithDeps,
    promptForce,
  };
}
