import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { StaffMember, fullName, getPresence, getRoleConfig, OnlineIds } from '../types';
import { useAuth } from '@/hooks/useAuth';
import { usePresence } from '@/hooks/usePresence';
import { usePlants } from '@/hooks/usePlants';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function useStaffData(onlineIds: OnlineIds) {
  const { isAdmin, user, activeOperator } = useAuth();
  const { data: plants = [] } = usePlants();
  const { isUserOnline } = usePresence();
  const queryClient = useQueryClient();

  const { data: staff = [], refetch: refetchStaff } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
      if (!rpcError && rpcData) return rpcData as StaffMember[];
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
    staleTime: 0,
  });

  useEffect(() => {
    const ch = supabase
      .channel('staff-presence')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_profiles' }, () => {
        refetchStaff();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetchStaff]);

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

  const onlineCount = staff.filter((s) => onlineIds.has(s.id) || getPresence(s.last_seen_at, s.status, onlineIds.has(s.id)) === 'active').length;
  const leadershipCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Admin' || r === 'Manager';
  }).length;
  const analystCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Data Analyst';
  }).length;
  const operatorCount = staff.length - leadershipCount - analystCount;

  const filterStaff = useMemo((search: string, filterPlant: string, roleFilter: string) => {
    const q = search.toLowerCase();
    return staff.filter((s) => {
      const nameMatch = !q || fullName(s).toLowerCase().includes(q) || (s.username ?? '').toLowerCase().includes(q);
      const plantMatch = filterPlant === 'all' || s.plant_assignments?.includes(filterPlant);

      const r = (roles as any[]).find((x) => x.user_id === s.id)?.role ?? 'Operator';
      const isOnline = onlineIds.has(s.id) || getPresence(s.last_seen_at, s.status, onlineIds.has(s.id)) === 'active';

      let roleMatch = true;
      if (roleFilter === 'online') roleMatch = isOnline;
      else if (roleFilter === 'leadership') roleMatch = r === 'Admin' || r === 'Manager';
      else if (roleFilter === 'analyst') roleMatch = r === 'Data Analyst';
      else if (roleFilter === 'operator') roleMatch = r === 'Operator' || r === 'Technician';

      return nameMatch && plantMatch && roleMatch;
    });
  }, [staff, roles, onlineIds]);

  const plantsWithStaff = (plants ?? []).filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  const getGroup = useMemo((filtered: StaffMember[], groupName: string) => {
    return filtered.filter((s) => {
      const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
      if (groupName === 'leadership') return r === 'Admin' || r === 'Manager';
      if (groupName === 'analyst') return r === 'Data Analyst';
      return r !== 'Admin' && r !== 'Manager' && r !== 'Data Analyst';
    });
  }, [roles]);

  const getMemberRole = (member: StaffMember) => (roles as any[]).find((r) => r.user_id === member.id)?.role ?? 'Operator';

  return {
    staff,
    plants,
    roles,
    isAdmin,
    user,
    activeOperator,
    onlineIds,
    onlineCount,
    leadershipCount,
    analystCount,
    operatorCount,
    filterStaff,
    plantsWithStaff,
    getGroup,
    getMemberRole,
    refetchStaff,
  };
}
