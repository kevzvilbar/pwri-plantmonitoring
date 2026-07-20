import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DraftBannerProps {
  /** Called when the user clicks "Discard" */
  onDiscard: () => void;
}

/**
 * Show this at the top of a form whenever `hasDraft` is true.
 * The banner tells the user their previous input was restored and lets
 * them wipe it cleanly via the Discard button.
 *
 * Example:
 *   {hasDraft && <DraftBanner onDiscard={discardDraft} />}
 */
export function DraftBanner({ onDiscard }: DraftBannerProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
      <History className="h-3.5 w-3.5 shrink-0" />
      <p className="flex-1 text-xs leading-snug">
        <span className="font-semibold">Draft restored</span> — you have unsaved changes from a previous session.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[11px] text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900 shrink-0"
        onClick={onDiscard}
      >
        Discard
      </Button>
    </div>
  );
}
