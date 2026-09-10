import React from 'react';
import { fmtNum } from '@/lib/calculations';
import { deriveTrainStatus } from '@/pages/ro-trains';
import { cn } from '@/lib/utils';
import { Activity, Droplets, Gauge, ShieldCheck, Waves } from 'lucide-react';

export interface FleetTelemetryBarProps {
  trains: any[];
  lastReadings: Record<string, any>;
  className?: string;
}

export function FleetTelemetryBar({ trains, lastReadings, className }: FleetTelemetryBarProps) {
  const activeTrains = trains.filter(
    (t) => deriveTrainStatus(t, lastReadings?.[t.id]) === 'Running'
  );
  const activeReadings = activeTrains
    .map((t) => lastReadings?.[t.id])
    .filter(Boolean);

  const totalTrains = trains.length;
  const onlineCount = activeTrains.length;

  // Real aggregations from database telemetry:
  const hasPermFlow = activeReadings.some((r) => r.permeate_flow != null && r.permeate_flow > 0);
  const totalPermFlow = activeReadings.reduce((s, r) => s + (r.permeate_flow ?? 0), 0);

  const hasFeedFlow = activeReadings.some((r) => r.feed_flow != null && r.feed_flow > 0);
  const totalFeedFlow = activeReadings.reduce((s, r) => s + (r.feed_flow ?? 0), 0);

  const dpReadings = activeReadings.filter((r) => r.dp_psi != null);
  const avgDp = dpReadings.length
    ? dpReadings.reduce((s, r) => s + (r.dp_psi ?? 0), 0) / dpReadings.length
    : null;

  const rejReadings = activeReadings.filter((r) => r.rejection_pct != null);
  const avgRejection = rejReadings.length
    ? rejReadings.reduce((s, r) => s + (r.rejection_pct ?? 0), 0) / rejReadings.length
    : null;

  const fleetRecovery =
    totalFeedFlow > 0 && totalPermFlow > 0
      ? (totalPermFlow / totalFeedFlow) * 100
      : null;

  const isDpElevated = avgDp != null && avgDp > 25;

  return (
    <div
      className={cn(
        'rounded-xl border border-border/50 bg-card/60 backdrop-blur-xs p-2.5 sm:p-3',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-border/40 text-2xs">
        <div className="flex items-center gap-1.5 font-semibold text-foreground uppercase tracking-wider">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>Active Fleet Telemetry</span>
          <span className="text-muted-foreground font-normal lowercase tracking-normal">
            ({onlineCount} of {totalTrains} trains active)
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono-num text-3xs text-muted-foreground">
          <span>Real-time SCADA sensor telemetry</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3">
        {/* Total Permeate Flow */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <Droplets className="h-3 w-3 text-cyan-500" />
            <span>Permeate Flow</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-base sm:text-lg font-bold font-mono-num text-foreground">
              {hasPermFlow ? fmtNum(totalPermFlow, 2) : '—'}
            </span>
            <span className="text-3xs font-mono text-muted-foreground">m³/h</span>
          </div>
          <div className="text-3xs text-muted-foreground truncate">
            Total clean permeate
          </div>
        </div>

        {/* Total Feed Flow */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <Waves className="h-3 w-3 text-blue-500" />
            <span>Feed Flow</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-base sm:text-lg font-bold font-mono-num text-foreground">
              {hasFeedFlow ? fmtNum(totalFeedFlow, 2) : '—'}
            </span>
            <span className="text-3xs font-mono text-muted-foreground">m³/h</span>
          </div>
          <div className="text-3xs text-muted-foreground truncate">
            Total raw feed delivery
          </div>
        </div>

        {/* Fleet Recovery Rate */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3 text-emerald-500" />
            <span>Fleet Recovery</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-base sm:text-lg font-bold font-mono-num text-foreground">
              {fleetRecovery != null ? `${fmtNum(fleetRecovery, 1)}%` : '—'}
            </span>
            <span className="text-3xs font-mono text-muted-foreground">yield</span>
          </div>
          <div className="text-3xs text-muted-foreground truncate">
            Target 65% – 75%
          </div>
        </div>

        {/* Average Differential Pressure ΔP */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <Gauge className={cn('h-3 w-3', isDpElevated ? 'text-warn' : 'text-primary')} />
            <span>Fleet Avg ΔP</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className={cn(
                'text-base sm:text-lg font-bold font-mono-num',
                isDpElevated ? 'text-warn' : 'text-foreground'
              )}
            >
              {avgDp != null ? fmtNum(avgDp, 1) : '—'}
            </span>
            <span className="text-3xs font-mono text-muted-foreground">psi</span>
          </div>
          <div className="text-3xs text-muted-foreground truncate">
            {isDpElevated ? 'Elevated membrane resistance' : 'Nominal membrane ΔP'}
          </div>
        </div>

        {/* Salt Rejection */}
        <div className="space-y-0.5 hidden lg:block">
          <div className="flex items-center gap-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-indigo-500" />
            <span>Salt Rejection</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-base sm:text-lg font-bold font-mono-num text-foreground">
              {avgRejection != null ? `${fmtNum(avgRejection, 1)}%` : '—'}
            </span>
            <span className="text-3xs font-mono text-muted-foreground">efficiency</span>
          </div>
          <div className="text-3xs text-muted-foreground truncate">
            Ionic barrier integrity
          </div>
        </div>
      </div>
    </div>
  );
}
