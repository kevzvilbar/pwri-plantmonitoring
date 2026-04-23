import { Bell } from 'lucide-react';
import { ConnectionHealth } from './ConnectionHealth';
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  title: string;
  message: string | null;
  link_path: string | null;
  read: boolean;
  severity: string;
  created_at: string;
}

const EMPTY_NOTIFICATIONS: Notification[] = [];
const EMPTY_PLANTS: Array<{ id: string; name: string }> = [];

export function TopBar() {
  const { user, profile, signOut } = useAuth();
  const { data: plants } = usePlants();
  const { selectedPlantId, setSelectedPlantId, setUnreadCount, unreadCount } = useAppStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

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
        .limit(20);
      return (data ?? EMPTY_NOTIFICATIONS) as Notification[];
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  const notifs = notificationsData ?? EMPTY_NOTIFICATIONS;
  const nextUnreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  useEffect(() => {
    if (unreadCount !== nextUnreadCount) {
      setUnreadCount(nextUnreadCount);
    }
  }, [nextUnreadCount, setUnreadCount, unreadCount]);

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const initials = ((profile?.first_name?.[0] ?? '') + (profile?.last_name?.[0] ?? '')) || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <header className="sticky top-0 z-40 bg-topbar text-topbar-foreground border-b border-topbar/0 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 h-14">
        <div className="flex flex-col leading-tight">
          <span className="text-sm sm:text-base font-semibold tracking-tight">PWRI</span>
          <span className="text-[10px] sm:text-xs text-topbar-muted hidden sm:block">Monitoring & Alert System</span>
        </div>

        <div className="flex-1 flex justify-center">
          <Select
            value={selectedPlantId ?? 'all'}
            onValueChange={(v) => setSelectedPlantId(v === 'all' ? null : v)}
          >
            <SelectTrigger className="w-[140px] sm:w-[200px] h-9 bg-topbar/40 border-topbar-muted/30 text-topbar-foreground">
              <SelectValue placeholder="Select plant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plants</SelectItem>
              {visiblePlants.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ConnectionHealth />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-topbar-foreground hover:bg-topbar/40 hover:text-topbar-foreground">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 pulse-dot" aria-label={`${unreadCount} unread`} />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-h-[70vh] overflow-y-auto">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-xs text-accent hover:underline">Mark all read</button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifs.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No alerts</div>
            )}
            {notifs.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onClick={() => n.link_path && navigate(n.link_path)}
                className="flex flex-col items-start gap-1 py-2"
              >
                <div className="flex items-center gap-2 w-full">
                  {!n.read && <span className="h-2 w-2 rounded-full bg-danger flex-shrink-0" />}
                  <span className="text-sm font-medium flex-1">{n.title}</span>
                  <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                </div>
                {n.message && <div className="text-xs text-muted-foreground line-clamp-2">{n.message}</div>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:bg-topbar/40 rounded-full p-1 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-accent text-accent-foreground text-xs font-semibold">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{profile?.first_name} {profile?.last_name}</span>
                <span className="text-xs text-muted-foreground">{profile?.designation ?? user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>Profile</DropdownMenuItem>
            <DropdownMenuItem onClick={signOut} className="text-danger">Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
