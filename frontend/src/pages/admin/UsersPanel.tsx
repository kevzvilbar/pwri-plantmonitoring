import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, Hourglass, UserPlus, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmailChangeDialog, EmailChangeTarget } from '@/components/EmailChangeDialog';
import { useCustomRoles } from '@/hooks/useCustomRoles';
import { toast } from '@/components/ui/sonner';
import {
  ALL_ROLES, type AppRole, ROLE_ORDER, ROLE_PLURAL,
  CARD_ROLES, TABLE_ROLES, OPERATORS_PER_PAGE,
  primaryRole, displayName, userLabel,
} from './UsersPanel/constants';
import { type SharedTileProps } from './UsersPanel/types';
import { CreateUserDialog } from './UsersPanel/CreateUserDialog';
import { ChangePasswordDialog } from './UsersPanel/ChangePasswordDialog';
import { CardRoleSection, TableRoleSection } from './UsersPanel/UserSections';

export function UsersPanel() {
  const qc = useQueryClient();
  const { data: plants } = usePlants();
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [changePw, setChangePw] = useState<{ userId: string; userName: string } | null>(null);
  const [changeEmailTarget, setChangeEmailTarget] = useState<EmailChangeTarget | null>(null);

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
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Designation updated');
    invalidate();
  };

  const approveUser = async (uid: string, label: string) => {
    const { error } = await supabase.rpc('approve_user' as any, { _user_id: uid, _approve: true } as any);
    if (error) { toast.error(friendlyError(error)); return; }
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
      [s.first_name, s.last_name, s.username, s.designation]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q)),
    );
  }, [staff, query, pendingOnly]);

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
    onChangeEmail: (target) => setChangeEmailTarget(target),
  };

  const activeCardGroups  = [...CARD_ROLES,  'No role' as const].filter((r) => grouped[r]?.length > 0);
  const activeTableGroups = TABLE_ROLES.filter((r) => grouped[r]?.length > 0);
  const hasAny = activeCardGroups.length > 0 || activeTableGroups.length > 0;

  return (
    <div className="space-y-5">
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
              'ml-1 px-1.5 py-0.5 rounded-full text-2xs font-semibold leading-none font-mono-num',
              pendingOnly
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-warn-soft text-warn',
            )}>
              {pendingCount}
            </span>
          )}
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="admin-create-user-btn">
          <UserPlus className="h-3 w-3 mr-1" /> Add user
        </Button>
      </div>

      {hasAny ? (
        <div className="space-y-6">
          {activeCardGroups.map((role) => (
            <CardRoleSection
              key={role}
              role={role as AppRole | 'No role'}
              users={grouped[role]}
              rolesOf={rolesOf}
              {...sharedProps}
            />
          ))}
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
      {changeEmailTarget && (
        <EmailChangeDialog
          open={!!changeEmailTarget}
          onOpenChange={(open) => { if (!open) setChangeEmailTarget(null); }}
          target={changeEmailTarget}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}
