import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { PlantAssignmentEditor } from '@/components/PlantAssignmentEditor';
import {
  DesignationCombobox, accessLevelFromRoles,
} from '@/components/DesignationCombobox';
import { toast } from '@/components/ui/sonner';
import {
  ShieldAlert, Users, Building2, Search, ClipboardList, Sparkles, Loader2, Trash2,
} from 'lucide-react';
import { format } from 'date-fns';

export default function Admin() {
  const { isAdmin, isManager, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!isManager) {
    return (
      <Card className="p-6 text-center space-y-2" data-testid="admin-access-denied">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Only Admin or Manager can access the admin console.
        </p>
        <button
          className="text-sm text-accent hover:underline"
          onClick={() => navigate('/')}
        >
          Back to dashboard
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in" data-testid="admin-page">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin console</h1>
        <p className="text-xs text-muted-foreground">
          Manage users, plants, and the deletion audit trail. Soft-delete keeps
          audit history; hard-delete is blocked while dependencies exist (Admin
          can override with explicit confirmation).
        </p>
      </div>
      <Tabs defaultValue={isAdmin ? 'users' : 'plants'}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="users" disabled={!isAdmin} data-testid="admin-tab-users">
            <Users className="h-3 w-3 mr-1" /> Users
          </TabsTrigger>
          <TabsTrigger value="plants" data-testid="admin-tab-plants">
            <Building2 className="h-3 w-3 mr-1" /> Plants
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="admin-tab-audit">
            <ClipboardList className="h-3 w-3 mr-1" /> Audit log
          </TabsTrigger>
        </TabsList>
        {isAdmin && (
          <TabsContent value="users" className="mt-3">
            <UsersPanel />
          </TabsContent>
        )}
        <TabsContent value="plants" className="mt-3">
          <PlantsPanel />
        </TabsContent>
        <TabsContent value="audit" className="mt-3">
          <AuditLogPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const { data: staff } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () =>
      (await supabase.from('user_profiles').select('*').order('last_name')).data ?? [],
  });
  const { data: roles } = useQuery({
    queryKey: ['admin-user-roles'],
    queryFn: async () =>
      (await supabase.from('user_roles').select('user_id, role')).data ?? [],
  });
  const rolesOf = (uid: string): string[] =>
    (roles ?? []).filter((r: any) => r.user_id === uid).map((r: any) => r.role as string);

  const updateDesignation = async (uid: string, designation: string) => {
    const { error } = await supabase
      .from('user_profiles')
      .update({ designation })
      .eq('id', uid);
    if (error) { toast.error(error.message); return; }
    toast.success('Designation updated');
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['staff'] });
  };

  const existingDesignations = useMemo(
    () =>
      Array.from(
        new Set(((staff ?? []) as any[]).map((s) => s.designation).filter(Boolean)),
      ) as string[],
    [staff],
  );

  const filtered = useMemo(() => {
    const list = staff ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s: any) =>
      [s.first_name, s.last_name, s.username, s.designation]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q)),
    );
  }, [staff, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          placeholder="Search by name, username, designation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          data-testid="admin-users-search"
        />
      </div>
      {filtered.map((s: any) => {
        const userRoles = rolesOf(s.id);
        const access = accessLevelFromRoles(userRoles);
        return (
          <Card key={s.id} className="p-3 space-y-2" data-testid={`admin-user-card-${s.id}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 space-y-1">
                <div className="font-medium text-sm truncate">
                  {s.first_name} {s.last_name} {s.suffix}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  @{s.username ?? '—'}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {userRoles.length === 0 && (
                    <Badge variant="secondary" className="text-[10px]">No role</Badge>
                  )}
                  {userRoles.map((r) => (
                    <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                  ))}
                  <StatusPill tone={access.tone}>{access.label}</StatusPill>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusPill tone={s.status === 'Active' ? 'accent' : s.status === 'Pending' ? 'warn' : 'muted'}>
                  {s.status}
                </StatusPill>
                <DeleteEntityMenu
                  kind="user"
                  id={s.id}
                  label={`${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || (s.username ?? 'user')}
                  canSoftDelete={s.status === 'Active'}
                  canHardDelete
                  invalidateKeys={[['admin-users'], ['admin-user-roles'], ['staff'], ['all-roles']]}
                  compact
                />
              </div>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-2 items-center pt-1 border-t">
              <span className="text-xs text-muted-foreground">Designation</span>
              <DesignationCombobox
                value={s.designation ?? ''}
                onChange={(v) => updateDesignation(s.id, v)}
                extraOptions={existingDesignations}
                data-testid={`admin-designation-${s.id}`}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs pt-1">
              <span className="text-muted-foreground">
                {(s.plant_assignments ?? []).length} plant
                {(s.plant_assignments ?? []).length === 1 ? '' : 's'} assigned
              </span>
              <PlantAssignmentEditor
                userId={s.id}
                userLabel={`${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || (s.username ?? 'user')}
                currentPlantIds={s.plant_assignments ?? []}
                invalidateKeys={[['admin-users'], ['staff']]}
              />
            </div>
          </Card>
        );
      })}
      {filtered.length === 0 && (
        <Card className="p-4 text-center text-xs text-muted-foreground">No users</Card>
      )}
    </div>
  );
}

// Pre-curated names of plants known to have been imported by mistake via the
// Smart Import flow. The Admin can still edit/uncheck before running.
const SUGGESTED_BAD_IMPORTS = ['Mambaling 3', 'SRP MCWD'] as const;

function BadImportCleanupCard() {
  const qc = useQueryClient();
  const { data: plants } = usePlants();

  // Default-tick the suggested ones if they actually exist in the DB.
  const initialSelection = useMemo<Set<string>>(() => {
    const existing = new Set((plants ?? []).map((p) => p.name));
    return new Set(SUGGESTED_BAD_IMPORTS.filter((n) => existing.has(n)));
  }, [plants]);

  const [selected, setSelected] = useState<Set<string>>(initialSelection);
  const [reason, setReason] = useState('Smart importation error cleanup');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<null | {
    processed: { name: string; plant_id: string; deleted_counts: Record<string, number> }[];
    not_found: string[];
  }>(null);

  // Sync the auto-selected suggestion list with the latest plants query.
  // (Without this, a freshly-loaded plants list arrives after `selected`
  // has already been initialized to an empty set on first render.)
  if (
    selected.size === 0 &&
    initialSelection.size > 0 &&
    [...initialSelection].some((n) => !selected.has(n))
  ) {
    setTimeout(() => setSelected(initialSelection), 0);
  }

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const filteredPlants = (plants ?? []).filter(
    (p) => SUGGESTED_BAD_IMPORTS.includes(p.name as any) || selected.has(p.name),
  );

  const reasonValid = reason.trim().length >= 5;
  const canRun = selected.size > 0 && reasonValid && !busy;

  const runCleanup = async () => {
    if (!canRun) return;
    setBusy(true);
    setLastResult(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Sign in as Admin first.');
      const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const res = await fetch(`${base}/api/admin/plants/cleanup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ names: Array.from(selected), reason: reason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg =
          typeof json?.detail === 'string' ? json.detail
          : typeof json?.detail === 'object' ? JSON.stringify(json.detail)
          : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const removed = (json.processed ?? []).length;
      const skipped = (json.not_found ?? []).length;
      setLastResult({
        processed: json.processed ?? [],
        not_found: json.not_found ?? [],
      });
      toast.success(
        `Cleanup complete — ${removed} plant${removed === 1 ? '' : 's'} removed${
          skipped ? `, ${skipped} skipped (not found)` : ''
        }.`,
      );
      // Bust caches that depend on plants.
      qc.invalidateQueries({ queryKey: ['plants'] });
      qc.invalidateQueries({ queryKey: ['plants-well-counts'] });
      qc.invalidateQueries({ queryKey: ['admin-audit-log'] });
      qc.invalidateQueries({ queryKey: ['staff'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setSelected(new Set());
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Cleanup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className="p-3 border-amber-500/30 bg-amber-500/5"
      data-testid="bad-import-cleanup-card"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-0.5 text-amber-600" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h3 className="text-sm font-semibold">
              Cleanup imported-by-mistake plants
            </h3>
            <p className="text-[11px] text-muted-foreground">
              One-click hard-delete of plants imported in error via Smart Import.
              Removes the plant + all wells, locators, RO trains, readings, logs,
              and assignments. Each removal is recorded in the audit log with a{' '}
              <code className="text-[10px]">[CLEANUP]</code> tag.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              Plants to delete
            </Label>
            {filteredPlants.length === 0 && (
              <p className="text-xs text-muted-foreground italic" data-testid="cleanup-no-targets">
                No suggested plants found in the database.
              </p>
            )}
            {filteredPlants.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-0.5 hover:bg-muted/40"
                data-testid={`cleanup-plant-row-${p.name}`}
              >
                <Checkbox
                  checked={selected.has(p.name)}
                  onCheckedChange={() => toggle(p.name)}
                  data-testid={`cleanup-checkbox-${p.name}`}
                />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {p.address ?? '—'}
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              Reason <span className="text-danger">*</span>{' '}
              <span className="text-[10px]">(min 5 chars — required for audit log)</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              data-testid="cleanup-reason"
              aria-invalid={reason.length > 0 && !reasonValid}
              className={reason.length > 0 && !reasonValid ? 'border-danger' : ''}
            />
            {reason.length > 0 && !reasonValid && (
              <p className="text-[10px] text-danger">
                Reason must be at least 5 characters ({reason.trim().length}/5).
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="border-danger text-danger hover:bg-danger/10"
              onClick={() => setConfirmOpen(true)}
              disabled={!canRun}
              data-testid="cleanup-run-btn"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Run cleanup ({selected.size})
            </Button>
          </div>

          {lastResult && (
            <div
              className="rounded-md border bg-card p-2 text-xs space-y-1"
              data-testid="cleanup-last-result"
            >
              <div className="font-semibold">Last cleanup summary</div>
              {lastResult.processed.map((p) => {
                const total = Object.values(p.deleted_counts).reduce(
                  (s, n) => s + (+n || 0), 0,
                );
                return (
                  <div key={p.plant_id} className="text-muted-foreground">
                    <strong className="text-foreground">{p.name}</strong> —{' '}
                    {total} row(s) removed across{' '}
                    {Object.keys(p.deleted_counts).length} table(s).
                  </div>
                );
              })}
              {lastResult.not_found.length > 0 && (
                <div className="text-amber-600">
                  Skipped (not found): {lastResult.not_found.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !o && !busy && setConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {selected.size} plant
              {selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will hard-delete:</p>
                <ul className="list-disc ml-5 text-xs space-y-0.5">
                  {Array.from(selected).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Every well, locator, RO train, reading, replacement log, and
                  user-plant assignment for these plants will be removed. The
                  action is irreversible.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="cleanup-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={runCleanup}
              disabled={busy}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="cleanup-confirm"
            >
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Confirm cleanup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PlantsPanel() {
  const { isAdmin } = useAuth();
  const { data: plants } = usePlants();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const list = plants ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      [p.name, p.address]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [plants, query]);

  return (
    <div className="space-y-2">
      {isAdmin && <BadImportCleanupCard />}
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          placeholder="Search by name or address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          data-testid="admin-plants-search"
        />
      </div>
      {filtered.map((p) => (
        <Card key={p.id} className="p-3" data-testid={`admin-plant-card-${p.id}`}>
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">{p.address ?? '—'}</div>
              <div className="text-xs mt-1 flex flex-wrap gap-x-3">
                <span>RO trains: <strong>{p.num_ro_trains}</strong></span>
                <span>Capacity: <strong>{p.design_capacity_m3 ?? '—'} m³</strong></span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill tone={p.status === 'Active' ? 'accent' : 'muted'}>{p.status}</StatusPill>
              <DeleteEntityMenu
                kind="plant"
                id={p.id}
                label={p.name}
                canSoftDelete={p.status === 'Active'}
                canHardDelete
                invalidateKeys={[['plants']]}
                compact
              />
            </div>
          </div>
        </Card>
      ))}
      {filtered.length === 0 && (
        <Card className="p-4 text-center text-xs text-muted-foreground">No plants</Card>
      )}
    </div>
  );
}

interface AuditEntry {
  id: string;
  kind: 'user' | 'plant';
  entity_id: string;
  entity_label: string | null;
  action: 'soft' | 'hard';
  actor_user_id: string | null;
  actor_label: string | null;
  reason: string | null;
  dependencies: Record<string, unknown> | null;
  created_at: string;
}

function AuditLogPanel() {
  const [kindFilter, setKindFilter] = useState<'all' | 'user' | 'plant'>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-log', kindFilter],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Sign in required');
      const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const qs = kindFilter === 'all' ? '' : `?kind=${kindFilter}`;
      const res = await fetch(`${base}/api/admin/audit-log${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Audit log fetch failed: ${res.status}`);
      return (await res.json()) as {
        count: number;
        entries: AuditEntry[];
        warning?: string;
        table_missing?: boolean;
      };
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(['all', 'user', 'plant'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className={`px-3 py-1 text-xs rounded-md border transition-colors ${
              kindFilter === k
                ? 'bg-accent text-accent-foreground border-accent'
                : 'bg-card hover:bg-muted'
            }`}
            data-testid={`audit-filter-${k}`}
          >
            {k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1) + 's'}
          </button>
        ))}
      </div>
      {data?.table_missing && (
        <Card className="p-3 text-xs text-amber-600 border-amber-500/30 bg-amber-500/5">
          <strong>Audit log table not yet created.</strong> Run{' '}
          <code>supabase/migrations/20260424_deletion_audit_log.sql</code> in your
          Supabase project (SQL editor) to enable full audit history. Deletions
          will still execute — they just won't be logged until the migration runs.
        </Card>
      )}
      {data?.warning && !data?.table_missing && (
        <Card className="p-3 text-xs text-amber-600 border-amber-500/30 bg-amber-500/5">
          Audit log warning: <code>{data.warning}</code>
        </Card>
      )}
      {isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Loading…</Card>
      )}
      {(data?.entries ?? []).map((e) => (
        <Card key={e.id} className="p-3 space-y-1" data-testid={`audit-entry-${e.id}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="capitalize">{e.kind}</Badge>
              <Badge
                variant={e.action === 'hard' ? 'destructive' : 'secondary'}
                className="capitalize"
              >
                {e.action === 'hard' ? 'Hard delete' : 'Soft delete'}
              </Badge>
              {e.reason?.startsWith('[FORCE]') && (
                <Badge className="bg-danger text-danger-foreground">FORCE</Badge>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(e.created_at), 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
          <div className="text-sm">
            <strong>{e.entity_label ?? e.entity_id}</strong>
            <span className="text-muted-foreground"> · by {e.actor_label ?? e.actor_user_id ?? '—'}</span>
          </div>
          {e.reason && (
            <div className="text-xs text-muted-foreground italic">"{e.reason}"</div>
          )}
        </Card>
      ))}
      {!isLoading && (data?.entries?.length ?? 0) === 0 && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          No deletion events recorded yet.
        </Card>
      )}
    </div>
  );
}
