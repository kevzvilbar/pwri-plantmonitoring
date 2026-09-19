import React, { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { 
  Droplet, Activity, AlertTriangle, CheckCircle2, 
  Gauge, RefreshCw, ExternalLink, TrendingUp
} from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, 
  Tooltip, CartesianGrid 
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { PlantTelemetryChart } from './charts/PlantTelemetryChart';

interface PlantTelemetryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: any;
  summaryCounts?: {
    wells?: Record<string, { active: number; total: number }>;
    locators?: Record<string, { active: number; total: number }>;
    trains?: Record<string, { active: number; total: number }>;
  };
}

export function PlantTelemetryDrawer({ 
  open, 
  onOpenChange, 
  plant, 
  summaryCounts 
}: PlantTelemetryDrawerProps) {
  const navigate = useNavigate();
  const [activeMetric, setActiveMetric] = useState<'flow' | 'recovery' | 'tds'>('flow');
  const [viewMode, setViewMode] = useState<'ro' | 'facility'>('ro');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const wells = summaryCounts?.wells?.[plant?.id] ?? { active: 0, total: 0 };
  const locators = summaryCounts?.locators?.[plant?.id] ?? { active: 0, total: 0 };
  const trains = summaryCounts?.trains?.[plant?.id] ?? { active: 0, total: 0 };

  const isOptimal = (trains.total === 0 || trains.active > 0) && (wells.total === 0 || wells.active > 0);

  // Fetch real recent RO train readings for this facility
  const { data: rawRoReadings, isLoading: loadingRo, refetch: refetchRo } = useQuery({
    queryKey: ['plant-drawer-ro-telemetry', plant?.id],
    queryFn: async () => {
      if (!plant?.id) return [];
      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select('reading_datetime, permeate_flow, permeate_meter_delta, recovery_pct, permeate_tds, dp_psi, train_id')
        .eq('plant_id', plant.id)
        .order('reading_datetime', { ascending: false })
        .limit(48);
      if (error) {
        console.error('Error fetching RO telemetry:', error);
        return [];
      }
      return (data ?? []) as Array<{
        reading_datetime: string;
        permeate_flow: number | null;
        permeate_meter_delta: number | null;
        recovery_pct: number | null;
        permeate_tds: number | null;
        dp_psi: number | null;
        train_id: string;
      }>;
    },
    enabled: open && !!plant?.id && trains.total > 0,
    staleTime: 60_000,
  });

  // Aggregate readings chronologically by timestamp bucket
  const chartData = useMemo(() => {
    if (!rawRoReadings || rawRoReadings.length === 0) return [];
    const sorted = [...rawRoReadings].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()
    );

    const map = new Map<string, {
      time: string;
      totalFlow: number;
      totalRecovery: number;
      totalTds: number;
      count: number;
      maxDp: number;
    }>();

    for (const r of sorted) {
      if (!r.reading_datetime) continue;
      const dt = new Date(r.reading_datetime);
      const key = r.reading_datetime;
      const timeLabel = format(dt, 'MMM d, HH:mm');
      const flow = r.permeate_flow ?? r.permeate_meter_delta ?? 0;
      const rec = r.recovery_pct ?? 0;
      const tds = r.permeate_tds ?? 0;
      const dp = r.dp_psi ?? 0;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          time: timeLabel,
          totalFlow: flow,
          totalRecovery: rec,
          totalTds: tds,
          count: 1,
          maxDp: dp,
        });
      } else {
        existing.totalFlow += flow;
        existing.totalRecovery += rec;
        existing.totalTds += tds;
        existing.count += 1;
        existing.maxDp = Math.max(existing.maxDp, dp);
      }
    }

    return Array.from(map.values()).map((item) => ({
      time: item.time,
      flow: +(item.totalFlow).toFixed(1),
      recovery: +(item.totalRecovery / item.count).toFixed(1),
      tds: Math.round(item.totalTds / item.count),
      dp: +(item.maxDp).toFixed(1),
    }));
  }, [rawRoReadings]);

  const latestPoint = chartData[chartData.length - 1];

  const diagnosticAlert = useMemo(() => {
    if (!latestPoint) return null;
    if (latestPoint.recovery < 70) {
      return {
        title: 'Low RO Recovery Rate',
        description: `Latest recorded average recovery is ${latestPoint.recovery}% (nominal: ≥75%). Inspect brine concentrate discharge and feed pressure.`,
      };
    }
    if (latestPoint.tds > 500) {
      return {
        title: 'Elevated Permeate TDS',
        description: `Latest permeate TDS is ${latestPoint.tds} ppm (limit: 500 ppm). Check membrane integrity and sealings.`,
      };
    }
    if (latestPoint.dp > 30) {
      return {
        title: 'High Differential Pressure',
        description: `Membrane differential pressure is ${latestPoint.dp} psi. Indicates potential membrane fouling.`,
      };
    }
    return null;
  }, [latestPoint]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (refetchRo) await refetchRo();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  if (!plant) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl w-full p-0 flex flex-col bg-card border-border overflow-hidden shadow-2xl">
        
        {/* ── Top Facility Banner ── */}
        <div className="p-5 border-b border-border bg-gradient-to-r from-muted/60 via-muted/30 to-background shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-primary-soft text-primary border border-primary">
                  {plant.name.slice(0, 3).toUpperCase()}
                </span>
                <SheetTitle className="text-lg font-bold text-foreground">{plant.name}</SheetTitle>
              </div>
              <p className="text-xs text-muted-foreground">{plant.address || 'Address unassigned'}</p>
            </div>

            <div className="flex items-center gap-1.5 mr-8">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                onClick={handleRefresh}
                title="Refresh live telemetry"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/80 text-xs">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full font-semibold text-xs border ${
                isOptimal 
                  ? 'bg-primary-soft text-primary border-primary'
                  : 'bg-danger-soft text-danger border-danger'
              }`}>
                {isOptimal ? 'Optimal Telemetry' : 'Attention Required'}
              </span>
              <span className="text-muted-foreground font-mono">
                Cap: <strong className="text-foreground">{fmtNum(plant.design_capacity_m3 ?? 0)} MLD</strong>
              </span>
            </div>

            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                onOpenChange(false);
                navigate(`/plants/${plant.id}`);
              }}
            >
              <span>Full Plant Detail</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* ── Scrollable Telemetry Engine ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          {/* Subsystem Live Summary Grid */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="text-2xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                <Droplet className="h-3 w-3 text-sky-500" /> Wells
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {wells.active} <span className="text-xs text-muted-foreground font-normal">/{wells.total}</span>
              </div>
              <div className="text-2xs text-muted-foreground">
                {wells.total > 0 ? `${Math.round((wells.active/wells.total)*100)}% online` : 'No wells'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="text-2xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                <Gauge className="h-3 w-3 text-teal-500" /> Locators
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {locators.active} <span className="text-xs text-muted-foreground font-normal">/{locators.total}</span>
              </div>
              <div className="text-2xs text-muted-foreground">
                {locators.total > 0 ? `${Math.round((locators.active/locators.total)*100)}% synced` : 'No locators'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="text-2xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                <ROTrainIcon className="h-3 w-3 text-violet-500" /> RO Trains
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {trains.active} <span className="text-xs text-muted-foreground font-normal">/{trains.total}</span>
              </div>
              <div className="text-2xs text-muted-foreground">
                {trains.total > 0 ? `${Math.round((trains.active/trains.total)*100)}% load` : 'No trains'}
              </div>
            </div>
          </div>

          {/* ── Realtime Trend Chart ── */}
          <div className="space-y-3">
            {trains.total > 0 ? (
              <div className="p-4 rounded-xl border border-border/70 bg-muted/10 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-primary" /> Telemetry Trend
                    </div>
                    
                    {/* View mode toggle: RO Telemetry vs Facility Trend */}
                    <div className="flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-2xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setViewMode('ro')}
                        className={`px-2 py-0.5 rounded transition-colors ${viewMode === 'ro' ? 'bg-card text-primary shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        RO Fleet
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('facility')}
                        className={`px-2 py-0.5 rounded transition-colors ${viewMode === 'facility' ? 'bg-card text-primary shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        Facility MLD
                      </button>
                    </div>
                  </div>
                  
                  {/* Metric Toggle (for RO mode) */}
                  {viewMode === 'ro' && (
                    <div className="flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setActiveMetric('flow')}
                        className={`px-2 py-0.5 rounded transition-colors ${activeMetric === 'flow' ? 'bg-card text-sky-500 shadow-sm' : 'text-muted-foreground'}`}
                      >
                        Flow
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveMetric('recovery')}
                        className={`px-2 py-0.5 rounded transition-colors ${activeMetric === 'recovery' ? 'bg-card text-teal-500 shadow-sm' : 'text-muted-foreground'}`}
                      >
                        Recovery
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveMetric('tds')}
                        className={`px-2 py-0.5 rounded transition-colors ${activeMetric === 'tds' ? 'bg-card text-emerald-500 shadow-sm' : 'text-muted-foreground'}`}
                      >
                        TDS
                      </button>
                    </div>
                  )}
                </div>

                {viewMode === 'ro' ? (
                  <div className="h-40 w-full pt-1">
                    {loadingRo ? (
                      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                        Loading RO telemetry history…
                      </div>
                    ) : chartData.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1.5 border border-dashed border-border/60 rounded-lg p-4 text-center">
                        <Activity className="h-5 w-5 opacity-40" />
                        <span>No recent RO telemetry readings recorded for this facility.</span>
                        <span className="text-3xs text-muted-foreground/70">Readings logged in RO Train logs will appear here.</span>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={activeMetric === 'flow' ? '#0ea5e9' : activeMetric === 'recovery' ? '#0d9488' : '#10b981'} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={activeMetric === 'flow' ? '#0ea5e9' : activeMetric === 'recovery' ? '#0d9488' : '#10b981'} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                          <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} domain={['auto', 'auto']} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))', 
                              borderColor: 'hsl(var(--border))', 
                              borderRadius: '8px', 
                              fontSize: '12px',
                              color: 'hsl(var(--foreground))'
                            }}
                            formatter={(val: any) => [
                              `${val} ${activeMetric === 'flow' ? 'm³/h' : activeMetric === 'recovery' ? '%' : 'ppm'}`,
                              activeMetric === 'flow' ? 'Permeate Flow' : activeMetric === 'recovery' ? 'Avg Recovery' : 'Avg TDS'
                            ]}
                          />
                          <Area 
                            type="monotone" 
                            dataKey={activeMetric} 
                            stroke={activeMetric === 'flow' ? '#0ea5e9' : activeMetric === 'recovery' ? '#0d9488' : '#10b981'} 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#metricGrad)" 
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                ) : (
                  <PlantTelemetryChart
                    plantId={plant.id}
                    designCapacityM3={plant.design_capacity_m3}
                    plantName={plant.name}
                  />
                )}
              </div>
            ) : (
              /* Facility without RO trains: render canonical facility telemetry trend */
              <PlantTelemetryChart
                plantId={plant.id}
                designCapacityM3={plant.design_capacity_m3}
                plantName={plant.name}
              />
            )}
          </div>

          {/* ── Live Operational Status Diagnostics ── */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Diagnostics</h4>
            
            {trains.total > 0 ? (
              trains.active === 0 ? (
                <div className="p-3 rounded-lg bg-danger-soft border border-danger text-danger text-xs flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">RO Fleet Offline</div>
                    <div className="text-xs opacity-90 mt-0.5">All Reverse Osmosis trains in standby / power shedding mode.</div>
                  </div>
                </div>
              ) : diagnosticAlert ? (
                <div className="p-3 rounded-lg bg-warning-soft border border-warning text-warning text-xs flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">{diagnosticAlert.title}</div>
                    <div className="text-xs opacity-90 mt-0.5">{diagnosticAlert.description}</div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-primary-soft border border-primary text-primary text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Nominal System Operation</div>
                    <div className="text-xs opacity-90 mt-0.5">
                      {latestPoint
                        ? `Membrane differential pressure and recovery ratios are within operational limits (Latest TDS: ${latestPoint.tds} ppm, Recovery: ${latestPoint.recovery}%).`
                        : 'RO subsystems reporting active status within operational limits.'}
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="p-3 rounded-lg bg-muted/40 border border-border/60 text-xs flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-foreground">Distribution Facility</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Operating nominally. Monitored via product meters and locator networks.
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ── Drawer Footer ── */}
        <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Database Synced</span>
            {latestPoint && (
              <span className="text-muted-foreground/70 font-mono text-3xs">· Latest: {latestPoint.time}</span>
            )}
          </span>
          <span className="font-mono text-xs">
            {isOptimal ? 'Telemetry Nominal' : 'Attention Required'}
          </span>
        </div>

      </SheetContent>
    </Sheet>
  );
}

