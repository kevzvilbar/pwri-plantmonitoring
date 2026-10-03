import React from 'react';
import { Button } from '@/components/ui/button';
import { DosingMobileSummary } from '../DosingMobileSummary';

interface DosingSummarySidebarProps {
  totalMassKg: number;
  totalVolumeL: number;
  freePcs: number;
  cost: number | null;
  unpriced: string[];
  isSubmitting: boolean;
  onClearAll: () => void;
  onSubmit: () => void;
}

export function DosingSummarySidebar({
  totalMassKg,
  totalVolumeL,
  freePcs,
  cost,
  unpriced,
  isSubmitting,
  onClearAll,
  onSubmit,
}: DosingSummarySidebarProps) {
  const numericCost = cost ?? 0;

  return (
    <>
      {/* ── Right Sidebar — sticky on desktop ────────────────────────── */}
      <div className="hidden md:block w-48 shrink-0">
        <div className="rounded-xl bg-primary text-primary-foreground p-3 space-y-3 sticky top-2">
          <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">
            Dosing Summary
          </p>
          <div className="space-y-2.5">
            <DosingMobileSummary
              totalMassKg={totalMassKg}
              totalVolumeL={totalVolumeL}
              freePcs={freePcs}
              cost={numericCost}
            />
            {unpriced.length > 0 && (
              <p className="text-2xs text-amber-200 bg-amber-950/40 p-1.5 rounded border border-amber-400/30">
                ⚠️ No price on file for {unpriced.join(', ')} — cost not counted
              </p>
            )}
          </div>
          <div className="border-t border-primary-foreground/20 pt-2 space-y-2">
            <button
              onClick={onClearAll}
              className="w-full text-xs text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-2 transition-colors"
            >
              Clear All
            </button>
            <Button
              onClick={onSubmit}
              disabled={isSubmitting}
              className="w-full h-8 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0"
            >
              {isSubmitting ? 'Saving...' : 'Save Dosing'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Mobile summary bar ────────────────────────────────────────── */}
      <div className="md:hidden rounded-xl bg-primary text-primary-foreground p-3 space-y-2.5">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">
          Dosing Summary <span className="text-primary-foreground/60 font-normal">(Live)</span>
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <DosingMobileSummary
            totalMassKg={totalMassKg}
            totalVolumeL={totalVolumeL}
            freePcs={freePcs}
            cost={numericCost}
          />
        </div>
        {unpriced.length > 0 && (
          <p className="text-2xs text-amber-200 bg-amber-950/40 p-1.5 rounded border border-amber-400/30">
            ⚠️ No price on file for {unpriced.join(', ')} — cost not counted
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={onClearAll}
            className="h-9 text-xs text-primary-foreground/70 hover:text-primary-foreground border border-primary-foreground/30 rounded-md transition-colors"
          >
            Clear All
          </button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="h-9 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0"
          >
            {isSubmitting ? 'Saving...' : 'Save Dosing'}
          </Button>
        </div>
      </div>
    </>
  );
}

