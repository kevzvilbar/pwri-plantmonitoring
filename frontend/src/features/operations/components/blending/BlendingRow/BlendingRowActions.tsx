import * as React from 'react';
import { Button } from '@/components/ui/button';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { ReasonDialog } from '@/components/ReasonDialog';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum } from '@/lib/calculations';
import type { BlendingRowLogic } from './useBlendingRow';

interface BlendingRowActionsProps {
  state: BlendingRowLogic;
}

export function BlendingRowActions({ state }: BlendingRowActionsProps) {
  const { well, volume, deltaRaw, volumeChanged, saving, showAnomalyBanner, anomalyRemarkRequired, isBackdated, backdatedContextLoading, justSaved, blendBelowPrev, blendHighVol, anomalyRemark, deviationBlend, save, showHistory, setShowHistory, gapDialogOpen, setGapDialogOpen, saveGapReason, gapSaving, eventDate } = state;

  return (
    <>
      {/* Live preview of what Save will actually commit */}
      {state.previewLine && (
        <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-kpi-ro/15 border border-kpi-ro/30 text-kpi-ro font-medium">
          {state.previewLine}
        </div>
      )}

      {/* Save button */}
      <Button onClick={save} disabled={saving || !volumeChanged || (showAnomalyBanner && anomalyRemarkRequired) || (isBackdated && backdatedContextLoading)}
        style={{ '--confirm-glow': 'hsl(var(--kpi-ro, 271 81% 56%) / 0.5)' } as React.CSSProperties}
        className={cn(
          'w-full sm:w-auto h-11 px-6 rounded-full text-sm font-semibold shadow-sm transition-all',
          volumeChanged
            ? 'bg-kpi-ro hover:bg-kpi-ro/90 active:scale-[0.98] text-white'
            : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
          justSaved && 'animate-gauge-confirm',
        )}
        data-testid={`blending-save-${well.id}`}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isBackdated ? `Save reading for ${eventDate}` : 'Save reading'}
      </Button>

      {/* Warning banner */}
      {volume !== '' && blendBelowPrev && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Reading is below the previous value — possible meter rollback or data entry error.
          </span>
        </div>
      )}

      {volume !== '' && !blendBelowPrev && blendHighVol && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
        <AnomalyRemarkBanner
          result={deviationBlend}
          label={well.name}
          unit="m3/day"
          windowDays={14}
          remark={anomalyRemark}
          onRemarkChange={state.setAnomalyRemark}
          escalates={false}
        />
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="blending"
          entityId={well.id}
          plantId={state.plantId}
          onClose={() => setShowHistory(false)}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={isBackdated
          ? `No blending reading for "${well.name}" on ${eventDate} — why?`
          : `No blending reading today for "${well.name}" — why?`}
        description={isBackdated
          ? `This explains the gap on ${eventDate}. If you have the real meter reading for that day instead, enter it above and Save — that takes priority over this note.`
          : 'This explains the gap for today. If a reading comes in later today, it takes priority over this note.'}
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={(category, detail) => saveGapReason(category, detail)}
      />
    </>
  );
}
