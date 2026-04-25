import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trash2, MoreVertical, Loader2, ShieldAlert } from 'lucide-react';

type Kind = 'user' | 'plant';

const KIND_COPY: Record<Kind, { label: string; softName: string; softVerb: string }> = {
  user: { label: 'user', softName: 'Suspended', softVerb: 'Suspend' },
  plant: { label: 'plant', softName: 'Inactive', softVerb: 'Deactivate' },
};

interface Dependency {
  table?: string;
  column?: string;
  count: number;
}

interface DependencySnapshot {
  blocking: boolean;
  total_references: number;
  references: Dependency[];
  role_rows?: number;
  assigned_plants?: string[];
  assigned_users?: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function api<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
  const headers = await authHeaders();
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

interface DeleteMenuProps {
  kind: Kind;
  id: string;
  label: string;
  canSoftDelete: boolean;
  canHardDelete: boolean;
  invalidateKeys: string[][];
  onDeleted?: () => void;
  compact?: boolean;
}

export function DeleteEntityMenu({
  kind, id, label, canSoftDelete, canHardDelete, invalidateKeys, onDeleted, compact,
}: DeleteMenuProps) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [openSoft, setOpenSoft] = useState(false);
  const [openHard, setOpenHard] = useState(false);
  const [openForce, setOpenForce] = useState(false);
  const [forceAck, setForceAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [deps, setDeps] = useState<DependencySnapshot | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);

  const copy = KIND_COPY[kind];
  const entityPath = kind === 'user' ? 'users' : 'plants';
  const reasonValid = reason.trim().length >= 5;

  const resetAndClose = () => {
    setReason('');
    setDeps(null);
    setForceAck(false);
    setOpenSoft(false);
    setOpenHard(false);
    setOpenForce(false);
  };

