import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { PlantAssignmentEditor } from '@/components/PlantAssignmentEditor';
import {
  DesignationCombobox, accessLevelFromRoles, OPERATOR_DESIGNATION,
} from '@/components/DesignationCombobox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import {
  Search, Hourglass, UserPlus, Zap, Building2, MoreVertical, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ALL_ROLES = ['Operator', 'Technician', 'Supervisor', 'Manager', 'Admin'] as const;
type AppRole = typeof ALL_ROLES[number];

const ROLE_ORDER: AppRole[] = ['Admin', 'Manager', 'Supervisor', 'Technician', 'Operator'];
const ROLE_PLURAL: Record<AppRole, string> = {
  Admin: 'Admins',
  Manager: 'Managers',
  Supervisor: 'Supervisors',
  Technician: 'Technicians',
  Operator: 'Operators',
};

// ── Avatar color by role ───────────────────────────────────────────────────────

const ROLE_AVATAR: Record<string, string> = {
  Admin: 'bg-[#CECBF6] text-[#3C3489]',
  Manager: 'bg-[#9FE1CB] text-[#085041]',
  Supervisor: 'bg-[#B5D4F4] text-[#0C447C]',
  Technician: 'bg-[#FAC775] text-[#633806]',
  Operator: 'bg-[#D3D1C7] text-[#444441]',
};

function initials(first?: string, last?: string, username?: string): string {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (username) return username.slice(0, 2).toUpperCase();
  return '??';
}

function primaryRole(roles: string[]): AppRole | null {
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return null;
}

// ── Role selector ─────────────────────────────────────────────────────────────

