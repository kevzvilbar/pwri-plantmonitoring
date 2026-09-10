import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useSidebar } from '@/components/ui/sidebar';
import { Notification, SevTier, EMPTY_NOTIFICATIONS, EMPTY_PLANTS } from './types';
import { sevTier } from './helpers';

export function useTopBarState() {
  const { user, profile } = useAuth();
  const { isMobile, state } = useSidebar();
  const sidebarCollapsed = state === 'collapsed';
  const { data: plants } = usePlants();
  const {
    selectedPlantId, setSelectedPlantId,
    setUnreadCount, unreadCount,
    plantAlerts, removeAlerts, clearAlerts,
    snoozeAlert, pruneSnooze,
  } = useAppStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'logs'>('active');
  const [tierFilter, setTierFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [isRinging, setIsRinging] = useState(false);

  const visiblePlants = useMemo(() => {
    if (!plants) return EMPTY_PLANTS;
    if (profile?.plant_assignments?.length) {
      return plants.filter((p) => profile.plant_assignments.includes(p.id));
    }
    return plants;
  }, [plants, profile?.plant_assignments]);

  const { data: notificationsData } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async (): Promise<Notification[]> => {
      if (!user) return EMPTY_NOTIFICATIONS;
      const { data } = await supabase
        .from('notifications')
        .select('id,title,message,link_path,read,severity,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      return (data ?? EMPTY_NOTIFICATIONS) as Notification[];
    },
    enabled: !!user,
    staleTime: 120_000,
  });

  const notifs = notificationsData ?? EMPTY_NOTIFICATIONS;
  const nextUnreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  useEffect(() => {
    if (unreadCount !== nextUnreadCount) setUnreadCount(nextUnreadCount);
  }, [nextUnreadCount, setUnreadCount, unreadCount]);

  useEffect(() => { clearAlerts(); }, [selectedPlantId]);
  useEffect(() => { pruneSnooze(); }, []);

  const prevCriticalIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const currentCriticalIds = plantAlerts.filter(a => sevTier(a.severity) === 'critical').map((a) => a.id);
    const hasNewCritical = currentCriticalIds.some((id) => !prevCriticalIdsRef.current.includes(id));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (hasNewCritical && currentCriticalIds.length > 0) {
      setIsRinging(true);
      timer = setTimeout(() => setIsRinging(false), 700);
    }
    prevCriticalIdsRef.current = currentCriticalIds;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [plantAlerts]);

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    toast.success('All notifications marked as read');
  };

  const deleteNotification = async (id: string) => {
    if (!user) return;
    qc.setQueryData<Notification[]>(['notifications', user.id], (prev) =>
      (prev ?? EMPTY_NOTIFICATIONS).filter((n) => n.id !== id));
    const { error } = await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  const totalBadge = unreadCount + plantAlerts.length;

  const sortedAlerts = useMemo(() =>
    [...plantAlerts].sort((a, b) => {
      const order: Record<SevTier, number> = { critical: 0, warning: 1, info: 2 };
      return (order[sevTier(a.severity)] - order[sevTier(b.severity)]) || (b.timestamp - a.timestamp);
    }),
  [plantAlerts]);

  const criticalAlerts = useMemo(() => sortedAlerts.filter(a => sevTier(a.severity) === 'critical'), [sortedAlerts]);
  const warningAlerts  = useMemo(() => sortedAlerts.filter(a => sevTier(a.severity) === 'warning'), [sortedAlerts]);
  const infoAlerts     = useMemo(() => sortedAlerts.filter(a => sevTier(a.severity) === 'info'), [sortedAlerts]);
  const hasCritical    = criticalAlerts.length > 0;

  const displayedAlerts = useMemo(() => {
    if (tierFilter === 'critical') return criticalAlerts;
    if (tierFilter === 'warning') return warningAlerts;
    if (tierFilter === 'info') return infoAlerts;
    return sortedAlerts;
  }, [tierFilter, sortedAlerts, criticalAlerts, warningAlerts, infoAlerts]);

  return {
    panelOpen,
    setPanelOpen,
    activeTab,
    setActiveTab,
    tierFilter,
    setTierFilter,
    visiblePlants,
    notifs,
    unreadCount,
    setUnreadCount,
    plantAlerts,
    totalBadge,
    sortedAlerts,
    criticalAlerts,
    warningAlerts,
    infoAlerts,
    hasCritical,
    displayedAlerts,
    plantNameById,
    markAllRead,
    deleteNotification,
    snoozeAlert,
    removeAlerts,
    clearAlerts,
    isMobile,
    sidebarCollapsed,
    selectedPlantId,
    setSelectedPlantId,
    isRinging,
    setIsRinging,
    navigate,
  };
}
