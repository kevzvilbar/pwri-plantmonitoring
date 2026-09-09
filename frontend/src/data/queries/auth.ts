/**
 * data/queries/auth.ts — Auth query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * auth-related operations (plants, operator peers, etc).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';

/** Fetch all plants for sign-up plant assignment */
export async function fetchPlantsForSignup(): Promise<Array<{ id: string; name: string; address?: string }>> {
  const { data, error } = await supabase
    .from('plants')
    .select('id, name, address')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; address?: string }>;
}

/** Fetch operator peers for a plant (for operator sign-in picker) */
export async function fetchOperatorPeers(plantId: string): Promise<Array<{
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  plant_assignments: string[];
}>> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, first_name, last_name, plant_assignments')
    .eq('designation', 'Operator')
    .eq('status', 'Active')
    .contains('plant_assignments', [plantId]);
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    plant_assignments: string[];
  }>;
}

/** Fetch user profile with designation */
export async function fetchUserProfile(userId: string): Promise<{
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  designation: string | null;
  plant_assignments: string[] | null;
  status: string | null;
} | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, first_name, last_name, designation, plant_assignments, status')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Log login attempt audit */
export async function logLoginAttempt(params: {
  emailAttempted: string;
  username?: string | null;
  success: boolean;
  userId?: string | null;
  plantId?: string | null;
  errorReason?: string | null;
}): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  const { error } = await supabase.from('login_attempts' as any).insert({
    email: params.emailAttempted,
    user_id: params.userId ?? null,
    username: params.username ?? null,
    plant_id: params.plantId ?? null,
    success: params.success,
    error_reason: params.errorReason ?? null,
    device_id: deviceId,
    user_agent: navigator.userAgent.slice(0, 500),
  } as any);
  if (error) console.warn('[Auth] login attempt audit failed:', error);
}

/** Log sign-up audit */
export async function logSignUpAudit(params: {
  email: string;
  designation: string;
  operatorCount: number;
  plantIds: string[];
}): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  const { error } = await supabase.from('signup_audit' as any).insert({
    email: params.email,
    designation: params.designation,
    operator_count: params.operatorCount,
    plant_ids: params.plantIds,
    device_id: deviceId,
    user_agent: navigator.userAgent.slice(0, 500),
  } as any);
  if (error) console.warn('[Auth] sign-up audit failed:', error);
}

/** Get or create device ID for audit logging */
function getOrCreateDeviceId(): string {
  const key = 'pwri-device-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}