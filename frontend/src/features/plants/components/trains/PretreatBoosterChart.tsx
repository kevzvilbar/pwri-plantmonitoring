import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { TrendingUp } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from 'recharts';
import { fmtNum } from '@/lib/calculations';

// ─── PretreatBoosterChart ─────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → booster_pumps JSONB.
// Shows target_pressure_psi (psi mode) and/or target_hz (Hz mode).
export function PretreatBoosterChart({ trainId }: { trainId: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['pretreat-booster', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .select('reading_datetime,booster_pumps')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];

      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date))
          byDate.set(date, { date, _psiSum: 0, _psiN: 0, _hzSum: 0, _hzN: 0 });
        const e = byDate.get(date)!;
        for (const p of (r.booster_pumps ?? []) as any[]) {
          if (p.target_pressure_psi != null) { e._psiSum += +p.target_pressure_psi; e._psiN++; }
          if (p.target_hz           != null) { e._hzSum  += +p.target_hz;           e._hzN++;  }
        }
      }
      return Array.from(byDate.values()).map(e => ({
        date:       e.date,
        target_psi: e._psiN ? +(e._psiSum / e._psiN).toFixed(2) : null,
        target_hz:  e._hzN  ? +(e._hzSum  / e._hzN ).toFixed(2) : null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const psiVals = rows.map(r => r.target_psi).filter((v): v is number => v != null);
  const hzVals  = rows.map(r => r.target_hz ).filter((v): v is number => v != null);
  const hasPsi  = psiVals.length > 0;
  const hasHz   = hzVals.length  > 0;
  const avgPsi  = hasPsi ? psiVals.reduce((a, b) => a + b, 0) / psiVals.length : 0;
  const avgHz   = hasHz  ? hzVals .reduce((a, b) => a + b, 0) / hzVals.length  : 0;

  const Tooltip2 = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke }}>
            {p.name}:{' '}
            <span className="font-mono font-semibold">{fmtNum(p.value)}</span>{' '}
            {p.dataKey === 'target_psi' ? 'psi' : 'Hz'}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Booster Pump — Target Setting</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
                ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div className={`grid gap-2 ${hasPsi && hasHz ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'}`}>
          {hasPsi && (
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg Target (PSI)</div>
              <div className="font-mono font-semibold text-sm">
                {fmtNum(avgPsi)}<span className="text-2xs font-normal ml-0.5">psi</span>
              </div>
            </div>
          )}
          {hasHz && (
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg Target (Hz)</div>
              <div className="font-mono font-semibold text-sm">
                {fmtNum(avgHz)}<span className="text-2xs font-normal ml-0.5">Hz</span>
              </div>
            </div>
          )}
        </div>
      )}

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No pre-treatment readings in this period"
        onRetry={refetch}
        className="h-40"
      >
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              {hasPsi && (
                <YAxis yAxisId="psi"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={36}
                  tickFormatter={(v: number) => String(v)} />
              )}
              {hasHz && (
                <YAxis yAxisId="hz" orientation={hasPsi ? 'right' : 'left'}
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={40}
                  tickFormatter={(v: number) => `${v}Hz`} />
              )}
              <Tooltip content={<Tooltip2 />} />
              {hasPsi && (
                <Line yAxisId="psi" type="monotone" dataKey="target_psi" name="Target (psi)"
                  stroke="hsl(216,72%,46%)" strokeWidth={2} dot={false} connectNulls />
              )}
              {hasHz && (
                <Line yAxisId="hz" type="monotone" dataKey="target_hz" name="Target (Hz)"
                  stroke="hsl(38,84%,52%)" strokeWidth={2} dot={false} connectNulls strokeDasharray="5 3" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </DataState>
    </div>
  );
}

