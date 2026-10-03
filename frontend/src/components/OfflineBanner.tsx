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
import { InstrumentBanner } from '@/components/InstrumentBanner';
import { usePendingOutboxCount } from '@/lib/offlineOutbox';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const pendingCount = usePendingOutboxCount();
  if (isOnline) return null;

  return (
    <div className="px-4 py-2 bg-background border-b border-border/60">
      <InstrumentBanner tone="warn" icon={WifiOff} className="max-w-[1600px] mx-auto">
        <span>
          <strong className="font-semibold text-warn">Offline Mode:</strong>{' '}
          {pendingCount > 0 ? (
            <>{pendingCount} offline update{pendingCount === 1 ? '' : 's'} queued in outbox. (Locators, Wells & RO Train Logs queue offline; Product, Power & Incidents require network connection.)</>
          ) : (
            <>You are currently offline. (Locators, Wells & RO Train Logs queue offline; Product, Power & Incidents require network connection.)</>
          )}
        </span>
      </InstrumentBanner>
    </div>
  );
}
