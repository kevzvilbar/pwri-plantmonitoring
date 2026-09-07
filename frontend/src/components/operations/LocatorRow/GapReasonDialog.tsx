import { useState } from 'react';
import { ReasonDialog } from '@/components/ReasonDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { reasonCategoryLabel } from '@/lib/reasonCodes';

interface GapReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locatorName: string;
  locatorId: string;
  plantId: string;
  userId: string | undefined;
  gapReason: any;
  onGapReasonSaved?: () => void;
}

export function GapReasonDialog({
  open, onOpenChange, locatorName, locatorId, plantId, userId, gapReason, onGapReasonSaved,
}: GapReasonDialogProps) {
  const [gapSaving, setGapSaving] = useState(false);

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`No reading today for "${locatorName}" — why?`}
      description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
      confirmLabel="Log reason"
      busy={gapSaving}
      onConfirm={async (category, detail) => {
        setGapSaving(true);
        const todayDateStr = format(new Date(), 'yyyy-MM-dd');
        const { error } = await (supabase.from('reading_gap_reasons' as any).upsert(
          [{
            entity_type: 'locator', entity_id: locatorId, plant_id: plantId,
            gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
            logged_by: userId ?? null,
          }] as any,
          { onConflict: 'entity_type,entity_id,gap_date' },
        ) as any);
        setGapSaving(false);
        if (error) { toast.error(friendlyError(error)); return; }
        toast.success(`${locatorName}: reason logged`);
        onOpenChange(false);
        onGapReasonSaved?.();
      }}
    />
  );
}
