// Action Center — "needs a human today" queue surfaced directly below the
// sticky control bar so operators don't have to scroll the full page.
// Wraps the three operational queue cards (review / PM / coverage) that
// previously lived at the bottom of HealthCluster.
import React from 'react';
import { ClipboardList } from 'lucide-react';
import { ClusterHeader } from '@/components/dashboard/StatCard';
import { ReadingCoverageCard } from '@/components/dashboard/ReadingCoverageCard';
import { PMDueSoonCard } from '@/components/dashboard/PMDueSoonCard';
import { PendingReviewCard } from '@/components/dashboard/PendingReviewCard';

interface ActionCenterProps {
  plantIds: string[];
}

export function ActionCenter({ plantIds }: ActionCenterProps) {
  return (
    <section id="action-center" className="scroll-mt-40 space-y-2.5">
      <ClusterHeader
        icon={ClipboardList}
        title="Action Center"
        accent="text-warn"
        subtitle="Needs attention today"
      />
      <div className="grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
        <PendingReviewCard plantIds={plantIds} />
        <PMDueSoonCard plantIds={plantIds} />
        <ReadingCoverageCard plantIds={plantIds} />
      </div>
    </section>
  );
}
