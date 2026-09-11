import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Card } from '@/components/ui/card';
import { useWaterBalancePeriodTotals } from './useWaterBalancePeriodTotals';
import { buildBridgeRows } from './bridgeMath';
import { BridgeHeader } from './BridgeHeader';
import { BridgeChart } from './BridgeChart';
import { RANGE_DAYS, rangeKeyToDays, type RangeKey } from '../types';

export type { WaterBalanceTotals } from './types';
export type { BridgeRow } from './types';
export { resolveDateWindow } from './useWaterBalancePeriodTotals';
export { buildBridgeRows } from './bridgeMath';

export function WaterBalanceBridgeCard({
  plantIds, title = 'Water balance',
}: {
  plantIds: string[];
  title?: string;
}) {
  const {
    totals, isLoading, error, chartRange, chartFrom, chartTo, startKey, endKey,
  } = useWaterBalancePeriodTotals(plantIds);
  const rows = useMemo(() => (totals ? buildBridgeRows(totals) : []), [totals]);

  const isCustomRange = chartRange === 'CUSTOM' || chartRange === 'MONTHLY';
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);
  const rangeLabel = isCustomRange
    ? (startKey === endKey
        ? format(parseISO(startKey), 'MMM d')
        : `${format(parseISO(startKey), 'MMM d')}–${format(parseISO(endKey), 'MMM d')}`)
    : `last ${days}d`;

  return (
    <Card className="rounded-2xl p-3.5 transition-all hover:border-border/90" data-testid="water-balance-bridge">
      <BridgeHeader title={title} rangeLabel={rangeLabel} />

      {isLoading ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      ) : error ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-danger">
          Couldn&apos;t load water balance data.
        </div>
      ) : !totals?.hasAnyData ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          No readings for this range.
        </div>
      ) : (
        <BridgeChart rows={rows} />
      )}
    </Card>
  );
}
