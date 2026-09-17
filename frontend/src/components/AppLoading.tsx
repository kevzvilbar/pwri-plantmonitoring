import { useIsMobile } from '@/hooks/use-mobile';
import { Logomark } from '@/components/icons/Logomark';
import { cn } from '@/lib/utils';

/** Shared route/auth fallback. Desktop keeps its existing text-only loading UI. */
export function AppLoading({ className }: { className?: string }) {
  const isMobile = useIsMobile();

  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center', className)}>
      {isMobile ? (
        <div className="flex flex-col items-center gap-3">
          <Logomark size={72} alt="PWRI Monitoring" className="rounded-2xl shadow-elev" />
          <span className="text-xs text-muted-foreground">Loading…</span>
        </div>
      ) : 'Loading…'}
    </div>
  );
}
