import { Bell, ClipboardCheck, ShieldAlert, Wrench, Zap, Info, AlertTriangle, AlertCircle, Clock, BellOff, Waves, Droplet, FlaskConical, Activity, CheckCircle2, ShieldCheck, ArrowUpRight, CheckCheck, Trash2, FileText, ChevronRight } from 'lucide-react';
import { ROTrainIcon, RawWaterIcon, ChemicalsIcon } from '@/components/icons/water-icons';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetClose,
} from '@/components/ui/sheet';
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
import { Signal } from '@/components/ui/Signal';
import { Lamp } from '@/components/ui/Lamp';
import { toast } from 'sonner';

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

type SevTier = 'critical' | 'warning' | 'info';
const sevTier = (severity: string): SevTier => {
  switch (severity) {
    case 'Critical':
    case 'High':
    case 'critical':
      return 'critical';
    case 'Medium':
    case 'warning':
      return 'warning';
    case 'Low':
    case 'info':
    default:
      return 'info';
  }
};

/** Context-aware icon resolver for plant alerts */
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

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'logs'>('active');
  const [tierFilter, setTierFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');

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
  });

  const notifs = notificationsData ?? EMPTY_NOTIFICATIONS;
  const nextUnreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  useEffect(() => {
    if (unreadCount !== nextUnreadCount) setUnreadCount(nextUnreadCount);
  }, [nextUnreadCount, setUnreadCount, unreadCount]);

  useEffect(() => { clearAlerts(); }, [selectedPlantId]); // eslint-disable-line
  useEffect(() => { pruneSnooze(); }, []); // eslint-disable-line

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

  // Rate-limited bell shake: trigger single animation ONLY when new critical alerts arrive
  const [isRinging, setIsRinging] = useState(false);
  const prevCriticalIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const currentCriticalIds = criticalAlerts.map((a) => a.id);
    const hasNewCritical = currentCriticalIds.some((id) => !prevCriticalIdsRef.current.includes(id));
    if (hasNewCritical && currentCriticalIds.length > 0) {
      setIsRinging(true);
      const timer = setTimeout(() => setIsRinging(false), 700);
      prevCriticalIdsRef.current = currentCriticalIds;
      return () => clearTimeout(timer);
    }
    prevCriticalIdsRef.current = currentCriticalIds;
  }, [criticalAlerts]);

  const displayedAlerts = useMemo(() => {
    if (tierFilter === 'critical') return criticalAlerts;
    if (tierFilter === 'warning') return warningAlerts;
    if (tierFilter === 'info') return infoAlerts;
    return sortedAlerts;
  }, [tierFilter, sortedAlerts, criticalAlerts, warningAlerts, infoAlerts]);

  // Shared Panel Content for Desktop Popover & Mobile Sheet
  const renderPanelBody = () => (
    <div className="flex flex-col h-full max-h-[82vh] overflow-hidden bg-card text-card-foreground">
      {/* Header & Tabs */}
      <div className="p-3 bg-muted/40 border-b border-border/60 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Bell className="h-3.5 w-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-foreground tracking-tight">Plant Alerts &amp; Activity</h4>
            </div>
            {totalBadge > 0 && (
              <span className={cn(
                'text-3xs font-mono-num font-bold px-1.5 py-0.5 rounded-full border',
                hasCritical ? 'bg-danger/15 text-danger border-danger/30' : 'bg-warn/15 text-amber-500 border-warn/30'
              )}>
                {totalBadge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {activeTab === 'active' && sortedAlerts.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    sortedAlerts.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000));
                    toast.success('All alerts snoozed for 1 hour');
                  }}
                  className="flex items-center gap-1 text-2xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-medium min-h-[32px] sm:min-h-[28px]"
                  title="Snooze all active alerts for 1 hour"
                >
                  <BellOff className="h-3 w-3 text-warn" />
                  <span>Snooze all</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearAlerts();
                    toast.success('All alerts dismissed');
                  }}
                  className="text-2xs px-2 py-1 rounded-md text-muted-foreground hover:text-danger hover:bg-danger-soft transition-colors font-medium min-h-[32px] sm:min-h-[28px]"
                  title="Dismiss all alerts"
                >
                  Dismiss all
                </button>
              </>
            )}
            {activeTab === 'logs' && unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-2xs px-2 py-1 rounded-md text-accent hover:bg-accent-soft transition-colors font-medium min-h-[32px] sm:min-h-[28px]"
                title="Mark all notifications as read"
              >
                Mark read
              </button>
            )}
          </div>
        </div>

        {/* Primary Tab Switcher: Active vs System Log */}
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-background/80 border border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={cn(
              'flex-1 py-1 px-2.5 text-2xs font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1.5',
              activeTab === 'active'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>Active Alarms</span>
            <span className={cn('text-3xs font-mono-num px-1 rounded-full', activeTab === 'active' ? 'bg-primary-foreground/20 text-white' : 'bg-muted text-muted-foreground')}>
              {plantAlerts.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={cn(
              'flex-1 py-1 px-2.5 text-2xs font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1.5',
              activeTab === 'logs'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>System Log</span>
            <span className={cn('text-3xs font-mono-num px-1 rounded-full', activeTab === 'logs' ? 'bg-primary-foreground/20 text-white' : 'bg-muted text-muted-foreground')}>
              {notifs.length}
            </span>
          </button>
        </div>

        {/* Sub-Filters for Active tab */}
        {activeTab === 'active' && plantAlerts.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pt-0.5">
            <button
              type="button"
              onClick={() => setTierFilter('all')}
              className={cn(
                'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all font-mono-num',
                tierFilter === 'all'
                  ? 'bg-muted text-foreground font-bold border border-border/80'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              All ({plantAlerts.length})
            </button>
            {criticalAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setTierFilter('critical')}
                className={cn(
                  'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all flex items-center gap-1 font-mono-num',
                  tierFilter === 'critical'
                    ? 'bg-danger text-white'
                    : 'text-danger hover:bg-danger/10'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span>Crit ({criticalAlerts.length})</span>
              </button>
            )}
            {warningAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setTierFilter('warning')}
                className={cn(
                  'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all flex items-center gap-1 font-mono-num',
                  tierFilter === 'warning'
                    ? 'bg-warn text-warn-foreground'
                    : 'text-amber-500 hover:bg-warn/10'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span>Warn ({warningAlerts.length})</span>
              </button>
            )}
            {infoAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setTierFilter('info')}
                className={cn(
                  'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all font-mono-num',
                  tierFilter === 'info'
                    ? 'bg-info text-white'
                    : 'text-info hover:bg-info/10'
                )}
              >
                <span>Info ({infoAlerts.length})</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Alerts List */}
      <div className="overflow-y-auto divide-y divide-border/40 p-2 space-y-1.5 flex-1 min-h-[160px] max-h-[52vh]">
        {/* Active Alarms */}
        {activeTab === 'active' && (
          <>
            {displayedAlerts.map((alert) => {
              const Icon = getAlertIcon(alert);
              const tier = sevTier(alert.severity);
              const plantName = plantNameById.get(alert.plantId);

              return (
                <Signal
                  key={alert.id}
                  variant="card"
                  tone={tier}
                  title={alert.title}
                  description={alert.description}
                  icon={Icon}
                  plantName={plantName}
                  source={alert.source}
                  timestamp={alert.timestamp}
                  linkPath={alert.linkPath ?? undefined}
                  onNavigate={(path) => {
                    setPanelOpen(false);
                    navigate(path);
                  }}
                  onSnooze={(ms) => {
                    snoozeAlert(alert.id, ms);
                    toast.success(`Alert snoozed for ${ms === 3600000 ? '1 hour' : '24 hours'}`);
                  }}
                  onDismiss={() => {
                    removeAlerts([alert.id]);
                    toast.success('Alert dismissed');
                  }}
                />
              );
            })}

            {displayedAlerts.length === 0 && (
              <div className="py-10 text-center space-y-2">
                <div className="h-10 w-10 rounded-full bg-accent/15 text-accent flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-foreground">No active alarms</p>
                  <p className="text-2xs text-muted-foreground">All plant systems and sensors operating normally</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* System Log */}
        {activeTab === 'logs' && (
          <>
            {notifs.map((n) => {
              const tier = sevTier(n.severity);
              return (
                <Signal
                  key={n.id}
                  variant="card"
                  tone={tier}
                  title={n.title}
                  description={n.message ?? undefined}
                  icon={Activity}
                  timestamp={n.created_at}
                  linkPath={n.link_path ?? undefined}
                  onNavigate={(path) => {
                    setPanelOpen(false);
                    navigate(path);
                  }}
                  onDismiss={() => deleteNotification(n.id)}
                />
              );
            })}

            {notifs.length === 0 && (
              <div className="py-10 text-center space-y-2">
                <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-foreground">No system logs</p>
                  <p className="text-2xs text-muted-foreground">No historical notifications recorded</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Link to Dedicated Alerts Console */}
      <div className="p-2.5 bg-muted/40 border-t border-border/60 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setPanelOpen(false);
            navigate('/alerts');
          }}
          className="w-full text-xs font-semibold text-primary hover:text-primary/80 py-1.5 px-3 rounded-lg hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5"
        >
          <span>Open Full Triage Center</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

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

          {/* ── Notifications Bell Trigger (Responsive: Dropdown on Desktop, Sheet on Mobile) ── */}
          {isMobile ? (
            <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={totalBadge > 0 ? `Notifications (${totalBadge} unread)` : 'Notifications'}
                  className={cn(
                    'relative h-10 w-10 min-h-[44px] min-w-[44px]',
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
                      'h-[18px] w-[18px] transition-colors',
                      isRinging && 'animate-bell-ring-once',
                    )}
                  />
                  {totalBadge > 0 && (
                    <span
                      className={cn(
                        'absolute 0.5 top-0.5 right-0.5 min-w-[17px] h-[17px] px-[3px]',
                        'flex items-center justify-center rounded-full',
                        'text-3xs font-mono-num font-bold text-white leading-none',
                        'ring-2 ring-topbar',
                        hasCritical ? 'bg-danger' : plantAlerts.length > 0 ? 'bg-warn' : 'bg-danger',
                      )}
                      aria-label={`${totalBadge} alerts`}
                    >
                      {totalBadge > 99 ? '99+' : totalBadge}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="p-0 rounded-t-2xl max-h-[88vh] overflow-hidden border-t border-border/80">
                {/* Drag handle bar */}
                <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full mx-auto my-2" />
                {renderPanelBody()}
              </SheetContent>
            </Sheet>
          ) : (
            <DropdownMenu open={panelOpen} onOpenChange={setPanelOpen}>
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
                      isRinging && 'animate-bell-ring-once',
                    )}
                  />
                  {totalBadge > 0 && (
                    <span
                      className={cn(
                        'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[3px]',
                        'flex items-center justify-center rounded-full',
                        'text-3xs font-mono-num font-bold text-white leading-none',
                        'ring-2 ring-topbar',
                        hasCritical ? 'bg-danger' : plantAlerts.length > 0 ? 'bg-warn' : 'bg-danger',
                      )}
                      aria-label={`${totalBadge} alerts`}
                    >
                      {totalBadge > 99 ? '99+' : totalBadge}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-[380px] sm:w-[440px] p-0 rounded-2xl shadow-xl border border-border/80 bg-popover/95 backdrop-blur-md overflow-hidden flex flex-col max-h-[82vh]">
                {renderPanelBody()}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* ── User avatar / switcher ─────────────────────────────── */}
          <OperatorSwitcher />
        </div>
      </div>
    </header>
  );
}
