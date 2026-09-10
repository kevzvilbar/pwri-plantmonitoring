import { DSMTab } from '../TrendChartPivotShared';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useDataSummaryData, type DataSummaryDataProps } from './useDataSummaryData';
import { useDataSummaryCsvExport } from './useDataSummaryCsvExport';
import { Header } from './Header';
import { Body } from './Body';
import { Footer } from './Footer';

export function DataSummaryPopup({
  open, onClose, metric, title,
  chartData,
  locReadings, productReadings, wellReadings, costReadings,
  roReadings,
  powerReadings, powerConfigMap, billMultiplierMap,
  permeateIsProductionPlants,
  productExcludedPlants,
  trainPlantMap,
  locatorNames, productMeterNames, wellNames, plantNames, roTrainNames,
  directLocatorIds,
  directMeterIds,
}: DataSummaryDataProps & {
  open: boolean;
  onClose: () => void;
  title?: string;
}) {
  const data = useDataSummaryData({
    open, metric, chartData,
    locReadings, productReadings, wellReadings, costReadings,
    roReadings, powerReadings, powerConfigMap, billMultiplierMap,
    permeateIsProductionPlants, productExcludedPlants, trainPlantMap,
    locatorNames, productMeterNames, wellNames, plantNames, roTrainNames,
    directLocatorIds, directMeterIds,
  });

  const { handleExportCsv } = useDataSummaryCsvExport({
    activeTab: data.activeTab,
    metric,
    overviewChartRows: data.overviewChartRows,
    gridBreakdown: data.gridBreakdown,
    overviewDates: data.overviewDates,
    prodDates: data.prodDates,
    consDates: data.consDates,
    prodEntities: data.prodEntities,
    consEntities: data.consEntities,
    prodPivotMap: data.prodPivotMap,
    consPivot: data.consPivot,
    roTrainEntities: data.roTrainEntities,
    powerReadings,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[94vw] w-full max-h-[90vh] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid={`dsm-popup-${metric}`}
      >
        <DialogHeader className="px-5 pt-4 pb-0 border-b shrink-0 bg-card">
          <Header
            title={title}
            metric={metric}
            onExportCsv={handleExportCsv}
            filterFrom={data.filterFrom}
            filterTo={data.filterTo}
            setFilterFrom={data.setFilterFrom}
            setFilterTo={data.setFilterTo}
            defaultFrom={data.defaultFrom}
            defaultTo={data.defaultTo}
            activeTab={data.activeTab}
            hasProdTab={data.hasProdTab}
            hasConsTab={data.hasConsTab}
            hasGridTab={data.hasGridTab}
            overviewLabel={data.overviewLabel}
            prodTabLabel={data.prodTabLabel}
            setTab={data.setTab}
            summaryStats={data.summaryStats}
            prodEntities={data.prodEntities}
          />

          <DialogDescription className="sr-only">
            Multi-tab data summary for {title ?? metric}.
          </DialogDescription>
        </DialogHeader>

        <Body
          activeTab={data.activeTab}
          metric={metric}
          hasProdTab={data.hasProdTab}
          hasConsTab={data.hasConsTab}
          overviewChartRows={data.overviewChartRows}
          overviewDates={data.overviewDates}
          roTrainEntities={data.roTrainEntities}
          gridBreakdown={data.gridBreakdown}
          prodDates={data.prodDates}
          prodEntities={data.prodEntities}
          prodPivotMap={data.prodPivotMap}
          hasPermeateData={data.hasPermeateData}
          consDates={data.consDates}
          consEntities={data.consEntities}
          consPivot={data.consPivot}
        />

        <Footer
          tabDates={data.tabDates}
          activeTab={data.activeTab}
          hasProdTab={data.hasProdTab}
          hasConsTab={data.hasConsTab}
          hasGridTab={data.hasGridTab}
          metric={metric}
          prodEntities={data.prodEntities}
          consEntities={data.consEntities}
          gridBreakdown={data.gridBreakdown}
        />
      </DialogContent>
    </Dialog>
  );
}
