import { useIsMobile } from '@/hooks/use-mobile';
import { PWRIAnimatedLogo } from '@/components/icons/PWRIAnimatedLogo';
import { cn } from '@/lib/utils';

/** Shared route/auth fallback. Desktop keeps its existing text-only loading UI. */
export function AppLoading({ className }: { className?: string }) {
  const isMobile = useIsMobile();

  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center', className)}>
      {isMobile ? (
        <div className="flex flex-col items-center gap-3">
          <PWRIAnimatedLogo size={180} showText={true} data-motion="loading" />
          <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>
        </div>
      ) : 'Loading…'}
    </div>
  );
}
