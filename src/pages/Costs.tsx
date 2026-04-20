import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';

export default function Costs() {
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Costs</h1>
        <p className="text-sm text-muted-foreground">Power tariffs, electric bills, and production costs</p>
      </div>
      <Tabs defaultValue="rollup">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="rollup">Rollup</TabsTrigger>
          <TabsTrigger value="tariff">Tariff</TabsTrigger>
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>
        <TabsContent value="rollup" className="mt-3"><Rollup /></TabsContent>
        <TabsContent value="tariff" className="mt-3"><Tariff /></TabsContent>
        <TabsContent value="bills" className="mt-3"><Bills /></TabsContent>
        <TabsContent value="compare" className="mt-3"><Compare /></TabsContent>
      </Tabs>
    </div>
  );
}

function PlantPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Rollup() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [from, setFrom] = useState(format(subMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data, refetch } = useQuery({
    queryKey: ['cost-rollup', plantId, from, to],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase.from('production_costs')
        .select('*').eq('plant_id', plantId)
        .gte('cost_date', from).lte('cost_date', to)
        .order('cost_date');
      return data ?? [];
    },
    enabled: !!plantId,
  });

  const totals = useMemo(() => {
    const r = (data ?? []).reduce((acc: any, x: any) => {
      acc.chem += +x.chem_cost || 0; acc.power += +x.power_cost || 0;
      acc.prod += +x.production_m3 || 0;
      return acc;
    }, { chem: 0, power: 0, prod: 0 });
    return { ...r, total: r.chem + r.power, perM3: r.prod ? (r.chem + r.power) / r.prod : null };
  }, [data]);

  const chartData = (data ?? []).map((d: any) => ({
    date: format(parseISO(d.cost_date), 'MMM d'),
    chem: +d.chem_cost || 0,
    power: +d.power_cost || 0,
    perM3: +d.cost_per_m3 || 0,
  }));

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </Card>
      {plantId && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="text-xs text-muted-foreground">Chem cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.chem, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Power cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.power, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Production</div><div className="font-mono-num text-lg">{fmtNum(totals.prod, 0)} m³</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Cost/m³</div><div className="font-mono-num text-lg">{totals.perM3 ? `₱${totals.perM3.toFixed(2)}` : '—'}</div></Card>
          </div>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Daily costs</h4>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="chem" stackId="c" fill="hsl(var(--chart-2))" name="Chem ₱" />
                  <Bar dataKey="power" stackId="c" fill="hsl(var(--chart-1))" name="Power ₱" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Driver notes</h4>
            <DriverNotes plantId={plantId} rows={data ?? []} onSaved={refetch} />
          </Card>
        </>
      )}
      {!plantId && <Card className="p-6 text-center text-sm text-muted-foreground">Select a plant</Card>}
    </div>
  );
}

function DriverNotes({ plantId, rows, onSaved }: { plantId: string; rows: any[]; onSaved: () => void }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const save = async () => {
    const { error } = await supabase.from('production_costs')
      .update({ driver_notes: notes }).eq('plant_id', plantId).eq('cost_date', date);
    if (error) { toast.error(error.message); return; }
    toast.success('Notes saved'); setNotes(''); onSaved();
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <Textarea placeholder="What drove cost change today? (e.g., chlorine top-up, new tariff effective)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button onClick={save} size="sm">Save note</Button>
      <div className="space-y-1 mt-2">
        {rows.filter((r: any) => r.driver_notes).slice(-5).reverse().map((r: any) => (
          <div key={r.id} className="text-xs border-l-2 border-primary pl-2"><span className="font-mono-num">{r.cost_date}</span> · {r.driver_notes}</div>
        ))}
      </div>
    </div>
  );
}

