/**
 * data/mutations/staff.ts — Staff/employee mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * staff operations. Components wrap them with React Query via the hooks
 * in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type UserProfileInsert = Database['public']['Tables']['user_profiles']['Insert'];
type UserProfileUpdate = Database['public']['Tables']['user_profiles']['Update'];
type UserRoleInsert = Database['public']['Tables']['user_roles']['Insert'];
type UserRoleUpdate = Database['public']['Tables']['user_roles']['Update'];

/** Valid user roles from the database enum */
type UserRole = Database['public']['Enums']['app_role'];
/** Valid profile statuses from the database enum */
type ProfileStatus = Database['public']['Enums']['profile_status'];

/** Create a new staff profile */
export async function createStaffProfile(profile: UserProfileInsert): Promise<{ id: string }> {
  const { data, error } = await supabase.from('user_profiles').insert(profile).select('id').single();
  if (error) throw error;
  return data as { id: string };
}

/** Update a staff profile */
export async function updateStaffProfile(userId: string, updates: UserProfileUpdate): Promise<void> {
  const { error } = await supabase.from('user_profiles').update(updates).eq('id', userId);
  if (error) throw error;
}

/** Delete a staff profile */
export async function deleteStaffProfile(userId: string): Promise<void> {
  const { error } = await supabase.from('user_profiles').delete().eq('id', userId);
  if (error) throw error;
}

/** Assign a role to a user */
export async function assignUserRole(userId: string, role: UserRole): Promise<void> {
  const { error } = await supabase.from('user_roles').upsert({ user_id: userId, role }, { onConflict: 'user_id,role' });
  if (error) throw error;
}

/** Remove a role from a user */
export async function removeUserRole(userId: string, role: UserRole): Promise<void> {
  const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
  if (error) throw error;
}

/** Bulk update plant assignments for a user */
export async function updatePlantAssignments(userId: string, plantIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ plant_assignments: plantIds })
    .eq('id', userId);
  if (error) throw error;
}

/** Update user status (Active/Inactive/Suspended) */
export async function updateUserStatus(userId: string, status: ProfileStatus): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ status })
    .eq('id', userId);
  if (error) throw error;
}

export type { UserProfileInsert, UserProfileUpdate, UserRoleInsert, UserRoleUpdate, UserRole, ProfileStatus };