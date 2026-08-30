import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Clock, ArrowRight, AlertTriangle, PowerOff, ShieldCheck, Wrench } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { Sparkline, deriveTrainStatus } from './helpers';
import { ROTrainIcon } from '@/components/icons/water-icons';
import type { TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';
import { TrainLogModal } from './TrainLogModal';

interface TrainCardProps {
  train: any;
  last: any;
  spark: any[];
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
    Running:     { label: 'Online',      dot: 'bg-accent', text: 'text-accent', border: 'border-accent/40', icon: ShieldCheck },
    Maintenance: { label: 'Maintenance', dot: 'bg-warn',   text: 'text-warn',     border: 'border-warn/40',   icon: Wrench },
    Offline:     { label: 'Offline',     dot: 'bg-danger', text: 'text-danger',   border: 'border-danger/40', icon: PowerOff },
  }[status] ?? { label: status, dot: 'bg-muted-foreground', text: 'text-muted-foreground', border: 'border-border', icon: ShieldCheck };

  const recovery  = last?.recovery_pct  != null ? `${fmtNum(last.recovery_pct, 1)}%`    : '—';
  const permTDS   = last?.permeate_tds  != null ? `${fmtNum(last.permeate_tds, 0)} ppm` : '—';
  const lastTime  = last?.reading_datetime ? format(new Date(last.reading_datetime), 'hh:mm:ss aa') : '—';

  const recoveryVals = spark.map((r: any) => r.recovery_pct).filter((v: any) => v != null).reverse();
  const tdsVals      = spark.map((r: any) => r.permeate_tds).filter((v: any) => v != null).reverse();

  const recWarn = last?.recovery_pct != null && (last.recovery_pct < 65 || last.recovery_pct > 75);
  const tdsWarn = last?.permeate_tds != null && last.permeate_tds > 600;

  return (
    <Card className={cn(
      'group relative p-4 space-y-3 rounded-2xl border bg-card/90 backdrop-blur-sm transition-all duration-200 shadow-2xs hover:shadow-md flex flex-col justify-between',
      status === 'Running' ? 'border-accent/30 hover:border-accent/60' :
      status === 'Offline' ? 'border-danger/30 hover:border-danger/60' :
      'border-warn/30 hover:border-warn/60'
    )}>
      <div className="space-y-3">
        {/* Header: Identity + Status pill */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
              <ROTrainIcon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground tracking-tight truncate">
                  Train {train.train_number}
                </span>
                {train.name && (
                  <span className="text-3xs font-semibold text-muted-foreground truncate bg-muted px-1.5 py-0.5 rounded">
                    {train.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status Pill with Pulsing Indicator */}
          <div className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-mono-num shrink-0 border shadow-2xs',
            status === 'Running' ? 'bg-accent-soft text-accent border-accent/40' :
            status === 'Offline' ? 'bg-danger-soft text-danger border-danger/40' :
            'bg-warn-soft text-warn border-warn/40'
          )}>
            {status === 'Running' ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
            ) : (
              <span className={cn('h-2 w-2 rounded-full', status === 'Offline' ? 'bg-danger' : 'bg-warn')} />
            )}
            <span>{statusBadge.label}</span>
          </div>
        </div>

        {/* Hourly gap badge (if any missing readings) - 44px min hit area */}
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
              className="min-h-[44px] w-full flex items-center justify-between gap-2 text-xs font-semibold text-warn bg-warn-soft hover:bg-warn-soft/80 border border-warn/50 px-3 py-2 rounded-xl transition-all shadow-2xs active:scale-[0.98] cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warn animate-pulse" />
                <span className="truncate font-medium">
                  {totalMissed} hr{totalMissed === 1 ? '' : 's'} missing{extraSpans > 0 ? ` (+${extraSpans} spans)` : ''}
                </span>
              </div>
              <span className="shrink-0 font-bold underline text-xs text-warn">Log Reason →</span>
            </button>
          );
        })()}

        {/* Dual Telemetry Metric Cards */}
        <div className="grid grid-cols-2 gap-2">
          {/* Recovery Metric Card */}
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border/50 space-y-1.5">
            <div className="flex items-center justify-between text-3xs font-bold text-muted-foreground uppercase tracking-wider">
              <span>Recovery</span>
              <Sparkline values={recoveryVals} color={recWarn ? 'hsl(var(--warn))' : 'hsl(var(--accent))'} width={56} height={18} />
            </div>
            <div className="flex items-baseline gap-1">
              <span className={cn('text-lg font-bold font-mono-num', recWarn ? 'text-warn' : 'text-foreground')}>
                {recovery}
              </span>
            </div>
          </div>

          {/* Permeate TDS Metric Card */}
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border/50 space-y-1.5">
            <div className="flex items-center justify-between text-3xs font-bold text-muted-foreground uppercase tracking-wider">
              <span>Perm TDS</span>
              <Sparkline values={tdsVals} color={tdsWarn ? 'hsl(var(--danger))' : 'hsl(var(--primary))'} width={56} height={18} />
            </div>
            <div className="flex items-baseline gap-1">
              <span className={cn('text-lg font-bold font-mono-num', tdsWarn ? 'text-danger' : 'text-foreground')}>
                {permTDS}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Card Footer: Metadata + Sub-systems + Interactive Action */}
      <div className="flex items-center justify-between text-2xs text-muted-foreground pt-2.5 border-t border-border/40 gap-2">
        <div className="flex items-center gap-1.5 truncate">
          <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="truncate">{lastTime !== '—' ? `Last log: ${lastTime}` : 'No logs yet'}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1">
            {train.num_afm > 0 && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">
                AFM×{train.num_afm}
              </span>
            )}
            {train.num_booster_pumps > 0 && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">
                BP×{train.num_booster_pumps}
              </span>
            )}
          </div>

          {/* 44px min touch target button */}
          <button
            onClick={() => setLogOpen(true)}
            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-bold text-xs inline-flex items-center gap-1.5 transition-all active:scale-[0.97]"
          >
            <span>Open log</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
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
