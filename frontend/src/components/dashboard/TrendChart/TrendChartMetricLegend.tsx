import {
  C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_RECOVERY, C_TDS, C_GRID_PV,
} from '@/lib/chartColors';
import { ModernChartLegend } from '../TrendChartLegend';

export function TrendChartMetricLegend({
  metric, hasConsumptionDrill, hasRoDrill, kwhChartRows, chartData, kwhSource,
  showTotalCostLine, showPowerCostLine, showChemCostLine,
}: {
  metric: string;
  hasConsumptionDrill: boolean;
  hasRoDrill: boolean;
  kwhChartRows: any[];
  chartData: any[];
  kwhSource: string;
  showTotalCostLine: boolean;
  showPowerCostLine: boolean;
  showChemCostLine: boolean;
}) {
  return (
    <>
      {metric === 'kwh' && kwhChartRows.length > 0 && (() => {
        const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
        const hasGridData  = chartData.some((d: any) => (d.kwh      ?? 0) > 0);
        return (
          <ModernChartLegend items={[
            ...(hasSolarData && kwhSource !== 'grid'  ? [{ color: 'hsl(48,96%,53%)', label: 'Solar (kWh)', shape: 'bar' as const }] : []),
            ...(hasGridData  && kwhSource !== 'solar' ? [{ color: 'hsl(213,94%,68%)', label: 'Grid (kWh)', shape: 'bar' as const }] : []),
          ]} />
        );
      })()}

      {metric === 'production' && !hasConsumptionDrill && (
        <ModernChartLegend items={[
          { color: C_PRODUCTION,  label: 'Production (m³)',  shape: 'area' },
          { color: C_CONSUMPTION, label: 'Consumption (m³)', shape: 'area' },
        ]} />
      )}

      {metric === 'nrw' && !hasConsumptionDrill && (
        <ModernChartLegend items={[
          { color: C_PRODUCTION,  label: 'Production (m³)',  shape: 'bar' },
          { color: C_CONSUMPTION, label: 'Consumption (m³)', shape: 'bar' },
          { color: C_NRW,         label: 'NRW %',            shape: 'line' },
        ]} />
      )}

      {metric === 'rawwater' && !hasConsumptionDrill && (
        <ModernChartLegend items={[{ color: C_RAWWATER, label: 'Raw Water (m³)', shape: 'area' }]} />
      )}

      {metric === 'recovery' && !hasRoDrill && (
        <ModernChartLegend items={[{ color: C_RECOVERY, label: 'Recovery (%)', shape: 'area' }]} />
      )}

      {metric === 'tds' && !hasRoDrill && (
        <ModernChartLegend items={[{ color: C_TDS, label: 'Permeate TDS (ppm)', shape: 'area' }]} />
      )}

      {metric === 'productionCost' && (
        <ModernChartLegend items={[
          ...(showTotalCostLine ? [{ color: 'hsl(var(--accent))',     label: 'Prod Cost (₱/m³)', shape: 'line' as const }] : []),
          ...(showPowerCostLine ? [{ color: 'hsl(var(--chart-6))',    label: 'Power (₱/m³)',     shape: 'line' as const }] : []),
          ...(showChemCostLine  ? [{ color: 'hsl(var(--highlight))', label: 'Chem (₱/m³)',      shape: 'line' as const }] : []),
        ]} />
      )}

      {metric === 'pv' && (
        <ModernChartLegend items={[
          { color: C_GRID_PV,    label: 'Grid PV (kWh/m³)',          shape: 'line' },
          { color: C_PRODUCTION, label: '(Grid+Solar) PV (kWh/m³)',  shape: 'line' },
        ]} />
      )}
    </>
  );
}
