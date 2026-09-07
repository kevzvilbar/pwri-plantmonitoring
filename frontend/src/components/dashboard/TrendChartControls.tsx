// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This is the `trailingControls` content passed to
// TrendChartToolbar: the mobile "..." popover plus the per-metric secondary
// controls row (granularity/breakdown toggles, cost-line checkboxes, kwh
// source picker, drill-mode switches, CSV export, etc.) — everything the
// user can adjust about how the current metric's chart is displayed, as
// opposed to filtering WHICH entities it displays (that's
// TrendChartFilterPanels' job).
//
// Moved verbatim from TrendChart.tsx — no logic or markup changes.
import { isGranularityUsable } from './TrendChartAggregate';
import { GranularityControl, StackToggle } from './TrendChartDrill';
import { TrendChartMobilePopover } from './TrendChartControls/TrendChartMobilePopover';
import { KwhDesktopControls } from './TrendChartControls/KwhDesktopControls';
import { ProductionCostDesktopControls } from './TrendChartControls/ProductionCostDesktopControls';
import { PvDesktopControls } from './TrendChartControls/PvDesktopControls';
import { RawWaterDesktopControls } from './TrendChartControls/RawWaterDesktopControls';
import { ProductionDrillControls } from './TrendChartControls/ProductionDrillControls';
import { TdsDrillControls } from './TrendChartControls/TdsDrillControls';
import { PlantHealthControls } from './TrendChartControls/PlantHealthControls';
import { TrainFilterPanel } from './TrendChartControls/TrainFilterPanel';
import { LocatorFilterPanel } from './TrendChartControls/LocatorFilterPanel';
import { WellFilterPanel } from './TrendChartControls/WellFilterPanel';

