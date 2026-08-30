import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/StatusPill';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { DateRangePicker } from '@/components/ui/date-picker';
import { fmtNum } from '@/lib/calculations';
import { format, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';

export function Compare() {
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  // Range: '14d' | '30d' | '60d' | '90d' | 'bills' (bill-aligned) | 'custom'
  const [viewMode, setViewMode] = useState<'14d' | '30d' | '60d' | '90d' | 'bills' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  // Chart type for daily view
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');

  // ── Date range derived from viewMode ────────────────────────────────────────
  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    if (viewMode === 'custom' && customFrom && customTo) {
      return { rangeStart: customFrom, rangeEnd: customTo };
    }
    if (viewMode === 'bills') return { rangeStart: '', rangeEnd: '' }; // bill-aligned handled below
    const days = viewMode === '14d' ? 14 : viewMode === '30d' ? 30 : viewMode === '60d' ? 60 : 90;
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    return {
      rangeStart: format(start, 'yyyy-MM-dd'),
      rangeEnd:   format(now,   'yyyy-MM-dd'),
    };
  }, [viewMode, customFrom, customTo]);

  // ── Bills query (for bill-aligned view + variance table) ─────────────────
  const { data: bills } = useQuery({
    queryKey: ['bills-cmp', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(12)).data ?? []
      : [],
    enabled: !!plantId,
  });

  // ── Daily power readings query ─────────────────────────────────────────────
  const queryStart = viewMode === 'bills'
    ? ((bills ?? []) as any[]).slice(-1)[0]?.period_start ?? ''
    : rangeStart;
  const queryEnd = viewMode === 'bills'
    ? ((bills ?? []) as any[])[0]?.period_end ?? ''
    : rangeEnd;

  const { data: dailyKwh, isFetching } = useQuery({
    queryKey: ['daily-kwh-cmp', plantId, queryStart, queryEnd],
    queryFn: async () => {
      if (!plantId || !queryStart || !queryEnd) return [];
      const { data } = await supabase.from('power_readings')
        .select('reading_datetime,daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,multiplier')
        .eq('plant_id', plantId)
        .gte('reading_datetime', queryStart)
        .lte('reading_datetime', `${queryEnd}T23:59:59.999Z`)
        .order('reading_datetime', { ascending: true });
      return data ?? [];
    },
    enabled: !!plantId && !!queryStart && !!queryEnd,
  });

  // ── Daily chart data ───────────────────────────────────────────────────────
  const dailyChartData = useMemo(() => {
    if (!dailyKwh?.length) return [];
    return dailyKwh.map((r: any) => {
      const grid   = +(r.daily_consumption_kwh ?? r.daily_grid_kwh ?? 0);
      const solar  = +(r.daily_solar_kwh ?? 0);
      const mult   = +(r.multiplier ?? 1);
      const effective = grid * mult;
      return {
        date: format(new Date(r.reading_datetime), 'MMM d'),
        grid:      +grid.toFixed(1),
        solar:     solar > 0 ? +solar.toFixed(1) : null,
        effective: mult !== 1 ? +effective.toFixed(1) : null,
        total:     +(grid + solar).toFixed(1),
      };
    });
  }, [dailyKwh]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!dailyChartData.length) return null;
    const totalGrid   = dailyChartData.reduce((s, d) => s + d.grid,   0);
    const totalSolar  = dailyChartData.reduce((s, d) => s + (d.solar ?? 0), 0);
    const avgDaily    = totalGrid / dailyChartData.length;
    const peakDay     = dailyChartData.reduce((max, d) => d.total > max.total ? d : max, dailyChartData[0]);
    const solarPct    = (totalGrid + totalSolar) > 0 ? (totalSolar / (totalGrid + totalSolar)) * 100 : 0;
    return { totalGrid, totalSolar, avgDaily, peakDay, solarPct };
  }, [dailyChartData]);

  // ── Bill-aligned variance rows ─────────────────────────────────────────────
  const billRows = useMemo(() => (bills ?? []).map((b: any) => {
    const periodReadings = (dailyKwh ?? [])
      .filter((d: any) => d.reading_datetime >= b.period_start && d.reading_datetime <= `${b.period_end}T23:59:59.999Z`);
    const sumDaily = periodReadings.reduce((s: number, d: any) => s + (+d.daily_consumption_kwh || 0), 0);
    const sumEffective = periodReadings.reduce((s: number, d: any) => {
      const mult = d.multiplier != null ? +d.multiplier : (b.multiplier ? +b.multiplier : 1);
      return s + (+d.daily_consumption_kwh || 0) * mult;
    }, 0);
    const variance = b.total_kwh ? ((sumEffective - +b.total_kwh) / +b.total_kwh) * 100 : null;
    return { ...b, sumDaily, sumEffective, variance };
  }), [bills, dailyKwh]);

  const billsChartData = useMemo(() => billRows.slice().reverse().map((r: any) => ({
    month: r.billing_month ? format(parseISO(r.billing_month), 'MMM yy') : '—',
    billed: +r.total_kwh || 0,
    daily: r.sumDaily || 0,
    effective: r.sumEffective || 0,
  })), [billRows]);

  const rangeBtns: { key: typeof viewMode; label: string }[] = [
    { key: '14d', label: '14D' }, { key: '30d', label: '30D' },
    { key: '60d', label: '60D' }, { key: '90d', label: '90D' },
    { key: 'bills', label: 'Bills' }, { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="costs-plant">Plant</Label><PlantPicker value={plantId} onChange={setPlantId} id="costs-plant" /></div>
          {plantId && (
            <div className="flex items-center gap-1 flex-wrap">
              {rangeBtns.map(({ key, label }) => (
                <button key={key} onClick={() => setViewMode(key)}
                  className={['h-6 px-2 rounded text-xs font-medium border transition-colors',
                    viewMode === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                  ].join(' ')}>{label}</button>
              ))}
              {viewMode === 'custom' && (
                <DateRangePicker
                  from={customFrom}
                  to={customTo}
                  onChange={({ from: f, to: t }) => {
                    setCustomFrom(f);
                    setCustomTo(t);
                  }}
                  size="sm"
                  className="h-6 w-[200px] text-xs px-2"
                />
              )}
              <div className="ml-2 flex items-center gap-1">
                <button onClick={() => setChartType('line')}
                  className={['h-6 px-2 rounded text-xs font-medium border transition-colors',
                    chartType === 'line' ? 'bg-kpi-ro text-white border-kpi-ro' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                  ].join(' ')}>Line</button>
                <button onClick={() => setChartType('bar')}
                  className={['h-6 px-2 rounded text-xs font-medium border transition-colors',
                    chartType === 'bar' ? 'bg-kpi-ro text-white border-kpi-ro' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                  ].join(' ')}>Bar</button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Stat boxes ──────────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Grid kWh', value: fmtNum(stats.totalGrid, 0), sub: `avg ${fmtNum(stats.avgDaily, 0)}/day`, color: 'text-chart-1' },
            { label: 'Solar kWh', value: fmtNum(stats.totalSolar, 0), sub: `${stats.solarPct.toFixed(1)}% of total`, color: 'text-accent' },
            { label: 'Peak Day', value: fmtNum(stats.peakDay.total, 0), sub: stats.peakDay.date, color: 'text-warn' },
            { label: 'Days in range', value: String(dailyChartData.length), sub: `${rangeStart} – ${rangeEnd}`, color: 'text-muted-foreground' },
          ].map(({ label, value, sub, color }) => (
            <Card key={label} className="p-3">
              <div className="text-2xs text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
              <div className={`text-xl font-bold font-mono-num ${color}`}>{value}</div>
              <div className="text-2xs text-muted-foreground mt-0.5">{sub}</div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Daily trend chart ───────────────────────────────────────────────── */}
      {plantId && dailyChartData.length > 0 && viewMode !== 'bills' && (
        <Card className="p-3">
          <h4 className="text-sm font-semibold mb-2">
            Daily kWh — {viewMode === 'custom' ? `${customFrom} → ${customTo}` : viewMode.toUpperCase()}
            {isFetching && <span className="text-2xs text-muted-foreground ml-2">Loading…</span>}
          </h4>
          <div className="h-64">
            <ResponsiveContainer>
              {chartType === 'bar' ? (
                <BarChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cmpGridFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="cmpSolarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--kpi-solar))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--kpi-solar))" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="cmpEffFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(dailyChartData.length / 10) - 1)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)', backdropFilter: 'blur(8px)' }}
                    formatter={(v: any, name: string) => [v != null ? `${(+v).toLocaleString()} kWh` : '—', name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* grouped, not stacked — each series stands on its own, so every bar gets the full top radius */}
                  <Bar dataKey="grid"      fill="url(#cmpGridFill)"  name="Grid kWh"          radius={[6, 6, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="solar"     fill="url(#cmpSolarFill)" name="Solar kWh"         radius={[6, 6, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="effective" fill="url(#cmpEffFill)"   name="Eff. kWh (×mult)"  radius={[6, 6, 0, 0]} maxBarSize={32} />
                </BarChart>
              ) : (
                <LineChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(dailyChartData.length / 10) - 1)} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kWh', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: string) => [v != null ? `${(+v).toLocaleString()} kWh` : '—', name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="grid"      stroke="hsl(var(--chart-1))" strokeWidth={2}   dot={false} name="Grid kWh" connectNulls />
                  <Line type="monotone" dataKey="solar"     stroke="hsl(var(--kpi-solar))"  strokeWidth={2}   dot={false} name="Solar kWh" connectNulls />
                  <Line type="monotone" dataKey="effective" stroke="hsl(var(--chart-3))" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Eff. kWh (×mult)" connectNulls />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Bill-aligned comparison chart (Bills mode) ─────────────────────── */}
      {plantId && viewMode === 'bills' && billRows.length > 0 && (
        <>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Billed vs Daily Sum (per billing period)</h4>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={billsChartData}>
                  <defs>
                    <linearGradient id="billsBilledFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="billsDailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="billsEffFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow-elev)', backdropFilter: 'blur(8px)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="billed"    fill="url(#billsBilledFill)" name="Billed kWh"         radius={[6, 6, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="daily"     fill="url(#billsDailyFill)"  name="Sum daily kWh"      radius={[6, 6, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="effective" fill="url(#billsEffFill)"    name="Eff. kWh (×mult)"   radius={[6, 6, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Variance table</h4>
            <div className="space-y-1.5">
              {billRows.map((r: any) => (
                <div key={r.id} className="grid grid-cols-5 gap-2 text-xs border-b last:border-0 py-1.5 items-center">
                  <div className="font-mono-num">{r.billing_month ? format(parseISO(r.billing_month), 'MMM yy') : '—'}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.total_kwh, 0)}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.sumDaily, 0)}</div>
                  <div className="font-mono-num text-right text-warn">{fmtNum(r.sumEffective, 0)}</div>
                  <div className="text-right">
                    {r.variance != null && (
                      <StatusPill tone={Math.abs(r.variance) > 15 ? 'danger' : Math.abs(r.variance) > 5 ? 'warn' : 'accent'}>
                        {r.variance > 0 ? '+' : ''}{r.variance.toFixed(1)}%
                      </StatusPill>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-5 gap-2 text-2xs text-muted-foreground pt-1">
                <div>Month</div><div className="text-right">Billed kWh</div><div className="text-right">Daily Σ</div>
                <div className="text-right text-warn">Eff. kWh×</div><div className="text-right">Δ%</div>
              </div>
              <p className="text-2xs text-muted-foreground mt-1">
                Eff. kWh× = Σ(daily reading × CT multiplier). Variance compares effective kWh to billed.
              </p>
            </div>
          </Card>
        </>
      )}
      {plantId && !billRows.length && viewMode === 'bills' && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No bills entered yet</Card>
      )}
      {plantId && !dailyChartData.length && viewMode !== 'bills' && !isFetching && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No power readings in selected range</Card>
      )}
    </div>
  );
}
