import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { RegressionDetail } from './RegressionDetail';
import { RegressionResult } from './shared';

interface RegressionResultsPanelProps {
  resultsError: boolean;
  regressionResults: RegressionResult[];
  canEdit: boolean;
  onRefresh: () => void;
}

export function RegressionResultsPanel({
  resultsError,
  regressionResults,
  canEdit,
  onRefresh,
}: RegressionResultsPanelProps) {
  const qc = useQueryClient();

  return (
    <Card className="xl:col-span-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Regression Results
          <Badge variant="outline" className="text-2xs ml-1">corrected_value + notes</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Each run shows outlier readings, corrected values (OLS projection), and Z-scores.
          {canEdit && ' Apply to write corrections; Retract to undo.'}
        </p>
      </CardHeader>
      <CardContent className="px-3 pb-4 space-y-3">
        {resultsError && (
          <div className="flex flex-col gap-1.5 rounded border border-warn bg-warn-soft px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2 font-medium text-warn">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Regression results table not found
            </div>
            <p className="text-warn leading-relaxed">
              The <code className="font-mono bg-warn-soft px-1 rounded">regression_results</code> and{' '}
              <code className="font-mono bg-warn-soft px-1 rounded">raw_edit_log</code> tables
              have not been created in Supabase yet. Run the migration to fix this:
            </p>
            <p className="text-warn font-mono text-2xs bg-warn-soft px-2 py-1 rounded">
              supabase/migrations/20260515_supabase_only_and_data_analysis.sql
            </p>
            <p className="text-warn">
              Go to <strong>Supabase Dashboard → SQL Editor</strong> and run the migration file above.
            </p>
          </div>
        )}
        {!resultsError && regressionResults.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {canEdit
              ? 'No regression runs yet. Select a column and click "Run Regression".'
              : 'No regression runs found for this selection.'}
          </div>
        )}
        {regressionResults.map(r => (
          <RegressionDetail
            key={r.result_id}
            result={r}
            canEdit={canEdit}
            onRefresh={() => { onRefresh(); qc.invalidateQueries({ queryKey: ['raw-readings'] }); }}
          />
        ))}
      </CardContent>
    </Card>
  );
}
