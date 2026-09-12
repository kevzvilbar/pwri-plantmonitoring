import { PivotTable, OverviewTable, GridMeterBreakdownTable, ChemicalBreakdownTable, type ChemicalDayBreakdown } from '../TrendChartTables';
import type { GridMeterBreakdown } from '../TrendChartPivotShared';

interface BodyProps {
  activeTab: string;
  metric: string;
  hasProdTab: boolean;
  hasConsTab: boolean;
  overviewChartRows: any[];
  overviewDates: string[];
  roTrainEntities: { id: string; label: string }[];
  phHealthByDate?: Map<string, {
    trainOnline: Record<string, boolean>;
    trainHours: Record<string, number>;
    onlineCount: number;
    offlineCount: number;
    healthPct: number | null;
    totalTrains: number;
  }>;
  gridBreakdown: GridMeterBreakdown;
  prodDates: string[];
  prodEntities: { id: string; label: string; kind: string }[];
  prodPivotMap: Map<string, Map<string, number>>;
  hasPermeateData: boolean;
  consDates: string[];
  consEntities: { id: string; label: string }[];
  consPivot: Map<string, Map<string, number>>;
  chemicalBreakdown?: Map<string, ChemicalDayBreakdown>;
}

export function Body({
  activeTab, metric, hasProdTab, hasConsTab,
  overviewChartRows, overviewDates, roTrainEntities, phHealthByDate,
  gridBreakdown, prodDates, prodEntities, prodPivotMap, hasPermeateData,
  consDates, consEntities, consPivot, chemicalBreakdown,
}: BodyProps) {
  return (
    <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {activeTab === 'overview' && (
          metric === 'rawwater' ? (
            <PivotTable
              dates={prodDates}
              entities={prodEntities}
              pivot={prodPivotMap}
              totalLabel="Total Raw (m³)"
              unit="m³"
              colorClass="text-primary"
              entityType="well"
            />
          ) : (
            <OverviewTable
              metric={metric}
              chartData={overviewChartRows}
              roTrainEntities={roTrainEntities}
              phHealthByDate={phHealthByDate}
            />
          )
        )}
        {activeTab === 'chemical-breakdown' && (
          <ChemicalBreakdownTable
            dates={overviewDates}
            chemicalBreakdown={chemicalBreakdown ?? new Map()}
            overviewChartRows={overviewChartRows}
          />
        )}
        {activeTab === 'grid-by-meter' && (
          <GridMeterBreakdownTable dates={overviewDates} breakdown={gridBreakdown} />
        )}
        {activeTab === 'production' && hasProdTab && (
          <PivotTable
            dates={prodDates}
            entities={prodEntities}
            pivot={prodPivotMap}
            totalLabel="Total Prod. (m³)"
            unit="m³"
            colorClass="text-primary"
            entityType={metric === 'pv' ? 'well' : hasPermeateData ? 'ro_train' : 'meter'}
          />
        )}
        {activeTab === 'consumption' && hasConsTab && (
          <PivotTable
            dates={consDates}
            entities={consEntities}
            pivot={consPivot}
            totalLabel="Total Cons. (m³)"
            unit="m³"
            colorClass="text-highlight"
            entityType="locator"
          />
        )}
      </div>
    </div>
  );
}
