import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { TrendingUp } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area, Legend } from 'recharts';
import { fmtNum } from '@/lib/calculations';

// ─── PretreatCFChart ──────────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → cartridge_filter_housings JSONB.
// Shows In/Out pressure and computed ΔP per day (avg across all housing units).
export function PretreatCFChart({
  trainId,
  filterType = 'Cartridge Filter',
}: {
  trainId: string;
  filterType?: string;
}) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['pretreat-cf', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .select('reading_datetime,cartridge_filter_housings')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];

      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date))
          byDate.set(date, { date, _inSum: 0, _inN: 0, _outSum: 0, _outN: 0 });
        const e = byDate.get(date)!;
        for (const h of (r.cartridge_filter_housings ?? []) as any[]) {
          if (h.in_psi  != null) { e._inSum  += +h.in_psi;  e._inN++;  }
          if (h.out_psi != null) { e._outSum += +h.out_psi; e._outN++; }
        }
      }
      return Array.from(byDate.values()).map(e => {
        const inP  = e._inN  ? +(e._inSum  / e._inN ).toFixed(2) : null;
        const outP = e._outN ? +(e._outSum / e._outN).toFixed(2) : null;
        const dp   = inP != null && outP != null ? +(inP - outP).toFixed(2) : null;
        return { date: e.date, in_psi: inP, out_psi: outP, dp_psi: dp };
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const dpVals  = rows.map(r => r.dp_psi).filter((v): v is number => v != null);
  const avgDp   = dpVals.length ? dpVals.reduce((a, b) => a + b, 0) / dpVals.length : 0;
  const maxDp   = dpVals.length ? Math.max(...dpVals) : 0;
  const inVals  = rows.map(r => r.in_psi ).filter((v): v is number => v != null);
  const avgIn   = inVals.length ? inVals.reduce((a, b) => a + b, 0) / inVals.length  : 0;

  const label = filterType === 'Bag Filter' ? 'Filter Housing' : 'CF Housing';

  const Tooltip2 = ({ active, payload, label: lbl }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{lbl}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke }}>
            {p.name}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span> psi
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
          <span className="text-sm font-semibold">{label} — In / Out / ΔP</span>
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
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Avg In',   val: fmtNum(avgIn),  unit: 'psi' },
            { label: 'Avg ΔP',  val: fmtNum(avgDp),  unit: 'psi' },
            { label: 'Peak ΔP', val: fmtNum(maxDp),  unit: 'psi' },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-2xs font-normal ml-0.5">{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 text-2xs text-muted-foreground flex-wrap">
          {[
            { color: 'hsl(216,72%,50%)', label: 'In Pressure',  dashed: false },
            { color: 'hsl(38,84%,52%)',  label: 'Out Pressure', dashed: false },
            { color: 'hsl(0,65%,50%)',   label: 'ΔP',          dashed: true  },
          ].map(l => (
            <span key={l.label} className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 rounded" style={{
                background: l.dashed
                  ? `repeating-linear-gradient(90deg,${l.color} 0,${l.color} 4px,transparent 4px,transparent 7px)`
                  : l.color
              }} />
              {l.label}
            </span>
          ))}
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
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={36} />
              <Tooltip content={<Tooltip2 />} />
              <Area type="monotone" dataKey="in_psi"  name="In Pressure"
                stroke="hsl(216,72%,50%)" fill="hsl(216,72%,50%)" fillOpacity={0.08}
                strokeWidth={1.5} dot={false} connectNulls />
              <Area type="monotone" dataKey="out_psi" name="Out Pressure"
                stroke="hsl(38,84%,52%)" fill="hsl(38,84%,52%)" fillOpacity={0.08}
                strokeWidth={1.5} dot={false} connectNulls />
              <Line  type="monotone" dataKey="dp_psi" name="ΔP"
                stroke="hsl(0,65%,50%)" strokeWidth={2}
                strokeDasharray="5 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </DataState>
    </div>
  );
}