function RoleSelector({ userId, currentRoles, onChanged }: {
  userId: string; currentRoles: string[]; onChanged: () => void;
}) {
  const pRole: AppRole = primaryRole(currentRoles) ?? 'Operator';

  const handleChange = async (newRole: AppRole) => {
    if (newRole === pRole) return;
    const { error: delError } = await supabase.from('user_roles').delete().eq('user_id', userId);
    if (delError) { toast.error(delError.message); return; }
    const { error: insError } = await supabase.from('user_roles').insert({ user_id: userId, role: newRole });
    if (insError) { toast.error(insError.message); return; }
    toast.success(`Role updated to ${newRole}`);
    onChanged();
  };

  return (
    <Select value={pRole} onValueChange={(v) => handleChange(v as AppRole)}>
      <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        {ALL_ROLES.map((r) => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── Create-user dialog ────────────────────────────────────────────────────────

function CreateUserDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { data: plants } = usePlants();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: '', password: '', first_name: '', last_name: '',
    middle_name: '', suffix: '', username: '', designation: '',
  });
  const [plantId, setPlantId] = useState('');
  const [plantIds, setPlantIds] = useState<string[]>([]);

  const isOperator = form.designation === OPERATOR_DESIGNATION;
  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const reset = () => {
    setForm({ email: '', password: '', first_name: '', last_name: '', middle_name: '', suffix: '', username: '', designation: '' });
    setPlantId(''); setPlantIds([]); setBusy(false);
  };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!form.email || !form.password || !form.first_name || !form.last_name || !form.username) {
      toast.error('Email, password, username, first name and last name are required.'); return;
    }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters.'); return; }
    if (isOperator && !plantId) { toast.error('Select a plant for this Operator.'); return; }
    if (!isOperator && plantIds.length === 0) { toast.error('Assign at least one plant.'); return; }

    setBusy(true);
    const assignedPlants = isOperator ? [plantId] : plantIds;
    try {
      const { data: adminSession } = await supabase.auth.getSession();
      const { error: upErr } = await supabase.auth.signUp({ email: form.email, password: form.password });
      if (upErr) throw new Error(upErr.message);
      const { error: inErr } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
      if (inErr) throw new Error(inErr.message);
      const { error: rpErr } = await supabase.rpc('complete_onboarding', {
        _username: form.username, _first_name: form.first_name,
        _middle_name: form.middle_name || null, _last_name: form.last_name,
        _suffix: form.suffix || null, _designation: form.designation || null,
        _plant_assignments: assignedPlants,
      });
      if (rpErr) throw new Error(rpErr.message);
      await supabase.auth.signOut();
      if (adminSession.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: adminSession.session.access_token,
          refresh_token: adminSession.session.refresh_token,
        });
      }
      toast.success(`${form.first_name} ${form.last_name} created — click Approve to activate.`);
      setBusy(false); onCreated(); handleClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Unexpected error creating user.'); setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create new user</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Login credentials</p>
            <div><Label>Email *</Label><Input type="email" value={form.email} onChange={field('email')} placeholder="user@example.com" /></div>
            <div><Label>Password *</Label><Input type="password" value={form.password} onChange={field('password')} placeholder="Min. 6 characters" /></div>
          </div>
          <div className="space-y-2 pt-1 border-t">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Profile</p>
            <div><Label>Username *</Label><Input value={form.username} onChange={field('username')} placeholder="e.g. jdelacruz" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>First name *</Label><Input value={form.first_name} onChange={field('first_name')} /></div>
              <div><Label>Last name *</Label><Input value={form.last_name} onChange={field('last_name')} /></div>
              <div><Label>Middle name</Label><Input value={form.middle_name} onChange={field('middle_name')} /></div>
              <div><Label>Suffix</Label><Input value={form.suffix} onChange={field('suffix')} placeholder="Jr., Sr., III…" /></div>
            </div>
            <div>
              <Label>Designation</Label>
              <DesignationCombobox
                value={form.designation}
                onChange={(v) => { setForm((f) => ({ ...f, designation: v })); setPlantId(''); setPlantIds([]); }}
                placeholder="Select or type a designation…"
              />
            </div>
          </div>
          {form.designation && (
            <div className="space-y-2 pt-1 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Plant assignment {isOperator ? '(single plant)' : '(multi-plant)'}
              </p>
              {isOperator ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(plants ?? []).map((p) => (
                    <label key={p.id} className={cn('flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors', plantId === p.id ? 'border-accent bg-accent/5' : 'hover:bg-muted/40')}>
                      <input type="radio" name="create-plant" value={p.id} checked={plantId === p.id} onChange={() => setPlantId(p.id)} className="accent-accent" />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                  {!(plants ?? []).length && <p className="text-xs text-muted-foreground">No plants available.</p>}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(plants ?? []).map((p) => (
                    <label key={p.id} className={cn('flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors', plantIds.includes(p.id) ? 'border-accent bg-accent/5' : 'hover:bg-muted/40')}>
                      <Checkbox checked={plantIds.includes(p.id)} onCheckedChange={() => setPlantIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])} />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                  {!(plants ?? []).length && <p className="text-xs text-muted-foreground">No plants available.</p>}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Created with <strong>Operator</strong> role, placed in the approval queue.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={busy}>{busy ? 'Creating…' : 'Create user'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── User tile (compact grid card) ─────────────────────────────────────────────

function UserTile({ s, userRoles, plantName, existingDesignations, updateDesignation, approveUser, invalidate }: {
  s: any;
  userRoles: string[];
  plantName: (id: string) => string;
  existingDesignations: string[];
  updateDesignation: (uid: string, designation: string) => Promise<void>;
  approveUser: (uid: string, label: string) => Promise<void>;
  invalidate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const pRole = primaryRole(userRoles);
  const avatarCls = ROLE_AVATAR[pRole ?? 'Operator'];
  const assignments: string[] = s.plant_assignments ?? [];
  const isOperator = s.designation === OPERATOR_DESIGNATION;
  const awaiting = s.confirmed === false || s.status === 'Pending';
  const access = accessLevelFromRoles(userRoles);

  const displayName = `${s.first_name ?? ''} ${s.last_name ?? ''} ${s.suffix ?? ''}`.trim() || (s.username ?? '—');
  const userLabel = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || (s.username ?? 'user');

  const visiblePlants = assignments.slice(0, 3);
  const overflowCount = assignments.length - 3;

  const statusDotCls =
    s.status === 'Active' ? 'bg-green-500' :
    s.status === 'Suspended' ? 'bg-red-500' : 'bg-amber-400';

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl border bg-card text-card-foreground transition-shadow',
        expanded ? 'shadow-md' : 'hover:shadow-sm',
      )}
      data-testid={`admin-user-card-${s.id}`}
    >
      {/* ── Top section ── */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Status dot + name row */}
        <div className="flex items-start gap-2">
          {/* Avatar */}
          <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0', avatarCls)}>
            {initials(s.first_name, s.last_name, s.username)}
          </div>

          {/* Name / handle */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium leading-tight truncate">{displayName}</span>
              {access.label === 'Elevated' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 shrink-0">
                  <Zap className="w-2.5 h-2.5" /> Elevated
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">@{s.username ?? '—'}</div>
          </div>

          {/* Status dot */}
          <div className="flex items-center gap-1 shrink-0 mt-0.5" title={s.status}>
            <span className={cn('w-2 h-2 rounded-full', statusDotCls)} />
          </div>
        </div>

        {/* Plant tags */}
        {assignments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visiblePlants.map((id) => (
              <span key={id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border/60">
                {plantName(id)}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                +{overflowCount}
              </span>
            )}
          </div>
        )}

        {/* Role badges */}
        {userRoles.length === 0 && (
          <Badge variant="secondary" className="text-[9px] w-fit">No role</Badge>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="border-t mt-auto">

        {/* Designation + approve row */}
        <div className="px-3 pt-2 pb-1.5 flex items-center justify-between gap-2 min-w-0">
          <span className="text-[10.5px] text-muted-foreground truncate min-w-0" title={s.designation ?? ''}>
            {s.designation || <span className="italic opacity-40">No designation</span>}
          </span>
          {awaiting && (
            <Button
              size="sm"
              className="h-6 px-2 text-[10px] shrink-0"
              onClick={() => approveUser(s.id, userLabel)}
              data-testid={`approve-user-${s.id}`}
            >
              Approve
            </Button>
          )}
        </div>

        {/* Icon-only action buttons — fixed square size, never truncate */}
        <div className="px-3 pb-3 flex items-center justify-end gap-1.5">
          {/* Change role */}
          <button
            className={cn(
              'h-7 w-7 flex items-center justify-center rounded-md border transition-colors shrink-0',
              expanded
                ? 'bg-violet-100 border-violet-400 text-violet-700 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-300'
                : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            title="Change role"
            aria-label="Change role"
            onClick={() => setExpanded((v) => !v)}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
          </button>

          {/* Edit plants */}
          <PlantAssignmentEditor
            userId={s.id}
            userLabel={userLabel}
            currentPlantIds={assignments}
            singlePlantOnly={isOperator}
            invalidateKeys={[['admin-users'], ['staff']]}
            trigger={
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                title="Edit plants"
                aria-label="Edit plants"
              >
                <Building2 className="w-3.5 h-3.5" />
              </button>
            }
          />

          {/* More / delete */}
          <DeleteEntityMenu
            kind="user" id={s.id} label={userLabel}
            canSoftDelete={s.status === 'Active'} canHardDelete
            invalidateKeys={[['admin-users'], ['admin-user-roles'], ['staff'], ['all-roles']]}
            compact
            trigger={
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                title="More options"
                aria-label="More options"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            }
          />
        </div>

        {/* Role selector panel — appears when shield button is active */}
        {expanded && (
          <div className="border-t border-violet-100 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1 shrink-0">
                <ShieldCheck className="w-3 h-3" /> Role
              </span>
              <RoleSelector userId={s.id} currentRoles={userRoles} onChanged={invalidate} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Role group section ────────────────────────────────────────────────────────

function RoleGroup({ role, users, ...tileProps }: {
  role: AppRole | 'No role';
  users: any[];
} & Omit<React.ComponentProps<typeof UserTile>, 's' | 'userRoles'> & {
  rolesOf: (uid: string) => string[];
}) {
  const { rolesOf, ...rest } = tileProps as any;
  const label = role === 'No role' ? 'No role' : ROLE_PLURAL[role as AppRole];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">{users.length}</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {users.map((s) => (
          <UserTile key={s.id} s={s} userRoles={rolesOf(s.id)} {...rest} />
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function UsersPanel() {
  const qc = useQueryClient();
  const { data: plants } = usePlants();
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: staff } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await supabase.from('user_profiles').select('*').order('last_name')).data ?? [],
  });
  const { data: roles } = useQuery({
    queryKey: ['admin-user-roles'],
    queryFn: async () => (await supabase.from('user_roles').select('user_id, role')).data ?? [],
  });

  const rolesOf = (uid: string): string[] =>
    (roles ?? []).filter((r: any) => r.user_id === uid).map((r: any) => r.role as string);

  const plantName = (id: string) => (plants ?? []).find((p) => p.id === id)?.name ?? id;

  const logPlantAssignmentChange = async (userId: string, newPlants: string[], justification = 'Admin update') => {
    try {
      const { data: actor } = await supabase.auth.getUser();
      await supabase.from('plant_assignment_audit' as any).insert({
        user_id: userId, admin_id: actor.user?.id ?? null,
        new_plant_ids: newPlants, justification, changed_at: new Date().toISOString(),
      } as any);
    } catch { /* non-blocking */ }
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['admin-user-roles'] });
    qc.invalidateQueries({ queryKey: ['staff'] });
  };

  const updateDesignation = async (uid: string, designation: string) => {
    const { error } = await supabase.from('user_profiles').update({ designation }).eq('id', uid);
    if (error) { toast.error(error.message); return; }
    toast.success('Designation updated');
    invalidate();
  };

  const approveUser = async (uid: string, label: string) => {
    const { error } = await supabase.rpc('approve_user' as any, { _user_id: uid, _approve: true } as any);
    if (error) { toast.error(error.message); return; }
    toast.success(`${label || 'User'} approved`);
    invalidate();
  };

  const existingDesignations = useMemo(
    () => Array.from(new Set(((staff ?? []) as any[]).map((s) => s.designation).filter(Boolean))) as string[],
    [staff],
  );

  const pendingCount = useMemo(
    () => ((staff ?? []) as any[]).filter((s) => s.confirmed === false || s.status === 'Pending').length,
    [staff],
  );

  const filtered = useMemo(() => {
    let list = (staff ?? []) as any[];
    if (pendingOnly) list = list.filter((s) => s.confirmed === false || s.status === 'Pending');
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [s.first_name, s.last_name, s.username, s.designation].filter(Boolean).some((v: string) => v.toLowerCase().includes(q)),
    );
  }, [staff, query, pendingOnly]);

  // Group users by primary role
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const r of [...ROLE_ORDER, 'No role']) map[r] = [];
    for (const s of filtered) {
      const pr = primaryRole(rolesOf(s.id)) ?? 'No role';
      map[pr].push(s);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, roles]);

  const tileProps = {
    rolesOf,
    plantName,
    existingDesignations,
    updateDesignation,
    approveUser,
    invalidate,
  };

  const activeGroups = [...ROLE_ORDER, 'No role' as const].filter((r) => grouped[r]?.length > 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
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
          <Hourglass className="h-3 w-3 mr-1" /> Pending {pendingCount > 0 && `· ${pendingCount}`}
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="admin-create-user-btn">
          <UserPlus className="h-3 w-3 mr-1" /> Add user
        </Button>
      </div>

      {/* Role-grouped grid */}
      {activeGroups.length > 0 ? (
        <div className="space-y-6">
          {activeGroups.map((role) => (
            <RoleGroup
              key={role}
              role={role as AppRole | 'No role'}
              users={grouped[role]}
              {...tileProps}
            />
          ))}
        </div>
      ) : (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          {pendingOnly ? 'No pending approvals.' : 'No users found.'}
        </Card>
      )}

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={invalidate} />
    </div>
  );
}
