import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import { Sun, Zap } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';

type PowerRow = {
  reading_datetime: string;
  daily_consumption_kwh: number | null;
  daily_solar_kwh: number | null;
  daily_grid_kwh: number | null;
};

interface Props {
  plantIds: string[];
}

export function EnergyMixCard({ plantIds }: Props) {
  const since = useMemo(() => startOfDay(subDays(new Date(), 14)).toISOString(), []);
  const todayStart = useMemo(() => startOfDay(new Date()).toISOString(), []);

  const { data } = useQuery({
    queryKey: ['energy-mix-14d', plantIds, since],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase
        .from('power_readings')
        // cast to any: daily_solar_kwh / daily_grid_kwh land after the
        // 20260427 migration runs; pre-migration they fall back to
        // daily_consumption_kwh in the chart logic below.
        .select('reading_datetime,daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh' as any)
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .order('reading_datetime');
      return (data ?? []) as unknown as PowerRow[];
    },
    enabled: plantIds.length > 0,
  });

  const rows = data ?? [];

  const todaySolar = rows
    .filter((r) => r.reading_datetime >= todayStart)
    .reduce((s, r) => s + (+(r.daily_solar_kwh ?? 0)), 0);
  const todayGrid = rows
    .filter((r) => r.reading_datetime >= todayStart)
    .reduce((s, r) => {
      // Pre-migration fallback: split fields are null/0 so use daily_consumption_kwh.
      const splitTotal = (+(r.daily_solar_kwh ?? 0)) + (+(r.daily_grid_kwh ?? 0));
      const grid = +(r.daily_grid_kwh ?? 0);
      const fallback = +(r.daily_consumption_kwh ?? 0);
      return s + (splitTotal > 0 ? grid : fallback);
    }, 0);
  const todayTotal = todaySolar + todayGrid;
  const solarShare = todayTotal > 0 ? (todaySolar / todayTotal) * 100 : 0;

  const chartData = useMemo(() => {
    const m = new Map<string, { sortKey: number; solar: number; grid: number }>();
    rows.forEach((r) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const splitTotal = (+(r.daily_solar_kwh ?? 0)) + (+(r.daily_grid_kwh ?? 0));
      const solar = +(r.daily_solar_kwh ?? 0);
      const grid = splitTotal > 0
        ? +(r.daily_grid_kwh ?? 0)
        : +(r.daily_consumption_kwh ?? 0);
      const cur = m.get(key) ?? { sortKey: dt.getTime(), solar: 0, grid: 0 };
      cur.solar += solar;
      cur.grid += grid;
      m.set(key, cur);
    });
    return Array.from(m.entries())
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([date, v]) => ({ date, solar: +v.solar.toFixed(1), grid: +v.grid.toFixed(1) }));
  }, [rows]);

  return (
    <Card className="p-3" data-testid="energy-mix-card">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <h2 className="text-sm font-semibold">Energy Mix · last 14d</h2>
        <span className="text-[10px] text-muted-foreground">Solar vs Grid (kWh)</span>
      </div>

      {/* Today KPI tiles */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <KpiTile
          icon={Sun}
          label="Today Solar"
          value={fmtNum(todaySolar, 0)}
          accent="text-yellow-500"
          testId="energy-today-solar"
        />
        <KpiTile
          icon={Zap}
          label="Today Grid"
          value={fmtNum(todayGrid, 0)}
          accent="text-chart-6"
          testId="energy-today-grid"
        />
        <KpiTile
          icon={Zap}
          label={`Today Total${todayTotal > 0 ? ` · ${solarShare.toFixed(0)}% Solar` : ''}`}
          value={fmtNum(todayTotal, 0)}
          accent="text-foreground"
          testId="energy-today-total"
        />
      </div>

      <div className="h-44">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            No power readings in the last 14 days
          </div>
        ) : (
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="solar" stackId="energy" fill="#facc15" name="Solar (kWh)" />
              <Bar dataKey="grid" stackId="energy" fill="hsl(var(--chart-6))" name="Grid (kWh)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  accent,
  testId,
}: {
  icon: any;
  label: string;
  value: string;
  accent: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border bg-card p-2" data-testid={testId}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3 w-3 ${accent}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-mono-num text-base text-foreground">
        {value}
        <span className="text-[10px] font-sans text-muted-foreground ml-1">kWh</span>
      </div>
    </div>
  );
}
