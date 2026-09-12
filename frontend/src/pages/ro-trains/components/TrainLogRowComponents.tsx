/**
 * frontend/src/pages/ro-trains/components/TrainLogRowComponents.tsx
 *
 * Shared row components used by both the RO and Pre-Treatment tables.
 * Extracted from TrainLogModal.tsx to break the monolith and allow the
 * table sub-components to import them without circular dependencies.
 */
import { type Ref } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, PowerOff, Wrench, AlertTriangle, Undo2 } from 'lucide-react';
import {
  type StatusSegment,
  formatSegmentDuration,
} from '@/lib/trainStatusTimeline';
import {
  type FlaggedGap,
  type GapReason,
} from '@/lib/hourlyGapDetection';
import {
  type OfflineSpan,
  formatSpanDuration,
} from '@/lib/downtimeRowMerger';
import { reasonCategoryLabel } from '@/lib/reasonCodes';

export function TrainStatusBannerRow({ segment, onReportRunning, reporting }: {
  segment: StatusSegment;
  /** Shown only for an OPEN auto-flagged Offline segment: files a "Report Running — failed to encode" exemption. */
  onReportRunning?: (segment: StatusSegment) => void;
  reporting?: boolean;
}) {
  const isMaintenance = segment.status === 'Maintenance';
  const Icon = isMaintenance ? Wrench : PowerOff;
  const label = isMaintenance ? 'Maintenance' : 'Offline';
  const fmtPoint = (iso: string) => format(new Date(iso), 'MMM d, HH:mm');
  // Open OR closed: a closed segment can still be a false positive worth
  // correcting for the record (downtime reports count it either way) — see
  // preserveAutoFlagReason in trainStatusTimeline.ts for why the reason
  // marker now survives the ordinary close-out flow instead of only ever
  // surviving on the still-open segment.
  const canReportRunning = !!onReportRunning
    && segment.status === 'Offline'
    && !!segment.reason?.startsWith('Auto-flagged');
  return (
    <tr className={cn('border-t', isMaintenance ? 'bg-warn-soft/60' : 'bg-danger-soft/60')}>
      <td colSpan={30} className="px-3 py-2">
        <div className={cn('flex items-center gap-2 text-xs font-medium flex-wrap', isMaintenance ? 'text-warn' : 'text-danger')}>
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            {label} {fmtPoint(segment.startAt)} → {segment.endAt ? fmtPoint(segment.endAt) : 'ongoing'}
          </span>
          <span className="text-muted-foreground font-normal whitespace-nowrap">
            · {formatSegmentDuration(segment.startAt, segment.endAt)}
          </span>
          {segment.reason && (
            <span className="text-muted-foreground font-normal truncate max-w-[320px]" title={segment.reason}>
              · {segment.reason}
            </span>
          )}
          {segment.inferredEnd && (
            <span
              className="text-muted-foreground font-normal whitespace-nowrap"
              title="No Back Online At was ever submitted for this train — this end time is inferred from the next real reading on record, not a confirmed closure."
            >
              · closed by later reading, not confirmed
            </span>
          )}
          {segment.hasConflictingReadings && (
            <span
              className="inline-flex items-center gap-1 text-warn font-normal whitespace-nowrap"
              title="One or more readings are logged with timestamps inside this window, despite this segment having a confirmed close event. Check train_status_log for a stray or mistimed entry — this banner's range is shown as recorded, not adjusted."
            >
              <AlertTriangle className="h-3 w-3" />
              readings exist in this window — check status log
            </span>
          )}
          {canReportRunning && (
            <button
              type="button"
              disabled={reporting}
              onClick={() => onReportRunning?.(segment)}
              className="ml-1 inline-flex items-center gap-1 rounded border border-current/30 px-1.5 py-0.5 font-normal hover:bg-current/10 disabled:opacity-50 whitespace-nowrap"
              title={
                segment.endAt === null
                  ? "The train was actually running the whole time — readings just weren't encoded (operator error or system outage). Files a retroactive uptime attestation, removes this flag, and puts the train back to Running."
                  : "The train was actually running the whole time — readings just weren't encoded (operator error or system outage). Files a retroactive uptime attestation and corrects this closed period in the record, without changing the train's current status."
              }
            >
              <Undo2 className="h-3 w-3" />
              {reporting ? 'reporting…' : 'was actually running? report'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function GapBadgeRow({ gap, existingReason, onClick, highlighted, rowRef }: {
  gap: FlaggedGap; existingReason: GapReason | null; onClick: () => void;
  highlighted?: boolean; rowRef?: Ref<HTMLTableRowElement>;
}) {
  const label = `${gap.missedHours} hr${gap.missedHours === 1 ? '' : 's'} missing`;
  const timeRange = `${format(new Date(gap.gapStartAt), 'HH:mm')}–${format(new Date(new Date(gap.gapEndAt).getTime() - 1), 'HH:mm')}`;
  return (
    <tr
      ref={rowRef}
      className={cn(
        'border-t transition-colors',
        highlighted ? 'bg-danger-soft ring-1 ring-inset ring-danger' : existingReason ? 'bg-muted/40' : 'bg-warn-soft/60',
      )}
    >
      <td colSpan={30} className="px-3 py-2">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'flex items-center gap-2 text-xs font-medium hover:underline',
            existingReason ? 'text-muted-foreground' : 'text-warn',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{label} ({timeRange})</span>
          {existingReason ? (
            <span className="font-normal">
              — {reasonCategoryLabel(existingReason.reasonCategory)}
              {existingReason.reasonDetail ? `: ${existingReason.reasonDetail}` : ''}
            </span>
          ) : (
            <span className="font-normal">— log why</span>
          )}
        </button>
      </td>
    </tr>
  );
}

export function OfflineSpanRow({
  span,
  isExpanded,
  onToggleExpand,
  children,
}: {
  span: OfflineSpan;
  isExpanded: boolean;
  onToggleExpand: () => void;
  children?: React.ReactNode;
}) {
  const fmtPoint = (iso: string) => format(new Date(iso), 'MMM d, HH:mm');
  const sameDay = format(new Date(span.startAt), 'MMM d') === format(new Date(span.endAt), 'MMM d');
  const dateRangeDisplay = sameDay
    ? `${format(new Date(span.startAt), 'MMM d, yyyy')} · ${format(new Date(span.startAt), 'HH:mm')} → ${format(new Date(span.endAt), 'HH:mm')}`
    : `${fmtPoint(span.startAt)} → ${fmtPoint(span.endAt)}`;

  return (
    <>
      <tr className="border-t bg-muted/40 hover:bg-muted/50 transition-colors">
        <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
          <div className="text-foreground font-semibold flex items-center gap-1.5">
            <PowerOff className="h-3.5 w-3.5 text-danger shrink-0" />
            <span>{dateRangeDisplay}</span>
          </div>
          <div className="text-muted-foreground text-3xs mt-0.5 flex items-center gap-1 font-sans">
            <span>{formatSpanDuration(span.durationMs)}</span>
            <span>·</span>
            <span className="font-semibold text-foreground/80">{span.rows.length} check-ins</span>
          </div>
        </td>

        <td className="px-2 py-2">
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1.5 overflow-hidden">
              {span.operators.map((op) => (
                <span
                  key={op.id}
                  title={op.name}
                  className="h-5 w-5 rounded-full bg-danger-soft text-danger border border-background text-3xs font-bold inline-flex items-center justify-center shrink-0"
                >
                  {op.initials}
                </span>
              ))}
            </div>
            <span className="text-xs font-medium truncate max-w-[100px]" title={span.operators.map((o) => o.name).join(', ')}>
              {span.operators.map((o) => o.name).join(', ')}
            </span>
          </div>
        </td>

        <td colSpan={30} className="px-3 py-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded text-3xs font-bold uppercase tracking-wider bg-danger-soft text-danger border border-danger/30 shrink-0">
                Offline Span
              </span>
              <span className="text-xs text-foreground font-medium truncate" title={span.combinedReasonText}>
                {span.combinedReasonText}
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggleExpand}
              className="h-6 text-xs px-2 py-0 gap-1 text-muted-foreground hover:text-foreground border-border/80"
            >
              {isExpanded ? (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>Hide {span.rows.length} rows</span>
                </>
              ) : (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span>View {span.rows.length} records</span>
                </>
              )}
            </Button>
          </div>
        </td>
      </tr>

      {isExpanded && children}
    </>
  );
}
