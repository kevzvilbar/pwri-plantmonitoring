import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { ExportButton } from '@/components/ExportButton';
import { DataState } from '@/components/DataState';
import { cn } from '@/lib/utils';
import { DosingHistoryLogFilters } from './DosingHistoryLogFilters';
import { DosingHistoryLogTotals } from './DosingHistoryLogTotals';
import { DosingHistoryLogRow } from './DosingHistoryLogRow';
import { useDosingHistoryFilters } from './useDosingHistoryFilters';
import { useDosingHistoryQueries } from './useDosingHistoryQueries';
import { useDosingHistoryTotals } from './useDosingHistoryTotals';

export function DosingHistoryLog() {
  const { selectedPlantId, setSelectedPlantId } = useAppStore();
  const { isManager, activeOperator } = useAuth();
  const { data: plantsData } = usePlants();

  const filters = useDosingHistoryFilters(selectedPlantId);
  const { filterPlantId, setFilterPlantId, days, setDays, customFrom, setCustomFrom, customTo, setCustomTo, from, to, lastSyncedPlantRef } = filters;

  const queries = useDosingHistoryQueries(filterPlantId, from, to);
  const { logs, isLoading, error, refetch, prices } = queries;
  const totals = useDosingHistoryTotals(logs, prices);

  const plantName = (id: string) => plantsData?.find((p: any) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-3">
      <DosingHistoryLogFilters
        filterPlantId={filterPlantId}
        setFilterPlantId={setFilterPlantId}
        selectedPlantId={selectedPlantId}
        setSelectedPlantId={setSelectedPlantId}
        days={days}
        setDays={setDays}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        lastSyncedPlantRef={lastSyncedPlantRef}
        plants={plantsData}
      />

      {totals && (
        <DosingHistoryLogTotals totals={totals} recordCount={logs?.length ?? 0} />
      )}

      <DataState
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        isEmpty={!logs?.length}
        emptyTitle="No dosing records found"
        emptyDescription="No records for this period — try widening the date range."
      >
        <div className="space-y-2">
          {(logs ?? []).map((row: any) => (
            <DosingHistoryLogRow
              key={row.id}
              row={row}
              prices={prices}
              isManager={isManager}
              activeOperatorId={activeOperator?.id}
              plantName={plantName}
            />
          ))}
        </div>
      </DataState>
    </div>
  );
}
