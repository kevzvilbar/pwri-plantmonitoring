import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { OPERATOR_DESIGNATION } from '@/lib/designations';
import { OPERATOR_ALLOWED_PATHS } from '@/lib/operatorAllowedPaths';
import { AppLoading } from '@/components/AppLoading';
import { isOperatorOnly } from '@/lib/permissions';
import { toast } from 'sonner';
import { AdminMfaGate } from '@/features/auth/components/AdminMfaGate';

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
  // Gate every protected route on Admin approval (fails closed).
  if (
    profile?.profile_complete &&
    profile.confirmed !== true &&
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

  // Admins must hold an aal2 (TOTP) session; non-admins pass straight through.
  return <AdminMfaGate>{children}</AdminMfaGate>;
}
