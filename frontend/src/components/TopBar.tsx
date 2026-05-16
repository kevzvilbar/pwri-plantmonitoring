import { Bell, AlertTriangle, Info, Droplets } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { OperatorSwitcher } from '@/components/OperatorSwitcher';
import { cn } from '@/lib/utils';

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

const sevIcon = (severity: string) =>
  severity === 'critical' ? AlertTriangle :
  severity === 'warning'  ? AlertTriangle : Info;

const sevDotCls = (severity: string) =>
  severity === 'critical' ? 'bg-danger' :
  severity === 'warning'  ? 'bg-warn'   : 'bg-info';

const sevTextCls = (severity: string) =>
  severity === 'critical' ? 'text-danger'  :
  severity === 'warning'  ? 'text-warn-foreground' : 'text-info';

const sevBgCls = (severity: string) =>
  severity === 'critical' ? 'bg-danger-soft dark:bg-danger/10' :
  severity === 'warning'  ? 'bg-warn-soft dark:bg-warn/10'     : '';

export function TopBar() {
  const { user, profile } = useAuth();
  const { data: plants } = usePlants();
  const {
    selectedPlantId, setSelectedPlantId,
    setUnreadCount, unreadCount,
    plantAlerts, removeAlerts, clearAlerts,
  } = useAppStore();
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
  });

  const notifs = notificationsData ?? EMPTY_NOTIFICATIONS;
  const nextUnreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  useEffect(() => {
    if (unreadCount !== nextUnreadCount) setUnreadCount(nextUnreadCount);
  }, [nextUnreadCount, setUnreadCount, unreadCount]);

  useEffect(() => { clearAlerts(); }, [selectedPlantId]); // eslint-disable-line

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const totalBadge = unreadCount + plantAlerts.length;

  const sortedAlerts = useMemo(() =>
    [...plantAlerts].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.timestamp - a.timestamp;
    }),
  [plantAlerts]);

  const hasCritical = plantAlerts.some((a) => a.severity === 'critical');

  return (
    <header className="sticky top-0 z-40 bg-topbar text-topbar-foreground border-b border-white/8 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-12">

        {/* ── Brand mark ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/10 shrink-0">
            <Droplets className="h-4 w-4 text-white/90" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[13px] font-semibold tracking-tight text-topbar-foreground">PWRI</span>
            <span className="text-[9px] text-topbar-muted hidden sm:block tracking-wide uppercase">
              Monitoring & Alert System
            </span>
          </div>
        </div>

        {/* ── Plant selector ─────────────────────────────────────── */}
        <div className="flex-1 flex justify-center">
          <Select
            value={selectedPlantId ?? 'all'}
            onValueChange={(v) => setSelectedPlantId(v === 'all' ? null : v)}
          >
            <SelectTrigger
              className={cn(
                'w-[140px] sm:w-[210px] h-8',
                'bg-white/10 border-white/15 text-topbar-foreground',
                'hover:bg-white/15 focus:ring-white/30 focus:ring-1',
                'text-[12.5px] font-medium placeholder:text-topbar-muted',
                '[&>span]:text-topbar-foreground [&>svg]:text-topbar-muted',
              )}
            >
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

        {/* ── Notifications bell ─────────────────────────────────── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'relative h-8 w-8 text-topbar-foreground',
                'hover:bg-white/10 hover:text-topbar-foreground',
                'focus-visible:ring-white/30',
              )}
            >
              <Bell className="h-[17px] w-[17px]" />
              {totalBadge > 0 && (
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[3px]',
                    'flex items-center justify-center rounded-full',
                    'text-[9px] font-bold text-white leading-none',
                    'ring-2 ring-topbar',
                    hasCritical ? 'bg-danger' : unreadCount > 0 ? 'bg-danger' : 'bg-warn',
                  )}
                  aria-label={`${totalBadge} alerts`}
                >
                  {totalBadge > 99 ? '99+' : totalBadge}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-80 max-h-[75vh] overflow-y-auto">

            {/* Plant alerts */}
            {sortedAlerts.length > 0 && (
              <>
                <DropdownMenuLabel className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                    <span className="text-[12px]">Plant Alerts</span>
                    <span className={cn(
                      'text-[9.5px] font-bold px-1.5 py-0.5 rounded-full',
                      hasCritical
                        ? 'bg-danger-soft text-danger'
                        : 'bg-warn-soft text-warn-foreground',
                    )}>
                      {sortedAlerts.length}
                    </span>
                  </span>
                  <button
                    onClick={clearAlerts}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    Clear all
                  </button>
                </DropdownMenuLabel>

                {sortedAlerts.map((alert) => {
                  const Icon = sevIcon(alert.severity);
                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        'flex gap-2.5 px-3 py-2.5 border-b border-border/40 last:border-0',
                        sevBgCls(alert.severity),
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', sevTextCls(alert.severity))} />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-start justify-between gap-1">
                          <span className={cn('text-[12px] font-semibold leading-snug', sevTextCls(alert.severity))}>
                            {alert.title}
                          </span>
                          <button
                            onClick={() => removeAlerts([alert.id])}
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors text-[10px] shrink-0 ml-1 mt-0.5"
                            aria-label="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">{alert.description}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', sevDotCls(alert.severity))} />
                          <span>{alert.source}</span>
                          <span>·</span>
                          <span>{format(new Date(alert.timestamp), 'hh:mm aa')}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <DropdownMenuSeparator />
              </>
            )}

            {/* DB Notifications */}
            <DropdownMenuLabel className="flex items-center justify-between py-2">
              <span className="text-[12px]">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-accent hover:text-accent/80 underline underline-offset-2 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {notifs.length === 0 && (
              <div className="px-3 py-6 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            )}

            {notifs.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onClick={() => n.link_path && navigate(n.link_path)}
                className="flex flex-col items-start gap-1 py-2.5 cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  {!n.read && (
                    <span className="h-1.5 w-1.5 rounded-full bg-danger flex-shrink-0" />
                  )}
                  <span className={cn('text-[12.5px] flex-1', n.read ? 'font-normal' : 'font-semibold')}>
                    {n.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </span>
                </div>
                {n.message && (
                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 pl-3.5">
                    {n.message}
                  </p>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ── User avatar / switcher ─────────────────────────────── */}
        <OperatorSwitcher />
      </div>
    </header>
  );
}
