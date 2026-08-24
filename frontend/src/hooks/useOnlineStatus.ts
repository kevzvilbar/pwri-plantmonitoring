import { useEffect, useState } from 'react';

/**
 * useOnlineStatus
 * ────────────────
 * Tracks browser connectivity via `navigator.onLine` and the `online`/
 * `offline` window events.
 *
 * What this can and can't tell you: `navigator.onLine` reflects whether the
 * device has *a* network interface that's up (Wi-Fi/cellular connected),
 * not whether it can actually reach this app's backend — a phone on a
 * Wi-Fi network with no real internet, or behind a captive portal, still
 * reports `online: true`. It's a reasonable, zero-cost signal for the
 * common field case (airplane mode, no signal, tunnel) but not a
 * substitute for detecting an actual failed request. `SyncIndicator`
 * (TopBar) already covers that latter case via its own error state — this
 * hook is specifically for the case where a request wouldn't even be
 * attempted, which `SyncIndicator` alone can't tell you about since it
 * only reports on syncs that were actually tried.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
