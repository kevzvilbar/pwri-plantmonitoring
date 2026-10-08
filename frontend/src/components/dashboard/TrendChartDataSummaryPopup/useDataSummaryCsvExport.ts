import { format } from 'date-fns';
import {
  DSMTab, type GridPowerReadingRow,
  GRID_METER_OTHER_KEY, type GridMeterBreakdown,
} from '../TrendChartPivotShared';
import type { ChemicalDayBreakdown } from '../TrendChartTables';
import { downloadCSVMatrix } from '@/shared/csv';

export interface CsvExportOptions {
  activeTab: DSMTab;
  metric: string;
  overviewChartRows: any[];
  gridBreakdown: GridMeterBreakdown;
  overviewDates: string[];
  prodDates: string[];
  consDates: string[];
  prodEntities: { id: string; label: string }[];
  consEntities: { id: string; label: string }[];
  prodPivotMap: Map<string, Map<string, number>>;
  consPivot: Map<string, Map<string, number>>;
  roTrainEntities: { id: string; label: string }[];
  roTrainPermeatePivot?: Map<string, Map<string, number>>;
  roTrainRejectPivot?: Map<string, Map<string, number>>;
  powerReadings?: GridPowerReadingRow[];
  chemicalBreakdown?: Map<string, ChemicalDayBreakdown>;
}

