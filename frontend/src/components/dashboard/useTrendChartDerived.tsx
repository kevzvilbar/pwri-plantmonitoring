// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This hook composes every derived value that sits between the
// raw chartData/trendRows pipeline (useTrendChartData.ts) and the render,
// delegating to focused sub-hooks in ./hooks/.
//
// Moved verbatim from TrendChart.tsx — no logic changes.
import { format } from 'date-fns';
import { calc } from '@/lib/calculations';
import {
  C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_RECOVERY, C_TDS, C_GRID_PV,
} from '@/lib/chartColors';
import { reasonCategoryLabel, reasonEntityPrefix } from '@/lib/reasonCodes';
import { buildEntityPivot, fillDateRange } from './TrendChartPivotShared';
import { buildEntityPivotRows, getIsoWeekStart } from './TrendChartAggregate';
import { DRILL_COLORS } from './TrendChartLegend';
import {
  type DrillCrumb, makeDrillableBarShape, toggleIsolateEntity,
  focusToRange, nextFinerGranularity, type DrillFocus,
} from './TrendChartDrillKit';
import { useTrendChartLocators } from './hooks/useTrendChartLocators';
import { useLocatorPresets } from './hooks/useTrendChartLocators';
import { useWellEntities } from './hooks/useTrendChartWells';
import { useWellPresets } from './hooks/useTrendChartWells';
import { useWellEntityRows } from './hooks/useTrendChartWells';
import { useEntityRows } from './hooks/useTrendChartEntityRows';
import { useRoDrillData } from './hooks/useTrendChartRoDrill';
import { usePlantHealthData } from './hooks/useTrendChartPlantHealth';
import { useDrillCrumbs } from './hooks/useTrendChartDrillCrumbs';
import { useChartHelpers } from './hooks/useTrendChartHelpers';

