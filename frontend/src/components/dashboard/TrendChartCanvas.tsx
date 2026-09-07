// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This is the actual <ResponsiveContainer> chart body: one
// big conditional tree picking between chart types/series depending on
// metric + drill mode/granularity (by-train RO drilldown, by-hour RO
// drilldown, kwh stacked bars, Plant Health, Raw Water, Permeate TDS, the
// default production/recovery/NRW/cost view, and their own drilldown
// variants). Every branch is a pure function of the props below — no
// state, no queries, no memoization of its own.
//
// Moved verbatim from TrendChart.tsx — no logic or markup changes, only
// the props needed to reach the free variables it already used.
import React from 'react';
import { ResponsiveContainer } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/appStore';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import {
  RoDrillByTrainChart,
  RoDrillByTrainBarChart,
  RoDrillByHourChart,
  ConsumptionDrillDailyChart,
  ConsumptionDrillBarChart,
  NrwChart,
  CostAreaChart,
  ProductionCostStackedChart,
  ProductionCostLineChart,
  PvChart,
  KwhChart,
  PlantHealthChart,
  RawWaterByWellDailyChart,
  RawWaterByWellBarChart,
  RawWaterAreaChart,
  TdsAreaChart,
  DefaultAreaChart,
} from './TrendChartCanvas/index';

