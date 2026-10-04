import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { TrendingUp, Download } from 'lucide-react';
import { DataState } from '@/components/DataState';
import { ResponsiveContainer, ComposedChart, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line } from 'recharts';
import { fmtNum, nrwColor, ALERTS } from '@/lib/calculations';
import { fmtIsoDate } from '@/lib/format';
import { toast } from 'sonner';
import { downloadCSVMatrix } from '@/shared/csv';
import { C_CONSUMPTION, C_NRW, C_RAWWATER, C_BLEND_PCT, C_BLEND_VOLUME } from '@/lib/chartColors';
import { useEntityChartData, type HistoryRow, type SiblingLocator } from './useEntityChartData';
import { ChartStats, type ChartStatsProps } from './ChartStats';
import { ChartContent } from './ChartContent';
import { MeterDetailButton } from './MeterDetailButton';

export interface EntityHistoryChartProps {
  entityId: string;
  entityType: 'locator' | 'well' | 'product_meter';
  entityName: string;
  defaultInputMode?: 'raw' | 'direct';
  siblingLocators?: SiblingLocator[];
  isBlendingWell?: boolean;
  entityMultiplier?: number;
}

export default function EntityHistoryChart({
  entityId,
  entityType,
  entityName,
  defaultInputMode = 'raw',
  siblingLocators,
  isBlendingWell,
  entityMultiplier = 1,
}: EntityHistoryChartProps) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const [siblingStacked, setSiblingStacked] = useState(false);

  const {
    rows, aggregated, isLoading, error, refetch,
    hasSiblings, hasBlending, siblingsLoading,
    siblingRows, siblingByDate, siblingByDateAndLocator, totalSiblingConsumption,
    blendingRows, blendingLoading, blendingByDate, totalBlendingVolume,
    chartData, periodNrw, totalConsumption, avgConsumption, periodBlendedPct,
  } = useEntityChartData(
    entityId, entityType, range, defaultInputMode, siblingLocators, isBlendingWell, entityMultiplier,
  );

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover/95 backdrop-blur-md border border-border/80 rounded-xl shadow-lg p-2.5 text-xs space-y-1.5">
        <p className="font-semibold text-foreground border-b border-border/50 pb-1 font-mono text-2xs">{label}</p>
        <div className="space-y-1">
          {payload.map((p: any) => (
            <div key={p.dataKey} className="flex items-center justify-between gap-3 text-2xs">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-muted-foreground">{p.name}</span>
              </span>
              <span className="font-mono font-bold text-foreground">
                {fmtNum(p.value)} {p.dataKey === 'nrw' || p.dataKey === 'blendedPct' ? '%' : 'm³'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const exportCSV = () => {
    if (!aggregated.length) { toast.error('No data to export'); return; }
    const siblingCols = (siblingLocators ?? []).map(l => `${l.name}_m3`);
    const headers = hasSiblings
      ? ['date', 'consumption_m3', 'reading', 'locators_total_m3', 'nrw_pct', ...siblingCols]
      : hasBlending
      ? ['date', 'raw_water_m3', 'reading', 'blended_m3', 'blended_pct']
      : ['date', 'consumption_m3', 'reading'];

    const dataset = (hasSiblings || hasBlending) ? chartData : aggregated;
    const rows = dataset.map((r: any) =>
      hasSiblings
        ? [
            r.date,
            r.consumption,
            r.reading ?? '',
            r.siblingTotal ?? '',
            r.nrw ?? '',
            ...(siblingLocators ?? []).map(l => r[`sib_${l.id}`] ?? ''),
          ]
        : hasBlending
        ? [r.date, r.consumption, r.reading ?? '', r.blendedVolume ?? '', r.blendedPct ?? '']
        : [r.date, r.consumption, r.reading ?? '']
    );

    downloadCSVMatrix(`${entityName.replace(/\s+/g, '_')}_history.csv`, headers, rows);
    toast.success('CSV exported');
  };

  const hasSiblingsCount = siblingLocators?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Historical Consumption</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${
                  range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{r === 'all' ? 'All' : `${r}d`}</button>
            ))}
          </div>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={exportCSV}
            title="Export to CSV"
          >
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      <ChartStats
        aggregatedLength={aggregated.length}
        totalConsumption={totalConsumption}
        avgConsumption={avgConsumption}
        hasSiblings={hasSiblings}
        siblingsLoading={siblingsLoading}
        totalSiblingConsumption={totalSiblingConsumption}
        siblingLocatorsCount={hasSiblingsCount}
        periodNrw={periodNrw}
        nrwColor={nrwColor}
        ALERTS_NRW_GREEN_MAX={ALERTS.nrw_green_max}
        hasBlending={hasBlending}
        blendingLoading={blendingLoading}
        totalBlendingVolume={totalBlendingVolume}
        periodBlendedPct={periodBlendedPct}
        C_CONSUMPTION={C_CONSUMPTION}
        C_BLEND_VOLUME={C_BLEND_VOLUME}
        C_BLEND_PCT={C_BLEND_PCT}
      />

      <ChartContent
        chartData={chartData}
        aggregatedLength={aggregated.length}
        hasSiblings={hasSiblings}
        hasBlending={hasBlending}
        siblingStacked={siblingStacked}
        setSiblingStacked={setSiblingStacked}
        siblingLocators={siblingLocators ?? []}
        isLoading={isLoading}
        error={error}
        refetch={refetch}
        customTooltip={customTooltip}
      />
    </div>
  );
}


