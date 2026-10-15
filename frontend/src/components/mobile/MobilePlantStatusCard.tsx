import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Activity, 
  Droplets, 
  Gauge, 
  Zap, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  ArrowUpRight, 
  Clock, 
  Building2,
  TrendingUp,
  TrendingDown,
  Layers
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';

export interface MobilePlantStatusProps {
  plantName: string;
  isOnline: boolean;
  freshnessLabel: string;
  freshnessTone?: 'good' | 'warn' | 'muted';
  production: number | null;
  dProduction?: number | null;
  recovery: number | null;
  rawWater: number | null;
  specificPower: number | null;
  openIncidentsCount: number;
  unacknowledgedAlertsCount: number;
  trainsCount?: number;
  onlineTrainsCount?: number;
  onOpenLogReading?: () => void;
  onViewIncidents?: () => void;
  onViewAlerts?: () => void;
}

export function MobilePlantStatusCard({
  plantName,
  isOnline,
  freshnessLabel,
  freshnessTone = 'good',
  production,
  dProduction,
  recovery,
  rawWater,
  specificPower,
  openIncidentsCount,
  unacknowledgedAlertsCount,
  trainsCount = 0,
  onlineTrainsCount = 0,
  onOpenLogReading,
  onViewIncidents,
  onViewAlerts,
}: MobilePlantStatusProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  const isProdPositive = dProduction != null && dProduction >= 0;

  return (
    <div className="space-y-3 max-w-lg mx-auto pb-2">
      {/* 2-Second Glanceable Status Hero Card */}
      <Card className="p-4 bg-gradient-to-br from-card via-card to-primary/5 border border-border/80 shadow-md rounded-3xl relative overflow-hidden">
        {/* Top Header: Plant Name & Live Telemetry Lamp */}
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <span className={cn(
              'h-2.5 w-2.5 rounded-full shrink-0',
              freshnessTone === 'good' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' :
              freshnessTone === 'warn' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]' :
              'bg-muted-foreground/60'
            )} />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-foreground">{plantName}</span>
                <span className="text-3xs text-muted-foreground font-medium">• {freshnessLabel}</span>
              </div>
            </div>
          </div>

          {/* Quick status chip */}
          <div className="flex items-center gap-1.5">
            {openIncidentsCount > 0 && (
              <button
                type="button"
                onClick={onViewIncidents}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-3xs font-bold"
              >
                <AlertTriangle className="h-3 w-3" />
                <span>{openIncidentsCount}</span>
              </button>
            )}
            {unacknowledgedAlertsCount > 0 && (
              <button
                type="button"
                onClick={onViewAlerts}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-3xs font-bold"
              >
                <span>{unacknowledgedAlertsCount} Alerts</span>
              </button>
            )}
          </div>
        </div>

        {/* Primary Hero Metric: Today's Product Water */}
        <div className="py-3.5 flex items-baseline justify-between">
          <div>
            <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
              <Droplets className="h-3.5 w-3.5 text-primary" />
              <span>Today's Product Water</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-bold font-mono tracking-tight text-foreground">
                {fmtNum(production)}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">m³</span>
            </div>
          </div>

          {dProduction != null && (
            <div className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold font-mono',
              isProdPositive 
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
            )}>
              {isProdPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              <span>{isProdPositive ? `+${dProduction.toFixed(1)}%` : `${dProduction.toFixed(1)}%`}</span>
            </div>
          )}
        </div>

        {/* 2 Key Sub-Metrics (Recovery & Train Capacity) */}
        <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-border/50">
          <div className="p-2.5 bg-muted/40 rounded-2xl border border-border/50">
            <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
              <Gauge className="h-3 w-3 text-indigo-500" />
              <span>RO Recovery</span>
            </div>
            <div className="text-sm font-bold font-mono text-foreground mt-0.5">
              {recovery != null ? `${recovery.toFixed(1)}%` : '—'}
            </div>
          </div>

          <div className="p-2.5 bg-muted/40 rounded-2xl border border-border/50">
            <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
              <Layers className="h-3 w-3 text-emerald-500" />
              <span>RO Trains</span>
            </div>
            <div className="text-sm font-bold font-mono text-foreground mt-0.5">
              {trainsCount > 0 ? `${onlineTrainsCount}/${trainsCount} Active` : 'Online'}
            </div>
          </div>
        </div>

        {/* Expandable Advanced Breakdown */}
        {expanded && (
          <div className="grid grid-cols-2 gap-2.5 pt-2.5 mt-2.5 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="p-2.5 bg-muted/40 rounded-2xl border border-border/50">
              <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                <Droplets className="h-3 w-3 text-cyan-500" />
                <span>Raw Water Intake</span>
              </div>
              <div className="text-sm font-bold font-mono text-foreground mt-0.5">
                {rawWater != null ? `${fmtNum(rawWater)} m³` : '—'}
              </div>
            </div>

            <div className="p-2.5 bg-muted/40 rounded-2xl border border-border/50">
              <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                <Zap className="h-3 w-3 text-amber-500" />
                <span>Specific Power</span>
              </div>
              <div className="text-sm font-bold font-mono text-foreground mt-0.5">
                {specificPower != null ? `${specificPower.toFixed(2)} kWh/m³` : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Expand/Collapse Toggle Button */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 text-3xs font-semibold text-muted-foreground hover:text-foreground pt-2.5 mt-1 focus:outline-none"
        >
          <span>{expanded ? 'Show Less' : 'View Raw Water & Power Details'}</span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </Card>
    </div>
  );
}

