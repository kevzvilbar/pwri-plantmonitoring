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
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { PlantAssignmentEditor } from '@/components/PlantAssignmentEditor';
import {
  DesignationCombobox, accessLevelFromRoles,
} from '@/components/DesignationCombobox';
import { toast } from '@/components/ui/sonner';
import {
  ShieldAlert, Users, Building2, Search, ClipboardList,
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

function PlantsPanel() {
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
      {data?.warning && (
        <Card className="p-3 text-xs text-amber-600 border-amber-500/30 bg-amber-500/5">
          Audit log table not reachable: <code>{data.warning}</code>.
          Run <code>supabase/migrations/20260424_deletion_audit_log.sql</code>
          in your Supabase project to enable full audit history.
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
