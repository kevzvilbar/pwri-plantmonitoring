import { BarChart2 } from 'lucide-react';
import { format } from 'date-fns';

export function TrendChartStatusOverlay({
  queryError, isFetching, chartData, entityRows, phActiveData, metric,
  startKey, retryFailedQueries,
}: {
  queryError: Error | null;
  isFetching: boolean;
  chartData: any[];
  entityRows: any[];
  phActiveData: any[];
  metric: string;
  startKey: string;
  retryFailedQueries: () => void;
}) {
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const isFutureRange = startKey > todayIso;
  const isEmpty = chartData.length === 0 && entityRows.length === 0 && phActiveData.length === 0 && metric !== 'kwh';

  return (
    <>
      {queryError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="rounded-md border border-danger bg-danger-soft/95 px-3 py-2 text-xs text-danger shadow-sm pointer-events-auto max-w-md text-center">
            <div className="font-semibold mb-0.5">Couldn't load trend data</div>
            <div className="text-xs opacity-80">{queryError.message}</div>
            <button
              type="button"
              onClick={retryFailedQueries}
              disabled={isFetching}
              className="mt-1.5 text-xs font-medium underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
            >
              {isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        </div>
      )}

      {!queryError && !isFetching && isEmpty && (() => {
        return (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 p-3">
            <div className="rounded-xl border border-border/70 bg-card/90 backdrop-blur-md px-4 py-3 text-xs text-muted-foreground text-center pointer-events-auto max-w-sm shadow-lg flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-1.5 text-primary">
                <BarChart2 className="h-4 w-4 text-primary" />
              </div>
              <div className="font-semibold text-foreground text-xs">
                {isFutureRange ? "This period hasn't occurred yet" : 'No Data in Selected Range'}
              </div>
              <div className="text-3xs mt-1 text-muted-foreground/80 leading-relaxed max-w-xs">
                {isFutureRange
                  ? 'The selected date range is in the future. Select an earlier month, year, or a current date range to view operational trends.'
                  : `No telemetry or readings recorded for ${metric === 'nrw' ? 'wells & locators' : metric === 'pv' ? 'wells & power' : metric === 'tds' || metric === 'recovery' || metric === 'plantHealth' || metric === 'roFlowBalance' ? 'RO trains' : metric === 'productionCost' ? 'power readings & tariffs' : 'wells'}.`}
              </div>
              {!isFutureRange && (
                <div className="mt-2.5 flex items-center gap-2">
                  <a
                    href="/operations"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-3xs font-medium bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition-colors shadow-xs"
                  >
                    Log readings in Operations →
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {!queryError && !isFetching && metric === 'productionCost' && chartData.length > 0
        && chartData.every((d) => d.totalCost == null) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="rounded-md border border-warn bg-warn-soft/95 px-4 py-3 text-xs text-warn text-left pointer-events-auto max-w-sm shadow-sm">
            <div className="font-semibold mb-1">Cost data incomplete</div>
            <div className="text-xs space-y-1 opacity-90">
              <p>Power cost requires all three of the following in this date range:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                <li><strong>Power readings</strong> — log kWh in Operations</li>
                <li><strong>Tariff rate</strong> — add a bill in Costs → Power tab</li>
                <li><strong>Production volume</strong> — log product meter readings</li>
              </ul>
              <p className="mt-1 opacity-75">Check: <code className="bg-warn-soft px-1 rounded">SELECT * FROM power_tariffs WHERE plant_id = '…'</code></p>
            </div>
          </div>
        </div>
      )}

      {!queryError && !isFetching && metric === 'kwh' && chartData.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 gap-2">
          <BarChart2 className="h-8 w-8 opacity-20 text-muted-foreground" />
          <div className="text-center">
            <div className="text-xs font-medium text-foreground">No power readings in this period</div>
            <div className="text-2xs text-muted-foreground mt-0.5 opacity-70">Log readings in Operations → Power, then run the SQL migration to backfill legacy rows.</div>
          </div>
        </div>
      )}
    </>
  );
}
