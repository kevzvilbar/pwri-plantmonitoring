import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Building2, Droplets, Zap, CheckCircle2, ShieldAlert } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { Lamp } from '@/components/ui/Lamp';

export interface ROTrainHeroProps {
  plantName?: string;
  totalTrains: number;
  onlineCount: number;
  maintCount?: number;
  offlineCount?: number;
  avgRecovery: string | null;
  avgPermTDS?: string | null;
  permTdsLimit?: number;
  recoveryMin?: number;
}

export function ROTrainHero({
  plantName,
  totalTrains,
  onlineCount,
  maintCount = 0,
  offlineCount = 0,
  avgRecovery,
  avgPermTDS,
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
                Membrane Telemetry
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

        {/* ── Hero Metrics Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 pt-3.5 items-center">
          {/* 1. Fleet Train Status */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-teal-400" />
              <span>Fleet Online</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="readout-num readout-glow text-3xl sm:text-4xl font-bold leading-none text-white">
                {onlineCount}
              </span>
              <span className="text-sm font-mono text-slate-300">/ {totalTrains}</span>
            </div>
            <div className="flex items-center gap-1.5 text-3xs font-medium text-slate-300">
              <Lamp tone={allOnline ? 'good' : hasOffline ? 'danger' : 'warn'} pulse={allOnline} size={6} />
              <span>
                {allOnline
                  ? 'All trains operational'
                  : `${totalTrains - onlineCount} inactive / standby`}
              </span>
            </div>
          </div>

          {/* 2. Average Recovery */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <Droplets className="h-3 w-3 text-cyan-400" />
              <span>Avg Recovery</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="readout-num readout-glow text-3xl sm:text-4xl font-bold leading-none text-white">
                {avgRecovery ?? '—'}
              </span>
              {avgRecovery && <span className="text-sm font-sans font-normal text-slate-300">%</span>}
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              Target: {recoveryMin != null ? `${recoveryMin}% – 75%` : '65% – 75%'}
            </p>
          </div>

          {/* 3. Average Permeate TDS */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>Avg Perm TDS</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="readout-num readout-glow text-3xl sm:text-4xl font-bold leading-none text-white">
                {avgPermTDS ?? '—'}
              </span>
              {avgPermTDS && <span className="text-xs font-sans font-normal text-slate-300">ppm</span>}
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              Limit: &le; {permTdsLimit ?? 500} ppm
            </p>
          </div>

          {/* 4. Maintenance & Offline Summary */}
          <div className="space-y-1">
            <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/90 flex items-center gap-1.5">
              <ShieldAlert className="h-3 w-3 text-amber-400" />
              <span>Standby / Maint</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="readout-num text-3xl sm:text-4xl font-bold leading-none text-white">
                {maintCount + offlineCount}
              </span>
              <span className="text-xs font-sans font-normal text-slate-300">units</span>
            </div>
            <p className="text-3xs text-slate-400 font-mono">
              {maintCount > 0 ? `${maintCount} maintenance` : '0 maintenance'} &bull; {offlineCount > 0 ? `${offlineCount} offline` : '0 offline'}
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

