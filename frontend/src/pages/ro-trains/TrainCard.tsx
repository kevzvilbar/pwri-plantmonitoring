/**
 * ro-trains/TrainCard.tsx
 *
 * Mini card shown in the RO Trains Overview grid — one card per train.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 *
 * The "no reading today" badge this card used to render (reading_gap_reasons,
 * entity_type='ro_train', daily grain) was retired 2026-08 in favor of
 * useTrainHourlyGaps — the hourly-cadence version built for TrainLogModal's
 * own gap badges. Daily grain couldn't answer "which hour", so clicking it
 * only ever opened a standalone ReasonDialog floating on the card with no
 * connection to the actual missing span. The hourly badge below instead
 * deep-links straight into TrainLogModal's own gap badge (same
 * ReasonDialog, same ro_train_data_gaps row, just anchored to the specific
 * hour it's about) — see GapBadgeRow in TrainLogModal.tsx.
 */
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { MessageCircleOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { Sparkline, deriveTrainStatus } from './helpers';
import type { TrainHourlyGap } from '@/hooks/useTrainHourlyGaps';

// TrainLogModal is imported lazily to avoid a circular module reference —
// TrainCard → TrainLogModal → (various) → TrainCard would be a cycle.
// The `logOpen` flag triggers a dynamic import via React.lazy or direct import
// since this component only mounts TrainLogModal conditionally.
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
  // Set when the hourly-gap badge below is clicked (a click originating on
  // this card, not a Dashboard-alert deep-link) — takes priority over the
  // autoOpen* props while set, so the modal opens on the right tab, right
  // at the gap that was clicked.
  const [localOpenTarget, setLocalOpenTarget] = useState<{ tab: 'ro' | 'pretreat'; highlightId: string } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoOpenLog) { setLogOpen(true); onAutoOpenConsumed?.(); }
  }, [autoOpenLog]);

  const trainLabel = `Train ${train.train_number}${train.name ? ` · ${train.name}` : ''}`;
  const status: string = deriveTrainStatus(train, last);

  const statusBadge = {
    Running:     { label: 'Online',      dot: 'bg-accent', text: 'text-accent', border: 'border-accent' },
    Maintenance: { label: 'Maintenance', dot: 'bg-warn',   text: 'text-warn',     border: 'border-warn'   },
    Offline:     { label: 'Offline',     dot: 'bg-danger',     text: 'text-danger',         border: 'border-danger'       },
  }[status] ?? { label: status, dot: 'bg-muted-foreground', text: 'text-muted-foreground', border: 'border-border' };

  const recovery  = last?.recovery_pct  != null ? `${fmtNum(last.recovery_pct, 1)}%`    : '—';
  const permTDS   = last?.permeate_tds  != null ? `${fmtNum(last.permeate_tds, 0)} ppm` : '—';
  const lastTime  = last?.reading_datetime ? format(new Date(last.reading_datetime), 'hh:mm:ss aa') : '—';

  const recoveryVals = spark.map((r: any) => r.recovery_pct).filter((v: any) => v != null).reverse();
  const tdsVals      = spark.map((r: any) => r.permeate_tds).filter((v: any) => v != null).reverse();

  const recWarn = last?.recovery_pct != null && (last.recovery_pct < 65 || last.recovery_pct > 75);
  const tdsWarn = last?.permeate_tds != null && last.permeate_tds > 600;

  return (
    <Card className={cn('p-3 space-y-1.5 border', statusBadge.border)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🌊</span>
          <span className="text-sm font-semibold">Train {train.train_number}</span>
        </div>
        <div className={cn('flex items-center gap-1 text-xs font-medium', statusBadge.text)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', statusBadge.dot)} />
          {statusBadge.label}
        </div>
      </div>

      {/* Hourly gap badge — most recently-ended unresolved span, if any. See
          this file's header comment for why this replaced the old daily
          "no reading today" badge. */}
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
            className="inline-flex items-center gap-1 text-2xs font-medium text-warn bg-warn-soft border border-warn px-1.5 py-0.5 rounded-full hover:bg-warn-soft transition-colors w-fit"
          >
            <MessageCircleOff className="h-2.5 w-2.5" />
            {totalMissed} hr{totalMissed === 1 ? '' : 's'} missing{extraSpans > 0 ? ` (+${extraSpans})` : ''} — log why
          </button>
        );
      })()}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Recovery:</span>
        <span className={cn('font-mono-num font-semibold', recWarn ? 'text-warn' : 'text-foreground')}>
          {recovery}
        </span>
        <Sparkline values={recoveryVals} color={recWarn ? 'hsl(var(--warn))' : 'hsl(var(--muted-foreground))'} />
        <span className="ml-1">·</span>
        <span>Perm TDS:</span>
        <span className={cn('font-mono-num font-semibold', tdsWarn ? 'text-danger' : 'text-foreground')}>
          {permTDS}
        </span>
        <Sparkline values={tdsVals} color={tdsWarn ? 'hsl(var(--danger))' : 'hsl(var(--muted-foreground))'} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-2xs text-muted-foreground pt-0.5 border-t border-border/50">
        <span>Last reading: {lastTime}</span>
        <div className="flex items-center gap-3">
          {train.num_afm > 0 && <span className="font-medium">AFM×{train.num_afm}</span>}
          {train.num_booster_pumps > 0 && <span className="font-medium">BP×{train.num_booster_pumps}</span>}
          <button onClick={() => setLogOpen(true)} className="text-primary hover:underline font-medium">
            Open log →
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
