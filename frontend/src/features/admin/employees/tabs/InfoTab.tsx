import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Users, AlertCircle, CheckCircle2, GitBranch } from 'lucide-react';
import { DirectoryStats } from '../components/DirectoryStats';
import { PendingApprovals } from '../components/PendingApprovals';
import { OrgChart, HierarchyLegend } from '../components/OrgChart';
import { AppManual } from '../components/AppManual';
import { StaffMember } from '../types';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

function RegisterInfo() {
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
    staleTime: 30_000,
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

  const { isAdmin } = useAuth();
  const pending = useMemo(() => staff.filter((s) => s.status === 'Pending'), [staff]);

  return (
    <div className="space-y-3">
      {/* ── 1. Reconciled Directory & Governance Overview Card ── */}
      <Card className="overflow-hidden border-border/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-border/70 bg-muted/10">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-bold text-foreground tracking-tight">Directory &amp; Governance</span>
            <span className="text-2xs text-muted-foreground hidden sm:inline">· Active personnel &amp; access status</span>
          </div>

          {/* Inline Governance Status Badge */}
          <div className="flex items-center gap-2 shrink-0">
            {pending.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold bg-accent-soft text-accent border border-accent/25 shadow-2xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All Accounts Active (0 Pending)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold bg-warn-soft text-warn border border-warn/40 shadow-2xs animate-pulse">
                <AlertCircle className="h-3.5 w-3.5" />
                {pending.length} Pending Approval{pending.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="p-3 sm:p-3.5 space-y-3">
          {/* Actionable Pending Approvals Banner — only appears when pending accounts exist */}
          {pending.length > 0 && isAdmin && (
            <div className="p-3 rounded-xl border border-warn/40 bg-warn-soft/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-warn flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Action Required: Pending Account Registrations
                </span>
                <span className="text-3xs font-mono font-bold text-warn bg-warn/15 px-1.5 py-0.5 rounded">
                  {pending.length} waiting
                </span>
              </div>
              <PendingApprovals staff={staff} />
            </div>
          )}

          {/* Compact Telemetry & Role Grid */}
          <DirectoryStats staff={staff} roles={roles} plants={plants} />
        </div>
      </Card>

      {/* ── 2. Reporting Tree (Org Chart) with Header-Integrated Hierarchy ── */}
      <Card className="overflow-hidden border-border/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-border/70 bg-muted/10">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-bold text-foreground tracking-tight">Reporting Tree</span>
            <span className="text-2xs text-muted-foreground ml-1">by facility</span>
          </div>
          <HierarchyLegend />
        </div>
        <div className="p-3 sm:p-3.5">
          <OrgChart staff={staff} roles={roles} plants={plants} hideLegend />
        </div>
      </Card>

      {/* ── 3. Operations Manual (Rendered directly without redundant double-card wrap) ── */}
      <AppManual />
    </div>
  );
}


export { RegisterInfo as InfoTab };
