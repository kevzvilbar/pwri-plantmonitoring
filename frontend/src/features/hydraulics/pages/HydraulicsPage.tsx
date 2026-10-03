import React, { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { useHydraulicsFleet } from '@/features/hydraulics/hooks/useHydraulicsFleet';
import { HydraulicFleetTable } from '@/features/hydraulics/components/HydraulicFleetTable';
import { HydraulicQuickLookDrawer } from '@/features/hydraulics/components/HydraulicQuickLookDrawer';
import { EditHydraulicDialog } from '@/features/wells/components/dialogs/HydraulicDialogs';
import { type WellHydraulicSummary, type HydraulicStatus, type PmsSurveyRecord } from '@/features/wells/lib/hydraulics';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Waves,
  RefreshCw,
  Clock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import { AppLoading } from '@/components/AppLoading';

export function HydraulicsPage() {
  const { roles } = useAuth();
  const isManager = roles.some((r) => r === 'Manager' || r === 'Admin');

  const { plants: visiblePlants, isLoading: plantsLoading } = useVisiblePlants();
  const [selectedPlantId, setSelectedPlantId] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<HydraulicStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Quick look drawer state
  const [quickLookSummary, setQuickLookSummary] = useState<WellHydraulicSummary | null>(null);
  const [isQuickLookOpen, setIsQuickLookOpen] = useState(false);

  // Edit / Log survey dialog state
  const [dialogTarget, setDialogTarget] = useState<{
    well: { id: string; name: string; plant_id: string; drilling_depth_m?: number | null };
    latest?: PmsSurveyRecord | null;
    record?: PmsSurveyRecord | null;
  } | null>(null);

  const {
    summaries,
    counts,
    isLoading: fleetLoading,
    isError,
    refetch,
  } = useHydraulicsFleet({
    plantId: selectedPlantId,
    statusFilter,
    search: searchQuery,
  });

  const handleOpenQuickLook = (summary: WellHydraulicSummary) => {
    setQuickLookSummary(summary);
    setIsQuickLookOpen(true);
  };

  const handleEditSurvey = (summary: WellHydraulicSummary) => {
    setDialogTarget({
      well: {
        id: summary.wellId,
        name: summary.wellName,
        plant_id: summary.plantId,
        drilling_depth_m: typeof summary.drillingDepth === 'number' ? summary.drillingDepth : null,
      },
      latest: summary.latestSurvey,
      record: summary.latestSurvey,
    });
  };

  const handleLogNewSurvey = (summary: WellHydraulicSummary) => {
    setDialogTarget({
      well: {
        id: summary.wellId,
        name: summary.wellName,
        plant_id: summary.plantId,
        drilling_depth_m: typeof summary.drillingDepth === 'number' ? summary.drillingDepth : null,
      },
      latest: summary.latestSurvey,
      record: null,
    });
  };

  if (fleetLoading || plantsLoading) {
    return <AppLoading className="min-h-[50vh] text-muted-foreground" />;
  }

  if (isError) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-destructive">Failed to load well hydraulic fleet data.</p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-info/10 text-info">
              <Waves className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Well Fleet Hydraulics
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Cross-well hydraulic benchmarks, water levels, drawdown, and pump equipment surveillance.
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={() => void refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Wells */}
        <Card
          className="p-3 cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setStatusFilter('ALL')}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Total Wells
            </span>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="font-mono-num font-bold text-2xl text-foreground mt-1">
            {counts.total}
          </div>
          <div className="text-3xs text-muted-foreground mt-0.5">
            Active monitoring wells
          </div>
        </Card>

        {/* Survey Due / Overdue */}
        <Card
          className={`p-3 cursor-pointer transition-colors ${
            counts.overdue > 0 ? 'border-amber-500/40 bg-amber-500/5' : ''
          }`}
          onClick={() => setStatusFilter('overdue')}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Survey Due
            </span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="font-mono-num font-bold text-2xl text-amber-600 dark:text-amber-400 mt-1">
            {counts.overdue}
          </div>
          <div className="text-3xs text-muted-foreground mt-0.5">
            &gt;90 days since survey
          </div>
        </Card>

        {/* Incomplete Survey */}
        <Card
          className={`p-3 cursor-pointer transition-colors ${
            counts.incomplete > 0 ? 'border-amber-500/40 bg-amber-500/5' : ''
          }`}
          onClick={() => setStatusFilter('incomplete')}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Incomplete Data
            </span>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="font-mono-num font-bold text-2xl text-amber-600 dark:text-amber-400 mt-1">
            {counts.incomplete}
          </div>
          <div className="text-3xs text-muted-foreground mt-0.5">
            Missing core measurements
          </div>
        </Card>

        {/* No Survey */}
        <Card
          className={`p-3 cursor-pointer transition-colors ${
            counts.no_survey > 0 ? 'border-destructive/40 bg-destructive/5' : ''
          }`}
          onClick={() => setStatusFilter('no_survey')}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-wide text-destructive">
              No Survey
            </span>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="font-mono-num font-bold text-2xl text-destructive mt-1">
            {counts.no_survey}
          </div>
          <div className="text-3xs text-muted-foreground mt-0.5">
            Zero survey logs recorded
          </div>
        </Card>
      </div>

      {/* Main Table */}
      <HydraulicFleetTable
        summaries={summaries}
        counts={counts}
        visiblePlants={visiblePlants}
        selectedPlantId={selectedPlantId}
        onSelectPlant={setSelectedPlantId}
        statusFilter={statusFilter}
        onSelectStatusFilter={setStatusFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenQuickLook={handleOpenQuickLook}
        onEditSurvey={handleEditSurvey}
        onLogNewSurvey={handleLogNewSurvey}
        isManager={isManager}
      />

      {/* Quick-Look Drawer */}
      <HydraulicQuickLookDrawer
        summary={quickLookSummary}
        isOpen={isQuickLookOpen}
        onClose={() => setIsQuickLookOpen(false)}
        isManager={isManager}
        onEditSurvey={handleEditSurvey}
        onLogNewSurvey={handleLogNewSurvey}
      />

      {/* Log / Edit Survey Dialog */}
      {dialogTarget && (
        <EditHydraulicDialog
          well={dialogTarget.well}
          latest={dialogTarget.latest}
          record={dialogTarget.record}
          onClose={() => {
            setDialogTarget(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
