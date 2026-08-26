import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { TrendingUp, Download } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { fmtIsoDate } from '@/lib/format';
import { toast } from 'sonner';

// ─── Train History Chart ─────────────────────────────────────────────────────
// Queries ro_train_readings for daily production volume and renders a bar chart.

export function TrainHistoryChart({ trainId, trainLabel }: { trainId: string; trainLabel: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading, error, refetch } = useQuery<{ date: string; volume: number }[]>({
    queryKey: ['train-history', trainId, range],
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await supabase
        .from('ro_train_readings')
        .select('reading_datetime, permeate_flow, product_flow, net_production')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });

      // Aggregate per day — use permeate_flow or product_flow or net_production
      // Bucket by Asia/Manila calendar day (see EntityHistoryChart.tsx for the
      // same fix and full rationale) — raw UTC slicing put early-morning
      // Manila readings under the previous day's bar.
      const byDate = new Map<string, number>();
      for (const r of data ?? []) {
        const date = fmtIsoDate((r as any).reading_datetime);
        if (!date) continue;
        const vol = +((r as any).net_production ?? (r as any).permeate_flow ?? (r as any).product_flow ?? 0);
        byDate.set(date, (byDate.get(date) ?? 0) + vol);
      }
      return Array.from(byDate.entries()).map(([date, volume]) => ({ date, volume: +volume.toFixed(2) })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const blob = new Blob([['date,volume_m3', ...rows.map(r => `${r.date},${r.volume}`)].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${trainLabel.replace(/\s+/g,'_')}_history.csv`; a.click(); URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const total = rows.reduce((s, r) => s + r.volume, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Production History</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV} title="Export CSV">
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase">Days</div>
            <div className="font-mono font-semibold text-base">{rows.length}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase">Total m³</div>
            <div className="font-mono font-semibold text-base">{fmtNum(total)}</div>
          </div>
        </div>
      )}
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
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / rows.length))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={38} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)} />
              <Tooltip formatter={(v: any) => [`${fmtNum(v)} m³`, 'Volume']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Bar dataKey="volume" fill="hsl(174, 72%, 40%)" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </DataState>
    </div>
  );
}

