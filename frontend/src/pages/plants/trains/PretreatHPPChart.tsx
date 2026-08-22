import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { TrendingUp } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';

// ─── PretreatHPPChart ─────────────────────────────────────────────────────────
// Dual-source: hpp_target_pressure_psi from ro_pretreatment_readings (target)
// overlaid with feed_pressure_psi from ro_train_readings (achieved).
export function PretreatHPPChart({ trainId }: { trainId: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['pretreat-hpp', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();

      const [ptRes, roRes] = await Promise.all([
        (supabase.from('ro_pretreatment_readings' as any) as any)
          .select('reading_datetime,hpp_target_pressure_psi')
          .eq('train_id', trainId).gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true }),
        (supabase.from('ro_train_readings' as any) as any)
          .select('reading_datetime,feed_pressure_psi,reject_pressure_psi')
          .eq('train_id', trainId).gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true }),
      ]);

      const byDate = new Map<string, any>();
      const ensureDate = (d: string) => {
        if (!byDate.has(d))
          byDate.set(d, { date: d, _tgtSum: 0, _tgtN: 0, _feedSum: 0, _feedN: 0, _rejSum: 0, _rejN: 0 });
        return byDate.get(d)!;
      };
      for (const r of (ptRes.data ?? []) as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10); if (!date) continue;
        const e = ensureDate(date);
        if (r.hpp_target_pressure_psi != null) { e._tgtSum += +r.hpp_target_pressure_psi; e._tgtN++; }
      }
      for (const r of (roRes.data ?? []) as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10); if (!date) continue;
        const e = ensureDate(date);
        if (r.feed_pressure_psi   != null) { e._feedSum += +r.feed_pressure_psi;   e._feedN++; }
        if (r.reject_pressure_psi != null) { e._rejSum  += +r.reject_pressure_psi; e._rejN++;  }
      }
      return Array.from(byDate.values()).map(e => ({
        date:        e.date,
        hpp_target:  e._tgtN  ? +(e._tgtSum  / e._tgtN ).toFixed(1) : null,
        feed_actual: e._feedN ? +(e._feedSum  / e._feedN).toFixed(1) : null,
        reject_psi:  e._rejN  ? +(e._rejSum   / e._rejN ).toFixed(1) : null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const tgtVals  = rows.map(r => r.hpp_target ).filter((v): v is number => v != null);
  const feedVals = rows.map(r => r.feed_actual).filter((v): v is number => v != null);
  const avgTgt   = tgtVals .length ? tgtVals .reduce((a, b) => a + b, 0) / tgtVals.length  : null;
  const avgFeed  = feedVals.length ? feedVals.reduce((a, b) => a + b, 0) / feedVals.length  : null;

  const Tooltip2 = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{label}</p>
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
          <span className="text-sm font-semibold">HPP — Target vs Actual Pressure</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
                ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-2xs text-muted-foreground flex-wrap">
            {[
              { color: 'hsl(216,72%,46%)', label: 'Feed (actual)', dashed: false },
              { color: 'hsl(174,72%,40%)', label: 'HPP Target',    dashed: true  },
              { color: 'hsl(0,65%,50%)',   label: 'Reject',        dashed: false },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-4 h-0.5 rounded" style={{
                  background: l.dashed
                    ? `repeating-linear-gradient(90deg,${l.color} 0,${l.color} 4px,transparent 4px,transparent 7px)`
                    : l.color
                }} />
                {l.label}
              </span>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap text-xs">
            {avgTgt  != null && (
              <div className="bg-muted/40 rounded-lg px-3 py-1.5 text-center">
                <span className="text-muted-foreground text-2xs uppercase tracking-wide block">Avg Target</span>
                <span className="font-mono font-semibold">{fmtNum(avgTgt)} <span className="font-normal text-2xs">psi</span></span>
              </div>
            )}
            {avgFeed != null && (
              <div className="bg-muted/40 rounded-lg px-3 py-1.5 text-center">
                <span className="text-muted-foreground text-2xs uppercase tracking-wide block">Avg Feed</span>
                <span className="font-mono font-semibold">{fmtNum(avgFeed)} <span className="font-normal text-2xs">psi</span></span>
              </div>
            )}
          </div>
        </>
      )}

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
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
              <Area type="monotone" dataKey="feed_actual" name="Feed (actual)"
                stroke="hsl(216,72%,46%)" fill="hsl(216,72%,46%)" fillOpacity={0.08}
                strokeWidth={1.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="hpp_target" name="HPP Target"
                stroke="hsl(174,72%,40%)" strokeWidth={2}
                strokeDasharray="5 3" dot={false} connectNulls />
              <Line type="monotone" dataKey="reject_psi" name="Reject"
                stroke="hsl(0,65%,50%)" strokeWidth={1.5} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </DataState>
    </div>
  );
}

