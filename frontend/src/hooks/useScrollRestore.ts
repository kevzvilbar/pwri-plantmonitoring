import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Persists and restores window scroll position per route pathname via
 * sessionStorage. Mount once inside AppShell — all routes are covered
 * automatically with no per-page changes needed.
 */
export function useScrollRestore() {
  const { pathname } = useLocation();
  const key = `scroll:${pathname}`;
  const restored = useRef(false);

  useEffect(() => {
    // Restore on mount
    if (!restored.current) {
      restored.current = true;
      try {
        const saved = sessionStorage.getItem(key);
        if (saved !== null) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: Number(saved), behavior: 'instant' });
          });
        }
      } catch { /* ignore */ }
    }

    return () => {
      // Save on unmount (leaving the route)
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch { /* ignore */ }
      restored.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
