import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { TrendingUp } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';

// ─── PretreatAFMChart ─────────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → afm_units JSONB.
// Press view: In/Out pressure + ΔP line (daily avg across all units).
// Backwash view: event count bars + avg duration line + avg volume stat.
export function PretreatAFMChart({
  trainId,
  mediaType = 'AFM',
}: {
  trainId: string;
  mediaType?: string;
}) {
  const [range, setRange]       = useState<'30' | '90' | '180' | 'all'>('30');
  const [view, setView]         = useState<'pressure' | 'backwash'>('pressure');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['pretreat-afm', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .select('reading_datetime,afm_units,mmf_readings,backwash_start,backwash_end')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];

      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date))
          byDate.set(date, {
            date,
            _inSum: 0, _inN: 0, _outSum: 0, _outN: 0, _dpSum: 0, _dpN: 0,
            _bwCount: 0, _durSum: 0, _durN: 0, _volSum: 0, _volN: 0,
          });
        const e = byDate.get(date)!;

        for (const u of (r.afm_units ?? []) as any[]) {
          if (u.inlet_psi  != null) { e._inSum  += +u.inlet_psi;  e._inN++;  }
          if (u.outlet_psi != null) { e._outSum += +u.outlet_psi; e._outN++; }
          if (u.dp_psi     != null) { e._dpSum  += +u.dp_psi;     e._dpN++;  }
          if (u.backwash_start && u.backwash_end) {
            e._bwCount++;
            const dur = (new Date(u.backwash_end).getTime() - new Date(u.backwash_start).getTime()) / 60_000;
            if (dur > 0) { e._durSum += dur; e._durN++; }
          }
        }
        if (r.backwash_start && r.backwash_end) {
          e._bwCount++;
          const dur = (new Date(r.backwash_end).getTime() - new Date(r.backwash_start).getTime()) / 60_000;
          if (dur > 0) { e._durSum += dur; e._durN++; }
        }
        for (const m of (r.mmf_readings ?? []) as any[]) {
          if (m.meter_start != null && m.meter_end != null) {
            const vol = Math.max(0, +m.meter_end - +m.meter_start);
            e._volSum += vol; e._volN++;
          }
        }
      }

      return Array.from(byDate.values()).map(e => ({
        date:            e.date,
        inlet_psi:       e._inN  ? +(e._inSum  / e._inN ).toFixed(2) : null,
        outlet_psi:      e._outN ? +(e._outSum / e._outN).toFixed(2) : null,
        dp_psi:          e._dpN  ? +(e._dpSum  / e._dpN ).toFixed(2) : null,
        bw_count:        e._bwCount,
        bw_duration_min: e._durN ? +(e._durSum / e._durN).toFixed(1) : null,
        bw_volume_m3:    e._volN ? +(e._volSum / e._volN).toFixed(3) : null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const dpVals   = rows.map(r => r.dp_psi).filter((v): v is number => v != null);
  const avgDp    = dpVals.length ? dpVals.reduce((a, b) => a + b, 0) / dpVals.length : 0;
  const maxDp    = dpVals.length ? Math.max(...dpVals) : 0;
  const totalBw  = rows.reduce((s, r) => s + (r.bw_count ?? 0), 0);
  const durRows  = rows.filter(r => r.bw_duration_min != null);
  const avgDur   = durRows.length ? durRows.reduce((s, r) => s + (r.bw_duration_min ?? 0), 0) / durRows.length : 0;
  const volRows  = rows.filter(r => r.bw_volume_m3 != null);
  const avgVol   = volRows.length ? volRows.reduce((s, r) => s + (r.bw_volume_m3 ?? 0), 0) / volRows.length : 0;

  const barSize = Math.max(3, Math.min(14, 360 / Math.max(rows.length, 1)));

  const Tooltip2 = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const unit = (key: string) =>
      key === 'inlet_psi' || key === 'outlet_psi' || key === 'dp_psi' ? 'psi'
      : key === 'bw_duration_min' ? 'min'
      : key === 'bw_volume_m3'   ? 'm³'
      : '';
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke ?? p.fill }}>
            {p.name}:{' '}
            <span className="font-mono font-semibold">{fmtNum(p.value)}</span>{' '}
            {unit(p.dataKey)}
          </p>
        ))}
      </div>
    );
  };

  const RangeBar = () => (
    <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
      {(['30', '90', '180', 'all'] as const).map(r => (
        <button key={r} onClick={() => setRange(r)}
          className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
            ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {r === 'all' ? 'All' : `${r}d`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{mediaType} — Pressure & Backwash</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['pressure', 'backwash'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded text-2xs font-medium capitalize transition-colors
                  ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {v}
              </button>
            ))}
          </div>
          <RangeBar />
        </div>
      </div>

      {rows.length > 0 && view === 'pressure' && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Avg ΔP',   val: fmtNum(avgDp), unit: 'psi' },
            { label: 'Peak ΔP',  val: fmtNum(maxDp), unit: 'psi' },
            { label: 'BW Total', val: String(totalBw), unit: 'events' },
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
      {rows.length > 0 && view === 'backwash' && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total BW',     val: String(totalBw),    unit: 'events' },
            { label: 'Avg Duration', val: fmtNum(avgDur, 1),  unit: 'min'    },
            { label: 'Avg Volume',   val: fmtNum(avgVol, 3),  unit: 'm³'     },
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

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No pre-treatment readings in this period"
        onRetry={refetch}
        className="h-40"
      >
        {view === 'pressure' ? (
        <>
          <div className="flex items-center gap-3 text-2xs text-muted-foreground flex-wrap">
            {[
              { color: 'hsl(216,72%,50%)', label: 'In Pressure' },
              { color: 'hsl(38,84%,52%)',  label: 'Out Pressure' },
              { color: 'hsl(0,65%,50%)',   label: 'ΔP (dashed)' },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
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
                <Area type="monotone" dataKey="inlet_psi"  name="In Pressure"
                  stroke="hsl(216,72%,50%)" fill="hsl(216,72%,50%)" fillOpacity={0.07}
                  strokeWidth={1.5} dot={false} connectNulls />
                <Area type="monotone" dataKey="outlet_psi" name="Out Pressure"
                  stroke="hsl(38,84%,52%)"  fill="hsl(38,84%,52%)"  fillOpacity={0.07}
                  strokeWidth={1.5} dot={false} connectNulls />
                <Line  type="monotone" dataKey="dp_psi"    name="ΔP"
                  stroke="hsl(0,65%,50%)" strokeWidth={2}
                  strokeDasharray="5 3" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis yAxisId="cnt" allowDecimals={false}
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={28} />
              <YAxis yAxisId="dur" orientation="right"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={38}
                tickFormatter={(v: number) => `${v}m`} />
              <Tooltip content={<Tooltip2 />} />
              <Bar yAxisId="cnt" dataKey="bw_count" name="BW Events"
                fill="hsl(270,55%,58%)" radius={[2, 2, 0, 0]} barSize={barSize} />
              <Line yAxisId="dur" type="monotone" dataKey="bw_duration_min" name="Avg Duration"
                stroke="hsl(174,72%,40%)" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      </DataState>
    </div>
  );
}

