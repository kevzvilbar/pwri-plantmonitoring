import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { Input } from '@/components/ui/input';
import { MessageCircleOff, CalendarClock, History } from 'lucide-react';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import type { BlendingRowLogic } from './useBlendingRow';

interface BlendingRowHeaderProps {
  state: BlendingRowLogic;
}

export function BlendingRowHeader({ state }: BlendingRowHeaderProps) {
  const { well, hasReadingForSelectedDate, justSaved, isBackdated, backdatedContextLoading, effectiveGapReason, eventDate, setGapDialogOpen, chipState, isEstimatedForDate, isMobile, showHistory, setShowHistory, customDt, setCustomDt, dtInputRef } = state;

  return (
    <div className="flex items-start justify-between gap-2 min-w-0">
      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
        <span className="text-sm font-bold text-foreground break-words">{well.name}</span>
        <MetaStrip
          primary={
            <Badge className="bg-kpi-ro/20 text-kpi-ro border-kpi-ro/40 hover:bg-kpi-ro/20 font-semibold text-2xs rounded-full">
              Blending
            </Badge>
          }
          alerts={[
            hasReadingForSelectedDate === false && !justSaved && !(isBackdated && backdatedContextLoading) && {
              tone: 'warn',
              icon: MessageCircleOff,
              label: effectiveGapReason ? reasonCategoryLabel(effectiveGapReason.reason_category) : (isBackdated ? `Log gap (${eventDate})` : 'Log gap reason'),
              onClick: () => setGapDialogOpen(true),
              testId: `blending-gap-reason-btn-${well.id}`,
            },
            chipState === 'estimated' && {
              tone: 'warn',
              label: 'Estimated',
              title: 'Auto-backfilled reading — no manual operator entry on file.',
            },
            chipState === 'logged' && {
              tone: 'accent',
              label: isBackdated ? `Logged (${eventDate})` : 'Logged today',
            },
            chipState === 'ready' && {
              tone: 'default',
              label: 'Ready to save',
            },
            chipState === 'pending' && !effectiveGapReason && {
              tone: 'warn',
              label: 'Not logged',
            },
          ].filter(Boolean)}
          overflow={[]}
          maxVisible={4}
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ControlCluster
          actions={[
            {
              icon: History,
              title: 'View blending history',
              onClick: () => setShowHistory(true),
            },
          ]}
        />
        <label className="cursor-pointer relative">
          <span
            className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-full px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/80 hover:text-foreground transition-colors"
            onClick={(e) => {
              e.preventDefault();
              const el = dtInputRef.current;
              if (!el) return;
              if (typeof el.showPicker === 'function') {
                try { el.showPicker(); } catch { el.focus(); }
              } else {
                el.focus();
              }
            }}
          >
            {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <Input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
        </label>
      </div>
    </div>
  );
}
