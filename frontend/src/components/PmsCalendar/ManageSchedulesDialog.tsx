import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { ResponsiveDialog, ResponsiveAlertDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Loader2 } from 'lucide-react';
import type { Template } from './pmsTypes';

export function ManageSchedulesDialog({ templates, onClose }: {
  templates: Template[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const sorted = useMemo(
    () => [...templates].sort((a, b) =>
      a.equipment_name.localeCompare(b.equipment_name) || a.frequency.localeCompare(b.frequency)),
    [templates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(t =>
      t.equipment_name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [sorted, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Template[]>();
    filtered.forEach(t => {
      const arr = map.get(t.equipment_name) ?? [];
      arr.push(t);
      map.set(t.equipment_name, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (ids: string[]) => {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id));
      const next = new Set(prev);
      ids.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(t => t.id)));
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkDeletePending(false);
    setBulkDeleting(true);
    try {
      const { error } = await supabase.from('checklist_templates').delete().in('id', ids);
      if (error) throw error;
      toast.success(`Deleted ${ids.length} PMS schedule${ids.length === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['pms-templates'] });
      qc.invalidateQueries({ queryKey: ['pms-executions'] });
      setSelectedIds(new Set());
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBulkDeleting(false);
    }
  };

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;

  return (
    <>
      <ResponsiveDialog
        open
        onOpenChange={(o) => { if (!o && !bulkDeleting) onClose(); }}
        title="Manage PMS Schedules"
        description="Select one or more schedules — or an equipment's full set of frequencies — to delete.
          This removes every occurrence and its checklist history and cannot be undone."
        className="max-w-lg w-[95vw]"
        bodyScroll={false}
        footer={(
          <Button variant="outline" onClick={onClose} disabled={bulkDeleting}>Close</Button>
        )}
      >
        <div className="flex flex-col gap-3 h-full min-h-0 pb-1">
          <Input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by equipment or category…"
            className="h-8 text-xs shrink-0" data-testid="input-manage-filter" />

          <div className="flex items-center justify-between shrink-0">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll}
                disabled={!filtered.length} data-testid="checkbox-select-all-schedules" />
              Select all ({filtered.length})
            </label>
            {selectedIds.size > 0 && (
              <button type="button"
                className="text-2xs text-muted-foreground underline underline-offset-2"
                onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
            {!filtered.length ? (
              <p className="text-xs text-muted-foreground text-center py-6">No schedules match.</p>
            ) : (
              groups.map(([equipment, rows]) => {
                const ids = rows.map(r => r.id);
                const groupSelected = ids.every(id => selectedIds.has(id));
                const groupPartial = !groupSelected && ids.some(id => selectedIds.has(id));
                return (
                  <div key={equipment} className="rounded-md border overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/60 border-b">
                      <Checkbox checked={groupPartial ? 'indeterminate' : groupSelected}
                        onCheckedChange={() => toggleGroup(ids)}
                        data-testid={`checkbox-group-${equipment}`} />
                      <span className="text-xs font-semibold flex-1 truncate">{equipment}</span>
                      <span className="text-2xs text-muted-foreground shrink-0">
                        {rows.length} schedule{rows.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="divide-y">
                      {rows.map(t => (
                        <label key={t.id}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-secondary/40">
                          <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleOne(t.id)}
                            data-testid={`checkbox-schedule-${t.id}`} />
                          <span className="flex-1 min-w-0 truncate text-muted-foreground">{t.category}</span>
                          <span className="shrink-0 text-2xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {t.frequency}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 shrink-0">
              <span className="text-xs font-medium text-danger flex-1">
                {selectedIds.size} schedule{selectedIds.size > 1 ? 's' : ''} selected
              </span>
              <Button size="sm" className="h-7 px-3 text-xs gap-1.5 bg-danger text-danger-foreground hover:bg-danger/90"
                onClick={() => setBulkDeletePending(true)} disabled={bulkDeleting}
                data-testid="button-bulk-delete-schedules">
                {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete selected
              </Button>
            </div>
          )}
        </div>
      </ResponsiveDialog>

      <ResponsiveAlertDialog
        open={bulkDeletePending}
        onOpenChange={(o) => { if (!o) setBulkDeletePending(false); }}
        title={(
          <span className="text-danger">
            Delete {selectedIds.size} PMS schedule{selectedIds.size === 1 ? '' : 's'}?
          </span>
        )}
        description="This permanently removes the selected schedules — every past and future occurrence and
          their checklist history. This cannot be undone."
        footer={(
          <div className="flex gap-2 justify-end w-full">
            <Button variant="outline" disabled={bulkDeleting} data-testid="button-cancel-bulk-delete"
              onClick={() => setBulkDeletePending(false)}>
              Cancel
            </Button>
            <Button onClick={bulkDelete} disabled={bulkDeleting}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="button-confirm-bulk-delete">
              {bulkDeleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {bulkDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        )}
      >
        {null}
      </ResponsiveAlertDialog>
    </>
  );
}
