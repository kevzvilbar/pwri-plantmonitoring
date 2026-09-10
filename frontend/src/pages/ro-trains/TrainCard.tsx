import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  Clock,
  ArrowRight,
  AlertTriangle,
  PowerOff,
  Gauge,
  Droplets,
  ShieldCheck,
  Zap,
  Thermometer,
  Wrench,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { fmtNum, RECOVERY_BAND } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { TelemetryGauge, deriveTrainStatus } from './helpers';
import type { TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';
import { TrainLogModal } from './TrainLogModal';

export interface TrainCardProps {
  train: any;
  last: any;
  spark: any[];
  permTdsLimit?: number;
  /** This train's currently-unresolved hourly gaps, from useTrainHourlyGaps via Overview.tsx. */
  hourlyGaps?: TrainHourlyGap[];
  /** Deep-link from a Dashboard alert — auto-opens the log modal for this card. */
  autoOpenLog?: boolean;
  autoOpenTab?: 'ro' | 'pretreat';
  autoOpenHighlightId?: string;
  /** Called once the auto-open has been applied, so Overview.tsx can clear the URL params. */
  onAutoOpenConsumed?: () => void;
  /** Display mode: 'compact' (classic summary) or 'diagnostics' (detailed engineering telemetry) */
  viewMode?: 'compact' | 'diagnostics';
}

export function TrainCard({
  train,
  last,
  spark,
  permTdsLimit = 500,
  hourlyGaps,
  autoOpenLog,
  autoOpenTab,
  autoOpenHighlightId,
  onAutoOpenConsumed,
  viewMode = 'compact',
}: TrainCardProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [localOpenTarget, setLocalOpenTarget] = useState<{
    tab: 'ro' | 'pretreat';
    highlightId: string;
  } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoOpenLog) {
      setLogOpen(true);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenLog]);

  const trainLabel = `Train ${train.train_number}${train.name ? ` · ${train.name}` : ''}`;
  const status: 'Running' | 'Maintenance' | 'Offline' = deriveTrainStatus(train, last);

  const statusBadge = {
    Running: {
      label: 'Online',
      dot: 'bg-emerald-500',
      text: 'text-emerald-500',
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-500/10',
    },
    Maintenance: {
      label: 'Maintenance',
      dot: 'bg-amber-500',
      text: 'text-amber-500',
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/10',
    },
    Offline: {
      label: 'Offline',
      dot: 'bg-slate-400',
      text: 'text-slate-400',
      border: 'border-slate-400/30',
      bg: 'bg-slate-500/10',
    },
  }[status];

  const recovery = last?.recovery_pct != null ? `${fmtNum(last.recovery_pct, 1)}%` : '—';
  const permTDS = last?.permeate_tds != null ? `${fmtNum(last.permeate_tds, 0)} ppm` : '—';
  const lastTime = last?.reading_datetime
    ? format(new Date(last.reading_datetime), 'hh:mm:ss aa')
    : '—';

  // Physical calculations grounded in real sensor data:
  const dpValue =
    last?.dp_psi ??
    (last?.feed_pressure_psi != null && last?.reject_pressure_psi != null
      ? Math.max(0, +(last.feed_pressure_psi - last.reject_pressure_psi).toFixed(1))
      : null);

  const saltRejectionValue =
    last?.rejection_pct ??
    (last?.feed_tds != null && last?.permeate_tds != null && last.feed_tds > 0
      ? Math.max(0, +((1 - last.permeate_tds / last.feed_tds) * 100).toFixed(1))
      : null);

  const isOnline = status === 'Running';
  const recWarn =
    last?.recovery_pct != null &&
    (last.recovery_pct < RECOVERY_BAND.min || last.recovery_pct > RECOVERY_BAND.max);
  const tdsWarn = last?.permeate_tds != null && last.permeate_tds > permTdsLimit;
  const isDpElevated = dpValue != null && dpValue > 25;

  const recoveryPoints = spark
    .map((r: any) => r.recovery_pct)
    .filter((v: any) => v != null)
    .reverse()
    .map((v: number, i: number) => ({ i, v }));

  const tdsPoints = spark
    .map((r: any) => r.permeate_tds)
    .filter((v: any) => v != null)
    .reverse()
    .map((v: number, i: number) => ({ i, v }));

  return (
    <Card
      className={cn(
        'p-3 space-y-2.5 rounded-xl border bg-card transition-all duration-150 shadow-2xs hover:border-primary/40 flex flex-col justify-between',
        isOnline ? 'border-border/60' : 'border-border/40 bg-card/60'
      )}
    >
      <div className="space-y-2">
        {/* Header: Identity + Live status badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-3xs font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50 shrink-0">
              RO-{String(train.train_number).padStart(2, '0')}
            </span>
            <span className="text-xs font-semibold text-foreground truncate">
              Train {train.train_number}
            </span>
            {train.name && (
              <span className="text-3xs text-muted-foreground truncate hidden sm:inline">
                ({train.name})
              </span>
            )}
          </div>

          <div
            className={cn(
              'inline-flex items-center gap-1.5 text-2xs font-semibold px-2 py-0.5 rounded-full border',
              statusBadge.border,
              statusBadge.text,
              statusBadge.bg
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                statusBadge.dot,
                isOnline && 'animate-pulse'
              )}
            />
            <span>{statusBadge.label}</span>
          </div>
        </div>

        {/* Hourly gap badge (if unlogged shifts detected) */}
        {hourlyGaps && hourlyGaps.length > 0 && (() => {
          const sorted = [...hourlyGaps].sort(
            (a, b) =>
              new Date(b.gap.gapEndAt).getTime() - new Date(a.gap.gapEndAt).getTime()
          );
          const primary = sorted[0];
          const totalMissed = hourlyGaps.reduce((s, g) => s + g.gap.missedHours, 0);
          const extraSpans = hourlyGaps.length - 1;
          return (
            <button
              type="button"
              onClick={() => {
                setLocalOpenTarget({
                  tab:
                    primary.source_table === 'ro_train_readings' ? 'ro' : 'pretreat',
                  highlightId: `gap:${primary.gap.gapStartAt}`,
                });
                setLogOpen(true);
              }}
              title={`${totalMissed} hr${
                totalMissed === 1 ? '' : 's'
              } missing${extraSpans > 0 ? ` across ${hourlyGaps.length} spans` : ''} — click to log`}
              className="w-full flex items-center justify-between gap-1.5 text-3xs font-medium text-warn bg-warn-soft/80 hover:bg-warn-soft border border-warn/40 px-2 py-1 rounded-lg transition-colors active:scale-[0.99] cursor-pointer"
            >
              <div className="flex items-center gap-1 truncate">
                <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />
                <span className="truncate">
                  {totalMissed} hr{totalMissed === 1 ? '' : 's'} unlogged
                  {extraSpans > 0 ? ` (+${extraSpans})` : ''}
                </span>
              </div>
              <span className="shrink-0 font-semibold underline text-warn">
                Log reason →
              </span>
            </button>
          );
        })()}

        {/* ── Main Telemetry Display ── */}
        {isOnline ? (
          viewMode === 'diagnostics' ? (
            /* ── DIAGNOSTICS CONSOLE: SCADA Telemetry Matrix ── */
            <div className="space-y-2 pt-0.5">
              {/* Row 1: Flow & Recovery Matrix */}
              <div className="rounded-lg bg-muted/20 border border-border/40 p-2 space-y-1.5">
                <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Droplets className="h-3 w-3 text-cyan-500" />
                    <span>Flow & Recovery</span>
                  </span>
                  <span className="text-3xs font-mono text-muted-foreground/70">
                    Band: 65%–75%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="space-y-0.5 text-left">
                    <div className="text-3xs text-muted-foreground">Permeate</div>
                    <div className="text-xs font-bold font-mono-num text-foreground">
                      {last?.permeate_flow != null ? fmtNum(last.permeate_flow, 2) : '—'}
                      <span className="text-3xs font-normal text-muted-foreground ml-0.5">m³/h</span>
                    </div>
                  </div>
                  <div className="space-y-0.5 text-left">
                    <div className="text-3xs text-muted-foreground">Feed</div>
                    <div className="text-xs font-bold font-mono-num text-foreground">
                      {last?.feed_flow != null ? fmtNum(last.feed_flow, 2) : '—'}
                      <span className="text-3xs font-normal text-muted-foreground ml-0.5">m³/h</span>
                    </div>
                  </div>
                  <div className="space-y-0.5 text-left">
                    <div className="text-3xs text-muted-foreground">Recovery</div>
                    <div
                      className={cn(
                        'text-xs font-bold font-mono-num',
                        recWarn ? 'text-warn' : 'text-emerald-500'
                      )}
                    >
                      {recovery}
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Hydraulic Pressures & Differential Pressure ΔP */}
              <div className="rounded-lg bg-muted/20 border border-border/40 p-2 space-y-1.5">
                <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Gauge className={cn('h-3 w-3', isDpElevated ? 'text-warn' : 'text-primary')} />
                    <span>Hydraulics & ΔP</span>
                  </span>
                  <span
                    className={cn(
                      'text-3xs font-semibold px-1.5 py-0.2 rounded',
                      isDpElevated
                        ? 'bg-warn/15 text-warn border border-warn/30'
                        : 'text-muted-foreground/80'
                    )}
                  >
                    {isDpElevated ? 'Elevated ΔP' : 'Nominal ΔP'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-0.5">
                    <div className="text-3xs text-muted-foreground">Feed Press.</div>
                    <div className="text-xs font-bold font-mono-num text-foreground">
                      {last?.feed_pressure_psi != null ? fmtNum(last.feed_pressure_psi, 1) : '—'}
                      <span className="text-3xs font-normal text-muted-foreground ml-0.5">psi</span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-3xs text-muted-foreground">Reject Press.</div>
                    <div className="text-xs font-bold font-mono-num text-foreground">
                      {last?.reject_pressure_psi != null ? fmtNum(last.reject_pressure_psi, 1) : '—'}
                      <span className="text-3xs font-normal text-muted-foreground ml-0.5">psi</span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-3xs text-muted-foreground">Membrane ΔP</div>
                    <div
                      className={cn(
                        'text-xs font-bold font-mono-num',
                        isDpElevated ? 'text-warn' : 'text-foreground'
                      )}
                    >
                      {dpValue != null ? fmtNum(dpValue, 1) : '—'}
                      <span className="text-3xs font-normal text-muted-foreground ml-0.5">psi</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3: Water Quality & Salt Rejection */}
              <div className="rounded-lg bg-muted/20 border border-border/40 p-2 space-y-1.5">
                <div className="flex items-center justify-between text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-indigo-500" />
                    <span>Quality & Salt Rejection</span>
                  </span>
                  <span className="text-3xs font-mono text-muted-foreground/70">
                    Limit: ≤{permTdsLimit} ppm
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-0.5">
                    <div className="text-3xs text-muted-foreground">Perm TDS</div>
                    <div
                      className={cn(
                        'text-xs font-bold font-mono-num',
                        tdsWarn ? 'text-danger' : 'text-foreground'
                      )}
                    >
                      {permTDS}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-3xs text-muted-foreground">Feed TDS</div>
                    <div className="text-xs font-bold font-mono-num text-foreground">
                      {last?.feed_tds != null ? `${fmtNum(last.feed_tds, 0)} ppm` : '—'}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-3xs text-muted-foreground">Salt Rejection</div>
                    <div className="text-xs font-bold font-mono-num text-emerald-500">
                      {saltRejectionValue != null ? `${fmtNum(saltRejectionValue, 1)}%` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Auxiliary telemetry strip: Energy & Temp */}
              {(last?.specific_energy_kwh_m3 != null || last?.temperature_c != null) && (
                <div className="flex items-center justify-between text-3xs font-mono px-1 text-muted-foreground">
                  {last?.specific_energy_kwh_m3 != null && (
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3 text-amber-500" />
                      <span>{fmtNum(last.specific_energy_kwh_m3, 2)} kWh/m³</span>
                    </span>
                  )}
                  {last?.temperature_c != null && (
                    <span className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3 text-rose-500" />
                      <span>{fmtNum(last.temperature_c, 1)} °C</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ── COMPACT MODE: Fast Summary Gauges ── */
            <div className="grid grid-cols-2 gap-1.5">
              <div className="p-2 rounded-lg bg-muted/30 border border-border/40 space-y-1">
                <div className="flex items-center justify-between text-3xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Recovery</span>
                  <span className="text-3xs font-mono opacity-70">65-75%</span>
                </div>
                <div className="flex items-baseline">
                  <span
                    className={cn(
                      'text-sm font-bold font-mono-num',
                      recWarn ? 'text-warn' : 'text-foreground'
                    )}
                  >
                    {recovery}
                  </span>
                </div>
                <TelemetryGauge
                  label="Recovery"
                  data={recoveryPoints}
                  status={recWarn ? 'warn' : 'ok'}
                  band={RECOVERY_BAND}
                  height={28}
                />
              </div>

              <div className="p-2 rounded-lg bg-muted/30 border border-border/40 space-y-1">
                <div className="flex items-center justify-between text-3xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Perm TDS</span>
                  <span className="text-3xs font-mono opacity-70">≤{permTdsLimit}</span>
                </div>
                <div className="flex items-baseline">
                  <span
                    className={cn(
                      'text-sm font-bold font-mono-num',
                      tdsWarn ? 'text-danger' : 'text-foreground'
                    )}
                  >
                    {permTDS}
                  </span>
                </div>
                <TelemetryGauge
                  label="TDS"
                  data={tdsPoints}
                  status={tdsWarn ? 'danger' : 'ok'}
                  thresholdMax={permTdsLimit}
                  height={28}
                />
              </div>
            </div>
          )
        ) : (
          /* Offline / Standby state */
          <div className="p-3 rounded-lg bg-muted/20 border border-border/30 flex items-center justify-between text-2xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <PowerOff className="h-3.5 w-3.5 opacity-60" /> Unit inactive / offline
            </span>
            <span className="text-3xs font-mono">
              Last: {recovery !== '—' ? recovery : 'No data'}
            </span>
          </div>
        )}
      </div>

      {/* Card Footer: Timestamp + Hardware Tags + Action Buttons */}
      <div className="flex items-center justify-between text-3xs text-muted-foreground pt-2 border-t border-border/30 gap-2">
        <div className="flex items-center gap-1 truncate">
          <Clock className="h-3 w-3 shrink-0 opacity-50" />
          <span className="truncate">{lastTime !== '—' ? lastTime : 'No logs'}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1 text-3xs font-mono text-muted-foreground/80">
            {train.num_afm > 0 && <span>AFM:{train.num_afm}</span>}
            {train.num_booster_pumps > 0 && <span>BP:{train.num_booster_pumps}</span>}
          </div>

          <button
            onClick={() => setLogOpen(true)}
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-0.5 cursor-pointer"
          >
            <span>Log Readings</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {logOpen && (
        <TrainLogModal
          trainId={train.id}
          trainLabel={trainLabel}
          plantId={train.plant_id}
          onClose={() => {
            setLogOpen(false);
            setLocalOpenTarget(null);
          }}
          initialTab={localOpenTarget?.tab ?? autoOpenTab}
          highlightId={localOpenTarget?.highlightId ?? autoOpenHighlightId}
        />
      )}
    </Card>
  );
}
