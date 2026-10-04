import { useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { StaffMember, fullName, getPresence, getRoleConfig, OnlineIds } from '../../types';
import { useAuth } from '@/hooks/useAuth';
import { usePresence } from '@/hooks/usePresence';
import { usePlants } from '@/hooks/usePlants';
import { useStaff, useAllUserRoles } from '@/data/hooks/useStaff';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function useStaffData(onlineIds: OnlineIds) {
  const { isAdmin, user, activeOperator } = useAuth();
  const { data: plants = [] } = usePlants();
  const { isUserOnline } = usePresence();
  const queryClient = useQueryClient();

  const { data: staffData = [], refetch: refetchStaff } = useStaff();
  // Cast to local StaffMember type (fields are compatible)
  const staff = staffData as StaffMember[];
  
  useEffect(() => {
    const ch = supabase
      .channel('staff-presence')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_profiles' }, () => {
        refetchStaff();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetchStaff]);

  const { data: roles = [] } = useAllUserRoles();

  const getMemberRole = useCallback((member: StaffMember) => {
    const found = (roles as any[]).find((r) => r.user_id === member.id)?.role;
    if (found) return found;
    if (member.designation) {
      if (member.designation === 'Admin') return 'Admin';
      if (member.designation === 'Manager') return 'Manager';
      if (member.designation === 'Data Analyst') return 'Data Analyst';
      if (member.designation === 'Technician' || member.designation === 'Maintenance') return 'Technician';
      if (member.designation === 'Operator') return 'Operator';
      return member.designation;
    }
    return 'Operator';
  }, [roles]);

  const onlineCount = staff.filter((s) => onlineIds.has(s.id) || getPresence(s.last_seen_at, s.status, onlineIds.has(s.id)) === 'active').length;
  const leadershipCount = staff.filter((s) => {
    const r = getMemberRole(s);
    return r === 'Admin' || r === 'Manager';
  }).length;
  const analystCount = staff.filter((s) => {
    const r = getMemberRole(s);
    return r === 'Data Analyst';
  }).length;
  const operatorCount = staff.length - leadershipCount - analystCount;

  const filterStaff = useCallback((search: string, filterPlant: string, roleFilter: string) => {
    const q = search.toLowerCase();
    return staff.filter((s) => {
      const nameMatch = !q || fullName(s).toLowerCase().includes(q) || (s.username ?? '').toLowerCase().includes(q);
      const plantMatch = filterPlant === 'all' || s.plant_assignments?.includes(filterPlant);

      const r = getMemberRole(s);
      const isOnline = onlineIds.has(s.id) || getPresence(s.last_seen_at, s.status, onlineIds.has(s.id)) === 'active';

      let roleMatch = true;
      if (roleFilter === 'online') roleMatch = isOnline;
      else if (roleFilter === 'leadership') roleMatch = r === 'Admin' || r === 'Manager';
      else if (roleFilter === 'analyst') roleMatch = r === 'Data Analyst';
      else if (roleFilter === 'operator') roleMatch = r === 'Operator' || r === 'Technician';

      return nameMatch && plantMatch && roleMatch;
    });
  }, [staff, getMemberRole, onlineIds]);

  const plantsWithStaff = (plants ?? []).filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  const getGroup = useCallback((filtered: StaffMember[], groupName: string) => {
    return filtered.filter((s) => {
      const r = getMemberRole(s);
      if (groupName === 'leadership') return r === 'Admin' || r === 'Manager';
      if (groupName === 'analyst') return r === 'Data Analyst';
      return r !== 'Admin' && r !== 'Manager' && r !== 'Data Analyst';
    });
  }, [getMemberRole]);

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
