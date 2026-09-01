/**
 * usePresence  –  Global online-presence tracking for the entire app.
 *
 * Strategy (three layers, most-reliable to least-reliable):
 *
 *  1. Supabase Realtime BROADCAST  – "activity-pings" channel
 *     When any user stamps activity they broadcast { userId, updatedAt }.
 *     Every other tab (admin on /employees, operators on other pages) receives
 *     this and IMMEDIATELY patches the ['staff'] cache so the card goes green
 *     without any round-trip to the database.
 *     Broadcast always works — no table publication setup required.
 *
 *  2. Database heartbeat (updated_at)  – durable source of truth.
 *     Written every 60 s + on every form submit + on tab focus.
 *     Guarantees that even a late-joining browser sees correct status on load.
 *
 *  3. Periodic refetch safety net (2 min)
 *     Re-fetches ['staff'] every 2 minutes in the background so stragglers
 *     or missed broadcasts are corrected automatically.
 *
 *  Why we moved away from Postgres Realtime changes:
 *    The user_profiles table must be explicitly added to Supabase's Realtime
 *    publication in the dashboard before postgres_changes events fire.  That
 *    step was never done, so the subscription was silently a no-op.  Broadcast
 *    requires zero database setup and fires within ~300 ms.
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
// Broadcast channel name (shared across all tabs / browsers)
// ---------------------------------------------------------------------------
const ACTIVITY_CHANNEL = 'activity-pings';

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

  // Broadcast channel ref – reused for both send and receive.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------------------------------------------------------------------------
  // Patch helper – update a single user's updated_at in the ['staff'] cache
  // ---------------------------------------------------------------------------
  const patchCache = useCallback(
    (userId: string, updatedAt: string) => {
      queryClient.setQueryData<any[]>(['staff'], (prev) => {
        if (!prev) return prev;
        return prev.map((s) =>
          s.id === userId ? { ...s, updated_at: updatedAt } : s
        );
      });
    },
    [queryClient]
  );

  // ---------------------------------------------------------------------------
  // Stamp: write updated_at to DB + broadcast to all other browsers
  // ---------------------------------------------------------------------------
  const stamp = useCallback(async () => {
    if (!currentUserId) return;
    const now = Date.now();
    if (now - lastStampRef.current < 10_000) return; // debounce 10 s
    lastStampRef.current = now;

    const isoNow = new Date(now).toISOString();

    // 1. Optimistically patch own entry in the local cache immediately.
    patchCache(currentUserId, isoNow);

    // 2. Broadcast to every other connected browser (fastest path).
    channelRef.current?.send({
      type: 'broadcast',
      event: 'ping',
      payload: { userId: currentUserId, updatedAt: isoNow },
    });

    // 3. Persist to DB (durable – source of truth on page reload).
    try {
      await supabase
        .from('user_profiles')
        .update({ updated_at: isoNow })
        .eq('id', currentUserId);
    } catch {
      // Non-blocking – presence is best-effort
    }
  }, [currentUserId, patchCache]);

  // Register as the global stamp function.
  useEffect(() => {
    _globalStamp = stamp;
    return () => { _globalStamp = null; };
  }, [stamp]);

  // ---------------------------------------------------------------------------
  // Supabase Broadcast subscription – receive pings from other browsers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const ch = supabase
      .channel(ACTIVITY_CHANNEL, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'ping' }, ({ payload }) => {
        // Another user submitted data or their heartbeat fired.
        if (payload?.userId && payload?.updatedAt) {
          patchCache(payload.userId as string, payload.updatedAt as string);
        }
      })
      .subscribe();

    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [patchCache]);

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
  // Safety-net: refetch ['staff'] every 2 minutes to catch any missed broadcasts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    }, 120_000);
    return () => clearInterval(interval);
  }, [queryClient]);

  // ---------------------------------------------------------------------------
  // isUserOnline – reads directly from the 'staff' query cache
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
