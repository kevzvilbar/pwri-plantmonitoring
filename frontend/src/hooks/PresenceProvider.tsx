import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { registerGlobalStampActivity } from '@/lib/presenceStamp';
import { PresenceContext } from './usePresence';

const ACTIVITY_CHANNEL = 'activity-pings';

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
  const channelSubscribedRef = useRef<boolean>(false);

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
  const stamp = useCallback(async (force = false) => {
    if (!currentUserId) return;
    const now = Date.now();
    // 5 minutes (300 s) for routine / focus stamps; 10 s for explicit mutations (force = true)
    const minInterval = force ? 10_000 : 300_000;
    if (now - lastStampRef.current < minInterval) return;
    lastStampRef.current = now;

    const isoNow = new Date(now).toISOString();

    // 1. Optimistically patch own entry in the local cache immediately.
    patchCacheAndPing(currentUserId, isoNow);

    // 2. Broadcast to every other connected browser (instant sub-second path).
    // Only send over the WebSocket once the channel has finished joining; calling
    // .send() before SUBSCRIBED triggers a deprecated REST fallback warning.
    try {
      if (channelSubscribedRef.current && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ping',
          payload: { userId: currentUserId, updatedAt: isoNow },
        });
      }
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

  // Register as the global stamp function (always force-enabled for explicit data actions).
  useEffect(() => {
    registerGlobalStampActivity(() => stamp(true));
    return () => { registerGlobalStampActivity(null); };
  }, [stamp]);

  // ---------------------------------------------------------------------------
  // Supabase Broadcast subscription – receive pings from other browsers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    channelSubscribedRef.current = false;
    const ch = supabase
      .channel(ACTIVITY_CHANNEL, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'ping' }, ({ payload }) => {
        // Another user submitted data or their heartbeat fired.
        if (payload?.userId && payload?.updatedAt) {
          patchCacheAndPing(payload.userId as string, payload.updatedAt as string);
        }
      })
      .subscribe((status) => {
        channelSubscribedRef.current = status === 'SUBSCRIBED';
      });

    channelRef.current = ch;
    return () => {
      channelSubscribedRef.current = false;
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [patchCacheAndPing]);

  // Track user interaction timestamp to avoid idle heartbeats
  const lastUserActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    const recordActivity = () => {
      lastUserActivityRef.current = Date.now();
    };
    window.addEventListener('mousemove', recordActivity, { passive: true });
    window.addEventListener('keydown', recordActivity, { passive: true });
    window.addEventListener('touchstart', recordActivity, { passive: true });
    window.addEventListener('scroll', recordActivity, { passive: true });

    return () => {
      window.removeEventListener('mousemove', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      window.removeEventListener('touchstart', recordActivity);
      window.removeEventListener('scroll', recordActivity);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Periodic heartbeat (600 s / 10 min) + tab-focus heartbeat + shift-change stamp
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUserId) return;
    const isLowQuota = import.meta.env.VITE_LOW_QUOTA_MODE === '1' || import.meta.env.VITE_LOW_QUOTA_MODE === 'true';

    stamp(true); // immediate on mount / login / operator switch

    if (isLowQuota) return; // In low quota mode, skip periodic background heartbeats

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Skip heartbeat if user has been inactive for > 10 min
      if (Date.now() - lastUserActivityRef.current > 600_000) return;
      stamp();
    }, 600_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastUserActivityRef.current = Date.now();
        stamp();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUserId, stamp]);

  // ---------------------------------------------------------------------------
  // Safety-net: refetch ['staff'] every 600 seconds / 10 mins (when tab is visible)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      queryClient.invalidateQueries({ queryKey: ['staff'], refetchType: 'active' });
    }, 600_000);
    return () => clearInterval(interval);
  }, [queryClient]);

  // ---------------------------------------------------------------------------
  // isUserOnline – checks both in-memory live pings AND 'staff' query cache
  // ---------------------------------------------------------------------------
  const isUserOnline = useCallback(
    (userId?: string | null): boolean => {
      if (!userId) return false;

      // 1. In-memory live ping check (< 20 mins)
      const lastPing = livePingsRef.current.get(userId);
      if (lastPing && (Date.now() - lastPing) / 60_000 < 20) {
        return true;
      }

      // 2. Database query cache check (< 20 mins)
      const staff = queryClient.getQueryData<any[]>(['staff']) ?? [];
      const member = staff.find((s) => s.id === userId);
      if (member?.last_seen_at) {
        const diffMin = (Date.now() - new Date(member.last_seen_at).getTime()) / 60_000;
        if (diffMin < 20) return true;
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
