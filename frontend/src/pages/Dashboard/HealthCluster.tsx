import React from 'react';
import { Activity } from 'lucide-react';
import { ClusterHeader } from '@/components/dashboard/StatCard';
import { InlineTrendChart, ClusterCharts } from '@/components/dashboard/TrendChartWrappers';
import { ReadingCoverageCard } from '@/components/dashboard/ReadingCoverageCard';
import { PMDueSoonCard } from '@/components/dashboard/PMDueSoonCard';
import { PendingReviewCard } from '@/components/dashboard/PendingReviewCard';
import { BlendingVolumeCard } from '@/components/BlendingVolumeCard';
import type { DashboardViewMode } from '@/components/dashboard/types';

interface HealthClusterProps {
  plantIds: string[];
  viewMode: DashboardViewMode;
}

export function HealthCluster({ plantIds, viewMode }: HealthClusterProps) {
  return (
    <section id="health-cluster" className="scroll-mt-28 space-y-2.5">
      <ClusterHeader icon={Activity} title="Plant Health Trend" accent="text-accent" subtitle="RO trains" />
      <InlineTrendChart metric="plantHealth" title="Plant Health Trend" plantIds={plantIds} compact={viewMode === 'inline'} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReadingCoverageCard plantIds={plantIds} />
        <PMDueSoonCard plantIds={plantIds} />
        <PendingReviewCard plantIds={plantIds} />
      </div>

      <BlendingVolumeCard plantIds={plantIds} />
    </section>
  );
}
