import { useEffect, useRef, useState, useCallback } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number; // Distance in px to trigger refresh (default 70)
  maxPull?: number;   // Maximum pull distance allowed (default 120)
  resistance?: number;// Elastic friction factor (default 0.45)
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  maxPull = 120,
  resistance = 0.45,
  disabled = false,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isThresholdCrossed, setIsThresholdCrossed] = useState(false);

  const startY = useRef<number | null>(null);
  const currentY = useRef<number | null>(null);
  const isPulling = useRef(false);
  const hasTriggeredHaptic = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    // Only allow pull-to-refresh if window is scrolled to top (scrollY <= 0)
    if (window.scrollY > 5) {
      startY.current = null;
      return;
    }

    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    isPulling.current = false;
    hasTriggeredHaptic.current = false;
  }, [disabled, isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (startY.current === null || disabled || isRefreshing) return;

    // If user scrolled down inside the page, cancel gesture
    if (window.scrollY > 5) {
      startY.current = null;
      setPullDistance(0);
      return;
    }

    currentY.current = e.touches[0].clientY;
    const dy = currentY.current - startY.current;

    if (dy > 0) {
      // Elastic resistance: friction increases the further user pulls
      const friction = Math.max(0.2, resistance * (1 - dy / 400));
      const distance = Math.min(maxPull, dy * friction);

      setPullDistance(distance);
      isPulling.current = true;

      const crossed = distance >= threshold;
      setIsThresholdCrossed(crossed);

      // Trigger haptic bump precisely when threshold is crossed
      if (crossed && !hasTriggeredHaptic.current) {
        hasTriggeredHaptic.current = true;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(12);
          } catch {
            /* ignore unsupported haptics */
          }
        }
      } else if (!crossed && hasTriggeredHaptic.current) {
        hasTriggeredHaptic.current = false;
      }
    } else {
      setPullDistance(0);
      setIsThresholdCrossed(false);
    }
  }, [disabled, isRefreshing, maxPull, resistance, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || startY.current === null || disabled) {
      startY.current = null;
      setPullDistance(0);
      setIsThresholdCrossed(false);
      return;
    }

    startY.current = null;
    isPulling.current = false;

    if (isThresholdCrossed && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.75); // Settle slightly below threshold during loading

      try {
        await Promise.resolve(onRefresh());
      } catch (err) {
        console.error('Pull-to-refresh failed:', err);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
        setIsThresholdCrossed(false);
        hasTriggeredHaptic.current = false;
      }
    } else {
      setPullDistance(0);
      setIsThresholdCrossed(false);
      hasTriggeredHaptic.current = false;
    }
  }, [disabled, isRefreshing, isThresholdCrossed, onRefresh, threshold]);

  useEffect(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    pullDistance,
    isRefreshing,
    isThresholdCrossed,
    progress: Math.min(1, pullDistance / threshold),
  };
}

