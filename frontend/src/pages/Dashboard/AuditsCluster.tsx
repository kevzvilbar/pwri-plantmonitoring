import React, { Suspense, lazy } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ClusterHeader } from '@/components/dashboard/StatCard';
import { ChartSkeleton } from '@/components/dashboard/CardSkeleton';

const LazyCompletenessRadar = lazy(() =>
  import('@/components/dashboard/DataCompletenessRadarCard').then((m) => ({
    default: m.DataCompletenessRadarCard,
  })),
);

const LazyDataTrustAuditCard = lazy(() =>
  import('@/components/dashboard/DataTrustAuditCard').then((m) => ({
    default: m.DataTrustAuditCard,
  })),
);

interface AuditsClusterProps {
  plantIds: string[];
}

// Data Trust section — surfaces audit-grade data completeness alongside
// operational reporting confidence gates, anomaly reviews, and compliance limits.
export function AuditsCluster({ plantIds }: AuditsClusterProps) {
  return (
    <section id="audits-cluster" className="scroll-mt-40 space-y-2.5">
      <ClusterHeader icon={ShieldAlert} title="Data Trust" accent="text-highlight" subtitle="Completeness & audits" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <Suspense fallback={<ChartSkeleton />}>
          <LazyCompletenessRadar plantIds={plantIds} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <LazyDataTrustAuditCard plantIds={plantIds} />
        </Suspense>
      </div>
    </section>
  );
}
