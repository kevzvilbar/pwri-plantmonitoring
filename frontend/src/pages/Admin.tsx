import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ShieldAlert, Users, Building2, Search } from 'lucide-react';

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
          Manage user accounts and plants. Soft-delete keeps audit trails;
          permanent delete is blocked while dependencies exist.
        </p>
      </div>
      <Tabs defaultValue={isAdmin ? 'users' : 'plants'}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="users" disabled={!isAdmin} data-testid="admin-tab-users">
            <Users className="h-3 w-3 mr-1" /> Users {!isAdmin && '(Admin)'}
          </TabsTrigger>
          <TabsTrigger value="plants" data-testid="admin-tab-plants">
            <Building2 className="h-3 w-3 mr-1" /> Plants
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
      </Tabs>
    </div>
  );
}

function UsersPanel() {
  const [query, setQuery] = useState('');
  const { data: staff } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await supabase.from('user_profiles').select('*').order('last_name')).data ?? [],
  });
  const { data: roles } = useQuery({
    queryKey: ['admin-user-roles'],
    queryFn: async () => (await supabase.from('user_roles').select('user_id, role')).data ?? [],
  });
  const roleOf = (uid: string) =>
    (roles ?? []).filter((r: any) => r.user_id === uid).map((r: any) => r.role).join(', ') || '—';

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
      {filtered.map((s: any) => (
        <Card key={s.id} className="p-3" data-testid={`admin-user-card-${s.id}`}>
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">
                {s.first_name} {s.last_name} {s.suffix}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {s.designation ?? '—'} · @{s.username ?? '—'}
              </div>
              <div className="text-xs mt-1">
                Role: <span className="font-medium">{roleOf(s.id)}</span>
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
        </Card>
      ))}
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
              <div className="text-xs mt-1">
                RO trains: <span className="font-medium">{p.num_ro_trains}</span>
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
