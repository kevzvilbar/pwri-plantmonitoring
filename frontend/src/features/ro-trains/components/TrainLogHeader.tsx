/**
 * frontend/src/pages/ro-trains/components/TrainLogHeader.tsx
 *
 * Header bar for the TrainLogModal: title, description, and Import/Export actions.
 */
import { BarChart2, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TrainLogHeaderProps {
  trainLabel: string;
  logTab: 'ro' | 'pretreat';
  isManager: boolean;
  setShowImportRO: (v: boolean) => void;
  setShowImportPretreat: (v: boolean) => void;
  exportCSV: () => void;
}

export function TrainLogHeader({
  trainLabel, logTab, isManager, setShowImportRO, setShowImportPretreat, exportCSV,
}: TrainLogHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
      <div className="min-w-0">
        <div className="text-base font-semibold flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">Operator Log — {trainLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {logTab === 'ro'
            ? `All RO train readings · ${isManager ? 'Click orange checkbox to flag meter replacement' : 'Managers can flag meter replacements'}`
            : 'Pre-Treatment records — AFM/MMF, Booster Pumps, Cart./Bag Housings, HPP'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 mr-8">
        {logTab === 'ro' && (
          <Button
            size="sm" variant="outline"
            className="h-7 px-2.5 text-xs gap-1 text-primary border-primary hover:bg-primary-soft"
            onClick={() => setShowImportRO(true)}
          >
            <Upload className="h-3 w-3" /><span className="hidden sm:inline">Import RO CSV</span>
          </Button>
        )}
        {logTab === 'pretreat' && (
          <Button
            size="sm" variant="outline"
            className="h-7 px-2.5 text-xs gap-1 text-primary border-primary hover:bg-primary-soft"
            onClick={() => setShowImportPretreat(true)}
          >
            <Upload className="h-3 w-3" /><span className="hidden sm:inline">Import Pre-Treatment CSV</span>
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={exportCSV}>
          <Download className="h-3 w-3" /><span className="hidden sm:inline">Export CSV</span>
        </Button>
      </div>
    </div>
  );
}
