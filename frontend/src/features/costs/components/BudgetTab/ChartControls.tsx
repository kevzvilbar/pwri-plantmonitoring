import { GitCommit, BarChart3 } from 'lucide-react';

type Metric = 'total' | 'power' | 'chem';
type ChartView = 'waterfall' | 'comparison';

export function ChartControls({
  chartView,
  setChartView,
  waterfallMode,
  setWaterfallMode,
  metric,
  setMetric,
}: {
  chartView: ChartView;
  setChartView: (v: ChartView) => void;
  waterfallMode: 'cost-breakdown' | 'monthly-steps';
  setWaterfallMode: (v: 'cost-breakdown' | 'monthly-steps') => void;
  metric: Metric;
  setMetric: (m: Metric) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/60">
        <button
          className={`flex items-center gap-1.5 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
            chartView === 'waterfall'
              ? 'bg-background text-primary shadow-xs font-bold border border-border/60'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setChartView('waterfall')}
        >
          <GitCommit className="h-3 w-3" />
          Waterfall
        </button>
        <button
          className={`flex items-center gap-1.5 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
            chartView === 'comparison'
              ? 'bg-background text-primary shadow-xs font-bold border border-border/60'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setChartView('comparison')}
        >
          <BarChart3 className="h-3 w-3" />
          Monthly Bars
        </button>
      </div>

      {chartView === 'waterfall' && (
        <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40">
          <button
            className={`px-2 py-0.5 text-3xs font-medium rounded transition-all ${
              waterfallMode === 'cost-breakdown'
                ? 'bg-background text-foreground shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setWaterfallMode('cost-breakdown')}
          >
            Cost Breakdown
          </button>
          <button
            className={`px-2 py-0.5 text-3xs font-medium rounded transition-all ${
              waterfallMode === 'monthly-steps'
                ? 'bg-background text-foreground shadow-2xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setWaterfallMode('monthly-steps')}
          >
            Monthly Steps
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40">
        {(['total', 'power', 'chem'] as Metric[]).map((m) => (
          <button
            key={m}
            className={`px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
              metric === m ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setMetric(m)}
          >
            {m === 'total' ? 'Total' : m === 'power' ? 'Power' : 'Chemicals'}
          </button>
        ))}
      </div>
    </div>
  );
}
