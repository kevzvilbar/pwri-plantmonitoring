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
  Search, Hourglass, UserPlus, Zap, Building2, MoreVertical,
  ShieldCheck, ChevronLeft, ChevronRight, KeyRound, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

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

// Roles rendered as cards (higher-privilege, fewer users)
const CARD_ROLES: AppRole[] = ['Admin', 'Manager', 'Supervisor'];

// Roles rendered as table rows (high-volume, operational roles)
const TABLE_ROLES: AppRole[] = ['Technician', 'Operator'];

const OPERATORS_PER_PAGE = 8;

// ── Avatar styles ─────────────────────────────────────────────────────────────

const ROLE_AVATAR: Record<string, string> = {
  Admin:      'bg-[#CECBF6] text-[#3C3489]',
  Manager:    'bg-[#9FE1CB] text-[#085041]',
  Supervisor: 'bg-[#B5D4F4] text-[#0C447C]',
  Technician: 'bg-[#FAC775] text-[#633806]',
  Operator:   'bg-[#D3D1C7] text-[#444441]',
  'No role':  'bg-muted text-muted-foreground',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function displayName(s: any): string {
  return `${s.first_name ?? ''} ${s.last_name ?? ''} ${s.suffix ?? ''}`.trim() || (s.username ?? '—');
}

function userLabel(s: any): string {
  return `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || (s.username ?? 'user');
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'Active'    ? 'bg-green-500' :
    status === 'Suspended' ? 'bg-red-500'   : 'bg-amber-400';
  return <span className={cn('w-2 h-2 rounded-full shrink-0', cls)} title={status} />;
}

// ── Role selector ─────────────────────────────────────────────────────────────

function RoleSelector({ userId, currentRoles, onChanged }: {
  userId: string; currentRoles: string[]; onChanged: () => void;
}) {
  const pRole: AppRole = primaryRole(currentRoles) ?? 'Operator';

  const handleChange = async (newRole: AppRole) => {
    if (newRole === pRole) return;
    const { error: delErr } = await supabase.from('user_roles').delete().eq('user_id', userId);
    if (delErr) { toast.error(delErr.message); return; }
    const { error: insErr } = await supabase.from('user_roles').insert({ user_id: userId, role: newRole });
    if (insErr) { toast.error(insErr.message); return; }
    toast.success(`Role updated to ${newRole}`);
    onChanged();
  };

  return (
    <Select value={pRole} onValueChange={(v) => handleChange(v as AppRole)}>
      <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        {ALL_ROLES.map((r) => (
          <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
        ))}
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
          {/* Credentials */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Login credentials</p>
            <div><Label>Email *</Label><Input type="email" value={form.email} onChange={field('email')} placeholder="user@example.com" /></div>
            <div><Label>Password *</Label><Input type="password" value={form.password} onChange={field('password')} placeholder="Min. 6 characters" /></div>
          </div>
          {/* Profile */}
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
          {/* Plant assignment */}
          {form.designation && (
            <div className="space-y-2 pt-1 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Plant assignment {isOperator ? '(single plant)' : '(multi-plant)'}
              </p>
              {isOperator ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(plants ?? []).map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                        plantId === p.id ? 'border-accent bg-accent/5' : 'hover:bg-muted/40',
                      )}
                    >
                      <input
                        type="radio"
                        name="create-plant"
                        value={p.id}
                        checked={plantId === p.id}
                        onChange={() => setPlantId(p.id)}
                        className="accent-accent"
                      />
                      <span className="text-sm">{p.name}</span>
                    </label>
                  ))}
                  {!(plants ?? []).length && <p className="text-xs text-muted-foreground">No plants available.</p>}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(plants ?? []).map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                        plantIds.includes(p.id) ? 'border-accent bg-accent/5' : 'hover:bg-muted/40',
                      )}
                    >
                      <Checkbox
                        checked={plantIds.includes(p.id)}
                        onCheckedChange={() =>
                          setPlantIds((prev) =>
                            prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                          )
                        }
                      />
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

// ── Shared tile props type ────────────────────────────────────────────────────

interface SharedTileProps {
  plantName: (id: string) => string;
  existingDesignations: string[];
  updateDesignation: (uid: string, designation: string) => Promise<void>;
  approveUser: (uid: string, label: string) => Promise<void>;
  invalidate: () => void;
  onChangePassword: (userId: string, userName: string) => void;
}

// ── Change Password Dialog ────────────────────────────────────────────────────

const SETUP_SQL = `-- Run once in Supabase Dashboard → SQL Editor
create or replace function public.admin_set_user_password(
  _user_id uuid, _new_password text
)
returns void language plpgsql security definer
set search_path = extensions, public, auth as $$
begin
  if not exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'Admin'
  ) then
    raise exception 'Permission denied: Admin role required';
  end if;
  update auth.users
  set encrypted_password = crypt(_new_password, gen_salt('bf'))
  where id = _user_id;
end;
$$;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated;`;

function ChangePasswordDialog({ open, onClose, userId, userName }: {
  open: boolean; onClose: () => void; userId: string; userName: string;
}) {
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [copied, setCopied]         = useState(false);

  const handleClose = () => {
    setPassword(''); setConfirm(''); setShowPass(false);
    setBusy(false); setNeedsSetup(false); setCopied(false);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(SETUP_SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSubmit = async () => {
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm)  { toast.error('Passwords do not match'); return; }
    setBusy(true);
    const { error } = await (supabase.rpc as any)('admin_set_user_password', {
      _user_id: userId, _new_password: password,
    });
    setBusy(false);
    if (error) {
      if (error.message.includes('function') || error.message.includes('does not exist') || error.code === 'PGRST202') {
        setNeedsSetup(true); return;
      }
      toast.error(error.message); return;
    }
    toast.success(`Password updated for ${userName}`);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            Change password
          </DialogTitle>
        </DialogHeader>

        {needsSetup ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-semibold">One-time database setup required</p>
              <p>Run the SQL below once in your <strong>Supabase Dashboard → SQL Editor</strong>, then try again.</p>
            </div>
            <div className="relative">
              <pre className="rounded-lg border bg-muted text-[10.5px] font-mono p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">{SETUP_SQL}</pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-medium border border-border/60 bg-background hover:bg-muted transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={() => setNeedsSetup(false)}>Try again</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Setting a new password for <span className="font-medium text-foreground">{userName}</span>
            </p>
            <div className="space-y-3">
              <div>
                <Label>New password</Label>
                <div className="relative">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Confirm new password</Label>
                <Input
                  type={showPass ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={handleClose} disabled={busy}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={busy || !password || !confirm}>
                {busy ? 'Updating…' : 'Update password'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── User card (Admin / Manager / Supervisor) ──────────────────────────────────

function UserCard({ s, userRoles, ...shared }: { s: any; userRoles: string[] } & SharedTileProps) {
  const [expanded, setExpanded] = useState(false);

  const pRole        = primaryRole(userRoles);
  const avatarCls    = ROLE_AVATAR[pRole ?? 'Operator'];
  const assignments  = (s.plant_assignments ?? []) as string[];
  const isOperator   = s.designation === OPERATOR_DESIGNATION;
  const awaiting     = s.confirmed === false || s.status === 'Pending';
  const access       = accessLevelFromRoles(userRoles);
  const name         = displayName(s);
  const label        = userLabel(s);
  const visiblePlants = assignments.slice(0, 3);
  const overflowCount = assignments.length - 3;

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl border bg-card text-card-foreground transition-all duration-150',
        expanded ? 'shadow-md border-violet-200 dark:border-violet-800' : 'hover:shadow-sm hover:border-border',
      )}
      data-testid={`admin-user-card-${s.id}`}
    >
      {/* Body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Avatar + name + status */}
        <div className="flex items-start gap-2.5">
          <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0', avatarCls)}>
            {initials(s.first_name, s.last_name, s.username)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-medium leading-tight truncate max-w-[110px]">{name}</span>
              {access.label === 'Elevated' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 shrink-0 border border-violet-200 dark:border-violet-800">
                  <Zap className="w-2.5 h-2.5" /> Elevated
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">@{s.username ?? '—'}</div>
          </div>
          <StatusDot status={s.status} />
        </div>

        {/* Plant tags */}
        {assignments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visiblePlants.map((id) => (
              <span key={id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border/60">
                {shared.plantName(id)}
              </span>
            ))}
            {overflowCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                +{overflowCount}
              </span>
            )}
          </div>
        )}

        {userRoles.length === 0 && (
          <Badge variant="secondary" className="text-[9px] w-fit">No role</Badge>
        )}
      </div>

      {/* Footer */}
      <div className="border-t mt-auto">
        {/* Designation + approve */}
        <div className="px-3 pt-2 pb-1.5 flex items-center justify-between gap-2 min-w-0">
          <span className="text-[10.5px] text-muted-foreground truncate min-w-0" title={s.designation ?? ''}>
            {s.designation || <span className="italic opacity-40">No designation</span>}
          </span>
          {awaiting && (
            <Button
              size="sm"
              className="h-6 px-2 text-[10px] shrink-0"
              onClick={() => shared.approveUser(s.id, label)}
              data-testid={`approve-user-${s.id}`}
            >
              Approve
            </Button>
          )}
        </div>

        {/* Action row */}
        <div className="px-3 pb-3 flex items-center justify-end gap-1.5">
          {/* Role toggle */}
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
            <ShieldCheck className="w-3 h-3" />
          </button>

          {/* Change password */}
          <button
            className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-300 transition-colors shrink-0"
            title="Change password"
            aria-label="Change password"
            onClick={() => shared.onChangePassword(s.id, label)}
          >
            <KeyRound className="w-3 h-3" />
          </button>

          {/* Edit plants */}
          <PlantAssignmentEditor
            userId={s.id}
            userLabel={label}
            currentPlantIds={assignments}
            singlePlantOnly={isOperator}
            invalidateKeys={[['admin-users'], ['staff']]}
            trigger={
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                title="Edit plants"
                aria-label="Edit plants"
              >
                <Building2 className="w-3 h-3" />
              </button>
            }
          />

          {/* More / delete */}
          <DeleteEntityMenu
            kind="user" id={s.id} label={label}
            canSoftDelete={s.status === 'Active'} canHardDelete
            invalidateKeys={[['admin-users'], ['admin-user-roles'], ['staff'], ['all-roles']]}
            compact
            trigger={
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                title="More options"
                aria-label="More options"
              >
                <MoreVertical className="w-3 h-3" />
              </button>
            }
          />
        </div>

        {/* Role expand panel */}
        {expanded && (
          <div className="border-t border-violet-100 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1 shrink-0">
                <ShieldCheck className="w-3 h-3" /> Role
              </span>
              <RoleSelector userId={s.id} currentRoles={userRoles} onChanged={shared.invalidate} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Operator / Technician table row ───────────────────────────────────────────

function UserTableRow({ s, userRoles, ...shared }: { s: any; userRoles: string[] } & SharedTileProps) {
  const [roleOpen, setRoleOpen] = useState(false);

  const pRole       = primaryRole(userRoles);
  const avatarCls   = ROLE_AVATAR[pRole ?? 'Operator'];
  const assignments = (s.plant_assignments ?? []) as string[];
  const isOperator  = s.designation === OPERATOR_DESIGNATION;
  const awaiting    = s.confirmed === false || s.status === 'Pending';
  const name        = displayName(s);
  const label       = userLabel(s);
  const access      = accessLevelFromRoles(userRoles);

  return (
    <>
      <tr
        className={cn(
          'border-b border-border/50 transition-colors last:border-0',
          roleOpen ? 'bg-violet-50/40 dark:bg-violet-950/10' : 'hover:bg-muted/30',
        )}
        data-testid={`admin-user-row-${s.id}`}
      >
        {/* Name */}
        <td className="py-2.5 pl-4 pr-2">
          <div className="flex items-center gap-2.5">
            <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0', avatarCls)}>
              {initials(s.first_name, s.last_name, s.username)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-medium leading-tight truncate">{name}</span>
                {access.label === 'Elevated' && (
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[8px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border border-violet-200 dark:border-violet-800 shrink-0">
                    <Zap className="w-2 h-2" /> Elevated
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-muted-foreground">@{s.username ?? '—'}</div>
            </div>
          </div>
        </td>

        {/* Plants */}
        <td className="py-2.5 px-2">
          <div className="flex flex-wrap gap-1">
            {assignments.slice(0, 2).map((id) => (
              <span key={id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border/60">
                {shared.plantName(id)}
              </span>
            ))}
            {assignments.length > 2 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                +{assignments.length - 2}
              </span>
            )}
            {assignments.length === 0 && (
              <span className="text-[10.5px] text-muted-foreground italic">None</span>
            )}
          </div>
        </td>

        {/* Designation */}
        <td className="py-2.5 px-2 hidden sm:table-cell">
          <span className="text-[11px] text-muted-foreground truncate max-w-[120px] block" title={s.designation ?? ''}>
            {s.designation || <span className="italic opacity-40">—</span>}
          </span>
        </td>

        {/* Status */}
        <td className="py-2.5 px-2">
          <div className="flex items-center gap-1.5">
            <StatusDot status={s.status} />
            <span className={cn(
              'text-[11px]',
              s.status === 'Active'    ? 'text-green-700 dark:text-green-400' :
              s.status === 'Suspended' ? 'text-red-600 dark:text-red-400'     : 'text-amber-600 dark:text-amber-400',
            )}>
              {s.status ?? 'Pending'}
            </span>
          </div>
        </td>

        {/* Actions */}
        <td className="py-2.5 pl-2 pr-4">
          <div className="flex items-center justify-end gap-1.5">
            {awaiting && (
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] shrink-0"
                onClick={() => shared.approveUser(s.id, label)}
                data-testid={`approve-user-${s.id}`}
              >
                Approve
              </Button>
            )}

            {/* Role toggle */}
            <button
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded-md border transition-colors shrink-0',
                roleOpen
                  ? 'bg-violet-100 border-violet-400 text-violet-700 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-300'
                  : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              title="Change role"
              aria-label="Change role"
              onClick={() => setRoleOpen((v) => !v)}
            >
              <ShieldCheck className="w-3 h-3" />
            </button>

            {/* Change password */}
            <button
              className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-300 transition-colors shrink-0"
              title="Change password"
              aria-label="Change password"
              onClick={() => shared.onChangePassword(s.id, label)}
            >
              <KeyRound className="w-3 h-3" />
            </button>

            {/* Edit plants */}
            <PlantAssignmentEditor
              userId={s.id}
              userLabel={label}
              currentPlantIds={assignments}
              singlePlantOnly={isOperator}
              invalidateKeys={[['admin-users'], ['staff']]}
              trigger={
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                  title="Edit plants"
                  aria-label="Edit plants"
                >
                  <Building2 className="w-3 h-3" />
                </button>
              }
            />

            {/* Delete / more */}
            <DeleteEntityMenu
              kind="user" id={s.id} label={label}
              canSoftDelete={s.status === 'Active'} canHardDelete
              invalidateKeys={[['admin-users'], ['admin-user-roles'], ['staff'], ['all-roles']]}
              compact
              trigger={
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                  title="More options"
                  aria-label="More options"
                >
                  <MoreVertical className="w-3 h-3" />
                </button>
              }
            />
          </div>
        </td>
      </tr>

      {/* Inline role panel */}
      {roleOpen && (
        <tr className="border-b border-violet-100 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/10">
          <td colSpan={5} className="px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Change role
              </span>
              <RoleSelector userId={s.id} currentRoles={userRoles} onChanged={shared.invalidate} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Card-role section (Admin, Manager, Supervisor) ────────────────────────────

function CardRoleSection({
  role, users, rolesOf, ...shared
}: { role: AppRole | 'No role'; users: any[]; rolesOf: (uid: string) => string[] } & SharedTileProps) {
  const label = role === 'No role' ? 'No role' : ROLE_PLURAL[role as AppRole];

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">{users.length}</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>
      {/* Card grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {users.map((s) => (
          <UserCard key={s.id} s={s} userRoles={rolesOf(s.id)} {...shared} />
        ))}
      </div>
    </div>
  );
}

// ── Table-role section (Technician, Operator) ─────────────────────────────────

function TableRoleSection({
  role, users, rolesOf, ...shared
}: { role: AppRole | 'No role'; users: any[]; rolesOf: (uid: string) => string[] } & SharedTileProps) {
  const [page, setPage] = useState(0);
  const label      = role === 'No role' ? 'No role' : ROLE_PLURAL[role as AppRole];
  const totalPages = Math.ceil(users.length / OPERATORS_PER_PAGE);
  const pageUsers  = users.slice(page * OPERATORS_PER_PAGE, (page + 1) * OPERATORS_PER_PAGE);

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">{users.length}</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground py-2 pl-4 pr-2">User</th>
              <th className="text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground py-2 px-2">Plant</th>
              <th className="text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground py-2 px-2 hidden sm:table-cell">Designation</th>
              <th className="text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground py-2 px-2">Status</th>
              <th className="text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground py-2 pl-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageUsers.map((s) => (
              <UserTableRow key={s.id} s={s} userRoles={rolesOf(s.id)} {...shared} />
            ))}
          </tbody>
        </table>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/20">
            <span className="text-[11px] text-muted-foreground">
              Page {page + 1} of {totalPages} · {users.length} users
            </span>
            <div className="flex items-center gap-1">
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
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
  const [changePw, setChangePw] = useState<{ userId: string; userName: string } | null>(null);

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

  // Filter users
  const filtered = useMemo(() => {
    let list = (staff ?? []) as any[];
    if (pendingOnly) list = list.filter((s) => s.confirmed === false || s.status === 'Pending');
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [s.first_name, s.last_name, s.username, s.designation]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q)),
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

  const sharedProps: SharedTileProps = {
    plantName,
    existingDesignations,
    updateDesignation,
    approveUser,
    invalidate,
    onChangePassword: (userId, userName) => setChangePw({ userId, userName }),
  };

  const activeCardGroups  = [...CARD_ROLES,  'No role' as const].filter((r) => grouped[r]?.length > 0);
  const activeTableGroups = TABLE_ROLES.filter((r) => grouped[r]?.length > 0);
  const hasAny = activeCardGroups.length > 0 || activeTableGroups.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Toolbar ── */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
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
          Pending
          {pendingCount > 0 && (
            <span className={cn(
              'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none',
              pendingOnly
                ? 'bg-white/20 text-white'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
            )}>
              {pendingCount}
            </span>
          )}
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="admin-create-user-btn">
          <UserPlus className="h-3 w-3 mr-1" /> Add user
        </Button>
      </div>

      {/* ── Content ── */}
      {hasAny ? (
        <div className="space-y-6">
          {/* Card sections: Admin, Manager, Supervisor */}
          {activeCardGroups.map((role) => (
            <CardRoleSection
              key={role}
              role={role as AppRole | 'No role'}
              users={grouped[role]}
              rolesOf={rolesOf}
              {...sharedProps}
            />
          ))}

          {/* Table sections: Technician, Operator */}
          {activeTableGroups.map((role) => (
            <TableRoleSection
              key={role}
              role={role as AppRole}
              users={grouped[role]}
              rolesOf={rolesOf}
              {...sharedProps}
            />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          {pendingOnly ? 'No pending approvals.' : 'No users found.'}
        </Card>
      )}

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={invalidate} />
      {changePw && (
        <ChangePasswordDialog
          open={!!changePw}
          onClose={() => setChangePw(null)}
          userId={changePw.userId}
          userName={changePw.userName}
        />
      )}
    </div>
  );
}
