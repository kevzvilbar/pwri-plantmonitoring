import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InstrumentBanner } from '@/components/InstrumentBanner';

interface DraftBannerProps {
  /** Called when the user clicks "Discard" */
  onDiscard: () => void;
}

export function DraftBanner({ onDiscard }: DraftBannerProps) {
  return (
    <InstrumentBanner
      tone="warn"
      icon={History}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs border-warn/40 text-warn hover:bg-warn-soft/20"
          onClick={onDiscard}
        >
          Discard
        </Button>
      }
    >
      <span className="font-semibold text-warn">Draft Restored:</span> You have unsaved changes from a previous session.
    </InstrumentBanner>
  );
}
