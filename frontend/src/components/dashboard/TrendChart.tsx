import React from 'react';
import { useTrendChartQueries } from './useTrendChartQueries';
import { useTrendChartData } from './useTrendChartData';
import { useTrendChartDerived } from './useTrendChartDerived';
import { useTrendChartState } from './TrendChart/useTrendChartState';
import { TrendChartToolbar } from './TrendChartToolbar';
import { TrendChartControls } from './TrendChartControls';
import { TrendChartKwhStatCards } from './TrendChart/TrendChartKwhStatCards';
import { TrendChartStatusOverlay } from './TrendChart/TrendChartStatusOverlay';
import { TrendChartMetricLegend } from './TrendChart/TrendChartMetricLegend';
import { DataSummaryPopup } from './TrendChartDataSummaryPopup/TrendChartDataSummaryPopup.tsx';
import { TrendChartCanvas } from './TrendChartCanvas';
import {
  GranularityControl, StackToggle, DrillBreadcrumb,
} from './TrendChartDrill';

export function TrendChart({
  metric, plantIds, compact = false, title,
}: {
  metric: string;
  plantIds: string[];
  compact?: boolean;
  title?: string;
}) {
  const s = useTrendChartState(metric, plantIds);

  const {
    wellNames, locatorNames, productMeterNames, plantNames,
    _directLocatorIds, _directProductMeterIds,
    _locatorIdsForReadings,
    locReadings, fetchingLoc, errLoc, refetchLoc,
    productReadings, fetchingProduct, errProduct, refetchProduct,
    wellReadings, fetchingWell, errWell, refetchWell,
    _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
    roReadings, fetchingRo, errRo, refetchRo,
    roTrainNames, permeateConfigData, permeateIsProductionPlants, productExcludedPlants,
    powerReadings, fetchingPower, errPower, refetchPower,
    costReadings, fetchingCost, errCost, refetchCost,
    powerTariffs, billMultiplierMap, powerConfigMap,
    isFetching, queryError, retryFailedQueries,
  } = useTrendChartQueries({
    metric, plantIds, startISO: s.startISO, endISO: s.endISO, startKey: s.startKey, endKey: s.endKey,
  });

  const { chartData, trendRows, kwhChartRows } = useTrendChartData({
    metric, startKey: s.startKey, endKey: s.endKey, startISO: s.startISO,
    viewGran: s.viewGran, usesSharedGranularity: s.usesSharedGranularity, kwhSource: s.kwhSource,
    locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings,
    powerTariffs, billMultiplierMap, powerConfigMap,
    wellNames, locatorNames, productMeterNames, plantNames,
    permeateIsProductionPlants, productExcludedPlants,
    _trainPlantMap, _trainUnitTypeMap, _directLocatorIds, _directProductMeterIds,
  });

  const {
    drillEntities, usePermeateForSource, sourceDrillEntities, activeEntities, visibleEntities,
    filteredLocatorList, locatorTotals, selectTopNLocators,
    wellEntities, visibleWellEntities, wellEntityRows, handleWellLegendIsolate,
    filteredWellList, wellTotals, selectTopNWells, allWellsSelected, noneWellsSelected,
    toggleWell, selectAllWells, clearAllWells,
    allSelected, noneSelected, toggleLocator, selectAllLocators, clearAllLocators,
    entityRows, roTrainEntities, visibleTrainEntities, filteredTrainList, allTrainsSelected, noTrainsSelected,
    toggleTrain, selectAllTrains, clearAllTrains, valueKey, roUnit,
    roTrainDrillData, roHourDrillData, phTotalTrains, phDailyData, phHourlyData, phMonthlyData, phWeeklyData,
    phFocusedHourlyData, phActiveData, handlePhDayDotActivate, NegativeAwareTooltip, chartHeight,
    handleDrillBarActivate, drillFocusRange, focusedTrendRows, focusedEntityRows, drillCrumbs,
    handleLegendIsolate, handleTrainLegendIsolate, formatYAxis, PvTooltip,
  } = useTrendChartDerived({
    metric, compact, drillFocus: s.drillFocus, setDrillFocus: s.setDrillFocus, drillMode: s.drillMode,
    range: s.range, chartMonth: s.chartMonth,
    selectedLocatorIds: s.selectedLocatorIds, setSelectedLocatorIds: s.setSelectedLocatorIds, locatorSearch: s.locatorSearch,
    selectedTrainIds: s.selectedTrainIds, setSelectedTrainIds: s.setSelectedTrainIds, trainSearch: s.trainSearch,
    selectedWellIds: s.selectedWellIds, setSelectedWellIds: s.setSelectedWellIds, wellSearch: s.wellSearch,
    prodDrillSource: s.prodDrillSource, roDrillMode: s.roDrillMode,
    phDrillMode: s.phDrillMode, setPhDrillMode: s.setPhDrillMode, phDayFocus: s.phDayFocus, setPhDayFocus: s.setPhDayFocus,
    viewGran: s.viewGran, setViewGran: s.setViewGran, viewBreakdown: s.viewBreakdown, setViewBreakdown: s.setViewBreakdown,
    rawwaterBreakdown: s.rawwaterBreakdown,
    hasConsumptionDrill: s.hasConsumptionDrill, hasRoDrill: s.hasRoDrill, hasPlantHealth: s.hasPlantHealth,
    startKey: s.startKey, endKey: s.endKey,
    trendRows, chartData,
    wellNames, locatorNames, productMeterNames, plantNames, roTrainNames,
    wellReadings, locReadings, productReadings, roReadings,
    _directLocatorIds, _directProductMeterIds, _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
  });

  return (
    <>
      <TrendChartToolbar
        metric={metric}
        title={title}
        range={s.range}
        from={s.from}
        to={s.to}
        chartYear={s.chartYear}
        chartMonth={s.chartMonth}
        isFetching={isFetching}
        onRangeChange={s.setRange}
        onCustomDatesChange={s.handleCustomDatesChange}
        onMonthlyPeriodChange={s.setChartMonthlyPeriod}
        onOpenSummary={() => s.setShowSummary(true)}
        trailingControls={
          <TrendChartControls
            metric={metric} compact={compact} viewGran={s.viewGran} setViewGran={s.handleGranularityChange}
            viewBreakdown={s.viewBreakdown} setViewBreakdown={s.setViewBreakdown}
            rawwaterBreakdown={s.rawwaterBreakdown} setRawwaterBreakdown={s.setRawwaterBreakdown}
            stackMode={s.stackMode} setStackMode={s.setStackMode}
            kwhSource={s.kwhSource} setKwhSource={s.setKwhSource} chartData={chartData}
            range={s.range} rangeDays={s.rangeDays}
            selectedLocatorIds={s.selectedLocatorIds} setSelectedLocatorIds={s.setSelectedLocatorIds}
            selectedWellIds={s.selectedWellIds} setSelectedWellIds={s.setSelectedWellIds}
            roDrillMode={s.roDrillMode} setRoDrillMode={s.setRoDrillMode}
            showTrainFilter={s.showTrainFilter} setShowTrainFilter={s.setShowTrainFilter}
            showWellFilter={s.showWellFilter} setShowWellFilter={s.setShowWellFilter}
            phDrillMode={s.phDrillMode} setPhDrillMode={s.setPhDrillMode}
            phDayFocus={s.phDayFocus} setPhDayFocus={s.setPhDayFocus}
            showTotalCostLine={s.showTotalCostLine} setShowTotalCostLine={s.setShowTotalCostLine}
            showPowerCostLine={s.showPowerCostLine} setShowPowerCostLine={s.setShowPowerCostLine}
            showChemCostLine={s.showChemCostLine} setShowChemCostLine={s.setShowChemCostLine}
            prodDrillSource={s.prodDrillSource} usePermeateForSource={usePermeateForSource} drillMode={s.drillMode}
            hasConsumptionDrill={s.hasConsumptionDrill} hasRoDrill={s.hasRoDrill} hasPlantHealth={s.hasPlantHealth}
            allSelected={allSelected} noneSelected={noneSelected}
            selectAllLocators={selectAllLocators} clearAllLocators={clearAllLocators} toggleLocator={toggleLocator}
            allWellsSelected={allWellsSelected} noneWellsSelected={noneWellsSelected}
            selectAllWells={selectAllWells} clearAllWells={clearAllWells} toggleWell={toggleWell}
            allTrainsSelected={allTrainsSelected} noTrainsSelected={noTrainsSelected}
            selectAllTrains={selectAllTrains} clearAllTrains={clearAllTrains} toggleTrain={toggleTrain}
            drillEntities={drillEntities} roTrainEntities={roTrainEntities} selectedTrainIds={s.selectedTrainIds}
            wellEntities={wellEntities}
            filteredLocatorList={filteredLocatorList} filteredTrainList={filteredTrainList}
            filteredWellList={filteredWellList}
            locatorSearch={s.locatorSearch} setLocatorSearch={s.setLocatorSearch}
            trainSearch={s.trainSearch} setTrainSearch={s.setTrainSearch}
            wellSearch={s.wellSearch} setWellSearch={s.setWellSearch}
            showLocatorFilter={s.showLocatorFilter} setShowLocatorFilter={s.setShowLocatorFilter}
            locatorTotals={locatorTotals} wellTotals={wellTotals}
            selectTopNLocators={selectTopNLocators} selectTopNWells={selectTopNWells}
          />
        }
      />

      {s.showSummary && (
        <DataSummaryPopup
          open={s.showSummary}
          onClose={() => s.setShowSummary(false)}
          metric={metric}
          title={title}
          chartData={chartData}
          locReadings={locReadings ?? []}
          productReadings={productReadings ?? []}
          wellReadings={wellReadings ?? []}
          costReadings={costReadings ?? []}
          roReadings={roReadings ?? []}
          powerReadings={powerReadings}
          powerConfigMap={powerConfigMap}
          billMultiplierMap={billMultiplierMap}
          permeateIsProductionPlants={permeateIsProductionPlants}
          productExcludedPlants={productExcludedPlants}
          trainPlantMap={_trainPlantMap}
          locatorNames={locatorNames}
          productMeterNames={productMeterNames}
          wellNames={wellNames}
          plantNames={plantNames}
          roTrainNames={roTrainNames}
          directLocatorIds={_directLocatorIds}
          directMeterIds={_directProductMeterIds}
        />
      )}

      {metric === 'kwh' && chartData.length > 0 && (
        <TrendChartKwhStatCards chartData={chartData} />
      )}

      {(s.hasConsumptionDrill || (s.hasRoDrill && s.roDrillMode === 'by-train') || (metric === 'rawwater' && s.rawwaterBreakdown === 'by-well') || (s.hasPlantHealth && s.phDayFocus)) && (
        <DrillBreadcrumb crumbs={drillCrumbs} />
      )}

      <div className={`${chartHeight} w-full min-w-0 overflow-hidden relative`} data-testid={`trend-chart-${metric}`}>
        <TrendChartStatusOverlay
          queryError={queryError}
          isFetching={isFetching}
          chartData={chartData}
          entityRows={entityRows}
          phActiveData={phActiveData}
          metric={metric}
          startKey={s.startKey}
          retryFailedQueries={retryFailedQueries}
        />
        <TrendChartCanvas
          hasRoDrill={s.hasRoDrill} roDrillMode={s.roDrillMode} viewGran={s.viewGran}
          roTrainDrillData={roTrainDrillData} roHourDrillData={roHourDrillData}
          hasConsumptionDrill={s.hasConsumptionDrill} hasPlantHealth={s.hasPlantHealth}
          phDrillMode={s.phDrillMode} phActiveData={phActiveData} phDayFocus={s.phDayFocus}
          metric={metric} drillMode={s.drillMode} chartData={chartData} trendRows={trendRows}
          kwhChartRows={kwhChartRows} kwhSource={s.kwhSource}
          entityRows={entityRows} visibleEntities={visibleEntities}
          wellEntityRows={wellEntityRows} visibleWellEntities={visibleWellEntities}
          visibleTrainEntities={visibleTrainEntities}
          focusedTrendRows={focusedTrendRows} focusedEntityRows={focusedEntityRows}
          drillFocusRange={drillFocusRange}
          formatYAxis={formatYAxis} handleDrillBarActivate={handleDrillBarActivate}
          handlePhDayDotActivate={handlePhDayDotActivate}
          handleLegendIsolate={handleLegendIsolate} handleTrainLegendIsolate={handleTrainLegendIsolate}
          handleWellLegendIsolate={handleWellLegendIsolate}
          NegativeAwareTooltip={NegativeAwareTooltip} PvTooltip={PvTooltip}
          valueKey={valueKey} roUnit={roUnit}
          showTotalCostLine={s.showTotalCostLine} showPowerCostLine={s.showPowerCostLine} showChemCostLine={s.showChemCostLine}
          stackMode={s.stackMode} rawwaterBreakdown={s.rawwaterBreakdown} viewBreakdown={s.viewBreakdown}
          prodDrillSource={s.prodDrillSource}
        />
      </div>

      <TrendChartMetricLegend
        metric={metric}
        hasConsumptionDrill={s.hasConsumptionDrill}
        hasRoDrill={s.hasRoDrill}
        kwhChartRows={kwhChartRows}
        chartData={chartData}
        kwhSource={s.kwhSource}
        showTotalCostLine={s.showTotalCostLine}
        showPowerCostLine={s.showPowerCostLine}
        showChemCostLine={s.showChemCostLine}
      />
    </>
  );
}
