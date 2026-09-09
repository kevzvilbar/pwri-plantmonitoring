/**
 * data/hooks/useAuth.ts — React Query wrappers for auth data
 * (roadmap Phase 3). These are the component-facing entry points: they wrap
 * the pure functions in src/data/queries/mutations with React Query caching.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { 
  fetchPlantsForSignup,
  fetchOperatorPeers,
  fetchUserProfile,
  logLoginAttempt,
  logSignUpAudit,
} from '@/data/queries/auth';
import { 
  signInWithPassword,
  signUpWithPassword,
  signOut,
  completeOnboarding,
  updateUserPassword,
  resetPasswordForEmail,
  verifyOtp,
} from '@/data/mutations/auth';

/** Fetch plants for sign-up plant assignment */
export function usePlantsForSignup() {
  return useQuery({
    queryKey: queryKeys.auth.plantsForSignup(),
    queryFn: fetchPlantsForSignup,
    staleTime: 60_000,
  });
}

/** Fetch operator peers for a plant */
export function useOperatorPeers(plantId: string | null) {
  return useQuery({
    queryKey: queryKeys.auth.operatorPeers(plantId ?? ''),
    queryFn: () => fetchOperatorPeers(plantId!),
    enabled: !!plantId,
    staleTime: 60_000,
  });
}

/** Fetch user profile with designation */
export function useUserProfile(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.auth.userProfile(userId ?? ''),
    queryFn: () => fetchUserProfile(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/** Log login attempt (fire-and-forget mutation) */
export function useLogLoginAttempt() {
  return useMutation({
    mutationFn: logLoginAttempt,
  });
}

/** Log sign-up audit (fire-and-forget mutation) */
export function useLogSignUpAudit() {
  return useMutation({
    mutationFn: logSignUpAudit,
  });
}

/** Sign in mutation */
export function useSignIn() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => signInWithPassword(email, password),
  });
}

/** Sign up mutation */
export function useSignUp() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => signUpWithPassword(email, password),
  });
}

/** Sign out mutation */
export function useSignOut() {
  return useMutation({
    mutationFn: signOut,
  });
}

/** Complete onboarding mutation */
export function useCompleteOnboarding() {
  return useMutation({
    mutationFn: completeOnboarding,
  });
}

/** Update password mutation */
export function useUpdatePassword() {
  return useMutation({
    mutationFn: updateUserPassword,
  });
}

/** Reset password for email mutation */
export function useResetPasswordForEmail() {
  return useMutation({
    mutationFn: resetPasswordForEmail,
  });
}

/** Verify OTP mutation */
export function useVerifyOtp() {
  return useMutation({
    mutationFn: ({ email, token }: { email: string; token: string }) => verifyOtp(email, token),
  });
}

export type { };