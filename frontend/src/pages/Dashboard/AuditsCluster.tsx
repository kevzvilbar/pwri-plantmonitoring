import React, { Suspense, lazy } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ClusterHeader } from '@/components/dashboard/StatCard';
import { ChartSkeleton } from '@/components/dashboard/CardSkeleton';

const LazyCompletenessRadar = lazy(() =>
  import('@/components/dashboard/DataCompletenessRadarCard').then((m) => ({
    default: m.DataCompletenessRadarCard,
  })),
);

interface AuditsClusterProps {
  plantIds: string[];
}

// Renamed section intent: "Data Trust" — collapsed-adjacent audit content kept
// out of the ops scan path. CostSunburst moved to CostCluster; blending volume
// moved to OverviewCluster. Only the completeness radar remains here.
export function AuditsCluster({ plantIds }: AuditsClusterProps) {
  return (
    <section id="audits-cluster" className="scroll-mt-28 space-y-2.5">
      <ClusterHeader icon={ShieldAlert} title="Data Trust" accent="text-highlight" subtitle="Completeness & audits" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Suspense fallback={<ChartSkeleton />}>
          <LazyCompletenessRadar plantIds={plantIds} />
        </Suspense>
        <div className="rounded-xl border border-border/60 bg-card/60 p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-highlight" aria-hidden />
          <p>
            Cost composition now lives under Production Cost, and blending volume
            lives under Overview. This section is reserved for audit-grade
            completeness checks that gate reporting confidence.
          </p>
        </div>
      </div>
    </section>
  );
}
