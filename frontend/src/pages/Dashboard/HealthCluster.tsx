import React from 'react';
import { Activity } from 'lucide-react';
import { ClusterHeader } from '@/components/dashboard/StatCard';
import { InlineTrendChart } from '@/components/dashboard/TrendChartWrappers';
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
    </section>
  );
}
