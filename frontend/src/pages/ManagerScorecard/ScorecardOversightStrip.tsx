import { AppraisalBadge } from '@/components/AppraisalBadge';
import { Button } from '@/components/ui/button';
import { Award, UserCheck, FileDown, RefreshCw, Loader2 } from 'lucide-react';
import { APPRAISAL_TIERS } from '@/lib/appraisal';
import { cn } from '@/lib/utils';
import type { AppraisalTier } from '@/lib/appraisal';

interface ScorecardOversightStripProps {
  fleetOversightScore: number;
  fleetTier: AppraisalTier;
  onExportCsv: () => void;
  isFetching: boolean;
  onRefresh: () => void;
}

export function ScorecardOversightStrip({
  fleetOversightScore, fleetTier, onExportCsv, isFetching, onRefresh,
}: ScorecardOversightStripProps) {
  return (
    <div className="p-4 rounded-xl border border-border/80 bg-card shadow-xs space-y-3.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <UserCheck className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-bold text-foreground tracking-tight">Management Oversight Index</h2>
              <AppraisalBadge
                score={fleetOversightScore}
                tier={fleetTier}
                size="md"
                label="Fleet Rating"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Evaluates telemetry completeness, operator error rates, and correction approval velocity across all facilities.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs gap-1.5 font-semibold bg-background border-border/80 hover:bg-muted"
            onClick={onExportCsv}
            title="Download full manager oversight evaluation matrix in CSV"
          >
            <FileDown className="h-3.5 w-3.5 text-primary" />
            <span>Export CSV</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            className="h-8 px-3 text-xs gap-1.5 bg-background border-border/80 hover:bg-muted font-medium"
            onClick={onRefresh}
          >
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border/40 text-xs font-sans">
        <span className="text-2xs uppercase font-bold text-muted-foreground tracking-wider mr-1">Appraisal Scale:</span>
        {APPRAISAL_TIERS.map((tier) => (
          <span
            key={tier.id}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold select-none',
              tier.badge
            )}
            title={`${tier.tier} (≥${tier.minScore}%) — ${tier.description}`}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
            <span>{tier.shortLabel}</span>
            <span className="text-2xs opacity-75 font-mono-num font-normal">(≥{tier.minScore}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
