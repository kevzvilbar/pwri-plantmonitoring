/**
 * SyncIndicator
 *
 * Compact TopBar widget showing background-sync state:
 *   Syncing -> animated spinning icon
 *   Error   -> amber WifiOff icon + error toast (only after all retries exhausted)
 *   Idle    -> clock icon with "last synced X ago" tooltip
 *
 * SUCCESS toasts are intentionally suppressed — sync runs silently.
 * Only critical errors (all retries exhausted) surface a warning toast.
 * Only reads from syncStore; the interval itself lives in BackgroundSyncMount (AppShell).
 */

import { useEffect, useRef } from 'react';
import { RefreshCw, WifiOff, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useSyncStore } from '@/store/syncStore';
import { useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SyncIndicator() {
  const { status, lastSynced, error, setStatus, setLastSynced, setError } = useSyncStore();
  const qc = useQueryClient();

  const lastToastedErr = useRef<string | null>(null);

  const manualSync = async () => {
    if (status === 'syncing') return;
    setStatus('syncing');
    try {
      await qc.refetchQueries({ type: 'active' }, { throwOnError: true });
      setLastSynced(new Date());
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/abort/i.test(msg)) {
        setError('Manual sync failed. Please try again.');
      }
    }
  };

  // Error toast — only when all retries are exhausted (critical failure only).
  // Success syncs are fully silent per Requirement 6.
  useEffect(() => {
    if (!error) return;
    if (error === lastToastedErr.current) return;
    lastToastedErr.current = error;

    toast.info('Sync issue', {
      description: error,
      duration: 6000,
      id: 'bg-sync-err',
    });
  }, [error]);

  // Derive tooltip label
  let label: string;
  if (status === 'syncing') {
    label = 'Syncing…';
  } else if (status === 'error') {
    label = 'Sync failed — data may be stale';
  } else if (lastSynced) {
    label = 'Last synced ' + formatDistanceToNow(lastSynced, { addSuffix: true });
  } else {
    label = 'Waiting for first sync…';
  }

  const isSyncing = status === 'syncing';
  const isError   = status === 'error';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            // Matches the 40px hit area used for the other TopBar icon
            // buttons (Bell, ThemeSelector) — see TopBar.tsx.
            'relative flex items-center justify-center h-10 w-10 rounded-md transition-colors',
            'text-topbar-foreground/60 hover:text-topbar-foreground hover:bg-white/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
            isSyncing && 'pointer-events-none',
          )}
        >
          {isSyncing && (
            <RefreshCw className="h-[15px] w-[15px] animate-spin" aria-hidden />
          )}
          {isError && (
            <WifiOff className="h-[15px] w-[15px] text-warn" aria-hidden />
          )}
          {!isSyncing && !isError && (
            <Clock className="h-[15px] w-[15px]" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-56 p-3 text-xs">
        <p className={cn('font-medium', isError ? 'text-warn' : 'text-foreground')}>{label}</p>
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-2.5 h-7 text-xs"
          onClick={manualSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" aria-hidden />
              Syncing…
            </>
          ) : 'Sync now'}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