  const doSoft = async () => {
    try {
      setBusy(true);
      await api('POST', `/api/admin/${entityPath}/${id}/soft-delete`, { reason });
      toast.success(`${copy.label[0].toUpperCase() + copy.label.slice(1)} marked ${copy.softName}`);
      invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: ['admin-audit-log'] });
      resetAndClose();
      onDeleted?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Soft delete failed');
    } finally {
      setBusy(false);
    }
  };

  const loadDeps = async () => {
    setLoadingDeps(true);
    try {
      const snap = await api<DependencySnapshot>(
        'GET',
        `/api/admin/${entityPath}/${id}/dependencies`,
      );
      setDeps(snap);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not load dependencies');
      setDeps(null);
    } finally {
      setLoadingDeps(false);
    }
  };

  const doHard = async (force = false, archive = false) => {
    if (!reasonValid) {
      toast.error('Please enter a reason of at least 5 characters.');
      return;
    }
    try {
      setBusy(true);
      const params = new URLSearchParams();
      if (reason) params.set('reason', reason);
      if (force) params.set('force', 'true');
      if (archive) params.set('archive', 'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const result = await api<{ archived?: boolean; archived_counts?: Record<string, number> }>(
        'DELETE', `/api/admin/${entityPath}/${id}${qs}`,
      );
      const cap = copy.label[0].toUpperCase() + copy.label.slice(1);
      if (archive && result?.archived) {
        const total = Object.values(result.archived_counts ?? {}).reduce(
          (a, b) => a + (Number(b) || 0), 0,
        );
        toast.success(`${cap} deleted — ${total} dependent row(s) archived`);
      } else if (force) {
        toast.success(`${cap} force-deleted (dependencies orphaned)`);
      } else {
        toast.success(`${cap} permanently deleted`);
      }
      invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: ['admin-audit-log'] });
      resetAndClose();
      onDeleted?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Hard delete failed');
    } finally {
      setBusy(false);
    }
  };

  const openHardWithDeps = async () => {
    setReason('');
    setDeps(null);
    setForceAck(false);
    await loadDeps();
    setOpenHard(true);
  };

  const promptForce = () => {
    setOpenHard(false);
    setOpenForce(true);
  };

  if (!canSoftDelete && !canHardDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={compact ? 'icon' : 'sm'}
            variant="outline"
            data-testid={`delete-menu-trigger-${kind}-${id}`}
            className={compact ? 'h-7 w-7' : ''}
          >
            {compact ? <MoreVertical className="h-4 w-4" /> : <><Trash2 className="h-3 w-3 mr-1" />Delete</>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canSoftDelete && (
            <DropdownMenuItem
              onClick={() => { setReason(''); setOpenSoft(true); }}
              data-testid={`soft-delete-${kind}-${id}`}
            >
              <ShieldAlert className="h-4 w-4 mr-2 text-amber-500" />
              {copy.softVerb} ({copy.softName})
            </DropdownMenuItem>
          )}
          {canHardDelete && (
            <DropdownMenuItem
              onClick={openHardWithDeps}
              className="text-danger focus:text-danger"
              data-testid={`hard-delete-${kind}-${id}`}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Permanently delete…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={openSoft} onOpenChange={(o) => (o ? setOpenSoft(true) : resetAndClose())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.softVerb} {copy.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks <strong>{label}</strong> as <strong>{copy.softName}</strong>.
              {kind === 'user'
                ? ' They will not be able to sign in. Existing logs and records are kept for audit.'
                : ' Wells, locators and trains linked to this plant remain but the plant is hidden from active lists.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Staff change, restructuring, data correction…"
              maxLength={500}
              rows={2}
              data-testid="soft-delete-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="cancel-soft-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doSoft}
              disabled={busy}
              data-testid="confirm-soft-delete"
            >
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={openHard} onOpenChange={(o) => (o ? setOpenHard(true) : resetAndClose())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {copy.label}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  This will permanently remove <strong>{label}</strong>. This action cannot be undone.
                </p>
                {loadingDeps && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking dependencies…
                  </div>
                )}
                {deps && <DependencyReport deps={deps} kind={kind} />}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Reason <span className="text-danger">*</span>
              <span className="ml-1 text-[10px]">(min 5 chars — required for audit log)</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you permanently deleting this record?"
              maxLength={500}
              rows={2}
              data-testid="hard-delete-reason"
              aria-invalid={reason.length > 0 && !reasonValid}
              className={reason.length > 0 && !reasonValid ? 'border-danger' : ''}
            />
            {reason.length > 0 && !reasonValid && (
              <p className="text-[10px] text-danger">
                Reason must be at least 5 characters ({reason.trim().length}/5).
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="cancel-hard-delete">Cancel</AlertDialogCancel>
            {deps?.blocking && isAdmin && (
              <Button
                type="button"
                variant="outline"
                className="border-danger text-danger hover:bg-danger/10"
                onClick={promptForce}
                disabled={busy || loadingDeps || !reasonValid}
                data-testid="force-hard-delete"
              >
                Force delete (override)
              </Button>
            )}
            <AlertDialogAction
              onClick={() => doHard(false)}
              disabled={busy || loadingDeps || (deps?.blocking ?? true) || !reasonValid}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-hard-delete"
            >
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {deps?.blocking ? 'Blocked' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={openForce}
        onOpenChange={(o) => (o ? setOpenForce(true) : resetAndClose())}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> Force delete — orphan dependencies?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  <strong>{label}</strong> is referenced by <strong>
                    {deps?.total_references ?? 0}
                  </strong> record(s) across the system. Forcing the delete will:
                </p>
                <ul className="list-disc ml-5 space-y-0.5 text-xs">
                  <li>Permanently remove the {copy.label} row(s).</li>
                  {kind === 'user' && <li>Leave <code>recorded_by</code>/<code>performed_by</code>/<code>replaced_by</code> pointers dangling on existing logs.</li>}
                  {kind === 'plant' && <li>Leave wells, locators, readings and related logs pointing at a missing plant.</li>}
                  <li>Be recorded in the audit log with a <strong>[FORCE]</strong> marker.</li>
                </ul>
                <div className="rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
                  This action is irreversible. Prefer <em>Suspend/Deactivate</em> unless
                  regulatory or legal reasons require a hard delete.
                </div>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forceAck}
                    onChange={(e) => setForceAck(e.target.checked)}
                    className="mt-0.5"
                    data-testid="force-ack"
                  />
                  <span>
                    I understand dependencies will be orphaned and I am the Admin
                    accountable for this action.
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="cancel-force-delete">Cancel</AlertDialogCancel>
            {kind === 'plant' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => doHard(true, true)}
                disabled={busy || !forceAck || !reasonValid}
                className="border-amber-500 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                data-testid="archive-and-force-delete"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Archive readings &amp; delete
              </Button>
            )}
            <AlertDialogAction
              onClick={() => doHard(true)}
              disabled={busy || !forceAck || !reasonValid}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-force-delete"
            >
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Force delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DependencyReport({ deps, kind }: { deps: DependencySnapshot; kind: Kind }) {
  const extras: { label: string; count: number }[] = [];
  if (kind === 'user') {
    if (deps.role_rows) extras.push({ label: 'Role assignments', count: deps.role_rows });
    if (deps.assigned_plants?.length) extras.push({ label: 'Assigned plants', count: deps.assigned_plants.length });
  } else if (kind === 'plant') {
    if (deps.assigned_users) extras.push({ label: 'Users assigned to this plant', count: deps.assigned_users });
  }
  const hasAny = deps.references.length > 0 || extras.length > 0;

  if (!hasAny) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
        No dependent records found. Safe to permanently delete.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-2 text-xs space-y-1">
      <div className="font-semibold text-danger">Dependencies found — cannot hard-delete:</div>
      <ul className="list-disc ml-4 space-y-0.5">
        {extras.map((e) => (
          <li key={e.label}>{e.label}: <strong>{e.count}</strong></li>
        ))}
        {deps.references.map((r) => (
          <li key={r.table}>
            {r.table}{r.column ? ` (${r.column})` : ''}: <strong>{r.count}</strong>
          </li>
        ))}
      </ul>
      <div className="text-muted-foreground mt-1">
        Use <em>{kind === 'user' ? 'Suspend' : 'Deactivate'}</em> instead, or archive/reassign the linked records first.
      </div>
    </div>
  );
}
