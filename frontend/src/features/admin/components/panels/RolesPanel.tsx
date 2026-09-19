import { useEffect, useMemo, useState } from 'react';
import {
  useCustomRoles, useCustomRoleOverrides,
  useCreateCustomRole, useDeleteCustomRole, useSaveCustomRoleOverrides,
} from '@/hooks/useCustomRoles';
import {
  MODULE_ORDER, MODULE_LABELS, LOCKED_MODULES, UNCONFIGURABLE_MODULES,
  PERMISSION_MATRIX, baseDefault, meaningfulOverrideCount,
  type Action, type ModuleKey, type Role, type RoleOverride,
} from '@/lib/permissions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { GitBranch, Lock, Plus, Trash2, Eye, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

const SYSTEM_ROLES: Role[] = ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'];
const COLUMNS: Action[] = ['view', 'edit', 'budget'];
const COLUMN_LABELS: Record<Action, string> = { view: 'View', edit: 'Edit', budget: 'Budget', delete: 'Delete' };

type Selection = { kind: 'system'; role: Role } | { kind: 'custom'; id: string };

/** Whether this module even has this action defined anywhere in the base
 *  matrix — modules that never define e.g. "budget" render "–" for it. */
function columnApplies(moduleKey: ModuleKey, action: Action): boolean {
  return PERMISSION_MATRIX[moduleKey]?.[action] !== undefined;
}

