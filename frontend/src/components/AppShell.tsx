import { useRef, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import { useBackgroundSync } from '@/hooks/useBackgroundSync';

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
    <div ref={divRef} className="page-enter flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-5 py-5 pb-20 md:pb-8">
      {children}
    </div>
  );
}

export function AppShell() {
  useScrollRestore();

  return (
    <SidebarProvider>
      {/* Mounts the sync interval; renders nothing itself */}
      <BackgroundSyncMount />
      <div className="min-h-screen flex w-full bg-background">
        {/* Sidebar — hidden below md */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />

          {/*
            PageAnimationWrapper re-triggers the page-enter animation on route
            changes without unmounting the subtree, preserving all in-memory
            state (filters, form inputs, tab selections) across navigations.
          */}
          <main className="flex-1 flex flex-col min-w-0">
            <PageAnimationWrapper>
              <Outlet />
            </PageAnimationWrapper>
          </main>

          <BottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
}
