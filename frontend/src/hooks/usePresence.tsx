import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

interface PresenceContextValue {
  onlineUserIds: Set<string>;
  isUserOnline: (userId?: string | null) => boolean;
  onlineCount: number;
}

const PresenceContext = createContext<PresenceContextValue>({
  onlineUserIds: new Set(),
  isUserOnline: () => false,
  onlineCount: 0,
});

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, activeOperator, activeOperatorId } = useAuth();
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const currentUserId = activeOperator?.id ?? activeOperatorId ?? user?.id;

  // Periodic heartbeat to database user_profiles table
  useEffect(() => {
    if (!currentUserId) return;

    const heartbeat = async () => {
      const now = new Date().toISOString();
      try {
        await supabase
          .from('user_profiles')
          .update({ updated_at: now })
          .eq('id', currentUserId);

        queryClient.setQueryData<any[]>(['staff'], (prev) =>
          prev?.map((s) => (s.id === currentUserId ? { ...s, updated_at: now } : s)) ?? prev
        );
      } catch {
        // Non-blocking
      }
    };

    heartbeat();
    const interval = setInterval(heartbeat, 60 * 1000); // 1-minute heartbeat

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        heartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUserId, queryClient]);

  // Supabase Realtime Presence Channel ('online-users')
  useEffect(() => {
    if (!currentUserId) {
      setOnlineUserIds(new Set());
      return;
    }

    const ch = supabase.channel('online-users', {
      config: { presence: { key: currentUserId } },
    });

    const syncPresence = () => {
      const state = ch.presenceState();
      const ids = new Set<string>();

      Object.entries(state).forEach(([key, presences]) => {
        if (key) ids.add(key);
        if (Array.isArray(presences)) {
          presences.forEach((p: any) => {
            if (p?.user_id) ids.add(p.user_id);
            if (p?.operator_id) ids.add(p.operator_id);
          });
        }
      });

      // Always include active current user
      if (currentUserId) ids.add(currentUserId);
      if (user?.id) ids.add(user.id);
      if (activeOperatorId) ids.add(activeOperatorId);

      setOnlineUserIds(ids);
    };

    ch.on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({
            user_id: user?.id,
            operator_id: activeOperator?.id ?? activeOperatorId,
            online_at: new Date().toISOString(),
          });
          syncPresence();
        }
      });

    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUserId, user?.id, activeOperator?.id, activeOperatorId]);

  const isUserOnline = useMemo(() => {
    return (userId?: string | null) => {
      if (!userId) return false;
      return onlineUserIds.has(userId);
    };
  }, [onlineUserIds]);

  const value = useMemo(
    () => ({
      onlineUserIds,
      isUserOnline,
      onlineCount: onlineUserIds.size,
    }),
    [onlineUserIds, isUserOnline]
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}

