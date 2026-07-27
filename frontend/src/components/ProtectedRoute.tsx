import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';

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

  // Elevated roles (Admin, Data Analyst, Manager) have no path restrictions —
  // their feature gating is handled inside the individual page components.
  const isElevated = roles.some((r) =>
    ['Admin', 'Data Analyst', 'Manager'].includes(r),
  );

  // Operator restriction: only allowed paths are accessible.
  // We check designation AND role — a user is treated as an Operator
  // when their primary role is Operator (regardless of designation),
  // OR when their designation is Operator (regardless of role),
  // to cover edge cases where one or the other hasn't been set yet.
  const isOperator =
    !isElevated && (
      profile?.designation === OPERATOR_DESIGNATION ||
      (roles.length > 0 && roles.every((r) => r === 'Operator'))
    );

  if (isOperator) {
    const allowed = OPERATOR_ALLOWED_PATHS.some(
      (p) => p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p),
    );
    if (!allowed) return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
