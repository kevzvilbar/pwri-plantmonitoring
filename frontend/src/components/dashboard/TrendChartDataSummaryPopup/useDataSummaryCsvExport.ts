import { useMemo } from 'react';
import { format } from 'date-fns';
import {
  DSMTab, buildKwhSummaryCsv, type GridPowerReadingRow,
  GRID_METER_OTHER_KEY, type GridMeterBreakdown,
} from '../TrendChartPivotShared';

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
  powerReadings?: GridPowerReadingRow[];
}

export function useDataSummaryCsvExport({
  activeTab, metric, overviewChartRows,
  gridBreakdown, overviewDates, prodDates, consDates,
  prodEntities, consEntities, prodPivotMap, consPivot,
  roTrainEntities, powerReadings,
}: CsvExportOptions) {
  const handleExportCsv = () => {
    let csvContent = '';

    if (activeTab === 'overview') {
      if (metric === 'kwh') {
        const headers = ['Date', 'Solar (kWh)', 'Grid (kWh)', 'Total (kWh)', 'Solar (%)'];
        const rows = overviewChartRows.map((r) => {
          const solar = +(r.solarKwh ?? 0);
          const grid = +(r.kwh ?? 0);
          const total = solar + grid;
          const pct = total > 0 && solar > 0 ? ((solar / total) * 100).toFixed(1) + '%' : '—';
          return [r.date, solar > 0 ? solar.toFixed(1) : '', grid > 0 ? grid.toFixed(1) : '', total > 0 ? total.toFixed(1) : '', pct].join(',');
        });
        csvContent = [headers.join(','), ...rows].join('\n');
      } else if (metric === 'pv') {
        const headers = ['Date', 'Production (m3)', 'Grid (kWh)', 'Solar (kWh)', 'Grid PV (kWh/m3)', '(Grid+Solar) PV (kWh/m3)'];
        const rows = overviewChartRows.map((r) => {
          const prod = r.production != null ? (+r.production).toFixed(2) : '';
          const grid = r.kwh != null ? (+r.kwh).toFixed(2) : '';
          const solar = (r.solarKwh ?? 0) !== 0 ? (+r.solarKwh).toFixed(2) : '';
          const pvGrid = r.production > 0 && r.kwh != null ? (r.kwh / r.production).toFixed(2) : '';
          const pvTot = r.production > 0 && ((r.kwh ?? 0) + (r.solarKwh ?? 0)) > 0 ? (((r.kwh ?? 0) + (r.solarKwh ?? 0)) / r.production).toFixed(2) : '';
          return [r.date, prod, grid, solar, pvGrid, pvTot].join(',');
        });
        csvContent = [headers.join(','), ...rows].join('\n');
      } else if (metric === 'productionCost' || metric === 'chemCost' || metric === 'powerCost') {
        const headers = ['Date', 'Power (PHP/m3)', 'Chem (PHP/m3)', 'Prod Cost (PHP/m3)'];
        const rows = overviewChartRows.map((r) => [
          r.date,
          r.powerCost != null ? (+r.powerCost).toFixed(4) : '',
          r.chemCost != null ? (+r.chemCost).toFixed(4) : '',
          r.totalCost != null ? (+r.totalCost).toFixed(4) : '',
        ].join(','));
        csvContent = [headers.join(','), ...rows].join('\n');
      } else if (metric === 'rawwater') {
        const headers = ['Date', ...prodEntities.map((e) => `"${e.label.replace(/"/g, '""')}"`), 'Total Raw (m3)'];
        const rows = [...prodDates].reverse().map((d) => {
          const entityVals = prodEntities.map((e) => prodPivotMap.get(d)?.get(e.id) ?? 0);
          const rowTot = entityVals.reduce((a, b) => a + b, 0);
          return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals, rowTot > 0 ? rowTot : ''].join(',');
        });
        csvContent = [headers.join(','), ...rows].join('\n');
      } else if (metric === 'recovery') {
        const trainCols = roTrainEntities.map((e) => `"${e.label.replace(/"/g, '""')} (%)"`);
        const headers = ['Date', ...trainCols, ...(roTrainEntities.length > 1 ? ['Avg Recovery (%)'] : ['Recovery (%)'])];
        const rows = overviewChartRows.map((r) => {
          const trainVals = roTrainEntities.map((e) => r.trainRecoveries?.[e.id] != null ? `${r.trainRecoveries[e.id]}%` : '');
          const avgVal = r.recovery != null ? `${r.recovery}%` : '';
          return [r.date, ...trainVals, avgVal].join(',');
        });
        csvContent = [headers.join(','), ...rows].join('\n');
      } else if (metric === 'tds') {
        const trainCols = roTrainEntities.map((e) => `"${e.label.replace(/"/g, '""')} (ppm)"`);
        const headers = ['Date', ...trainCols, ...(roTrainEntities.length > 1 ? ['Avg Permeate TDS (ppm)'] : ['Permeate TDS (ppm)'])];
        const rows = overviewChartRows.map((r) => {
          const trainVals = roTrainEntities.map((e) => r.trainTds?.[e.id] != null ? `${r.trainTds[e.id]} ppm` : '');
          const avgVal = r.tds != null ? `${r.tds} ppm` : '';
          return [r.date, ...trainVals, avgVal].join(',');
        });
        csvContent = [headers.join(','), ...rows].join('\n');
      } else {
        const headers = ['Date', 'Production (m3)', 'Consumption (m3)', ...(metric === 'nrw' ? ['NRW (%)'] : [])];
        const rows = overviewChartRows.map(r => [
          r.date,
          r.production ?? '',
          r.consumption ?? '',
          ...(metric === 'nrw' ? [r.nrw != null ? `${r.nrw}%` : ''] : []),
        ].join(','));
        csvContent = [headers.join(','), ...rows].join('\n');
      }
    } else if (activeTab === 'grid-by-meter') {
      const cols = gridBreakdown.hasUnattributed
        ? [...gridBreakdown.columns, { key: GRID_METER_OTHER_KEY, label: 'Other' }]
        : gridBreakdown.columns;
      const headers = ['Date', ...cols.map((c) => `"${c.label.replace(/"/g, '""')}"`), 'Total (kWh)'];
      const rows = [...overviewDates].reverse().map((dk) => {
        const row = gridBreakdown.byDate.get(dk);
        const vals = cols.map((c) => {
          const v = row?.values[c.key];
          return v != null ? v.toFixed(1) : '';
        });
        const tot = row && row.total > 0 ? row.total.toFixed(1) : '';
        return [format(new Date(dk + 'T00:00:00'), 'MMM d'), ...vals, tot].join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    } else if (activeTab === 'production') {
      const headers = ['Date', ...prodEntities.map(e => `"${e.label.replace(/"/g, '""')}"`), 'Total (m3)'];
      const rows = [...prodDates].reverse().map(d => {
        const entityVals = prodEntities.map(e => prodPivotMap.get(d)?.get(e.id) ?? 0);
        const rowTot = entityVals.reduce((a, b) => a + b, 0);
        return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals, rowTot].join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    } else if (activeTab === 'consumption') {
      const headers = ['Date', ...consEntities.map(e => `"${e.label.replace(/"/g, '""')}"`), 'Total (m3)'];
      const rows = [...consDates].reverse().map(d => {
        const entityVals = consEntities.map(e => consPivot.get(d)?.get(e.id) ?? 0);
        const rowTot = entityVals.reduce((a, b) => a + b, 0);
        return [format(new Date(d + 'T00:00:00'), 'MMM d'), ...entityVals, rowTot].join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `data-summary-${metric}-${activeTab}-${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return { handleExportCsv };
}
