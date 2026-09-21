import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';
import { AppLoading } from '@/components/AppLoading';
import { isOperatorOnly } from '@/lib/permissions';
import { toast } from 'sonner';

// Routes an Operator is allowed to visit. Everything else redirects to /.
// Maintained by hand: it is NOT derived from PERMISSION_MATRIX. navConfig.test.ts
// fails if a nav item an Operator can see has a route missing from this list.
export const OPERATOR_ALLOWED_PATHS = [
  '/',
  '/plants',
  '/operations',
  '/ro-trains',
  '/maintenance',
  '/incidents',
  '/employees',
  '/profile',
  '/help',  // The manual: opened from every role's avatar menu
  '/my-corrections',  // Operators raise correction requests, so they follow them up
  '/alerts',  // Added: Operators receive alarms and need to triage them
];

// The toast is a side effect, so it lives in an effect, never in render.
// (Firing it during render, together with a setState, re-rendered until React
// threw "Too many re-renders" and posted ~100 toasts.) The fixed `id` makes
// sonner dedupe it if StrictMode runs the effect twice.
function AccessDenied() {
  useEffect(() => {
    toast.error('Access restricted', {
      id: 'access-denied',
      description: 'You do not have permission to view this page.',
      duration: 3000,
    });
  }, []);
  return <Navigate to="/" replace />;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, profile, roles } = useAuth();
  const loc = useLocation();

  if (loading) {
    return <AppLoading className="min-h-screen text-muted-foreground" />;
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
    // Never redirect silently: AccessDenied toasts, then sends them to /.
    if (!allowed) return <AccessDenied />;
  }

  return <>{children}</>;
}
