import { useRef, useEffect, useState, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { AppSidebar } from './AppSidebar';
import { OfflineBanner } from './OfflineBanner';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import { useBackgroundSync } from '@/hooks/useBackgroundSync';
import { useTrainDataRealtime } from '@/hooks/useTrainDataRealtime';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from './PullToRefresh';
import { ShiftHandoverModal } from './ShiftHandoverModal';
import { AlertsRuntime } from '@/features/notifications/AlertsRuntime';
import { CommandPalette, useCommandPaletteShortcut } from '@/components/CommandPalette';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * BackgroundSyncMount
 *
 * Isolated component that owns the background-sync lifecycle.
 * Kept separate so that sync re-renders (status changes) do NOT
 * propagate to the AppShell tree — only SyncIndicator (in TopBar)
 * reads from syncStore and re-renders itself.
 */
function BackgroundSyncMount() {
  useBackgroundSync();
  return null;
}

/**
 * TrainRealtimeMount
 *
 * Isolated component that owns the Supabase Realtime subscriptions for
 * ro_train_readings / ro_pretreatment_readings / train_status_log inserts
 * (hooks/useTrainDataRealtime.ts). Same isolation rationale as
 * BackgroundSyncMount: it renders nothing, so channel bookkeeping never
 * re-renders the shell tree.
 */
function TrainRealtimeMount() {
  useTrainDataRealtime();
  return null;
}


/**
 * PageAnimationWrapper
 *
 * Applies the page-enter CSS animation on every route change WITHOUT
 * using React's `key` prop on <main>. Using key={pathname} on <main>
 * fully unmounts + remounts the page subtree, which:
 *   - destroys in-memory filter / search / form state
 *   - prevents useTabPersist and controlled inputs from surviving navigation
 *
 * Instead we imperatively re-trigger the animation class on pathname change
 * by removing and re-adding it in a rAF cycle. The DOM node stays mounted,
 * so React state in child components is fully preserved between navigations.
 */
function PageAnimationWrapper({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const divRef = useRef<HTMLDivElement>(null);
  const prevPathRef = useRef<string>(pathname);

  useEffect(() => {
    // Skip animation on initial mount (prevPath === current path)
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;

    const el = divRef.current;
    if (!el) return;

    // Remove the class, force a reflow, then re-add it so the animation
    // fires from the start even if the class was already present.
    el.classList.remove('page-enter');
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetHeight; // trigger reflow
    el.classList.add('page-enter');
  }, [pathname]);

  return (
    <div
      ref={divRef}
      // Bottom padding must clear BottomNav's own height *plus* its safe-area
      // inset (added alongside this) or the last bit of scrollable content on
      // notched phones ends up hidden behind the nav bar. md:pb-8 is untouched
      // since BottomNav is md:hidden on desktop.
      className="page-enter flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8"
    >
      {children}
    </div>
  );
}

export function AppShell() {
  useScrollRestore();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);

  const pullState = usePullToRefresh({
    onRefresh: async () => {
      // Invalidate all active queries so live telemetry & readings refresh instantly
      await queryClient.invalidateQueries();
    },
  });

  return (
    <SidebarProvider>
      {/* Pull to refresh indicator for mobile gestures */}
      <PullToRefreshIndicator {...pullState} />

      {/* Mounts the sync interval; renders nothing itself */}
      <BackgroundSyncMount />

      {/* Realtime INSERT subscriptions for the train tables; renders nothing */}
      <TrainRealtimeMount />

      {/* P3-7: computes alarms on every route + syncs the alert_events audit
          trail into the store. Must be the ONLY mount of this. */}
      <AlertsRuntime />

      {/* P5-10 (stretch): Ctrl+K / Cmd+K palette — pages, plants, wells. */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Global Operator Shift Monitoring & Handover Verification */}
      <ShiftHandoverModal />

      <div className="min-h-screen flex w-full bg-background">
        {/* Sidebar — hidden below md */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar onOpenSearch={openPalette} />
          <OfflineBanner />

          {/*
            PageAnimationWrapper re-triggers the page-enter animation on route
            changes without unmounting the subtree, preserving all in-memory
            state (filters, form inputs, tab selections) across navigations.
          */}
          <main className="flex-1 flex flex-col min-w-0">
            <PageAnimationWrapper>
              {/*
                Per-route ErrorBoundary: keeps the shell (sidebar, topbar,
                nav) alive when a single page crashes, so operators can still
                navigate to a working page. The global ErrorBoundary in
                App.tsx is a last-resort backstop for errors outside the shell
                (e.g. AuthProvider, PresenceProvider).
              */}
              <ErrorBoundary resetKey={pathname}>
                <Outlet />
              </ErrorBoundary>
            </PageAnimationWrapper>
          </main>

          <BottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
}
