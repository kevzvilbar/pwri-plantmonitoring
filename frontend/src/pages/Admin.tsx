import { useEffect, useMemo, useState } from 'react';
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
  ShieldAlert, Users, Building2, Search, ClipboardList, Sparkles, Loader2, Trash2, Hourglass,
  ChevronDown, ChevronUp, Database, Copy, CheckCircle2, AlertTriangle, RefreshCcw, FileCode,
  Download, ExternalLink,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

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
        <TabsList className={isAdmin ? 'grid grid-cols-4 w-full' : 'grid grid-cols-3 w-full'}>
          <TabsTrigger value="users" disabled={!isAdmin} data-testid="admin-tab-users">
            <Users className="h-3 w-3 mr-1" /> Users
          </TabsTrigger>
          <TabsTrigger value="plants" data-testid="admin-tab-plants">
            <Building2 className="h-3 w-3 mr-1" /> Plants
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="admin-tab-audit">
            <ClipboardList className="h-3 w-3 mr-1" /> Audit log
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="migrations" data-testid="admin-tab-migrations">
              <Database className="h-3 w-3 mr-1" /> Migrations
            </TabsTrigger>
          )}
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
        {isAdmin && (
          <TabsContent value="migrations" className="mt-3">
            <MigrationsPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
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

  const approveUser = async (uid: string, label: string) => {
    const { error } = await supabase.rpc('approve_user' as any, {
      _user_id: uid,
      _approve: true,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success(`${label || 'User'} approved`);
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

  const pendingCount = useMemo(
    () =>
      ((staff ?? []) as any[]).filter(
        (s) => s.confirmed === false || s.status === 'Pending',
      ).length,
    [staff],
  );

  const filtered = useMemo(() => {
    let list = (staff ?? []) as any[];
    if (pendingOnly) {
      list = list.filter((s) => s.confirmed === false || s.status === 'Pending');
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [s.first_name, s.last_name, s.username, s.designation]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q)),
    );
  }, [staff, query, pendingOnly]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search by name, username, designation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            data-testid="admin-users-search"
          />
        </div>
        <Button
          size="sm"
          variant={pendingOnly ? 'default' : 'outline'}
          onClick={() => setPendingOnly((v) => !v)}
          data-testid="admin-users-pending-filter"
        >
          <Hourglass className="h-3 w-3 mr-1" />
          Pending {pendingCount > 0 && `· ${pendingCount}`}
        </Button>
      </div>
      {filtered.map((s: any) => {
        const userRoles = rolesOf(s.id);
        const access = accessLevelFromRoles(userRoles);
        const awaiting = s.confirmed === false || s.status === 'Pending';
        return (
          <Card key={s.id} className="p-3 space-y-2" data-testid={`admin-user-card-${s.id}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 space-y-1">
                <div className="font-medium text-sm truncate flex items-center gap-1.5 flex-wrap">
                  <span>{s.first_name} {s.last_name} {s.suffix}</span>
                  {awaiting && (
                    <Badge
                      className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100"
                      data-testid={`pending-badge-${s.id}`}
                    >
                      <Hourglass className="h-2.5 w-2.5 mr-0.5" /> Awaiting approval
                    </Badge>
                  )}
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
                {awaiting && (
                  <Button
                    size="sm"
                    onClick={() =>
                      approveUser(
                        s.id,
                        `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() ||
                          (s.username ?? 'user'),
                      )
                    }
                    data-testid={`approve-user-${s.id}`}
                  >
                    Approve
                  </Button>
                )}
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
        <Card className="p-4 text-center text-xs text-muted-foreground">
          {pendingOnly ? 'No pending approvals.' : 'No users'}
        </Card>
      )}
    </div>
  );
}

// Pre-curated names of plants known to have been imported by mistake via the
// Smart Import flow. The Admin can still edit/uncheck before running.
const SUGGESTED_BAD_IMPORTS = ['Mambaling 3', 'SRP MCWD'] as const;

const REASON_TEMPLATES: { label: string; value: string }[] = [
  { label: 'Smart import error', value: 'Smart importation error cleanup' },
  { label: 'Duplicate entry',    value: 'Duplicate plant entry — removing duplicate' },
  { label: 'Test data',          value: 'Test data created during onboarding' },
  { label: 'Wrong region',       value: 'Plant assigned to the wrong region — replaced' },
  { label: 'User request',       value: 'Removed at user request' },
];

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
  const [reasonExpanded, setReasonExpanded] = useState(false);
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] text-muted-foreground">
                Reason <span className="text-danger">*</span>{' '}
                <span className="text-[10px]">(min 5 chars — required for audit log)</span>
              </Label>
              <button
                type="button"
                onClick={() => setReasonExpanded((v) => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                data-testid="cleanup-reason-expand"
                aria-expanded={reasonExpanded}
              >
                {reasonExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {reasonExpanded ? 'Compact' : 'Expand'}
              </button>
            </div>

            {/* Quick-select reason templates */}
            <div className="flex flex-wrap gap-1" data-testid="cleanup-reason-templates">
              {REASON_TEMPLATES.map((t) => {
                const active = reason.trim() === t.value;
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setReason(t.value)}
                    className={`text-[10px] rounded-full px-2 py-0.5 border transition-colors ${
                      active
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-800 dark:text-amber-200'
                        : 'bg-card hover:bg-muted/50 border-border text-muted-foreground'
                    }`}
                    data-testid={`cleanup-reason-template-${t.label}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={reasonExpanded ? 4 : 1}
              maxLength={500}
              placeholder="Pick a template above or type your own…"
              data-testid="cleanup-reason"
              aria-invalid={reason.length > 0 && !reasonValid}
              className={`text-xs resize-none ${reason.length > 0 && !reasonValid ? 'border-danger' : ''}`}
            />
            {reason.length > 0 && !reasonValid && (
              <p className="text-[10px] text-danger">
                Reason must be at least 5 characters ({reason.trim().length}/5).
              </p>
            )}

            {/* Audit preview — mirrors backend, which writes ONE row per plant
               with reason="[CLEANUP] <reason>" against entity_label=<plant>. */}
            {selected.size > 0 && reasonValid && (
              <div
                className="rounded-md bg-muted/40 border border-border/60 px-2 py-1.5 text-[10px] font-mono text-muted-foreground space-y-0.5"
                data-testid="cleanup-audit-preview"
              >
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 not-italic">
                  audit log preview ({selected.size} {selected.size === 1 ? 'entry' : 'entries'})
                </div>
                {Array.from(selected).map((n) => (
                  <div key={n} className="truncate">
                    <span className="text-foreground">{n}</span>
                    {' → reason: '}
                    <span className="text-foreground">[CLEANUP] {reason.trim()}</span>
                  </div>
                ))}
              </div>
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
                <div
                  className="rounded-md bg-muted/50 border border-border/60 px-2 py-1.5 text-[11px] font-mono text-muted-foreground space-y-0.5"
                  data-testid="cleanup-confirm-preview"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    audit log — {selected.size} {selected.size === 1 ? 'entry' : 'entries'}
                  </div>
                  {Array.from(selected).map((n) => (
                    <div key={n} className="truncate">
                      <span className="text-foreground">{n}</span>
                      {' → reason: '}
                      <span className="text-foreground">[CLEANUP] {reason.trim()}</span>
                    </div>
                  ))}
                </div>
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
      {/* Sticky search keeps Search-by-name accessible while scrolling the list. */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-1 bg-background/85 backdrop-blur-sm border-b border-border/40">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search by name or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            data-testid="admin-plants-search"
          />
          {query && (
            <span className="absolute right-2.5 top-2 text-[10px] text-muted-foreground" data-testid="admin-plants-count">
              {filtered.length} / {plants?.length ?? 0}
            </span>
          )}
        </div>
      </div>
      {filtered.map((p) => {
        const active = p.status === 'Active';
        return (
          <Card
            key={p.id}
            className={`p-3 border-l-4 transition-colors ${
              active
                ? 'border-l-emerald-500/70 bg-gradient-to-r from-emerald-50/40 to-transparent dark:from-emerald-950/20'
                : 'border-l-muted-foreground/40 bg-muted/20 opacity-90'
            }`}
            data-testid={`admin-plant-card-${p.id}`}
          >
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
                <StatusPill tone={active ? 'accent' : 'muted'}>{p.status}</StatusPill>
                <DeleteEntityMenu
                  kind="plant"
                  id={p.id}
                  label={p.name}
                  canSoftDelete={active}
                  canHardDelete
                  invalidateKeys={[['plants']]}
                  compact
                />
              </div>
            </div>
          </Card>
        );
      })}
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

// ---------------------------------------------------------------------------
// Migrations panel — Admin-only. Probes the live Supabase schema against the
// SQL files in supabase/migrations/ and offers a copy-to-clipboard for any
// pending file so the Admin can paste it into the Supabase SQL editor.
// ---------------------------------------------------------------------------

interface MigrationExpectedColumn {
  column: string;
  exists: boolean;
}
interface MigrationProbeTable {
  name: string;
  exists: boolean;
  expected_columns?: MigrationExpectedColumn[];
  missing_columns?: string[];
  present_columns?: string[];
  expected_count?: number;
}
interface MigrationProbeColumn {
  table: string;
  column: string;
  exists: boolean;
}
interface MigrationOverride {
  marked_at: string;
  by_user_id: string | null;
  by_label: string | null;
  note: string | null;
}
interface MigrationApplyHistory {
  applied_at: string | null;
  by_label: string | null;
  note: string | null;
  source: string | null;
}
interface MigrationFile {
  filename: string;
  size: number;
  sha256?: string;
  status: 'applied' | 'pending' | 'partial' | 'indeterminate';
  probed_status?: 'applied' | 'pending' | 'partial' | 'indeterminate';
  manual_override?: MigrationOverride | null;
  override_applied?: boolean;
  // Permanent record of when this file was first marked applied locally,
  // preserved across override-purge cleanups. Null for files never run
  // through the override flow (we don't fabricate a timestamp we don't know).
  apply_history?: MigrationApplyHistory | null;
  table_probes: MigrationProbeTable[];
  column_probes: MigrationProbeColumn[];
  added_column_probes?: MigrationProbeColumn[];
  sql: string;
}
interface MigrationsResponse {
  migrations_dir: string;
  summary: {
    total: number;
    applied: number;
    pending: number;
    partial: number;
    indeterminate: number;
  };
  files: MigrationFile[];
  // Filenames whose manual override was auto-removed this fetch because the
  // probe now confirms the migration is applied for real. The frontend uses
  // this to surface a one-time confirmation toast on explicit Re-check.
  purged_overrides?: string[];
}

// localStorage key for the per-file SHA snapshot the user has acknowledged.
// We compare each fresh response against this snapshot to flag files whose
// on-disk content changed since the user last hit Re-check (i.e. potentially
// stale relative to a previously-downloaded bundle).
const MIGRATIONS_SHA_KEY = 'pwri:migration-shas-v1';

function MigrationsPanel() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [showApplied, setShowApplied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [seenShas, setSeenShas] = useState<Record<string, string>>(() => {
    // Stored data is non-sensitive: SHA-256 hashes of public migration
    // files the admin has acknowledged downloading. localStorage is
    // appropriate (no auth/PII here) and the catch swallows quota /
    // private-mode errors silently because the worst case is the user
    // sees the "new since last visit" badge once more.
    try {
      const raw = localStorage.getItem(MIGRATIONS_SHA_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch (readErr) {
      console.warn('[Admin] failed to read seen migration SHAs:', readErr);
      return {};
    }
  });

  const persistShas = (next: Record<string, string>) => {
    setSeenShas(next);
    try {
      localStorage.setItem(MIGRATIONS_SHA_KEY, JSON.stringify(next));
    } catch (writeErr) {
      // Quota / private-mode — non-fatal, the dot indicator just won't persist.
      console.warn('[Admin] failed to persist seen migration SHAs:', writeErr);
    }
  };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-migrations-status'],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Sign in required');
      const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const res = await fetch(`${base}/api/admin/migrations/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Migrations probe failed: ${res.status} ${body}`);
      }
      return (await res.json()) as MigrationsResponse;
    },
  });

  const copySql = async (filename: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(filename);
      toast.success(`Copied ${filename} — paste into Supabase SQL editor.`);
      setTimeout(() => setCopied((c) => (c === filename ? null : c)), 2500);
    } catch (e: any) {
      toast.error(`Copy failed: ${e?.message ?? e}`);
    }
  };

  // The probe is the source of truth here — we deliberately skip files marked
  // applied via manual override (probe=pending but user said "I ran it") so
  // the bundle only contains SQL that genuinely still needs to run.
  // Partial files are included on the assumption that all our migrations use
  // `if not exists` / `drop … if exists` guards, so re-running is idempotent.
  // Indeterminate files (no probe-able statements at all) are excluded — we
  // can't know whether they need to run, and the user should mark those by hand.
  const pendingFiles = useMemo(() => {
    return (data?.files ?? []).filter(
      (f) => f.probed_status === 'pending' || f.probed_status === 'partial',
    );
  }, [data]);

  // Map of {filename: sha256} for the files in the most recent fetch.
  const currentShas = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of data?.files ?? []) {
      if (f.sha256) out[f.filename] = f.sha256;
    }
    return out;
  }, [data]);

  // First-ever load: silently capture the current snapshot so we don't show a
  // "modified" pill for every file just because the user has never used the
  // panel before. After this point, drift is only flagged when something
  // actually changes between Re-checks.
  useEffect(() => {
    if (!data) return;
    if (Object.keys(seenShas).length === 0 && Object.keys(currentShas).length > 0) {
      persistShas(currentShas);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const driftCount = useMemo(() => {
    let n = 0;
    for (const [name, sha] of Object.entries(currentShas)) {
      if (seenShas[name] && seenShas[name] !== sha) n += 1;
    }
    return n;
  }, [currentShas, seenShas]);

  const handleRecheck = async () => {
    const result = await refetch();
    // Acknowledge the freshly-fetched state so the "modified" pills clear.
    const fresh: Record<string, string> = {};
    for (const f of result.data?.files ?? []) {
      if (f.sha256) fresh[f.filename] = f.sha256;
    }
    if (Object.keys(fresh).length > 0) persistShas(fresh);

    // Surface auto-cleanup so the user knows the override store was tidied
    // up (otherwise the override silently disappears and they'd wonder
    // whether their earlier Mark-applied click actually registered).
    const purged = result.data?.purged_overrides ?? [];
    if (purged.length > 0) {
      const list = purged.length <= 3
        ? purged.join(', ')
        : `${purged.slice(0, 3).join(', ')} +${purged.length - 3} more`;
      toast.success(
        `Cleaned up ${purged.length} stale override${purged.length === 1 ? '' : 's'} ` +
        `(probe now confirms applied): ${list}`,
      );
    }
  };

  // Build a deep link to the Supabase Dashboard SQL editor for this project.
  // We prefer the explicit VITE_SUPABASE_PROJECT_ID (already in .env), and
  // fall back to extracting the subdomain from VITE_SUPABASE_URL — handy if
  // someone forgets to set the project-id var in a new environment.
  // Returns null when neither is configured (button is then hidden rather
  // than producing a broken supabase.com/dashboard/project//sql/new link).
  const supabaseSqlEditorUrl = useMemo<string | null>(() => {
    const explicit = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
    let ref = explicit?.trim() || '';
    if (!ref) {
      const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
      const m = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
      if (m) ref = m[1];
    }
    if (!ref) return null;
    return `https://supabase.com/dashboard/project/${ref}/sql/new`;
  }, []);

  // Copy SQL to clipboard, then open the Supabase SQL editor in a new tab.
  // We do the copy first so the open-in-new-tab user-gesture isn't broken by
  // a slow clipboard write, and we toast either way so the user knows what
  // landed in their clipboard before the editor finishes loading.
  const openInSupabase = async (filename: string, sql: string) => {
    if (!supabaseSqlEditorUrl) return;
    try {
      await navigator.clipboard.writeText(sql);
      toast.success(`Copied ${filename} — paste into the Supabase SQL editor that just opened`);
    } catch {
      toast.message(`Opening Supabase SQL editor — copy ${filename}'s SQL manually from the panel`);
    }
    window.open(supabaseSqlEditorUrl, '_blank', 'noopener,noreferrer');
  };

  // Build the concatenated SQL bundle for the current pending/partial set.
  // Returned as { text, sizeKb } so the caller can decide whether to push it
  // to clipboard (copyAllPending) or download it as a file (downloadAllPending).
  const buildPendingBundle = (): { text: string; sizeKb: string } | null => {
    if (pendingFiles.length === 0) return null;
    const stamp = new Date().toISOString();
    const header = [
      '-- ============================================================',
      `-- PWRI Monitoring · pending Supabase migrations bundle`,
      `-- Generated: ${stamp}`,
      `-- Files: ${pendingFiles.length}`,
      '-- Paste into Supabase Dashboard → SQL editor → Run.',
      '-- All bundled files use `if not exists` / `drop … if exists` guards,',
      '-- so re-running an already-applied file is safe.',
      '-- ============================================================',
      '',
    ].join('\n');
    const body = pendingFiles
      .map((f) => {
        const banner =
          `-- ===== ${f.filename} (${f.probed_status}) ` +
          '='.repeat(Math.max(0, 60 - f.filename.length - f.probed_status.length));
        const trailer = `-- ===== end ${f.filename} ` + '='.repeat(40);
        return `${banner}\n${f.sql.trimEnd()}\n${trailer}\n`;
      })
      .join('\n');
    const text = `${header}${body}`;
    return { text, sizeKb: (text.length / 1024).toFixed(1) };
  };

  const copyAllPending = async () => {
    const bundle = buildPendingBundle();
    if (!bundle) {
      toast.info('Nothing to copy — no pending or partial migrations.');
      return;
    }
    try {
      await navigator.clipboard.writeText(bundle.text);
      toast.success(
        `Copied ${pendingFiles.length} pending migration${
          pendingFiles.length === 1 ? '' : 's'
        } (${bundle.sizeKb} KB).`,
      );
    } catch (e: any) {
      toast.error(`Copy failed: ${e?.message ?? e}`);
    }
  };

  // Export the apply-history audit trail as a JSON file. Useful for
  // archiving "this migration ran in this environment at this time" without
  // granting Supabase Dashboard access, and for diff-ing two environments
  // (e.g. staging vs prod) to spot which migrations one ran but the other
  // hasn't. Only entries with a recorded apply event are included — files
  // applied via psql / dashboard without going through Mark-applied won't
  // appear, mirroring backend honesty about what we actually know.
  const downloadHistory = () => {
    const entries: Record<string, MigrationApplyHistory> = {};
    for (const f of data?.files ?? []) {
      if (f.apply_history?.applied_at) {
        entries[f.filename] = f.apply_history;
      }
    }
    const count = Object.keys(entries).length;
    if (count === 0) {
      toast.info('No apply-history entries to export yet.');
      return;
    }
    const payload = {
      exported_at: new Date().toISOString(),
      migrations_dir: data?.migrations_dir ?? null,
      history: entries,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
    const filename = `pwri-migration-apply-history-${stamp}.json`;
    try {
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so Safari has time to actually start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        `Exported ${count} apply-history entr${count === 1 ? 'y' : 'ies'} → ${filename}`,
      );
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message ?? e}`);
    }
  };

  // True iff at least one file has a recorded apply event — used to gate
  // visibility of the Export-history button so we don't offer a download
  // that would just produce {history: {}}.
  const hasAnyHistory = useMemo(
    () => (data?.files ?? []).some((f) => !!f.apply_history?.applied_at),
    [data],
  );

  // Hidden <input type="file"> the Import-history button programmatically
  // clicks. Lives in state so we can keep the input mounted (and reset
  // .value after each pick so picking the same file twice in a row still
  // fires onChange).
  const [importing, setImporting] = useState(false);

  const handleImportHistoryFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast.error('Selected file is not valid JSON.');
        return;
      }
      // Accept both the export format ({history: {...}}) and a bare history
      // map ({...}) so users who copy-paste fragments still succeed.
      const historyObj = parsed?.history ?? parsed;
      if (!historyObj || typeof historyObj !== 'object' || Array.isArray(historyObj)) {
        toast.error('Imported file must contain a "history" object keyed by filename.');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('Not signed in.');
        return;
      }
      const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const res = await fetch(`${BASE}/api/admin/migrations/apply-history/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ history: historyObj, mode: 'fill_gaps' }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        toast.error(`Import failed (${res.status}): ${detail.slice(0, 200)}`);
        return;
      }
      const out = await res.json();
      const added = (out.added ?? []).length;
      const skipExist = (out.skipped_existing ?? []).length;
      const skipUnk = (out.skipped_unknown ?? []).length;
      const skipBad = (out.skipped_invalid ?? []).length;
      const parts = [
        `${added} added`,
        skipExist > 0 ? `${skipExist} skipped (already recorded)` : null,
        skipUnk > 0 ? `${skipUnk} skipped (unknown filename)` : null,
        skipBad > 0 ? `${skipBad} skipped (invalid)` : null,
      ].filter(Boolean).join(' · ');
      if (added > 0) toast.success(`Imported apply-history: ${parts}`);
      else toast.info(`Nothing new imported: ${parts || 'all entries were already present'}`);
      // Refetch so the new "applied locally" pills appear immediately.
      await refetch();
    } catch (e: any) {
      toast.error(`Import failed: ${e?.message ?? e}`);
    } finally {
      setImporting(false);
    }
  };

  // Save the same bundle as a versioned .sql file. Filenames embed an
  // ISO-style timestamp (no colons — Windows-friendly) so multiple runs
  // don't overwrite each other and you have a clear audit trail of exactly
  // what was pasted into Supabase, when, and by which session.
  const downloadAllPending = () => {
    const bundle = buildPendingBundle();
    if (!bundle) {
      toast.info('Nothing to download — no pending or partial migrations.');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
    const filename = `pwri-pending-migrations-${stamp}.sql`;
    try {
      const blob = new Blob([bundle.text], { type: 'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so Safari has time to actually start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        `Downloaded ${filename} (${pendingFiles.length} file${
          pendingFiles.length === 1 ? '' : 's'
        }, ${bundle.sizeKb} KB).`,
      );
    } catch (e: any) {
      toast.error(`Download failed: ${e?.message ?? e}`);
    }
  };

  const markApplied = async (filename: string) => {
    const note = window.prompt(
      `Mark "${filename}" as applied?\n\nUse this for migrations the schema probe can't verify (RPCs, one-shot UPDATEs, pure DML).\n\nOptional note (e.g. "ran in Supabase SQL editor on 2026-04-25"):`,
      '',
    );
    if (note === null) return; // user cancelled
    try {
      setBusy(filename);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Sign in required');
      const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const res = await fetch(
        `${base}/api/admin/migrations/${encodeURIComponent(filename)}/mark-applied`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ note: note || null }),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      toast.success(`Marked ${filename} as applied.`);
      await refetch();
    } catch (e: any) {
      toast.error(`Mark failed: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const unmarkApplied = async (filename: string) => {
    if (!window.confirm(`Remove the applied mark for "${filename}"?`)) return;
    try {
      setBusy(filename);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Sign in required');
      const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const res = await fetch(
        `${base}/api/admin/migrations/${encodeURIComponent(filename)}/mark-applied`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      toast.success(`Cleared mark for ${filename}.`);
      await refetch();
    } catch (e: any) {
      toast.error(`Unmark failed: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  // Free-text filename filter — case-insensitive substring match against
  // the bare filename (no path). Persists nothing; resets whenever the
  // panel unmounts. Use sparingly: small migration sets don't need it,
  // but it pays off once the directory grows past a screenful.
  const [nameFilter, setNameFilter] = useState('');

  const visibleFiles = useMemo(() => {
    if (!data?.files) return [];
    let rows = showApplied ? data.files : data.files.filter((f) => f.status !== 'applied');
    const q = nameFilter.trim().toLowerCase();
    if (q) rows = rows.filter((f) => f.filename.toLowerCase().includes(q));
    return rows;
  }, [data, showApplied, nameFilter]);

  // Total visible BEFORE the name filter — so we can render
  // "showing N of M" without confusing "M" with "all files in repo".
  const visibleBeforeFilter = useMemo(() => {
    if (!data?.files) return 0;
    return showApplied
      ? data.files.length
      : data.files.filter((f) => f.status !== 'applied').length;
  }, [data, showApplied]);

  const STATUS_META: Record<MigrationFile['status'], { label: string; className: string; Icon: any }> = {
    applied:       { label: 'Applied',       className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40', Icon: CheckCircle2 },
    pending:       { label: 'Pending',       className: 'bg-rose-500/15 text-rose-700 border-rose-500/40',          Icon: AlertTriangle },
    partial:       { label: 'Partial',       className: 'bg-amber-500/15 text-amber-700 border-amber-500/40',       Icon: AlertTriangle },
    indeterminate: { label: 'Indeterminate', className: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/40',          Icon: FileCode },
  };

  return (
    <div className="space-y-3" data-testid="admin-migrations-panel">
      <Card className="p-3 text-xs space-y-2">
        <div className="flex items-start gap-2">
          <Database className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Supabase migrations status</div>
            <div className="text-muted-foreground">
              Scans <code>supabase/migrations/*.sql</code> and probes your Supabase
              project for the tables / columns each file should have created.
              Pending or partial files include the exact SQL to paste into the
              Supabase Dashboard → SQL editor.
            </div>
          </div>
        </div>
        {data && (
          <div className="flex flex-wrap gap-2 items-center pt-1">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">
              {data.summary.applied} applied
            </Badge>
            {data.summary.pending > 0 && (
              <Badge variant="outline" className="bg-rose-500/10 text-rose-700">
                {data.summary.pending} pending
              </Badge>
            )}
            {data.summary.partial > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700">
                {data.summary.partial} partial
              </Badge>
            )}
            {data.summary.indeterminate > 0 && (
              <Badge variant="outline" className="bg-zinc-500/10 text-zinc-700">
                {data.summary.indeterminate} indeterminate
              </Badge>
            )}
            {driftCount > 0 && (
              <Badge
                variant="outline"
                className="bg-amber-500/15 text-amber-700 border-amber-500/40"
                title={
                  `${driftCount} migration file${driftCount === 1 ? '' : 's'} ` +
                  `changed on disk since the last Re-check. ` +
                  `Re-download the bundle before pasting into Supabase, ` +
                  `then click Re-check to acknowledge.`
                }
                data-testid="migrations-drift-count"
              >
                <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                {driftCount} modified since last check
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              · {data.summary.total} total
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  placeholder="Filter filenames…"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  className="h-7 pl-6 pr-2 text-[11px] rounded-md border bg-background w-44 focus:outline-none focus:ring-1 focus:ring-ring"
                  title="Case-insensitive substring match against filename"
                  data-testid="migrations-name-filter"
                />
                {nameFilter && (
                  <button
                    type="button"
                    onClick={() => setNameFilter('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[14px] leading-none px-1"
                    title="Clear filter"
                    data-testid="migrations-name-filter-clear"
                  >
                    ×
                  </button>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={showApplied}
                  onCheckedChange={(v) => setShowApplied(!!v)}
                  data-testid="migrations-show-applied"
                />
                Show applied
              </label>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={pendingFiles.length === 0}
                onClick={copyAllPending}
                title={
                  pendingFiles.length === 0
                    ? 'No pending or partial migrations to bundle'
                    : `Copy ${pendingFiles.length} file(s) as one paste-able SQL bundle`
                }
                data-testid="migrations-copy-all"
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy all pending ({pendingFiles.length})
              </Button>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={pendingFiles.length === 0}
                onClick={downloadAllPending}
                title={
                  pendingFiles.length === 0
                    ? 'No pending or partial migrations to bundle'
                    : `Save ${pendingFiles.length} file(s) as a versioned .sql backup`
                }
                data-testid="migrations-download-all"
              >
                <Download className="h-3 w-3 mr-1" />
                Download .sql
              </Button>
              {hasAnyHistory && (
                <Button
                  size="sm" variant="outline" className="h-7"
                  onClick={downloadHistory}
                  title="Export the apply-history audit trail as a JSON file (one entry per migration that has been marked applied locally)"
                  data-testid="migrations-export-history"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Export history
                </Button>
              )}
              <label
                className={`inline-flex items-center h-7 px-3 text-[12px] rounded-md border bg-background hover:bg-muted cursor-pointer ${
                  importing ? 'opacity-60 pointer-events-none' : ''
                }`}
                title="Import a previously-exported apply-history JSON. Non-destructive: local entries always win on conflict."
                data-testid="migrations-import-history-label"
              >
                {importing
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <Database className="h-3 w-3 mr-1" />}
                Import history
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  data-testid="migrations-import-history-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Reset .value so picking the same file twice still
                    // triggers onChange (browsers dedupe identical paths).
                    e.target.value = '';
                    if (file) handleImportHistoryFile(file);
                  }}
                />
              </label>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={isFetching}
                onClick={handleRecheck}
                data-testid="migrations-refresh"
              >
                {isFetching
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <RefreshCcw className="h-3 w-3 mr-1" />}
                Re-check
              </Button>
            </div>
          </div>
        )}
      </Card>

      {isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 mx-auto animate-spin mb-1" />
          Probing live Supabase schema…
        </Card>
      )}

      {!isLoading && visibleFiles.length === 0 && data && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          {nameFilter
            ? <>No files match <code className="font-mono">{nameFilter}</code>.{' '}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setNameFilter('')}
                >
                  Clear filter
                </button></>
            : data.summary.pending + data.summary.partial === 0
              ? 'All migrations already applied. Toggle "Show applied" to see the full history.'
              : 'No files match the current filter.'}
        </Card>
      )}

      {nameFilter && visibleFiles.length > 0 && data && (
        <div className="text-[11px] text-muted-foreground px-1">
          Showing <strong className="text-foreground">{visibleFiles.length}</strong> of{' '}
          <strong className="text-foreground">{visibleBeforeFilter}</strong>
          {visibleBeforeFilter !== data.summary.total && (
            <> visible ({data.summary.total} total in repo)</>
          )}
          {' '}— filtered by <code className="font-mono">{nameFilter}</code>
        </div>
      )}

      <div className="space-y-2">
        {visibleFiles.map((f) => {
          const meta = STATUS_META[f.status];
          const isOpen = !!expanded[f.filename];
          const wasCopied = copied === f.filename;
          return (
            <Card
              key={f.filename}
              className={`p-3 border-l-4 ${
                f.status === 'pending'
                  ? 'border-l-rose-500/70'
                  : f.status === 'partial'
                    ? 'border-l-amber-500/70'
                    : f.status === 'applied'
                      ? 'border-l-emerald-500/60 opacity-90'
                      : 'border-l-zinc-300'
              }`}
              data-testid={`migration-${f.filename}`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <code className="text-xs font-mono truncate">{f.filename}</code>
                  <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                    <meta.Icon className="h-2.5 w-2.5 mr-1" />
                    {meta.label}
                  </Badge>
                  {(() => {
                    const seen = f.sha256 ? seenShas[f.filename] : undefined;
                    const drifted = !!(seen && f.sha256 && seen !== f.sha256);
                    if (!drifted) return null;
                    return (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/40"
                        title={
                          `On-disk content changed since last Re-check.\n` +
                          `was: ${seen?.slice(0, 12)}…\n` +
                          `now: ${f.sha256?.slice(0, 12)}…\n` +
                          `Re-download the bundle before pasting into Supabase.`
                        }
                        data-testid={`migration-drift-${f.filename}`}
                      >
                        <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                        modified since last check
                      </Badge>
                    );
                  })()}
                  {(() => {
                    // Show "applied locally <relative>" on probe-confirmed
                    // applied files when we have a recorded apply event in
                    // history. Hidden when an override is currently active
                    // (the override line below already shows that timestamp,
                    // and we don't want two timestamp pills competing).
                    const h = f.apply_history;
                    if (!h?.applied_at) return null;
                    if (f.override_applied) return null;
                    if (f.probed_status !== 'applied') return null;
                    const when = new Date(h.applied_at);
                    if (Number.isNaN(when.getTime())) return null;
                    const rel = formatDistanceToNow(when, { addSuffix: true });
                    const abs = format(when, 'yyyy-MM-dd HH:mm');
                    return (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-emerald-500/5 text-emerald-700 border-emerald-500/30 font-mono"
                        title={
                          `First marked applied locally at ${abs} (local time)` +
                          (h.by_label ? ` by ${h.by_label}` : '') +
                          (h.note ? `\nNote: "${h.note}"` : '') +
                          `\nOriginal manual override has since been auto-purged ` +
                          `because the live probe now confirms the migration.`
                        }
                        data-testid={`migration-applied-locally-${f.filename}`}
                      >
                        applied {rel}
                      </Badge>
                    );
                  })()}
                  <span className="text-[10px] text-muted-foreground">
                    {(f.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {f.probed_status !== 'applied' && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={() => copySql(f.filename, f.sql)}
                      data-testid={`migration-copy-${f.filename}`}
                    >
                      {wasCopied
                        ? <><CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" /> Copied</>
                        : <><Copy className="h-3 w-3 mr-1" /> Copy SQL</>}
                    </Button>
                  )}
                  {f.probed_status !== 'applied' && supabaseSqlEditorUrl && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={() => openInSupabase(f.filename, f.sql)}
                      title="Copy this file's SQL and open the Supabase SQL editor in a new tab"
                      data-testid={`migration-open-supabase-${f.filename}`}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Open in Supabase
                    </Button>
                  )}
                  {f.override_applied ? (
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px]"
                      disabled={busy === f.filename}
                      onClick={() => unmarkApplied(f.filename)}
                      data-testid={`migration-unmark-${f.filename}`}
                    >
                      {busy === f.filename
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <Trash2 className="h-3 w-3 mr-1" />}
                      Clear mark
                    </Button>
                  ) : (
                    f.probed_status !== 'applied' && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-[11px]"
                        disabled={busy === f.filename}
                        onClick={() => markApplied(f.filename)}
                        data-testid={`migration-mark-${f.filename}`}
                      >
                        {busy === f.filename
                          ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Mark applied
                      </Button>
                    )
                  )}
                  <Button
                    size="sm" variant="ghost" className="h-7 text-[11px]"
                    onClick={() => setExpanded((m) => ({ ...m, [f.filename]: !m[f.filename] }))}
                  >
                    {isOpen
                      ? <><ChevronUp className="h-3 w-3 mr-1" /> Hide</>
                      : <><ChevronDown className="h-3 w-3 mr-1" /> Details</>}
                  </Button>
                </div>
              </div>
              {f.override_applied && f.manual_override && (() => {
                // Defensive parse — older overrides without marked_at would
                // otherwise crash formatDistanceToNow with "Invalid time value".
                const marked = new Date(f.manual_override.marked_at);
                const validMarked = !Number.isNaN(marked.getTime());
                const absolute = validMarked
                  ? format(marked, 'yyyy-MM-dd HH:mm')
                  : 'unknown time';
                const relative = validMarked
                  ? formatDistanceToNow(marked, { addSuffix: true })
                  : '';
                return (
                  <div className="mt-1.5 text-[11px] text-muted-foreground italic flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="bg-sky-500/10 text-sky-700 border-sky-400/40 text-[10px]">
                      manual override
                    </Badge>
                    {validMarked && (
                      <Badge
                        variant="outline"
                        className="bg-sky-500/5 text-sky-700 border-sky-400/30 text-[10px] not-italic font-mono"
                        title={`Marked applied at ${absolute} (local time)`}
                        data-testid={`migration-override-age-${f.filename}`}
                      >
                        {relative}
                      </Badge>
                    )}
                    Marked applied by <strong className="not-italic">{f.manual_override.by_label ?? 'admin'}</strong>
                    {' on '}
                    <span title={validMarked ? marked.toISOString() : undefined}>{absolute}</span>
                    {f.manual_override.note ? ` — "${f.manual_override.note}"` : ''}
                    {' · probe says '}
                    <code>{f.probed_status}</code>
                  </div>
                );
              })()}

              {(f.table_probes.length > 0 || f.column_probes.length > 0) && (
                <div className="mt-2 space-y-1.5">
                  {f.table_probes.map((p) => {
                    const expected = p.expected_columns ?? [];
                    const present = (p.present_columns ?? []).length;
                    const missing = (p.missing_columns ?? []).length;
                    const hasDrift = p.exists && missing > 0;
                    return (
                      <div
                        key={`t-${p.name}`}
                        className={`rounded-md border px-2 py-1.5 text-[11px] ${
                          !p.exists
                            ? 'bg-rose-500/5 border-rose-500/30'
                            : hasDrift
                              ? 'bg-amber-500/5 border-amber-500/30'
                              : 'bg-emerald-500/5 border-emerald-500/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[10px] rounded-full px-1.5 py-0.5 border ${
                              p.exists
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-900/20 dark:text-rose-200'
                            }`}
                          >
                            table {p.name} {p.exists ? '✓ present' : '✗ missing'}
                          </span>
                          {expected.length > 0 && (
                            <span className="text-muted-foreground">
                              {p.exists
                                ? hasDrift
                                  ? `${present}/${expected.length} columns present · ${missing} missing`
                                  : `all ${expected.length} columns present`
                                : `would create ${expected.length} columns`}
                            </span>
                          )}
                        </div>
                        {hasDrift && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(p.missing_columns ?? []).map((c) => (
                              <span
                                key={`m-${p.name}.${c}`}
                                className="text-[10px] rounded-full px-1.5 py-0.5 border bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-900/20 dark:text-rose-200"
                                title={`Column ${p.name}.${c} declared in this migration is not present in the live table`}
                              >
                                {p.name}.{c} ✗
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {f.column_probes.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground self-center mr-1">
                        Added columns:
                      </span>
                      {f.column_probes.map((p) => (
                        <span
                          key={`c-${p.table}.${p.column}`}
                          className={`text-[10px] rounded-full px-1.5 py-0.5 border ${
                            p.exists
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-900/20 dark:text-rose-200'
                          }`}
                        >
                          {p.table}.{p.column} {p.exists ? '✓' : '✗'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isOpen && (
                <pre className="mt-2 p-2 rounded-md bg-muted/40 border text-[10px] font-mono overflow-auto max-h-72">
{f.sql}
                </pre>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
