import { Award, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
import { PageHeader } from '@/components/PageHeader';
import { useScorecardData, computeManagerOversightScore, fmtPct } from './ManagerScorecard/useScorecardData';
import { ScorecardOversightStrip } from './ManagerScorecard/ScorecardOversightStrip';
import { ScorecardControls } from './ManagerScorecard/ScorecardControls';
import { ScorecardSummaryTiles } from './ManagerScorecard/ScorecardSummaryTiles';
import { PlantScorecardView } from './ManagerScorecard/PlantScorecardView';
import { ManagerScorecardView } from './ManagerScorecard/ManagerScorecardView';
import { APPRAISAL_TIERS, getAppraisalTier } from '@/lib/appraisal';

export type ManagerAppraisalTier = import('@/lib/appraisal').AppraisalTier;
export const MANAGER_APPRAISAL_TIERS = APPRAISAL_TIERS;
export const getManagerAppraisalTier = getAppraisalTier;
export { computeManagerOversightScore } from './ManagerScorecard/useScorecardData';

export default function ManagerScorecard() {
  const {
    canView, navigate, days, viewBy, setViewBy, setDays,
    rows, isLoading, error, refetch, isFetching, corrReqs,
    plantCorrMap, managerRollup, sorted, summary,
    exportManagerScorecardCsv, handleRefresh,
  } = useScorecardData();

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="p-8 text-center space-y-2 max-w-sm">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h2 className="font-semibold">Access restricted</h2>
          <p className="text-sm text-muted-foreground">Manager Scorecard requires Admin, Manager, or Data Analyst access.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Manager Scorecard & Oversight"
        titleIcon={<Award className="h-5 w-5 text-accent" />}
        subtitle="Data-quality oversight per manager & plant — monitor operator input diligence, correction approval speed, and annual management ratings."
      />

      <ScorecardOversightStrip
        fleetOversightScore={summary.fleetOversightScore}
        fleetTier={summary.fleetTier}
        onExportCsv={exportManagerScorecardCsv}
        isFetching={isFetching}
        onRefresh={handleRefresh}
      />

      <ScorecardControls
        days={days}
        onDaysChange={setDays}
        viewBy={viewBy}
        onViewByChange={setViewBy}
        managerCount={managerRollup.length}
        plantCount={rows.length}
        avgCompleteness={summary.avgCompleteness}
      />

      <ScorecardSummaryTiles
        monitored={summary.monitored}
        total={summary.total}
        avgCompleteness={summary.avgCompleteness}
        totalPendingCorrections={summary.totalPendingCorrections}
        openExceptions={summary.openExceptions}
        onNavigateToCorrections={() => navigate('/data-corrections')}
      />

      <Card className="p-0 border border-border/70 overflow-hidden shadow-2xs">
        <div className="p-3 border-b bg-muted/20 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {viewBy === 'plant'
              ? `Plant-level view: Evaluates data completeness, error rate, open exceptions, and requested correction approval backlog over the last ${days} days.`
              : `Manager-level view: Evaluates each manager's direct oversight across all assigned plant facilities, operator inputs, and correction approval velocity.`}
          </p>
        </div>

        <DataState
          loading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          emptyTitle="No plant scorecard data available."
          onRetry={handleRefresh}
        >
          {viewBy === 'plant' ? (
            <PlantScorecardView sorted={sorted} plantCorrMap={plantCorrMap} navigate={navigate} days={days} />
          ) : (
            <ManagerScorecardView managerRollup={managerRollup} navigate={navigate} />
          )}
        </DataState>
      </Card>
    </div>
  );
}
