import { Building2, Percent, CheckSquare, ShieldAlert } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';

interface ScorecardSummaryTilesProps {
  monitored: number;
  total: number;
  avgCompleteness: number | null;
  totalPendingCorrections: number;
  openExceptions: number;
  onNavigateToCorrections: () => void;
}

export function ScorecardSummaryTiles({
  monitored, total, avgCompleteness, totalPendingCorrections, openExceptions, onNavigateToCorrections,
}: ScorecardSummaryTilesProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={Building2}
        label="Plants Monitored"
        value={`${monitored} / ${total || 0}`}
        tone={monitored < total ? 'warn' : undefined}
      />
      <StatCard
        icon={Percent}
        label="Avg Completeness"
        value={avgCompleteness === null ? '—' : `${avgCompleteness.toFixed(1)}%`}
        tone={avgCompleteness !== null && avgCompleteness < 80 ? 'danger' : undefined}
      />
      <div
        onClick={onNavigateToCorrections}
        className="cursor-pointer transition-transform active:scale-[0.99]"
        title="Click to review pending corrections in Data Corrections Hub"
      >
        <StatCard
          icon={CheckSquare}
          label="Pending Correction Approvals"
          value={totalPendingCorrections.toLocaleString()}
          tone={totalPendingCorrections > 0 ? 'warn' : undefined}
        />
      </div>
      <StatCard
        icon={ShieldAlert}
        label="Open Gaps & Exceptions"
        value={openExceptions.toLocaleString()}
        tone={openExceptions > 0 ? 'danger' : undefined}
      />
    </div>
  );
}
