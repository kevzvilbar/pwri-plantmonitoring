import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * OfflineBanner
 * ─────────────
 * A slim, unmissable banner telling the operator their device has no
 * network connection *before* they try to submit a reading, rather than
 * only finding out after a submit silently fails or hangs. Complements
 * SyncIndicator (TopBar) rather than duplicating it: SyncIndicator reports
 * sync status on tap and only knows about syncs that were actually
 * attempted; this needs no tap and specifically covers the case
 * SyncIndicator can't — a write that would fail before it's even tried.
 *
 * Deliberately not a queue-and-retry mechanism. This is the awareness half
 * only: knowing you're offline before you act, not automatically
 * recovering after you do — see the mobile UX audit for why the write-side
 * half (persisting and replaying queued mutations on reconnect) is a
 * separate, materially larger piece of work than this component.
 *
 * Sits in the normal document flow between TopBar and the page content
 * (see AppShell) rather than as a floating overlay, so it doesn't need to
 * coordinate z-index or dismiss-on-scroll behavior with the sticky
 * TopBar/BottomNav — it simply pushes content down by one line while
 * visible, and collapses back to nothing the moment connectivity returns.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="shrink-0 flex items-center justify-center gap-2 bg-warn text-white text-xs font-medium px-3 py-1.5 text-center"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      You're offline — new readings won't save until you reconnect.
    </div>
  );
}
