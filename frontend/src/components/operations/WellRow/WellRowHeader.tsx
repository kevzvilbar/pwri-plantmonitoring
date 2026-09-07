import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusPill } from '@/components/StatusPill';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { CalendarClock, MessageCircleOff, Pencil, X, History, ArrowUpRight, Zap } from 'lucide-react';
import { fmtNum, lastReadingFreshness } from '@/lib/format';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { cn } from '@/lib/utils';
import { WELL_MAX_READINGS_PER_DAY } from '@/pages/operations/shared';

interface WellRowHeaderProps {
  well: any;
  plantId: string;
  todayCount: number;
  atLimit: boolean;
  customDt: string;
  onCustomDtChange: (v: string) => void;
  dtInputRef: React.RefObject<HTMLInputElement>;
  editingId: string | null;
  lastToday: any;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onShowHistory: () => void;
  isManagerOrAdmin: boolean;
  isBlending: boolean;
  isInSharedPowerGroup: boolean;
  gapReason: any | null | undefined;
  onGapReasonClick: () => void;
  freshDt?: string | null;
  navigate: (to: string) => void;
  pulsing?: boolean;
}

export function WellRowHeader({
  well, plantId, todayCount, atLimit, customDt, onCustomDtChange, dtInputRef,
  editingId, lastToday, onStartEdit, onCancelEdit, onShowHistory, isManagerOrAdmin,
  isBlending, isInSharedPowerGroup, gapReason, onGapReasonClick, freshDt, navigate, pulsing,
}: WellRowHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3 bg-muted/20 border-b border-border/60">
      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
        <span className="text-sm font-bold text-foreground break-words">{well.name}</span>
        <MetaStrip
          primary={
            (() => {
              const fresh = lastReadingFreshness(freshDt);
              return (
                <StatusPill tone={fresh.tone}>
                  <CalendarClock className="h-2.5 w-2.5" />
                  {fresh.label}
                </StatusPill>
              );
            })()
          }
          alerts={[
            todayCount === 0 && !editingId && {
              tone: 'warn',
              icon: MessageCircleOff,
              label: gapReason ? reasonCategoryLabel(gapReason.reason_category) : 'Log gap reason',
              onClick: onGapReasonClick,
              testId: `well-gap-reason-btn-${well.id}`,
            },
            lastToday?.is_estimated && {
              tone: 'warn',
              label: 'Estimated',
              title: 'Auto-backfilled reading — no manual operator entry on file.',
            },
            editingId && {
              tone: 'primary',
              label: 'Editing',
            },
            isBlending && {
              tone: 'accent',
              label: 'Blending',
            },
            well.has_power_meter && isInSharedPowerGroup && {
              tone: 'warn',
              icon: Zap,
              label: 'Shared Power',
            },
          ].filter(Boolean)}
          overflow={[
            {
              icon: ArrowUpRight,
              label: 'Plant detail',
              onClick: () => navigate(`/plants/${plantId}?tab=wells&highlight=${well.id}`),
            },
          ].filter(Boolean)}
          maxVisible={4}
        />
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
        <span className={cn('text-2xs font-mono-num font-semibold px-2 py-0.5 rounded-full border', atLimit ? 'text-warn bg-warn-soft border-warn/40' : 'text-muted-foreground bg-muted/60 border-border/50')}>
          {todayCount}/{WELL_MAX_READINGS_PER_DAY} today
        </span>

        <label className="cursor-pointer relative shrink-0">
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
            {new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => onCustomDtChange(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
        </label>

        <ControlCluster
          actions={[
            lastToday && !editingId && {
              icon: Pencil,
              title: `Edit last today reading (${fmtNum(lastToday.current_reading)})`,
              onClick: onStartEdit,
            },
            editingId && {
              icon: X,
              title: 'Cancel edit',
              variant: 'danger',
              onClick: onCancelEdit,
            },
            isManagerOrAdmin && {
              icon: History,
              title: 'View reading history',
              onClick: onShowHistory,
            },
          ]}
        />
      </div>
    </div>
  );
}
