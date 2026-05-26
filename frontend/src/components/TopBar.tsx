import { Bell, AlertTriangle, Info, Clock, BellOff } from 'lucide-react';

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
import { useSidebar } from '@/components/ui/sidebar';
import { formatDistanceToNow, format } from 'date-fns';
import { OperatorSwitcher } from '@/components/OperatorSwitcher';
import { cn } from '@/lib/utils';
import { SyncIndicator } from '@/components/SyncIndicator';
import { ThemeSelector } from '@/components/ThemeSelector';

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
  const { state, isMobile } = useSidebar();
  const sidebarCollapsed = state === 'collapsed';
  const showBrand = isMobile || sidebarCollapsed;
  const { data: plants } = usePlants();
  const {
    selectedPlantId, setSelectedPlantId,
    setUnreadCount, unreadCount,
    plantAlerts, removeAlerts, clearAlerts,
    snoozeAlert, pruneSnooze,
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

  // Prune expired snooze entries on mount and whenever the bell is opened
  useEffect(() => { pruneSnooze(); }, []); // eslint-disable-line

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  // Multi-plant: show plant name when the user has access to >1 plant
  const isMultiPlant = visiblePlants.length > 1;

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

        {/* ── Brand mark — only shown when sidebar is collapsed ──── */}
        {showBrand && (
          <div className="flex items-center gap-2 shrink-0">
            <img
              src="/pwri-plantmonitoring/og-image.png"
              alt="PWRI Logo"
              className="h-7 w-7 rounded-lg object-cover shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = 'flex';
              }}
            />
            <div
              style={{ display: 'none' }}
              className="h-7 w-7 rounded-lg bg-[hsl(175_84%_31%)] items-center justify-center shrink-0"
            >
              <span className="text-white font-bold text-[11px] select-none">PW</span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[13px] font-semibold tracking-tight text-topbar-foreground">PWRI</span>
              <span className="text-[9px] text-topbar-muted hidden sm:block tracking-[0.1em] uppercase">
                Monitoring & Alert
              </span>
            </div>
          </div>
        )}

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

        {/* ── Sync indicator ─────────────────────────────────────── */}
        <SyncIndicator />

        {/* ── Color theme picker ─────────────────────────────────── */}
        <ThemeSelector />

        {/* ── Notifications bell ─────────────────────────────────── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'relative h-8 w-8',
                'hover:bg-white/10 focus-visible:ring-white/30',
                // Bell icon colour escalates with severity
                hasCritical
                  ? 'text-danger'
                  : plantAlerts.length > 0
                    ? 'text-warn'
                    : 'text-topbar-foreground hover:text-topbar-foreground',
              )}
            >
              {/* Bell — shakes when there are unread critical alerts */}
              <Bell
                className={cn(
                  'h-[17px] w-[17px] transition-colors',
                  hasCritical && 'animate-[ring_0.6s_ease-in-out_infinite]',
                )}
              />

              {/* Outer pulse ring — only on critical */}
              {hasCritical && (
                <span
                  className="absolute inset-0 rounded-full animate-ping bg-danger/30 pointer-events-none"
                  aria-hidden
                />
              )}

              {/* Badge counter */}
              {totalBadge > 0 && (
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[3px]',
                    'flex items-center justify-center rounded-full',
                    'text-[9px] font-bold text-white leading-none',
                    'ring-2 ring-topbar',
                    hasCritical ? 'bg-danger animate-pulse' : plantAlerts.length > 0 ? 'bg-warn' : 'bg-danger',
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => sortedAlerts.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000))}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-warn transition-colors"
                      title="Snooze all alerts for 1 hour"
                    >
                      <BellOff className="h-3 w-3" />
                      <span>Snooze all</span>
                    </button>
                    <span className="text-muted-foreground/30">|</span>
                    <button
                      onClick={clearAlerts}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      Dismiss all
                    </button>
                  </div>
                </DropdownMenuLabel>

                {sortedAlerts.map((alert) => {
                  const Icon = sevIcon(alert.severity);
                  const plantName = plantNameById.get(alert.plantId);
                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        'flex gap-2.5 px-3 py-2.5 border-b border-border/40 last:border-0',
                        sevBgCls(alert.severity),
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', sevTextCls(alert.severity))} />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-start justify-between gap-1">
                          <span className={cn('text-[12px] font-semibold leading-snug', sevTextCls(alert.severity))}>
                            {alert.title}
                          </span>
                          <div className="flex items-center gap-1 shrink-0 ml-1 mt-0.5">
                            <button
                              onClick={() => snoozeAlert(alert.id, 60 * 60 * 1000)}
                              className="text-muted-foreground/40 hover:text-warn transition-colors"
                              aria-label="Snooze 1 hour"
                              title="Snooze 1 hour"
                            >
                              <Clock className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => removeAlerts([alert.id])}
                              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors text-[10px]"
                              aria-label="Dismiss"
                              title="Dismiss"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">{alert.description}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', sevDotCls(alert.severity))} />
                          {/* Plant name — only shown when user has multi-plant access */}
                          {isMultiPlant && plantName && (
                            <>
                              <span className="font-medium text-foreground/70">{plantName}</span>
                              <span>·</span>
                            </>
                          )}
                          <span>{alert.source}</span>
                          <span>·</span>
                          <span>{format(new Date(alert.timestamp), 'hh:mm aa')}</span>
                          <span>·</span>
                          <button
                            onClick={() => snoozeAlert(alert.id, 60 * 60 * 1000)}
                            className="flex items-center gap-0.5 hover:text-warn transition-colors"
                            title="Snooze 1 hour"
                          >
                            <BellOff className="h-2.5 w-2.5" />
                            <span>1h</span>
                          </button>
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
