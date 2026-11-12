import { createContext, useContext } from 'react';
import { Session, User } from '@supabase/supabase-js';

export type Role = 'Operator' | 'Technician' | 'Manager' | 'Admin' | 'Data Analyst';

export interface Profile {
  id: string;
  username: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  designation: string | null;
  immediate_head_id: string | null;
  plant_assignments: string[];
  status: 'Pending' | 'Active' | 'Suspended';
  profile_complete: boolean;
  /** Admin-approval flag (replaces Supabase email confirmation, iter 9) */
  confirmed?: boolean;
  notice_version?: string | null;
  notice_acknowledged_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** The currently selected shift operator profile.
   *  Falls back to own profile when no override is set. */
  activeOperator: Profile | null;
  /** The raw ID stored in Zustand — null means "no override, use own profile".
   *  Expose this so UI components can mark (you) against the *active* operator
   *  rather than always the auth-owner (which breaks on shared-email accounts). */
  activeOperatorId: string | null;
  roles: Role[];
  isAdmin: boolean;
  isManager: boolean;
  /** True when the user holds Admin or Data Analyst role.
   *  Data Analysts can normalize, tag, retract, and run regression — but
   *  cannot hard-delete records or assign roles (Admin-only). */
  isDataAnalyst: boolean;
  loading: boolean;
  /** True when Supabase fires PASSWORD_RECOVERY (user clicked a reset-password link).
   *  AuthProvider auto-navigates to /auth so ResetPasswordForm can render. */
  isRecovery: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { AuthProvider } from './AuthProvider';
