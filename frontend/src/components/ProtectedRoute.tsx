import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';
import { isOperatorOnly } from '@/lib/permissions';

// Routes an Operator is allowed to visit. Everything else redirects to /.
// Keep this in sync with AppSidebar and BottomNav allowed items.
export const OPERATOR_ALLOWED_PATHS = [
  '/',
  '/plants',
  '/operations',
  '/ro-trains',
  '/maintenance',
  '/incidents',
  '/employees',
  '/profile',
];

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, profile, roles } = useAuth();
  const loc = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!user) return <Navigate to="/auth" state={{ from: loc }} replace />;
  if (!profile?.profile_complete && loc.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  // Iteration 9: gate every protected route on Admin approval.
  // `confirmed` is undefined for projects that haven't run the
  // 20260428_admin_approval_flow.sql migration yet — treat as approved
  // in that case so the UI stays usable until the flag rolls out.
  if (
    profile?.profile_complete &&
    profile.confirmed === false &&
    loc.pathname !== '/pending-approval'
  ) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Was a 3-way duplicated inline block (ProtectedRoute / AppSidebar /
  // BottomNav each had their own copy). Now a single shared function —
  // see permissions.ts and permissions.test.ts.
  if (isOperatorOnly(roles, profile?.designation, OPERATOR_DESIGNATION)) {
    const allowed = OPERATOR_ALLOWED_PATHS.some(
      (p) => p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p),
    );
    if (!allowed) return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
