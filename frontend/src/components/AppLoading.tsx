import { useIsMobile } from '@/hooks/use-mobile';
import { MobileLogomark } from '@/components/icons/MobileLogomark';
import { cn } from '@/lib/utils';

/** Shared route/auth fallback. Desktop keeps its existing text-only loading UI. */
export function AppLoading({ className }: { className?: string }) {
  const isMobile = useIsMobile();

  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center', className)}>
      {isMobile ? (
        <div className="flex flex-col items-center gap-4">
          <MobileLogomark size={96} motion="loading" alt="" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : 'Loading…'}
    </div>
  );
}