export function useTrendChartDerived(p: Record<string, any>) {
  const {
    metric, compact, drillFocus, setDrillFocus, drillMode, range,
    selectedLocatorIds, setSelectedLocatorIds, locatorSearch,
    selectedTrainIds, setSelectedTrainIds, trainSearch,
    selectedWellIds, setSelectedWellIds, wellSearch,
    prodDrillSource, roDrillMode, phDrillMode, setPhDrillMode, phDayFocus, setPhDayFocus,
    viewGran, setViewGran, viewBreakdown, setViewBreakdown, rawwaterBreakdown,
    hasConsumptionDrill, hasRoDrill, hasPlantHealth,
    startKey, endKey,
    trendRows, chartData,
    wellNames, locatorNames, productMeterNames, plantNames, roTrainNames,
    wellReadings, locReadings, productReadings, roReadings,
    _directLocatorIds, _directProductMeterIds, _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
    chartMonth,
  } = p;

  // ── Sub-hooks ─────────────────────────────────────────────────────────────

  // Locator drill entities + selector helpers
  const locatorState = useTrendChartLocators(p);
  const { locatorTotals, selectTopNLocators } = useLocatorPresets({ ...p, activeEntities: locatorState.activeEntities });

  // Well entities + selector helpers
  const wellState = useWellEntities({ ...p, viewGran, startKey, endKey });
  const { wellTotals, selectTopNWells } = useWellPresets({ ...p, wellEntities: wellState.wellEntities });
  const { wellEntityRows } = useWellEntityRows({ ...p, visibleWellEntities: wellState.visibleWellEntities });

  // Entity rows (consumption drill breakdown)
  const { entityRows } = useEntityRows({
    ...p,
    usePermeateForSource: locatorState.usePermeateForSource,
    visibleEntities: locatorState.visibleEntities,
  });

  // RO drill helpers
  const roState = useRoDrillData({ ...p, viewGran, startKey, endKey, roTrainNames, selectedTrainIds });

  // Plant Health data
  const phState = usePlantHealthData({ ...p, roReadings, _roTrainIdsForReadings, roTrainNames });

  // Drill breadcrumbs, focused rows
  const {
    handleDrillBarActivate,
    drillFocusRange, focusedTrendRows, focusedEntityRows, drillCrumbs,
  } = useDrillCrumbs({
    ...p,
    trendRows, entityRows,
    drillFocus, setDrillFocus, range, viewGran,
    phDayFocus, phDrillMode, setPhDrillMode, setPhDayFocus,
    chartMonth,
  });

  // Chart helpers
  const { chartHeight, formatYAxis } = useChartHelpers(p);

  // ── Tooltip components (stable, defined once per hook invocation) ─────────
  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const chartRow: any = trendRows.find((d: any) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];
    const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];
    const dayCount: number | undefined = chartRow?._dayCount;
    const isPartial: boolean | undefined = chartRow?._partial;

    let expectedBucketDays: number | null = null;
    if (viewGran === 'weekly') {
      expectedBucketDays = 7;
    } else if (viewGran === 'monthly' && chartRow?.isoDate) {
      const d = new Date(`${chartRow.isoDate}T00:00:00`);
      if (!isNaN(d.getTime())) {
        expectedBucketDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      }
    }

    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 10,
        fontSize: 11,
        padding: '9px 12px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: 'var(--shadow-elev)',
        backdropFilter: 'blur(8px)',
      }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 12, letterSpacing: '-0.01em' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ margin: '2px 0', color: entry.color ?? entry.stroke, fontWeight: 500 }}>
            {entry.name}:{' '}
            <span style={{ fontWeight: 700 }}>{entry.value != null ? entry.value.toLocaleString() : '—'}</span>
          </p>
        ))}
        {replacements.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
            {replacements.map((name) => (
              <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--warn))', marginBottom: 2 }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        {permeateSourceNames.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--muted-foreground))' }}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
            <span style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.85 }}>
              Source: Permeate meter ({permeateSourceNames.join(', ')})
            </span>
          </div>
        )}
        {viewGran !== 'daily' && dayCount != null && expectedBucketDays != null && (
          <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid hsl(var(--border))', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
            <span>Coverage: </span>
            <strong style={{ color: dayCount < expectedBucketDays ? 'hsl(var(--warn))' : 'inherit' }}>
              {dayCount} of {expectedBucketDays} days reported
            </strong>
            {isPartial ? ' · partial' : ''}
          </div>
        )}
      </div>
    );
  };

  const PvTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row: any = trendRows.find((d: any) => d.date === label);
    if (!row) return null;
    const gridPv  = row.production > 0 ? +(row.kwh / row.production).toFixed(2) : null;
    const totalPv = row.production > 0 && (row.kwh + row.solarKwh) > 0
      ? +((row.kwh + row.solarKwh) / row.production).toFixed(2) : null;
    const hasSolar = row.solarKwh > 0;
    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8, fontSize: 11, padding: '8px 10px',
        minWidth: 200, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
      }}>
        <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
        <p style={{ margin: '1px 0', color: C_GRID_PV }}>
          Grid PV: <strong>{gridPv != null ? `${gridPv} kWh/m³` : '0 kWh/m³'}</strong>
        </p>
        {hasSolar && (
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            (Grid+Solar) PV: <strong>{totalPv != null ? `${totalPv} kWh/m³` : '—'}</strong>
          </p>
        )}
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            Volume: <span>{row.production > 0 ? row.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m³' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: C_GRID_PV }}>
            Grid Power: <span>{row.kwh > 0 ? row.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            Solar: <span>{row.solarKwh > 0 ? row.solarKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
        </div>
        {viewGran !== 'daily' && row?._dayCount != null && (
          <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid hsl(var(--border))', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
            <span>Coverage: </span>
            <strong>{row._dayCount} {row._dayCount === 1 ? 'day' : 'days'} reported</strong>
            {row._partial ? ' · partial' : ''}
          </div>
        )}
      </div>
    );
  };

  // ── Well legend isolate (closes over wellEntities) ────────────────────────
  const handleWellLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedWellIds((prev: any) =>
      toggleIsolateEntity(prev, id, wellState.wellEntities.map((x: any) => x.id)),
    );
  };

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    drillEntities: locatorState.drillEntities,
    usePermeateForSource: locatorState.usePermeateForSource,
    sourceDrillEntities: locatorState.sourceDrillEntities,
    activeEntities: locatorState.activeEntities,
    visibleEntities: locatorState.visibleEntities,
    filteredLocatorList: locatorState.filteredLocatorList,
    locatorTotals, selectTopNLocators,
    allSelected: locatorState.allSelected,
    noneSelected: locatorState.noneSelected,
    toggleLocator: locatorState.toggleLocator,
    selectAllLocators: locatorState.selectAllLocators,
    clearAllLocators: locatorState.clearAllLocators,
    handleLegendIsolate: locatorState.handleLegendIsolate,
    wellEntities: wellState.wellEntities,
    visibleWellEntities: wellState.visibleWellEntities,
    wellEntityRows,
    handleWellLegendIsolate,
    filteredWellList: wellState.filteredWellList,
    wellTotals, selectTopNWells,
    allWellsSelected: wellState.allWellsSelected,
    noneWellsSelected: wellState.noneWellsSelected,
    toggleWell: wellState.toggleWell,
    selectAllWells: wellState.selectAllWells,
    clearAllWells: wellState.clearAllWells,
    entityRows,
    roTrainEntities: roState.roTrainEntities,
    visibleTrainEntities: roState.visibleTrainEntities,
    filteredTrainList: roState.filteredTrainList,
    allTrainsSelected: roState.allTrainsSelected,
    noTrainsSelected: roState.noTrainsSelected,
    toggleTrain: roState.toggleTrain,
    selectAllTrains: roState.selectAllTrains,
    clearAllTrains: roState.clearAllTrains,
    valueKey: roState.valueKey,
    roUnit: roState.roUnit,
    roTrainDrillData: roState.roTrainDrillData,
    roHourDrillData: roState.roHourDrillData,
    handleTrainLegendIsolate: roState.handleTrainLegendIsolate,
    phTotalTrains: phState.phTotalTrains,
    phDailyData: phState.phDailyData,
    phHourlyData: phState.phHourlyData,
    phMonthlyData: phState.phMonthlyData,
    phWeeklyData: phState.phWeeklyData,
    phFocusedHourlyData: phState.phFocusedHourlyData,
    phActiveData: phState.phActiveData,
    handlePhDayDotActivate: phState.handlePhDayDotActivate,
    NegativeAwareTooltip,
    chartHeight,
    handleDrillBarActivate,
    drillFocusRange,
    focusedTrendRows,
    focusedEntityRows,
    drillCrumbs,
    formatYAxis,
    PvTooltip,
  };
}
