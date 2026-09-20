import { ActivePlantChip } from '@/components/ActivePlantChip';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';

interface PowerFormHeaderProps {
  plantId: string;
  setImportOpen: (v: boolean) => void;
  isAdmin: boolean;
  isManager: boolean;
  isDataAnalyst: boolean;
  prevRow: any;
}

export function PowerFormHeader({
  plantId,
  setImportOpen,
  isAdmin,
  isManager,
  isDataAnalyst,
  prevRow,
}: PowerFormHeaderProps) {
  return (
    <div className="flex items-end gap-3">
      <ActivePlantChip className="flex-1" />
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
