import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Clock, ArrowRight, AlertTriangle, PowerOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { fmtNum, RECOVERY_BAND } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { TelemetryGauge, deriveTrainStatus } from './helpers';
import type { TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';
import { TrainLogModal } from './TrainLogModal';

interface TrainCardProps {
  train: any;
  last: any;
  spark: any[];
  permTdsLimit?: number;
  /** This train's currently-unresolved hourly gaps (already excludes anything logged), from useTrainHourlyGaps via Overview.tsx. */
  hourlyGaps?: TrainHourlyGap[];
  /** Deep-link from a Dashboard alert — auto-opens the log modal for this card. */
  autoOpenLog?: boolean;
  autoOpenTab?: 'ro' | 'pretreat';
  autoOpenHighlightId?: string;
  /** Called once the auto-open has been applied, so Overview.tsx can clear the URL params. */
  onAutoOpenConsumed?: () => void;
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
}: TrainCardProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [localOpenTarget, setLocalOpenTarget] = useState<{ tab: 'ro' | 'pretreat'; highlightId: string } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoOpenLog) { setLogOpen(true); onAutoOpenConsumed?.(); }
  }, [autoOpenLog]);

  const trainLabel = `Train ${train.train_number}${train.name ? ` · ${train.name}` : ''}`;
  const status: string = deriveTrainStatus(train, last);

  const statusBadge = {
    Running:     { label: 'Online',      dot: 'bg-accent', text: 'text-accent', border: 'border-accent/30' },
    Maintenance: { label: 'Maintenance', dot: 'bg-warn',   text: 'text-warn',     border: 'border-warn/30'   },
    Offline:     { label: 'Offline',     dot: 'bg-danger', text: 'text-danger',   border: 'border-danger/30' },
  }[status] ?? { label: status, dot: 'bg-muted-foreground', text: 'text-muted-foreground', border: 'border-border/40' };

  const recovery  = last?.recovery_pct  != null ? `${fmtNum(last.recovery_pct, 1)}%`    : '—';
  const permTDS   = last?.permeate_tds  != null ? `${fmtNum(last.permeate_tds, 0)} ppm` : '—';
  const lastTime  = last?.reading_datetime ? format(new Date(last.reading_datetime), 'hh:mm:ss aa') : '—';

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

  const recWarn = last?.recovery_pct != null && (last.recovery_pct < RECOVERY_BAND.min || last.recovery_pct > RECOVERY_BAND.max);
  const tdsWarn = last?.permeate_tds != null && last.permeate_tds > permTdsLimit;

  const isOnline = status === 'Running';

  return (
    <Card className={cn(
      'p-3 space-y-2 rounded-xl border bg-card transition-all duration-150 shadow-2xs hover:border-primary/40',
      isOnline ? 'border-border/60' : 'border-border/40 bg-card/60'
    )}>
      {/* Header: Identity + Status pill */}
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

        {/* Minimal Status Indicator */}
        <div className={cn('inline-flex items-center gap-1.5 text-2xs font-semibold px-2 py-0.5 rounded-full border', statusBadge.border, statusBadge.text, 'bg-muted/40')}>
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusBadge.dot, isOnline && 'animate-pulse')} />
          <span>{statusBadge.label}</span>
        </div>
      </div>

      {/* Hourly gap badge (if any missing readings) - Compact amber alert strip */}
      {hourlyGaps && hourlyGaps.length > 0 && (() => {
        const sorted = [...hourlyGaps].sort((a, b) => new Date(b.gap.gapEndAt).getTime() - new Date(a.gap.gapEndAt).getTime());
        const primary = sorted[0];
        const totalMissed = hourlyGaps.reduce((s, g) => s + g.gap.missedHours, 0);
        const extraSpans = hourlyGaps.length - 1;
        return (
          <button
            type="button"
            onClick={() => {
              setLocalOpenTarget({
                tab: primary.source_table === 'ro_train_readings' ? 'ro' : 'pretreat',
                highlightId: `gap:${primary.gap.gapStartAt}`,
              });
              setLogOpen(true);
            }}
            title={`${totalMissed} hr${totalMissed === 1 ? '' : 's'} missing${extraSpans > 0 ? ` across ${hourlyGaps.length} spans` : ''} — click to log why`}
            className="w-full flex items-center justify-between gap-1.5 text-3xs font-medium text-warn bg-warn-soft/80 hover:bg-warn-soft border border-warn/40 px-2 py-1 rounded-lg transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center gap-1 truncate">
              <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />
              <span className="truncate">
                {totalMissed} hr{totalMissed === 1 ? '' : 's'} unlogged{extraSpans > 0 ? ` (+${extraSpans})` : ''}
              </span>
            </div>
            <span className="shrink-0 font-semibold underline text-warn">Log reason →</span>
          </button>
        );
      })()}

      {/* Telemetry Metrics with Micro-Gauges */}
      {isOnline ? (
        <div className="grid grid-cols-2 gap-1.5">
          {/* Recovery Metric Card */}
          <div className="p-2 rounded-lg bg-muted/30 border border-border/40 space-y-1">
            <div className="flex items-center justify-between text-3xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Recovery</span>
              <span className="text-3xs font-mono opacity-70">65-75%</span>
            </div>
            <div className="flex items-baseline">
              <span className={cn('text-sm font-bold font-mono-num', recWarn ? 'text-warn' : 'text-foreground')}>
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

          {/* Permeate TDS Metric Card */}
          <div className="p-2 rounded-lg bg-muted/30 border border-border/40 space-y-1">
            <div className="flex items-center justify-between text-3xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Perm TDS</span>
              <span className="text-3xs font-mono opacity-70">≤{permTdsLimit}</span>
            </div>
            <div className="flex items-baseline">
              <span className={cn('text-sm font-bold font-mono-num', tdsWarn ? 'text-danger' : 'text-foreground')}>
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
      ) : (
        <div className="p-2 rounded-lg bg-muted/20 border border-border/30 flex items-center justify-between text-2xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <PowerOff className="h-3 w-3 opacity-60" /> Unit inactive / offline
          </span>
          <span className="text-3xs font-mono">Last: {recovery !== '—' ? recovery : 'No data'}</span>
        </div>
      )}

      {/* Card Footer: Timestamp + Hardware Tags + Action Link */}
      <div className="flex items-center justify-between text-3xs text-muted-foreground pt-1 border-t border-border/30 gap-2">
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
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
          >
            <span>Log</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {logOpen && (
        <TrainLogModal
          trainId={train.id}
          trainLabel={trainLabel}
          plantId={train.plant_id}
          onClose={() => { setLogOpen(false); setLocalOpenTarget(null); }}
          initialTab={localOpenTarget?.tab ?? autoOpenTab}
          highlightId={localOpenTarget?.highlightId ?? autoOpenHighlightId}
        />
      )}
    </Card>
  );
}
