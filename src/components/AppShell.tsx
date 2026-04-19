import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';

export function AppShell() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 max-w-3xl w-full mx-auto px-3 sm:px-4 py-4 pb-6">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
