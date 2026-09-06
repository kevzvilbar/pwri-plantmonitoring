import React from 'react';
import { Card } from '@/components/ui/card';
import { Users, AlertCircle, GitBranch, BookOpen } from 'lucide-react';
import { DirectoryStats } from '../components/DirectoryStats';
import { PendingApprovals } from '../components/PendingApprovals';
import { OrgChart } from '../components/OrgChart';
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

  return (
    <div className="space-y-3">

      {/* Directory Stats */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b">
          <Users className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">Directory Overview</span>
        </div>
        <div className="p-3">
          <DirectoryStats staff={staff} roles={roles} plants={plants} />
        </div>
      </Card>

      {/* Pending Approvals — admin only */}
      {isAdmin && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b">
            <AlertCircle className="h-4 w-4 text-warn shrink-0" />
            <span className="text-sm font-semibold">Pending Approvals</span>
          </div>
          <div className="p-3">
            <PendingApprovals staff={staff} />
          </div>
        </Card>
      )}

      {/* Reporting Tree — always visible, not foldable */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b">
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">Reporting Tree</span>
          <span className="text-2xs text-muted-foreground ml-1">by plant</span>
        </div>
        <div className="px-4 py-3">
          <OrgChart staff={staff} roles={roles} plants={plants} />
        </div>
      </Card>

      {/* App Manual */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b">
          <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">App Manual</span>
        </div>
        <div className="p-3">
          <AppManual />
        </div>
      </Card>

    </div>
  );
}


export { RegisterInfo as InfoTab };