export function TrendChartControls(props: Record<string, any>) {
  const {
    metric, compact, viewGran, setViewGran, viewBreakdown, setViewBreakdown,
    rawwaterBreakdown, setRawwaterBreakdown, stackMode, setStackMode,
    kwhSource, setKwhSource, chartData, range, rangeDays,
    selectedLocatorIds, setSelectedLocatorIds, selectedWellIds, setSelectedWellIds,
    roDrillMode, setRoDrillMode, showTrainFilter, setShowTrainFilter,
    showWellFilter, setShowWellFilter,
    phDrillMode, setPhDrillMode, phDayFocus, setPhDayFocus,
    showTotalCostLine, setShowTotalCostLine, showPowerCostLine, setShowPowerCostLine,
    showChemCostLine, setShowChemCostLine, prodDrillSource, usePermeateForSource, drillMode,
    hasConsumptionDrill, hasRoDrill, hasPlantHealth,
    allSelected, noneSelected, selectAllLocators, clearAllLocators, toggleLocator,
    allWellsSelected, noneWellsSelected, selectAllWells, clearAllWells, toggleWell,
    allTrainsSelected, noTrainsSelected, selectAllTrains, clearAllTrains, toggleTrain,
    drillEntities, roTrainEntities, selectedTrainIds, wellEntities,
    filteredLocatorList, filteredTrainList, filteredWellList,
    locatorSearch, setLocatorSearch, trainSearch, setTrainSearch, wellSearch, setWellSearch,
    showLocatorFilter, setShowLocatorFilter,
    locatorTotals, wellTotals, selectTopNLocators, selectTopNWells,
  } = props;

  return (
    <>
      <TrendChartMobilePopover
        metric={metric} rangeDays={rangeDays}
        hasConsumptionDrill={hasConsumptionDrill} hasRoDrill={hasRoDrill} hasPlantHealth={hasPlantHealth}
        viewGran={viewGran} setViewGran={setViewGran}
        viewBreakdown={viewBreakdown} setViewBreakdown={setViewBreakdown}
        rawwaterBreakdown={rawwaterBreakdown} setRawwaterBreakdown={setRawwaterBreakdown}
        stackMode={stackMode} setStackMode={setStackMode}
        roDrillMode={roDrillMode} setRoDrillMode={setRoDrillMode}
        phDrillMode={phDrillMode} setPhDrillMode={setPhDrillMode}
        kwhSource={kwhSource} setKwhSource={setKwhSource}
        chartData={chartData} usePermeateForSource={usePermeateForSource}
        showLocatorFilter={showLocatorFilter} setShowLocatorFilter={setShowLocatorFilter}
      />

      {/* Desktop-only secondary controls */}
      <div className="hidden sm:contents">
        {metric === 'kwh' && (
          <KwhDesktopControls
            viewGran={viewGran} setViewGran={setViewGran} rangeDays={rangeDays}
            kwhSource={kwhSource} setKwhSource={setKwhSource}
            stackMode={stackMode} setStackMode={setStackMode}
            chartData={chartData} metric={metric}
          />
        )}
        {metric === 'productionCost' && (
          <ProductionCostDesktopControls
            viewGran={viewGran} setViewGran={setViewGran} rangeDays={rangeDays}
            metric={metric} stackMode={stackMode} setStackMode={setStackMode}
            showTotalCostLine={showTotalCostLine} setShowTotalCostLine={setShowTotalCostLine}
            showPowerCostLine={showPowerCostLine} setShowPowerCostLine={setShowPowerCostLine}
            showChemCostLine={showChemCostLine} setShowChemCostLine={setShowChemCostLine}
          />
        )}
        {metric === 'pv' && (
          <PvDesktopControls
            viewGran={viewGran} setViewGran={setViewGran} rangeDays={rangeDays} metric={metric}
          />
        )}
        {metric === 'rawwater' && (
          <RawWaterDesktopControls
            viewGran={viewGran} setViewGran={setViewGran} rangeDays={rangeDays} metric={metric}
            rawwaterBreakdown={rawwaterBreakdown} setRawwaterBreakdown={setRawwaterBreakdown}
            selectedWellIds={selectedWellIds} setSelectedWellIds={setSelectedWellIds}
            showWellFilter={showWellFilter} setShowWellFilter={setShowWellFilter}
            allWellsSelected={allWellsSelected} wellEntities={wellEntities}
          />
        )}
        {hasConsumptionDrill && (
          <ProductionDrillControls
            metric={metric} viewGran={viewGran} setViewGran={setViewGran} rangeDays={rangeDays}
            viewBreakdown={viewBreakdown} setViewBreakdown={setViewBreakdown}
            selectedLocatorIds={selectedLocatorIds} setSelectedLocatorIds={setSelectedLocatorIds}
            showLocatorFilter={showLocatorFilter} setShowLocatorFilter={setShowLocatorFilter}
            allSelected={allSelected} noneSelected={noneSelected}
            drillEntities={drillEntities} usePermeateForSource={usePermeateForSource}
            stackMode={stackMode} setStackMode={setStackMode}
            selectAllLocators={selectAllLocators} clearAllLocators={clearAllLocators}
            toggleLocator={toggleLocator}
          />
        )}
        {hasRoDrill && (
          <TdsDrillControls
            viewGran={viewGran} setViewGran={setViewGran} rangeDays={rangeDays} metric={metric}
            roDrillMode={roDrillMode} setRoDrillMode={setRoDrillMode}
            showTrainFilter={showTrainFilter} setShowTrainFilter={setShowTrainFilter}
            allTrainsSelected={allTrainsSelected} noTrainsSelected={noTrainsSelected}
            roTrainEntities={roTrainEntities} selectedTrainIds={selectedTrainIds}
            stackMode={stackMode} setStackMode={setStackMode}
            selectAllTrains={selectAllTrains} clearAllTrains={clearAllTrains}
            toggleTrain={toggleTrain}
          />
        )}
        {hasPlantHealth && (
          <PlantHealthControls
            phDrillMode={phDrillMode} setPhDrillMode={setPhDrillMode}
            setPhDayFocus={setPhDayFocus} rangeDays={rangeDays} phDayFocus={phDayFocus}
          />
        )}
      </div>

      <TrainFilterPanel
        roTrainEntities={roTrainEntities}
        selectedTrainIds={selectedTrainIds}
        showTrainFilter={showTrainFilter}
        allTrainsSelected={allTrainsSelected}
        noTrainsSelected={noTrainsSelected}
        trainSearch={trainSearch}
        filteredTrainList={filteredTrainList}
        selectAllTrains={selectAllTrains}
        clearAllTrains={clearAllTrains}
        setShowTrainFilter={setShowTrainFilter}
        setTrainSearch={setTrainSearch}
        toggleTrain={toggleTrain}
      />

      <LocatorFilterPanel
        metric={metric}
        showLocatorFilter={showLocatorFilter}
        allSelected={allSelected}
        noneSelected={noneSelected}
        drillEntities={drillEntities}
        selectedLocatorIds={selectedLocatorIds}
        filteredLocatorList={filteredLocatorList}
        locatorSearch={locatorSearch}
        locatorTotals={locatorTotals}
        selectAllLocators={selectAllLocators}
        clearAllLocators={clearAllLocators}
        setShowLocatorFilter={setShowLocatorFilter}
        setLocatorSearch={setLocatorSearch}
        toggleLocator={toggleLocator}
        selectTopNLocators={selectTopNLocators}
      />

      <WellFilterPanel
        metric={metric}
        showWellFilter={showWellFilter}
        allWellsSelected={allWellsSelected}
        noneWellsSelected={noneWellsSelected}
        wellEntities={wellEntities}
        selectedWellIds={selectedWellIds}
        wellSearch={wellSearch}
        filteredWellList={filteredWellList}
        wellTotals={wellTotals}
        selectAllWells={selectAllWells}
        clearAllWells={clearAllWells}
        setShowWellFilter={setShowWellFilter}
        setWellSearch={setWellSearch}
        toggleWell={toggleWell}
        selectTopNWells={selectTopNWells}
      />
    </>
  );
}
