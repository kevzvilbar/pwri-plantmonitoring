import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  Building2,
  Droplets,
  Zap,
  Gauge,
  ShieldCheck,
  Waves,
  Activity,
} from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { Lamp } from '@/components/ui/Lamp';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';

export interface ROTrainHeroProps {
  plantName?: string;
  totalTrains: number;
  onlineCount: number;
  maintCount?: number;
  offlineCount?: number;
  permeateFlow: number | null;
  feedFlow: number | null;
  fleetRecovery: number | null;
  avgPermTDS?: number | null;
  avgDp?: number | null;
  avgRejection?: number | null;
  permTdsLimit?: number;
  recoveryMin?: number;
}

export function ROTrainHero({
  plantName,
  totalTrains,
  onlineCount,
  maintCount = 0,
  offlineCount = 0,
  permeateFlow,
  feedFlow,
  fleetRecovery,
  avgPermTDS,
  avgDp,
  avgRejection,
  permTdsLimit,
  recoveryMin,
}: ROTrainHeroProps) {
  const [timeStr, setTimeStr] = useState('');

  // Live PHT Clock updated every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(format(now, 'hh:mm:ss a') + ' PHT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const allOnline = totalTrains > 0 && onlineCount === totalTrains;
  const hasOffline = offlineCount > 0;

  return (
    <div className="rounded-[1.75rem] bg-white/[0.03] ring-1 ring-white/10 p-1 sm:p-1.5 shadow-[var(--shadow-elev)]">
      <div className="rounded-[calc(1.75rem-0.375rem)] bg-gradient-stat text-white p-4 sm:p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] relative overflow-hidden">
        {/* ── Top Bar: Title, Identity Tag, Facility Badge, and Live Clock ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-white/15">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary to-highlight text-white shadow-xs shrink-0">
              <ROTrainIcon className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                RO Trains & Pre-Treatment
              </h1>
              <span className="px-2 py-0.5 rounded-full text-3xs font-semibold uppercase tracking-wider bg-[hsl(var(--kpi-ro))]/20 text-[hsl(var(--kpi-ro))] border border-[hsl(var(--kpi-ro))]/40">
                Membrane SCADA Telemetry
              </span>
              {plantName && (
                <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-teal-950/80 text-teal-300 border border-teal-500/40 flex items-center gap-1">
                  <Building2 className="h-3 w-3 text-teal-400" />
                  {plantName}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-2xs text-slate-300 self-start sm:self-auto">
            <Lamp tone="live" pulse size={6} />
            <span className="text-cyan-300 font-semibold">Live System</span>
            <span className="text-white/30">&bull;</span>
            <span className="tabular-nums">{timeStr || '—'}</span>
          </div>
        </div>

        {/* ── Consolidated Industrial SCADA Telemetry Grid ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 pt-3.5 items-start">
          {/* 1. Fleet Train Status */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-teal-400" />
              <span>Fleet Online</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="readout-num readout-glow text-2xl sm:text-3xl font-bold leading-none text-white font-mono-num">
                {onlineCount}
              </span>
              <span className="text-xs font-mono text-slate-300">/ {totalTrains}</span>
            </div>
            <div className="flex items-center gap-1.5 text-3xs font-medium text-slate-300 truncate">
              <Lamp
                tone={allOnline ? 'good' : hasOffline ? 'danger' : 'warn'}
                pulse={allOnline}
                size={6}
              />
              <span className="truncate">
                {allOnline
                  ? 'All trains operational'
                  : `${maintCount + offlineCount} inactive (${maintCount} maint · ${offlineCount} off)`}
              </span>
            </div>
          </div>

          {/* 2. Permeate Flow */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Droplets className="h-3 w-3 text-cyan-400" />
              <span>Permeate Flow</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="readout-num readout-glow text-2xl sm:text-3xl font-bold leading-none text-cyan-300 font-mono-num">
                {permeateFlow != null ? fmtNum(permeateFlow, 2) : '—'}
              </span>
              {permeateFlow != null && <span className="text-xs font-mono text-slate-300">m³/h</span>}
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              Total clean permeate
            </p>
          </div>

          {/* 3. Feed Flow */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Waves className="h-3 w-3 text-sky-400" />
              <span>Feed Flow</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="readout-num readout-glow text-2xl sm:text-3xl font-bold leading-none text-sky-300 font-mono-num">
                {feedFlow != null ? fmtNum(feedFlow, 2) : '—'}
              </span>
              {feedFlow != null && <span className="text-xs font-mono text-slate-300">m³/h</span>}
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              Raw feed delivery
            </p>
          </div>

          {/* 4. Fleet Recovery Rate (Weighted physical flow yield) */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-emerald-400" />
              <span>Fleet Recovery</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="readout-num readout-glow text-2xl sm:text-3xl font-bold leading-none text-emerald-300 font-mono-num">
                {fleetRecovery != null ? `${fmtNum(fleetRecovery, 2)}%` : '—'}
              </span>
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              Target: {recoveryMin != null ? `${recoveryMin}% – 75%` : '65% – 75%'}
            </p>
          </div>

          {/* 5. Membrane Differential Pressure ΔP */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Gauge className="h-3 w-3 text-teal-400" />
              <span>Fleet Avg ΔP</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  'readout-num readout-glow text-2xl sm:text-3xl font-bold leading-none font-mono-num',
                  avgDp != null && avgDp > 25 ? 'text-amber-300' : 'text-white'
                )}
              >
                {avgDp != null ? fmtNum(avgDp, 1) : '—'}
              </span>
              {avgDp != null && <span className="text-xs font-mono text-slate-300">psi</span>}
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              {avgDp != null && avgDp > 25 ? '⚠️ Elevated ΔP (>25 psi)' : 'Nominal membrane ΔP'}
            </p>
          </div>

          {/* 6. Salt Rejection & Permeate TDS */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-indigo-400" />
              <span>Salt Rejection</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="readout-num readout-glow text-2xl sm:text-3xl font-bold leading-none text-indigo-300 font-mono-num">
                {avgRejection != null ? `${fmtNum(avgRejection, 2)}%` : '—'}
              </span>
            </div>
            <p className="text-3xs text-slate-400 font-mono truncate">
              {avgPermTDS != null
                ? `TDS: ${fmtNum(avgPermTDS, 0)} ppm (≤${permTdsLimit ?? 500})`
                : 'Ionic barrier integrity'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
