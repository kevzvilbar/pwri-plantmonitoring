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
}

export default function EntityHistoryChart({
  entityId,
  entityType,
  entityName,
  defaultInputMode = 'raw',
  siblingLocators,
  isBlendingWell,
}: EntityHistoryChartProps) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const [siblingStacked, setSiblingStacked] = useState(false);

  const { data: rows = [], isLoading, error, refetch } = useQuery<HistoryRow[]>({
    queryKey: ['entity-history', entityType, entityId, range, defaultInputMode],
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      let raw: any[] = [];
      if (entityType === 'locator') {
        const { data, error: sbError } = await supabase
          .from('locator_readings')
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('locator_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = data ?? [];
      } else if (entityType === 'well') {
        const { data, error: sbError } = await supabase
          .from('well_readings')
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('well_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = data ?? [];
      } else {
        const { data, error: sbError } = await supabase
          .from('product_meter_readings' as any)
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('meter_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = (data ?? []) as any[];
      }
      let last: number | null = null;
      return raw.map((r: any) => {
        const dateStr = fmtIsoDate(r.reading_datetime);
        let consumption = 0;
        if ((entityType === 'locator' || entityType === 'well') && defaultInputMode === 'direct'
          || entityType === 'product_meter' && defaultInputMode === 'direct') {
          consumption = r.current_reading != null ? +r.current_reading : 0;
        } else if (last != null && r.current_reading != null) {
          consumption = Math.max(0, +r.current_reading - last);
        } else if (r.daily_volume != null && +r.daily_volume > 0) {
          consumption = +r.daily_volume;
        } else if (r.current_reading != null && r.previous_reading != null) {
          consumption = Math.max(0, +r.current_reading - +r.previous_reading);
        }
        if (r.current_reading != null) last = +r.current_reading;
        return { date: dateStr, consumption: +consumption.toFixed(2), reading: r.current_reading != null ? +r.current_reading : undefined };
      }).filter(r => r.date);
    },
    staleTime: 60_000,
  });

  const aggregated = useMemo<HistoryRow[]>(() => {
    const map = new Map<string, HistoryRow>();
    rows.forEach(r => {
      if (map.has(r.date)) {
        map.get(r.date)!.consumption += r.consumption;
        if (r.reading != null) map.get(r.date)!.reading = r.reading;
      } else {
        map.set(r.date, { ...r });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const chartDataResult = useEntityChartData(
    entityId, entityType, range, defaultInputMode, siblingLocators, isBlendingWell,
  );

  const {
    hasSiblings, hasBlending, siblingsLoading,
    siblingRows, siblingByDate, siblingByDateAndLocator, totalSiblingConsumption,
    blendingRows, blendingLoading, blendingByDate, totalBlendingVolume,
    chartData, periodNrw, totalConsumption, avgConsumption, periodBlendedPct,
  } = chartDataResult;

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
    const siblingCols = (siblingLocators ?? []).map(l => l.name.replace(/[,\n]/g, ' '));
    const header = hasSiblings
      ? ['date,consumption_m3,reading,locators_total_m3,nrw_pct', ...siblingCols.map(n => `${n}_m3`)].join(',')
      : hasBlending
      ? 'date,raw_water_m3,reading,blended_m3,blended_pct'
      : 'date,consumption_m3,reading';
    const lines = ((hasSiblings || hasBlending) ? chartData : aggregated).map((r: any) =>
      hasSiblings
        ? [
            `${r.date},${r.consumption},${r.reading ?? ''},${r.siblingTotal ?? ''},${r.nrw ?? ''}`,
            ...(siblingLocators ?? []).map(l => r[`sib_${l.id}`] ?? ''),
          ].join(',')
        : hasBlending
        ? `${r.date},${r.consumption},${r.reading ?? ''},${r.blendedVolume ?? ''},${r.blendedPct ?? ''}`
        : `${r.date},${r.consumption},${r.reading ?? ''}`
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityName.replace(/\s+/g, '_')}_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
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


