/**
 * data/mutations/auth.ts — Auth mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * auth operations (sign in, sign up, password reset, complete onboarding).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';

/** Sign in with email and password */
export async function signInWithPassword(email: string, password: string): Promise<{ user: any }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Sign up with email and password */
export async function signUpWithPassword(email: string, password: string): Promise<{ user: any; session: any }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

/** Sign out */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Complete onboarding via RPC */
export async function completeOnboarding(params: {
  _username: string;
  _first_name: string;
  _middle_name: string | null;
  _last_name: string;
  _suffix: string | null;
  _designation: string | null;
  _plant_assignments: string[];
}): Promise<void> {
  const { error } = await supabase.rpc('complete_onboarding', params);
  if (error) throw error;
}

/** Update user password */
export async function updateUserPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

/** Reset password for email */
export async function resetPasswordForEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/** Verify OTP for password recovery */
export async function verifyOtp(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  });
  if (error) throw error;
}