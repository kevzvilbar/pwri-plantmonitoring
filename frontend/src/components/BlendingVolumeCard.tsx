import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { Waves } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { supabase } from '@/integrations/supabase/client';

type ApiResponse = {
  days: number;
  total_m3: number;
  today_m3: number;
  series: { date: string; volume_m3: number }[];
  by_well: { well_id: string; well_name: string; plant_name?: string; volume_m3: number }[];
};

// This app is Supabase-only (no FastAPI backend). Read blending_events
// directly — the same table the old backend route and Operations →
// Blending both ultimately read/write — and compute the rollup client-side.
type BlendingEventRow = {
  event_date: string | null;
  volume_m3: number | string | null;
  well_id: string | null;
  well_name?: string | null;
  plant_name?: string | null;
};

function computeFromEvents(events: BlendingEventRow[], plantIds: string[], days: number): ApiResponse {
  const base = new Date();
  const baseUTC = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  const dayMs = 86_400_000;
  const toISO = (utcMs: number) => new Date(utcMs).toISOString().slice(0, 10);
  const today = toISO(baseUTC);
  const since = toISO(baseUTC - (days - 1) * dayMs);

  const byDay: Record<string, number> = {};
  const byWell: Record<string, { well_id: string; well_name: string; plant_name?: string; volume_m3: number }> = {};
  let total = 0;
  let todayTotal = 0;

  for (const ev of events) {
    const day = String(ev.event_date ?? '').slice(0, 10);
    if (!day || day < since) continue;
    const vol = Number(ev.volume_m3) || 0;
    byDay[day] = (byDay[day] ?? 0) + vol;
    const wid = ev.well_id ?? '';
    if (wid) {
      const cur = byWell[wid] ?? { well_id: wid, well_name: ev.well_name ?? '', plant_name: ev.plant_name ?? '', volume_m3: 0 };
      cur.volume_m3 += vol;
      byWell[wid] = cur;
    }
    total += vol;
    if (day === today) todayTotal += vol;
  }

  const series = Array.from({ length: days }, (_, i) => {
    const iso = toISO(baseUTC - (days - 1 - i) * dayMs);
    return { date: iso, volume_m3: Math.round((byDay[iso] ?? 0) * 100) / 100 };
  });

  const by_well = Object.values(byWell)
    .map((w) => ({ ...w, volume_m3: Math.round(w.volume_m3 * 100) / 100 }))
    .sort((a, b) => b.volume_m3 - a.volume_m3);

  return { days, total_m3: Math.round(total * 100) / 100, today_m3: Math.round(todayTotal * 100) / 100, series, by_well };
}

interface Props {
  plantIds: string[];
  days?: number;
}

export function BlendingVolumeCard({ plantIds, days = 14 }: Props) {
  const empty: ApiResponse = { days, total_m3: 0, today_m3: 0, series: [], by_well: [] };
  const { data } = useQuery<ApiResponse>({
    queryKey: ['blending-volume', plantIds, days],
    queryFn: async () => {
      if (!plantIds.length) return empty;

      try {
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - (days - 1));
        const { data: events, error } = await supabase
          .from('blending_events' as any)
          .select('event_date, volume_m3, well_id, well_name, plant_name, plant_id')
          .in('plant_id', plantIds)
          .gte('event_date', since.toISOString().slice(0, 10));
        if (!error && Array.isArray(events)) {
          return computeFromEvents(events as unknown as BlendingEventRow[], plantIds, days);
        }
      } catch {
        // Table may not exist yet, or RLS blocked it — fall through to empty
      }

      return empty;
    },
    retry: false,
  });

  const series = data?.series ?? [];
  const total = data?.total_m3 ?? 0;
  const today = data?.today_m3 ?? 0;
  const topWells = (data?.by_well ?? []).slice(0, 3);
  const dailyAvg = series.length ? total / series.length : 0;

  const chartData = series.map((s) => ({
    date: format(parseISO(s.date), 'MMM d'),
    volume: s.volume_m3,
  }));

  return (
    <Card className="p-3" data-testid="blending-volume-card">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Waves className="h-4 w-4 text-kpi-ro" />
          Blending Volume · last {days}d
        </h2>
        <span className="text-2xs text-muted-foreground">
          Product-line water from blending wells (m³)
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <KpiTile label="Today" value={fmtNum(today, 0)} testId="blending-today" />
        <KpiTile label={`Total ${days}d`} value={fmtNum(total, 0)} testId="blending-total" />
        <KpiTile label="Daily avg" value={fmtNum(dailyAvg, 0)} testId="blending-avg" />
      </div>

      <div className="h-36">
        {total === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-2">
            No blending injections recorded in the last {days} days
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
                formatter={(v: number | string) => [`${fmtNum(+v, 1)} m³`, 'Blending volume']}
              />
              <Bar dataKey="volume" fill="#a78bfa" name="Blending (m³)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {topWells.length > 0 && (
        <div className="mt-3 pt-2 border-t">
          <div className="text-2xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Top contributors
          </div>
          <div className="space-y-1">
            {topWells.map((w) => (
              <div
                key={w.well_id}
                className="flex justify-between items-center text-xs"
                data-testid={`blending-well-${w.well_id}`}
              >
                <div className="min-w-0 truncate">
                  <span className="font-medium">{w.well_name || 'Unnamed'}</span>
                  {w.plant_name && (
                    <span className="text-muted-foreground"> · {w.plant_name}</span>
                  )}
                </div>
                <span className="font-mono-num shrink-0 ml-2">
                  {fmtNum(w.volume_m3, 0)} <span className="text-2xs text-muted-foreground">m³</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function KpiTile({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border bg-card p-2" data-testid={testId}>
      <div className="text-2xs uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </div>
      <div className="mt-1 font-mono-num text-base text-foreground">
        {value}
        <span className="text-2xs font-sans text-muted-foreground ml-1">m³</span>
      </div>
    </div>
  );
}
