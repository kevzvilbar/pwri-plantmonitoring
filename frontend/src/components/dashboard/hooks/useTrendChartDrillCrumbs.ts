import type { DrillFocus } from '../TrendChartDrillKit';
import { focusToRange, nextFinerGranularity } from '../TrendChartDrillKit';
import { format } from 'date-fns';

export function useDrillCrumbs(p: Record<string, any>) {
  const {
    drillFocus, range, setDrillFocus, setViewGran,
    viewGran, phDayFocus, phDrillMode, setPhDrillMode, setPhDayFocus,
    trendRows, entityRows, chartMonth,
    drillMode, setViewBreakdown,
  } = p;

  const handleDrillBarActivate = (payload: Record<string, unknown>) => {
    if (viewGran === 'daily') {
      if (drillMode === 'default') setViewBreakdown('by-locator');
      return;
    }
    const bucketIsoDate = payload.isoDate as string | undefined;
    if (!bucketIsoDate) return;
    setDrillFocus((prev: DrillFocus | null) => ({
      bucketIsoDate,
      label: payload.date as string,
      fromGranularity: viewGran as 'monthly' | 'weekly',
      parent: prev ?? undefined,
    }));
    setViewGran(nextFinerGranularity(viewGran as 'monthly' | 'weekly'));
  };

  const drillFocusRange = drillFocus ? focusToRange(drillFocus) : null;

  const focusedTrendRows = drillFocusRange
    ? trendRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : trendRows;

  const focusedEntityRows = drillFocusRange
    ? entityRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : entityRows;

  const drillCrumbs: any[] = drillFocus
    ? [
        {
          label: range === 'CUSTOM' ? 'Custom range' : range,
          onSelect: () => {
            setDrillFocus(null);
            if (range === 'MONTHLY' && chartMonth === 'YTD') {
              setViewGran('monthly');
            } else if (range === 'MONTHLY') {
              setViewGran('daily');
            }
          },
        },
        ...(drillFocus.parent
          ? [
              {
                label: drillFocus.parent.label,
                onSelect: () => {
                  setDrillFocus(drillFocus.parent!);
                  setViewGran('weekly');
                },
              },
            ]
          : []),
        { label: drillFocus.label },
      ]
    : phDayFocus
    ? [
        { label: range === 'CUSTOM' ? 'Custom range' : range, onSelect: () => { setPhDrillMode('daily'); setPhDayFocus(null); } },
        { label: format(new Date(phDayFocus + 'T00:00:00'), 'MMM d') },
      ]
    : [];

  return {
    handleDrillBarActivate,
    drillFocusRange, focusedTrendRows, focusedEntityRows, drillCrumbs,
  };
}
