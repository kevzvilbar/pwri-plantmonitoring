/**
 * ro-trains/TrainCard.tsx
 *
 * Mini card shown in the RO Trains Overview grid — one card per train.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { MessageCircleOff } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Card } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ReasonDialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fmtNum } from '@/lib/calculations';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { cn } from '@/lib/utils';
import { Sparkline, deriveTrainStatus } from './helpers';

// TrainLogModal is imported lazily to avoid a circular module reference —
// TrainCard → TrainLogModal → (various) → TrainCard would be a cycle.
// The `logOpen` flag triggers a dynamic import via React.lazy or direct import
// since this component only mounts TrainLogModal conditionally.
import { TrainLogModal } from './TrainLogModal';

interface TrainCardProps {
  train: any;
  last: any;
  spark: any[];
  hasReadingToday?: boolean;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
}

export function TrainCard({
  train,
  last,
  spark,
  hasReadingToday,
  gapReason,
  onGapReasonSaved,
}: TrainCardProps) {
  const [logOpen, setLogOpen]         = useState(false);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving]     = useState(false);
  const { user } = useAuth();

  const trainLabel = `Train ${train.train_number}${train.name ? ` · ${train.name}` : ''}`;
  const status: string = deriveTrainStatus(train, last);

  const statusBadge = {
    Running:     { label: 'Online',      dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
    Maintenance: { label: 'Maintenance', dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     border: 'border-amber-200 dark:border-amber-800'   },
    Offline:     { label: 'Offline',     dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',         border: 'border-red-200 dark:border-red-800'       },
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
        <div className={cn('flex items-center gap-1 text-[11px] font-medium', statusBadge.text)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', statusBadge.dot)} />
          {statusBadge.label}
        </div>
      </div>

      {/* Gap reason badge / prompt */}
      {!hasReadingToday && (
        gapReason ? (
          <button
            type="button"
            onClick={() => setGapDialogOpen(true)}
            title={`No reading today — ${reasonCategoryLabel(gapReason.reason_category)}${gapReason.reason_detail ? ': ' + gapReason.reason_detail : ''} (click to edit)`}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-1.5 py-0.5 rounded-full hover:bg-amber-100 transition-colors w-fit"
          >
            <MessageCircleOff className="h-2.5 w-2.5" />
            {reasonCategoryLabel(gapReason.reason_category)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setGapDialogOpen(true)}
            title="No reading today — log why"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors w-fit px-1 py-0.5 rounded"
          >
            <MessageCircleOff className="h-3 w-3" />
            No reading today — why?
          </button>
        )
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>Recovery:</span>
        <span className={cn('font-mono-num font-semibold', recWarn ? 'text-amber-500' : 'text-foreground')}>
          {recovery}
        </span>
        <Sparkline values={recoveryVals} color={recWarn ? '#f59e0b' : '#6b7280'} />
        <span className="ml-1">·</span>
        <span>Perm TDS:</span>
        <span className={cn('font-mono-num font-semibold', tdsWarn ? 'text-red-500' : 'text-foreground')}>
          {permTDS}
        </span>
        <Sparkline values={tdsVals} color={tdsWarn ? '#ef4444' : '#6b7280'} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5 border-t border-border/50">
        <span>Last reading: {lastTime}</span>
        <div className="flex items-center gap-3">
          {train.num_afm > 0 && <span className="font-medium">AFM×{train.num_afm}</span>}
          {train.num_booster_pumps > 0 && <span className="font-medium">BP×{train.num_booster_pumps}</span>}
          <button onClick={() => setLogOpen(true)} className="text-teal-600 hover:underline font-medium">
            Open log →
          </button>
        </div>
      </div>

      {logOpen && (
        <TrainLogModal
          trainId={train.id}
          trainLabel={trainLabel}
          plantId={train.plant_id}
          onClose={() => setLogOpen(false)}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={`No reading today for Train ${train.train_number} — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={async (category, detail) => {
          setGapSaving(true);
          const todayDateStr = format(new Date(), 'yyyy-MM-dd');
          const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
            [{
              entity_type: 'ro_train', entity_id: train.id, plant_id: train.plant_id,
              gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
              logged_by: user?.id ?? null,
            }] as any,
            { onConflict: 'entity_type,entity_id,gap_date' },
          );
          setGapSaving(false);
          if (error) { toast.error(friendlyError(error)); return; }
          toast.success(`Train ${train.train_number}: reason logged`);
          setGapDialogOpen(false);
          onGapReasonSaved?.();
        }}
      />
    </Card>
  );
}
