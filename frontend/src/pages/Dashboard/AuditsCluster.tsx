import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { ClusterHeader } from '@/components/dashboard/StatCard';
import { DataCompletenessRadarCard } from '@/components/dashboard/DataCompletenessRadarCard';
import { CostSunburst } from '@/components/dashboard/CostSunburst';

interface AuditsClusterProps {
  plantIds: string[];
}

export function AuditsCluster({ plantIds }: AuditsClusterProps) {
  return (
    <section id="audits-cluster" className="scroll-mt-28 space-y-2.5">
      <ClusterHeader icon={ShieldAlert} title="Audits & Multi-Facility Analytics" accent="text-highlight" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DataCompletenessRadarCard plantIds={plantIds} />
        <CostSunburst plantIds={plantIds} />
      </div>
    </section>
  );
}
