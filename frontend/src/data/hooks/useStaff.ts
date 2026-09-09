/**
 * data/hooks/useStaff.ts — React Query wrappers for staff data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries with React Query caching, so UI
 * components never touch supabase directly.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { fetchAllStaff, fetchAllUserRoles, fetchPlantsWithStaff, fetchPlantFlags, fetchEntityCountsPerPlant, fetchKpiReadings, type StaffMember } from '@/data/queries/staff';
import { createStaffProfile, updateStaffProfile, deleteStaffProfile, assignUserRole, removeUserRole, updatePlantAssignments, updateUserStatus, type UserProfileInsert, type UserProfileUpdate, type UserRole, type ProfileStatus } from '@/data/mutations/staff';

/** All staff members */
export function useStaff() {
  return useQuery({
    queryKey: queryKeys.staff.list(),
    queryFn: fetchAllStaff,
    staleTime: 60_000,
  });
}

/** All user roles */
export function useAllUserRoles() {
  return useQuery({
    queryKey: queryKeys.staff.roles(),
    queryFn: fetchAllUserRoles,
    staleTime: 60_000,
  });
}

/** Plants with staff assignments */
export function usePlantsWithStaff() {
  return useQuery({
    queryKey: queryKeys.staff.plantsWithStaff(),
    queryFn: fetchPlantsWithStaff,
    staleTime: 60_000,
  });
}

/** Plant flags for KPI calculations */
export function usePlantFlags() {
  return useQuery({
    queryKey: queryKeys.staff.plantFlags(),
    queryFn: fetchPlantFlags,
    staleTime: 60_000,
  });
}

/** Entity counts per plant for KPI denominators */
export function useEntityCountsPerPlant() {
  return useQuery({
    queryKey: queryKeys.staff.entityCounts(),
    queryFn: fetchEntityCountsPerPlant,
    staleTime: 60_000,
  });
}

/** KPI readings for a given range */
export function useKpiReadings(range: 'today' | number) {
  return useQuery({
    queryKey: queryKeys.staff.kpiReadings(range),
    queryFn: () => fetchKpiReadings(range),
    staleTime: 30_000,
  });
}

/** Create staff profile mutation */
export function useCreateStaffProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStaffProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
    },
  });
}

/** Update staff profile mutation */
export function useUpdateStaffProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: UserProfileUpdate }) => 
      updateStaffProfile(userId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
    },
  });
}

/** Delete staff profile mutation */
export function useDeleteStaffProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStaffProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
    },
  });
}

/** Assign user role mutation */
export function useAssignUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) => assignUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.roles() });
    },
  });
}

/** Remove user role mutation */
export function useRemoveUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) => removeUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.roles() });
    },
  });
}

/** Update plant assignments mutation */
export function useUpdatePlantAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, plantIds }: { userId: string; plantIds: string[] }) => 
      updatePlantAssignments(userId, plantIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
    },
  });
}

/** Update user status mutation */
export function useUpdateUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: ProfileStatus }) => 
      updateUserStatus(userId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
    },
  });
}

export type { StaffMember, UserProfileInsert, UserProfileUpdate, UserRole, ProfileStatus };