/**
 * usePresence  –  Global online-presence tracking for the entire app.
 *
 * Strategy (three complementary layers):
 *
 *  1. Supabase Realtime BROADCAST  – "activity-pings" channel
 *     When any user stamps activity they broadcast { userId, updatedAt }.
 *     Every other tab (admin on /employees, operators on other pages) receives
 *     this and IMMEDIATELY marks the user as online in-memory AND patches
 *     the ['staff'] cache so the card goes green without any round-trip delay.
 *
 *  2. Database RPC Heartbeat (`touch_user_presence`)  – durable source of truth.
 *     Calls SECURITY DEFINER RPC `touch_user_presence(p_user_id)` so that a
 *     staff member (or a shift operator sharing a plant with the caller) can
 *     update their presence in `user_profiles.last_seen_at` without RLS
 *     permission errors. The RPC itself still checks the caller is allowed
 *     to touch that particular profile (self, admin, or same-plant).
 *
 *  3. Telemetry Triggers & Periodic Refetch Safety Net
 *     Database triggers on plant reading entries (`locator_readings`, `ro_train_readings`,
 *     `well_readings`, `product_meter_readings`, `chemical_dosing_logs`, etc.)
 *     automatically stamp the operator's presence whenever they log data.
 *     The ['staff'] query also refetches periodically to catch any missed pings.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
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

  // Track in-memory live pings (timestamp in ms)
  const livePingsRef = useRef<Map<string, number>>(new Map());
  const [, setTick] = useState(0);

  // Track last stamp so we debounce rapid calls (max once per 10 s).
  const lastStampRef = useRef<number>(0);

  // Broadcast channel ref – reused for both send and receive.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------------------------------------------------------------------------
  // Patch helper – update a single user's updated_at in the ['staff'] cache & pings
  // ---------------------------------------------------------------------------
  const patchCacheAndPing = useCallback(
    (userId: string, seenAt: string) => {
      const timeMs = new Date(seenAt).getTime();
      livePingsRef.current.set(userId, isNaN(timeMs) ? Date.now() : timeMs);

      // Force re-render of components using usePresence
      setTick((t) => (t + 1) % 10000);

      // Optimistically patch the 'staff' query cache
      queryClient.setQueryData<any[]>(['staff'], (prev) => {
        if (!prev) return prev;
        return prev.map((s) =>
          s.id === userId ? { ...s, last_seen_at: seenAt } : s
        );
      });
    },
    [queryClient]
  );

  // ---------------------------------------------------------------------------
  // Stamp: write updated_at via RPC to DB + broadcast to all other browsers
  // ---------------------------------------------------------------------------
  const stamp = useCallback(async () => {
    if (!currentUserId) return;
    const now = Date.now();
    if (now - lastStampRef.current < 10_000) return; // debounce 10 s
    lastStampRef.current = now;

    const isoNow = new Date(now).toISOString();

    // 1. Optimistically patch own entry in the local cache immediately.
    patchCacheAndPing(currentUserId, isoNow);

    // 2. Broadcast to every other connected browser (instant sub-second path).
    try {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'ping',
        payload: { userId: currentUserId, updatedAt: isoNow },
      });
    } catch {
      // Non-blocking
    }

    // 3. Persist to DB via SECURITY DEFINER RPC (bypasses table RLS)
    try {
      const { error } = await (supabase as any).rpc('touch_user_presence', {
        p_user_id: currentUserId,
      });
      if (error) {
        // Fallback to direct update if RPC is not present
        await supabase
          .from('user_profiles')
          .update({ updated_at: isoNow })
          .eq('id', currentUserId);
      }
    } catch {
      // Non-blocking – presence is best-effort
    }
  }, [currentUserId, patchCacheAndPing]);

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
          patchCacheAndPing(payload.userId as string, payload.updatedAt as string);
        }
      })
      .subscribe();

    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [patchCacheAndPing]);

  // ---------------------------------------------------------------------------
  // Periodic heartbeat (60 s) + tab-focus heartbeat + shift-change stamp
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUserId) return;

    stamp(); // immediate on mount / login / operator switch

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
  // Safety-net: refetch ['staff'] every 60 seconds
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    }, 60_000);
    return () => clearInterval(interval);
  }, [queryClient]);

  // ---------------------------------------------------------------------------
  // isUserOnline – checks both in-memory live pings AND 'staff' query cache
  // ---------------------------------------------------------------------------
  const isUserOnline = useCallback(
    (userId?: string | null): boolean => {
      if (!userId) return false;

      // 1. In-memory live ping check (< 15 mins)
      const lastPing = livePingsRef.current.get(userId);
      if (lastPing && (Date.now() - lastPing) / 60_000 < 15) {
        return true;
      }

      // 2. Database query cache check (< 15 mins)
      const staff = queryClient.getQueryData<any[]>(['staff']) ?? [];
      const member = staff.find((s) => s.id === userId);
      if (member?.last_seen_at) {
        const diffMin = (Date.now() - new Date(member.last_seen_at).getTime()) / 60_000;
        if (diffMin < 15) return true;
      }

      return false;
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
