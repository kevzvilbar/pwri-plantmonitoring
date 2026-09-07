import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
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
import { KIND_COPY, type DeleteMenuProps, type DependencySnapshot } from './types';
import { useDeleteEntity } from './useDeleteEntity';

function DependencyReport({ deps, kind }: { deps: DependencySnapshot; kind: DeleteMenuProps['kind'] }) {
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
      <div className="rounded-md border border-accent/30 bg-accent/5 p-2 text-xs">
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

export function DeleteEntityMenu({
  kind, id, label, canSoftDelete, canHardDelete, invalidateKeys, onDeleted, compact, trigger,
}: DeleteMenuProps) {
  const { isAdmin } = useAuth();
  const {
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
    openHardWithDeps,
    promptForce,
  } = useDeleteEntity({ kind, id, label, canSoftDelete, canHardDelete, invalidateKeys, onDeleted, compact, trigger });

  if (!canSoftDelete && !canHardDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger ?? (
            <Button
              size={compact ? 'icon' : 'sm'}
              variant="outline"
              data-testid={`delete-menu-trigger-${kind}-${id}`}
              className={compact ? 'h-7 w-7' : ''}
            >
              {compact ? <MoreVertical className="h-4 w-4" /> : <><Trash2 className="h-3 w-3 mr-1" />Delete</>}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canSoftDelete && (
            <DropdownMenuItem
              onClick={() => { setReason(''); setOpenSoft(true); }}
              data-testid={`soft-delete-${kind}-${id}`}
            >
              <ShieldAlert className="h-4 w-4 mr-2 text-warn" />
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
            <Label htmlFor="deleteentitymenu-reason-optional" className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Staff change, restructuring, data correction…"
              maxLength={500}
              rows={2}
              data-testid="soft-delete-reason"
            id="deleteentitymenu-reason-optional"/>
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
            <Label htmlFor="deleteentitymenu-reason-min-5-chars-required-for-audit-log" className="text-xs text-muted-foreground">
              Reason <span className="text-danger">*</span>
              <span className="ml-1 text-2xs">(min 5 chars — required for audit log)</span>
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
            id="deleteentitymenu-reason-min-5-chars-required-for-audit-log"/>
            {reason.length > 0 && !reasonValid && (
              <p className="text-2xs text-danger">
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
              disabled={busy || loadingDeps || (deps?.blocking ?? false) || !reasonValid}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-hard-delete"
            >
              {(busy || loadingDeps) && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {loadingDeps ? 'Checking…' : deps?.blocking ? 'Blocked' : 'Delete permanently'}
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
                    className="mt-0.5 shrink-0"
                    data-testid="force-ack"
                  />
                  <span className="flex-1 min-w-0 break-words">
                    I understand dependencies will be orphaned and I am the Admin
                    accountable for this action.
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-wrap">
            <AlertDialogCancel disabled={busy} data-testid="cancel-force-delete">Cancel</AlertDialogCancel>
            {kind === 'plant' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => doHard(true, true)}
                disabled={busy || !forceAck || !reasonValid}
                className="border-warn text-warn hover:bg-warn/10 whitespace-nowrap"
                data-testid="archive-and-force-delete"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Archive &amp; delete
              </Button>
            )}
            <AlertDialogAction
              onClick={() => doHard(true)}
              disabled={busy || !forceAck || !reasonValid}
              className="bg-danger text-danger-foreground hover:bg-danger/90 whitespace-nowrap"
              data-testid="confirm-force-delete"
            >
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Force delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
