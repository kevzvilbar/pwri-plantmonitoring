import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { 
  Droplet, ArrowRight, Activity, AlertTriangle, CheckCircle2, 
  Zap, Gauge, RefreshCw, ExternalLink, ShieldAlert
} from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, 
  Tooltip, CartesianGrid 
} from 'recharts';

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

// 24-hour simulated telemetry curve
const MOCK_HOURLY_DATA = [
  { time: '00:00', flow: 320, recovery: 78, tds: 18 },
  { time: '04:00', flow: 325, recovery: 79, tds: 17 },
  { time: '08:00', flow: 340, recovery: 80, tds: 19 },
  { time: '12:00', flow: 338, recovery: 78, tds: 20 },
  { time: '16:00', flow: 330, recovery: 77, tds: 18 },
  { time: '20:00', flow: 335, recovery: 79, tds: 18 },
];

export function PlantTelemetryDrawer({ 
  open, 
  onOpenChange, 
  plant, 
  summaryCounts 
}: PlantTelemetryDrawerProps) {
  const navigate = useNavigate();
  const [activeMetric, setActiveMetric] = useState<'flow' | 'recovery' | 'tds'>('flow');
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!plant) return null;

  const wells = summaryCounts?.wells?.[plant.id] ?? { active: 0, total: 0 };
  const locators = summaryCounts?.locators?.[plant.id] ?? { active: 0, total: 0 };
  const trains = summaryCounts?.trains?.[plant.id] ?? { active: 0, total: 0 };

  const isOptimal = (trains.total === 0 || trains.active > 0) && (wells.total === 0 || wells.active > 0);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl w-full p-0 flex flex-col bg-card border-border overflow-hidden shadow-2xl">
        
        {/* ── Top Facility Banner ── */}
        <div className="p-5 border-b border-border bg-gradient-to-r from-muted/60 via-muted/30 to-background shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-primary-soft text-primary border border-primary">
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
              <span className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] border ${
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
              <div className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                <Droplet className="h-3 w-3 text-sky-500" /> Wells
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {wells.active} <span className="text-xs text-muted-foreground font-normal">/{wells.total}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {wells.total > 0 ? `${Math.round((wells.active/wells.total)*100)}% online` : 'No wells'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                <Gauge className="h-3 w-3 text-teal-500" /> Locators
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {locators.active} <span className="text-xs text-muted-foreground font-normal">/{locators.total}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {locators.total > 0 ? `${Math.round((locators.active/locators.total)*100)}% synced` : 'No locators'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                <ROTrainIcon className="h-3 w-3 text-violet-500" /> RO Trains
              </div>
              <div className="font-mono text-base font-bold text-foreground">
                {trains.active} <span className="text-xs text-muted-foreground font-normal">/{trains.total}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {trains.total > 0 ? `${Math.round((trains.active/trains.total)*100)}% load` : 'No trains'}
              </div>
            </div>
          </div>

          {/* ── Realtime Trend Chart ── */}
          <div className="p-4 rounded-xl border border-border/70 bg-muted/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" /> 24h Production Trend
              </div>
              
              {/* Metric Toggle */}
              <div className="flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-[11px] font-semibold">
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
            </div>

            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCK_HOURLY_DATA} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
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
            </div>
          </div>

          {/* ── Live Operational Status Checklist ── */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Diagnostics</h4>
            
            {trains.active === 0 && trains.total > 0 ? (
              <div className="p-3 rounded-lg bg-danger-soft border border-danger text-danger text-xs flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">RO Fleet Offline</div>
                  <div className="text-[11px] opacity-90 mt-0.5">All Reverse Osmosis trains in standby / power shedding mode.</div>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-primary-soft border border-primary text-primary text-xs flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Nominal System Operation</div>
                  <div className="text-[11px] opacity-90 mt-0.5">Membrane differential pressure and recovery ratios are within ISO limits.</div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ── Drawer Footer ── */}
        <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>WebSocket Live Stream Active</span>
          </span>
          <span className="font-mono text-[11px]">Telemetry Nominal</span>
        </div>

      </SheetContent>
    </Sheet>
  );
}

