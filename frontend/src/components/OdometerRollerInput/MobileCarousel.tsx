import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function MobileCarousel({
  items,
  renderItem,
  headerLeft,
  isMobile,
}: {
  items: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  headerLeft?: React.ReactNode;
  isMobile: boolean;
}) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => { setCurrent(0); }, [items.length]);

  const prev = () => setCurrent(i => Math.max(0, i - 1));
  const next = () => setCurrent(i => Math.min(items.length - 1, i + 1));

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - (touchStartY.current ?? 0));
    if (Math.abs(dx) > 45 && Math.abs(dx) > dy * 1.5) {
      if (dx < 0) next(); else prev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (!isMobile) {
    return <>{items.map((item, i) => renderItem(item, i))}</>;
  }

  if (!items.length) return null;

  const clampedIdx = Math.min(current, items.length - 1);

  return (
    <div>
      <div className="flex items-center justify-between px-3.5 py-2 border-b bg-muted/20">
        {headerLeft ?? (
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <span>Item</span>
            <span className="text-3xs text-muted-foreground font-normal">({clampedIdx + 1} of {items.length})</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 bg-muted/60 p-0.5 rounded-full border border-border/50">
          <button
            onClick={prev}
            disabled={clampedIdx === 0}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-foreground hover:bg-card disabled:opacity-30 disabled:cursor-default transition-colors shadow-2xs"
            aria-label="Previous"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-bold text-foreground font-mono-num px-2 text-center min-w-[44px]">
            {clampedIdx + 1} / {items.length}
          </span>
          <button
            onClick={next}
            disabled={clampedIdx === items.length - 1}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-foreground hover:bg-card disabled:opacity-30 disabled:cursor-default transition-colors shadow-2xs"
            aria-label="Next"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {renderItem(items[clampedIdx], clampedIdx)}
      </div>
    </div>
  );
}