export function useDataSummaryCsvExport({
  activeTab, metric, overviewChartRows,
  gridBreakdown, overviewDates, prodDates, consDates,
  prodEntities, consEntities, prodPivotMap, consPivot,
  roTrainEntities, roTrainPermeatePivot, roTrainRejectPivot,
  chemicalBreakdown,
}: CsvExportOptions) {
  const handleExportCsv = () => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];

    if (activeTab === 'overview') {
      if (metric === 'kwh') {
        headers = ['Date', 'Solar (kWh)', 'Grid (kWh)', 'Total (kWh)', 'Solar (%)'];
        rows = overviewChartRows.map((r) => {
          const solar = +(r.solarKwh ?? 0);
          const grid = +(r.kwh ?? 0);
          const total = solar + grid;
          const pct = total > 0 && solar > 0 ? ((solar / total) * 100).toFixed(1) + '%' : '—';
          return [r.date, solar > 0 ? solar.toFixed(1) : '', grid > 0 ? grid.toFixed(1) : '', total > 0 ? total.toFixed(1) : '', pct];
        });
      } else if (metric === 'pv') {
        headers = ['Date', 'Production (m3)', 'Grid (kWh)', 'Solar (kWh)', 'Grid PV (kWh/m3)', '(Grid+Solar) PV (kWh/m3)'];
        rows = overviewChartRows.map((r) => {
          const prod = r.production != null ? (+r.production).toFixed(2) : '';
          const grid = r.kwh != null ? (+r.kwh).toFixed(2) : '';
          const solar = (r.solarKwh ?? 0) !== 0 ? (+r.solarKwh).toFixed(2) : '';
          const pvGrid = r.production > 0 && r.kwh != null ? (r.kwh / r.production).toFixed(2) : '';
          const pvTot = r.production > 0 && ((r.kwh ?? 0) + (r.solarKwh ?? 0)) > 0 ? (((r.kwh ?? 0) + (r.solarKwh ?? 0)) / r.production).toFixed(2) : '';
          return [r.date, prod, grid, solar, pvGrid, pvTot];
        });
      } else if (metric === 'productionCost' || metric === 'chemCost' || metric === 'powerCost') {
        headers = ['Date', 'Power (PHP/m3)', 'Chem (PHP/m3)', 'Prod Cost (PHP/m3)'];
        rows = overviewChartRows.map((r) => [
          r.date,
          r.powerCost != null ? (+r.powerCost).toFixed(4) : '',
          r.chemCost != null ? (+r.chemCost).toFixed(4) : '',
          r.totalCost != null ? (+r.totalCost).toFixed(4) : '',
        ]);
      } else if (metric === 'rawwater') {
        headers = ['Date', ...prodEntities.map((e) => e.label), 'Total Raw (m3)'];
        rows = [...prodDates].reverse().map((d) => {
          const entityVals = prodEntities.map((e) => prodPivotMap.get(d)?.get(e.id) ?? 0);
          const rowTot = entityVals.reduce((a, b) => a + b, 0);
          return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals, rowTot > 0 ? rowTot : ''];
        });
      } else if (metric === 'recovery') {
        const trainCols = roTrainEntities.map((e) => `${e.label} (%)`);
        headers = ['Date', ...trainCols, ...(roTrainEntities.length > 1 ? ['Avg Recovery (%)'] : ['Recovery (%)'])];
        rows = overviewChartRows.map((r) => {
          const trainVals = roTrainEntities.map((e) => r.trainRecoveries?.[e.id] != null ? `${r.trainRecoveries[e.id]}%` : '');
          const avgVal = r.recovery != null ? `${r.recovery}%` : '';
          return [r.date, ...trainVals, avgVal];
        });
      } else if (metric === 'tds') {
        const trainCols = roTrainEntities.map((e) => `${e.label} (ppm)`);
        headers = ['Date', ...trainCols, ...(roTrainEntities.length > 1 ? ['Avg Permeate TDS (ppm)'] : ['Permeate TDS (ppm)'])];
        rows = overviewChartRows.map((r) => {
          const trainVals = roTrainEntities.map((e) => r.trainTds?.[e.id] != null ? `${r.trainTds[e.id]} ppm` : '');
          const avgVal = r.tds != null ? `${r.tds} ppm` : '';
          return [r.date, ...trainVals, avgVal];
        });
      } else if (metric === 'chlorine') {
        const trainCols = roTrainEntities.map((e) => `${e.label} (mg/L)`);
        headers = [
          'Date',
          ...trainCols,
          ...(roTrainEntities.length > 1 ? ['Avg Residual (mg/L)'] : ['Residual (mg/L)']),
          'Compliance Status',
        ];
        rows = overviewChartRows.map((r) => {
          const trainVals = roTrainEntities.map((e) =>
            r.trainChlorine?.[e.id] != null ? `${(+r.trainChlorine[e.id]).toFixed(2)}` : '',
          );
          const avgVal = r.chlorine != null ? `${(+r.chlorine).toFixed(2)}` : '';
          let status = '';
          if (r.chlorine != null) {
            if (r.chlorine > 3.0) status = 'Suspect (>3.0)';
            else if (r.chlorine > 1.5) status = 'High (>1.5)';
            else if (r.chlorine < 0.3) status = 'Low (<0.3)';
            else status = 'In Range';
          }
          return [r.date, ...trainVals, avgVal, status];
        });
      } else if (metric === 'roFlowBalance') {
        headers = ['Date', 'Feed Water (m3)', 'Permeate (m3)', 'Reject (m3)', 'Expected Feed (m3)', 'Variance (m3)', 'Variance (%)'];
        rows = overviewChartRows.map((r) => {
          const feed = r.feed != null && r.feed > 0 ? (+r.feed).toFixed(2) : '';
          const perm = r.permeate != null && r.permeate > 0 ? (+r.permeate).toFixed(2) : '';
          const rej = r.reject != null && r.reject > 0 ? (+r.reject).toFixed(2) : '';
          const exp = r.expectedFeed != null ? (+r.expectedFeed).toFixed(2) : (perm && rej ? (+perm + +rej).toFixed(2) : '');
          const diff = r.variance != null ? (+r.variance).toFixed(2) : '';
          const pct = r.variancePct != null ? `${(+r.variancePct).toFixed(1)}%` : '';
          return [r.date, feed, perm, rej, exp, diff, pct];
        });
      } else {
        headers = ['Date', 'Production (m3)', 'Consumption (m3)', ...(metric === 'nrw' ? ['NRW (%)'] : [])];
        rows = overviewChartRows.map(r => [
          r.date,
          r.production ?? '',
          r.consumption ?? '',
          ...(metric === 'nrw' ? [r.nrw != null ? `${r.nrw}%` : ''] : []),
        ]);
      }
    } else if (activeTab === 'grid-by-meter') {
      const cols = gridBreakdown.hasUnattributed
        ? [...gridBreakdown.columns, { key: GRID_METER_OTHER_KEY, label: 'Other' }]
        : gridBreakdown.columns;
      headers = ['Date', ...cols.map((c) => c.label), 'Total (kWh)'];
      rows = [...overviewDates].reverse().map((dk) => {
        const row = gridBreakdown.byDate.get(dk);
        const vals = cols.map((c) => {
          const v = row?.values[c.key];
          return v != null ? v.toFixed(1) : '';
        });
        const tot = row && row.total > 0 ? row.total.toFixed(1) : '';
        return [format(new Date(dk + 'T00:00:00'), 'MMM d'), ...vals, tot];
      });
    } else if (activeTab === 'production') {
      headers = ['Date', ...prodEntities.map(e => e.label), 'Total (m3)'];
      rows = [...prodDates].reverse().map(d => {
        const entityVals = prodEntities.map(e => prodPivotMap.get(d)?.get(e.id) ?? 0);
        const rowTot = entityVals.reduce((a, b) => a + b, 0);
        return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals, rowTot];
      });
    } else if (activeTab === 'consumption') {
      headers = ['Date', ...consEntities.map(e => e.label), 'Total (m3)'];
      rows = [...consDates].reverse().map(d => {
        const entityVals = consEntities.map(e => consPivot.get(d)?.get(e.id) ?? 0);
        const rowTot = entityVals.reduce((a, b) => a + b, 0);
        return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals, rowTot];
      });
    } else if (activeTab === 'permeate') {
      headers = ['Date', ...roTrainEntities.map((e) => e.label), 'Total Permeate (m3)'];
      rows = [...overviewDates].reverse().map((d) => {
        const entityVals = roTrainEntities.map((e) => roTrainPermeatePivot?.get(d)?.get(e.id) ?? 0);
        const rowTot = entityVals.reduce((a, b) => a + b, 0);
        return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals.map((v) => v > 0 ? v.toFixed(2) : ''), rowTot > 0 ? rowTot.toFixed(2) : ''];
      });
    } else if (activeTab === 'reject') {
      headers = ['Date', ...roTrainEntities.map((e) => e.label), 'Total Reject (m3)'];
      rows = [...overviewDates].reverse().map((d) => {
        const entityVals = roTrainEntities.map((e) => roTrainRejectPivot?.get(d)?.get(e.id) ?? 0);
        const rowTot = entityVals.reduce((a, b) => a + b, 0);
        return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals.map((v) => v > 0 ? v.toFixed(2) : ''), rowTot > 0 ? rowTot.toFixed(2) : ''];
      });
    } else if (activeTab === 'chemical-breakdown') {
      headers = [
        'Date',
        'Chlorine (kg)', 'Chlorine (PHP)',
        'SMBS (kg)', 'SMBS (PHP)',
        'Anti Scalant (L)', 'Anti Scalant (PHP)',
        'Soda Ash (kg)', 'Soda Ash (PHP)',
        'Total Chem Cost (PHP)',
        'Output (m3)',
        'Chem Cost (PHP/m3)',
      ];
      rows = [...overviewDates].reverse().map((dk) => {
        const row = chemicalBreakdown?.get(dk);
        const dateLabel = format(new Date(dk + 'T00:00:00'), 'MMM d');
        return [
          dateLabel,
          row?.chlorineKg ? row.chlorineKg.toFixed(2) : '',
          row?.chlorineCost ? row.chlorineCost.toFixed(2) : '',
          row?.smbsKg ? row.smbsKg.toFixed(2) : '',
          row?.smbsCost ? row.smbsCost.toFixed(2) : '',
          row?.antiScalantL ? row.antiScalantL.toFixed(2) : '',
          row?.antiScalantCost ? row.antiScalantCost.toFixed(2) : '',
          row?.sodaAshKg ? row.sodaAshKg.toFixed(2) : '',
          row?.sodaAshCost ? row.sodaAshCost.toFixed(2) : '',
          row?.totalCost ? row.totalCost.toFixed(2) : '',
          row?.prodVol ? row.prodVol.toFixed(2) : '',
          row?.chemCostPerM3 ? row.chemCostPerM3.toFixed(4) : '',
        ];
      });
    }

    if (headers.length > 0) {
      downloadCSVMatrix(
        `data-summary-${metric}-${activeTab}-${format(new Date(), 'yyyyMMdd')}.csv`,
        headers,
        rows,
      );
    }
  };

  return { handleExportCsv };
}