function Tariff() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [v, setV] = useState({ effective_date: format(new Date(), 'yyyy-MM-dd'), rate_per_kwh: '', multiplier: '1', provider: '', remarks: '' });

  const { data: tariffs } = useQuery({
    queryKey: ['tariffs', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_tariffs').select('*').eq('plant_id', plantId).order('effective_date', { ascending: false })).data ?? [] : [],
    enabled: !!plantId,
  });

  const submit = async () => {
    if (!plantId || !v.rate_per_kwh) { toast.error('Plant and rate required'); return; }
    const { error } = await supabase.from('power_tariffs').insert({
      plant_id: plantId, effective_date: v.effective_date,
      rate_per_kwh: +v.rate_per_kwh, multiplier: +v.multiplier || 1,
      provider: v.provider || null, remarks: v.remarks || null, created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Tariff saved');
    setV({ effective_date: format(new Date(), 'yyyy-MM-dd'), rate_per_kwh: '', multiplier: '1', provider: '', remarks: '' });
    qc.invalidateQueries({ queryKey: ['tariffs'] });
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Effective date</Label><Input type="date" value={v.effective_date} onChange={(e) => setV({ ...v, effective_date: e.target.value })} /></div>
          <div><Label className="text-xs">Provider</Label><Input value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} placeholder="VECO / NGCP" /></div>
          <div><Label className="text-xs">Rate ₱/kWh</Label><Input type="number" step="any" value={v.rate_per_kwh} onChange={(e) => setV({ ...v, rate_per_kwh: e.target.value })} /></div>
          <div><Label className="text-xs">Multiplier</Label><Input type="number" step="any" value={v.multiplier} onChange={(e) => setV({ ...v, multiplier: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Remarks</Label><Input value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} /></div>
        </div>
        <Button onClick={submit} className="w-full" size="sm">Add tariff</Button>
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">History</h4>
        <div className="space-y-1.5">
          {tariffs?.map((t: any) => (
            <div key={t.id} className="flex justify-between items-center text-xs border-b last:border-0 py-1.5">
              <div>
                <div className="font-mono-num">{t.effective_date}</div>
                <div className="text-muted-foreground">{t.provider ?? '—'} · ×{t.multiplier}</div>
              </div>
              <div className="font-mono-num font-semibold">₱{(+t.rate_per_kwh).toFixed(4)}/kWh</div>
            </div>
          ))}
          {!tariffs?.length && plantId && <p className="text-xs text-center text-muted-foreground py-2">No tariffs</p>}
        </div>
      </Card>
    </div>
  );
}

function Bills() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [v, setV] = useState({
    billing_month: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    period_start: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    period_end: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    previous_reading: '', current_reading: '', multiplier: '1',
    generation_charge: '', distribution_charge: '', other_charges: '', total_amount: '',
    remarks: '',
  });

  const totalKwh = v.previous_reading && v.current_reading
    ? (+v.current_reading - +v.previous_reading) * (+v.multiplier || 1) : null;

  const { data: bills } = useQuery({
    queryKey: ['bills', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false })).data ?? [] : [],
    enabled: !!plantId,
  });

  const submit = async () => {
    if (!plantId || !v.total_amount) { toast.error('Plant and total required'); return; }
    const { error } = await supabase.from('electric_bills').insert({
      plant_id: plantId, billing_month: v.billing_month,
      period_start: v.period_start, period_end: v.period_end,
      previous_reading: +v.previous_reading || 0, current_reading: +v.current_reading || 0,
      multiplier: +v.multiplier || 1, total_kwh: totalKwh,
      generation_charge: v.generation_charge ? +v.generation_charge : null,
      distribution_charge: v.distribution_charge ? +v.distribution_charge : null,
      other_charges: v.other_charges ? +v.other_charges : null,
      total_amount: +v.total_amount, remarks: v.remarks || null, recorded_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Bill saved');
    qc.invalidateQueries({ queryKey: ['bills'] });
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Billing month</Label><Input type="date" value={v.billing_month} onChange={(e) => setV({ ...v, billing_month: e.target.value })} /></div>
          <div><Label className="text-xs">Multiplier</Label><Input type="number" step="any" value={v.multiplier} onChange={(e) => setV({ ...v, multiplier: e.target.value })} /></div>
          <div><Label className="text-xs">Period start</Label><Input type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: e.target.value })} /></div>
          <div><Label className="text-xs">Period end</Label><Input type="date" value={v.period_end} onChange={(e) => setV({ ...v, period_end: e.target.value })} /></div>
          <div><Label className="text-xs">Previous reading</Label><Input type="number" step="any" value={v.previous_reading} onChange={(e) => setV({ ...v, previous_reading: e.target.value })} /></div>
          <div><Label className="text-xs">Current reading</Label><Input type="number" step="any" value={v.current_reading} onChange={(e) => setV({ ...v, current_reading: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Total kWh (auto)</Label><Input value={totalKwh ?? ''} readOnly /></div>
          <div><Label className="text-xs">Generation ₱</Label><Input type="number" step="any" value={v.generation_charge} onChange={(e) => setV({ ...v, generation_charge: e.target.value })} /></div>
          <div><Label className="text-xs">Distribution ₱</Label><Input type="number" step="any" value={v.distribution_charge} onChange={(e) => setV({ ...v, distribution_charge: e.target.value })} /></div>
          <div><Label className="text-xs">Other ₱</Label><Input type="number" step="any" value={v.other_charges} onChange={(e) => setV({ ...v, other_charges: e.target.value })} /></div>
          <div><Label className="text-xs">Total ₱</Label><Input type="number" step="any" value={v.total_amount} onChange={(e) => setV({ ...v, total_amount: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Remarks</Label><Input value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} /></div>
        </div>
        <Button onClick={submit} className="w-full" size="sm">Save bill</Button>
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-semibold mb-2">Recent bills</h4>
        <div className="space-y-1.5">
          {bills?.map((b: any) => (
            <div key={b.id} className="flex justify-between items-center text-xs border-b last:border-0 py-1.5">
              <div>
                <div className="font-mono-num">{format(parseISO(b.billing_month), 'MMM yyyy')}</div>
                <div className="text-muted-foreground font-mono-num">{fmtNum(b.total_kwh, 0)} kWh</div>
              </div>
              <div className="font-mono-num font-semibold">₱{fmtNum(b.total_amount, 2)}</div>
            </div>
          ))}
          {!bills?.length && plantId && <p className="text-xs text-center text-muted-foreground py-2">No bills</p>}
        </div>
      </Card>
    </div>
  );
}

function Compare() {
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  const { data: bills } = useQuery({
    queryKey: ['bills-cmp', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(6)).data ?? [] : [],
    enabled: !!plantId,
  });

  const { data: dailyKwh } = useQuery({
    queryKey: ['daily-kwh-cmp', plantId, bills?.length],
    queryFn: async () => {
      if (!plantId || !bills?.length) return [];
      const earliest = bills[bills.length - 1].period_start;
      const latest = bills[0].period_end;
      const { data } = await supabase.from('power_readings')
        .select('reading_datetime,daily_consumption_kwh')
        .eq('plant_id', plantId)
        .gte('reading_datetime', earliest)
        .lte('reading_datetime', latest + 'T23:59:59');
      return data ?? [];
    },
    enabled: !!plantId && !!bills?.length,
  });

  const rows = (bills ?? []).map((b: any) => {
    const sumDaily = (dailyKwh ?? [])
      .filter((d: any) => d.reading_datetime >= b.period_start && d.reading_datetime <= b.period_end + 'T23:59:59')
      .reduce((s: number, d: any) => s + (+d.daily_consumption_kwh || 0), 0);
    const variance = b.total_kwh ? ((sumDaily - +b.total_kwh) / +b.total_kwh) * 100 : null;
    return { ...b, sumDaily, variance };
  });

  const chartData = rows.slice().reverse().map((r: any) => ({
    month: format(parseISO(r.billing_month), 'MMM yy'),
    billed: +r.total_kwh || 0,
    daily: r.sumDaily || 0,
  }));

  return (
    <div className="space-y-3">
      <Card className="p-3"><div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div></Card>
      {plantId && rows.length > 0 && (
        <>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Billed vs Daily Sum</h4>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="billed" fill="hsl(var(--chart-1))" name="Billed kWh" />
                  <Bar dataKey="daily" fill="hsl(var(--chart-2))" name="Sum daily kWh" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Variance table</h4>
            <div className="space-y-1.5">
              {rows.map((r: any) => (
                <div key={r.id} className="grid grid-cols-4 gap-2 text-xs border-b last:border-0 py-1.5 items-center">
                  <div className="font-mono-num">{format(parseISO(r.billing_month), 'MMM yy')}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.total_kwh, 0)}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.sumDaily, 0)}</div>
                  <div className="text-right">
                    {r.variance != null && (
                      <StatusPill tone={Math.abs(r.variance) > 15 ? 'danger' : Math.abs(r.variance) > 5 ? 'warn' : 'accent'}>
                        {r.variance > 0 ? '+' : ''}{r.variance.toFixed(1)}%
                      </StatusPill>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground pt-1">
                <div>Month</div><div className="text-right">Billed</div><div className="text-right">Daily Σ</div><div className="text-right">Δ%</div>
              </div>
            </div>
          </Card>
        </>
      )}
      {plantId && !rows.length && <Card className="p-6 text-center text-sm text-muted-foreground">No bills entered yet</Card>}
    </div>
  );
}
