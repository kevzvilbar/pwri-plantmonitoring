import React, { useState, useRef } from 'react';
import { 
  Check, 
  X, 
  AlertTriangle, 
  ArrowRight, 
  Clock, 
  User, 
  Building2, 
  FileText, 
  ChevronRight, 
  Sparkles,
  Inbox
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface MobileReviewItem {
  id: string;
  entityName: string;
  plantName: string;
  sourceTable: string;
  operatorUsername: string;
  datetimeStr: string;
  originalValue: number | null;
  proposedValue: number | null;
  unit: string;
  reasonText: string;
  flagReason?: string;
  photoUrl?: string;
}

export interface MobileReviewCardStackProps {
  items: MobileReviewItem[];
  onApprove: (item: MobileReviewItem) => Promise<boolean | void>;
  onReject: (item: MobileReviewItem, reason?: string) => Promise<boolean | void>;
  onRefresh?: () => void;
}

export function MobileReviewCardStack({
  items,
  onApprove,
  onReject,
  onRefresh,
}: MobileReviewCardStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const touchStartX = useRef<number | null>(null);

  const activeItem = items[currentIndex];

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX.current;
    setSwipeOffset(diff);
  };

  const handleTouchEnd = () => {
    setSwiping(false);
    if (touchStartX.current === null) return;

    // Threshold of 90px swipe
    if (swipeOffset > 90) {
      void handleApprove();
    } else if (swipeOffset < -90) {
      void handleReject();
    }

    setSwipeOffset(0);
    touchStartX.current = null;
  };

  const handleApprove = async () => {
    if (!activeItem || busy) return;
    setBusy(true);
    try {
      await onApprove(activeItem);
      toast.success(`Approved correction for ${activeItem.entityName}`);
      setCurrentIndex((i) => i + 1);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setBusy(false);
      setSwipeOffset(0);
    }
  };

  const handleReject = async () => {
    if (!activeItem || busy) return;
    setBusy(true);
    try {
      await onReject(activeItem);
      toast.success(`Rejected correction for ${activeItem.entityName}`);
      setCurrentIndex((i) => i + 1);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setBusy(false);
      setSwipeOffset(0);
    }
  };

  if (!activeItem || currentIndex >= items.length) {
    return (
      <Card className="flex flex-col items-center justify-center p-8 text-center space-y-3 bg-muted/20 border-dashed border-2 rounded-3xl min-h-[350px]">
        <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center shadow-inner">
          <Inbox className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">Review Inbox Clear</h3>
          <p className="text-xs text-muted-foreground max-w-xs mt-1">
            All pending reading flags and operator correction requests for your assigned plants have been reviewed.
          </p>
        </div>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs h-9 rounded-xl mt-2">
            Check for New Reviews
          </Button>
        )}
      </Card>
    );
  }

  const remainingCount = items.length - currentIndex;
  const original = activeItem.originalValue;
  const proposed = activeItem.proposedValue;
  const delta = original != null && proposed != null ? proposed - original : null;

  return (
    <div className="space-y-4 max-w-lg mx-auto pb-10 select-none">
      {/* Header Counter */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <Badge className="bg-primary/15 text-primary border-primary/20 font-mono text-2xs font-bold">
            {remainingCount} Pending Decision{remainingCount > 1 ? 's' : ''}
          </Badge>
          <span className="text-3xs text-muted-foreground">Swipe or tap below</span>
        </div>
        <div className="text-3xs font-mono text-muted-foreground font-semibold">
          Card {currentIndex + 1} of {items.length}
        </div>
      </div>

      {/* Swipeable Decision Card */}
      <div
        className="relative transition-transform ease-out"
        style={{
          transform: `translateX(${swipeOffset}px) rotate(${swipeOffset * 0.05}deg)`,
          transitionDuration: swiping ? '0ms' : '200ms',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Visual Swipe Direction Hint Pills */}
        {swipeOffset > 30 && (
          <div className="absolute top-4 left-4 z-30 bg-emerald-600 text-white font-bold text-xs px-3 py-1 rounded-full shadow-lg flex items-center gap-1 animate-pulse">
            <Check className="h-4 w-4" /> APPROVE
          </div>
        )}
        {swipeOffset < -30 && (
          <div className="absolute top-4 right-4 z-30 bg-rose-600 text-white font-bold text-xs px-3 py-1 rounded-full shadow-lg flex items-center gap-1 animate-pulse">
            <X className="h-4 w-4" /> REJECT
          </div>
        )}

        <Card className="p-5 bg-card border-border/80 shadow-md rounded-3xl space-y-4 relative overflow-hidden">
          {/* Top Asset & Plant Banner */}
          <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-3xs font-semibold uppercase tracking-wider">
                  {activeItem.plantName}
                </Badge>
                <span className="text-3xs text-muted-foreground">{activeItem.sourceTable}</span>
              </div>
              <h2 className="text-lg font-bold text-foreground tracking-tight mt-1">
                {activeItem.entityName}
              </h2>
            </div>
            {activeItem.flagReason && (
              <Badge variant="outline" className="text-3xs bg-amber-500/10 text-amber-600 border-amber-500/20 font-semibold">
                {activeItem.flagReason}
              </Badge>
            )}
          </div>

          {/* Value Comparison Block */}
          <div className="grid grid-cols-2 gap-3 p-3.5 bg-muted/40 rounded-2xl border border-border/60">
            <div>
              <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Original Value</div>
              <div className="text-sm font-mono font-bold text-muted-foreground/80 line-through mt-0.5">
                {original != null ? `${original.toLocaleString()} ${activeItem.unit}` : 'None'}
              </div>
            </div>
            <div>
              <div className="text-3xs uppercase font-bold text-primary tracking-wider">Proposed Correction</div>
              <div className="text-base font-mono font-bold text-foreground mt-0.5">
                {proposed != null ? `${proposed.toLocaleString()} ${activeItem.unit}` : '—'}
              </div>
            </div>
            {delta != null && (
              <div className="col-span-2 pt-2 border-t border-border/40 flex items-center justify-between text-2xs">
                <span className="text-muted-foreground font-medium">Net Variance (Delta):</span>
                <span className={cn(
                  'font-mono font-bold',
                  delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                )}>
                  {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()} {activeItem.unit}
                </span>
              </div>
            )}
          </div>

          {/* Reason & Submitter Details */}
          <div className="space-y-2 text-xs">
            <div className="p-3 bg-card border border-border/70 rounded-xl space-y-1">
              <div className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Operator's Rationale</div>
              <div className="text-xs text-foreground italic leading-relaxed">
                "{activeItem.reasonText || 'No specific explanation provided'}"
              </div>
            </div>

            <div className="flex items-center justify-between text-2xs text-muted-foreground px-1 pt-1">
              <div className="flex items-center gap-1.5">
                <User className="h-3 w-3 shrink-0" />
                <span>Submitted by <strong className="text-foreground">{activeItem.operatorUsername}</strong></span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" />
                <span>{activeItem.datetimeStr}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Tactile Action Triggers */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={handleReject}
          className="flex-1 h-13 rounded-2xl border-rose-300 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-bold gap-2 active:scale-95 transition-all"
        >
          <X className="h-5 w-5" />
          <span>Reject / Return</span>
        </Button>

        <Button
          type="button"
          disabled={busy}
          onClick={handleApprove}
          className="flex-1 h-13 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold gap-2 shadow-md active:scale-95 transition-all"
        >
          <Check className="h-5 w-5" strokeWidth={2.5} />
          <span>Approve Correction</span>
        </Button>
      </div>
    </div>
  );
}

