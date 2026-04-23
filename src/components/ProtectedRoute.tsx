"use client";

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/auth');
    } else if (!profile?.profile_complete && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [loading, user, profile, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return null;
  if (!profile?.profile_complete && pathname !== '/onboarding') return null;
  return <>{children}</>;
}
