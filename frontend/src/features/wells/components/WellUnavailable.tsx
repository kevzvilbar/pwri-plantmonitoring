/**
 * WellUnavailable — P5-3 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * Shown instead of a permanent "Loading…" when a well URL cannot be resolved:
 * an old bookmark to a deleted well, an id the user's role cannot read, a well
 * that belongs to another plant, or a request that failed.
 */
import { ChevronLeft, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function WellUnavailable({
  kind,
  onBack,
  onRetry,
}: {
  kind: 'not-found' | 'error';
  onBack: () => void;
  onRetry?: () => void;
}) {
  const notFound = kind === 'not-found';
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Wells
      </button>
      <Card role="alert" className="p-6 text-center space-y-2">
        <AlertCircle className="h-5 w-5 mx-auto text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">
          {notFound ? 'Well not found' : "Couldn't load this well"}
        </p>
        <p className="text-xs text-muted-foreground">
          {notFound
            ? 'It may have been deleted, or it is not part of this plant.'
            : 'Check your connection and try again.'}
        </p>
        {!notFound && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
        )}
      </Card>
    </div>
  );
}