export function TrendChartCanvas(props: Record<string, any>) {
  const {
    hasRoDrill, roDrillMode, viewGran, roTrainDrillData, roHourDrillData,
    hasConsumptionDrill, hasPlantHealth, phDrillMode, phActiveData,
    metric, drillMode, chartData, trendRows, kwhChartRows, kwhSource,
    entityRows, visibleEntities, wellEntityRows, visibleWellEntities, visibleTrainEntities,
    focusedTrendRows, focusedEntityRows, drillFocusRange,
    formatYAxis, handleDrillBarActivate, handlePhDayDotActivate,
    handleLegendIsolate, handleTrainLegendIsolate, handleWellLegendIsolate,
    NegativeAwareTooltip, PvTooltip, valueKey, roUnit,
    showTotalCostLine, showPowerCostLine, showChemCostLine,
    stackMode, rawwaterBreakdown, prodDrillSource,
  } = props;

  const selectedPlantId = useAppStore((s) => s.selectedPlantId);
  const thresholdScope = selectedPlantId || 'global';
  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', thresholdScope],
    queryFn: () => loadThresholds(thresholdScope),
    staleTime: 2 * 60_000,
  });
  const nrwLimitPct = thresholds?.nrw_pct_max ?? DEFAULT_THRESHOLDS.nrw_pct_max;
  const pvLimitMax = thresholds?.pv_ratio_max ?? DEFAULT_THRESHOLDS.pv_ratio_max;
  const recoveryMinPct = thresholds?.recovery_pct_min ?? DEFAULT_THRESHOLDS.recovery_pct_min;
  const permTdsMax = thresholds?.permeate_tds_max ?? DEFAULT_THRESHOLDS.permeate_tds_max;

  return (
    <ResponsiveContainer width="100%" height="100%">
      {(hasRoDrill && roDrillMode === 'by-train' && viewGran === 'daily') ? (
        <RoDrillByTrainChart
          roTrainDrillData={roTrainDrillData}
          roUnit={roUnit}
          handleTrainLegendIsolate={handleTrainLegendIsolate}
          visibleTrainEntities={visibleTrainEntities}
        />
      ) : (hasRoDrill && roDrillMode === 'by-train') ? (
        <RoDrillByTrainBarChart
          roTrainDrillData={roTrainDrillData}
          roUnit={roUnit}
          handleTrainLegendIsolate={handleTrainLegendIsolate}
          visibleTrainEntities={visibleTrainEntities}
          stackMode={stackMode}
          drillFocusRange={drillFocusRange}
          handleDrillBarActivate={handleDrillBarActivate}
        />
      ) : (hasRoDrill && roDrillMode === 'by-hour') ? (
        <RoDrillByHourChart
          roHourDrillData={roHourDrillData}
          metric={metric}
          roUnit={roUnit}
        />
      ) : (hasConsumptionDrill && drillMode === 'drilldown' && viewGran === 'daily') ? (
        <ConsumptionDrillDailyChart
          focusedEntityRows={focusedEntityRows}
          formatYAxis={formatYAxis}
          handleLegendIsolate={handleLegendIsolate}
          visibleEntities={visibleEntities}
        />
      ) : (hasConsumptionDrill && drillMode === 'drilldown') ? (
        <ConsumptionDrillBarChart
          focusedEntityRows={focusedEntityRows}
          formatYAxis={formatYAxis}
          handleLegendIsolate={handleLegendIsolate}
          visibleEntities={visibleEntities}
          stackMode={stackMode}
          handleDrillBarActivate={handleDrillBarActivate}
        />
      ) : metric === 'nrw' ? (
        <NrwChart
          focusedTrendRows={focusedTrendRows}
          formatYAxis={formatYAxis}
          handleDrillBarActivate={handleDrillBarActivate}
          nrwLimitPct={nrwLimitPct}
          stackMode={stackMode}
          NegativeAwareTooltip={NegativeAwareTooltip}
        />
      ) : metric === 'chemCost' ? (
        <CostAreaChart
          data={chartData}
          dataKey="chemCost"
          strokeColor="hsl(var(--highlight))"
          fillId="chemCostFill"
          name="Chemical Cost (₱)"
          formatYAxis={formatYAxis}
          NegativeAwareTooltip={NegativeAwareTooltip}
        />
      ) : metric === 'powerCost' ? (
        <CostAreaChart
          data={chartData}
          dataKey="powerCost"
          strokeColor="hsl(var(--chart-6))"
          fillId="powerCostFill"
          name="Power Cost (₱)"
          formatYAxis={formatYAxis}
          NegativeAwareTooltip={NegativeAwareTooltip}
        />
      ) : (metric === 'productionCost' && stackMode === 'stacked') ? (
        <ProductionCostStackedChart
          trendRows={trendRows}
          formatYAxis={formatYAxis}
          showPowerCostLine={showPowerCostLine}
          showChemCostLine={showChemCostLine}
        />
      ) : metric === 'productionCost' ? (
        <ProductionCostLineChart
          trendRows={trendRows}
          formatYAxis={formatYAxis}
          showTotalCostLine={showTotalCostLine}
          showPowerCostLine={showPowerCostLine}
          showChemCostLine={showChemCostLine}
        />
      ) : metric === 'pv' ? (
        <PvChart
          trendRows={trendRows}
          pvLimitMax={pvLimitMax}
          PvTooltip={PvTooltip}
        />
      ) : metric === 'kwh' ? (
        <KwhChart
          kwhChartRows={kwhChartRows}
          formatYAxis={formatYAxis}
          hasSolarData={chartData.some((d: any) => (d.solarKwh ?? 0) > 0)}
          hasGridData={chartData.some((d: any) => (d.kwh ?? 0) > 0)}
          kwhSource={kwhSource}
          stackMode={stackMode}
        />
      ) : hasPlantHealth ? (
        <PlantHealthChart
          phActiveData={phActiveData}
          phDrillMode={phDrillMode}
          handlePhDayDotActivate={handlePhDayDotActivate}
        />
      ) : (metric === 'rawwater' && rawwaterBreakdown === 'by-well' && viewGran === 'daily') ? (
        <RawWaterByWellDailyChart
          wellEntityRows={wellEntityRows}
          formatYAxis={formatYAxis}
          handleWellLegendIsolate={handleWellLegendIsolate}
          visibleWellEntities={visibleWellEntities}
        />
      ) : (metric === 'rawwater' && rawwaterBreakdown === 'by-well') ? (
        <RawWaterByWellBarChart
          wellEntityRows={wellEntityRows}
          formatYAxis={formatYAxis}
          handleWellLegendIsolate={handleWellLegendIsolate}
          visibleWellEntities={visibleWellEntities}
          stackMode={stackMode}
          drillFocusRange={drillFocusRange}
          handleDrillBarActivate={handleDrillBarActivate}
        />
      ) : metric === 'rawwater' ? (
        <RawWaterAreaChart
          trendRows={trendRows}
          formatYAxis={formatYAxis}
          NegativeAwareTooltip={NegativeAwareTooltip}
        />
      ) : (metric === 'tds' && roDrillMode === 'default') ? (
        <TdsAreaChart
          trendRows={trendRows}
          formatYAxis={formatYAxis}
          permTdsMax={permTdsMax}
          NegativeAwareTooltip={NegativeAwareTooltip}
        />
      ) : (
        <DefaultAreaChart
          trendRows={trendRows}
          metric={metric}
          roDrillMode={roDrillMode}
          formatYAxis={formatYAxis}
          recoveryMinPct={recoveryMinPct}
          permTdsMax={permTdsMax}
          NegativeAwareTooltip={NegativeAwareTooltip}
        />
      )}
    </ResponsiveContainer>
  );
}
