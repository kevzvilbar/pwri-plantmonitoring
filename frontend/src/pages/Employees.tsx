import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery } from '@tanstack/react-query';
import { Users, BarChart2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePresence } from '@/hooks/usePresence';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StaffTab } from './employees/tabs/StaffTab';
import { KpiTab } from './employees/tabs/KpiTab';
import { InfoTab } from './employees/tabs/InfoTab';
import { StaffMember, getPresence } from './employees/types';

export default function Employees() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useTabPersist<'staff' | 'kpi' | 'info'>('tab:employees', 'staff');

  // Deep link (e.g. from the Dashboard's Data Completeness Radar) should win
  // over whatever tab was last open in this session, not just the default.
  useEffect(() => {
    if (searchParams.get('tab') === 'kpi' && tab !== 'kpi') setTab('kpi');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: plants = [] } = usePlants();

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
      if (!rpcError && rpcData) return rpcData as StaffMember[];
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
    staleTime: 60_000,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_user_roles');
      if (!rpcError && rpcData) return rpcData as { user_id: string; role: string }[];
      const { data } = await (supabase as any).from('user_profiles').select('id, user_roles(role)');
      return (data ?? []).flatMap((p: any) =>
        (p.user_roles ?? []).map((r: any) => ({ user_id: p.id, role: r.role }))
      );
    },
  });

  const { isUserOnline: isEmpOnline } = usePresence();

  // Compute quick stats for the executive header strip
  const onlineCount = staff.filter((s) => {
    const p = getPresence(s.last_seen_at, s.status, isEmpOnline(s.id));
    return p === 'active' || p === 'idle';
  }).length;

  return (
    <div className="space-y-3 animate-fade-in">
      {/* ── People & Staff Management Strip ── */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Title */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                People &amp; Staff Management
              </h1>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-soft text-primary border border-primary/30">
                Staff Registry
              </span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              <span>Staff Directory · KPI Heatmap · Org Chart · Operations Manual</span>
            </p>
          </div>

          {/* Quick status summary chip */}
          <div className="flex items-center gap-2 shrink-0 font-sans">
            <div className="px-3 py-1.5 rounded-lg border border-border/60 bg-muted/30 text-xs font-medium text-muted-foreground flex items-center gap-2">
              <span className="text-foreground font-bold font-mono-num">{staff.length}</span> total staff
              <span className="text-border">·</span>
              <span className="text-accent font-bold font-mono-num">{onlineCount}</span> online
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex gap-0.5 p-1 rounded-xl">
          <TabsTrigger value="staff" className="flex items-center gap-1.5 rounded-lg data-[state=active]:shadow-sm">
            <Users className="h-3.5 w-3.5" />
            <span>Staff</span>
            {staff.length > 0 && (
              <span className="ml-0.5 text-2xs font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                {staff.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="kpi" className="flex items-center gap-1.5 rounded-lg data-[state=active]:shadow-sm">
            <BarChart2 className="h-3.5 w-3.5" />
            <span>KPI</span>
          </TabsTrigger>
          <TabsTrigger value="info" className="flex items-center gap-1.5 rounded-lg data-[state=active]:shadow-sm">
            <Info className="h-3.5 w-3.5" />
            <span>Info</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-3"><StaffTab /></TabsContent>
        <TabsContent value="kpi" className="mt-3">
          <KpiTab staff={staff} roles={roles} plants={plants} />
        </TabsContent>
        <TabsContent value="info" className="mt-3"><InfoTab /></TabsContent>
      </Tabs>
    </div>
  );
}
