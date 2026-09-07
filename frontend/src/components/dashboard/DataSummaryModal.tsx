/**
 * DataSummaryModal.tsx
 *
 * Full-screen pivot-table modal — rows = dates, columns = individual
 * locators (consumption) or product/RO meters (production).
 * Composes useDataSummaryQueries + useDataSummaryPivots.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { DataSummaryFilters } from './DataSummaryFilters';
import { DataSummaryTable } from './DataSummaryTable';
import { DataSummaryStats } from './DataSummaryStats';
import { useDataSummaryQueries } from './DataSummaryModal/useDataSummaryQueries';
import { useDataSummaryPivots } from './DataSummaryModal/useDataSummaryPivots';
import { computePivotFromReadingsNoCache, pivotDayTotal } from './DataSummaryModal/pivotUtils';

export { computePivotFromReadingsNoCache, pivotDayTotal };

export type SummaryTab = 'both' | 'production' | 'consumption' | 'current';

export interface DataSummaryModalProps {
  open: boolean;
  onClose: () => void;
  plantIds: string[];
  plantCodeById: Map<string, string>;
}

export function DataSummaryModal({ open, onClose, plantIds, plantCodeById }: DataSummaryModalProps) {
  const {
    tab, setTab,
    currentSide, setCurrentSide,
    fromStr, setFromStr, toStr, setToStr,
    locators, locatorsLoading,
    locatorIds, directLocatorIds,
    consReadings, consLoading,
    productMeters, metersLoading,
    meterIds, directMeterIds,
    prodReadings, prodLoading,
    modalMeterConfigs, configLoading,
    permeateIsProductionPlantIds,
    productExcludedPlantIds,
    configsReady,
    roTrainsMeta, trainsLoading,
    roMeterReadings, roLoading,
    roCurrentReadings,
    isLoading,
  } = useDataSummaryQueries({ open, plantIds });

  const {
    consPivot, prodPivot, combinedProdPivot,
    consCurrentPivot, prodCurrentPivot, combinedProdCurrentPivot, currentPivotData,
    colTotals, rowTotals, grandTotal, prodGrandTotal, consGrandTotal,
    hasRoEntities, hasMeterEntities,
    dates, entities, estimatedKeys,
  } = useDataSummaryPivots({
    tab,
    currentSide,
    consReadings,
    locators,
    plantCodeById,
    fromStr,
    toStr,
    directLocatorIds,
    productMeters,
    prodReadings,
    productExcludedPlantIds,
    directMeterIds,
    roTrainsMeta,
    roMeterReadings,
    roCurrentReadings,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="data-summary-modal"
      >
        <DataSummaryFilters
          fromStr={fromStr}
          toStr={toStr}
          setFromStr={setFromStr}
          setToStr={setToStr}
          tab={tab}
          setTab={setTab}
          currentSide={currentSide}
          setCurrentSide={setCurrentSide}
          isLoading={isLoading}
        />
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <DataSummaryTable
            tab={tab}
            isLoading={isLoading}
            consPivot={consPivot}
            prodPivot={prodPivot}
            combinedProdPivot={combinedProdPivot}
            consCurrentPivot={consCurrentPivot}
            prodCurrentPivot={prodCurrentPivot}
            combinedProdCurrentPivot={combinedProdCurrentPivot}
            currentPivotData={currentPivotData}
            colTotals={colTotals}
            rowTotals={rowTotals}
            grandTotal={grandTotal}
            prodGrandTotal={prodGrandTotal}
            consGrandTotal={consGrandTotal}
            plantCodeById={plantCodeById}
            hasRoEntities={hasRoEntities}
            hasMeterEntities={hasMeterEntities}
            currentSide={currentSide}
          />
        </div>
        <DataSummaryStats
          tab={tab}
          combinedProdPivot={combinedProdPivot}
          consPivot={consPivot}
          currentPivotData={currentPivotData}
          entities={entities}
          dates={dates}
          estimatedKeys={estimatedKeys}
          hasRoEntities={hasRoEntities}
          hasMeterEntities={hasMeterEntities}
          plantIds={plantIds}
          modalMeterConfigs={modalMeterConfigs}
          configLoading={configLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
