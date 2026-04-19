import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';

export default function Employees() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Employees</h1>
      <Tabs defaultValue="staff">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-3"><Staff /></TabsContent>
        <TabsContent value="info" className="mt-3"><RegisterInfo /></TabsContent>
      </Tabs>
    </div>
  );
}

function Staff() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: staff } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await supabase.from('user_profiles').select('*').order('last_name')).data ?? [],
  });
  const { data: roles } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => (await supabase.from('user_roles').select('*')).data ?? [],
  });

  const filtered = selectedPlantId ? staff?.filter(s => s.plant_assignments?.includes(selectedPlantId)) : staff;
  const roleOf = (uid: string) => roles?.filter((r: any) => r.user_id === uid).map((r: any) => r.role).join(', ') || '—';
  const plantNames = (ids: string[]) => (plants?.filter(p => ids?.includes(p.id)).map(p => p.name).join(', ')) || '—';

  const setRole = async (uid: string, role: string) => {
    if (!isAdmin) return;
    await supabase.from('user_roles').delete().eq('user_id', uid);
    await supabase.from('user_roles').insert({ user_id: uid, role: role as any });
    qc.invalidateQueries({ queryKey: ['all-roles'] });
  };

  return (
    <div className="space-y-2">
      {filtered?.map((s: any) => (
        <Card key={s.id} className="p-3">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-sm">{s.first_name} {s.last_name} {s.suffix}</div>
              <div className="text-xs text-muted-foreground">{s.designation ?? '—'} · @{s.username ?? '—'}</div>
              <div className="text-xs mt-1">Plants: <span className="text-muted-foreground">{plantNames(s.plant_assignments)}</span></div>
              <div className="text-xs">Role: <span className="font-medium">{roleOf(s.id)}</span></div>
            </div>
            <StatusPill tone={s.status === 'Active' ? 'accent' : s.status === 'Pending' ? 'warn' : 'muted'}>{s.status}</StatusPill>
          </div>
          {isAdmin && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {(['Operator', 'Technician', 'Manager', 'Admin'] as const).map(r => (
                <Button key={r} size="sm" variant="outline" onClick={() => setRole(s.id, r)}>{r}</Button>
              ))}
            </div>
          )}
        </Card>
      ))}
      {!filtered?.length && <Card className="p-4 text-xs text-center text-muted-foreground">No staff</Card>}
    </div>
  );
}

function RegisterInfo() {
  return (
    <Card className="p-4 text-sm space-y-2">
      <h3 className="font-semibold">How to register new staff</h3>
      <p className="text-muted-foreground">New users sign up themselves on the login page using their email + password. After confirming, they will be guided through a profile setup flow where they select their plants, designation, etc.</p>
      <p className="text-muted-foreground">An <strong>Admin</strong> must then set their role from the Staff tab. New users default to <strong>Operator</strong>.</p>
    </Card>
  );
}
