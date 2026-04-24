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
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ComposedChart, Bar, BarChart,
} from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import {
  Droplet, Activity, Zap, FlaskConical, AlertTriangle, Gauge, Thermometer,
  Waves, Cloud, Receipt, Banknote,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';

type RangeKey = '7D' | '14D' | '30D' | '60D' | '90D' | 'CUSTOM';
const RANGE_DAYS: Record<Exclude<RangeKey, 'CUSTOM'>, number> = { '7D': 7, '14D': 14, '30D': 30, '60D': 60, '90D': 90 };

const TREND_Y_LABEL: Record<string, string> = {
  production: 'Volume (m³)',
  rawwater: 'Raw Water (m³)',
  recovery: 'Recovery (%)',
  tds: 'Permeate TDS (ppm)',
  pv: 'kWh · m³',
};

function StatCard({ icon: Icon, label, value, unit, tone, onClick, accent, calc, threshold }: any) {
  return (
    <Card
      className={`stat-card p-3 min-w-0 hover:border-primary/40 transition-colors ${calc ? 'bg-gradient-to-br from-sky-50/40 to-transparent border-sky-200/50 dark:from-sky-950/20' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${accent ?? 'text-muted-foreground'}`} />
        <div className="flex items-center gap-1">
          {calc && (
            <span
              className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-900/40 dark:text-sky-200"
              title="Calculated / derived metric"
            >calc</span>
          )}
          {tone && <StatusPill tone={tone}>•</StatusPill>}
        </div>
      </div>
      <div className="mt-2 font-mono-num text-xl text-foreground leading-none whitespace-nowrap overflow-hidden text-ellipsis">
        {value}
        {unit && <span className="text-xs font-sans text-muted-foreground ml-1">{unit}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-tight break-words">
        {label}
        {threshold && <span className="ml-1 text-[10px] text-muted-foreground/70">(limit {threshold})</span>}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);
  const [downtimeOpen, setDowntimeOpen] = useState(false);

  const visiblePlants = useMemo(
    () => (selectedPlantId ? plants?.filter((p) => p.id === selectedPlantId) : plants),
    [plants, selectedPlantId],
  );
  const plantIds = visiblePlants?.map((p) => p.id) ?? [];

  const today = startOfDay(new Date()).toISOString();

  // ----- Today aggregates from raw tables -----
  const { data: todayLocators } = useQuery({
    queryKey: ['dash-loc-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('locator_readings').select('daily_volume,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  const { data: todayWells } = useQuery({
    queryKey: ['dash-wells-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('well_readings').select('daily_volume,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  const { data: todayPower } = useQuery({
    queryKey: ['dash-power-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('power_readings').select('daily_consumption_kwh,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  const { data: latestRO } = useQuery({
    queryKey: ['dash-ro-recent', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('ro_train_readings')
          .select('permeate_tds,feed_tds,dp_psi,recovery_pct,permeate_ph,turbidity_ntu,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', subDays(new Date(), 1).toISOString())).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Today's production cost (chem + power)
  const { data: todayCosts } = useQuery({
    queryKey: ['dash-costs-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('production_costs').select('chem_cost,power_cost,total_cost,plant_id')
          .in('plant_id', plantIds).eq('cost_date', format(new Date(), 'yyyy-MM-dd'))).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Latest daily summary fallback per plant (today first, else latest)
  const { data: dailySummary } = useQuery({
    queryKey: ['dash-summary-recent', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('daily_plant_summary').select('*').in('plant_id', plantIds)
          .order('summary_date', { ascending: false }).limit(plantIds.length * 5)).data ?? []
      : [],
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
  const avgFeedTds = (latestRO ?? []).length
    ? +((latestRO as any[]).reduce((s, r) => s + (r.feed_tds ?? 0), 0) / (latestRO as any[]).length).toFixed(0)
    : null;
  const avgRecovery = (latestRO ?? []).length
    ? +((latestRO as any[]).reduce((s, r) => s + (r.recovery_pct ?? 0), 0) / (latestRO as any[]).length).toFixed(1)
    : null;
  const avgTurb = (latestRO ?? []).length
    ? +((latestRO as any[]).reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / (latestRO as any[]).length).toFixed(2)
    : null;

  // Costs aggregate (today). Fallback to most recent daily_plant_summary row per plant for missing fields.
  const chemCost = (todayCosts ?? []).reduce((s, r: any) => s + (+r.chem_cost || 0), 0);
  const powerCost = (todayCosts ?? []).reduce((s, r: any) => s + (+r.power_cost || 0), 0);
  const productionCost = chemCost + powerCost;

  // Pull latest daily_plant_summary per plant (for blending, downtime, raw water)
  const latestPerPlant = useMemo(() => {
    const m = new Map<string, any>();
    (dailySummary ?? []).forEach((r: any) => { if (!m.has(r.plant_id)) m.set(r.plant_id, r); });
    return Array.from(m.values());
  }, [dailySummary]);
  const blending = latestPerPlant.reduce((s, r: any) => s + (+r.blending_m3 || 0), 0);
  const downtime = latestPerPlant.reduce((s, r: any) => s + (+r.downtime_hrs || 0), 0);
  const rawWater = latestPerPlant.reduce((s, r: any) => s + (+r.raw_water_consumption_m3 || 0), 0);

  const { data: chemInv } = useQuery({
    queryKey: ['dash-chem', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('chemical_inventory').select('*').in('plant_id', plantIds)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });

  const trainGaps = useTrainAutoOffline(plantIds);

  // Legacy RO/chem alerts (still useful, live-computed)
  const localAlerts: { tone: 'danger' | 'warn'; text: string }[] = [];
  trainGaps.forEach((g) => localAlerts.push({ tone: 'warn', text: `Train ${g.train_number} no reading ${g.hours_gap.toFixed(1)}h — auto-flagged Offline` }));
  (latestRO ?? []).forEach((r: any) => {
    if (r.dp_psi >= 40) localAlerts.push({ tone: 'danger', text: `DP alert: ${r.dp_psi} psi` });
    if (r.permeate_tds >= 600) localAlerts.push({ tone: 'danger', text: `TDS alert: ${r.permeate_tds} ppm` });
    if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) localAlerts.push({ tone: 'warn', text: `pH out of range: ${r.permeate_ph}` });
  });
  (chemInv ?? []).forEach((c: any) => {
    if (c.current_stock < c.low_stock_threshold) localAlerts.push({ tone: 'warn', text: `Low stock: ${c.chemical_name}` });
  });

  // Unified alerts feed (downtime / blending / recovery) served from backend
  const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
  const { data: feed } = useQuery<{ count: number; alerts: any[] }>({
    queryKey: ['alerts-feed', selectedPlantId],
    queryFn: async () => {
      const qs = new URLSearchParams({ days: '30' });
      if (selectedPlantId) qs.set('plant_id', selectedPlantId);
      const res = await fetch(`${BASE}/api/alerts/feed?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const feedAlerts = feed?.alerts ?? [];

  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          {selectedPlantId ? visiblePlants?.[0]?.name : `All plants (${plants?.length ?? 0})`} · Today
        </p>
      </div>

      {/* 8 primary KPI tiles — auto-fits to longest label, slightly narrower */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
        <StatCard icon={Droplet} accent="text-primary" label="Production" value={fmtNum(production)} unit="m³"
          onClick={() => setModal({ metric: 'production', title: 'Production Trend' })} />
        <StatCard icon={Receipt} accent="text-highlight" label="Locator Consumption" value={fmtNum(consumption)} unit="m³"
          onClick={() => setModal({ metric: 'production', title: 'Production Vs Consumption' })} />
        <StatCard icon={Activity} label="NRW Water Loss" value={nrw == null ? '—' : nrw} unit="%" tone={nrwColor(nrw)}
          calc threshold="20%"
          onClick={() => setModal({ metric: 'nrw', title: 'NRW trend' })} />
        <StatCard icon={Zap} accent="text-chart-6" label="PV Ratio" value={pv == null ? '—' : pv} unit="kWh/m³"
          calc threshold="1.2"
          onClick={() => setModal({ metric: 'pv', title: 'PV ratio trend' })} />

        <StatCard icon={Waves} label="Bypass → Product" value={fmtNum(blending)} unit="m³" />
        <StatCard icon={Gauge} label="Feed TDS" value={avgFeedTds ?? '—'} unit="ppm" />
        <StatCard icon={FlaskConical} accent="text-accent" label="Product TDS" value={avgPermTds ?? '—'} unit="ppm"
          onClick={() => setModal({ metric: 'tds', title: 'Permeate TDS trend' })} />
        <StatCard icon={Cloud} label="Raw Turbidity" value={avgTurb ?? '—'} unit="NTU" />
      </div>

      {/* Operations row */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
        <StatCard icon={Droplet} label="Raw Water (Wells)" value={fmtNum(rawWater)} unit="m³"
          onClick={() => setModal({ metric: 'rawwater', title: 'Raw Water Trendline' })} />
        <StatCard icon={Thermometer} label="Recovery" value={avgRecovery ?? '—'} unit="%"
          onClick={() => setModal({ metric: 'recovery', title: 'Recovery Trendline' })} />
        <StatCard icon={Zap} accent="text-chart-6" label="Power kWh" value={fmtNum(kwh)} unit="kWh" />
      </div>

      {/* Cost row — Production / Power / Chem cost */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(132px,1fr))]">
        <StatCard icon={Banknote} accent="text-accent" label="Production Cost"
          calc value={`₱${fmtNum(productionCost, 0)}`} unit="" onClick={() => navigate('/costs')} />
        <StatCard icon={Zap} accent="text-chart-6" label="Power Cost"
          value={`₱${fmtNum(powerCost, 0)}`} unit="" onClick={() => navigate('/costs')} />
        <StatCard icon={FlaskConical} accent="text-highlight" label="Chem Cost"
          value={`₱${fmtNum(chemCost, 0)}`} unit="" onClick={() => navigate('/costs')} />
      </div>

      <Card className="p-3" data-testid="alerts-card">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-danger" />
          <h2 className="text-sm font-semibold">Active Alerts</h2>
          <span className="text-[10px] text-muted-foreground">
            {feedAlerts.length + localAlerts.length} active
          </span>
          {(feedAlerts.length + localAlerts.length) > 0 && <span className="pulse-dot ml-auto" />}
        </div>

        {/* Unified feed — downtime, blending, recovery */}
        {feedAlerts.length > 0 && (
          <div className="space-y-1.5 mb-2" data-testid="alerts-feed-list">
            {feedAlerts.slice(0, 8).map((a, i) => {
              const tone = a.severity === 'high' ? 'danger'
                : a.severity === 'medium' ? 'warn'
                : a.severity === 'low' ? 'accent'
                : 'info' as const;
              const kindLabel = a.kind === 'downtime' ? 'Downtime'
                : a.kind === 'blending' ? 'Bypass'
                : 'Recovery';
              return (
                <button
                  key={`feed-${i}`}
                  className="w-full text-left flex items-start gap-2 text-xs hover:bg-muted/40 rounded px-1 py-1"
                  onClick={() => {
                    if (a.kind === 'downtime') setDowntimeOpen(true);
                  }}
                  data-testid={`alert-row-${a.kind}-${i}`}
                >
                  <StatusPill tone={tone as any}>{kindLabel}</StatusPill>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.title}</div>
                    {a.detail && <div className="text-muted-foreground truncate">{a.detail}</div>}
                  </div>
                  <span className="font-mono-num text-[10px] text-muted-foreground shrink-0 mt-0.5">{a.date}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Live-computed RO / chem / train gap alerts */}
        {localAlerts.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t">
            {localAlerts.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <StatusPill tone={a.tone}>{a.tone}</StatusPill>
                <span className="text-xs">{a.text}</span>
              </div>
            ))}
          </div>
        )}

        {feedAlerts.length === 0 && localAlerts.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">All clear — no alerts</p>
        )}
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

      <PowerChart plantIds={plantIds} />
      <EnergyMixCard plantIds={plantIds} />

      <TrendModal open={!!modal} onClose={() => setModal(null)} metric={modal?.metric ?? ''} title={modal?.title ?? ''} plantIds={plantIds} />
      <DowntimeEventsModal
        open={downtimeOpen}
        onClose={() => setDowntimeOpen(false)}
        plantId={selectedPlantId || undefined}
        plantName={selectedPlantId ? visiblePlants?.[0]?.name : 'All plants'}
      />
    </div>
  );
}

function PowerChart({ plantIds }: { plantIds: string[] }) {
  const { data } = useQuery({
    queryKey: ['dash-power-chart', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const since = subDays(new Date(), 14).toISOString();
      const { data } = await supabase.from('power_readings')
        .select('reading_datetime,daily_consumption_kwh').in('plant_id', plantIds)
        .gte('reading_datetime', since).order('reading_datetime');
      return data ?? [];
    },
    enabled: plantIds.length > 0,
  });
  const chartData = useMemo(() => {
    const m = new Map<string, { sortKey: number; kwh: number }>();
    (data ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const d = format(dt, 'MMM d');
      const cur = m.get(d) ?? { sortKey: dt.getTime(), kwh: 0 };
      cur.kwh += +r.daily_consumption_kwh || 0;
      m.set(d, cur);
    });
    return Array.from(m.entries())
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([date, v]) => ({ date, kwh: v.kwh }));
  }, [data]);
  return (
    <Card className="p-3">
      <h2 className="text-sm font-semibold mb-2">Power consumption · last 14d</h2>
      <div className="h-44">
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
            <Bar dataKey="kwh" fill="hsl(var(--chart-6))" name="kWh" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function TrendModal({ open, onClose, metric, title, plantIds }: { open: boolean; onClose: () => void; metric: string; title: string; plantIds: string[] }) {
  const [range, setRange] = useState<RangeKey>('7D');
  const [from, setFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Stable date-bounded ISO strings so react-query can cache properly.
  const { startISO, endISO, startKey, endKey } = useMemo(() => {
    if (range === 'CUSTOM') {
      const s = new Date(`${from}T00:00:00`);
      const e = new Date(`${to}T23:59:59`);
      return {
        startISO: s.toISOString(), endISO: e.toISOString(),
        startKey: from, endKey: to,
      };
    }
    const days = RANGE_DAYS[range];
    const end = new Date();
    const start = startOfDay(subDays(end, days));
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startKey: format(start, 'yyyy-MM-dd'),
      endKey: format(end, 'yyyy-MM-dd'),
    };
  }, [range, from, to]);

  const needsWellReadings = metric === 'production' || metric === 'nrw' || metric === 'rawwater' || metric === 'pv';
  const needsLocReadings = metric === 'production' || metric === 'nrw';
  const needsRoReadings = metric === 'recovery' || metric === 'tds';
  const needsPowerReadings = metric === 'pv';

  const { data: locReadings, isFetching: fetchingLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('locator_readings').select('daily_volume,reading_datetime')
          .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO)).data ?? []
      : [],
    enabled: open && plantIds.length > 0 && needsLocReadings,
  });
  const { data: wellReadings, isFetching: fetchingWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('well_readings').select('daily_volume,reading_datetime')
          .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO)).data ?? []
      : [],
    enabled: open && plantIds.length > 0 && needsWellReadings,
  });
  const { data: roReadings, isFetching: fetchingRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('ro_train_readings').select('recovery_pct,permeate_tds,reading_datetime')
          .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO)).data ?? []
      : [],
    enabled: open && plantIds.length > 0 && needsRoReadings,
  });
  const { data: powerReadings, isFetching: fetchingPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('power_readings').select('daily_consumption_kwh,reading_datetime')
          .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO)).data ?? []
      : [],
    enabled: open && plantIds.length > 0 && needsPowerReadings,
  });

  const isFetching = fetchingLoc || fetchingWell || fetchingRo || fetchingPower;

  const chartData = useMemo(() => {
    const byDay = new Map<string, any>();
    const ensure = (d: string, sortKey: number) =>
      byDay.get(d) ?? byDay.set(d, {
        date: d, sortKey, production: 0, consumption: 0,
        rawwater: 0, recovery: 0, recoverySamples: 0,
        tds: 0, tdsSamples: 0, kwh: 0,
      }).get(d);

    (wellReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.production += r.daily_volume ?? 0;
      row.rawwater += r.daily_volume ?? 0;
    });
    (locReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      ensure(key, dt.getTime()).consumption += r.daily_volume ?? 0;
    });
    (roReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      if (r.recovery_pct != null) { row.recovery += +r.recovery_pct; row.recoverySamples += 1; }
      if (r.permeate_tds != null) { row.tds += +r.permeate_tds; row.tdsSamples += 1; }
    });
    (powerReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      ensure(key, dt.getTime()).kwh += +r.daily_consumption_kwh || 0;
    });

    return Array.from(byDay.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _s, recoverySamples, tdsSamples, ...d }) => ({
        ...d,
        recovery: recoverySamples ? +(d.recovery / recoverySamples).toFixed(1) : null,
        tds: tdsSamples ? Math.round(d.tds / tdsSamples) : null,
        nrw: calc.nrw(d.production, d.consumption),
      }));
  }, [locReadings, wellReadings, roReadings, powerReadings]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
            <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'}
              onClick={() => setRange(r)} data-testid={`trend-range-${r}`}>{r}</Button>
          ))}
          <Button size="sm" variant={range === 'CUSTOM' ? 'default' : 'outline'} onClick={() => setRange('CUSTOM')}>Custom</Button>
        </div>
        {range === 'CUSTOM' && (
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="flex-1"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        )}
        <div className="h-[420px] w-full" data-testid={`trend-chart-${metric}`}>
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'nrw' ? (
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Date', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis yAxisId="vol" tick={{ fontSize: 11 }} stroke="hsl(var(--chart-1))" label={{ value: 'Volume (m³)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(var(--warn))" label={{ value: 'NRW (%)', angle: 90, position: 'insideRight', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="vol" dataKey="production" fill="hsl(var(--chart-1))" name="Production (m³)" />
                <Bar yAxisId="vol" dataKey="consumption" fill="hsl(var(--chart-2))" name="Consumption (m³)" />
                <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke="hsl(var(--warn))" strokeWidth={2.5} dot={{ r: 3 }} name="NRW %" />
              </ComposedChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Date', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: TREND_Y_LABEL[metric] ?? 'Value', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {metric === 'production' && (<>
                  <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                  <Line type="monotone" dataKey="consumption" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Consumption (m³)" />
                </>)}
                {metric === 'rawwater' && (
                  <Line type="monotone" dataKey="rawwater" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Raw Water (m³)" />
                )}
                {metric === 'recovery' && (
                  <Line type="monotone" dataKey="recovery" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={{ r: 2 }} name="Recovery (%)" />
                )}
                {metric === 'tds' && (
                  <Line type="monotone" dataKey="tds" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Permeate TDS (ppm)" />
                )}
                {metric === 'pv' && (<>
                  <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                  <Line type="monotone" dataKey="kwh" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (kWh)" />
                </>)}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
