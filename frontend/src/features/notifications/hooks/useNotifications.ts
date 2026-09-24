import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { EMPTY_NOTIFICATIONS, type Notification } from '../lib/constants';

export const NOTIFICATIONS_QUERY_KEY = 'notifications';

/**
 * Single source of truth for workflow/audit notifications.
 * De-duplicates the queries previously in useTopBarState and useAlerts.
 */
export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notificationsData, isLoading: logsLoading } = useQuery({
    queryKey: [NOTIFICATIONS_QUERY_KEY, user?.id],
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
    staleTime: 60_000,
  });

  const notifs = notificationsData ?? EMPTY_NOTIFICATIONS;
  const unreadCount = notifs.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    qc.invalidateQueries({ queryKey: [NOTIFICATIONS_QUERY_KEY] });
    toast.success('All notifications marked as read');
  };

  const deleteNotification = async (id: string) => {
    if (!user) return;
    qc.setQueryData<Notification[]>([NOTIFICATIONS_QUERY_KEY, user.id], (prev) =>
      (prev ?? EMPTY_NOTIFICATIONS).filter((n) => n.id !== id));
    const { error } = await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      qc.invalidateQueries({ queryKey: [NOTIFICATIONS_QUERY_KEY] });
      toast.error('Failed to dismiss notification');
    } else {
      toast.success('Notification dismissed');
    }
  };

  return {
    notifs,
    notificationsData,
    logsLoading,
    unreadCount,
    markAllRead,
    deleteNotification,
  };
}
