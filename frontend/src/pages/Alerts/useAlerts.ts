import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { usePlantStore } from '@/store/plantStore';
import { useAlertStore } from '@/store/alertStore';
import { toast } from 'sonner';
import { sevTier, EMPTY_NOTIFICATIONS, EMPTY_PLANTS, type Notification } from './constants';

export function useAlerts() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { data: plants } = usePlants();
  const { selectedPlantId, setSelectedPlantId } = usePlantStore();
  const { plantAlerts, removeAlerts, clearAlerts, snoozeAlert } = useAlertStore();

  const [activeView, setActiveView] = useState<'active' | 'logs'>('active');
  const [tierFilter, setTierFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [plantFilter, setPlantFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const visiblePlants = useMemo(() => {
    if (!plants) return EMPTY_PLANTS;
    if (profile?.plant_assignments?.length) {
      return plants.filter((p) => profile.plant_assignments.includes(p.id));
    }
    return plants;
  }, [plants, profile?.plant_assignments]);

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  const { data: notificationsData, isLoading: logsLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async (): Promise<Notification[]> => {
      if (!user) return EMPTY_NOTIFICATIONS;
      const { data } = await supabase
        .from('notifications')
        .select('id,title,message,link_path,read,severity,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      return (data ?? EMPTY_NOTIFICATIONS) as Notification[];
    },
    enabled: !!user,
  });

  const notifs = notificationsData ?? EMPTY_NOTIFICATIONS;

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
      toast.error('Failed to dismiss notification');
    } else {
      toast.success('Notification dismissed');
    }
  };

  const filteredPlantAlerts = useMemo(() => {
    return plantAlerts
      .filter((alert) => {
        if (plantFilter !== 'all' && alert.plantId !== plantFilter) return false;
        const tier = sevTier(alert.severity);
        if (tierFilter !== 'all' && tier !== tierFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const pName = plantNameById.get(alert.plantId) || '';
          const matchTitle = (alert.title || '').toLowerCase().includes(q);
          const matchDesc = (alert.description || '').toLowerCase().includes(q);
          const matchSource = (alert.source || '').toLowerCase().includes(q);
          const matchPlant = pName.toLowerCase().includes(q);
          if (!matchTitle && !matchDesc && !matchSource && !matchPlant) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return (order[sevTier(a.severity)] - order[sevTier(b.severity)]) || (b.timestamp - a.timestamp);
      });
  }, [plantAlerts, plantFilter, tierFilter, searchQuery, plantNameById]);

  const filteredLogs = useMemo(() => {
    return notifs.filter((n) => {
      const tier = sevTier(n.severity);
      if (tierFilter !== 'all' && tier !== tierFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (n.title || '').toLowerCase().includes(q);
        const matchMsg = (n.message || '').toLowerCase().includes(q);
        if (!matchTitle && !matchMsg) return false;
      }
      return true;
    });
  }, [notifs, tierFilter, searchQuery]);

  const criticalCount = useMemo(() => plantAlerts.filter((a) => sevTier(a.severity) === 'critical').length, [plantAlerts]);
  const warningCount = useMemo(() => plantAlerts.filter((a) => sevTier(a.severity) === 'warning').length, [plantAlerts]);
  const infoCount = useMemo(() => plantAlerts.filter((a) => sevTier(a.severity) === 'info').length, [plantAlerts]);
  const unreadLogsCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  return {
    navigate,
    activeView, setActiveView,
    tierFilter, setTierFilter,
    plantFilter, setPlantFilter,
    searchQuery, setSearchQuery,
    plantAlerts, visiblePlants, plantNameById,
    notificationsData, logsLoading, notifs,
    filteredPlantAlerts, filteredLogs,
    criticalCount, warningCount, infoCount, unreadLogsCount,
    plantAlertsLength: plantAlerts.length, notifsLength: notifs.length,
    markAllRead, deleteNotification,
    removeAlerts, clearAlerts, snoozeAlert,
  };
}
