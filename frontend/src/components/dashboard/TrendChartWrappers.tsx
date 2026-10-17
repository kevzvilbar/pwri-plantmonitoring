// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass — see that file's own header comment for the phase-1/M-series
// context. This module holds the three thin "shell" components that wrap
// the actual chart (TrendChart, still in TrendChart.tsx): cluster-level
// layout switching, the Card-wrapped inline/section variant, and the Dialog
// (popup) variant. None of these own any data or state themselves — they
// just decide how/where <TrendChart> gets mounted.
import { useState } from 'react';
import { ChevronDown, ChevronUp, LineChart } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ChartMetric, DashboardViewMode } from './types';
import { TrendChart } from './TrendChart';

// Renders the per-cluster trend chart slot beneath a cluster's StatCards.
//   • inline   — every chart in the cluster is rendered directly below
//                the cards (full-width, compact height) on desktop; on mobile
//                (< md) charts stay collapsed until a KPI card is tapped or
//                "Show All Trend Charts" is toggled.
//   • sections — at most one chart (matching `expandedMetric`) is
//                rendered below the cards. Single-open behaviour: the
//                user clicks a KPI card to fold its chart open here;
//                clicking another KPI auto-closes the previous.
//   • popup    — nothing is rendered here; charts surface only inside
//                the TrendModal opened from the StatCards above.
export function ClusterCharts({
  metrics, viewMode, expandedMetric, plantIds, clusterId,
}: {
  metrics: ChartMetric[];
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  clusterId: string;
}) {
  const [mobileShowAll, setMobileShowAll] = useState(false);

  if (viewMode === 'popup') return null;
  if (viewMode === 'inline') {
    const activeMobileMetric = metrics.find((x) => x.metric === expandedMetric);
    return (
      <div className="space-y-2 mt-2" data-testid={`cluster-inline-charts-${clusterId}`}>
        {metrics.length > 1 && (
          <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/60">
            <span className="text-2xs text-muted-foreground flex items-center gap-1.5 min-w-0 truncate">
              <LineChart className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate">
                {activeMobileMetric && !mobileShowAll
                  ? `Showing: ${activeMobileMetric.title}`
                  : 'Tap a metric card above to view its chart'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setMobileShowAll((v) => !v)}
              className="text-2xs font-semibold text-primary hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <span>{mobileShowAll ? 'Hide Charts' : `Show All (${metrics.length})`}</span>
              {mobileShowAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
        {metrics.map((m) => (
          <div
            key={m.metric}
            className={cn(
              metrics.length > 1 && !mobileShowAll && expandedMetric !== m.metric && 'hidden md:block'
            )}
          >
            <InlineTrendChart metric={m.metric} title={m.title} plantIds={plantIds} compact />
          </div>
        ))}
      </div>
    );
  }
  // sections — render the expanded chart only if it belongs to this cluster
  if (viewMode === 'sections' && expandedMetric) {
    const m = metrics.find((x) => x.metric === expandedMetric);
    if (!m) return null;
    return (
      <div className="mt-2" data-testid={`cluster-section-chart-${m.metric}`}>
        <InlineTrendChart metric={m.metric} title={m.title} plantIds={plantIds} />
      </div>
    );
  }
  return null;
}

// Card-wrapped trend chart used both for `inline` (compact height,
// stacked beneath each cluster) and `sections` (regular height,
// single open at a time). Title and range buttons share the same row
// so the chart area is maximised, especially on mobile.
export function InlineTrendChart({
  metric, title, plantIds, compact = false,
}: {
  metric: string;
  title: string;
  plantIds: string[];
  compact?: boolean;
}) {
  return (
    <Card className="rounded-2xl p-3.5 transition-all hover:border-border/90" data-testid={`inline-trend-${metric}`}>
      <TrendChart metric={metric} title={title} plantIds={plantIds} compact={compact} />
    </Card>
  );
}

// Modal-wrapped trend chart used in `popup` view mode. Thin Dialog
// shell — the chart logic itself lives entirely in <TrendChart> below.
export function TrendModal({
  open, onClose, metric, title, plantIds,
}: {
  open: boolean;
  onClose: () => void;
  metric: string;
  title: string;
  plantIds: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl xl:max-w-6xl w-[95vw] max-h-[92vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 flex flex-col gap-3 min-w-0">
        <DialogHeader className="pb-2 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick a date range to inspect the {title.toLowerCase()} time series for the selected plants.
          </DialogDescription>
        </DialogHeader>
        <div className="w-full min-w-0 flex flex-col flex-1 overflow-x-hidden">
          <TrendChart metric={metric} plantIds={plantIds} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

