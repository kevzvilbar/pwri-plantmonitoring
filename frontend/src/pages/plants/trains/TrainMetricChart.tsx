import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { TrendingUp, Download } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';

// ─── TrainMetricChart ────────────────────────────────────────────────────────
// Renders a bar chart for one or two numeric columns from ro_train_readings.
// Used for per-component drill-downs: AFM/MMF, Booster Pump, HPP, etc.

export type TrainMetricDef = {
  key: string;
  label: string;
  unit: string;
  color?: string;
};

export function TrainMetricChart({
  trainId,
  trainLabel,
  title,
  metrics,
}: {
  trainId: string;
  trainLabel: string;
  title: string;
  metrics: TrainMetricDef[];
}) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const cols = ['reading_datetime', ...metrics.map(m => m.key)].join(',');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['train-metric', trainId, metrics.map(m => m.key).join('-'), range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select(cols)
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];
      // Aggregate per day — average readings for that day
      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, { date, _count: 0 });
        const e = byDate.get(date)!;
        e._count++;
        for (const m of metrics) {
          if (r[m.key] != null) e[m.key] = (e[m.key] ?? 0) + +r[m.key];
        }
      }
      return Array.from(byDate.values()).map(e => {
        const out: any = { date: e.date };
        for (const m of metrics) {
          if (e[m.key] != null) out[m.key] = +(e[m.key] / e._count).toFixed(2);
        }
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const csvCols = ['date', ...metrics.map(m => m.key)];
    const header  = csvCols.join(',');
    const lines   = rows.map(r => csvCols.map(c => r[c] ?? '').join(','));
    const blob    = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `${trainLabel.replace(/\s+/g, '_')}_${metrics[0].key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const PALETTE = ['hsl(174,72%,40%)', 'hsl(216,72%,46%)', 'hsl(38,84%,52%)'];

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => {
          const m = metrics.find(x => x.key === p.dataKey);
          return (
            <p key={p.dataKey} style={{ color: p.fill }}>
              {m?.label ?? p.dataKey}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span> {m?.unit}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30', '90', '180', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      {rows.length > 0 && (() => {
        const firstMetric = metrics[0];
        const vals = rows.map(r => r[firstMetric.key]).filter((v): v is number => v != null);
        const avg  = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const max  = vals.length ? Math.max(...vals) : 0;
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg</div>
              <div className="font-mono font-semibold text-sm">{fmtNum(avg)}<span className="text-2xs font-normal ml-0.5">{firstMetric.unit}</span></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Peak</div>
              <div className="font-mono font-semibold text-sm">{fmtNum(max)}<span className="text-2xs font-normal ml-0.5">{firstMetric.unit}</span></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Days</div>
              <div className="font-mono font-semibold text-sm">{rows.length}</div>
            </div>
          </div>
        );
      })()}
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
        onRetry={refetch}
        className="h-36"
      >
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(14, 380 / rows.length))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={40}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
              <Tooltip content={customTooltip} />
              {metrics.map((m, i) => (
                <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color ?? PALETTE[i % PALETTE.length]} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </DataState>
    </div>
  );
}

