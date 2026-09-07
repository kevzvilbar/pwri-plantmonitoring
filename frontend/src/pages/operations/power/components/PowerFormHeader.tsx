import { useCallback } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MessageCircleOff, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PowerFormHeaderProps {
  plantId: string;
  handlePlantChange: (v: string) => void;
  gapReasonToday: { reason_category: string; reason_detail: string | null } | null | undefined;
  setGapDialogOpen: () => void;
  setImportOpen: (v: boolean) => void;
  isAdmin: boolean;
  isManager: boolean;
  isDataAnalyst: boolean;
  prevRow: any;
}

export function PowerFormHeader({
  plantId,
  handlePlantChange,
  gapReasonToday,
  setGapDialogOpen,
  setImportOpen,
  isAdmin,
  isManager,
  isDataAnalyst,
  prevRow,
}: PowerFormHeaderProps) {
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="powersection-plant" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
        <PlantSelector value={plantId} onChange={handlePlantChange} id="powersection-plant" />
      </div>
      {plantId && (
        <Button
          size="sm"
          variant="outline"
          className={cn(
            'shrink-0 gap-1.5 h-10 border-border/80 text-muted-foreground hover:text-foreground',
            gapReasonToday && 'border-warn/50 text-warn bg-warn-soft/20',
          )}
          onClick={setGapDialogOpen}
          data-testid="power-gap-reason-btn"
          title={gapReasonToday ? `Reason logged: ${gapReasonToday.reason_category}` : 'No power reading today? Log reason'}
        >
          <MessageCircleOff className="h-3.5 w-3.5" />
          {gapReasonToday ? 'Reason logged' : 'No reading today?'}
        </Button>
      )}
      {prevRow?.is_estimated && (
        <span
          className="inline-flex items-center gap-1 text-2xs font-semibold px-2.5 py-1 rounded-full bg-warn-soft text-warn border border-warn/40"
          title="Latest power reading is system-generated / backfilled — entering a reading overrides it with verified human data."
        >
          Estimated
        </span>
      )}
      {(isAdmin || isManager || isDataAnalyst) && plantId && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 h-10 border-primary/60 text-primary hover:bg-primary-soft hover:border-primary/90"
          onClick={() => setImportOpen(true)}
          data-testid="import-power-readings-btn"
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      )}
    </div>
  );
}
