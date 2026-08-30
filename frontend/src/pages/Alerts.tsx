import React, { useMemo, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Signal, normalizeTone } from '@/components/ui/Signal';
import { Lamp } from '@/components/ui/Lamp';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Bell,
  ShieldAlert,
  AlertTriangle,
  Info,
  Clock,
  BellOff,
  CheckCircle2,
  Search,
  RotateCcw,
  SlidersHorizontal,
  FileText,
  Activity,
  Layers,
  CheckCheck,
  Trash2,
} from 'lucide-react';
import { ROTrainIcon, RawWaterIcon } from '@/components/icons/water-icons';
import { FlaskConical, Waves, Zap, Droplet, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
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

const sevTier = (severity: string) => {
  switch (severity) {
    case 'Critical':
    case 'High':
    case 'critical':
      return 'critical';
    case 'Medium':
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
};

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

export default function Alerts() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { data: plants } = usePlants();
  const {
    plantAlerts,
    removeAlerts,
    clearAlerts,
    snoozeAlert,
    selectedPlantId,
    setSelectedPlantId,
  } = useAppStore();

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

  // Fetch DB notifications (System Logs)
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

  // Mark all logs read
  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    toast.success('All notifications marked as read');
  };

  // Delete notification
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

  // Filtered and sorted active plant alerts
  const filteredPlantAlerts = useMemo(() => {
    return plantAlerts
      .filter((alert) => {
        // Plant filter
        if (plantFilter !== 'all' && alert.plantId !== plantFilter) return false;
        // Tier filter
        const tier = sevTier(alert.severity);
        if (tierFilter !== 'all' && tier !== tierFilter) return false;
        // Search filter
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

  // Filtered system logs
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

  // Severity counts
  const criticalCount = useMemo(() => plantAlerts.filter((a) => sevTier(a.severity) === 'critical').length, [plantAlerts]);
  const warningCount = useMemo(() => plantAlerts.filter((a) => sevTier(a.severity) === 'warning').length, [plantAlerts]);
  const infoCount = useMemo(() => plantAlerts.filter((a) => sevTier(a.severity) === 'info').length, [plantAlerts]);
  const unreadLogsCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title="Alert & Notification Center"
        subtitle="Unified operations alarm triage, telemetry anomaly surveillance, and system event log."
      />

      {/* KPI Cards / Severity Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card
          onClick={() => { setActiveView('active'); setTierFilter('all'); }}
          className={cn(
            'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
            activeView === 'active' && tierFilter === 'all'
              ? 'border-primary ring-1 ring-primary/30 bg-primary/5'
              : 'border-border/80 bg-card',
          )}
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-2xs font-bold uppercase tracking-wider font-mono-num">Active Alerts</span>
            <Bell className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-foreground tracking-tight">
            {plantAlerts.length}
          </div>
          <p className="text-3xs text-muted-foreground mt-1">Live telemetry conditions</p>
        </Card>

        <Card
          onClick={() => { setActiveView('active'); setTierFilter('critical'); }}
          className={cn(
            'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
            activeView === 'active' && tierFilter === 'critical'
              ? 'border-danger ring-1 ring-danger/30 bg-danger/5'
              : 'border-border/80 bg-card',
          )}
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-2xs font-bold uppercase tracking-wider font-mono-num text-danger">Critical</span>
            <Lamp tone="danger" pulse size={8} />
          </div>
          <div className="text-2xl font-bold font-mono-num text-danger tracking-tight">
            {criticalCount}
          </div>
          <p className="text-3xs text-muted-foreground mt-1">Immediate action required</p>
        </Card>

        <Card
          onClick={() => { setActiveView('active'); setTierFilter('warning'); }}
          className={cn(
            'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
            activeView === 'active' && tierFilter === 'warning'
              ? 'border-warn ring-1 ring-warn/30 bg-warn/5'
              : 'border-border/80 bg-card',
          )}
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-2xs font-bold uppercase tracking-wider font-mono-num text-amber-500">Warning</span>
            <Lamp tone="warn" size={8} />
          </div>
          <div className="text-2xl font-bold font-mono-num text-amber-500 tracking-tight">
            {warningCount}
          </div>
          <p className="text-3xs text-muted-foreground mt-1">Elevated telemetry drift</p>
        </Card>

        <Card
          onClick={() => { setActiveView('logs'); setTierFilter('all'); }}
          className={cn(
            'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
            activeView === 'logs'
              ? 'border-accent ring-1 ring-accent/30 bg-accent/5'
              : 'border-border/80 bg-card',
          )}
        >
          <div className="flex items-center justify-between text-muted-foreground mb-1.5">
            <span className="text-2xs font-bold uppercase tracking-wider font-mono-num">System Log</span>
            <Activity className="h-4 w-4 text-accent" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-foreground tracking-tight">
            {notifs.length}
            {unreadLogsCount > 0 && (
              <span className="text-xs font-semibold text-accent ml-2 font-sans">
                ({unreadLogsCount} unread)
              </span>
            )}
          </div>
          <p className="text-3xs text-muted-foreground mt-1">Audit & workflow records</p>
        </Card>
      </div>

      {/* Control Console & Filters */}
      <Card className="p-3.5 rounded-2xl border-border/80 space-y-3 shadow-xs">
        {/* Main Tab Bar & Batch Actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Active vs Logs Switcher */}
          <div className="flex items-center p-1 bg-muted/60 rounded-xl border border-border/70">
            <button
              type="button"
              onClick={() => setActiveView('active')}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                activeView === 'active'
                  ? 'bg-card text-foreground shadow-2xs border border-border/60'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Bell className="h-3.5 w-3.5 text-primary" />
              <span>Active Alarms ({plantAlerts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('logs')}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                activeView === 'logs'
                  ? 'bg-card text-foreground shadow-2xs border border-border/60'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FileText className="h-3.5 w-3.5 text-accent" />
              <span>System Log ({notifs.length})</span>
            </button>
          </div>

          {/* Batch Actions */}
          <div className="flex items-center gap-2">
            {activeView === 'active' && plantAlerts.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    plantAlerts.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000));
                    toast.success('All active alerts snoozed for 1 hour');
                  }}
                  className="h-8 gap-1.5 text-xs border-border/80"
                >
                  <BellOff className="h-3.5 w-3.5 text-warn" />
                  <span>Snooze all (1h)</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    clearAlerts();
                    toast.success('All active alerts dismissed');
                  }}
                  className="h-8 gap-1.5 text-xs text-danger hover:bg-danger-soft border-danger/30 hover:border-danger/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Dismiss all</span>
                </Button>
              </>
            )}

            {activeView === 'logs' && unreadLogsCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={markAllRead}
                className="h-8 gap-1.5 text-xs text-accent border-accent/40 hover:bg-accent-soft"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Mark all read</span>
              </Button>
            )}
          </div>
        </div>

        {/* Sub-Filters: Tier + Plant + Search */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1 border-t border-border/50">
          {/* Tier Filter Pills */}
          <div className="sm:col-span-4 flex items-center gap-1 overflow-x-auto p-0.5">
            <button
              type="button"
              onClick={() => setTierFilter('all')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all whitespace-nowrap',
                tierFilter === 'all'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('critical')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all flex items-center gap-1 whitespace-nowrap',
                tierFilter === 'critical'
                  ? 'bg-danger text-white shadow-2xs'
                  : 'text-danger hover:bg-danger-soft',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              <span>Critical ({criticalCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('warning')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all flex items-center gap-1 whitespace-nowrap',
                tierFilter === 'warning'
                  ? 'bg-warn text-warn-foreground shadow-2xs'
                  : 'text-amber-500 hover:bg-warn-soft',
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              <span>Warning ({warningCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('info')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all whitespace-nowrap',
                tierFilter === 'info'
                  ? 'bg-info text-white shadow-2xs'
                  : 'text-info hover:bg-info-soft',
              )}
            >
              Info ({infoCount})
            </button>
          </div>

          {/* Plant Dropdown (Active view only) */}
          {activeView === 'active' && (
            <div className="sm:col-span-3">
              <Select value={plantFilter} onValueChange={setPlantFilter}>
                <SelectTrigger className="h-8 text-xs bg-muted/30 border-border/70">
                  <SelectValue placeholder="All Plants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plants</SelectItem>
                  {visiblePlants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Search Input */}
          <div className={cn(activeView === 'active' ? 'sm:col-span-5' : 'sm:col-span-8', 'relative')}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by title, equipment, source, plant…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-muted/30 border-border/70"
            />
          </div>
        </div>
      </Card>

      {/* Main List */}
      <div className="space-y-2.5">
        {activeView === 'active' && (
          <>
            {filteredPlantAlerts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filteredPlantAlerts.map((alert) => {
                  const Icon = getAlertIcon(alert);
                  const plantName = plantNameById.get(alert.plantId);
                  const tier = sevTier(alert.severity);

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
                      onNavigate={(path) => navigate(path)}
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
              </div>
            ) : (
              <Card className="py-14 text-center space-y-3 rounded-2xl border-dashed">
                <div className="h-12 w-12 rounded-full bg-accent/10 text-accent flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">No active alarms matching criteria</h4>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    All supervised sensors and equipment in this filter set are within operating thresholds.
                  </p>
                </div>
              </Card>
            )}
          </>
        )}

        {activeView === 'logs' && (
          <>
            {filteredLogs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filteredLogs.map((n) => {
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
                      onNavigate={(path) => navigate(path)}
                      onDismiss={() => deleteNotification(n.id)}
                    />
                  );
                })}
              </div>
            ) : (
              <Card className="py-14 text-center space-y-3 rounded-2xl border-dashed">
                <div className="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
                  <FileText className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">No system logs found</h4>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    No historical workflow notifications match your filter query.
                  </p>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

