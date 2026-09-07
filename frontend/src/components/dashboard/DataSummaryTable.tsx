import React, { useMemo } from 'react';
import { SummaryTab } from './DataSummaryModal';
import { BothTabView } from './DataSummaryTable/BothTabView';
import { PivotTabView } from './DataSummaryTable/PivotTabView';
import { CurrentTabView } from './DataSummaryTable/CurrentTabView';

export interface DataSummaryTableProps {
  tab: SummaryTab;
  isLoading: boolean;
  consPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  prodPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  combinedProdPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  consCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  prodCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  combinedProdCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  currentPivotData: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  colTotals: number[];
  rowTotals: number[];
  grandTotal: number;
  prodGrandTotal: number;
  consGrandTotal: number;
  plantCodeById: Map<string, string>;
  hasRoEntities: boolean;
  hasMeterEntities: boolean;
  currentSide: 'consumption' | 'production';
}

export function DataSummaryTable({
  tab,
  isLoading,
  consPivot,
  prodPivot,
  combinedProdPivot,
  consCurrentPivot,
  prodCurrentPivot,
  combinedProdCurrentPivot,
  currentPivotData,
  colTotals,
  rowTotals,
  grandTotal,
  prodGrandTotal,
  consGrandTotal,
  plantCodeById,
  hasRoEntities,
  hasMeterEntities,
  currentSide,
}: DataSummaryTableProps) {
  const activeProdPivot = combinedProdPivot;
  const allDates = activeProdPivot.dates;
  const prodEntities = activeProdPivot.entities;
  const consEntities = consPivot.entities;

  if (tab === 'both') {
    return (
      <BothTabView
        allDates={allDates}
        prodEntities={prodEntities}
        consEntities={consEntities}
        activeProdPivot={activeProdPivot}
        consPivot={consPivot}
        prodGrandTotal={prodGrandTotal}
        consGrandTotal={consGrandTotal}
      />
    );
  }

  if (tab === 'production' || tab === 'consumption') {
    const entities = tab === 'consumption' ? consPivot.entities : combinedProdPivot.entities;
    const pivot = tab === 'consumption' ? consPivot.pivot : combinedProdPivot.pivot;
    const estimatedKeys = tab === 'consumption' ? consPivot.estimatedKeys : combinedProdPivot.estimatedKeys;
    const dates = tab === 'consumption' ? consPivot.dates : combinedProdPivot.dates;

    return (
      <PivotTabView
        tab={tab}
        dates={dates}
        entities={entities}
        pivot={pivot}
        estimatedKeys={estimatedKeys}
        colTotals={colTotals}
        rowTotals={rowTotals}
        grandTotal={grandTotal}
        plantCodeById={plantCodeById}
      />
    );
  }

  if (tab === 'current') {
    return (
      <CurrentTabView
        crEntities={currentPivotData.entities}
        crDates={currentPivotData.dates}
        crPivot={currentPivotData.pivot}
        currentSide={currentSide}
        plantCodeById={plantCodeById}
        isLoading={isLoading}
      />
    );
  }

  return null;
}
