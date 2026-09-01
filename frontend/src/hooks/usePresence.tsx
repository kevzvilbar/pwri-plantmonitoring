/**
 * usePresence  –  Global online-presence tracking for the entire app.
 *
 * Strategy (two complementary layers):
 *
 *  1. Database heartbeat  – update user_profiles.updated_at every 60 s AND on
 *     every successful mutation (via stampActivity).  Also fires on tab focus.
 *     This is the durable, persistent source of truth.
 *
 *  2. Supabase Realtime Postgres subscription  – watch UPDATE events on
 *     user_profiles so every browser tab (e.g. the admin on /employees) sees
 *     the latest updated_at for ALL users in real-time.
 *
 *  Because updated_at is the canonical "last seen" field, getPresence() in
 *  Employees.tsx returns 'active' for any user whose updated_at is < 15 min ago.
 *  stampActivity() must be called on every form submission / data entry so the
 *  admin can see that the operator is actively working.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Module-level stamp so App.tsx MutationCache.onSuccess can call it without
// needing access to the React context tree.
// ---------------------------------------------------------------------------
let _globalStamp: (() => void) | null = null;

/** Call this after any successful mutation to mark the current user as active. */
export function globalStampActivity() {
  _globalStamp?.();
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PresenceContextValue {
  /** True if userId has been seen active within the last 15 minutes. */
  isUserOnline: (userId?: string | null) => boolean;
  /** Immediately update user_profiles.updated_at for the current user. */
  stampActivity: () => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  isUserOnline: () => false,
  stampActivity: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, activeOperator, activeOperatorId } = useAuth();
  const queryClient = useQueryClient();

  // The ID that represents the currently-logged-in person in user_profiles.
  const currentUserId = activeOperator?.id ?? activeOperatorId ?? user?.id;

  // Track last stamp so we debounce rapid calls (max once per 10 s).
  const lastStampRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // Stamp: write updated_at to DB and optimistically update 'staff' query cache
  // ---------------------------------------------------------------------------
  const stamp = useCallback(async () => {
    if (!currentUserId) return;
    const now = Date.now();
    if (now - lastStampRef.current < 10_000) return; // debounce 10 s
    lastStampRef.current = now;

    const isoNow = new Date(now).toISOString();
    try {
      await supabase
        .from('user_profiles')
        .update({ updated_at: isoNow })
        .eq('id', currentUserId);

      // Optimistically patch the 'staff' query cache so the /employees page
      // refreshes immediately without waiting for the Realtime event.
      queryClient.setQueryData<any[]>(['staff'], (prev) =>
        prev?.map((s) => (s.id === currentUserId ? { ...s, updated_at: isoNow } : s)) ?? prev
      );
    } catch {
      // Non-blocking – presence is best-effort
    }
  }, [currentUserId, queryClient]);

  // Register as the global stamp function.
  useEffect(() => {
    _globalStamp = stamp;
    return () => { _globalStamp = null; };
  }, [stamp]);

  // ---------------------------------------------------------------------------
  // Periodic heartbeat (60 s) + tab-focus heartbeat
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUserId) return;

    stamp(); // immediate on mount / login

    const interval = setInterval(stamp, 60_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') stamp();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUserId, stamp]);

  // ---------------------------------------------------------------------------
  // Supabase Realtime Postgres subscription on user_profiles UPDATE
  // When any operator submits data → their updated_at changes → the UPDATE
  // event fires → we refetch 'staff' so the /employees page shows them online.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const ch = supabase
      .channel('presence-profile-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_profiles' },
        () => {
          // Refetch the staff list so updated_at values are current.
          queryClient.invalidateQueries({ queryKey: ['staff'] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  // ---------------------------------------------------------------------------
  // isUserOnline – reads directly from the 'staff' query cache so no extra state
  // ---------------------------------------------------------------------------
  const isUserOnline = useCallback(
    (userId?: string | null): boolean => {
      if (!userId) return false;
      const staff = queryClient.getQueryData<any[]>(['staff']) ?? [];
      const member = staff.find((s) => s.id === userId);
      if (!member) return false;
      const diffMin = (Date.now() - new Date(member.updated_at).getTime()) / 60_000;
      return diffMin < 15;
    },
    [queryClient]
  );

  const value = useMemo(
    () => ({ isUserOnline, stampActivity: stamp }),
    [isUserOnline, stamp]
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function usePresence() {
  return useContext(PresenceContext);
}
