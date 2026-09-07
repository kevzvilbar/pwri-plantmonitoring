import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { logStatusChange } from '../../shared';
import type { LockReasonCategory } from '@/lib/reasonCodes';
import { LOCK_REASON_CATEGORIES } from '@/lib/reasonCodes';

export function useLocatorActions(plantId: string, locators: any[], qc: ReturnType<typeof useQueryClient>, isManager: boolean, isAdmin: boolean, activeOperator: any, user: any) {
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [locatorOfflineTarget, setLocatorOfflineTarget] = useState<any | null>(null);
  const [locatorOfflineBusy, setLocatorOfflineBusy] = useState(false);

  const [locatorLockTarget, setLocatorLockTarget] = useState<any | null>(null);
  const [locatorLockBusy, setLocatorLockBusy] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const doDelete = async () => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setDeleteBusy(true);
    try {
      await supabase.from('deletion_audit_log' as any).insert([{ kind: 'locator', entity_id: deleteTarget.id, entity_label: deleteTarget.name, action: 'hard', reason: deleteReason.trim(), performed_by: activeOperator?.id ?? user?.id ?? null, forced: false }] as any);
    } catch { /* audit log is best-effort — don't block the delete */ }
    const { error } = await supabase.from('locators').delete().eq('id', deleteTarget.id);
    setDeleteBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Locator deleted');
    setDeleteTarget(null);
    setDeleteReason('');
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['product-meters-plant-locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  const applyLocatorStatusChange = async (l: any, newStatus: 'Active' | 'Inactive', reasonCategory?: string, reasonDetail?: string) => {
    const { error } = await supabase.from('locators').update({ status: newStatus }).eq('id', l.id);
    if (error) { toast.error(friendlyError(error)); return; }
    await logStatusChange({
      user_id: activeOperator?.id ?? user?.id ?? null,
      plant_id: l.plant_id,
      entity_type: 'Locator',
      entity_id: l.id,
      entity_label: l.name,
      from_status: l.status,
      to_status: newStatus,
      timestamp: new Date().toISOString(),
      reason_category: reasonCategory ?? null,
      reason_detail: reasonDetail || null,
    });
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
    toast.success(`Locator marked ${newStatus}`);
  };

  const toggleLocatorStatus = async (l: any) => {
    if (!isManager) return;
    if (l.status === 'Active') {
      setLocatorOfflineTarget(l);
      return;
    }
    await applyLocatorStatusChange(l, 'Active');
  };

  const applyLocatorLockStatus = async (
    l: any,
    newIsLocked: boolean,
    reasonCategory?: LockReasonCategory,
    reasonDetail?: string,
  ) => {
    const payload: any = { is_locked: newIsLocked };
    const { error } = await supabase.from('locators').update(payload).eq('id', l.id);
    if (error) { toast.error(friendlyError(error)); return; }
    await logStatusChange({
      user_id: activeOperator?.id ?? user?.id ?? null,
      plant_id: l.plant_id,
      entity_type: 'Locator',
      entity_id: l.id,
      entity_label: l.name,
      from_status: l.is_locked ? 'locked' : 'normal',
      to_status: newIsLocked ? 'locked' : 'normal',
      timestamp: new Date().toISOString(),
      reason_category: reasonCategory ?? null,
      reason_detail: reasonDetail || null,
    });
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    toast.success(newIsLocked ? `${l.name}: meter marked locked` : `${l.name}: meter marked normal`);
  };

  const handleLockCheckboxChange = (l: any, checked: boolean) => {
    if (!isManager) return;
    if (checked === !!l.is_locked) return;
    if (!checked) {
      applyLocatorLockStatus(l, false);
      return;
    }
    setLocatorLockTarget(l);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleAll = (locators: any[]) => {
    if (!locators) return;
    if (selected.size === locators.length) setSelected(new Set());
    else setSelected(new Set(locators.map((l: any) => l.id)));
  };

  const auditDelete = async (rows: { id: string; name: string }[], reason: string, bulk: boolean) => {
    try {
      const payload = rows.map((r) => ({
        kind: 'locator',
        entity_id: r.id,
        entity_label: r.name ?? null,
        action: 'hard',
        reason: bulk ? `[BULK] ${reason}` : reason,
        performed_by: activeOperator?.id ?? user?.id ?? null,
        forced: false,
      }));
      await supabase.from('deletion_audit_log' as any).insert(payload as any);
    } catch (err) {
      console.warn('[Plants] deletion_audit_log insert failed (non-fatal):', err);
    }
  };

  const doBulkDelete = async () => {
    if (!selected.size) return;
    if (bulkReason.trim().length < 5) {
      toast.error('Please enter a reason of at least 5 characters.');
      return;
    }
    setBulkBusy(true);
    const ids = Array.from(selected);
    const rows = (locators ?? []).filter((l: any) => ids.includes(l.id)).map((l: any) => ({ id: l.id, name: l.name }));
    const { error } = await supabase.from('locators').delete().in('id', ids);
    if (error) { setBulkBusy(false); toast.error(friendlyError(error)); return; }
    await auditDelete(rows, bulkReason.trim(), true);
    setBulkBusy(false);
    setBulkOpen(false);
    setBulkReason('');
    setSelected(new Set());
    toast.success(`${ids.length} locator(s) permanently deleted`);
    qc.invalidateQueries({ queryKey: ['locators', plantId] });
    qc.invalidateQueries({ queryKey: ['product-meters-plant-locators', plantId] });
    qc.invalidateQueries({ queryKey: ['plants-summary-counts'] });
  };

  return {
    deleteTarget, setDeleteTarget, deleteReason, setDeleteReason, deleteBusy, doDelete,
    locatorOfflineTarget, setLocatorOfflineTarget, locatorOfflineBusy, setLocatorOfflineBusy, applyLocatorStatusChange, toggleLocatorStatus,
    locatorLockTarget, setLocatorLockTarget, locatorLockBusy, setLocatorLockBusy, applyLocatorLockStatus, handleLockCheckboxChange,
    selected, setSelected, bulkOpen, setBulkOpen, bulkReason, setBulkReason, bulkBusy, toggleOne, toggleAll, doBulkDelete,
  };
}