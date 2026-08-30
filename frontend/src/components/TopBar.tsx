import { Bell, ClipboardCheck, ShieldAlert, Wrench, Zap, Info, AlertTriangle, AlertCircle, Clock, BellOff, Waves, Droplet, FlaskConical, Activity, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ROTrainIcon, RawWaterIcon, ChemicalsIcon } from '@/components/icons/water-icons';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
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
import { Logomark } from '@/components/icons/Logomark';
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

// BUG FIX (2026-07-27): notifications.severity is the public.severity_level
// enum — 'Low' | 'Medium' | 'High' | 'Critical' (see
// supabase/migrations/20260419_initial_schema_enums_and_roles.sql) — but
// every comparison below checked for lowercase 'critical' | 'warning' |
// 'info', which never matches any real enum value. In practice nothing that
// has ever been written to `notifications` rendered with its intended
// color/icon; everything silently fell through to the default (info) case.
// One normalizer, reused everywhere severity is compared, so there's a
// single place that knows how DB values fold into the 3 visual tiers this
// component supports.
type SevTier = 'critical' | 'warning' | 'info';
const sevTier = (severity: string): SevTier => {
  switch (severity) {
    case 'Critical': return 'critical';
    case 'High':     return 'critical'; // urgent enough to read as critical
    case 'Medium':   return 'warning';
    case 'Low':      return 'info';
    // Tolerate legacy/lowercase values too, in case anything already wrote
    // pre-fix rows (or a future caller passes them directly).
    case 'critical': return 'critical';
    case 'warning':  return 'warning';
    default:         return 'info';
  }
};

/** Context-aware premium icon resolver for plant alerts */
const getAlertIcon = (alert: { title: string; source?: string; severity: string }) => {
  const t = (alert.title || '').toLowerCase();
  const s = (alert.source || '').toLowerCase();

  if (t.includes('water loss') || t.includes('nrw') || s.includes('nrw')) return RawWaterIcon;
  if (t.includes('ph') || t.includes('chemical') || t.includes('conduct') || t.includes('tds')) return FlaskConical;
  if (t.includes('recovery') || t.includes('ro') || t.includes('train') || s.includes('ro')) return ROTrainIcon;
  if (t.includes('blending') || t.includes('bypass') || s.includes('blending')) return Waves;
  if (t.includes('power') || t.includes('kwh') || t.includes('voltage') || t.includes('grid') || s.includes('power')) return Zap;
  if (t.includes('well') || s.includes('well')) return Droplet;
  if (t.includes('maintenance') || t.includes('pms') || s.includes('maintenance')) return Wrench;

  const tier = sevTier(alert.severity);
  if (tier === 'critical') return ShieldAlert;
  if (tier === 'warning') return AlertTriangle;
  return Activity;
};

const sevDotCls = (severity: string) =>
  sevTier(severity) === 'critical' ? 'bg-danger' :
  sevTier(severity) === 'warning'  ? 'bg-warn'   : 'bg-info';

const sevTextCls = (severity: string) =>
  sevTier(severity) === 'critical' ? 'text-danger'  :
  sevTier(severity) === 'warning'  ? 'text-warn-foreground' : 'text-info';

