import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { fmtIsoDate, fmtTime } from '@/lib/format';
import {
  CheckCircle2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { CorrectionRow } from '@/lib/regressionCorrection';
import { RegressionResult } from '../shared';

interface RegressionDetailCorrectionsTableProps {
  outliers: CorrectionRow[];
  canEdit: boolean;
  result: RegressionResult;
  individuallyApplied: Set<string>;
  applyingOne: string | null;
  onApplyOne: (correction: CorrectionRow) => void;
}

export function RegressionDetailCorrectionsTable({
  outliers,
  canEdit,
  result,
  individuallyApplied,
  applyingOne,
  onApplyOne,
}: RegressionDetailCorrectionsTableProps) {
  const sorted = [...outliers].sort((a, b) => b.reading_datetime.localeCompare(a.reading_datetime));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Original</TableHead>
            <TableHead className="text-right">Corrected</TableHead>
            <TableHead className="text-right">Z-score</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Note</TableHead>
            {canEdit && result.status !== 'retracted' && (
              <TableHead className="text-center w-24">Apply</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(c => {
            const isReset = c.note?.includes('reset anomaly');
            const isApplied = individuallyApplied.has(c.reading_id) || result.status === 'applied';
            const isApplying = applyingOne === c.reading_id;
            return (
              <TableRow key={c.reading_id} className={cn('text-xs', isReset && 'bg-kpi-solar/60')}>
                <TableCell className="font-mono">{fmtIsoDate(c.reading_datetime)} {fmtTime(c.reading_datetime)}</TableCell>
                <TableCell className="text-right font-mono text-danger">
                  {c.original_value?.toFixed(2) ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-primary">
                  {c.corrected_value?.toFixed(2) ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {c.z_score != null ? (
                    <span className={Math.abs(c.z_score) > 3 ? 'text-danger font-bold' : ''}>
                      {c.z_score.toFixed(2)}
                    </span>
                  ) : <span className="text-muted-foreground text-2xs">n/a</span>}
                </TableCell>
                <TableCell>
                  {isReset ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border bg-kpi-solar/15 text-kpi-solar border-kpi-solar">
                      <Zap className="h-2.5 w-2.5" /> Reset
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border bg-warn-soft text-warn border-warn">
                      OLS
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate" title={c.note}>{c.note}</TableCell>
                {canEdit && result.status !== 'retracted' && (
                  <TableCell className="text-center">
                    {isApplied ? (
                      <span className="inline-flex items-center gap-1 text-2xs font-medium text-primary">
                        <CheckCircle2 className="h-3 w-3" /> Applied
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-2xs px-2 border-primary text-primary hover:bg-primary-soft"
                        disabled={isApplying || !!applyingOne}
                        onClick={() => onApplyOne(c)}
                      >
                        {isApplying ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Apply'}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {outliers.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit && result.status !== 'retracted' ? 7 : 6} className="text-center text-xs text-muted-foreground py-4">
                No anomalies detected in this run.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
