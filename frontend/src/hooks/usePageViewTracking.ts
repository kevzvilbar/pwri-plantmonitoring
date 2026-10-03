import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { flushPageViews, primaryRole, recordPageView } from '@/lib/navTelemetry';

const FLUSH_EVERY_MS = 30_000;

/**
 * Records one anonymous page view per route/tab change and flushes in batches
 * (every 30 s, at 10 events, when the tab is hidden, on pagehide, on unmount).
 * Mount once, inside the authenticated shell. See lib/navTelemetry.ts.
 */
export function usePageViewTracking(): void {
  const { pathname, search } = useLocation();
  const { roles, loading } = useAuth();
  const roleRef = useRef<string | null>(null);
  roleRef.current = primaryRole(roles);

  useEffect(() => {
    // Wait for roles so the first view is not recorded with role = null.
    if (loading) return;
    recordPageView({ pathname, search, role: roleRef.current });
  }, [pathname, search, loading]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushPageViews(); };
    const onPageHide = () => { void flushPageViews(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    const timer = window.setInterval(() => { void flushPageViews(); }, FLUSH_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.clearInterval(timer);
      void flushPageViews();
    };
  }, []);
}