const sevBgCls = (severity: string) =>
  sevTier(severity) === 'critical' ? 'bg-danger-soft dark:bg-danger/10' :
  sevTier(severity) === 'warning'  ? 'bg-warn-soft dark:bg-warn/10'     : '';

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

  // Dismiss a single DB notification. Scoped to user_id in the query (not just
  // relying on the RLS policy) so a stale/duplicate click can't attempt to
  // delete someone else's row. Optimistically removes it from the cached list
  // so the bell updates instantly instead of waiting on the next refetch.
  const deleteNotification = async (id: string) => {
    if (!user) return;
    qc.setQueryData<Notification[]>(['notifications', user.id], (prev) =>
      (prev ?? EMPTY_NOTIFICATIONS).filter((n) => n.id !== id));
    const { error } = await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      // Roll back the optimistic removal by refetching from the server.
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
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
      const order: Record<SevTier, number> = { critical: 0, warning: 1, info: 2 };
      return (order[sevTier(a.severity)] - order[sevTier(b.severity)]) || (b.timestamp - a.timestamp);
    }),
  [plantAlerts]);

  const [activeTab, setActiveTab] = useState<'all' | 'critical' | 'warning' | 'info' | 'notifications'>('all');

  const criticalAlerts = useMemo(() => sortedAlerts.filter(a => sevTier(a.severity) === 'critical'), [sortedAlerts]);
  const warningAlerts  = useMemo(() => sortedAlerts.filter(a => sevTier(a.severity) === 'warning'), [sortedAlerts]);
  const infoAlerts     = useMemo(() => sortedAlerts.filter(a => sevTier(a.severity) === 'info'), [sortedAlerts]);
  const hasCritical    = criticalAlerts.length > 0;

  const displayedAlerts = useMemo(() => {
    if (activeTab === 'critical') return criticalAlerts;
    if (activeTab === 'warning') return warningAlerts;
    if (activeTab === 'info') return infoAlerts;
    if (activeTab === 'notifications') return [];
    return sortedAlerts;
  }, [activeTab, sortedAlerts, criticalAlerts, warningAlerts, infoAlerts]);

  const showNotifications = activeTab === 'all' || activeTab === 'notifications';

  return (
    <header className="sticky top-0 z-40 bg-topbar text-topbar-foreground border-b border-white/8 shadow-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 px-3 sm:px-4 h-12">

        {/* ── Left: brand mark ── */}
        <div className="flex items-center min-w-0">
          {showBrand && (
            <div className="flex items-center gap-2 shrink-0">
              <Logomark size={28} className="rounded-lg shrink-0" />
              <div className="flex flex-col leading-none">
                <span className="text-xs font-semibold tracking-tight text-topbar-foreground">PWRI</span>
                <span className="text-3xs text-topbar-muted hidden sm:block tracking-[0.1em] uppercase">
                  Monitoring & Alert
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Center: plant selector ── */}
        <div className="flex justify-center">
          <Select
            value={selectedPlantId ?? 'all'}
            onValueChange={(v) => setSelectedPlantId(v === 'all' ? null : v)}
          >
            <SelectTrigger
              className={cn(
                'w-[140px] sm:w-[210px] h-8',
                'bg-white/10 border-white/15 text-topbar-foreground',
                'hover:bg-white/15 focus:ring-white/30 focus:ring-1',
                'text-xs font-medium placeholder:text-topbar-muted',
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

        {/* ── Right: sync / theme / notifications / avatar ── */}
        <div className="flex items-center justify-end gap-2 sm:gap-3 min-w-0">

          <SyncIndicator />
          <ThemeSelector />

        {/* ── Notifications bell ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={totalBadge > 0 ? `Notifications (${totalBadge} unread)` : 'Notifications'}
              className={cn(
                'relative h-10 w-10',
                'hover:bg-white/10 focus-visible:ring-white/30',
                hasCritical
                  ? 'text-danger'
                  : plantAlerts.length > 0
                    ? 'text-warn'
                    : 'text-topbar-foreground hover:text-topbar-foreground',
              )}
            >
              <Bell
                className={cn(
                  'h-[17px] w-[17px] transition-colors',
                  hasCritical && 'animate-[ring_0.6s_ease-in-out_infinite]',
                )}
              />

              {hasCritical && (
                <span
                  className="absolute inset-0 rounded-full animate-ping bg-danger/30 pointer-events-none"
                  aria-hidden
                />
              )}

              {totalBadge > 0 && (
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[3px]',
                    'flex items-center justify-center rounded-full',
                    'text-3xs font-bold text-white leading-none',
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

          <DropdownMenuContent align="end" className="w-[360px] sm:w-[440px] p-0 rounded-2xl shadow-xl border border-border/80 bg-popover/95 backdrop-blur-md overflow-hidden flex flex-col max-h-[82vh]">

            {/* Header with Title & Batch Actions */}
            <div className="p-3 bg-muted/40 border-b border-border/60">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Bell className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-foreground tracking-tight">Plant Alerts &amp; Activity</h4>
                  </div>
                  {totalBadge > 0 && (
                    <span className={cn(
                      'text-3xs font-bold px-1.5 py-0.5 rounded-full',
                      hasCritical ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn-foreground'
                    )}>
                      {totalBadge} new
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {sortedAlerts.length > 0 && (
                    <>
                      <button
                        onClick={() => sortedAlerts.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000))}
                        className="flex items-center gap-1 text-2xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-medium"
                        title="Snooze all active alerts for 1 hour"
                      >
                        <BellOff className="h-3 w-3 text-warn" />
                        <span>Snooze all</span>
                      </button>
                      <button
                        onClick={clearAlerts}
                        className="text-2xs px-2 py-1 rounded-md text-muted-foreground hover:text-danger hover:bg-danger-soft transition-colors font-medium"
                        title="Dismiss all alerts"
                      >
                        Dismiss all
                      </button>
                    </>
                  )}
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-2xs px-2 py-1 rounded-md text-accent hover:bg-accent-soft transition-colors font-medium"
                      title="Mark all notifications as read"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1 p-0.5 rounded-xl bg-background/80 border border-border/60">
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className={cn(
                    'flex-1 py-1 px-2 text-2xs font-semibold rounded-lg transition-all text-center',
                    activeTab === 'all'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  All ({totalBadge})
                </button>
                {criticalAlerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('critical')}
                    className={cn(
                      'py-1 px-2 text-2xs font-semibold rounded-lg transition-all flex items-center gap-1',
                      activeTab === 'critical'
                        ? 'bg-danger text-white shadow-2xs'
                        : 'text-danger hover:bg-danger-soft'
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <span>Crit ({criticalAlerts.length})</span>
                  </button>
                )}
                {warningAlerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('warning')}
                    className={cn(
                      'py-1 px-2 text-2xs font-semibold rounded-lg transition-all flex items-center gap-1',
                      activeTab === 'warning'
                        ? 'bg-warn text-warn-foreground shadow-2xs'
                        : 'text-warn-foreground hover:bg-warn-soft'
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <span>Warn ({warningAlerts.length})</span>
                  </button>
                )}
                {infoAlerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('info')}
                    className={cn(
                      'py-1 px-2 text-2xs font-semibold rounded-lg transition-all flex items-center gap-1',
                      activeTab === 'info'
                        ? 'bg-info text-white shadow-2xs'
                        : 'text-info hover:bg-info-soft'
                    )}
                  >
                    <span>Info ({infoAlerts.length})</span>
                  </button>
                )}
                {notifs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('notifications')}
                    className={cn(
                      'py-1 px-2 text-2xs font-semibold rounded-lg transition-all text-center',
                      activeTab === 'notifications'
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Logs ({notifs.length})
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Alerts List */}
            <div className="overflow-y-auto divide-y divide-border/50 max-h-[60vh] p-2 space-y-1.5">

              {/* Plant Alerts */}
              {displayedAlerts.map((alert) => {
                const Icon = getAlertIcon(alert);
                const tier = sevTier(alert.severity);
                const plantName = plantNameById.get(alert.plantId);

                return (
                  <div
                    key={alert.id}
                    className={cn(
                      'group p-3 rounded-xl border transition-all relative',
                      tier === 'critical'
                        ? 'bg-danger-soft/40 border-danger/30 hover:border-danger/60'
                        : tier === 'warning'
                        ? 'bg-warn-soft/40 border-warn/30 hover:border-warn/60'
                        : 'bg-card border-border/70 hover:border-primary/40',
                      alert.linkPath ? 'cursor-pointer hover:shadow-2xs' : '',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (alert.linkPath) navigate(alert.linkPath);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      {/* Premium Industrial Glassmorphic Icon Badge */}
                      <div className={cn(
                        'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border relative transition-transform duration-200 group-hover:scale-105',
                        tier === 'critical'
                          ? 'bg-danger/10 border-danger/30 text-danger shadow-xs ring-1 ring-danger/15'
                          : tier === 'warning'
                          ? 'bg-warn/15 border-warn/30 text-amber-600 dark:text-amber-400 shadow-xs ring-1 ring-warn/15'
                          : 'bg-primary/10 border-primary/25 text-primary shadow-xs ring-1 ring-primary/15'
                      )}>
                        <Icon className="h-4.5 w-4.5 stroke-[1.8]" />
                        {tier === 'critical' && (
                          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-danger animate-pulse ring-2 ring-card" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1.5 mb-1">
                          <span className={cn(
                            'text-xs font-bold leading-tight line-clamp-1',
                            tier === 'critical' ? 'text-danger' :
                            tier === 'warning' ? 'text-foreground' : 'text-foreground'
                          )}>
                            {alert.title}
                          </span>

                          {/* Action controls */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); snoozeAlert(alert.id, 60 * 60 * 1000); }}
                              className="h-6 px-1.5 rounded-md text-3xs font-medium text-muted-foreground hover:text-warn hover:bg-warn-soft transition-colors flex items-center gap-0.5"
                              title="Snooze alert for 1 hour"
                            >
                              <Clock className="h-2.5 w-2.5" />
                              <span>1h</span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); snoozeAlert(alert.id, 24 * 60 * 60 * 1000); }}
                              className="h-6 px-1.5 rounded-md text-3xs font-medium text-muted-foreground hover:text-warn hover:bg-warn-soft transition-colors flex items-center gap-0.5"
                              title="Snooze alert for 24 hours"
                            >
                              <Clock className="h-2.5 w-2.5" />
                              <span>24h</span>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeAlerts([alert.id]); }}
                              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center text-xs"
                              aria-label="Dismiss"
                              title="Dismiss"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground leading-snug mb-2 font-normal">
                          {alert.description}
                        </p>

                        {/* Metadata Tag Strip */}
                        <div className="flex items-center gap-1.5 text-3xs font-medium text-muted-foreground flex-wrap">
                          {plantName && (
                            <span className="px-1.5 py-0.5 rounded-md bg-muted border border-border/60 text-foreground font-semibold">
                              {plantName}
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground font-mono">
                            {alert.source}
                          </span>
                          <span>·</span>
                          <span>{format(new Date(alert.timestamp), 'hh:mm aa')}</span>
                          {alert.linkPath && (
                            <span className="ml-auto text-primary font-bold hover:underline flex items-center gap-0.5">
                              View →
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* DB Notifications */}
              {showNotifications && notifs.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="px-2 py-1 text-3xs font-extrabold uppercase tracking-wider text-muted-foreground">
                    System Notifications
                  </div>
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => n.link_path && navigate(n.link_path)}
                      className={cn(
                        'p-2.5 rounded-xl border border-border/70 bg-card hover:bg-muted/40 transition-colors flex items-start gap-2.5',
                        n.link_path ? 'cursor-pointer' : 'cursor-default',
                        !n.read ? 'border-primary/40 bg-primary-soft/10' : ''
                      )}
                    >
                      <div className={cn(
                        'h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border',
                        !n.read
                          ? 'bg-primary/10 border-primary/30 text-primary shadow-xs'
                          : 'bg-muted/40 border-border/60 text-muted-foreground'
                      )}>
                        <Activity className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn('text-xs truncate', n.read ? 'font-medium text-foreground' : 'font-bold text-primary')}>
                            {n.title}
                          </span>
                          <span className="text-3xs text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors text-xs shrink-0 ml-1"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                        {n.message && (
                          <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
                            {n.message}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {displayedAlerts.length === 0 && (!showNotifications || notifs.length === 0) && (
                <div className="py-8 text-center space-y-2">
                  <div className="h-10 w-10 rounded-full bg-accent-soft text-accent flex items-center justify-center mx-auto">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-foreground">No alerts active</p>
                    <p className="text-2xs text-muted-foreground">All plant systems and sensors operating normally</p>
                  </div>
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ── User avatar / switcher ─────────────────────────────── */}
        <OperatorSwitcher />
        </div>
      </div>
    </header>
  );
}
