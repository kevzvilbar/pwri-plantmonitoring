import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { calc, fmtNum, nrwColor } from '@/lib/calculations';
import { StatusPill } from '@/components/StatusPill';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Bar } from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import { Droplet, Activity, Zap, FlaskConical, AlertTriangle, Cog } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';

type RangeKey = '7D' | '14D' | '30D' | '90D' | '200' | 'CUSTOM';

function StatCard({ icon: Icon, label, value, unit, tone = 'default', onClick }: any) {
  return (
    <Card className="stat-card" onClick={onClick}>
      <div className="flex items-start justify-between">
        <Icon className="h-5 w-5 text-muted-foreground" />
        {tone !== 'default' && <StatusPill tone={tone}>live</StatusPill>}
      </div>
      <div className="mt-3 font-mono-num text-2xl text-foreground leading-none">{value}<span className="text-sm font-sans text-muted-foreground ml-1">{unit}</span></div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}

export default function Dashboard() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);

  const visiblePlants = useMemo(() => selectedPlantId ? plants?.filter(p => p.id === selectedPlantId) : plants, [plants, selectedPlantId]);
  const plantIds = visiblePlants?.map(p => p.id) ?? [];

  // Today's production / consumption
  const today = startOfDay(new Date()).toISOString();
  const { data: todayLocators } = useQuery({
    queryKey: ['dash-loc-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('locator_readings')
        .select('daily_volume,plant_id').in('plant_id', plantIds).gte('reading_datetime', today);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
  });

  const { data: todayWells } = useQuery({
    queryKey: ['dash-wells-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('well_readings')
        .select('daily_volume,plant_id').in('plant_id', plantIds).gte('reading_datetime', today);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
  });

  const { data: todayPower } = useQuery({
    queryKey: ['dash-power-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('power_readings')
        .select('daily_consumption_kwh,plant_id').in('plant_id', plantIds).gte('reading_datetime', today);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
  });

  const { data: latestRO } = useQuery({
    queryKey: ['dash-ro-recent', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const since = subDays(new Date(), 1).toISOString();
      const { data } = await supabase.from('ro_train_readings')
        .select('permeate_tds,dp_psi,recovery_pct,permeate_ph,plant_id').in('plant_id', plantIds).gte('reading_datetime', since);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
  });

  const production = (todayWells ?? []).reduce((s, r: any) => s + (r.daily_volume ?? 0), 0);
  const consumption = (todayLocators ?? []).reduce((s, r: any) => s + (r.daily_volume ?? 0), 0);
  const kwh = (todayPower ?? []).reduce((s, r: any) => s + (r.daily_consumption_kwh ?? 0), 0);
  const nrw = calc.nrw(production, consumption);
  const pv = calc.pvRatio(kwh, production);
  const avgPermTds = (latestRO ?? []).length
    ? +((latestRO as any[]).reduce((s, r) => s + (r.permeate_tds ?? 0), 0) / (latestRO as any[]).length).toFixed(0)
    : null;

  const { data: chemInv } = useQuery({
    queryKey: ['dash-chem', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('chemical_inventory').select('*').in('plant_id', plantIds);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
  });

  const trainGaps = useTrainAutoOffline(plantIds);

  const alerts: { tone: 'danger' | 'warn'; text: string }[] = [];
  trainGaps.forEach((g) => alerts.push({ tone: 'warn', text: `Train ${g.train_number} no reading ${g.hours_gap.toFixed(1)}h — auto-flagged Offline` }));
  (latestRO ?? []).forEach((r: any) => {
    if (r.dp_psi >= 40) alerts.push({ tone: 'danger', text: `DP alert: ${r.dp_psi} psi` });
    if (r.permeate_tds >= 600) alerts.push({ tone: 'danger', text: `TDS alert: ${r.permeate_tds} ppm` });
    if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) alerts.push({ tone: 'warn', text: `pH out of range: ${r.permeate_ph}` });
  });
  (chemInv ?? []).forEach((c: any) => {
    if (c.current_stock < c.low_stock_threshold) alerts.push({ tone: 'warn', text: `Low stock: ${c.chemical_name}` });
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{selectedPlantId ? visiblePlants?.[0]?.name : `All plants (${plants?.length ?? 0})`} · Today</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Droplet} label="Production today" value={fmtNum(production)} unit="m³" onClick={() => setModal({ metric: 'production', title: 'Production trend' })} />
        <StatCard icon={Activity} label="NRW" value={nrw == null ? '—' : `${nrw}`} unit="%" tone={nrwColor(nrw)} onClick={() => setModal({ metric: 'nrw', title: 'NRW trend' })} />
        <StatCard icon={Zap} label="PV Ratio" value={pv == null ? '—' : pv} unit="kWh/m³" onClick={() => setModal({ metric: 'pv', title: 'PV ratio trend' })} />
        <StatCard icon={FlaskConical} label="Avg permeate TDS" value={avgPermTds ?? '—'} unit="ppm" onClick={() => setModal({ metric: 'tds', title: 'Permeate TDS trend' })} />
      </div>

      {alerts.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <h2 className="text-sm font-semibold">Active alerts</h2>
            <span className="pulse-dot ml-auto" />
          </div>
          <div className="space-y-1.5">
            {alerts.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <StatusPill tone={a.tone}>{a.tone}</StatusPill>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-2">Plant overview</h2>
        <div className="space-y-2">
          {visiblePlants?.map((p) => {
            const plantProd = (todayWells ?? []).filter((r: any) => r.plant_id === p.id).reduce((s, r: any) => s + (r.daily_volume ?? 0), 0);
            const plantCons = (todayLocators ?? []).filter((r: any) => r.plant_id === p.id).reduce((s, r: any) => s + (r.daily_volume ?? 0), 0);
            const pNrw = calc.nrw(plantProd, plantCons);
            return (
              <button key={p.id} onClick={() => navigate(`/plants/${p.id}`)} className="w-full flex items-center justify-between p-2 rounded-md border hover:bg-secondary transition-colors text-left">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">Today: <span className="font-mono-num">{fmtNum(plantProd)}</span> m³</div>
                </div>
                <StatusPill tone={nrwColor(pNrw)}>NRW {pNrw == null ? '—' : `${pNrw}%`}</StatusPill>
              </button>
            );
          })}
          {!visiblePlants?.length && <p className="text-sm text-muted-foreground py-4 text-center">No plants assigned</p>}
        </div>
      </Card>

      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-2">Chemical stock</h2>
        <div className="space-y-2.5">
          {(chemInv ?? []).slice(0, 8).map((c: any) => {
            const pct = c.low_stock_threshold ? Math.min(100, (c.current_stock / (c.low_stock_threshold * 4)) * 100) : 0;
            return (
              <div key={c.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{c.chemical_name}</span>
                  <span className="font-mono-num">{c.current_stock} {c.unit}</span>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
            );
          })}
          {!chemInv?.length && <p className="text-sm text-muted-foreground py-2 text-center">No inventory yet</p>}
        </div>
      </Card>

      <TrendModal open={!!modal} onClose={() => setModal(null)} metric={modal?.metric ?? ''} title={modal?.title ?? ''} plantIds={plantIds} />
    </div>
  );
}

function TrendModal({ open, onClose, metric, title, plantIds }: { open: boolean; onClose: () => void; metric: string; title: string; plantIds: string[] }) {
  const [range, setRange] = useState<RangeKey>('7D');
  const [from, setFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const days = range === '7D' ? 7 : range === '14D' ? 14 : range === '30D' ? 30 : range === '90D' ? 90 : range === '200' ? 200 : null;

  const startISO = days ? subDays(new Date(), days).toISOString() : new Date(from).toISOString();
  const endISO = days ? new Date().toISOString() : new Date(to + 'T23:59:59').toISOString();

  const { data: locReadings } = useQuery({
    queryKey: ['trend-loc', metric, startISO, endISO, plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('locator_readings')
        .select('daily_volume,reading_datetime').in('plant_id', plantIds)
        .gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      return data ?? [];
    },
    enabled: open && plantIds.length > 0,
  });

  const { data: wellReadings } = useQuery({
    queryKey: ['trend-well', metric, startISO, endISO, plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('well_readings')
        .select('daily_volume,reading_datetime').in('plant_id', plantIds)
        .gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      return data ?? [];
    },
    enabled: open && plantIds.length > 0,
  });

  const chartData = useMemo(() => {
    const byDay = new Map<string, { date: string; production: number; consumption: number }>();
    const ensure = (d: string) => byDay.get(d) ?? byDay.set(d, { date: d, production: 0, consumption: 0 }).get(d)!;
    (wellReadings ?? []).forEach((r: any) => {
      const d = format(new Date(r.reading_datetime), 'MMM d');
      ensure(d).production += r.daily_volume ?? 0;
    });
    (locReadings ?? []).forEach((r: any) => {
      const d = format(new Date(r.reading_datetime), 'MMM d');
      ensure(d).consumption += r.daily_volume ?? 0;
    });
    return Array.from(byDay.values()).map(d => ({
      ...d,
      nrw: calc.nrw(d.production, d.consumption),
    }));
  }, [locReadings, wellReadings]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {(['7D', '14D', '30D', '90D', '200'] as RangeKey[]).map((r) => (
            <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} onClick={() => setRange(r)}>{r}</Button>
          ))}
          <Button size="sm" variant={range === 'CUSTOM' ? 'default' : 'outline'} onClick={() => setRange('CUSTOM')}>Custom</Button>
        </div>
        {range === 'CUSTOM' && (
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="flex-1"><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
        )}
        <div className="h-[420px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'nrw' ? (
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="vol" tick={{ fontSize: 11 }} stroke="hsl(var(--chart-1))" label={{ value: 'm³', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(var(--warn))" label={{ value: 'NRW %', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="vol" dataKey="production" fill="hsl(var(--chart-1))" name="Production (m³)" />
                <Bar yAxisId="vol" dataKey="consumption" fill="hsl(var(--chart-2))" name="Consumption (m³)" />
                <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke="hsl(var(--warn))" strokeWidth={2.5} dot={{ r: 3 }} name="NRW %" />
              </ComposedChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                <Line type="monotone" dataKey="consumption" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Consumption (m³)" />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted-foreground">NRW = (Production − Consumption) / Production × 100%</p>
      </DialogContent>
    </Dialog>
  );
}
