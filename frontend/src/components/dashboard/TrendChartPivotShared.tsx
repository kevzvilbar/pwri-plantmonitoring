// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md).
// Shared by TrendChartTables.tsx (PivotTable/OverviewTable) and
// TrendChartDataSummaryPopup.tsx (DataSummaryPopup). TrendChart.tsx itself
// only uses buildEntityPivot/fillDateRange/fmtDateKey directly — see that
// file for where those three are still called from the main chart.
//
// resolveReadingDelta is not currently called anywhere (verified via repo
// search before this extraction) — kept as-is rather than removed, since
// this pass is a pure structural move with no behavior change. Worth a
// follow-up cleanup pass once test coverage exists to confirm it's safe to
// delete (see pwri-improvement-plan.md Phase 2).

export {
  resolveReadingDelta,
  buildEntityPivot,
} from './TrendChartPivotShared/readingUtils';

export {
  fillDateRange,
  fmtDateKey,
} from './TrendChartPivotShared/dateUtils';

export {
  DSMTab,
  TH,
  TH_DATE,
  TH_TOTAL,
  TD,
  TD_TOTAL_ROW,
  TD_TOTAL_COL,
  fmtV,
} from './TrendChartPivotShared/cssClasses';

export {
  interpolateMissingGridMeterReadings,
  computeGridMeterBreakdown,
  GRID_METER_OTHER_KEY,
  type GridPowerReadingRow,
  type GridMeterColumn,
  type GridMeterDayRow,
  type GridMeterBreakdown,
} from './TrendChartPivotShared/gridMeterBreakdown';

export {
  csvField,
  buildKwhSummaryCsv,
} from './TrendChartPivotShared/csvExport';

export {
  GAP_ENTITY_TYPE_LABEL,
  GAP_ENTITY_TABLE,
  GAP_DOWN_STATUSES,
  type GapReasonHit,
  useGapReasonLookup,
} from './TrendChartPivotShared/gapReasonLookup';
