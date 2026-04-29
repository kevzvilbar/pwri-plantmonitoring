import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { PlantAssignmentEditor } from '@/components/PlantAssignmentEditor';
import {
  DesignationCombobox, accessLevelFromRoles,
} from '@/components/DesignationCombobox';
import { toast } from '@/components/ui/sonner';
import { Search, Hourglass } from 'lucide-react';

export function UsersPanel() {
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