export function RolesPanel() {
  const { data: customRoles = [], isLoading: loadingRoles } = useCustomRoles();
  const [selection, setSelection] = useState<Selection>({ kind: 'system', role: 'Manager' });
  const [createOpen, setCreateOpen] = useState(false);
  const [createBaseRole, setCreateBaseRole] = useState<Role>('Manager');
  const [previewOpen, setPreviewOpen] = useState(false);

  const selectedCustom = selection.kind === 'custom' ? customRoles.find((r) => r.id === selection.id) : undefined;
  const baseRole: Role = selection.kind === 'system' ? selection.role : (selectedCustom?.base_role ?? 'Manager');

  const { data: savedOverrides = [], isLoading: loadingOverrides } = useCustomRoleOverrides(
    selection.kind === 'custom' ? selection.id : null,
  );

  // Local draft — only meaningful for a custom role. Resyncs whenever the
  // selected role or its saved overrides change (i.e. after load or save).
  const [draft, setDraft] = useState<RoleOverride[]>([]);
  useEffect(() => {
    setDraft(selection.kind === 'custom' ? savedOverrides : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.kind === 'custom' ? selection.id : 'system', savedOverrides.length, loadingOverrides]);

  const createRole = useCreateCustomRole();
  const deleteRole = useDeleteCustomRole();
  const saveOverrides = useSaveCustomRoleOverrides();

  const isCustom = selection.kind === 'custom';
  const unsavedCount = useMemo(() => {
    if (!isCustom) return 0;
    const a = [...draft].sort((x, y) => (x.module_key + x.action).localeCompare(y.module_key + y.action));
    const b = [...savedOverrides].sort((x, y) => (x.module_key + x.action).localeCompare(y.module_key + y.action));
    if (a.length !== b.length) return Math.max(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i].allowed !== b[i].allowed || a[i].module_key !== b[i].module_key || a[i].action !== b[i].action) diff++;
    return diff;
  }, [draft, savedOverrides, isCustom]);

  const overrideCount = meaningfulOverrideCount(baseRole, draft);

  function effective(moduleKey: ModuleKey, action: Action): boolean {
    if (LOCKED_MODULES.includes(moduleKey)) return baseDefault(baseRole, moduleKey, action);
    const found = draft.find((o) => o.module_key === moduleKey && o.action === action);
    return found ? found.allowed : baseDefault(baseRole, moduleKey, action);
  }

  function hasOverride(moduleKey: ModuleKey, action: Action): boolean {
    return draft.some((o) => o.module_key === moduleKey && o.action === action);
  }

  function toggle(moduleKey: ModuleKey, action: Action, next: boolean) {
    if (!isCustom || LOCKED_MODULES.includes(moduleKey)) return;
    setDraft((prev) => {
      const withoutThis = prev.filter((o) => !(o.module_key === moduleKey && o.action === action));
      const isDefault = next === baseDefault(baseRole, moduleKey, action);
      return isDefault ? withoutThis : [...withoutThis, { module_key: moduleKey, action, allowed: next }];
    });
  }

  function handleCancel() {
    setDraft(savedOverrides);
  }

  async function handleSave() {
    if (!isCustom) return;
    try {
      await saveOverrides.mutateAsync({ customRoleId: selection.id, toKeep: draft.filter((o) => o.allowed !== baseDefault(baseRole, o.module_key, o.action)) });
      toast.success('Role permissions saved');
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  async function handleCreate(name: string, base: Role) {
    try {
      const role = await createRole.mutateAsync({ name, base_role: base });
      toast.success(`"${role.name}" created — customize it below`);
      setSelection({ kind: 'custom', id: role.id });
      setCreateOpen(false);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  async function handleDelete(id: string, name: string) {
    try {
      await deleteRole.mutateAsync(id);
      toast.success(`"${name}" deleted`);
      setSelection({ kind: 'system', role: baseRole });
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  return (
    <div className="space-y-4" data-testid="roles-panel">
      {/* ── Role tabs ── */}
      <div className="flex flex-wrap items-center gap-2">
        {SYSTEM_ROLES.map((r) => (
          <button
            key={r}
            onClick={() => setSelection({ kind: 'system', role: r })}
            data-testid={`role-tab-system-${r}`}
            className={cn(
              'px-3.5 py-2 rounded-xl border text-left transition-all min-w-[100px] shadow-2xs',
              selection.kind === 'system' && selection.role === r
                ? 'border-primary bg-primary-soft text-primary font-semibold ring-1 ring-primary/30'
                : 'border-border/80 bg-card hover:bg-muted/70 text-foreground',
            )}
          >
            <div className="text-xs font-bold leading-tight">{r}</div>
            <div className="text-3xs text-muted-foreground uppercase font-semibold tracking-wider mt-0.5">System</div>
          </button>
        ))}

        {customRoles.map((cr) => (
          <button
            key={cr.id}
            onClick={() => setSelection({ kind: 'custom', id: cr.id })}
            data-testid={`role-tab-custom-${cr.id}`}
            className={cn(
              'px-3.5 py-2 rounded-xl border text-left transition-all min-w-[100px] shadow-2xs',
              selection.kind === 'custom' && selection.id === cr.id
                ? 'border-primary bg-primary-soft text-primary font-semibold ring-1 ring-primary/30'
                : 'border-border/80 bg-card hover:bg-muted/70 text-foreground',
            )}
          >
            <div className="text-xs font-bold leading-tight">{cr.name}</div>
            <div className="text-3xs text-muted-foreground uppercase font-semibold tracking-wider mt-0.5">Custom</div>
          </button>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="h-[46px] rounded-xl border-dashed border-border/90 px-3.5 text-xs font-semibold hover:bg-muted"
          onClick={() => { setCreateBaseRole(baseRole); setCreateOpen(true); }}
          data-testid="role-new-btn"
        >
          <Plus className="h-3.5 w-3.5 mr-1 text-primary" /> New role
        </Button>
      </div>

      {/* ── Context banner ── */}
      {isCustom ? (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-primary-soft border border-primary/40 rounded-xl text-xs shadow-2xs">
          <span className="flex items-center gap-1.5 text-primary font-medium">
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span>Based on <strong>{baseRole}</strong> · {overrideCount} override{overrideCount === 1 ? '' : 's'} from base</span>
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="text-danger font-semibold hover:underline flex items-center gap-1 shrink-0 text-xs" data-testid="role-delete-btn">
                <Trash2 className="h-3.5 w-3.5" /> Delete role
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{selectedCustom?.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Anyone currently assigned this role falls back to the plain {baseRole} permission set.
                  This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-danger hover:bg-danger/90"
                  onClick={() => selectedCustom && handleDelete(selectedCustom.id, selectedCustom.name)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-muted/60 border border-border/80 rounded-xl text-xs shadow-2xs">
          <span className="text-muted-foreground">
            System role — permissions are fixed here. Create a custom role to adjust individual modules.
          </span>
          <button
            className="text-primary font-semibold hover:underline flex items-center gap-1 shrink-0 text-xs"
            onClick={() => { setCreateBaseRole(baseRole); setCreateOpen(true); }}
            data-testid="role-duplicate-btn"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate as custom role
          </button>
        </div>
      )}

      {/* ── Permission table ── */}
      <Card className="overflow-hidden border border-border/80 shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[550px] text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="text-left font-medium px-4 py-2.5">Module</th>
              {COLUMNS.map((c) => (
                <th key={c} className="text-center font-medium px-4 py-2.5 w-24">{COLUMN_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_ORDER.map((m) => {
              const locked = LOCKED_MODULES.includes(m);
              const unconfigurable = UNCONFIGURABLE_MODULES.includes(m);
              return (
                <tr key={m} className="border-b last:border-b-0 hover:bg-muted/30" data-testid={`role-row-${m}`}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{MODULE_LABELS[m]}</span>
                    {locked && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Lock className="h-3 w-3 inline-block ml-1.5 -mt-0.5 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Admin console access can only be granted to the Admin role, to prevent accidental lockout.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </td>
                  {COLUMNS.map((action) => {
                    if (unconfigurable || !columnApplies(m, action)) {
                      return <td key={action} className="px-4 py-2.5 text-center text-muted-foreground">–</td>;
                    }
                    const on = effective(m, action);
                    const overridden = !locked && hasOverride(m, action);
                    return (
                      <td key={action} className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <Switch
                            checked={on}
                            disabled={!isCustom || locked}
                            onCheckedChange={(v) => toggle(m, action, v)}
                            data-testid={`role-toggle-${m}-${action}`}
                          />
                          {overridden && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Overrides the base role" />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      {/* ── Footer actions (custom roles only) ── */}
      {isCustom && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {unsavedCount > 0 ? `${unsavedCount} unsaved change${unsavedCount === 1 ? '' : 's'}` : 'No unsaved changes'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} data-testid="role-preview-btn">
              <Eye className="h-3.5 w-3.5 mr-1" /> Preview as role
            </Button>
            <Button variant="outline" size="sm" disabled={unsavedCount === 0} onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={unsavedCount === 0 || saveOverrides.isPending} onClick={handleSave} data-testid="role-save-btn">
              {saveOverrides.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}

      <CreateRoleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultBaseRole={createBaseRole}
        busy={createRole.isPending}
        onCreate={handleCreate}
      />

      <PreviewRoleDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        roleName={isCustom ? (selectedCustom?.name ?? '') : baseRole}
        baseRole={baseRole}
        overrides={draft}
      />

      {(loadingRoles || (isCustom && loadingOverrides)) && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}

// ── Create-role dialog ────────────────────────────────────────────────────────

function CreateRoleDialog({ open, onClose, defaultBaseRole, busy, onCreate }: {
  open: boolean; onClose: () => void; defaultBaseRole: Role; busy: boolean;
  onCreate: (name: string, base: Role) => void;
}) {
  const [name, setName] = useState('');
  const [base, setBase] = useState<Role>(defaultBaseRole);

  useEffect(() => { if (open) { setName(''); setBase(defaultBaseRole); } }, [open, defaultBaseRole]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New custom role</DialogTitle>
          <DialogDescription>Starts as an exact copy of the base role — customize modules after creating it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label htmlFor="rolespanel-role-name">Role name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Plant supervisor" data-testid="role-name-input" id="rolespanel-role-name"/>
          </div>
          <div>
            <Label htmlFor="rolespanel-based-on">Based on</Label>
            <Select value={base} onValueChange={(v) => setBase(v as Role)}>
              <SelectTrigger data-testid="role-base-select" id="rolespanel-based-on"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYSTEM_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || busy}
            onClick={() => onCreate(name.trim(), base)}
            data-testid="role-create-confirm-btn"
          >
            {busy ? 'Creating…' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Preview dialog ────────────────────────────────────────────────────────────
// Read-only summary of what this role (including unsaved draft changes) can
// actually do — a lightweight stand-in for full in-app impersonation.

function PreviewRoleDialog({ open, onClose, roleName, baseRole, overrides }: {
  open: boolean; onClose: () => void; roleName: string; baseRole: Role; overrides: RoleOverride[];
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{roleName || baseRole} — what this role can access</DialogTitle>
          <DialogDescription>Reflects any changes made below, even before they're saved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {MODULE_ORDER.filter((m) => !UNCONFIGURABLE_MODULES.includes(m)).map((m) => {
            const badges = COLUMNS.filter((a) => columnApplies(m, a)).filter((a) => {
              const locked = LOCKED_MODULES.includes(m);
              const found = overrides.find((o) => o.module_key === m && o.action === a);
              return locked ? baseDefault(baseRole, m, a) : (found ? found.allowed : baseDefault(baseRole, m, a));
            });
            if (badges.length === 0) return null;
            return (
              <div key={m} className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0">
                <span>{MODULE_LABELS[m]}</span>
                <div className="flex gap-1">
                  {badges.map((a) => <Badge key={a} variant="secondary" className="text-2xs">{COLUMN_LABELS[a]}</Badge>)}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
