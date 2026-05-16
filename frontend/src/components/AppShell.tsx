import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useScrollRestore } from '@/hooks/useScrollRestore';

export function AppShell() {
  useScrollRestore();
  const { pathname } = useLocation();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        {/* Sidebar — hidden below md */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />

          {/*
            max-w-[1280px]: wider than the old max-w-5xl (1024px) now that the
            sidebar is 13.5 rem instead of 16 rem — reclaims the freed space.
            px-4 sm:px-5: tighter gutter that still breathes on wide screens.
            pb-20 md:pb-8: clears the 56px mobile bottom nav + safe-area inset.
          */}
          <main
            key={pathname}
            className="page-enter flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-5 py-5 pb-20 md:pb-8"
          >
            <Outlet />
          </main>

          <BottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
}
